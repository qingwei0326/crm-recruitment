import { Link } from 'react-router-dom';

const surface = 'rounded-panel border border-slate-200 bg-white shadow-panel dark:border-slate-700 dark:bg-slate-900 dark:shadow-panel-dark';

function formatCount(value) {
  return Number(value || 0).toLocaleString();
}

// One row of the numbers admins check every day; each opens the list behind it.
export default function KeyNumbers({ cells, loading, error }) {
  return (
    <section aria-label="关键数字" className={`${surface} grid grid-cols-2 divide-x divide-y divide-slate-100 dark:divide-slate-700 sm:grid-cols-3 lg:grid-cols-5 lg:divide-y-0`}>
      {cells.map((cell) => {
        const body = (
          <>
            <div className="text-2xs font-medium text-slate-500 dark:text-slate-400">{cell.label}</div>
            <div className="mt-1 text-xl font-black tabular-nums text-slate-900 dark:text-slate-100">
              {loading ? '—' : error ? '--' : formatCount(cell.value)}
            </div>
            <div className={`mt-0.5 text-3xs ${cell.highlight ? 'font-semibold text-amber-600 dark:text-amber-300' : 'text-slate-400 dark:text-slate-500'}`}>
              {cell.detail}
            </div>
          </>
        );
        return cell.to ? (
          <Link key={cell.key} to={cell.to} aria-label={`${cell.label} ${formatCount(cell.value)}`} className="block px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/60">
            {body}
          </Link>
        ) : (
          <div key={cell.key} className="px-4 py-3">{body}</div>
        );
      })}
    </section>
  );
}
