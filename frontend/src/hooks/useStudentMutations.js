import { useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../api';
import { getApiErrorMessage } from '../utils';

/**
 * 共享的学生更新 mutations
 * 所有组件复用同一个 mutation，自动乐观更新 + 缓存失效
 */
export default function useStudentMutations({ toast }) {
  const queryClient = useQueryClient();

  // 乐观更新学生列表
  const updateStudentOptimistic = (id, fields) => {
    queryClient.setQueriesData({ queryKey: ['tasks'] }, (old) => {
      if (!old?.data?.list) return old;
      return {
        ...old,
        data: {
          ...old.data,
          list: old.data.list.map((s) => (s.id === id ? { ...s, ...fields } : s)),
        },
      };
    });
  };

  // 更新状态
  const updateStatus = useMutation({
    mutationFn: async ({ id, status, invalid_reason }) => {
      const payload = { status };
      if (invalid_reason) payload.invalid_reason = invalid_reason;
      const res = await api.put(`/students/${id}`, payload);
      return res.data;
    },
    onMutate: ({ id, status }) => {
      updateStudentOptimistic(id, { status });
    },
    onError: (e) => {
      toast?.error('更新状态失败: ' + getApiErrorMessage(e));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // 更新意向
  const updateIntent = useMutation({
    mutationFn: async ({ id, level }) => {
      await api.put(`/students/${id}`, { intent_level: level });
    },
    onMutate: ({ id, level }) => {
      updateStudentOptimistic(id, { intent_level: level });
    },
    onError: (e) => {
      toast?.error('更新意向失败: ' + getApiErrorMessage(e));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // 更新阶段
  const updateStage = useMutation({
    mutationFn: async ({ id, stage }) => {
      await api.put(`/students/${id}/stage`, { stage });
    },
    onMutate: ({ id, stage }) => {
      updateStudentOptimistic(id, {
        stage,
        status: stage === '已报名' ? '已报名' : undefined,
      });
    },
    onError: (e) => {
      toast?.error('更新阶段失败: ' + getApiErrorMessage(e));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // 更新成绩
  const updateScore = useMutation({
    mutationFn: async ({ id, score }) => {
      await api.put(`/students/${id}`, { score });
    },
    onMutate: ({ id, score }) => {
      updateStudentOptimistic(id, { score });
    },
    onError: (e) => {
      toast?.error('更新成绩失败: ' + getApiErrorMessage(e));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // 切换协助标记
  const toggleNeedHelp = useMutation({
    mutationFn: async (id) => {
      const res = await api.post(`/students/${id}/need-help`);
      return res.data;
    },
    onMutate: () => {
      // 乐观更新需要知道当前值，这里简单失效缓存
    },
    onError: (e) => {
      toast?.error('操作失败: ' + getApiErrorMessage(e));
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  // 创建学生
  const createStudent = useMutation({
    mutationFn: async (payload) => {
      const res = await api.post('/students', payload);
      if (res.data.code !== 0) throw new Error(res.data.msg || '创建失败');
      return res.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (e) => {
      toast?.error('创建失败: ' + getApiErrorMessage(e));
    },
  });

  return {
    updateStatus,
    updateIntent,
    updateStage,
    updateScore,
    toggleNeedHelp,
    createStudent,
  };
}
