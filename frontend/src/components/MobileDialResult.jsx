import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PhoneCall,
  X,
  Loader2,
  CalendarClock,
  MessageSquare,
  ChevronLeft,
} from 'lucide-react';
import api from '../api';
import { completePendingDial, readPendingDial } from '../dialSession';
import logger from '../utils/logger';
import { getApiErrorMessage, unwrapApiResponse } from '../utils';
import { useConfirm } from './ConfirmDialog';
import { payloadForOperatorResult } from '../operatorResultPolicy';
import { getOperatorOutcomeGroups } from '../domain/outcomeCatalog';
import useLeadOutcomeCatalog from '../hooks/useLeadOutcomeCatalog';
import { displayStatusForOperatorResult } from '../labels';
import {
  dateTimeAfterDays,
  defaultFollowUpDate,
  defaultMissedFollowUpDate,
  laterTodayOrTomorrowDate,
} from '../utils/dateTime';

/**
 * 手机端"打完电话选结果"底部弹窗。
 *
 * 工作原理：useDialFlow 在唤起 tel: 前把 { studentId, studentName, dialStartedAt }
 * 写入 sessionStorage('pendingDial')。话务员从系统拨号界面返回 App 时，
 * 本组件读取该标记并弹出，让其选联系状况和处理结果，PUT /students/{id} 落库。
 *
 * 自动记录通话时长（visibilitychange 时间差）和备注。
 *
 * @param {Object} props
 * @param {function} props.onUpdated - 落库成功后回调 (studentId, status) => void
 */

