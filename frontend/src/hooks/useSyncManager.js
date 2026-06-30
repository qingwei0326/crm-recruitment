import { useCallback, useEffect, useRef } from 'react';
import api from '../api';
import useOfflineStorage from './useOfflineStorage';
import useOnlineStatus from './useOnlineStatus';
import { useToast } from '../components/Toast';

/**
 * 同步管理器 Hook
 *
 * 功能：
 * - 网络恢复时自动同步离线操作
 * - 合并冲突处理
 * - 同步状态通知
 */
export default function useSyncManager(onSyncComplete) {
  const toast = useToast();
  const { getPendingSync, markSynced, clearCache } = useOfflineStorage();
  const syncingRef = useRef(false);

  const executeSyncOperation = useCallback(async (operation) => {
    const { type, payload } = operation;

    switch (type) {
      case 'update_status':
        await api.put(`/students/${payload.studentId}`, { status: payload.status });
        break;
      case 'update_intent':
        await api.put(`/students/${payload.studentId}`, { intent_level: payload.level });
        break;
      case 'update_stage':
        await api.put(`/students/${payload.studentId}/stage`, { stage: payload.stage });
        break;
      case 'add_note':
        await api.post('/notes', {
          student_id: payload.studentId,
          content: payload.content,
        });
        break;
      case 'add_call':
        await api.post('/calls/analyze', {
          student_id: payload.studentId,
          transcript: payload.transcript,
          duration_seconds: payload.duration,
        });
        break;
      case 'add_followup':
        await api.post('/follow-ups', {
          student_id: payload.studentId,
          follow_up_date: payload.date,
          notes: payload.notes,
        });
        break;
      default:
        console.warn('[Sync] Unknown operation type:', type);
    }
  }, []);

  const syncPendingOperations = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;

    try {
      const pendingOps = await getPendingSync();
      if (pendingOps.length === 0) {
        syncingRef.current = false;
        return;
      }

      console.log(`[Sync] Syncing ${pendingOps.length} pending operations...`);
      toast?.info?.(`正在同步 ${pendingOps.length} 条离线数据...`);

      let successCount = 0;
      let failCount = 0;

      for (const op of pendingOps) {
        try {
          await executeSyncOperation(op);
          await markSynced(op.id);
          successCount++;
        } catch (e) {
          console.error('[Sync] Operation failed:', op, e);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast?.success?.(`同步完成：${successCount} 条成功`);
        onSyncComplete?.();
      }
      if (failCount > 0) {
        toast?.warning?.(`${failCount} 条操作同步失败，将在下次网络恢复时重试`);
      }
    } catch (e) {
      console.error('[Sync] Sync failed:', e);
      toast?.error?.('同步失败，请稍后重试');
    } finally {
      syncingRef.current = false;
    }
  }, [executeSyncOperation, getPendingSync, markSynced, onSyncComplete, toast]);

  // 网络恢复时自动同步
  // useOnlineStatus 内部已通过 wasOfflineRef 保证只在 离线→在线 时触发 onReconnect，
  // 无需外部再检查 wasOffline（闭包捕获的值是过期的）
  const { isOnline } = useOnlineStatus(() => {
    syncPendingOperations();
  });

  // 组件挂载时检查待同步数据
  useEffect(() => {
    if (isOnline) {
      syncPendingOperations();
    }
  }, [isOnline, syncPendingOperations]);

  return {
    isOnline,
    syncPendingOperations,
    clearCache,
  };
}
