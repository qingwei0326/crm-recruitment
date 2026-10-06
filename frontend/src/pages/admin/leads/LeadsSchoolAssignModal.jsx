import { X } from 'lucide-react';
import { inputCls, schoolPlaceholder } from '../leadsManageUtils';

export default function LeadsSchoolAssignModal({
  loading,
  listLoading,
  dispatchRegions,
  selectedRegions,
  schools,
  school,
  agents,
  selectedAgents,
  onClose,
  onToggleRegion,
  onSchoolChange,
  onToggleAgent,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-panel shadow-xl w-full max-w-md p-6 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">按学校分发学生</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          {/* Select regions */}
          <div>
            <label className="block text-sm mb-1 font-medium">
              选择区县（多选）
              {!loading && dispatchRegions.length > 0 && (
                <span className="ml-2 text-xs text-gray-500 font-normal">
                  共 {dispatchRegions.length} 个区县 · {dispatchRegions.reduce((s, r) => s + (r.count || 0), 0)} 人
                </span>
              )}
            </label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto border dark:border-gray-600 rounded-lg p-2">
              {loading && (
                <div className="text-sm text-gray-400 px-2 py-1">加载区县中...</div>
              )}
              {!loading && dispatchRegions.length === 0 && (
                <div className="text-sm text-gray-400 px-2 py-1">暂无可分发的区县</div>
              )}
              {!loading &&
                dispatchRegions.map((r) => (
                  <label
                    key={r.name}
                    className="flex items-center gap-2 text-sm cursor-pointer px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedRegions.includes(r.name)}
                      onChange={(e) => onToggleRegion(r.name, e.target.checked)}
                      className="accent-blue-500"
                    />
                    {r.name} ({r.count}人)
                  </label>
                ))}
            </div>
            {selectedRegions.length > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                已选 {selectedRegions.length} 个区县
              </div>
            )}
          </div>

          {/* Select school */}
          <div>
            <label className="block text-sm mb-1 font-medium">选择学校</label>
            <select
              aria-label="选择学校"
              value={school}
              onChange={(e) => onSchoolChange(e.target.value)}
              className={inputCls}
              disabled={selectedRegions.length === 0 || listLoading}
            >
              <option value="">{schoolPlaceholder(selectedRegions, listLoading, schools)}</option>
              {!listLoading &&
                schools.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.count}人)
                  </option>
                ))}
            </select>
          </div>

          {/* Select agents */}
          <div>
            <label className="block text-sm mb-1 font-medium">选择话务员（多选）</label>
            <div className="space-y-1.5 max-h-40 overflow-y-auto border dark:border-gray-600 rounded-lg p-2">
              {agents.map((a) => (
                <label key={a.id} className="flex items-center gap-2 text-sm cursor-pointer px-2 py-1 hover:bg-gray-50 dark:hover:bg-gray-700 rounded">
                  <input
                    type="checkbox"
                    checked={selectedAgents.includes(a.id)}
                    onChange={(e) => onToggleAgent(a.id, e.target.checked)}
                    className="accent-blue-500"
                  />
                  {a.name}
                </label>
              ))}
              {agents.length === 0 && (
                <div className="text-sm text-gray-400 px-2 py-1">暂无可分发的话务员</div>
              )}
            </div>
            {selectedAgents.length > 0 && (
              <div className="text-xs text-gray-500 mt-1">
                已选 {selectedAgents.length} 人
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={onSubmit}
            disabled={
              loading ||
              listLoading ||
              selectedRegions.length === 0 ||
              !school ||
              selectedAgents.length === 0
            }
            className="w-full py-2.5 bg-teal-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            开始分发
          </button>
        </div>
      </div>
    </div>
  );
}
