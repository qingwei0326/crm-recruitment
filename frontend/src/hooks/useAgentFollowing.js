import { useCallback, useEffect } from 'react';
import api from '../api';

/**
 * 管理跟进中数据和积压提醒
 */
export default function useAgentFollowing({ state, actions, user, toast }) {
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

  // 加载积压提醒
  useEffect(() => {
    if (!user?.id) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `crm_backlog_dismissed_${user.id}_${today}`;
    if (localStorage.getItem(key)) return;

    api.get('/tasks/backlog', { params: { days_threshold: 3 } }).then((r) => {
      if (r.data.code === 0 && r.data.data?.count > 0) {
        actions.setBacklogAlert(r.data.data);
      }
    }).catch(() => {});
  }, [user?.id, actions]);

  // 关闭积压提醒
  const dismissBacklogAlert = useCallback(() => {
    if (user?.id) {
      const today = new Date().toISOString().slice(0, 10);
      localStorage.setItem(`crm_backlog_dismissed_${user.id}_${today}`, '1');
    }
    actions.setBacklogAlert(null);
  }, [user?.id, actions]);

  return {
    fetchFollowing,
    dismissBacklogAlert,
  };
}
