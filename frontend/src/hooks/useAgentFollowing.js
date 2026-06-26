import { useCallback } from 'react';
import api from '../api';

/**
 * 管理跟进中数据
 */
export default function useAgentFollowing({ actions, toast }) {
  // 加载跟进中数据
  const fetchFollowing = useCallback(async () => {
    actions.setFollowingLoading(true);
    try {
      const r = await api.get('/tasks/following');
      actions.setFollowing(r.data.data);
    } catch {
      toast?.error('加载跟进中数据失败');
    } finally {
      actions.setFollowingLoading(false);
    }
  }, [actions, toast]);

  // 兼容旧调用；积压提醒已暂时关闭。
  const dismissBacklogAlert = useCallback(() => {
    actions.setBacklogAlert(null);
  }, [actions]);

  return {
    fetchFollowing,
    dismissBacklogAlert,
  };
}
