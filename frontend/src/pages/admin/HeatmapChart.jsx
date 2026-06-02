import { useMemo } from 'react';

// 热力色阶：0 → 浅，N → 深
function getHeatColor(value, max) {
  if (value === 0) return 'bg-gray-100 dark:bg-gray-700';
  const ratio = max > 0 ? value / max : 0;
  if (ratio < 0.2) return 'bg-blue-100 dark:bg-blue-900/40';
  if (ratio < 0.4) return 'bg-blue-200 dark:bg-blue-800/50';
  if (ratio < 0.6) return 'bg-blue-300 dark:bg-blue-700/60';
  if (ratio < 0.8) return 'bg-blue-400 dark:bg-blue-600/70';
  return 'bg-blue-600 dark:bg-blue-500/80';
}

export default function HeatmapChart({ data }) {
  const { agents, dates, matrix, maxVal } = useMemo(() => {
    if (!data || !data.agents || data.agents.length === 0) {
      return { agents: [], dates: [], matrix: [], maxVal: 0 };
    }
    const m = data.data || [];
    let max = 0;
    for (const row of m) {
      for (const v of row) {
        if (v > max) max = v;
      }
    }
    return {
      agents: data.agents,
      dates: data.dates || [],
      matrix: m,
      maxVal: max,
    };
  }, [data]);

  if (!agents.length || !dates.length) {
    return <div className="text-center text-gray-400 py-8">暂无数据</div>;
  }

  // 只显示日期的月-日部分，缩短显示
  const shortDate = (d) => {
    const parts = d.split('-');
    return parts.length >= 3 ? `${parts[1]}-${parts[2]}` : d;
  };

  return (
    <div className="overflow-x-auto">
      <div className="inline-block min-w-full">
        {/* 日期标题行 */}
        <div className="flex">
          <div className="w-20 shrink-0" />
          {dates.map((d, i) => (
            <div
              key={i}
              className="w-8 text-center text-[10px] text-gray-500 dark:text-gray-400 -rotate-45 origin-bottom-left h-8"
              title={d}
            >
              {shortDate(d)}
            </div>
          ))}
        </div>

        {/* 数据行 */}
        {agents.map((agent, ai) => (
          <div key={agent} className="flex items-center h-7">
            <div className="w-20 text-xs text-gray-600 dark:text-gray-400 truncate pr-1 shrink-0" title={agent}>
              {agent}
            </div>
            {dates.map((_, di) => {
              const val = matrix[ai]?.[di] || 0;
              return (
                <div
                  key={di}
                  className={`w-7 h-5 m-0.5 rounded-sm ${getHeatColor(val, maxVal)} flex items-center justify-center cursor-default`}
                  title={`${agent} ${dates[di]}: ${val} 通`}
                >
                  {val > 0 && (
                    <span className="text-[9px] font-medium text-gray-700 dark:text-gray-200">
                      {val}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        ))}

        {/* 图例 */}
        <div className="flex items-center gap-1 mt-2 ml-20">
          <span className="text-[10px] text-gray-400 mr-1">少</span>
          {[0, 0.2, 0.4, 0.6, 0.8].map((r) => {
            const val = Math.round(maxVal * r);
            return (
              <div
                key={r}
                className={`w-4 h-3 rounded-sm ${getHeatColor(val, maxVal)}`}
              />
            );
          })}
          <span className="text-[10px] text-gray-400 ml-1">多</span>
        </div>
      </div>
    </div>
  );
}
