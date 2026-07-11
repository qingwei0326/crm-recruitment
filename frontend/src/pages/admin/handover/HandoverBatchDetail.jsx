import { AlertTriangle, ArrowRightLeft, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import HandoverFilters from './HandoverFilters';
import HandoverStudentTable from './HandoverStudentTable';

const fieldClass =
  'min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

export default function HandoverBatchDetail({
  batchId,
  detail,
  loading,
  error,
  conflictMessage,
  resultNotice,
  filterValues,
  onFilterChange,
  onFilterReset,
  onRetry,
  selected,
  onToggle,
  onToggleAll,
  targetAgentId,
  onTargetAgentChange,
  targetAgents,
  previewing,
  onPreviewSelected,
  onPreviewAll,
  canTransferAll,
  onPageChange,
}) {
  if (!batchId) {
    return (
      <div className="flex min-h-[420px] items-center justify-center text-sm text-gray-400">
        选择左侧批次查看待交接学生
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-[520px] animate-pulse p-5" aria-label="正在加载交接详情">
        <div className="h-6 w-48 rounded bg-gray-200 dark:bg-gray-700" />
        <div className="mt-5 h-20 rounded bg-gray-100 dark:bg-gray-800" />
        <div className="mt-4 h-72 rounded bg-gray-100 dark:bg-gray-800" />
      </div>
    );
  }

  if (error || !detail) {
    return (
      <div className="flex min-h-[420px] flex-col items-center justify-center text-center">
        <AlertTriangle className="h-6 w-6 text-red-500" aria-hidden="true" />
        <p className="mt-2 text-sm text-red-600 dark:text-red-400">交接详情加载失败</p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 text-sm text-gray-700 dark:border-gray-600 dark:text-gray-200"
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />重试
        </button>
      </div>
    );
  }

  const { batch } = detail;
  const completed = batch.status === 'completed' || batch.remaining === 0;
  const totalPages = Math.max(Math.ceil(detail.total / Math.max(detail.pageSize, 1)), 1);

  return (
    <section className="min-w-0 bg-white dark:bg-gray-900" aria-label="交接批次详情">
      <div className="px-4 py-4 lg:px-5">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {batch.sourceAgent.name || `员工 #${batch.sourceAgent.id}`} 的交接
              </h2>
              <span className={`rounded px-2 py-0.5 text-xs ${
                completed
                  ? 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
              }`}>
                {completed ? '已完成' : `剩余 ${batch.remaining} / ${batch.total}`}
              </span>
            </div>
            <p className="mt-1 text-xs text-gray-400">批次 #{batch.id} · 版本 {batch.version}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-2 sm:w-[260px]">
            <label htmlFor="handover-target" className="text-xs font-medium text-gray-500 dark:text-gray-400">
              接手员工
            </label>
            <select
              id="handover-target"
              value={targetAgentId}
              onChange={(event) => onTargetAgentChange(event.target.value)}
              disabled={completed}
              className={fieldClass}
            >
              <option value="">选择在职员工</option>
              {targetAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
            </select>
          </div>
        </div>

        {conflictMessage && (
          <div role="alert" className="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            {conflictMessage}
          </div>
        )}
        {resultNotice && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-900/30 dark:text-green-200">
            <span>{resultNotice.message}</span>
            <Link to={`/admin/audit-logs?batch_id=${resultNotice.transferId}`} className="font-medium underline underline-offset-2">
              查看操作记录
            </Link>
          </div>
        )}

        <HandoverFilters
          values={filterValues}
          options={detail.filterOptions}
          onChange={onFilterChange}
          onReset={onFilterReset}
        />

        <div className="flex flex-col gap-2 border-b py-3 dark:border-gray-700 sm:flex-row sm:items-center">
          <div className="text-sm text-gray-500 dark:text-gray-400 sm:mr-auto">
            已选 {selected.size} 条，共 {detail.total} 条
          </div>
          <button
            type="button"
            onClick={onPreviewSelected}
            disabled={completed || selected.size === 0 || !targetAgentId || previewing}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-blue-300 px-3 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-900/20"
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
            转派所选
          </button>
          <button
            type="button"
            onClick={onPreviewAll}
            title={!canTransferAll ? '全部接手需要超级管理员权限' : '预览全部剩余学生'}
            disabled={completed || batch.remaining === 0 || !targetAgentId || previewing || !canTransferAll}
            className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
            全部接手
          </button>
        </div>
      </div>

      <HandoverStudentTable
        items={detail.items}
        selected={selected}
        onToggle={onToggle}
        onToggleAll={onToggleAll}
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-end gap-2 px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
          <button
            type="button"
            title="上一页"
            aria-label="上一页"
            disabled={detail.page <= 1}
            onClick={() => onPageChange(detail.page - 1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border disabled:opacity-40 dark:border-gray-600"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <span>{detail.page} / {totalPages}</span>
          <button
            type="button"
            title="下一页"
            aria-label="下一页"
            disabled={detail.page >= totalPages}
            onClick={() => onPageChange(detail.page + 1)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border disabled:opacity-40 dark:border-gray-600"
          >
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}
    </section>
  );
}
