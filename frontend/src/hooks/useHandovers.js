import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api';
import {
  normalizeHandoverBatch,
  normalizeHandoverDetail,
  normalizeHandoverList,
  normalizeHandoverPreview,
  normalizeTransferResult,
} from '../domain/handover';

function responseData(response) {
  const payload = response?.data;
  if (payload?.code !== undefined && payload.code !== 0) {
    throw new Error(payload.msg || '操作失败');
  }
  return payload?.data;
}

function studentIdsFor(mode, studentIds) {
  return mode === 'selected' && Array.isArray(studentIds) ? studentIds : [];
}

export function useHandoverList(filters = {}, options = {}) {
  return useQuery({
    queryKey: ['handovers', filters],
    queryFn: async () => {
      const response = await api.get('/admin/handovers', { params: filters });
      return normalizeHandoverList(responseData(response));
    },
    ...options,
  });
}

export function useHandoverDetail(batchId, filters = {}, options = {}) {
  return useQuery({
    queryKey: ['handover', batchId, filters],
    queryFn: async () => {
      const response = await api.get(`/admin/handovers/${batchId}`, { params: filters });
      return normalizeHandoverDetail(responseData(response));
    },
    enabled: Boolean(batchId),
    ...options,
  });
}

export function useActiveHandoverAgents(options = {}) {
  return useQuery({
    queryKey: ['handover-agents'],
    queryFn: async () => {
      const response = await api.get('/admin/agents');
      const values = responseData(response);
      return (Array.isArray(values) ? values : [])
        .filter((agent) => (
          agent?.employment_status
            ? agent.employment_status === 'active'
            : Boolean(agent?.is_active)
        ))
        .map((agent) => ({
          id: Number(agent.id) || 0,
          name: typeof agent.name === 'string' ? agent.name : '',
        }));
    },
    ...options,
  });
}

export function usePreviewHandoverTransfer(options = {}) {
  return useMutation({
    mutationFn: async ({ batchId, mode, studentIds = [] }) => {
      const response = await api.post(`/admin/handovers/${batchId}/preview-transfer`, {
        mode,
        student_ids: studentIdsFor(mode, studentIds),
      });
      return normalizeHandoverPreview(responseData(response));
    },
    ...options,
  });
}

export function useExecuteHandoverTransfer(options = {}) {
  const queryClient = useQueryClient();
  const externalOnSuccess = options.onSuccess;
  return useMutation({
    ...options,
    mutationFn: async ({
      batchId,
      targetAgentId,
      mode,
      studentIds = [],
      expectedVersion,
      idempotencyKey,
    }) => {
      const response = await api.post(`/admin/handovers/${batchId}/transfers`, {
        target_agent_id: Number(targetAgentId),
        mode,
        student_ids: studentIdsFor(mode, studentIds),
        expected_version: Number(expectedVersion),
        idempotency_key: idempotencyKey,
      });
      return normalizeTransferResult(responseData(response));
    },
    onSuccess: async (data, variables, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['handovers'] }),
        queryClient.invalidateQueries({ queryKey: ['handover', variables.batchId] }),
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
      ]);
      await externalOnSuccess?.(data, variables, context);
    },
  });
}

export function useStartHandover(options = {}) {
  const queryClient = useQueryClient();
  const externalOnSuccess = options.onSuccess;
  return useMutation({
    ...options,
    mutationFn: async ({ userId, expectedVersion, idempotencyKey }) => {
      const response = await api.post(`/admin/users/${userId}/offboarding/start`, {
        expected_version: Number(expectedVersion),
        idempotency_key: idempotencyKey,
      });
      return normalizeHandoverBatch(responseData(response));
    },
    onSuccess: async (data, variables, context) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['handovers'] }),
        queryClient.invalidateQueries({ queryKey: ['handover', data.id] }),
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
      ]);
      await externalOnSuccess?.(data, variables, context);
    },
  });
}
