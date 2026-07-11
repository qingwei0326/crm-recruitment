import { AlertTriangle, HelpCircle } from 'lucide-react';
import { intentBadgeClass, stageLabel, statusBadgeClass, statusLabel } from '../../../labels';

const kindLabels = {
  student_follow_up: '跟进',
  scheduled_follow_up: '回访',
  home_visit: '家访',
  campus_visit: '到校',
};

export default function HandoverStudentTable({ items = [], selected, onToggle, onToggleAll }) {
  const selectable = items.filter((item) => item.handoverStatus === 'pending');
  const selectedVisible = selectable.filter((item) => selected.has(item.studentId)).length;

  if (items.length === 0) {
    return <div className="py-16 text-center text-sm text-gray-400">当前筛选下没有学生</div>;
  }

  return (
    <div className="overflow-x-auto border-b border-gray-200 dark:border-gray-700">
      <table className="w-full min-w-[1040px] table-fixed text-sm">
        <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <tr className="h-11 border-b border-gray-200 dark:border-gray-700">
            <th className="w-12 px-3 text-left">
              <input
                type="checkbox"
                aria-label="选择本页待交接学生"
                checked={selectable.length > 0 && selectedVisible === selectable.length}
                ref={(element) => {
                  if (element) element.indeterminate = selectedVisible > 0 && selectedVisible < selectable.length;
                }}
                onChange={onToggleAll}
                disabled={selectable.length === 0}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
            </th>
            <th className="w-36 px-2 text-left font-medium">学生</th>
            <th className="w-48 px-2 text-left font-medium">学校 / 地区</th>
            <th className="w-48 px-2 text-left font-medium">状态 / 明细</th>
            <th className="w-32 px-2 text-left font-medium">意向 / 阶段</th>
            <th className="w-20 px-2 text-left font-medium">时效</th>
            <th className="w-40 px-2 text-left font-medium">工作项</th>
            <th className="w-28 px-2 text-left font-medium">当前动作</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
          {items.map((item) => {
            const pending = item.handoverStatus === 'pending';
            return (
              <tr key={item.studentId} className="h-[56px] hover:bg-gray-50 dark:hover:bg-gray-800/60">
                <td className="px-3">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${item.name}`}
                    checked={selected.has(item.studentId)}
                    disabled={!pending}
                    onChange={() => onToggle(item.studentId)}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 disabled:opacity-40"
                  />
                </td>
                <td className="px-2">
                  <div className="truncate font-medium text-gray-900 dark:text-gray-100">{item.name}</div>
                  <div className="truncate text-xs text-gray-400">{item.caseNo || `#${item.studentId}`}</div>
                </td>
                <td className="px-2 text-xs text-gray-600 dark:text-gray-300">
                  <div className="truncate">{item.schoolName || '-'}</div>
                  <div className="truncate text-gray-400">{item.region || '-'}</div>
                </td>
                <td className="px-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${statusBadgeClass(item.status)}`}>
                    {statusLabel(item.status)}
                  </span>
                  <div className="mt-1 truncate text-xs text-gray-400" title={item.statusDetail}>
                    {item.statusDetail || '-'}
                  </div>
                </td>
                <td className="px-2 text-xs">
                  <span className={`rounded px-1.5 py-0.5 ${intentBadgeClass(item.intentLevel)}`}>
                    {item.intentLevel || '无'}
                  </span>
                  <div className="mt-1 truncate text-gray-500 dark:text-gray-400">
                    {stageLabel(item.stage) || '-'}
                  </div>
                </td>
                <td className="px-2 text-xs">
                  {item.overdue ? (
                    <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />逾期
                    </span>
                  ) : <span className="text-gray-400">正常</span>}
                </td>
                <td className="px-2">
                  <div className="flex flex-wrap gap-1">
                    {item.workItemKinds.length ? item.workItemKinds.map((kind) => (
                      <span key={kind} className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                        {kindLabels[kind] || kind}
                      </span>
                    )) : <span className="text-xs text-gray-400">无开放工作项</span>}
                  </div>
                </td>
                <td className="px-2 text-xs">
                  {pending ? (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-300">
                      {item.needHelp && <HelpCircle className="h-3.5 w-3.5" aria-label="需要协助" />}
                      等待接手
                    </span>
                  ) : (
                    <span className="text-green-700 dark:text-green-300">已转给 #{item.targetAgentId}</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
