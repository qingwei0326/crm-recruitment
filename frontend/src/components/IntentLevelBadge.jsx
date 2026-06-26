import { memo } from 'react';
import { intentBadgeClass } from '../labels';

export default memo(function IntentLevelBadge({ level }) {
  const v = level || '无';
  return (
    <span className={`inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 rounded-full text-xs font-semibold ${intentBadgeClass(v)}`}>
      {v === '无' ? '无' : v}
    </span>
  );
});
