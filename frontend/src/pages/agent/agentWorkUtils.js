// 纯函数和常量 — 从 AgentWork.jsx 提取
import { CheckCheck, Clock, CheckCircle2, UserX } from 'lucide-react';

export const STATUS_STYLE = {
  未联系: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  已联系: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  待回访: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  已完成: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  已报名: 'bg-green-200 text-green-800 dark:bg-green-900/50 dark:text-green-200',
  无效: 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-300',
  拒绝接听: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  已过期: 'bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
};

export const QUICK_STATUSES = [
  { status: '已联系', icon: CheckCheck, color: 'bg-blue-600 hover:bg-blue-700' },
  { status: '待回访', icon: Clock, color: 'bg-amber-600 hover:bg-amber-700' },
  { status: '已报名', icon: CheckCircle2, color: 'bg-green-600 hover:bg-green-700' },
  { status: '无效', icon: UserX, color: 'bg-red-500 hover:bg-red-600' },
];

export const STAGES = ['初次联系', '有意向', '已送资料', '预约参观', '已来访', '已报名'];

export const INTENT_BADGES = {
  A: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  B: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  C: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
  '无': 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400',
};

export const inputCls =
  'w-full px-3 py-2.5 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-1 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400';

export const emptyStudentForm = {
  name: '',
  region: '',
  score: '',
  guardian_name: '',
  guardian_phone: '',
  guardian2_name: '',
  guardian2_phone: '',
  school_name: '',
  school_address: '',
  join_reasons: '',
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
  { key: 'school_address', label: '学校地址' },
  { key: 'join_reasons', label: '报名原因/备注', type: 'textarea' },
];

export function buildStudentPayload(form) {
  const payload = { name: form.name.trim() };
  [
    'region', 'guardian_name', 'guardian_phone',
    'guardian2_name', 'guardian2_phone',
    'school_name', 'school_address', 'join_reasons',
  ].forEach((key) => {
    const value = form[key]?.trim();
    if (value) payload[key] = value;
  });
  if (form.score !== '' && form.score != null) payload.score = Number(form.score);
  return payload;
}

export function getApiErrorMessage(error) {
  return error?.response?.data?.detail || error?.response?.data?.msg || error?.message || '加载失败';
}

export function getContactOptions(student) {
  if (!student) return [];
  return [
    {
      key: 'guardian1',
      label: '联系人1',
      name: student.guardian_name || '联系人1',
      phone: student.guardian_phone_raw || student.guardian_phone || '',
    },
    {
      key: 'guardian2',
      label: '联系人2',
      name: student.guardian2_name || '联系人2',
      phone: student.guardian2_phone_raw || student.guardian2_phone || '',
    },
  ].filter((item) => item.phone);
}
