import { useEffect, useRef, useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  ChevronUp,
  Loader2,
  PhoneCall,
} from 'lucide-react';
import useLeadOutcomeCatalog from '../../../hooks/useLeadOutcomeCatalog';
import { defaultFollowUpDate } from '../../../utils/dateTime';

const MOBILE_COMMON_OUTCOME_CODES = [
  'missed_call',
  'very_interested',
  'interested_wechat',
  'no_intent',
  'phone_invalid',
];

export default function DialResultModal({
  dialModal,
  onStatusSelect,
  onIntentSelect,
  onFollowUpSelect,
  onClose,
  mobile = false,
}) {
  const [followUpDate, setFollowUpDate] = useState(defaultFollowUpDate);
  const [showMoreOutcomes, setShowMoreOutcomes] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const { results } = useLeadOutcomeCatalog();

  const modalKey = `${dialModal?.studentId ?? ''}:${dialModal?.dialLogId ?? ''}`;
  useEffect(() => {
    setFollowUpDate(defaultFollowUpDate());
    setShowMoreOutcomes(false);
    submittingRef.current = false;
    setSubmitting(false);
  }, [modalKey]);

  if (!dialModal) return null;

  const step = dialModal.showFollowUp ? 'followup' : dialModal.showIntent ? 'intent' : 'status';
  const commonOutcomes = MOBILE_COMMON_OUTCOME_CODES
    .map((code) => results.find((outcome) => outcome.code === code))
    .filter(Boolean);
  const uncommonOutcomes = results.filter(
    (outcome) => !MOBILE_COMMON_OUTCOME_CODES.includes(outcome.code),
  );

  const runAction = async (action) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      await action();
    } catch {
      // Parent handlers own error reporting; this guard only prevents duplicate taps.
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const renderOutcome = (outcome) => (
    <button
      key={outcome.code}
      type="button"
      onClick={() => runAction(() => onStatusSelect(outcome))}
      disabled={submitting}
      className={`${mobile ? 'min-h-[52px] px-2 text-xs' : 'min-h-[50px] px-3 text-sm'} rounded-lg py-2 font-semibold leading-5 text-white transition active:scale-[0.98] disabled:cursor-wait disabled:opacity-45 ${outcome.className}`}
    >
      {outcome.label}
    </button>
  );

  return (
    <div className={`fixed inset-0 z-[60] flex bg-gray-950/55 ${mobile ? 'items-end' : 'items-center justify-center p-4'}`}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dial-result-title"
        aria-busy={submitting}
        className={`w-full overflow-y-auto bg-white shadow-2xl dark:bg-gray-900 ${
          mobile
            ? 'max-h-[92dvh] rounded-t-panel px-4 pb-[max(20px,env(safe-area-inset-bottom))] pt-2'
            : 'max-w-sm rounded-panel p-6'
        }`}
      >
        {mobile && <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-gray-300 dark:bg-gray-600" aria-hidden="true" />}
        <div className={`mb-4 ${mobile ? 'flex items-center gap-3 text-left' : 'text-center'}`}>
          <div className={`flex shrink-0 items-center justify-center bg-green-100 dark:bg-green-900/40 ${mobile ? 'h-10 w-10 rounded-lg' : 'mx-auto mb-3 h-12 w-12 rounded-full'}`}>
            {step === 'followup' ? (
              <CalendarClock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            ) : (
              <PhoneCall className="h-5 w-5 text-green-600 dark:text-green-400" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <h3 id="dial-result-title" className="truncate text-base font-bold text-gray-900 dark:text-gray-100">
              {dialModal.studentName}
            </h3>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400">
              {step === 'followup'
                ? '设置回访时间，到点会提醒你'
                : step === 'intent'
                  ? '选择本次沟通后的意向等级'
                  : '选择本次通话结果'}
            </p>
          </div>
          {submitting && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-blue-600" aria-label="正在保存" />}
        </div>

        {step === 'status' && (
          <div className="mb-3 space-y-3">
            <div className={`grid gap-2.5 ${mobile ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {(mobile ? commonOutcomes : results).map(renderOutcome)}
            </div>
            {mobile && uncommonOutcomes.length > 0 && (
              <>
                <button
                  type="button"
                  onClick={() => setShowMoreOutcomes((value) => !value)}
                  disabled={submitting}
                  className="flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 dark:border-gray-700 dark:text-gray-300"
                  aria-expanded={showMoreOutcomes}
                >
                  {showMoreOutcomes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  {showMoreOutcomes ? '收起其他结果' : `更多结果 (${uncommonOutcomes.length})`}
                </button>
                {showMoreOutcomes && (
                  <div className="grid grid-cols-2 gap-2.5 border-t border-gray-100 pt-3 dark:border-gray-800">
                    {uncommonOutcomes.map(renderOutcome)}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {step === 'intent' && (
          <div className="mb-3 rounded-lg bg-gray-50 p-3 dark:bg-gray-800">
            <div className="mb-2 text-xs font-medium text-gray-500 dark:text-gray-400">意向等级</div>
            <div className="grid grid-cols-4 gap-2">
              {['A', 'B', 'C', '无'].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => runAction(() => onIntentSelect(level))}
                  disabled={submitting}
                  className={`min-h-[46px] rounded-lg px-2 py-2 text-sm font-semibold transition-all disabled:cursor-wait disabled:opacity-45 ${
                    level === 'A'
                      ? 'bg-red-100 text-red-700 ring-2 ring-red-300 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200'
                      : level === 'B'
                        ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200'
                        : level === 'C'
                          ? 'bg-gray-200 text-gray-700 ring-2 ring-gray-300 dark:bg-gray-600 dark:text-gray-200 hover:bg-gray-300'
                          : 'bg-gray-100 text-gray-500 ring-2 ring-gray-200 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200'
                  }`}
                >
                  {level === '无' ? '未评级' : `${level}级`}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'followup' && (
          <div className="space-y-3 mb-3">
            <input
              aria-label="回访时间"
              type="datetime-local"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              disabled={submitting}
              className="h-12 w-full rounded-lg border px-3 text-sm bg-white dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
            />
            <button
              type="button"
              onClick={() => runAction(() => onFollowUpSelect(followUpDate))}
              disabled={!followUpDate || submitting}
              className="min-h-[48px] w-full rounded-lg bg-amber-600 py-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-wait disabled:opacity-45"
            >
              保存回访提醒
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => runAction(onClose)}
          disabled={submitting}
          className="mt-3 min-h-[44px] w-full rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 disabled:cursor-wait disabled:opacity-45 dark:border-gray-700 dark:text-gray-300"
        >
          {step === 'status' ? '不记录，关闭' : '跳过'}
        </button>
      </div>
    </div>
  );
}
