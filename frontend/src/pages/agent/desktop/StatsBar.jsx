import { CalendarClock, CheckCircle2, Clock3, Target } from 'lucide-react';

const STAT_ITEMS = [
  { key: 'total', label: '总任务', icon: Target, tone: 'text-blue-600 dark:text-blue-400' },
  { key: 'done', label: '已完成', icon: CheckCircle2, tone: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'pending', label: '待联系', icon: Clock3, tone: 'text-amber-600 dark:text-amber-400' },
  { key: 'follow_up', label: '待回访', icon: CalendarClock, tone: 'text-indigo-600 dark:text-indigo-400' },
];

export default function StatsBar({ stats, variant = 'full' }) {
  const safeStats = stats || {};
  const progress = Math.min(Math.max(Number(safeStats.progress_pct) || 0, 0), 100);

  if (variant === 'compact') {
    return (
      <div className="grid grid-cols-4 divide-x divide-gray-100 px-3 py-2 dark:divide-gray-800">
        {STAT_ITEMS.map((item) => (
          <div key={item.key} className="px-2 text-center">
            <div className={`text-base font-bold tabular-nums ${item.tone}`}>{safeStats[item.key] ?? 0}</div>
            <div className="text-[10px] text-gray-500">{item.label}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <section className="shrink-0 border-b border-gray-200 bg-white px-4 py-2.5 dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-5">
        <div className="min-w-[230px] max-w-sm flex-1">
          <div className="mb-1.5 flex items-center justify-between text-[11px] font-medium text-gray-500 dark:text-gray-400">
            <span>今日完成进度</span>
            <span className="font-bold tabular-nums text-blue-600 dark:text-blue-400">{progress}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
            <div
              className="h-full rounded-full bg-blue-600 transition-[width] duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <div className="grid flex-[2] grid-cols-4 divide-x divide-gray-100 dark:divide-gray-800">
          {STAT_ITEMS.map((item) => (
            <div key={item.key} className="flex min-w-0 items-center gap-2.5 px-4 first:pl-0 last:pr-0">
              <item.icon className={`h-4 w-4 shrink-0 ${item.tone}`} />
              <div className="min-w-0">
                <div className="text-sm font-bold tabular-nums text-gray-900 dark:text-gray-100">
                  {safeStats[item.key] ?? 0}
                </div>
                <div className="truncate text-[10px] text-gray-500 dark:text-gray-400">{item.label}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
