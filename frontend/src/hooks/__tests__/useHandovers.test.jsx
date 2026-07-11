import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import {
  useExecuteHandoverTransfer,
  useHandoverDetail,
  useHandoverList,
  usePreviewHandoverTransfer,
  useStartHandover,
} from '../useHandovers';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

describe('handover React Query hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses stable list and detail query keys and exact endpoints', async () => {
    api.get
      .mockResolvedValueOnce({ data: { code: 0, data: { list: [], total: 0 } } })
      .mockResolvedValueOnce({
        data: { code: 0, data: { batch: { id: 12 }, items: [], filter_options: {} } },
      });
    const listFilters = { status: 'pending', page: 2 };
    const detailFilters = { intent: 'A', overdue: true };
    const { queryClient, wrapper } = createHarness();

    const listHook = renderHook(() => useHandoverList(listFilters), { wrapper });
    await waitFor(() => expect(listHook.result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenNthCalledWith(1, '/admin/handovers', { params: listFilters });
    expect(queryClient.getQueryState(['handovers', listFilters])).toBeDefined();

    const detailHook = renderHook(() => useHandoverDetail(12, detailFilters), { wrapper });
    await waitFor(() => expect(detailHook.result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenNthCalledWith(2, '/admin/handovers/12', {
      params: detailFilters,
    });
    expect(queryClient.getQueryState(['handover', 12, detailFilters])).toBeDefined();
  });

  it('posts preview and execute bodies using the backend contract', async () => {
    api.post
      .mockResolvedValueOnce({
        data: { code: 0, data: { batch_id: 12, version: 3, selected_count: 2 } },
      })
      .mockResolvedValueOnce({
        data: {
          code: 0,
          data: { transfer_id: 5, transferred_ids: [11, 12], batch_version: 4 },
        },
      });
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const previewHook = renderHook(() => usePreviewHandoverTransfer(), { wrapper });
    const executeHook = renderHook(() => useExecuteHandoverTransfer(), { wrapper });

    await act(async () => {
      await previewHook.result.current.mutateAsync({
        batchId: 12,
        mode: 'selected',
        studentIds: [11, 12],
      });
    });
    expect(api.post).toHaveBeenNthCalledWith(1, '/admin/handovers/12/preview-transfer', {
      mode: 'selected',
      student_ids: [11, 12],
    });

    await act(async () => {
      await executeHook.result.current.mutateAsync({
        batchId: 12,
        targetAgentId: 2,
        mode: 'selected',
        studentIds: [11, 12],
        expectedVersion: 3,
        idempotencyKey: 'handover-12-fixed',
      });
    });
    expect(api.post).toHaveBeenNthCalledWith(2, '/admin/handovers/12/transfers', {
      target_agent_id: 2,
      mode: 'selected',
      student_ids: [11, 12],
      expected_version: 3,
      idempotency_key: 'handover-12-fixed',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['handovers'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['handover', 12] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-users'] });
  });

  it('starts offboarding with the caller-owned key and refreshes account caches', async () => {
    api.post.mockResolvedValue({
      data: { code: 0, data: { id: 21, source_agent: { id: 7 }, version: 1 } },
    });
    const { queryClient, wrapper } = createHarness();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const startHook = renderHook(() => useStartHandover(), { wrapper });

    await act(async () => {
      await startHook.result.current.mutateAsync({
        userId: 7,
        expectedVersion: 4,
        idempotencyKey: 'handover-7-retry-key',
      });
    });

    expect(api.post).toHaveBeenCalledWith('/admin/users/7/offboarding/start', {
      expected_version: 4,
      idempotency_key: 'handover-7-retry-key',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['handovers'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['handover', 21] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin-users'] });
  });
});
