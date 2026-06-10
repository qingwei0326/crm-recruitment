/**
 * Tests for useTodayTasks custom hook.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import useTodayTasks from '../useTodayTasks';

// Mock api module
vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

import api from '../../api';

describe('useTodayTasks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns initial state with loading=true before fetch resolves', () => {
    api.get.mockReturnValue(new Promise(() => {})); // never resolves
    const { result } = renderHook(() => useTodayTasks());

    expect(result.current.loading).toBe(true);
    expect(result.current.students).toEqual([]);
    expect(result.current.stats).toEqual({
      total: 0,
      done: 0,
      pending: 0,
      follow_up: 0,
      progress_pct: 0,
    });
    expect(result.current.schools).toEqual([]);
    expect(result.current.truncated).toBe(false);
    expect(result.current.error).toBe('');
  });

  it('populates students and stats on successful fetch', async () => {
    const mockData = {
      code: 0,
      data: {
        list: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        stats: {
          total: 10,
          done: 3,
          pending: 5,
          follow_up: 2,
          progress_pct: 30,
        },
        schools: ['School A', 'School B'],
        truncated: false,
      },
    };
    api.get.mockResolvedValue({ data: mockData });

    const { result } = renderHook(() => useTodayTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.students).toEqual(mockData.data.list);
    expect(result.current.stats).toEqual(mockData.data.stats);
    expect(result.current.schools).toEqual(['School A', 'School B']);
    expect(result.current.error).toBe('');
    expect(api.get).toHaveBeenCalledWith('/tasks/today', { params: { limit: 30, offset: 0 } });
  });

  it('sets error when API returns non-zero code', async () => {
    api.get.mockResolvedValue({
      data: { code: 1, msg: 'Server error occurred' },
    });

    const { result } = renderHook(() => useTodayTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Server error occurred');
    expect(result.current.students).toEqual([]);
  });

  it('sets default error message when API returns non-zero code without msg', async () => {
    api.get.mockResolvedValue({
      data: { code: 500 },
    });

    const { result } = renderHook(() => useTodayTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('加载失败');
  });

  it('handles network errors gracefully', async () => {
    const networkError = {
      response: { data: { detail: 'Network timeout' } },
      message: 'Network Error',
    };
    api.get.mockRejectedValue(networkError);

    const { result } = renderHook(() => useTodayTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Network timeout');
  });

  it('falls back to error.message when response data is unavailable', async () => {
    api.get.mockRejectedValue({ message: 'Something broke' });

    const { result } = renderHook(() => useTodayTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.error).toBe('Something broke');
  });

  it('refetch function reloads data', async () => {
    const firstResponse = {
      code: 0,
      data: { list: [{ id: 1 }], stats: { total: 1 } },
    };
    const secondResponse = {
      code: 0,
      data: { list: [{ id: 1 }, { id: 2 }], stats: { total: 2 } },
    };

    api.get.mockResolvedValueOnce({ data: firstResponse });
    api.get.mockResolvedValueOnce({ data: secondResponse });

    const { result } = renderHook(() => useTodayTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.students).toHaveLength(1);

    await act(async () => {
      result.current.refetch();
    });

    await waitFor(() => {
      expect(result.current.students).toHaveLength(2);
    });

    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it('refetch preserves current search and school filters by default', async () => {
    api.get.mockResolvedValue({
      data: { code: 0, data: { list: [], stats: {}, total: 0 } },
    });

    const { result } = renderHook(() => useTodayTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.setSearch('Alice');
      result.current.setSelectedSchool('School A');
    });

    await act(async () => {
      await result.current.refetch();
    });

    expect(api.get).toHaveBeenLastCalledWith('/tasks/today', {
      params: { limit: 30, offset: 0, search: 'Alice', school_name: 'School A' },
    });
  });

  it('handles response with missing list field', async () => {
    api.get.mockResolvedValue({
      data: { code: 0, data: { stats: { total: 5 } } },
    });

    const { result } = renderHook(() => useTodayTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.students).toEqual([]);
    expect(result.current.stats).toEqual({ total: 5 });
  });

  it('sets truncated to true when response indicates truncation', async () => {
    api.get.mockResolvedValue({
      data: {
        code: 0,
        data: {
          list: [],
          truncated: true,
        },
      },
    });

    const { result } = renderHook(() => useTodayTasks());

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.truncated).toBe(true);
  });
});
