import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import useAgentDial from '../useAgentDial';
import api from '../../api';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
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
  onFlowComplete: vi.fn(),
  ...overrides,
});

describe('useAgentDial', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    api.get.mockResolvedValue({ data: { code: 0, data: { count: 0 } } });
    api.put.mockResolvedValue({ data: { code: 0, data: {} } });
    api.post.mockResolvedValue({ data: { code: 0, data: {} } });
  });

  it('loads pending dial when page becomes visible after tel return', async () => {
    const actions = baseArgs().actions;
    renderHook(() => useAgentDial(baseArgs({ actions })));

    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({
        studentId: 42,
        studentName: '张三',
        dialLogId: 9001,
        dialStartedAt: Date.now() - 30000,
      }),
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
    expect(JSON.parse(sessionStorage.getItem('pendingDial'))).toEqual(
      expect.objectContaining({ studentId: 42, dialLogId: 9001 }),
    );
  });

  it('records duration when closing a pending dial modal', async () => {
    const modal = {
      studentId: 42,
      studentName: '张三',
      dialLogId: 9001,
      dialStartedAt: Date.now() - 45000,
    };
    sessionStorage.setItem('pendingDial', JSON.stringify(modal));
    const actions = baseArgs().actions;
    const { result } = renderHook(() =>
      useAgentDial(baseArgs({
        state: { dial: { modal } },
        actions,
      })),
    );

    await act(async () => {
      await result.current.handleDialModalClose();
    });

    expect(api.put).toHaveBeenCalledWith('/students/dial-duration', null, {
      params: {
        student_id: 42,
        dial_log_id: 9001,
        duration_seconds: expect.any(Number),
      },
    });
    expect(actions.setDialModal).toHaveBeenCalledWith(null);
  });

  it('ignores duplicate dial clicks while the first request is still pending', async () => {
    let resolvePhone;
    api.get.mockImplementation((url) => {
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
      resolvePhone({
        data: { code: 0, data: { guardian_phone: '13800138000', dial_log_id: 9001 } },
      });
      await Promise.all([first, second]);
    });

    const phoneCalls = api.get.mock.calls.filter(([url]) => url === '/students/phone/42');
    expect(phoneCalls).toHaveLength(1);
  });

  it('saves fixed invalid result as invalid reason without prompting, unlocks, and removes it from the queue', async () => {
    const modal = {
      studentId: 42,
      studentName: '张三',
      dialLogId: 9001,
      dialStartedAt: Date.now() - 45000,
    };
    sessionStorage.setItem('pendingDial', JSON.stringify(modal));
    const actions = baseArgs().actions;
    const prompt = vi.fn();
    const onFlowComplete = vi.fn();
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
        onFlowComplete,
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
    expect(onFlowComplete).toHaveBeenCalledWith({
      studentId: 42,
      removedFromQueue: true,
    });
    expect(api.put).toHaveBeenCalledWith('/students/dial-duration', null, {
      params: {
        student_id: 42,
        dial_log_id: 9001,
        duration_seconds: expect.any(Number),
      },
    });
  });

  it('auto-advances only after a saved result and duration both complete', async () => {
    const modal = {
      studentId: 42,
      studentName: '张三',
      dialLogId: 9001,
      dialStartedAt: Date.now() - 45000,
    };
    sessionStorage.setItem('pendingDial', JSON.stringify(modal));
    const actions = baseArgs().actions;
    const onFlowComplete = vi.fn();
    const { result } = renderHook(() => useAgentDial(baseArgs({
      state: { dial: { modal } },
      actions,
      onFlowComplete,
      students: [{ id: 42, name: '张三', status: '未联系' }],
    })));

    await act(async () => {
      await result.current.handleDialModalStatus('未接');
      await result.current.handleDialModalStatus('未接');
    });

    expect(onFlowComplete).toHaveBeenCalledTimes(1);
    expect(onFlowComplete).toHaveBeenCalledWith({
      studentId: 42,
      removedFromQueue: true,
    });
    expect(actions.removeStudentFromQueue).toHaveBeenCalledWith(42);
  });

  it('keeps the follow-up step open and does not advance when reminder save fails', async () => {
    const modal = {
      studentId: 42,
      studentName: '张三',
      status: '待回访',
      showFollowUp: true,
      dialLogId: 9001,
      dialStartedAt: Date.now() - 45000,
    };
    sessionStorage.setItem('pendingDial', JSON.stringify(modal));
    api.post.mockRejectedValueOnce(new Error('network failed'));
    const actions = baseArgs().actions;
    const onFlowComplete = vi.fn();
    const toast = { error: vi.fn() };
    const { result } = renderHook(() => useAgentDial(baseArgs({
      state: { dial: { modal } },
      actions,
      onFlowComplete,
      toast,
    })));

    await act(async () => {
      await result.current.handleDialModalFollowUp('2026-07-13T09:00');
    });

    expect(toast.error).toHaveBeenCalledWith('network failed');
    expect(onFlowComplete).not.toHaveBeenCalled();
    expect(actions.setDialModal).not.toHaveBeenCalledWith(null);
    expect(actions.setLockedStudent).not.toHaveBeenCalledWith(null);
    expect(api.put).not.toHaveBeenCalledWith(
      '/students/dial-duration',
      null,
      expect.anything(),
    );
  });

  it('does not advance when the pending dial session belongs to another student', async () => {
    const modal = {
      studentId: 42,
      studentName: '张三',
      dialLogId: 9001,
      dialStartedAt: Date.now() - 45000,
    };
    sessionStorage.setItem('pendingDial', JSON.stringify({
      ...modal,
      studentId: 99,
    }));
    const actions = baseArgs().actions;
    const onFlowComplete = vi.fn();
    const toast = { error: vi.fn() };
    const { result } = renderHook(() => useAgentDial(baseArgs({
      state: { dial: { modal } },
      actions,
      onFlowComplete,
      toast,
      students: [{ id: 42, name: '张三', status: '未联系' }],
    })));

    await act(async () => {
      await result.current.handleDialModalStatus('未接');
    });

    expect(toast.error).toHaveBeenCalledWith('状态已保存，通话记录待同步，请重试');
    expect(onFlowComplete).not.toHaveBeenCalled();
    expect(actions.setDialModal).not.toHaveBeenCalledWith(null);
    expect(actions.setLockedStudent).not.toHaveBeenCalledWith(null);

    sessionStorage.setItem('pendingDial', JSON.stringify(modal));
    await act(async () => {
      await result.current.handleDialModalStatus('未接');
    });

    expect(onFlowComplete).toHaveBeenCalledTimes(1);
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

  it('keeps modal, lock, and session when duration sync fails after status save', async () => {
    const modal = {
      studentId: 42,
      studentName: '张三',
      dialLogId: 9001,
      dialStartedAt: Date.now() - 45000,
    };
    sessionStorage.setItem('pendingDial', JSON.stringify(modal));
    api.put.mockImplementation((url) => {
      if (url === '/students/dial-duration') return Promise.reject(new Error('network failed'));
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
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

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('通话记录待同步'));
    expect(actions.setDialModal).not.toHaveBeenCalledWith(null);
    expect(actions.setLockedStudent).not.toHaveBeenCalledWith(null);
    expect(JSON.parse(sessionStorage.getItem('pendingDial'))).toEqual(
      expect.objectContaining({ dialLogId: 9001 }),
    );
  });

  it('routes waiting-volunteer results through intent and follow-up steps', async () => {
    const statusModal = {
      studentId: 42,
      studentName: '张三',
      dialLogId: 9001,
      dialStartedAt: Date.now() - 45000,
    };
    const actions = baseArgs().actions;
    const statusHook = renderHook(() => useAgentDial(baseArgs({
      state: { dial: { modal: statusModal } },
      actions,
    })));

    await act(async () => {
      await statusHook.result.current.handleDialModalStatus('等待志愿');
    });

    expect(api.put).toHaveBeenCalledWith('/students/42', { status: '等待志愿' });
    expect(actions.setDialModal).toHaveBeenCalledWith({
      ...statusModal,
      status: '等待志愿',
      showIntent: true,
    });
    statusHook.unmount();

    const intentModal = { ...statusModal, status: '等待志愿', showIntent: true };
    const intentActions = baseArgs().actions;
    const intentHook = renderHook(() => useAgentDial(baseArgs({
      state: { dial: { modal: intentModal } },
      actions: intentActions,
    })));

    await act(async () => {
      await intentHook.result.current.handleDialModalIntent('B');
    });

    expect(intentActions.setDialModal).toHaveBeenCalledWith({
      ...intentModal,
      showIntent: false,
      showFollowUp: true,
    });
  });

  it('keeps the intent modal and lock when intent persistence reports failure', async () => {
    const modal = {
      studentId: 42,
      studentName: '张三',
      status: '已联系',
      showIntent: true,
      dialLogId: 9001,
      dialStartedAt: Date.now() - 45000,
    };
    const actions = baseArgs().actions;
    const updateIntentById = vi.fn().mockResolvedValue(false);
    const { result } = renderHook(() =>
      useAgentDial(baseArgs({
        state: { dial: { modal } },
        actions,
        updateIntentById,
      })),
    );

    await act(async () => {
      await result.current.handleDialModalIntent('A');
    });

    expect(updateIntentById).toHaveBeenCalledWith(42, 'A');
    expect(actions.setDialModal).not.toHaveBeenCalled();
    expect(actions.setLockedStudent).not.toHaveBeenCalled();
    expect(api.put).not.toHaveBeenCalledWith(
      '/students/dial-duration',
      null,
      expect.anything(),
    );
  });
});
