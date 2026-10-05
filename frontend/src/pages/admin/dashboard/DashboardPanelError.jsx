import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function DashboardPanelError({ title, onRetry, retrying = false, compact = false }) {
  return (
    <div
      role="alert"
      className={`rounded-lg border border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200 ${compact ? 'p-2.5' : 'p-3'}`}
    >
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1 text-xs font-medium">{title}加载失败</span>
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          aria-label={`重试${title}`}
          className="inline-flex h-7 items-center gap-1 rounded px-2 text-2xs font-medium hover:bg-amber-100 disabled:opacity-60 dark:hover:bg-amber-900/40"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
          {retrying ? '重试中' : '重试'}
        </button>
      </div>
    </div>
  );
}
