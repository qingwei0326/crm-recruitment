import { Filter, RotateCcw } from 'lucide-react';

const fieldClass =
  'min-h-10 rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-800 outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';

const kindLabels = {
  lead_contact: '学生跟进',
  student_follow_up: '学生跟进',
  scheduled_follow_up: '预约回访',
  home_visit: '家访',
  campus_visit: '到校参观',
};

export default function HandoverFilters({ values, options, onChange, onReset }) {
  return (
    <div className="border-y border-gray-200 py-3 dark:border-gray-700">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-sm font-medium text-gray-700 dark:text-gray-200">
          <Filter className="h-4 w-4" aria-hidden="true" />
          待交接筛选
        </div>
        <button
          type="button"
          title="清除筛选"
          aria-label="清除筛选"
          onClick={onReset}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
        >
          <RotateCcw className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <input
          type="search"
          value={values.q}
          onChange={(event) => onChange('q', event.target.value)}
          placeholder="姓名、编号、学校、地区"
          aria-label="搜索待交接学生"
          className={`${fieldClass} sm:col-span-2`}
        />
        <select
          value={values.status}
          onChange={(event) => onChange('status', event.target.value)}
          aria-label="交接状态"
          className={fieldClass}
        >
          <option value="">全部交接状态</option>
          <option value="pending">等待接手</option>
          <option value="transferred">已转派</option>
        </select>
        <select
          value={values.overdue}
          onChange={(event) => onChange('overdue', event.target.value)}
          aria-label="逾期状态"
          className={fieldClass}
        >
          <option value="">全部时效</option>
          <option value="true">仅逾期</option>
          <option value="false">未逾期</option>
        </select>
        <select
          value={values.region}
          onChange={(event) => onChange('region', event.target.value)}
          aria-label="地区"
          className={fieldClass}
        >
          <option value="">全部地区</option>
          {options.regions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select
          value={values.school}
          onChange={(event) => onChange('school', event.target.value)}
          aria-label="学校"
          className={fieldClass}
        >
          <option value="">全部学校</option>
          {options.schools.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select
          value={values.intent}
          onChange={(event) => onChange('intent', event.target.value)}
          aria-label="意向等级"
          className={fieldClass}
        >
          <option value="">全部意向</option>
          {options.intents.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <select
          value={values.kind}
          onChange={(event) => onChange('kind', event.target.value)}
          aria-label="工作项类型"
          className={fieldClass}
        >
          <option value="">全部工作项</option>
          {options.kinds.map((item) => (
            <option key={item} value={item}>{kindLabels[item] || item}</option>
          ))}
        </select>
      </div>
    </div>
  );
}
