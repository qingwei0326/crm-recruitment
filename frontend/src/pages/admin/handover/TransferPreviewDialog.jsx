import { AlertTriangle, ArrowRightLeft, X } from 'lucide-react';

const kindLabels = {
  student_follow_up: '学生跟进',
  scheduled_follow_up: '预约回访',
  home_visit: '家访任务',
  campus_visit: '到校任务',
};

export default function TransferPreviewDialog({
  preview,
  mode,
  targetAgent,
  submitting,
  error,
  onCancel,
  onConfirm,
}) {
  if (!preview) return null;
  const students = Array.isArray(preview.students) ? preview.students : [];
  const canConfirm = Boolean(targetAgent?.id) && !submitting && preview.selectedCount > 0;

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="handover-preview-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-xl dark:bg-gray-800"
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-4 dark:border-gray-700">
          <div>
            <h2 id="handover-preview-title" className="text-base font-semibold text-gray-900 dark:text-gray-100">
              确认交接预览
            </h2>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {mode === 'all_remaining' ? '全部剩余学生' : '转派所选学生'} → {targetAgent?.name || '未选择接手员工'}
            </p>
          </div>
          <button
            type="button"
            title="关闭预览"
            aria-label="关闭预览"
            onClick={onCancel}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </header>

        <div className="px-5 py-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-b pb-4 text-sm dark:border-gray-700 sm:grid-cols-4">
            <div><div className="text-xs text-gray-400">学生</div><strong>{preview.selectedCount}</strong></div>
            <div><div className="text-xs text-gray-400">开放工作项</div><strong>{preview.openWorkItemCount}</strong></div>
            <div><div className="text-xs text-gray-400">逾期</div><strong className={preview.overdueCount ? 'text-red-600' : ''}>{preview.overdueCount}</strong></div>
            <div><div className="text-xs text-gray-400">A 级意向</div><strong>{preview.highIntentCount}</strong></div>
          </div>

          {students.length > 0 && (
            <div className="border-b py-4 dark:border-gray-700">
              <div className="text-xs font-medium text-gray-500 dark:text-gray-400">本次所选</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {students.slice(0, 8).map((student) => (
                  <span key={student.studentId} className="rounded bg-gray-100 px-2 py-1 text-xs text-gray-700 dark:bg-gray-700 dark:text-gray-200">
                    {student.name}
                  </span>
                ))}
                {students.length > 8 && <span className="px-2 py-1 text-xs text-gray-400">另 {students.length - 8} 人</span>}
              </div>
            </div>
          )}

          <div className="py-4">
            <div className="text-xs font-medium text-gray-500 dark:text-gray-400">工作项构成</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(preview.byKind || {}).length ? Object.entries(preview.byKind).map(([kind, count]) => (
                <span key={kind} className="rounded border px-2 py-1 text-xs text-gray-700 dark:border-gray-600 dark:text-gray-200">
                  {kindLabels[kind] || kind} {count}
                </span>
              )) : <span className="text-xs text-gray-400">无开放工作项</span>}
            </div>
          </div>

          {error && (
            <div className="flex gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t px-5 py-4 dark:border-gray-700">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-10 rounded-lg border px-4 text-sm font-medium text-gray-700 dark:border-gray-600 dark:text-gray-200"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!canConfirm}
            onClick={onConfirm}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowRightLeft className="h-4 w-4" aria-hidden="true" />
            {submitting ? '正在交接...' : error ? '使用同一请求重试' : '确认交接'}
          </button>
        </footer>
      </section>
    </div>
  );
}
