import { formatDuration } from '../../../utils';

export default function AgentStatsSummary({ stats }) {
  const items = [
    { label: '今日拨打', value: stats?.today_calls ?? 0 },
    { label: '今日有效', value: stats?.today_recorded_calls ?? 0 },
    { label: '今日未记录', value: stats?.today_unrecorded_calls ?? 0 },
    { label: '本月拨打', value: stats?.month_calls ?? 0 },
    { label: '本月有效', value: stats?.month_recorded_calls ?? stats?.recorded_calls ?? 0 },
    { label: '本月未记录', value: stats?.month_unrecorded_calls ?? stats?.unrecorded_calls ?? 0 },
    { label: '今日A', value: stats?.today_a_count ?? 0 },
    { label: '本月A', value: stats?.month_a_count ?? 0 },
    { label: '转化率', value: `${stats?.conversion_rate ?? 0}%` },
    { label: '平均有效通话', value: formatDuration(stats?.avg_duration_seconds) },
  ];

  return (
    <section className="bg-white dark:bg-gray-800 border-b dark:border-gray-700 px-4 py-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-gray-700 dark:text-gray-200">我的任务总览</h3>
        <span className="text-[11px] text-gray-400 dark:text-gray-500">全局业绩，不随筛选变化</span>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-2">
        {items.map((item) => (
          <div key={item.label} className="rounded-lg bg-gray-50 dark:bg-gray-900 px-3 py-2">
            <div className="text-lg font-bold text-gray-900 dark:text-gray-100">{item.value}</div>
            <div className="text-[11px] text-gray-500 dark:text-gray-400">{item.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
