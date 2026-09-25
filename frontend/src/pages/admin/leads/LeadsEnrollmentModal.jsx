import { Loader2, X } from 'lucide-react';
import { inputCls } from '../leadsManageUtils';

const FINANCE_FIELDS = [
  ['tuition_list_amount', '标准学费'],
  ['student_subsidy_amount', '学费补贴'],
  ['student_paid_amount', '学生实付'],
  ['external_subsidy_amount', '外部补贴'],
  ['commission_base_amount', '基础佣金'],
  ['commission_subsidy_amount', '佣金补贴'],
];

export default function LeadsEnrollmentModal({
  student,
  form,
  submitting,
  onClose,
  onFieldChange,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">正式报名确认</h3>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              确认后会生成报名记录和结算依据。
            </p>
          </div>
          <button type="button" onClick={onClose} disabled={submitting} aria-label="关闭报名确认">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-4 rounded-lg bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/40">
          <div className="font-medium text-gray-900 dark:text-gray-100">{student.name}</div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            当前负责人：{student.assigned_to ? '已分配' : '未分配'}
          </div>
        </div>
        {!student.assigned_to && (
          <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            请先给学生分配坐席，再进行报名确认。
          </div>
        )}
        <div className="space-y-3">
          <label className="block text-sm">
            报名专业
            <input
              aria-label="报名专业"
              value={form.enrolled_program}
              onChange={(e) => onFieldChange('enrolled_program', e.target.value)}
              className={`${inputCls} mt-1`}
              placeholder="可选"
            />
          </label>
          <label className="block text-sm">
            报名金额
            <input
              aria-label="报名金额"
              type="number"
              min="0"
              value={form.amount}
              onChange={(e) => onFieldChange('amount', e.target.value)}
              className={`${inputCls} mt-1`}
              placeholder="可选"
            />
          </label>
          <div className="border-t pt-3 text-xs font-medium text-gray-500 dark:border-gray-700">
            财务构成（可在报名结算页补充）
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {FINANCE_FIELDS.map(([field, label]) => (
              <label key={field} className="block text-sm">
                {label}
                <input
                  aria-label={label}
                  type="number"
                  min="0"
                  step="0.01"
                  value={form[field]}
                  onChange={(e) => onFieldChange(field, e.target.value)}
                  className={`${inputCls} mt-1`}
                  placeholder="可选"
                />
              </label>
            ))}
          </div>
          <label className="block text-sm">
            报名日期
            <input
              aria-label="报名日期"
              type="date"
              value={form.enrolled_at}
              onChange={(e) => onFieldChange('enrolled_at', e.target.value)}
              className={`${inputCls} mt-1`}
            />
          </label>
          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="min-h-10 flex-1 rounded-lg border border-gray-200 px-3 text-sm text-gray-700 disabled:opacity-50 dark:border-gray-600 dark:text-gray-200"
            >
              取消
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={submitting || !student.assigned_to}
              className="inline-flex min-h-10 flex-1 items-center justify-center gap-1 rounded-lg bg-green-600 px-3 text-sm font-medium text-white disabled:opacity-50"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              确认登记报名
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
