// Plain-text reports the team posts in their WeChat work group. The layouts match
// the templates the managers asked for in the group, so a pasted report looks the
// same as a hand-typed one.

const clean = (value) => String(value ?? '').trim();

export function isMaskedPhone(value) {
  return /\*/.test(String(value ?? ''));
}

// "2026-07-14T15:30" (a datetime-local value) -> "7月14日 15:30"; free text is kept as typed.
export function formatVisitTime(value) {
  const text = clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(text);
  if (!match) return text;
  return `${Number(match[2])}月${Number(match[3])}日 ${match[4]}:${match[5]}`;
}

export function buildVisitReport({
  agentName,
  studentName,
  phone,
  program,
  score,
  campusTime,
  situation,
  homeTime,
  address,
}) {
  const rows = [
    ['话务员', agentName],
    ['学生姓名', studentName],
    ['家长电话', phone],
    ['意向专业', program],
    ['中考分数', score],
    ['到校参观时间', campusTime],
    ['情况', situation],
    ['家访时间', homeTime],
    ['地址', address],
  ];
  return rows.map(([label, value]) => `${label}：${clean(value)}`).join('\n');
}

export function buildEnrollmentReport({ studentName, program, agentName, region }) {
  const lines = [
    '[庆祝]喜 报[庆祝]',
    `学生姓名：${clean(studentName)}`,
    `报读专业：${clean(program)}`,
    `话务员：${clean(agentName)}`,
  ];
  if (clean(region)) lines.push(`地区：${clean(region)}`);
  lines.push('再接再厉[烟花][烟花][烟花]');
  return lines.join('\n');
}

// Call this straight from a click handler: browsers only allow copying during a
// user gesture, so do not await a network request first.
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

// Starting values for the editable report fields. If a number ever arrives masked
// (e.g. 138****0000), leave it blank rather than copying something unusable.
export function initialReportValues(student) {
  const phone = student?.guardian_phone || student?.guardian2_phone || '';
  return {
    phone: isMaskedPhone(phone) ? '' : phone,
    program: student?.program || '',
    score: student?.score ?? '',
  };
}
