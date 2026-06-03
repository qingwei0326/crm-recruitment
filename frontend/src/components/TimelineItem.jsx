import { memo } from 'react';
import { Sparkles } from 'lucide-react';
import { formatDateTime } from '../utils';

export default memo(function TimelineItem({ type, icon: Icon, color = 'gray', title, content, agentName, timestamp, source }) {
  const colorMap = {
    blue: 'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-300 border-blue-200 dark:border-blue-800',
    green: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-300 border-green-200 dark:border-green-800',
    amber: 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-300 border-amber-200 dark:border-amber-800',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-300 border-purple-200 dark:border-purple-800',
    teal: 'bg-teal-50 dark:bg-teal-900/20 text-teal-600 dark:text-teal-300 border-teal-200 dark:border-teal-800',
    gray: 'bg-gray-50 dark:bg-gray-800 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700',
  };
  const cls = colorMap[color] || colorMap.gray;
  return (
    <div className="flex gap-3">
      <div className={`shrink-0 w-9 h-9 rounded-full border flex items-center justify-center ${cls}`}>
        {Icon && <Icon className="w-4 h-4" />}
      </div>
      <div className="flex-1 min-w-0 pb-4 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center flex-wrap gap-2 mb-1">
          <span className="text-sm font-medium text-gray-800 dark:text-gray-200">{title}</span>
          {source === 'ai' && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 text-[10px] font-semibold">
              <Sparkles className="w-3 h-3" />
              AI
            </span>
          )}
          {type && (
            <span className="text-[10px] uppercase tracking-wide text-gray-400">{type}</span>
          )}
        </div>
        {content && (
          <div className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap break-words">
            {content}
          </div>
        )}
        <div className="mt-1 text-xs text-gray-400 flex items-center gap-2">
          {agentName && <span>{agentName}</span>}
          {timestamp && <span>· {formatDateTime(timestamp)}</span>}
        </div>
      </div>
    </div>
  );
});
