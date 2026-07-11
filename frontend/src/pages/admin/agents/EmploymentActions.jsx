import { ArrowRightLeft, PauseCircle, UserCheck, UserX } from 'lucide-react';
import { employmentStatus } from '../agentManageUtils';

const buttonClass =
  'inline-flex min-h-8 items-center justify-center gap-1 rounded-lg border px-2 py-1.5 text-xs font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50';

export default function EmploymentActions({
  account,
  disabled = false,
  onSuspend,
  onResume,
  onStartHandover,
  onOpenBatch,
}) {
  const status = employmentStatus(account);

  if (status === 'active') {
    return (
      <>
        {onSuspend && (
          <button
            type="button"
            title="暂停账号登录，保留当前归属"
            aria-label="暂停"
            disabled={disabled}
            onClick={onSuspend}
            className={`${buttonClass} border-amber-300 text-amber-700 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-900/20`}
          >
            <PauseCircle className="h-3.5 w-3.5" aria-hidden="true" />
            暂停
          </button>
        )}
        {onStartHandover && (
          <button
            type="button"
            title="办理离职：保留进度并进入安全交接"
            aria-label="办理离职"
            disabled={disabled}
            onClick={onStartHandover}
            className={`${buttonClass} border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20`}
          >
            <UserX className="h-3.5 w-3.5" aria-hidden="true" />
            办理离职
          </button>
        )}
      </>
    );
  }

  if (status === 'suspended' && onResume) {
    return (
      <button
        type="button"
        title="恢复账号登录"
        aria-label="恢复"
        disabled={disabled}
        onClick={onResume}
        className={`${buttonClass} border-green-300 text-green-700 hover:bg-green-50 dark:border-green-800 dark:text-green-300 dark:hover:bg-green-900/20`}
      >
        <UserCheck className="h-3.5 w-3.5" aria-hidden="true" />
        恢复
      </button>
    );
  }

  if (status === 'handover_pending' && onOpenBatch) {
    return (
      <button
        type="button"
        title="打开该员工的交接批次"
        aria-label="打开交接批次"
        disabled={disabled}
        onClick={onOpenBatch}
        className={`${buttonClass} border-blue-300 text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/20`}
      >
        <ArrowRightLeft className="h-3.5 w-3.5" aria-hidden="true" />
        打开交接批次
      </button>
    );
  }

  return null;
}
