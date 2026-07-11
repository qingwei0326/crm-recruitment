// 纯函数和常量 — 从 AgentWork.jsx 提取
import { CheckCheck, Clock, CheckCircle2, UserX, TrendingUp, MessageCircle, Ban, School } from 'lucide-react';
import { FALLBACK_OPERATOR_OUTCOMES } from '../../domain/outcomeCatalog';
import {
  AGENT_STATUS_BADGE_CLASSES,
  INTENT_BADGES as SHARED_INTENT_BADGES,
  STAGES as SHARED_STAGES,
} from '../../labels';

export const STATUS_STYLE = AGENT_STATUS_BADGE_CLASSES;

const QUICK_STATUS_ICONS = {
  new_lead: Clock,
  very_interested: TrendingUp,
  interested_wechat: MessageCircle,
  missed_call: Clock,
  phone_invalid: Ban,
  high_score: Ban,
  no_intent: UserX,
  child_declined: UserX,
  enrolled_elsewhere: School,
  enrolled: CheckCircle2,
};

export function quickStatusForOutcome(outcome) {
  return {
    status: outcome.label,
    outcome,
    icon: QUICK_STATUS_ICONS[outcome.code] || CheckCheck,
    color: outcome.className,
  };
}

export const QUICK_STATUSES = FALLBACK_OPERATOR_OUTCOMES.map(quickStatusForOutcome);

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
  const seenPhones = new Set();
  return [
    {
      key: 'guardian',
      label: '联系人1',
      name: student.guardian_name || '联系人1',
      phone: student.guardian_phone || '',
    },
    {
      key: 'guardian2',
      label: '联系人2',
      name: student.guardian2_name || '联系人2',
      phone: student.guardian2_phone || '',
    },
  ].filter((item) => {
    const phoneKey = String(item.phone || '').replace(/\D+/g, '');
    if (!phoneKey || seenPhones.has(phoneKey)) return false;
    seenPhones.add(phoneKey);
    return true;
  });
}
