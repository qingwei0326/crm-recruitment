import { useState } from 'react';
import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { STAGES } from '../../../labels';

export default function FilterPanel({
  schoolGroups, selectedSchool, onSchoolChange,
  selectedStage, onStageChange,
  selectedIntent, onIntentChange,
  scoreRange, onScoreRangeChange,
  totalCount,
}) {
  const [open, setOpen] = useState(true);
  const hasScoreFilter = scoreRange.min !== '' || scoreRange.max !== '';
  const hasFilters = selectedSchool || selectedStage || selectedIntent || hasScoreFilter;

  return (
    <div className="bg-white dark:bg-gray-800 border-b dark:border-gray-700">
      {/* Summary bar — always visible */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
      >
        <div className="flex items-center gap-2">
          {open ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
          <span className="font-medium text-gray-700 dark:text-gray-200">条件筛选</span>
          {hasFilters && (
            <span className="px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 text-[10px] font-medium">
              已筛选
            </span>
          )}
        </div>
        <span className="text-xs text-gray-500">
          数据总数 <span className="font-medium text-gray-700 dark:text-gray-200">{totalCount}</span>
        </span>
      </button>

      {/* Expanded filter controls */}
      {open && (
        <div className="px-4 pb-3 space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* School filter */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">学校</label>
              <select
                aria-label="按学校筛选"
                value={selectedSchool || ''}
                onChange={(e) => onSchoolChange(e.target.value || null)}
                className="w-full min-h-9 px-2 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">全部学校</option>
                {schoolGroups.map((g) => (
                  <option key={g.name} value={g.name}>
                    {g.name || '未知学校'} ({g.count})
                  </option>
                ))}
              </select>
            </div>

            {/* Stage filter */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">阶段</label>
              <select
                aria-label="按阶段筛选"
                value={selectedStage || ''}
                onChange={(e) => onStageChange(e.target.value || null)}
                className="w-full min-h-9 px-2 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">全部阶段</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>

            {/* Intent filter */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">意向</label>
              <select
                aria-label="按意向筛选"
                value={selectedIntent || ''}
                onChange={(e) => onIntentChange(e.target.value || null)}
                className="w-full min-h-9 px-2 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100"
              >
                <option value="">全部</option>
                <option value="A">A级</option>
                <option value="B">B级</option>
                <option value="C">C级</option>
                <option value="无">未评级</option>
              </select>
            </div>

            {/* Score filter */}
            <div>
              <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">分数范围</label>
              <div className="flex items-center gap-1.5">
                <input
                  aria-label="最低分"
                  type="number"
                  value={scoreRange.min}
                  onChange={(e) => onScoreRangeChange({ ...scoreRange, min: e.target.value })}
                  placeholder="最低"
                  className="w-full min-h-9 px-2 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                />
                <span className="text-gray-400 text-xs">-</span>
                <input
                  aria-label="最高分"
                  type="number"
                  value={scoreRange.max}
                  onChange={(e) => onScoreRangeChange({ ...scoreRange, max: e.target.value })}
                  placeholder="最高"
                  className="w-full min-h-9 px-2 py-2 border dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400"
                />
              </div>
            </div>
          </div>

          {/* Clear all */}
          {hasFilters && (
            <button
              onClick={() => {
                onSchoolChange(null);
                onStageChange(null);
                onIntentChange(null);
                onScoreRangeChange({ min: '', max: '' });
              }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              清除所有筛选
            </button>
          )}
        </div>
      )}
    </div>
  );
}
