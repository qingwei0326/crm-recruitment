import { memo } from 'react';
import { statusBadgeClass, statusLabel } from '../labels';

export default memo(function StatusBadge({ status }) {
  if (!status) return <span className="text-xs text-gray-400">-</span>;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(status)}`}>
      {statusLabel(status)}
    </span>
  );
});
