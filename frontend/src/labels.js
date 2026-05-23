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
