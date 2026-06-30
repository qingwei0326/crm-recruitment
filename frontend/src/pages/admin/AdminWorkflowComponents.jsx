import { Link } from 'react-router-dom';
import { ArrowRight, AlertTriangle, CheckCircle2, Clock3, ExternalLink } from 'lucide-react';

const toneClasses = {
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300',
  amber: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300',
  green: 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300',
  blue: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300',
  gray: 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

function ToneIcon({ tone }) {
  if (tone === 'red' || tone === 'amber') return <AlertTriangle className="w-4 h-4" />;
  if (tone === 'green') return <CheckCircle2 className="w-4 h-4" />;
  return <Clock3 className="w-4 h-4" />;
}

export function ActionCard({ item }) {
  return (
    <Link
      to={item.to}
      className={`group rounded-lg border px-4 py-3 transition hover:shadow-sm ${toneClasses[item.tone] || toneClasses.gray}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-medium">
            <ToneIcon tone={item.tone} />
            {item.title}
          </div>
          <div className="mt-2 text-2xl font-semibold tabular-nums">{item.value}</div>
          <div className="mt-1 text-xs opacity-80">{item.detail}</div>
        </div>
        <ArrowRight className="w-4 h-4 shrink-0 opacity-60 group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}

export function InsightStrip({ items }) {
  return (
    <div className="grid gap-2 lg:grid-cols-3">
      {items.map((item) => (
        <div
          key={`${item.title}-${item.detail}`}
          className={`rounded-lg border px-4 py-3 ${toneClasses[item.tone] || toneClasses.gray}`}
        >
          <div className="flex items-center gap-2 text-xs font-medium">
            <ToneIcon tone={item.tone} />
            {item.title}
          </div>
          <div className="mt-1 text-sm text-gray-700 dark:text-gray-200">{item.detail}</div>
        </div>
      ))}
    </div>
  );
}

export function QueueRow({ title, meta, detail, detailParts = [], tone = 'gray', to, action }) {
  return (
    <div className="rounded-lg border dark:border-gray-700 bg-white dark:bg-gray-800 px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</span>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${toneClasses[tone] || toneClasses.gray}`}>
              {meta}
            </span>
          </div>
          {(detail || detailParts.length > 0) && (
            <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {detail ? <span>{detail}</span> : null}
              {detailParts.map((part) => (
                <span key={part}>{part}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {to && (
            <Link
              to={to}
              className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-gray-200 px-3 text-sm text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              <ExternalLink className="w-4 h-4" />
              查看
            </Link>
          )}
          {action}
        </div>
      </div>
    </div>
  );
}
