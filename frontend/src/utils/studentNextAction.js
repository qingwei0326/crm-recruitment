export const NEXT_ACTION_TONE_CLASSES = {
  red: 'bg-red-50 text-red-700 border-red-100 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/60',
  amber: 'bg-amber-50 text-amber-700 border-amber-100 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800/60',
  blue: 'bg-blue-50 text-blue-700 border-blue-100 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/60',
  green: 'bg-green-50 text-green-700 border-green-100 dark:bg-green-900/20 dark:text-green-300 dark:border-green-800/60',
  slate: 'bg-slate-50 text-slate-600 border-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700',
};

export function getStudentNextAction(student, hasPhone) {
  if (!hasPhone) return { label: '无电话数据', tone: 'red' };
  if (student.need_help) return { label: '下一步：请主管协助', tone: 'red' };
  if (student.status === '待回访') return { label: '下一步：按约定回访', tone: 'amber' };
  if (student.status === '未接') return { label: '下一步：再次呼出或设回访', tone: 'amber' };
  if (student.status === '未联系' || student.status === '新线索') {
    return { label: '下一步：首次呼出', tone: 'blue' };
  }
  if (['待家访', '家访已安排'].includes(student.stage)) {
    return { label: '下一步：确认家访安排', tone: 'green' };
  }
  if (student.stage === '家访完成') return { label: '下一步：安排到校参观', tone: 'green' };
  if (['待到校参观', '到校参观已安排', '预约参观'].includes(student.stage)) {
    return { label: '下一步：确认到访安排', tone: 'green' };
  }
  if (['已到校参观', '已来访'].includes(student.stage)) {
    return { label: '下一步：跟进入读报名', tone: 'green' };
  }
  if (student.intent_level === 'A') return { label: '下一步：优先推进到访/报名', tone: 'red' };
  return { label: '下一步：更新状态和备注', tone: 'slate' };
}
