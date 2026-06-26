import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * 网络状态感知 Hook
 *
 * 功能：
 * - 监听在线/离线状态
 * - 网络恢复时触发回调
 * - 显示连接状态
 */
export default function useOnlineStatus(onReconnect) {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const wasOfflineRef = useRef(false);

  useEffect(() => {
    const handleOnline = () => {
      console.log('[Network] Online');
      setIsOnline(true);

      // 如果之前是离线状态，触发重连回调
      if (wasOfflineRef.current) {
        wasOfflineRef.current = false;
        setWasOffline(true);
        onReconnect?.();
      }
    };

    const handleOffline = () => {
      console.log('[Network] Offline');
      setIsOnline(false);
      wasOfflineRef.current = true;
      setWasOffline(false);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [onReconnect]);

  const resetWasOffline = useCallback(() => {
    setWasOffline(false);
    wasOfflineRef.current = false;
  }, []);

  return { isOnline, wasOffline, resetWasOffline };
}
