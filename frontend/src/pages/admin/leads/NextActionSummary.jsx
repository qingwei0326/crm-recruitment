import { formatDateTime } from '../../../utils';

export default function NextActionSummary({ action, showEmpty = false }) {
  if (!action) {
    return showEmpty ? <span className="text-xs text-gray-400">当前无待办</span> : <span className="text-xs text-gray-400">-</span>;
  }
  const urgent = action.priority === 'high';
  const labelTone = urgent
    ? 'text-red-700 dark:text-red-300'
    : action.kind === 'missing_next_action'
    ? 'text-amber-700 dark:text-amber-300'
    : 'text-blue-700 dark:text-blue-300';
  return (
    <div className="min-w-0" data-testid="next-action">
      <div className={`truncate text-xs font-semibold ${labelTone}`}>{action.label || '待处理'}</div>
      <div className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">
        {action.owner_name || '待分配'}
        {action.due_at ? ` · ${formatDateTime(action.due_at)}` : ''}
      </div>
    </div>
  );
}