const CONTACT_CHOICES = [
  {
    key: 'connected',
    label: '已接通',
    hint: '选择沟通结果',
    className: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  {
    key: 'missed',
    label: '未接',
    hint: '安排下一次重拨',
    className: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  },
  {
    key: 'invalid',
    label: '号码无效',
    hint: '空号或停机',
    colSpan: 2,
    className: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
  },
];

const FOLLOW_UP_PRESETS = {
  missed: [
    { label: '10分钟后', getValue: defaultMissedFollowUpDate },
    { label: '今天晚些时候', getValue: laterTodayOrTomorrowDate },
    { label: '明天上午', getValue: () => dateTimeAfterDays(1) },
  ],
  intent: [
    { label: '明天上午', getValue: () => dateTimeAfterDays(1) },
    { label: '后天上午', getValue: () => dateTimeAfterDays(2) },
    { label: '3天后', getValue: () => dateTimeAfterDays(3) },
    { label: '1周后', getValue: () => dateTimeAfterDays(7) },
  ],
};

/**
 * 手机端“打完电话选结果”底部弹窗。
 *
 * 工作原理：useDialFlow 在唤起 tel: 前把 { studentId, studentName } 写入
 * sessionStorage('pendingDial')。话务员从系统拨号界面返回 App 时
 * （visibilitychange / focus / pageshow，部分浏览器会重载则走 mount），
 * 本组件读取该标记并弹出，让其选联系状况和处理结果，PUT /students/{id} 落库。
 *
 * 这样补齐了手机端缺失的“打完电话更新联系状况”——桌面端 AgentWork 早已有此逻辑。
 *
 * props.onUpdated(studentId, status) — 落库成功后回调，宿主页据此刷新列表/详情。
 */
export default function MobileDialResult({ onUpdated }) {
  const confirm = useConfirm();
  const { results } = useLeadOutcomeCatalog();
  // 新线索是管理员回收/重新分配后的初始状态，话务员不能在拨号结果里再次选回。
  const statusButtons = results.filter((button) => button.code !== 'new_lead');
  const {
    connectedFollowUp: connectedIntentButtons,
    connectedConclusion: connectedResultButtons,
    moreResults: moreResultButtons,
    phoneInvalid: phoneInvalidButton,
  } = getOperatorOutcomeGroups(statusButtons);
  const [pending, setPending] = useState(null); // { studentId, studentName, dialStartedAt }
  const [resultStep, setResultStep] = useState('contact'); // contact | connected | invalid
  const [showMoreResults, setShowMoreResults] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpMode, setFollowUpMode] = useState(null); // intent | missed
  const [followUpDate, setFollowUpDate] = useState(defaultFollowUpDate);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState('');
  const [completionPending, setCompletionPending] = useState(false);
  const [noteText, setNoteText] = useState('');
  const callRecordPromiseRef = useRef(null);
  const noteRecordedRef = useRef(false);
  const businessSavedRef = useRef(false);
  const submittingRef = useRef(false);

  const tryLoadPending = useCallback(() => {
    // 正在处理一通的结果时，别被新的 visibilitychange 覆盖
    if (pending) return;
    const data = readPendingDial();
    if (data?.studentId) {
      setResultStep('contact');
      setShowMoreResults(false);
      setShowFollowUp(false);
      setFollowUpMode(null);
      setFollowUpDate(defaultFollowUpDate());
      setSubmitting(false);
      setErrorText('');
      setCompletionPending(false);
      setNoteText('');
      submittingRef.current = false;
      callRecordPromiseRef.current = null;
      noteRecordedRef.current = false;
      businessSavedRef.current = false;
      setPending(data);
    }
  }, [pending]);

  useEffect(() => {
    // 拨号返回 App 的信号在各机型/浏览器表现不一，多挂几个以求稳：
    tryLoadPending(); // 页面重载（部分浏览器拨号返回会重载）
    const handler = () => {
      if (document.visibilityState === 'visible') tryLoadPending();
    };
    const focusHandler = () => tryLoadPending();
    document.addEventListener('visibilitychange', handler);
    window.addEventListener('focus', focusHandler);
    window.addEventListener('pageshow', focusHandler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
      window.removeEventListener('focus', focusHandler);
      window.removeEventListener('pageshow', focusHandler);
    };
  }, [tryLoadPending]);

  if (!pending) return null;

  const close = () => {
    submittingRef.current = false;
    setPending(null);
    setResultStep('contact');
    setShowMoreResults(false);
    setShowFollowUp(false);
    setFollowUpMode(null);
    setSubmitting(false);
    setErrorText('');
    setCompletionPending(false);
    setNoteText('');
    businessSavedRef.current = false;
  };

  const putField = async (payload) => {
    const response = await api.put(`/students/${pending.studentId}`, payload);
    return unwrapApiResponse(response);
  };

  const beginSubmit = () => {
    if (submittingRef.current) return false;
    submittingRef.current = true;
    setSubmitting(true);
    setErrorText('');
    return true;
  };

  const endSubmit = () => {
    submittingRef.current = false;
    setSubmitting(false);
  };

  const recordNoteOnce = async () => {
    const content = noteText.trim();
    if (!content || noteRecordedRef.current) return;
    const response = await api.post('/notes', { student_id: pending.studentId, content });
    unwrapApiResponse(response);
    noteRecordedRef.current = true;
  };

  const recordCallOnce = () => {
    if (!callRecordPromiseRef.current) {
      callRecordPromiseRef.current = completePendingDial(pending.studentId, pending)
        .catch((e) => {
          callRecordPromiseRef.current = null;
          throw e;
        });
    }
    return callRecordPromiseRef.current;
  };

  const finishDial = async ({ businessSaved = false } = {}) => {
    businessSavedRef.current = businessSavedRef.current || businessSaved;
    try {
      await recordNoteOnce();
      await recordCallOnce();
      close();
      return true;
    } catch (e) {
      logger.error('通话结果收尾同步失败:', e);
      const notePending = noteText.trim() && !noteRecordedRef.current;
      const prefix = businessSavedRef.current ? '处理结果已保存，' : '';
      setErrorText(
        notePending
          ? `${prefix}备注保存失败：${getApiErrorMessage(e)}`
          : `${prefix}通话记录同步失败，请重试`,
      );
      setCompletionPending(true);
      endSubmit();
      return false;
    }
  };

  const retryCompletion = async () => {
    if (!beginSubmit()) return;
    await finishDial({ businessSaved: businessSavedRef.current });
  };

  const handleClose = async () => {
    if (showFollowUp && followUpMode === 'missed') {
      setErrorText('未接需要先安排下一次重拨');
      return;
    }
    if (!beginSubmit()) return;
    await finishDial();
  };

  const pickStatus = async (btn, options = {}) => {
    if (!beginSubmit()) return;
    try {
      if (btn.code === 'enrolled') {
        const ok = await confirm({
          title: '确认报名',
          message: '确认将此学生标记为已报名？阶段也会同步更新为已报名。',
          confirmText: '确认报名',
        });
        if (!ok) {
          endSubmit();
          return;
        }
      }

      await putField(payloadForOperatorResult(btn));
      businessSavedRef.current = true;
      onUpdated && onUpdated(
        pending.studentId,
        displayStatusForOperatorResult(btn),
        btn.invalidReason || '',
      );

      if (options.followUpMode === 'missed') {
        setFollowUpMode('missed');
        setFollowUpDate(defaultMissedFollowUpDate());
        setShowFollowUp(true);
        endSubmit();
        return;
      }

      // 需要继续跟进的结果直接进入回访时间，不再插入 A/B/C 意向等级步骤。
      if (['interested_wechat', 'waiting_volunteer'].includes(btn.code)) {
        setFollowUpMode('intent');
        setFollowUpDate(defaultFollowUpDate());
        setShowFollowUp(true);
        endSubmit();
        return;
      }

      await finishDial({ businessSaved: true });
    } catch (e) {
      logger.error('状态同步失败:', e);
      setErrorText('处理结果保存失败，请重试');
      endSubmit();
    }
  };

  const pickContact = (choice) => {
    setErrorText('');
    setShowMoreResults(false);
    if (choice === 'connected') {
      setResultStep('connected');
      return;
    }
    if (choice === 'invalid') {
      setResultStep('invalid');
      return;
    }
    const missedButton = statusButtons.find((button) => button.code === 'missed_call');
    if (!missedButton) {
      setErrorText('未找到未接结果，请刷新后重试');
      return;
    }
    void pickStatus(missedButton, { followUpMode: 'missed' });
  };

  const saveFollowUp = async () => {
    if (!beginSubmit()) return;
    if (!followUpDate) {
      setErrorText(
        followUpMode === 'missed'
          ? '请先安排下一次重拨时间'
          : '请先选择回访时间',
      );
      endSubmit();
      return;
    }
    try {
      const response = await api.post('/follow-ups', {
        student_id: pending.studentId,
        follow_up_date: followUpDate.length === 16 ? followUpDate + ':00' : followUpDate,
      });
      unwrapApiResponse(response);
      onUpdated && onUpdated(pending.studentId, null);
      await finishDial({ businessSaved: true });
    } catch (e) {
      logger.error('回访记录同步失败:', e);
      setErrorText('回访提醒保存失败，请重试');
      endSubmit();
    }
  };

  const headerMessage = submitting
    ? '保存中，请稍候'
    : showFollowUp
      ? followUpMode === 'missed' ? '未接，请安排下一次重拨' : '设置回访时间，到点会提醒你'
      : resultStep === 'contact'
        ? '先选择本次拨打结果'
        : resultStep === 'connected'
          ? '已接通，请选择后续结果'
          : '确认号码是否无效';

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end" onClick={handleClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="mobile-dial-result-title"
        className="w-full bg-white dark:bg-gray-900 rounded-t-panel p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-4 max-h-[92dvh] overflow-y-auto overscroll-contain"
        onClick={(e) => e.stopPropagation()}
        aria-busy={submitting}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0 mr-4">
            <div className="w-9 h-9 shrink-0 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <PhoneCall className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                <span id="mobile-dial-result-title">
                  {pending.studentName || '本次通话'}
                </span>
              </div>
              <div className="text-xs text-gray-500">
                {headerMessage}
              </div>
            </div>
          </div>
          <button type="button" onClick={handleClose} className="text-gray-400 p-1 -mr-1 shrink-0" aria-label="不记录，关闭">
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorText && (
          <div role="alert" className="flex items-center justify-between gap-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/30 dark:text-red-300">
            <span>{errorText}</span>
            {completionPending && (
              <button
                type="button"
                onClick={retryCompletion}
                disabled={submitting}
                className="min-h-[36px] shrink-0 rounded-lg border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 disabled:opacity-60 dark:border-red-800 dark:bg-gray-900 dark:text-red-300"
              >
                重试同步
              </button>
            )}
          </div>
        )}

        {showFollowUp ? (
          <div className="space-y-3">
            {followUpMode === 'intent' && (
              <div className="rounded-panel border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                已加家长微信后，请直接在微信备注学生情况；系统这里只安排下次回访，不用重复写备注。
              </div>
            )}
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
              <CalendarClock className="w-4 h-4" />
              {followUpMode === 'missed'
                ? '安排下一次重拨，任务不会沉底'
                : '设置回访时间，到点会提醒你'}
            </div>
            {/* 快捷时间 */}
            <div className="flex gap-2 flex-wrap">
              {(FOLLOW_UP_PRESETS[followUpMode] || []).map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={submitting || completionPending}
                  onClick={() => setFollowUpDate(q.getValue())}
                  className="px-3 py-1.5 min-h-[44px] rounded-lg text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 active:scale-95 disabled:opacity-60 flex items-center justify-center"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              disabled={submitting || completionPending}
              className="w-full border dark:border-gray-600 rounded-lg p-3 text-base bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex gap-2">
              {followUpMode !== 'missed' && (
                <button
                  type="button"
                  onClick={async () => {
                    if (!beginSubmit()) return;
                    await finishDial({ businessSaved: true });
                  }}
                  disabled={submitting || completionPending}
                  className="flex-1 min-h-[48px] rounded-panel border dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium active:scale-95 disabled:opacity-60"
                >
                  跳过
                </button>
              )}
              <button
                type="button"
                onClick={saveFollowUp}
                disabled={submitting || completionPending || !followUpDate}
                className="flex-1 min-h-[48px] rounded-panel bg-amber-600 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-95 disabled:opacity-60"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                {followUpMode === 'missed' ? '保存下一次重拨' : '保存回访提醒'}
              </button>
            </div>
          </div>
        ) : (
          <>
            {resultStep !== 'contact' && (
              <button
                type="button"
                onClick={() => {
                  setResultStep('contact');
                  setShowMoreResults(false);
                }}
                disabled={submitting || completionPending}
                className="inline-flex items-center gap-1 text-sm text-gray-500 dark:text-gray-400 min-h-[36px] disabled:opacity-60"
              >
                <ChevronLeft className="w-4 h-4" />
                返回上一步
              </button>
            )}

            {resultStep === 'contact' && (
              <div className="space-y-2">
                <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                  第一步：本次拨打结果
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {CONTACT_CHOICES.map((choice) => (
                    <button
                      key={choice.key}
                      type="button"
                      onClick={() => pickContact(choice.key)}
                      disabled={submitting || completionPending}
                      className={`${choice.colSpan ? 'col-span-2' : ''} min-h-[70px] rounded-panel border px-3 text-left active:scale-95 disabled:opacity-60 ${choice.className}`}
                    >
                      <div className="text-base font-semibold">{choice.label}</div>
                      <div className="mt-1 text-xs opacity-75">{choice.hint}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {resultStep === 'connected' && (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    第二步：已接通后的处理结果
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    先选最符合的一项，需要回访时再设置时间
                  </div>
                </div>

                <div className="rounded-panel border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs leading-5 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300">
                  首次沟通先记录客观结果，不要求判断 A/B/C。加微信后直接在微信里备注，避免两边重复填写。
                </div>

                {connectedIntentButtons.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-gray-500">意向/跟进</div>
                    <div className="grid grid-cols-2 gap-2">
                      {connectedIntentButtons.map((b) => (
                        <button
                          key={b.code}
                          type="button"
                          onClick={() => pickStatus(b)}
                          disabled={submitting || completionPending}
                          className="min-h-[52px] rounded-lg border border-blue-200 bg-blue-50 px-2 text-sm font-medium text-blue-700 active:scale-95 disabled:opacity-60 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {connectedResultButtons.length > 0 && (
                  <div className="space-y-2">
                    <div className="text-xs font-semibold text-gray-500">明确结论</div>
                    <div className="grid grid-cols-2 gap-2">
                      {connectedResultButtons.map((b) => (
                        <button
                          key={b.code}
                          type="button"
                          onClick={() => pickStatus(b)}
                          disabled={submitting || completionPending}
                          className={`min-h-[52px] rounded-lg border px-2 text-sm font-medium active:scale-95 disabled:opacity-60 ${b.code === 'enrolled'
                            ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/30 dark:text-green-300'
                            : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}
                        >
                          {b.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {moreResultButtons.length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowMoreResults((value) => !value)}
                      disabled={submitting || completionPending}
                      className="w-full min-h-[40px] rounded-lg border border-dashed border-gray-300 text-sm text-gray-500 dark:border-gray-600 dark:text-gray-400 disabled:opacity-60"
                    >
                      {showMoreResults ? '收起其他结果' : `更多结果（${moreResultButtons.length}）`}
                    </button>
                    {showMoreResults && (
                      <div className="grid grid-cols-2 gap-2 mt-2">
                        {moreResultButtons.map((b) => (
                          <button
                            key={b.code}
                            type="button"
                            onClick={() => pickStatus(b)}
                            disabled={submitting || completionPending}
                            className="min-h-[48px] rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-600 active:scale-95 disabled:opacity-60 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                          >
                            {b.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {resultStep === 'invalid' && (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    第二步：确认号码无效
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    确认后会从待处理队列移除，后续可由管理员回收
                  </div>
                </div>
                {phoneInvalidButton ? (
                  <button
                    type="button"
                    onClick={() => pickStatus(phoneInvalidButton)}
                    disabled={submitting || completionPending}
                    className="w-full min-h-[56px] rounded-panel border border-gray-300 bg-gray-100 text-gray-700 text-sm font-semibold active:scale-95 disabled:opacity-60 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
                  >
                    确认空号/停机
                  </button>
                ) : (
                  <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                    当前结果目录没有号码无效选项，请刷新后重试。
                  </div>
                )}
              </div>
            )}

            {resultStep === 'invalid' && (
              <div className="relative">
                <MessageSquare className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400" />
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="号码情况说明（可选）"
                  rows={2}
                  disabled={submitting || completionPending}
                  className="w-full pl-7 pr-3 py-2 border dark:border-gray-600 rounded-lg text-base bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 resize-none outline-none focus:ring-1 focus:ring-blue-500"
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
