import { memo } from 'react';

export default memo(function IntentLevelBadge({ level }) {
  const v = level || '无';
  const cls =
    v === 'A'
      ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
      : v === 'B'
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
      : v === 'C'
      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300';
  return (
    <span className={`inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full text-xs font-semibold ${cls}`}>
      {v === '无' ? '无' : v}
    </span>
  );
});
