import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import useLeadOutcomeCatalog from '../useLeadOutcomeCatalog';

vi.mock('../../api', () => ({
  default: { get: vi.fn() },
}));

describe('useLeadOutcomeCatalog', () => {
  beforeEach(() => vi.clearAllMocks());

  it('uses server ordering and exposes rules by stable code', async () => {
    api.get.mockResolvedValue({
      data: {
        code: 0,
        data: [
          { code: 'enrolled_elsewhere', label: '已报名其他学校', terminal: true, reclaimable: false },
          { code: 'phone_invalid', label: '空号', terminal: true, reclaimable: true },
        ],
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useLeadOutcomeCatalog(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.get).toHaveBeenCalledWith('/lead-outcome-reasons');
    expect(result.current.results.map((item) => item.code)).toEqual([
      'new_lead',
      'very_interested',
      'interested_wechat',
      'waiting_volunteer',
      'missed_call',
      'enrolled_elsewhere',
      'phone_invalid',
    ]);
    expect(result.current.byCode.enrolled_elsewhere.reclaimable).toBe(false);
  });
});
