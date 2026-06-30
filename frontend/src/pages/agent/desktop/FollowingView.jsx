import { useState, useEffect, useCallback } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { INTENT_BADGES, statusLabel, stageLabel } from '../../../labels';
import AssignedDaysBadge from '../shared/AssignedDaysBadge';
import { STATUS_STYLE } from '../agentWorkUtils';

export default function FollowingView({ followingData, loading, onRefresh, onOpenDetail }) {
  const [lastRefresh, setLastRefresh] = useState(Date.now());

  // Auto-refresh every 30s
  useEffect(() => {
    const timer = setInterval(() => {
      onRefresh?.();
      setLastRefresh(Date.now());
    }, 30000);
    return () => clearInterval(timer);
  }, [onRefresh]);

  const handleManualRefresh = useCallback(() => {
    onRefresh?.();
    setLastRefresh(Date.now());
  }, [onRefresh]);

  if (loading && !followingData) {
    return (
      <div className="flex-1 flex items-center justify-center p-4">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!followingData) {
    return <div className="text-center text-gray-400 py-8">加载失败</div>;
  }

  const { total, intent_counts, list } = followingData;

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Header with refresh */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-500">
          {lastRefresh && `最后刷新: ${new Date(lastRefresh).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
        </div>
        <button
          onClick={handleManualRefresh}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border dark:border-gray-600 rounded-lg disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border p-4 text-center">
          <div className="text-2xl font-bold text-blue-600">{total}</div>
          <div className="text-xs text-gray-500">跟进中</div>
        </div>
        {intent_counts && Object.entries(intent_counts).filter(([k]) => k !== '无').map(([level, count]) => (
          <div key={level} className="bg-white dark:bg-gray-800 rounded-xl border p-4 text-center">
            <div className="text-2xl font-bold text-amber-600">{count}</div>
            <div className="text-xs text-gray-500">{level}级意向</div>
          </div>
        ))}
      </div>

      {/* List */}
      {list?.length > 0 ? (
        <div className="space-y-2">
          {list.map((item) => (
            <button
              key={item.id}
              onClick={() => onOpenDetail?.(item.id)}
              className="w-full text-left bg-white dark:bg-gray-800 rounded-xl border p-3 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-gray-900 dark:text-gray-100">{item.name}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${INTENT_BADGES[item.intent_level] || INTENT_BADGES['无']}`}>
                      {item.intent_level}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[item.status] || ''}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-gray-500">
                    <span>{item.school_name || '未知学校'}</span>
                    <span>{item.region || '-'}</span>
                    <span className="text-gray-400">|</span>
                    <span>{stageLabel(item.stage)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <AssignedDaysBadge days={item.days_since_assigned} />
                </div>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="text-center text-gray-400 py-8">暂无跟进中学员</div>
      )}
    </div>
  );
}
