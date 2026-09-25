import { X } from 'lucide-react';
import { inputCls } from '../leadsManageUtils';

export default function LeadsAssignModal({
  selectedCount,
  selectedStudents,
  selectedEnrolledStudents,
  agents,
  agentId,
  selectedAgentName,
  overrideReason,
  canOverrideCapacity,
  onClose,
  onAgentChange,
  onReasonChange,
  onSubmit,
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">批量分配</h3>
          <button type="button" onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-3">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-900/40 px-3 py-2 text-sm text-gray-600 dark:text-gray-300">
            已选择 <b>{selectedCount}</b> 名学生
            {selectedStudents.length > 0 && (
              <div className="mt-1 text-xs text-gray-500">
                将影响：{selectedStudents.slice(0, 3).map((student) => student.name).join('、')}
                {selectedStudents.length > 3 ? ` 等 ${selectedStudents.length} 人` : ''}
              </div>
            )}
          </div>
          <select aria-label="选择批量分配话务员" value={agentId} onChange={(e) => onAgentChange(e.target.value)} className={inputCls}>
            <option value="">选择话务员</option>
            {agents.map((a) => (<option key={a.id} value={a.id}>{a.name}</option>))}
          </select>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            确认后会把已选学生分配给「{selectedAgentName || '未选择'}」，原坐席将不再处理这些线索。
          </div>
          {canOverrideCapacity && (
            <label className="block text-sm text-gray-700 dark:text-gray-200">
              超容量强制分配原因（可选）
              <textarea
                aria-label="超容量强制分配原因"
                value={overrideReason}
                onChange={(e) => onReasonChange(e.target.value)}
                maxLength={200}
                rows={2}
                placeholder="仅在确需突破今日容量时填写"
                className={`${inputCls} mt-1 resize-none`}
              />
            </label>
          )}
          {selectedEnrolledStudents.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900/50 dark:bg-red-900/20 dark:text-red-300">
              已选中 {selectedEnrolledStudents.length} 名已报名学生，不能重新分配：
              {selectedEnrolledStudents.slice(0, 3).map((student) => student.name).join('、')}
              {selectedEnrolledStudents.length > 3 ? ' 等' : ''}
            </div>
          )}
          <button
            type="button"
            onClick={onSubmit}
            disabled={!agentId || selectedEnrolledStudents.length > 0}
            className="w-full py-2.5 bg-green-600 text-white rounded-lg text-sm disabled:opacity-50"
          >
            确认分配
          </button>
        </div>
      </div>
    </div>
  );
}
