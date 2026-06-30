import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useAgentDial from '../useAgentDial';
import api from '../../api';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('../../utils/logger', () => ({
  default: {
    error: vi.fn(),
  },
}));

const baseArgs = (overrides = {}) => ({
  state: {
    dial: {
      modal: null,
    },
  },
  actions: {
    setDialModal: vi.fn(),
    setDialCheck: vi.fn(),
    setLockedStudent: vi.fn(),
    setCurrentIdx: vi.fn(),
    removeStudentFromQueue: vi.fn(),
    updateStudent: vi.fn(),
    setActionMsg: vi.fn(),
  },
  current: null,
  students: [],
  toast: { error: vi.fn() },
  confirm: vi.fn().mockResolvedValue(true),
  prompt: vi.fn().mockResolvedValue(''),
  updateIntentById: vi.fn(),
  ...overrides,
});

describe('useAgentDial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    api.get.mockResolvedValue({ data: { code: 0, data: { count: 0 } } });
    api.put.mockResolvedValue({ data: { code: 0, data: {} } });
  });

  it('loads pending dial when page becomes visible after tel return', async () => {
    const actions = baseArgs().actions;
    renderHook(() => useAgentDial(baseArgs({ actions })));

    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({ studentId: 42, studentName: '张三', dialStartedAt: Date.now() - 30000 }),
    );

    act(() => {
      document.dispatchEvent(new window.Event('visibilitychange'));
      window.dispatchEvent(new window.Event('focus'));
    });

    await waitFor(() => {
      expect(actions.setDialModal).toHaveBeenCalledWith(
        expect.objectContaining({ studentId: 42, studentName: '张三' }),
      );
    });
    expect(sessionStorage.getItem('pendingDial')).toBeNull();
  });

  it('records duration when closing a pending dial modal', () => {
    const modal = { studentId: 42, studentName: '张三', dialStartedAt: Date.now() - 45000 };
    const actions = baseArgs().actions;
    const { result } = renderHook(() =>
      useAgentDial(baseArgs({
        state: { dial: { modal } },
        actions,
      })),
    );

    act(() => {
      result.current.handleDialModalClose();
    });

    expect(api.put).toHaveBeenCalledWith('/students/dial-duration', null, {
      params: { student_id: 42, duration_seconds: expect.any(Number) },
    });
    expect(actions.setDialModal).toHaveBeenCalledWith(null);
  });

  it('ignores duplicate dial clicks while the first request is still pending', async () => {
    let resolvePhone;
    api.get.mockImplementation((url) => {
      if (url === '/calls/check') {
        return Promise.resolve({ data: { code: 0, data: { count: 0 } } });
      }
      if (url === '/students/phone/42') {
        return new Promise((resolve) => {
          resolvePhone = resolve;
        });
      }
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
    const actions = baseArgs().actions;
    const { result } = renderHook(() =>
      useAgentDial(baseArgs({
        actions,
        students: [{ id: 42, name: '张三' }],
      })),
    );

    const first = result.current.handleDial('guardian', 42);
    await waitFor(() => {
      expect(resolvePhone).toBeTypeOf('function');
    });
    const second = result.current.handleDial('guardian', 42);

    await act(async () => {
      resolvePhone({ data: { code: 0, data: { guardian_phone: '13800138000' } } });
      await Promise.all([first, second]);
    });

    const phoneCalls = api.get.mock.calls.filter(([url]) => url === '/students/phone/42');
    expect(phoneCalls).toHaveLength(1);
  });

  it('saves fixed invalid result as invalid reason without prompting, unlocks, and removes it from the queue', async () => {
    const modal = { studentId: 42, studentName: '张三', dialStartedAt: Date.now() - 45000 };
    const actions = baseArgs().actions;
    const prompt = vi.fn();
    const { result } = renderHook(() =>
      useAgentDial(baseArgs({
        state: { dial: { modal } },
        actions,
        students: [
          { id: 42, name: '张三', status: '未联系' },
          { id: 43, name: '李四', status: '未联系' },
          { id: 44, name: '王五', status: '无效' },
        ],
        prompt,
      })),
    );

    await act(async () => {
      await result.current.handleDialModalStatus('无意向');
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(api.put).toHaveBeenCalledWith('/students/42', {
      status: '无效',
      invalid_reason: '无意向',
    });
    expect(actions.updateStudent).toHaveBeenCalledWith(42, {
      status: '无效',
      status_detail: '无意向',
    });
    expect(actions.setCurrentIdx).not.toHaveBeenCalled();
    expect(actions.removeStudentFromQueue).toHaveBeenCalledWith(42);
    expect(actions.setLockedStudent).toHaveBeenCalledWith(null);
    expect(actions.setDialModal).toHaveBeenCalledWith(null);
  });

  it('keeps modal and lock when saving status fails', async () => {
    api.put.mockRejectedValueOnce(new Error('network failed'));
    const modal = { studentId: 42, studentName: '张三', dialStartedAt: Date.now() - 45000 };
    const actions = baseArgs().actions;
    const toast = { error: vi.fn() };
    const { result } = renderHook(() =>
      useAgentDial(baseArgs({
        state: { dial: { modal } },
        actions,
        toast,
        students: [{ id: 42, name: '张三', status: '未联系' }],
      })),
    );

    await act(async () => {
      await result.current.handleDialModalStatus('空号');
    });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('更新状态失败'));
    expect(actions.setDialModal).not.toHaveBeenCalledWith(null);
    expect(actions.setLockedStudent).not.toHaveBeenCalledWith(null);
    expect(actions.removeStudentFromQueue).not.toHaveBeenCalled();
  });
});
