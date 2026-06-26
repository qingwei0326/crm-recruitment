import { useCallback, useEffect, useRef, useState } from 'react';
import { PhoneCall, X, Loader2, CalendarClock, MessageSquare } from 'lucide-react';
import api from '../api';
import logger from '../utils/logger';
import { useConfirm } from './ConfirmDialog';
import {
  displayStatusForOperatorResult,
  OPERATOR_INVALID_DETAIL_LABELS,
  OPERATOR_STATUS_BUTTON_LABELS,
  STATUS_ACTION_BUTTON_CLASSES,
} from '../labels';

/**
 * 手机端"打完电话选结果"底部弹窗。
 *
 * 工作原理：useDialFlow 在唤起 tel: 前把 { studentId, studentName, dialStartedAt }
 * 写入 sessionStorage('pendingDial')。话务员从系统拨号界面返回 App 时，
 * 本组件读取该标记并弹出，让其选联系状况（+意向等级），PUT /students/{id} 落库。
 *
 * 自动记录通话时长（visibilitychange 时间差）和备注。
 *
 * @param {Object} props
 * @param {function} props.onUpdated - 落库成功后回调 (studentId, status) => void
 */

/**
 * 记录通话时长和备注（拨号后静默同步）
 * @param {number} studentId - 学生ID
 * @param {number} dialStartedAt - 拨号开始时间戳
 * @param {string} noteText - 备注内容
 */
function recordCallResult(studentId, dialStartedAt, noteText) {
  const duration = dialStartedAt ? Math.round((Date.now() - dialStartedAt) / 1000) : 0;
  if (duration > 0) {
    api.put(`/students/dial-duration?student_id=${studentId}&duration_seconds=${duration}`)
      .catch((e) => logger.error('记录通话时长失败:', e));
  }
  if (noteText?.trim()) {
    api.post('/notes', { student_id: studentId, content: noteText.trim() })
      .catch((e) => logger.error('记录备注失败:', e));
  }
}

// 默认回访时间：明天上午 9 点，<input type="datetime-local"> 格式
function defaultFollowUp() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 统一后的处理结果。无效原因类按钮直接写入对应原因，避免话务员重复备注。
export const STATUS_BUTTONS = OPERATOR_STATUS_BUTTON_LABELS.map((label) => ({
  label,
  cls: STATUS_ACTION_BUTTON_CLASSES[label],
  invalidDetail: OPERATOR_INVALID_DETAIL_LABELS.includes(label),
}));

