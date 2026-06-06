import { useCallback, useEffect, useState } from 'react';
import { PhoneCall, X, Loader2 } from 'lucide-react';
import api from '../api';

// 与桌面 AgentWork.renderDialModal 一致的处理结果
const STATUS_BUTTONS = [
  { label: '已联系', cls: 'bg-blue-600 hover:bg-blue-700' },
  { label: '待回访', cls: 'bg-amber-600 hover:bg-amber-700' },
  { label: '拒绝接听', cls: 'bg-gray-500 hover:bg-gray-600' },
  { label: '已报名', cls: 'bg-green-600 hover:bg-green-700' },
  { label: '无效', cls: 'bg-red-500 hover:bg-red-600' },
];

const INTENT_BUTTONS = [
  { level: 'A', cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
  { level: 'B', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
  { level: 'C', cls: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300' },
  { level: '无', cls: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300' },
];

function getMsg(e) {
  return (
    e?.response?.data?.detail ||
    e?.response?.data?.msg ||
    e?.message ||
    '更新失败'
  );
}

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
  const [pending, setPending] = useState(null); // { studentId, studentName }
  const [showIntent, setShowIntent] = useState(false);
  const [invalidMode, setInvalidMode] = useState(false);
  const [invalidReason, setInvalidReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

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
        setInvalidMode(false);
        setInvalidReason('');
        setErr('');
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
    setInvalidMode(false);
    setInvalidReason('');
    setErr('');
    setSubmitting(false);
  };

  const putField = (payload) => api.put(`/students/${pending.studentId}`, payload);

  const pickStatus = async (status) => {
    if (submitting) return;
    if (status === '无效') {
      setErr('');
      setInvalidMode(true);
      return;
    }
    setSubmitting(true);
    setErr('');
    try {
      await putField({ status });
      onUpdated && onUpdated(pending.studentId, status);
      if (status === '已联系' || status === '待回访') {
        // 状态已落库，但不关弹窗——继续让选意向等级（可跳过）
        setShowIntent(true);
      } else {
        close();
      }
    } catch (e) {
      setErr(getMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  const pickIntent = async (level) => {
    if (submitting) return;
    setSubmitting(true);
    setErr('');
    try {
      await putField({ intent_level: level });
      onUpdated && onUpdated(pending.studentId, null);
      close();
    } catch (e) {
      setErr(getMsg(e));
    } finally {
      setSubmitting(false);
    }
  };

  const submitInvalid = async () => {
    if (submitting) return;
    if (!invalidReason.trim()) {
      setErr('请填写无效原因');
      return;
    }
    setSubmitting(true);
    setErr('');
    try {
      await putField({ status: '无效', invalid_reason: invalidReason.trim() });
      onUpdated && onUpdated(pending.studentId, '无效');
      close();
    } catch (e) {
      setErr(getMsg(e));
    } finally {
      setSubmitting(false);
    }
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
          <button onClick={close} className="text-gray-400 p-1 -mr-1" aria-label="稍后再说">
            <X className="w-5 h-5" />
          </button>
        </div>

        {err && (
          <div className="text-xs text-red-600 dark:text-red-300 bg-red-50 dark:bg-red-900/30 rounded-lg px-3 py-2">
            {err}
          </div>
        )}

        {invalidMode ? (
          <div className="space-y-3">
            <textarea
              value={invalidReason}
              onChange={(e) => setInvalidReason(e.target.value)}
              placeholder="请简要说明无效原因，例如：空号 / 明确拒绝 / 已报他校"
              className="w-full h-24 border dark:border-gray-600 rounded-lg p-3 text-base bg-white dark:bg-gray-700 dark:text-gray-100 outline-none focus:ring-2 focus:ring-red-500 resize-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setInvalidMode(false);
                  setErr('');
                }}
                disabled={submitting}
                className="flex-1 min-h-[48px] rounded-xl border dark:border-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium active:scale-95 disabled:opacity-60"
              >
                返回
              </button>
              <button
                type="button"
                onClick={submitInvalid}
                disabled={submitting || !invalidReason.trim()}
                className="flex-1 min-h-[48px] rounded-xl bg-red-500 text-white text-sm font-semibold flex items-center justify-center gap-2 active:scale-95 disabled:opacity-60"
              >
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                确认无效
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              {STATUS_BUTTONS.map((b) => (
                <button
                  key={b.label}
                  type="button"
                  onClick={() => pickStatus(b.label)}
                  disabled={submitting}
                  className={`min-h-[52px] rounded-xl text-base font-medium text-white ${b.cls} active:scale-95 disabled:opacity-60`}
                >
                  {b.label}
                </button>
              ))}
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
                  onClick={close}
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
