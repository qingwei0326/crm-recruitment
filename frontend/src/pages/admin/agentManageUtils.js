import {
  ADMIN_OPERATION_PERMISSION_OPTIONS,
  ADMIN_PAGE_PERMISSION_OPTIONS,
  normalizeAdminOperationPermissions,
  normalizeAdminPagePermissions,
} from '../../adminPermissions';

export function isLocked(agent) {
  if (!agent?.locked_until) return false;
  const t = new Date(agent.locked_until);
  return !Number.isNaN(t.getTime()) && t.getTime() > Date.now();
}

export function isAgentAccount(account) {
  return (account?.role || 'agent') === 'agent';
}

export function isAdminAccount(account) {
  return account?.role === 'admin';
}

export function getAgentListGroup(agent) {
  if (!agent?.is_active) return 2;
  if (!isAgentAccount(agent)) return 1;
  return Number(agent.total_tasks || 0) > 0 ? 0 : 1;
}

export const inputCls =
  'w-full px-3 py-2 border dark:border-gray-600 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400';

const reservedDisplayNames = new Set(['离职', '已离职', '禁用', '停用', '启用']);

export function validateDisplayName(name) {
  const value = (name || '').trim();
  if (!value) return '请输入姓名';
  if (reservedDisplayNames.has(value)) return '姓名不能填写离职、禁用等状态词，请填写真实姓名';
  return '';
}

export function roleLabel(account) {
  if (account?.is_super_admin) return '超管';
  return account?.role === 'admin' ? '管理员' : '话务员';
}

export function permissionSummary(account) {
  if (account?.role !== 'admin' || account?.is_super_admin) return '';
  const permissions = normalizeAdminPagePermissions(account?.page_permissions);
  const labels = ADMIN_PAGE_PERMISSION_OPTIONS
    .filter((option) => permissions.includes(option.key))
    .map((option) => option.label);
  const operationPermissions = normalizeAdminOperationPermissions(account?.operation_permissions);
  const operationLabels = ADMIN_OPERATION_PERMISSION_OPTIONS.flatMap((group) => group.items)
    .filter((option) => operationPermissions.includes(option.key))
    .map((option) => option.label);
  if (labels.length === 0 && operationLabels.length === 0) return '未开放权限';
  const parts = [];
  if (labels.length > 0) parts.push(`页面：${labels.join('、')}`);
  if (operationLabels.length > 0) parts.push(`操作：${operationLabels.join('、')}`);
  return parts.join('；');
}
