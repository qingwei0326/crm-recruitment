// What an agent sees right after saving a call result. After marking, the student
// leaves the call queue, and agents kept reporting that students had "disappeared"
// (and, after a wrong tap, could not find them again). Say where the student went.
const PENDING_LIST_STATUSES = new Set(['已联系', '未接', '待回访']);

export function outcomeSavedMessage({ label, displayStatus }) {
  const tag = label ? `【${label}】` : '';
  if (displayStatus === '无效') {
    return `已标记${tag}，这个学生已从你的列表移走。标错了请告诉管理员还原`;
  }
  if (PENDING_LIST_STATUSES.has(displayStatus)) {
    return `已标记${tag}，之后在「待处理」里找`;
  }
  if (displayStatus === '未联系') {
    return `已标记${tag}，仍在「待拨打」里`;
  }
  return `已标记${tag}`;
}
