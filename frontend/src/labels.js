import {
  detailForOperatorResult,
  displayStatusForOperatorResult,
  FIXED_INVALID_REASON_LABELS,
  OPERATOR_RESULT_LABELS,
  RESULT_DETAIL_LABELS,
  RESULT_TO_DISPLAY_STATUS,
} from './operatorResultPolicy';

export {
  detailForOperatorResult,
  displayStatusForOperatorResult,
};

// 后端 API 统一返回学生状态；历史存储值由后端归一化。
// 后端阶段值 → 前端展示文案
const STAGE_LABEL_MAP = {
  初次联系: '新线索',
  有意向: '意向跟进',
  已送资料: '已送资料',
  待家访: '待家访',
  家访已安排: '家访已安排',
  家访完成: '家访完成',
  待到校参观: '待到校参观',
  到校参观已安排: '到校参观已安排',
  已到校参观: '已到校参观',
  预约参观: '预约参观',
  已来访: '已到访',
  已报名: '已报名',
};

const STATUS_LABEL_MAP = {};

export function stageLabel(value) {
  if (!value) return '';
  return STAGE_LABEL_MAP[value] || value;
}

export function statusLabel(value) {
  if (!value) return '';
  return STATUS_LABEL_MAP[value] || value;
}

export const STAGES = [
  '初次联系',
  '有意向',
  '已送资料',
  '待家访',
  '家访已安排',
  '家访完成',
  '待到校参观',
  '到校参观已安排',
  '已到校参观',
  '已报名',
];

export const INTENT_BADGES = {
  A: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  B: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  C: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  '无': 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

export const PROFILE_INTENT_BADGE_CLASSES = INTENT_BADGES;

export function intentBadgeClass(level) {
  const value = level || '无';
  return INTENT_BADGES[value] || INTENT_BADGES['无'];
}

export const STATUS_BADGE_CLASSES = {
  已报名: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  未联系: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  已联系: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  未接: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  待回访: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  无效: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export function statusBadgeClass(status) {
  return STATUS_BADGE_CLASSES[status] || 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300';
}

export const AGENT_STATUS_BADGE_CLASSES = STATUS_BADGE_CLASSES;

export const ADMIN_RECYCLE_STATUS_BADGE_CLASSES = {
  已报名: STATUS_BADGE_CLASSES.已报名,
  待回访: STATUS_BADGE_CLASSES.待回访,
  未联系: STATUS_BADGE_CLASSES.未联系,
  无效: STATUS_BADGE_CLASSES.无效,
};

export function adminRecycleStatusBadgeClass(status) {
  return ADMIN_RECYCLE_STATUS_BADGE_CLASSES[status] || STATUS_BADGE_CLASSES.已联系;
}

export const STATUS_ACTION_BUTTON_CLASSES = {
  新线索: 'bg-gray-500 hover:bg-gray-600',
  非常有意向: 'bg-red-600 hover:bg-red-700',
  意向了解加微: 'bg-amber-600 hover:bg-amber-700',
  未联系: 'bg-gray-500 hover:bg-gray-600',
  已联系: 'bg-blue-600 hover:bg-blue-700',
  未接: 'bg-gray-600 hover:bg-gray-700',
  待回访: 'bg-amber-600 hover:bg-amber-700',
  空号: 'bg-stone-600 hover:bg-stone-700',
  高分段: 'bg-indigo-600 hover:bg-indigo-700',
  无意向: 'bg-slate-600 hover:bg-slate-700',
  孩子不想读: 'bg-zinc-600 hover:bg-zinc-700',
  已报名其他学校: 'bg-rose-600 hover:bg-rose-700',
  已报名: 'bg-green-600 hover:bg-green-700',
  无效: 'bg-red-500 hover:bg-red-600',
};

export const OPERATOR_STATUS_BUTTON_LABELS = OPERATOR_RESULT_LABELS;
export const OPERATOR_RESULT_TO_DISPLAY_STATUS = RESULT_TO_DISPLAY_STATUS;
export const OPERATOR_DETAIL_RESULT_LABELS = RESULT_DETAIL_LABELS;
export const OPERATOR_INVALID_DETAIL_LABELS = FIXED_INVALID_REASON_LABELS;

export const DESKTOP_DIAL_STATUS_BUTTONS = [
  ...OPERATOR_STATUS_BUTTON_LABELS,
].map((status) => ({
  status,
  className: STATUS_ACTION_BUTTON_CLASSES[status],
}));
