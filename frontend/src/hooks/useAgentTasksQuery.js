import { useQuery } from '@tanstack/react-query';
import api from '../api';

/**
 * 使用 React Query 获取今日任务
 * 替代原来的 useEffect + useState + 手动缓存
 */
export function useTodayTasks() {
  return useQuery({
    queryKey: ['tasks', 'today'],
    queryFn: async () => {
      const res = await api.get('/tasks/today');
      if (res.data.code !== 0) throw new Error(res.data.msg || '加载失败');
      return res.data.data;
    },
    staleTime: 10_000, // 10 秒内不重复请求
  });
}

/**
 * 获取跟进中数据
 */
export function useFollowingTasks() {
  return useQuery({
    queryKey: ['tasks', 'following'],
    queryFn: async () => {
      const res = await api.get('/tasks/following');
      if (res.data.code !== 0) throw new Error(res.data.msg || '加载失败');
      return res.data.data;
    },
    enabled: false, // 手动触发
  });
}

/**
 * 获取积压提醒
 */
export function useBacklogAlert(userId) {
  return useQuery({
    queryKey: ['tasks', 'backlog', userId],
    queryFn: async () => {
      const res = await api.get('/tasks/backlog', { params: { days_threshold: 3 } });
      if (res.data.code !== 0) return null;
      return res.data.data?.count > 0 ? res.data.data : null;
    },
    enabled: !!userId,
    staleTime: 60_000, // 1 分钟
  });
}

/**
 * 获取学生详情
 */
export function useStudentDetail(studentId) {
  return useQuery({
    queryKey: ['student', studentId],
    queryFn: async () => {
      const res = await api.get(`/students/${studentId}`);
      if (res.data.code !== 0) throw new Error(res.data.msg || '加载失败');
      return res.data.data;
    },
    enabled: !!studentId,
  });
}

/**
 * 获取学生备注
 */
export function useStudentNotes(studentId) {
  return useQuery({
    queryKey: ['notes', studentId],
    queryFn: async () => {
      const res = await api.get(`/notes?student_id=${studentId}`);
      return res.data.data || [];
    },
    enabled: !!studentId,
  });
}

/**
 * 获取拨号检查
 */
export function useDialCheck(studentId) {
  return useQuery({
    queryKey: ['dialCheck', studentId],
    queryFn: async () => {
      const res = await api.get('/calls/check', { params: { student_id: studentId, within_hours: 24 } });
      return res.data.code === 0 ? res.data.data : null;
    },
    enabled: !!studentId,
    staleTime: 30_000,
  });
}

/**
 * 获取转化预测
 */
export function usePrediction(studentId) {
  return useQuery({
    queryKey: ['prediction', studentId],
    queryFn: async () => {
      const res = await api.get(`/stats/predict-conversion/${studentId}`);
      return res.data.code === 0 ? res.data.data : null;
    },
    enabled: !!studentId,
    staleTime: 60_000,
  });
}
