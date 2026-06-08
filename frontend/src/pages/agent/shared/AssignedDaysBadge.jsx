export default function AssignedDaysBadge({ days }) {
  if (days == null) return null;
  if (days === 0) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300">
        今日新分配
      </span>
    );
  }
  const cls =
    days >= 7
      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
      : days >= 3
        ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
        : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  const label = days >= 7 ? `积压 ${days} 天` : `${days} 天前分配`;
  return <span className={`text-xs px-2 py-0.5 rounded-full ${cls}`}>{label}</span>;
}
