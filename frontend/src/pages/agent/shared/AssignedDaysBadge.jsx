export default function AssignedDaysBadge({ days }) {
  if (days == null) return null;
  if (days === 0) {
    return (
      <span className="inline-flex whitespace-nowrap rounded-md bg-green-100 px-2 py-0.5 text-2xs text-green-700 dark:bg-green-900/40 dark:text-green-300">
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
  const label = `${days} 天前分配`;
  return <span className={`inline-flex whitespace-nowrap rounded-md px-2 py-0.5 text-2xs ${cls}`}>{label}</span>;
}
