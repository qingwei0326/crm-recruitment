import { memo } from 'react';
import { Wifi, WifiOff, CloudOff, Loader2 } from 'lucide-react';

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
      className={`fixed top-0 left-0 right-0 z-50 px-3 py-2 text-xs font-medium text-center transition-all duration-300 ${
        syncing
          ? 'bg-amber-500 text-white'
          : isOnline
            ? 'bg-green-500 text-white'
            : 'bg-red-500 text-white'
      } ${className}`}
    >
      <div className="flex items-center justify-center gap-2">
        {syncing ? (
          <>
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>正在同步离线数据...</span>
          </>
        ) : isOnline ? (
          <>
            <Wifi className="w-3 h-3" />
            <span>已恢复在线</span>
          </>
        ) : (
          <>
            <WifiOff className="w-3 h-3" />
            <span>离线模式 - 数据将在恢复连接后同步</span>
          </>
        )}
      </div>
    </div>
  );
});

export default ConnectionStatus;
