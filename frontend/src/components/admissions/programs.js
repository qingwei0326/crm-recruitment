// The majors agents reported most in the 2026 work group. Swap in the school's
// official list once there is one.
export const COMMON_PROGRAMS = [
  '无人机',
  '工业机器人',
  '新能源汽车',
  '人工智能',
  '国防特色班',
  '汽车维修',
  '形象设计',
  '电子商务',
  '医药卫生',
  '计算机',
  '机电',
];

const SEPARATORS = /[、,，\s]+/;

// Tapping a major adds it to what is typed, or takes it out again.
export function toggleProgram(current, program) {
  const parts = String(current ?? '').split(SEPARATORS).filter(Boolean);
  const next = parts.includes(program)
    ? parts.filter((part) => part !== program)
    : [...parts, program];
  return next.join('、');
}
