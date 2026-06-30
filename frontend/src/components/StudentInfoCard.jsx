import { memo } from 'react';
import StatusBadge from './StatusBadge';
import IntentLevelBadge from './IntentLevelBadge';
import PhoneLink from './PhoneLink';
import { stageLabel } from '../labels';
import { formatDateTime, formatDate } from '../utils';

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

export default memo(function StudentInfoCard({ student, onDial }) {
  if (!student) return null;
  const phone = (raw, masked) => {
    const value = raw || masked;
    return value || '';
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">{student.name}</h3>
        <StatusBadge status={student.status} />
        {student.status_detail && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-gray-700 text-slate-600 dark:text-gray-300">
            {student.status === '无效' ? `原因：${student.status_detail}` : student.status_detail}
          </span>
        )}
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
        <Field label="监护人电话">
          <PhoneLink
            value={phone(student.guardian_phone_raw, student.guardian_phone)}
            label="拨打监护人电话"
            onDial={onDial ? () => onDial('guardian') : undefined}
          />
        </Field>
        <Field label="监护人2">{student.guardian2_name}</Field>
        <Field label="监护人2电话">
          <PhoneLink
            value={phone(student.guardian2_phone_raw, student.guardian2_phone)}
            label="拨打监护人2电话"
            onDial={onDial ? () => onDial('guardian2') : undefined}
          />
        </Field>
        <Field label="分配时间">{formatDateTime(student.assigned_at)}</Field>
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
});