const INTENT_BUTTONS = [
  { level: 'A', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  { level: 'B', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { level: 'C', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { level: '无', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
];

/**
 * 手机端“打完电话选结果”底部弹窗。
 *
 * 工作原理：useDialFlow 在唤起 tel: 前把 { studentId, studentName } 写入
 * sessionStorage('pendingDial')。话务员从系统拨号界面返回 App 时
 * （visibilitychange / focus / pageshow，部分浏览器会重载则走 mount），
 * 本组件读取该标记并弹出，让其选联系状况（+意向等级），PUT /students/{id} 落库。
 *
 * 这样补齐了手机端缺失的“打完电话更新联系状况”——桌面端 AgentWork 早已有此逻辑。
 *
 * props.onUpdated(studentId, status) — 落库成功后回调，宿主页据此刷新列表/详情。
 */
export default function MobileDialResult({ onUpdated }) {
  const confirm = useConfirm();
  const [pending, setPending] = useState(null); // { studentId, studentName, dialStartedAt }
  const [showIntent, setShowIntent] = useState(false);
  const [flowStatus, setFlowStatus] = useState(null); // 记住本次选的联系状况
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [followUpDate, setFollowUpDate] = useState(defaultFollowUp);
  const [submitting, setSubmitting] = useState(false);
  const [noteText, setNoteText] = useState('');
  const callRecordedRef = useRef(false);

  const tryLoadPending = useCallback(() => {
    // 正在处理一通的结果时，别被新的 visibilitychange 覆盖
    if (pending) return;
    let raw;
    try {
      raw = sessionStorage.getItem('pendingDial');
    } catch {
      return;
    }
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      sessionStorage.removeItem('pendingDial');
      if (data && data.studentId) {
        setShowIntent(false);
        setFlowStatus(null);
        setShowFollowUp(false);
        setFollowUpDate(defaultFollowUp());
        callRecordedRef.current = false;
        setPending(data);
      }
    } catch {
      sessionStorage.removeItem('pendingDial');
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
    setPending(null);
    setShowIntent(false);
    setFlowStatus(null);
    setShowFollowUp(false);
    setSubmitting(false);
    setNoteText('');
  };

  const putField = (payload) => api.put(`/students/${pending.studentId}`, payload);

  const recordCallOnce = () => {
    if (callRecordedRef.current) return;
    callRecordedRef.current = true;
    recordCallResult(pending.studentId, pending.dialStartedAt, noteText);
  };

  const pickStatus = async (btn) => {
    if (submitting) return;
    const status = btn.label;
    if (status === '已报名') {
      const ok = await confirm({
        title: '确认报名',
        message: '确认将此学生标记为已报名？阶段也会同步更新为已报名。',
        confirmText: '确认报名',
      });
      if (!ok) return;
    }
    // 乐观更新：先更新 UI，后台同步
    onUpdated && onUpdated(
      pending.studentId,
      displayStatusForOperatorResult(status),
      btn.invalidDetail ? status : '',
    );
    // 后台静默同步
    putField({ status }).catch((e) => {
      logger.error('状态同步失败:', e);
      onUpdated && onUpdated(pending.studentId, null);
    });

    // 接通后可补充意向等级；待回访会在意向后继续设置回访时间。
    if (status === '非常有意向' || status === '意向了解加微' || status === '已联系' || status === '待回访') {
      setFlowStatus(status);
      setShowIntent(true);
      return; // Don't close yet, show intent step
    }

    recordCallOnce();
    close();
  };

  const pickIntent = async (level) => {
    if (submitting) return;
    // 乐观更新：先更新 UI
    onUpdated && onUpdated(pending.studentId, null);
    // 待回访：接着收集回访时间落 /follow-ups；其他：完成
    if (flowStatus === '待回访' || flowStatus === '意向了解加微') {
      setShowIntent(false);
      setShowFollowUp(true);
    } else {
      recordCallOnce();
      close();
    }
    // 后台静默同步
    putField({ intent_level: level }).catch((e) => {
      logger.error('意向等级同步失败:', e);
    });
  };

  const saveFollowUp = async () => {
    if (submitting) return;
    if (!followUpDate) {
      recordCallOnce();
      close();
      return;
    }
    // 乐观更新：先更新 UI
    onUpdated && onUpdated(pending.studentId, null);
    recordCallOnce();
    close();
    // 后台静默同步
    api.post('/follow-ups', {
      student_id: pending.studentId,
      follow_up_date: followUpDate.length === 16 ? followUpDate + ':00' : followUpDate,
    }).catch((e) => {
      logger.error('回访记录同步失败:', e);
    });
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-end" onClick={close}>
      <div
        className="w-full bg-white dark:bg-gray-900 rounded-t-2xl p-4 pb-[calc(env(safe-area-inset-bottom)+16px)] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 shrink-0 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
              <PhoneCall className="w-5 h-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-gray-100 truncate">
                {pending.studentName || '本次通话'}
              </div>
              <div className="text-xs text-gray-500">通话已完成，请选择处理结果</div>
            </div>
          </div>
          <button onClick={close} className="text-gray-400 p-1 -mr-1" aria-label="不记录，关闭">
            <X className="w-5 h-5" />
          </button>
        </div>

        {showFollowUp ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300">
              <CalendarClock className="w-4 h-4" />
              设置回访时间，到点会提醒你
            </div>
            {/* 快捷时间 */}
            <div className="flex gap-2 flex-wrap">
              {[
                { label: '明天上午', offset: { days: 1, hours: 9 } },
                { label: '后天上午', offset: { days: 2, hours: 9 } },
                { label: '3天后', offset: { days: 3, hours: 9 } },
                { label: '1周后', offset: { days: 7, hours: 9 } },
              ].map((q) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => {
                    const d = new Date();
                    d.setDate(d.getDate() + q.offset.days);
                    d.setHours(q.offset.hours, 0, 0, 0);
                    const pad = (n) => String(n).padStart(2, '0');
                    setFollowUpDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:00`);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 active:scale-95"
                >
                  {q.label}
                </button>
              ))}
            </div>
            <input
              type="datetime-local"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="w-full border dark:border-gray-600 rounded-lg p-3 text-base bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-amber-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  recordCallOnce();
                  close();
                }}
                disabled={submitting}
                className="flex-1 min-h-[48px] rounded-xl border dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium active:scale-95 disabled:opacity-60"
              >
                跳过
              </button>
              <button
                type="button"
                onClick={saveFollowUp}
                disabled={submitting || !followUpDate}
                className="flex-1 min-h-[48px] rounded-xl bg-amber-600 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-95 disabled:opacity-60"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                保存回访提醒
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {STATUS_BUTTONS.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => pickStatus(b)}
                  disabled={submitting}
                  className={`min-h-[52px] rounded-xl text-sm font-medium text-white ${b.cls} active:scale-95 disabled:opacity-60`}
                >
                  {b.label}
                </button>
              ))}
            </div>

            {/* 备注输入 */}
            <div className="relative">
              <MessageSquare className="absolute left-2.5 top-2.5 w-3.5 h-3.5 text-gray-400" />
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="添加备注（可选）"
                rows={2}
                className="w-full pl-7 pr-3 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 resize-none outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {showIntent && (
              <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                <div className="text-xs text-gray-500 mb-2 text-center">
                  意向等级（可选，点一下即可，也可跳过）
                </div>
                <div className="flex gap-2 justify-center">
                  {INTENT_BUTTONS.map((b) => (
                    <button
                      key={b.level}
                      type="button"
                      onClick={() => pickIntent(b.level)}
                      disabled={submitting}
                      className={`flex-1 min-h-[44px] rounded-lg text-sm font-semibold active:scale-95 disabled:opacity-60 ${b.cls}`}
                    >
                      {b.level}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    recordCallOnce();
                    close();
                  }}
                  disabled={submitting}
                  className="mt-2.5 w-full text-xs text-gray-400 py-1.5 disabled:opacity-60"
                >
                  跳过意向，完成
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
