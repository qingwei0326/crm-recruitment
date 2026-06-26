// 后端用 utcnow() 存 UTC naive datetime（无时区后缀）。
// 前端 new Date() 解析没有 Z 后缀的字符串时，行为依赖浏览器，且会被当成本地时间。
// 这里显式把字符串视为 UTC，再用浏览器本地时区显示。
export function formatDateTime(value, withSeconds = false) {
  if (!value) return '-';
  try {
    let s = String(value).replace(' ', 'T');
    // 已经带时区（Z 或 +08:00 等）就不再追加
    const tail = s.slice(10);
    const hasTz = /[Zz]$/.test(tail) || /[+-]\d{2}:?\d{2}$/.test(tail);
    if (!hasTz) s += 'Z';
    const d = new Date(s);
    if (isNaN(d.getTime())) return value;
    const pad = (n) => String(n).padStart(2, '0');
    const yyyy = d.getFullYear();
    const mm = pad(d.getMonth() + 1);
    const dd = pad(d.getDate());
    const hh = pad(d.getHours());
    const mi = pad(d.getMinutes());
    if (withSeconds) {
      return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${pad(d.getSeconds())}`;
    }
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  } catch {
    return value;
  }
}

export function formatDate(value) {
  if (!value) return '-';
  try {
    let s = String(value).replace(' ', 'T');
    const tail = s.slice(10);
    const hasTz = /[Zz]$/.test(tail) || /[+-]\d{2}:?\d{2}$/.test(tail);
    if (!hasTz) s += 'Z';
    const d = new Date(s);
    if (isNaN(d.getTime())) return value;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  } catch {
    return value;
  }
}

export function getApiErrorMessage(error) {
  return error?.response?.data?.detail || error?.response?.data?.msg || error?.message || '加载失败';
}

export function buildStudentPayload(form) {
  const payload = { name: form.name.trim() };
  [
    'region', 'guardian_name', 'guardian_phone',
    'guardian2_name', 'guardian2_phone',
    'school_name',
    'program', 'enrolled_at',
  ].forEach((key) => {
    const value = form[key]?.trim();
    if (value) payload[key] = value;
  });
  if (form.score !== '' && form.score != null) payload.score = Number(form.score);
  if (form.deposit !== '' && form.deposit != null) payload.deposit = Number(form.deposit);
  return payload;
}
