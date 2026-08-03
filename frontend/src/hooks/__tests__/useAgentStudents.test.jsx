import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import useAgentStudents from '../useAgentStudents';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

const baseStudent = {
  id: 1,
  name: '林同学',
  school_name: '学校A',
  status: '未联系',
  status_detail: '',
  stage: '初次联系',
  intent_level: '无',
  score: 400,
  need_help: false,
};

function createActions() {
  return {
    setStudents: vi.fn(),
    setStats: vi.fn(),
    setSchoolGroups: vi.fn(),
    setCurrentIdx: vi.fn(),
    updateStudent: vi.fn(),
    removeStudentFromQueue: vi.fn(),
    setLockedStudent: vi.fn(),
    setActionMsg: vi.fn(),
    setCreate: vi.fn(),
    toggleCreate: vi.fn(),
  };
}

function createState(overrides = {}) {
  return {
    students: [baseStudent],
    stats: { total: 1, done: 0, pending: 1, follow_up: 0, progress_pct: 0 },
    filters: {
      searchQuery: '',
      selectedSchool: null,
      selectedStage: null,
      selectedIntent: null,
      selectedStatus: null,
      scoreRange: { min: '', max: '' },
    },
    sortConfig: { key: 'days', direction: 'desc' },
    currentIdx: 0,
    dial: { lockedStudentId: null },
    ...overrides,
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function renderStudentsHook(overrides = {}) {
  const actions = overrides.actions || createActions();
  const toast = overrides.toast || { error: vi.fn() };
  const state = overrides.state || createState();
  const hook = renderHook(() => useAgentStudents({ state, actions, toast }));
  return { ...hook, actions, toast };
}

describe('useAgentStudents optimistic mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({
      data: {
        code: 0,
        data: {
          list: [baseStudent],
          stats: { total: 1, done: 0, pending: 1, follow_up: 0, progress_pct: 0 },
          schools: [{ name: '学校A', count: 1 }],
        },
      },
    });
    api.put.mockResolvedValue({ data: { code: 0, data: {} } });
    api.post.mockResolvedValue({ data: { code: 0, data: {} } });
  });

  it('updates the UI before the score request finishes', async () => {
    const request = deferred();
    api.put.mockReturnValueOnce(request.promise);
    const { result, actions } = renderStudentsHook();
    await waitFor(() => expect(actions.setStudents).toHaveBeenCalled());

    let mutation;
    act(() => {
      mutation = result.current.updateScore(1, 520);
    });

    expect(actions.updateStudent).toHaveBeenCalledWith(1, { score: 520 });

    await act(async () => {
      request.resolve({ data: { code: 0, data: { score: 520 } } });
      await mutation;
    });
    expect(await mutation).toBe(true);
  });

  it('rolls back only the optimistic fields when the server rejects a change', async () => {
    api.put.mockRejectedValueOnce(new Error('network failed'));
    const toast = { error: vi.fn() };
    const { result, actions } = renderStudentsHook({ toast });
    await waitFor(() => expect(actions.setStudents).toHaveBeenCalled());

    await act(async () => {
      expect(await result.current.updateScore(1, 520)).toBe(false);
    });

    expect(actions.updateStudent).toHaveBeenNthCalledWith(1, 1, { score: 520 });
    expect(actions.updateStudent).toHaveBeenLastCalledWith(1, { score: 400 });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('已撤回界面修改'));
  });

  it('serializes writes and prevents an older failure from reverting a newer value', async () => {
    const first = deferred();
    const second = deferred();
    api.put
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result, actions } = renderStudentsHook();
    await waitFor(() => expect(actions.setStudents).toHaveBeenCalled());

    let firstMutation;
    let secondMutation;
    act(() => {
      firstMutation = result.current.updateScore(1, 450);
      secondMutation = result.current.updateScore(1, 500);
    });

    expect(actions.updateStudent).toHaveBeenNthCalledWith(1, 1, { score: 450 });
    expect(actions.updateStudent).toHaveBeenNthCalledWith(2, 1, { score: 500 });
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));

    await act(async () => {
      first.reject(new Error('first failed'));
      expect(await firstMutation).toBe(false);
    });
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));
    expect(actions.updateStudent).not.toHaveBeenCalledWith(1, { score: 400 });

    await act(async () => {
      second.resolve({ data: { code: 0, data: { score: 500 } } });
      expect(await secondMutation).toBe(true);
    });
    expect(actions.updateStudent).toHaveBeenLastCalledWith(1, { score: 500 });
  });

  it('rolls back a failed field without reverting a newer edit to another field', async () => {
    const first = deferred();
    const second = deferred();
    api.put
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    let visibleStudent = { ...baseStudent };
    const actions = createActions();
    actions.updateStudent.mockImplementation((_id, fields) => {
      visibleStudent = { ...visibleStudent, ...fields };
    });
    const { result } = renderStudentsHook({ actions });
    await waitFor(() => expect(actions.setStudents).toHaveBeenCalled());

    let scoreMutation;
    let intentMutation;
    act(() => {
      scoreMutation = result.current.updateScore(1, 520);
      intentMutation = result.current.updateIntentById(1, 'A');
    });
    expect(visibleStudent).toEqual(expect.objectContaining({ score: 520, intent_level: 'A' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(1));

    await act(async () => {
      first.reject(new Error('score failed'));
      expect(await scoreMutation).toBe(false);
    });
    expect(visibleStudent).toEqual(expect.objectContaining({ score: 400, intent_level: 'A' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve({ data: { code: 0, data: { intent_level: 'A' } } });
      expect(await intentMutation).toBe(true);
    });
    expect(visibleStudent.intent_level).toBe('A');
  });

  it('does not include an undefined status when advancing a non-enrollment stage', async () => {
    const request = deferred();
    api.put.mockReturnValueOnce(request.promise);
    const { result, actions } = renderStudentsHook();
    await waitFor(() => expect(actions.setStudents).toHaveBeenCalled());

    let mutation;
    act(() => {
      mutation = result.current.updateStage(1, '有意向');
    });

    expect(actions.updateStudent).toHaveBeenCalledWith(1, { stage: '有意向' });
    expect(actions.updateStudent.mock.calls[0][1]).not.toHaveProperty('status');

    await act(async () => {
      request.resolve({ data: { code: 0, data: { stage: '有意向' } } });
      await mutation;
    });
  });

  it('does not release the dial lock from a regular status mutation', async () => {
    api.put.mockResolvedValueOnce({
      data: { code: 0, data: { status: '未接', status_detail: '' } },
    });
    const actions = createActions();
    const { result } = renderStudentsHook({
      actions,
      state: createState({ dial: { lockedStudentId: 1 } }),
    });
    await waitFor(() => expect(actions.setStudents).toHaveBeenCalled());

    await act(async () => {
      expect(await result.current.updateStatus(1, '未接')).toBe(true);
    });

    expect(actions.setLockedStudent).not.toHaveBeenCalled();
  });

  it('removes a processed student from the pending-only queue after the save succeeds', async () => {
    const request = deferred();
    api.put.mockReturnValueOnce(request.promise);
    const { result, actions } = renderStudentsHook();
    await waitFor(() => expect(actions.setStudents).toHaveBeenCalled());

    let mutation;
    act(() => {
      mutation = result.current.updateStatus(1, '未接');
    });

    expect(actions.updateStudent).toHaveBeenCalledWith(1, expect.objectContaining({
      status: '未接',
    }));
    expect(actions.removeStudentFromQueue).not.toHaveBeenCalled();

    await act(async () => {
      request.resolve({ data: { code: 0, data: { status: '未接' } } });
      await mutation;
    });

    expect(actions.removeStudentFromQueue).toHaveBeenCalledWith(1);
  });

  it('preserves the current student by id when a server refresh reorders the queue', async () => {
    const secondStudent = { ...baseStudent, id: 2, name: '陈同学' };
    const actions = createActions();
    const { result } = renderStudentsHook({
      actions,
      state: createState({
        students: [baseStudent, secondStudent],
        currentIdx: 1,
      }),
    });
    await waitFor(() => expect(actions.setStudents).toHaveBeenCalled());
    actions.setCurrentIdx.mockClear();
    api.get.mockResolvedValueOnce({
      data: {
        code: 0,
        data: {
          list: [secondStudent, baseStudent],
          stats: { total: 2, done: 0, pending: 2, follow_up: 0, progress_pct: 0 },
          schools: [{ name: '学校A', count: 2 }],
        },
      },
    });

    await act(async () => {
      await result.current.fetchToday();
    });

    const indexUpdater = actions.setCurrentIdx.mock.calls.at(-1)[0];
    expect(indexUpdater(1)).toBe(0);
  });

  it('recomputes stats for search and status filters', async () => {
    const state = createState({
      students: [
        baseStudent,
        { ...baseStudent, id: 2, name: '陈同学', status: '待回访' },
      ],
      filters: {
        ...createState().filters,
        searchQuery: '陈',
        selectedStatus: '待回访',
      },
    });
    const { result } = renderStudentsHook({ state });

    expect(result.current.filteredStats).toEqual({
      total: 1,
      done: 1,
      pending: 0,
      follow_up: 1,
      progress_pct: 100,
    });
  });
});
