import { useState } from 'react';
import { PhoneCall, CalendarClock } from 'lucide-react';
import { DESKTOP_DIAL_STATUS_BUTTONS } from '../../../labels';

// 默认回访时间：明天上午 9 点，格式与 <input type="datetime-local"> 一致
function defaultFollowUp() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function DialResultModal({
  dialModal,
  onStatusSelect,
  onIntentSelect,
  onFollowUpSelect,
  onClose,
}) {
  const [followUpDate, setFollowUpDate] = useState(defaultFollowUp);

  if (!dialModal) return null;

  const step = dialModal.showFollowUp ? 'followup' : dialModal.showIntent ? 'intent' : 'status';

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6">
        <div className="text-center mb-4">
          <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-green-100 dark:bg-green-900/40 flex items-center justify-center">
            {step === 'followup' ? (
              <CalendarClock className="w-6 h-6 text-amber-600 dark:text-amber-400" />
            ) : (
              <PhoneCall className="w-6 h-6 text-green-600 dark:text-green-400" />
            )}
          </div>
          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
            {dialModal.studentName}
          </h3>
          <p className="text-sm text-gray-500 mt-1">
            {step === 'followup'
              ? '设置回访时间，到点会提醒你'
              : step === 'intent'
                ? '请选择意向等级'
                : '通话已完成，请选择处理结果'}
          </p>
        </div>

        {step === 'status' && (
          <div className="grid grid-cols-2 gap-3 mb-3">
            {DESKTOP_DIAL_STATUS_BUTTONS.map(({ status, className }) => (
              <button
                key={status}
                onClick={() => onStatusSelect(status)}
                className={`px-4 py-3 rounded-xl text-sm font-medium text-white ${className}`}
              >
                {status}
              </button>
            ))}
          </div>
        )}

        {step === 'intent' && (
          <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-3 mb-3">
            <div className="text-xs text-gray-500 mb-1.5 text-center">意向等级</div>
            <div className="flex gap-2 justify-center">
              {['A', 'B', 'C', '无'].map((level) => (
                <button
                  key={level}
                  onClick={() => onIntentSelect(level)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                    level === 'A'
                      ? 'bg-red-100 text-red-700 ring-2 ring-red-300 dark:bg-red-900/40 dark:text-red-300 hover:bg-red-200'
                      : level === 'B'
                        ? 'bg-amber-100 text-amber-700 ring-2 ring-amber-300 dark:bg-amber-900/40 dark:text-amber-300 hover:bg-amber-200'
                        : level === 'C'
                          ? 'bg-gray-200 text-gray-700 ring-2 ring-gray-300 dark:bg-gray-600 dark:text-gray-200 hover:bg-gray-300'
                          : 'bg-gray-100 text-gray-500 ring-2 ring-gray-200 dark:bg-gray-700 dark:text-gray-400 hover:bg-gray-200'
                  }`}
                >
                  {level === '无' ? '无' : `${level}级`}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'followup' && (
          <div className="space-y-3 mb-3">
            <input
              type="datetime-local"
              value={followUpDate}
              onChange={(e) => setFollowUpDate(e.target.value)}
              className="w-full px-3 py-2.5 border dark:border-gray-600 rounded-xl text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
            />
            <button
              onClick={() => onFollowUpSelect(followUpDate)}
              disabled={!followUpDate}
              className="w-full py-3 rounded-xl text-sm font-medium text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50"
            >
              保存回访提醒
            </button>
          </div>
        )}

        <button
          onClick={onClose}
          className="mt-4 w-full py-2.5 rounded-xl border dark:border-gray-600 text-sm text-gray-600 dark:text-gray-300"
        >
          {step === 'status' ? '不记录，关闭' : '跳过'}
        </button>
      </div>
    </div>
  );
}
