// 纯函数和常量 — 从 AgentWork.jsx 提取
import { CheckCheck, Clock, CheckCircle2, UserX, TrendingUp, MessageCircle, Ban } from 'lucide-react';
import {
  AGENT_STATUS_BADGE_CLASSES,
  INTENT_BADGES as SHARED_INTENT_BADGES,
  OPERATOR_STATUS_BUTTON_LABELS,
  STAGES as SHARED_STAGES,
  STATUS_ACTION_BUTTON_CLASSES,
} from '../../labels';

export const STATUS_STYLE = AGENT_STATUS_BADGE_CLASSES;

const QUICK_STATUS_ICONS = {
  新线索: Clock,
  非常有意向: TrendingUp,
  意向了解加微: MessageCircle,
  已联系: CheckCheck,
  未接: Clock,
  待回访: Clock,
  高分段: Ban,
  无意向: UserX,
  孩子不想读: UserX,
  已报名: CheckCircle2,
  无效: UserX,
};

export const QUICK_STATUSES = OPERATOR_STATUS_BUTTON_LABELS.map((status) => ({
  status,
  icon: QUICK_STATUS_ICONS[status],
  color: STATUS_ACTION_BUTTON_CLASSES[status],
}));

export const STAGES = SHARED_STAGES;

export const INTENT_BADGES = SHARED_INTENT_BADGES;

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
];

export function buildStudentPayload(form) {
  const payload = { name: form.name.trim() };
  [
    'region', 'guardian_name', 'guardian_phone',
    'guardian2_name', 'guardian2_phone',
    'school_name',
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
