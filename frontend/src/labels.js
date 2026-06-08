// 后端存储仍用旧值（初次联系/拒绝接听/已完成 等），仅前端展示翻译为新词。
// 后端枚举值 → 前端展示文案
const STAGE_LABEL_MAP = {
  初次联系: '新线索',
  有意向: '意向跟进',
  已送资料: '资料已发',
  预约参观: '邀约到访',
  已来访: '已到访',
  已报名: '已报名',
};

const STATUS_LABEL_MAP = {
  拒绝接听: '未接通',
  已完成: '已结案',
};

export function stageLabel(value) {
  if (!value) return '';
  return STAGE_LABEL_MAP[value] || value;
}

export function statusLabel(value) {
  if (!value) return '';
  return STATUS_LABEL_MAP[value] || value;
}

export const STAGES = ['初次联系', '有意向', '已送资料', '预约参观', '已来访', '已报名'];

export const INTENT_BADGES = {
  A: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  B: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  C: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  '无': 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};
