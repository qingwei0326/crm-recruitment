import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import useAgentDetail from '../useAgentDetail';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
  },
}));

function makeActions() {
  return {
    setDetail: vi.fn(),
    setNoteText: vi.fn(),
    setActionMsg: vi.fn(),
    updateStudentField: vi.fn(),
    setFollowUpDate: vi.fn(),
    setVisit: vi.fn(),
    setAi: vi.fn(),
  };
}

describe('useAgentDetail.addNote', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.post.mockResolvedValue({ data: { code: 0, data: {} } });
    api.get.mockResolvedValue({
      data: {
        code: 0,
        data: {
          student: { id: 42, name: '当前学生' },
          notes: [],
          calls: [],
        },
      },
    });
  });

  it('requires an explicit target and never falls back to a stale detail student', async () => {
    const actions = makeActions();
    const toast = { error: vi.fn() };
    const state = { detail: { student: { id: 99, name: '上次查看的学生' } } };
    const { result } = renderHook(() => useAgentDetail({
      state,
      actions,
      students: [{ id: 42, name: '当前学生' }],
      toast,
    }));

    let missingTargetResult;
    await act(async () => {
      missingTargetResult = await result.current.addNote(undefined, '不能串到旧学生');
    });

    expect(missingTargetResult).toBe(false);
    expect(api.post).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.addNote(42, '  当前学生备注  ');
    });

    expect(api.post).toHaveBeenCalledWith('/notes', {
      student_id: 42,
      content: '当前学生备注',
    });
    expect(api.get).toHaveBeenCalledWith('/students/42/detail');
    expect(api.post).not.toHaveBeenCalledWith('/notes', expect.objectContaining({ student_id: 99 }));
  });

  it('does not clear the draft when the API returns a non-zero business code', async () => {
    api.post.mockResolvedValue({ data: { code: 1, msg: '备注保存被拒绝' } });
    const actions = makeActions();
    const toast = { error: vi.fn() };
    const { result } = renderHook(() => useAgentDetail({
      state: { detail: { student: { id: 99 } } },
      actions,
      students: [{ id: 42 }],
      toast,
    }));

    let saved;
    await act(async () => {
      saved = await result.current.addNote(42, '保留草稿');
    });

    expect(saved).toBe(false);
    expect(actions.setNoteText).not.toHaveBeenCalled();
    expect(api.get).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith('添加备注失败: 备注保存被拒绝');
  });
});
