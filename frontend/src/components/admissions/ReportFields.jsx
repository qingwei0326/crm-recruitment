const fieldCls = 'w-full rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-gray-900 dark:text-gray-100';

// The fields the work-group report needs that the student record usually lacks.
export default function ReportFields({ studentName, values, onChange }) {
  return (
    <section className="rounded-lg border border-blue-100 bg-blue-50/70 p-3 dark:border-blue-900/50 dark:bg-blue-900/20">
      <div className="mb-2 text-xs font-semibold text-blue-900 dark:text-blue-100">上报信息</div>
      <div className="mb-2 text-xs text-gray-700 dark:text-gray-200">学生姓名：{studentName || '-'}</div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>家长电话</span>
          <input
            aria-label="家长电话"
            inputMode="tel"
            value={values.phone}
            onChange={(event) => onChange('phone', event.target.value)}
            className={fieldCls}
            placeholder="没有就留空"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>意向专业</span>
          <input
            aria-label="意向专业"
            value={values.program}
            onChange={(event) => onChange('program', event.target.value)}
            className={fieldCls}
            placeholder="如：无人机"
          />
        </label>
        <label className="space-y-1 text-xs font-medium text-gray-600 dark:text-gray-300">
          <span>中考分数</span>
          <input
            aria-label="中考分数"
            inputMode="numeric"
            value={values.score}
            onChange={(event) => onChange('score', event.target.value)}
            className={fieldCls}
            placeholder="如：380"
          />
        </label>
      </div>
    </section>
  );
}
