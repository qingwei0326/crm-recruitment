import { useAuth } from '../context/AuthContext';
import StatusBadge from './StatusBadge';
import IntentLevelBadge from './IntentLevelBadge';
import { stageLabel } from '../labels';
import { formatDateTime, formatDate } from '../utils';

function maskPhone(p) {
  if (!p || p.length < 7) return p;
  return p.slice(0, 3) + '****' + p.slice(-4);
}

function Field({ label, children }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg px-3 py-2 border dark:border-gray-700">
      <div className="text-xs text-gray-400">{label}</div>
      <div className="text-sm font-medium text-gray-800 dark:text-gray-200 break-all">
        {children == null || children === '' ? '-' : children}
      </div>
    </div>
  );
}

export default function StudentInfoCard({ student }) {
  const { user } = useAuth();
  if (!student) return null;
  const isAdmin = user?.role === 'admin';
  const phone = (raw, masked) => {
    const value = isAdmin ? raw || masked : masked || raw;
    if (!value) return '-';
    return (
      <a href={`tel:${value}`} className="text-blue-600 dark:text-blue-400 hover:underline">
        {isAdmin ? value : maskPhone(value)}
      </a>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{student.name}</h3>
        <StatusBadge status={student.status} />
        <IntentLevelBadge level={student.intent_level} />
        {student.stage && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
            {stageLabel(student.stage)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        <Field label="地域">{student.region}</Field>
        <Field label="学校">{student.school_name}</Field>
        <Field label="成绩">{student.score != null ? student.score : '-'}</Field>
        <Field label="监护人">{student.guardian_name}</Field>
        <Field label="监护人电话">{phone(student.guardian_phone_raw, student.guardian_phone)}</Field>
        <Field label="监护人2">{student.guardian2_name}</Field>
        <Field label="监护人2电话">{phone(student.guardian2_phone_raw, student.guardian2_phone)}</Field>
        <Field label="学校地址">{student.school_address}</Field>
        <Field label="负责人">{student.agent_name || student.assigned_to_name || '-'}</Field>
        <Field label="报名原因">{student.join_reasons}</Field>
        <Field label="创建时间">{formatDateTime(student.created_at)}</Field>
        <Field label="过期时间">{formatDate(student.expires_at || student.expired_at)}</Field>
      </div>

      {student.status === '已报名' && (
        <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 border border-green-200 dark:border-green-800">
          <div className="text-sm font-semibold text-green-700 dark:text-green-300 mb-2">报名信息</div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-sm text-gray-700 dark:text-gray-300">
            <div>专业：{student.program || '-'}</div>
            <div>定金：{student.deposit != null ? student.deposit : '-'}</div>
            <div>报名日：{formatDate(student.enrolled_at)}</div>
          </div>
        </div>
      )}
    </div>
  );
}
