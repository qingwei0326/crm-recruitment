export default function StatsBar({ stats, variant = 'full' }) {
  const { total, done, pending, follow_up, progress_pct } = stats;

  if (variant === 'compact') {
    return (
      <div className="grid grid-cols-4 gap-2 px-3 py-2">
        {[
          { label: '总任务', value: total, color: 'text-gray-700 dark:text-gray-200' },
          { label: '已联系', value: done, color: 'text-green-600' },
          { label: '待联系', value: pending, color: 'text-blue-600' },
          { label: '待回访', value: follow_up, color: 'text-amber-600' },
        ].map((item) => (
          <div key={item.label} className="text-center">
            <div className={`text-lg font-bold ${item.color}`}>{item.value ?? 0}</div>
            <div className="text-[10px] text-gray-500">{item.label}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 px-4 py-2 shrink-0 border-b dark:border-gray-700">
      <div className="flex justify-between text-xs text-gray-500 mb-1">
        <span>完成进度</span>
        <span>{progress_pct ?? 0}%</span>
      </div>
      <div className="h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full">
        <div
          className="h-full bg-green-500 rounded-full transition-all"
          style={{ width: `${progress_pct ?? 0}%` }}
        />
      </div>
    </div>
  );
}
