import { ArrowRightLeft, PauseCircle, UserCheck, UserX } from 'lucide-react';
import { employmentLabel, employmentStatus, employmentTone } from '../agentManageUtils';

const toneClasses = {
  green: 'bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  blue: 'bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  gray: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
};

const statusIcons = {
  active: UserCheck,
  suspended: PauseCircle,
  handover_pending: ArrowRightLeft,
  offboarded: UserX,
};

export default function EmploymentStatusBadge({ account, className = '' }) {
  const status = employmentStatus(account);
  const Icon = statusIcons[status] || UserX;
  const label = employmentLabel(status);
  return (
    <span
      title={`员工状态：${label}`}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-xs font-medium ${toneClasses[employmentTone(status)]} ${className}`}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </span>
  );
}
