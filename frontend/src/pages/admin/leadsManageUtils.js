import { stageLabel, STAGES } from '../../labels';

export const STATUS_OPTS = ['', '未联系', '已联系', '未接', '待回访', '已报名', '无效'];
export const STATUS_DETAIL_OPTS = [
  '',
  '非常有意向',
  '意向了解加微',
  '高分段',
  '无意向',
  '孩子不想读',
  '空号',
  '其他',
];
export const INTENT_OPTS = ['', '无', 'A', 'B', 'C'];
export const STAGE_STAT_KEYS = ['未分配', ...STAGES];
export const ENROLLMENT_SUBSTAGES = ['定金待缴', '全款待缴', '已缴全款', '入学注册', '流失'];
export const INLINE_CAMPUS_STAGE_LABELS = {
  待到校参观: '待到校',
  到校参观已安排: '已预约',
  已到校参观: '已到校',
};
export const HOME_ACTION_STAGES = new Set(['有意向', '已送资料', '待家访', '家访已安排', '家访完成']);
export const CAMPUS_ACTION_STAGES = new Set(['待到校参观', '到校参观已安排']);
export const inputCls =
  'w-full px-3 py-2.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400';
export const emptyStudentForm = {
  name: '',
  region: '',
  score: '',
  guardian_name: '',
  guardian_phone: '',
  guardian2_name: '',
  guardian2_phone: '',
  school_name: '',
  status: '',
  intent_level: '',
  stage: '',
  program: '',
  deposit: '',
  enrolled_at: '',
  assigned_to: '',
  need_help: false,
};
export const createStudentFields = [
  { key: 'name', label: '姓名', required: true },
  { key: 'region', label: '地域' },
  { key: 'score', label: '成绩', type: 'number' },
  { key: 'guardian_name', label: '监护人姓名' },
  { key: 'guardian_phone', label: '监护人电话' },
  { key: 'guardian2_name', label: '监护人2姓名' },
  { key: 'guardian2_phone', label: '监护人2电话' },
  { key: 'school_name', label: '学校名称' },
  { key: 'program', label: '报名专业' },
  { key: 'deposit', label: '定金', type: 'number' },
  { key: 'enrolled_at', label: '报名日期', type: 'date' },
];

export function schoolPlaceholder(regions, loading, schools) {
  if (regions.length === 0) return '请先选择区县';
  if (loading) return '加载学校中...';
  if (schools.length === 0) return '所选区县下无未分配学生';
  return '-- 请选择 --';
}

export function getOwnershipFilterFromParams(searchParams) {
  if (searchParams.get('assignment') === 'unassigned') return 'unassigned';
  const assignedTo = searchParams.get('assigned_to');
  return assignedTo ? `agent:${assignedTo}` : '';
}

export function getAssignedToFromOwnershipFilter(value) {
  return value?.startsWith('agent:') ? value.slice('agent:'.length) : '';
}

export function compactStageLabel(value) {
  return INLINE_CAMPUS_STAGE_LABELS[value] || stageLabel(value);
}
