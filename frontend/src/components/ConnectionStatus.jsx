import { memo } from 'react';
import { Wifi, WifiOff, Loader2 } from 'lucide-react';

/**
 * 网络连接状态指示器
 *
 * 显示当前网络状态：
 * - 在线：绿色
 * - 离线：红色
 * - 同步中：黄色闪烁
 */
const ConnectionStatus = memo(function ConnectionStatus({
  isOnline = true,
  syncing = false,
  className = '',
}) {
  if (isOnline && !syncing) {
    return null; // 在线且未同步时不显示
  }

  return (
    <div
      role={isOnline ? 'status' : 'alert'}
      aria-live={isOnline ? 'polite' : 'assertive'}
      className={`fixed top-0 left-0 right-0 z-[90] px-3 pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] text-center text-xs font-medium shadow-md transition-all duration-300 ${
        syncing
          ? 'bg-amber-500 text-amber-950 dark:text-white'
          : isOnline
            ? 'bg-green-500 text-white'
            : 'bg-red-600 text-white'
      } ${className}`}
    >
      <div className="flex items-center justify-center gap-2">
        {syncing ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>正在同步离线数据…</span>
          </>
        ) : isOnline ? (
          <>
            <Wifi className="w-3 h-3" />
            <span>已恢复在线</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3 h-3" />
            <span>当前离线，操作将在恢复网络后同步</span>
          </>
        )}
      </div>
    </div>
  );
});

export default ConnectionStatus;
