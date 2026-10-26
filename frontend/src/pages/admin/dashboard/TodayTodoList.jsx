import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import DashboardPanelError from './DashboardPanelError';

const surface = 'rounded-panel border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-panel-dark';

function n(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// The one list of things waiting on someone today, with the agents behind each item.
export default function TodayTodoList({ dailyOps, loading, error, onRetry }) {
  const items = (dailyOps?.items || []).filter((item) => n(item.count) > 0);
  return (
    <section aria-label="今日待处理" className={`${surface} p-4 lg:p-5`}>
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">今日待处理</h2>
          <p className="mt-0.5 text-2xs text-slate-500 dark:text-slate-400">按坐席列出还没推进的事项，点开去处理</p>
        </div>
        <span className="text-3xs text-slate-400 dark:text-slate-500">{loading ? '同步中' : `${items.length} 类`}</span>
      </div>
      {error ? (
        <div className="mt-3"><DashboardPanelError title="待处理事项" onRetry={onRetry} retrying={loading} /></div>
      ) : items.length === 0 ? (
        <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-3 text-xs text-emerald-700 dark:bg-emerald-950/35 dark:text-emerald-300">
          {loading ? '正在同步…' : '今天没有待处理事项'}
        </div>
      ) : (
        <ul className="mt-3 grid gap-2 xl:grid-cols-2">
          {items.map((item) => (
            <li
              key={item.key}
              className={`rounded-lg border p-3 ${item.severity === 'high' ? 'border-amber-200 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/30' : 'border-slate-200 bg-slate-50/70 dark:border-slate-700 dark:bg-slate-800/40'}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{item.title}</div>
                  <div className="mt-0.5 text-3xs text-slate-500 dark:text-slate-400">{item.detail}</div>
                </div>
                <strong className="text-lg tabular-nums text-amber-600 dark:text-amber-300">{n(item.count)}</strong>
              </div>
              {item.owners?.length > 0 && (
                <div className="mt-2 grid gap-1 sm:grid-cols-2">
                  {item.owners.slice(0, 4).map((owner) => (
                    <Link
                      key={`${item.key}-${owner.agent_id || owner.agent_name}`}
                      to={owner.to || item.to || '/admin/work-center'}
                      className="flex items-center justify-between rounded bg-white/80 px-2 py-1 text-3xs hover:bg-white dark:bg-slate-900/70 dark:hover:bg-slate-800"
                    >
                      <span className="truncate font-medium text-slate-700 dark:text-slate-200">{owner.agent_name || '未分配'}</span>
                      <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">{n(owner.count)}项 · {n(owner.max_age_days)}天</span>
                    </Link>
                  ))}
                </div>
              )}
              <Link
                to={item.to || '/admin/work-center'}
                className="mt-2 inline-flex items-center gap-1 rounded bg-white px-2 py-1 text-3xs font-medium text-blue-600 dark:bg-slate-900 dark:text-blue-400"
              >
                去处理 <ArrowRight className="h-3 w-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
