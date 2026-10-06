import { CheckCircle2 } from 'lucide-react';
import { ContentSkeleton, EmptyState, ErrorState } from '../../../components/AsyncState';

const statusMeta = {
  pending: { label: '待交接', className: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
  in_progress: { label: '交接中', className: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' },
  completed: { label: '已完成', className: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
};

export default function HandoverBatchList({
  batches = [],
  selectedId,
  loading,
  error,
  onSelect,
  onRetry,
}) {
  if (loading) {
    return <ContentSkeleton rows={3} compact className="p-3" />;
  }

  if (error) {
    return (
      <ErrorState
        bare
        title="交接批次加载失败"
        message="请稍后重试。"
        retryLabel="重试"
        onRetry={onRetry}
      />
    );
  }

  if (batches.length === 0) {
    return <EmptyState bare title="暂无离职交接批次" />;
  }

  return (
    <div className="divide-y dark:divide-gray-700" aria-label="交接批次列表">
      {batches.map((batch) => {
        const meta = statusMeta[batch.status] || statusMeta.pending;
        const selected = batch.id === selectedId;
        return (
          <button
            key={batch.id}
            type="button"
            onClick={() => onSelect(batch.id)}
            aria-current={selected ? 'true' : undefined}
            className={`min-h-[88px] w-full px-4 py-3 text-left transition-colors ${
              selected
                ? 'bg-blue-50 dark:bg-blue-900/20'
                : 'bg-white hover:bg-gray-50 dark:bg-gray-800 dark:hover:bg-gray-700/60'
            }`}
          >
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                {batch.sourceAgent.name || `员工 #${batch.sourceAgent.id}`}
              </span>
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs ${meta.className}`}>
                {batch.status === 'completed' && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
                {meta.label}
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
              <span>剩余 {batch.remaining} / {batch.total}</span>
              <span>已转 {batch.transferred}</span>
            </div>
            <div className="mt-1 truncate text-xs text-gray-400">
              {batch.initiatedAt || `批次 #${batch.id}`}
            </div>
          </button>
        );
      })}
    </div>
  );
}
