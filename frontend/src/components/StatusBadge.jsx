import { statusLabel } from '../labels';

const STATUS_STYLES = {
  已报名: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  未联系: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  已联系: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  待回访: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  已完成: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300',
  无效: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  拒绝接听: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',
  已过期: 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

export default function StatusBadge({ status }) {
  if (!status) return <span className="text-xs text-gray-400">-</span>;
  const cls = STATUS_STYLES[status] || 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cls}`}>
      {statusLabel(status)}
    </span>
  );
}
