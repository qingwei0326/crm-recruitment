import { useState } from 'react';
import { ChevronDown, Flame, Search, SlidersHorizontal, X } from 'lucide-react';
import { STAGES } from '../../../labels';

const STATUS_OPTIONS = ['未联系', '已联系', '未接', '待回访', '已报名', '无效'];

export default function FilterPanel({
  students = [],
  schoolGroups = [],
  selectedSchool,
  onSchoolChange,
  selectedStage,
  onStageChange,
  selectedIntent,
  onIntentChange,
  scoreRange,
  onScoreRangeChange,
  selectedStatus,
  onStatusChange,
  searchQuery,
  onSearchChange,
  totalCount,
  queueTotal,
  intentCounts = {},
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const hasScoreFilter = scoreRange.min !== '' || scoreRange.max !== '';
  const hasAdvancedFilters = selectedStage || selectedIntent || selectedStatus || hasScoreFilter;
  const hasFilters = searchQuery || selectedSchool || hasAdvancedFilters;
  const groupedCount = schoolGroups.reduce((sum, group) => sum + (Number(group.count) || 0), 0);
  const allCount = Math.max(
    students.length,
    groupedCount,
    Number(totalCount) || 0,
    Number(queueTotal) || 0,
  );
  const aCount = Number.isFinite(Number(intentCounts.A))
    ? Number(intentCounts.A)
    : students.filter((student) => student.intent_level === 'A').length;

  const clearFilters = () => {
    onSearchChange?.('');
    onSchoolChange(null);
    onStageChange(null);
    onIntentChange(null);
    onStatusChange?.(null);
    onScoreRangeChange({ min: '', max: '' });
  };

  return (
    <section className="shrink-0 border-b border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="group relative min-w-[260px] max-w-xl flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-blue-600" />
          <input
            type="search"
            value={searchQuery || ''}
            onChange={(event) => onSearchChange?.(event.target.value)}
            placeholder="搜索姓名、电话或学校"
            aria-label="搜索学生"
            className="h-10 w-full rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-9 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10 dark:border-gray-700 dark:bg-gray-950 dark:text-gray-100 dark:focus:border-blue-500 dark:focus:bg-gray-900"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange?.('')}
              className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200"
              aria-label="清空搜索"
              title="清空搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setAdvancedOpen((value) => !value)}
          className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition ${
            advancedOpen || hasAdvancedFilters
              ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
              : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800'
          }`}
          aria-expanded={advancedOpen}
        >
          <SlidersHorizontal className="h-4 w-4" />
          筛选
          {hasAdvancedFilters && <span className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} />
        </button>

        <div className="shrink-0 text-right">
          <div className="text-2xs text-gray-400 dark:text-gray-500">当前结果</div>
          <div className="text-sm font-bold tabular-nums text-gray-800 dark:text-gray-100">{totalCount ?? 0}</div>
        </div>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto px-4 pb-3 scroll-thin" aria-label="学校筛选">
        <div className="flex shrink-0 items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-700 dark:bg-gray-800/60" aria-label="任务队列">
          <button
            type="button"
            onClick={() => onIntentChange?.(null)}
            aria-pressed={!selectedIntent}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
              !selectedIntent
                ? 'bg-white text-blue-700 shadow-sm dark:bg-gray-900 dark:text-blue-300'
                : 'text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-100'
            }`}
          >
            全部任务 <span className="tabular-nums opacity-70">{allCount}</span>
          </button>
          <button
            type="button"
            onClick={() => onIntentChange?.(selectedIntent === 'A' ? null : 'A')}
            aria-pressed={selectedIntent === 'A'}
            className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition ${
              selectedIntent === 'A'
                ? 'bg-red-600 text-white shadow-sm'
                : 'text-red-600 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30'
            }`}
          >
            <Flame className="h-3.5 w-3.5" />
            A级优先 <span className="tabular-nums opacity-80">{aCount}</span>
          </button>
        </div>
        <button
          type="button"
          onClick={() => onSchoolChange(null)}
          className={`h-8 shrink-0 rounded-lg border px-3 text-xs font-semibold transition ${
            !selectedSchool
              ? 'border-blue-600 bg-blue-600 text-white'
              : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300'
          }`}
        >
          全部学校 <span className="ml-1 tabular-nums opacity-70">{allCount}</span>
        </button>
        {schoolGroups.map((group) => {
          const schoolName = group.name || '未知学校';
          const active = selectedSchool === schoolName;
          return (
            <button
              key={schoolName}
              type="button"
              onClick={() => onSchoolChange(active ? null : schoolName)}
              className={`h-8 max-w-[190px] shrink-0 rounded-lg border px-3 text-xs font-medium transition ${
                active
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-gray-200 bg-gray-50 text-gray-600 hover:border-blue-200 hover:text-blue-700 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-300 dark:hover:border-blue-800 dark:hover:text-blue-300'
              }`}
              title={schoolName}
            >
              <span className="inline-block max-w-[130px] truncate align-bottom">{schoolName}</span>
              <span className="ml-1 tabular-nums opacity-65">{group.count ?? 0}</span>
            </button>
          );
        })}
      </div>

      {advancedOpen && (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-3 dark:border-gray-800 dark:bg-gray-950/40">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(150px,1fr)_minmax(130px,0.8fr)_minmax(150px,1fr)_minmax(220px,1.2fr)_auto] lg:items-end">
            <FilterSelect label="阶段" value={selectedStage} onChange={onStageChange}>
              <option value="">全部阶段</option>
              {STAGES.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
            </FilterSelect>

            <FilterSelect label="意向" value={selectedIntent} onChange={onIntentChange}>
              <option value="">全部意向</option>
              <option value="A">A级</option>
              <option value="B">B级</option>
              <option value="C">C级</option>
              <option value="无">未评级</option>
            </FilterSelect>

            <FilterSelect label="状态" value={selectedStatus} onChange={onStatusChange}>
              <option value="">全部状态</option>
              {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
            </FilterSelect>

            <div>
              <label className="mb-1 block text-2xs font-medium text-gray-500 dark:text-gray-400">成绩范围</label>
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <input
                  aria-label="最低分"
                  type="number"
                  value={scoreRange.min}
                  onChange={(event) => onScoreRangeChange({ ...scoreRange, min: event.target.value })}
                  placeholder="最低"
                  className="h-9 min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
                <span className="text-xs text-gray-400">至</span>
                <input
                  aria-label="最高分"
                  type="number"
                  value={scoreRange.max}
                  onChange={(event) => onScoreRangeChange({ ...scoreRange, max: event.target.value })}
                  placeholder="最高"
                  className="h-9 min-w-0 rounded-lg border border-gray-200 bg-white px-2 text-sm outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={clearFilters}
              disabled={!hasFilters}
              className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium text-gray-500 transition hover:bg-gray-200 hover:text-gray-800 disabled:pointer-events-none disabled:opacity-35 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
            >
              <X className="h-3.5 w-3.5" />
              清除筛选
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function FilterSelect({ label, value, onChange, children }) {
  return (
    <label>
      <span className="mb-1 block text-2xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
      <select
        aria-label={`按${label}筛选`}
        value={value || ''}
        onChange={(event) => onChange?.(event.target.value || null)}
        className="h-9 w-full rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700 outline-none focus:border-blue-500 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
      >
        {children}
      </select>
    </label>
  );
}
