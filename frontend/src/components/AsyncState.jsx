import { AlertTriangle, Inbox, Loader2, RotateCcw } from 'lucide-react';

export function ContentSkeleton({ rows = 3, compact = false, className = '' }) {
  return (
    <div className={`space-y-3 ${className}`} role="status" aria-label="内容加载中">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          className={`animate-pulse rounded-panel border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800 ${compact ? 'h-20' : 'h-28'}`}
        >
          <div className="h-4 w-1/3 rounded bg-slate-200 dark:bg-slate-700" />
          <div className="mt-3 h-3 w-2/3 rounded bg-slate-100 dark:bg-slate-700/70" />
          <div className="mt-2 h-3 w-1/2 rounded bg-slate-100 dark:bg-slate-700/70" />
        </div>
      ))}
      <span className="sr-only">正在加载，请稍候</span>
    </div>
  );
}

export function EmptyState({
  title = '暂无内容',
  description = '当前没有需要处理的项目。',
  actionLabel,
  onAction,
  icon: Icon = Inbox,
  className = '',
}) {
  return (
    <div className={`rounded-panel border border-dashed border-slate-300 bg-white px-5 py-10 text-center dark:border-slate-700 dark:bg-slate-800 ${className}`}>
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-slate-400 dark:bg-slate-700 dark:text-slate-300">
        <Icon className="h-5 w-5" />
      </div>
      <h3 className="mt-3 text-sm font-semibold text-slate-800 dark:text-slate-100">{title}</h3>
      <p className="mx-auto mt-1 max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
      {actionLabel && onAction ? (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex min-h-10 items-center justify-center rounded-panel border border-slate-200 bg-white px-4 text-sm font-medium text-slate-700 shadow-sm active:scale-95 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
        >
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ErrorState({
  title = '加载失败',
  message = '网络开小差了，请稍后重试。',
  onRetry,
  className = '',
}) {
  return (
    <div role="alert" className={`rounded-panel border border-red-200 bg-red-50 px-5 py-8 text-center dark:border-red-900/70 dark:bg-red-950/30 ${className}`}>
      <AlertTriangle className="mx-auto h-7 w-7 text-red-500" />
      <h3 className="mt-3 text-sm font-semibold text-red-800 dark:text-red-200">{title}</h3>
      <p className="mt-1 text-xs leading-5 text-red-600 dark:text-red-300">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-panel bg-red-600 px-4 text-sm font-semibold text-white active:scale-95"
        >
          <RotateCcw className="h-4 w-4" />
          重新加载
        </button>
      ) : null}
    </div>
  );
}

export function InlineSaving({ label = '保存中…' }) {
  return (
    <span className="inline-flex items-center gap-1.5" role="status">
      <Loader2 className="h-4 w-4 animate-spin" />
      {label}
    </span>
  );
}
