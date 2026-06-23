import { useMemo } from 'react';

const COLORS = ['#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'];

export default function FunnelChart({ data }) {
  const chartData = useMemo(() => {
    if (!data || !data.stages || data.stages.length === 0) return [];
    const maxVal = data.stages[0].value || 1;
    return data.stages.map((s) => ({
      ...s,
      // 用最大值做百分比，让 bar 宽度呈现漏斗效果
      fillWidth: Math.round((s.value / maxVal) * 100),
    }));
  }, [data]);

  if (!chartData.length) {
    return <div className="text-center text-gray-400 py-8">暂无数据</div>;
  }

  return (
    <div className="space-y-2">
      {chartData.map((stage, i) => {
        const pct = chartData[0].value > 0
          ? ((stage.value / chartData[0].value) * 100).toFixed(1)
          : 0;
        const convPct = i > 0 && chartData[i - 1].value > 0
          ? ((stage.value / chartData[i - 1].value) * 100).toFixed(1)
          : null;

        return (
          <div key={stage.name} className="flex items-center gap-2 sm:gap-3">
            <div className="w-12 sm:w-16 text-right text-xs sm:text-sm text-gray-600 dark:text-gray-400 shrink-0 truncate">
              {stage.name}
            </div>
            <div className="flex-1 relative h-6 sm:h-8 bg-gray-100 dark:bg-gray-700 rounded">
              <div
                className="h-full rounded transition-all duration-500 flex items-center justify-end pr-1 sm:pr-2"
                style={{
                  width: `${stage.fillWidth}%`,
                  backgroundColor: COLORS[i % COLORS.length],
                  minWidth: stage.value > 0 ? '1.5rem' : '0',
                }}
              >
                <span className="text-[10px] sm:text-xs font-medium text-white drop-shadow">
                  {stage.value.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="w-14 sm:w-20 text-right text-[10px] sm:text-xs text-gray-500 dark:text-gray-400 shrink-0">
              {pct}%
              {convPct !== null && (
                <span className="block text-gray-400 dark:text-gray-500">
                  ↓{convPct}%
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
