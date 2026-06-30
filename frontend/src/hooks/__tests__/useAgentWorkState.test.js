import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useAgentWorkState from '../useAgentWorkState';

describe('useAgentWorkState', () => {
  it('should return initial state', () => {
    const { result } = renderHook(() => useAgentWorkState());
    const { state } = result.current;

    expect(state.students).toEqual([]);
    expect(state.stats).toEqual({ total: 0, done: 0, pending: 0, follow_up: 0, progress_pct: 0 });
    expect(state.currentIdx).toBe(0);
    expect(state.filters.searchQuery).toBe('');
    expect(state.detail.show).toBe(false);
    expect(state.ai.show).toBe(false);
  });

  it('should have stable actions reference', () => {
    const { result, rerender } = renderHook(() => useAgentWorkState());
    const firstActions = result.current.actions;

    rerender();
    const secondActions = result.current.actions;

    expect(firstActions).toBe(secondActions);
  });

  it('setStudents should update students', () => {
    const { result } = renderHook(() => useAgentWorkState());
    const mockStudents = [{ id: 1, name: 'Test' }];

    act(() => {
      result.current.actions.setStudents(mockStudents);
    });

    expect(result.current.state.students).toEqual(mockStudents);
  });

  it('setFilter should update filter and reset currentIdx', () => {
    const { result } = renderHook(() => useAgentWorkState());

    act(() => {
      result.current.actions.setCurrentIdx(5);
    });
    expect(result.current.state.currentIdx).toBe(5);

    act(() => {
      result.current.actions.setFilter('searchQuery', 'test');
    });

    expect(result.current.state.filters.searchQuery).toBe('test');
    expect(result.current.state.currentIdx).toBe(0);
  });

  it('setCurrentIdx should support functional updates', () => {
    const { result } = renderHook(() => useAgentWorkState());

    act(() => {
      result.current.actions.setCurrentIdx(5);
    });

    act(() => {
      result.current.actions.setCurrentIdx((idx) => Math.min(idx, 2));
    });

    expect(result.current.state.currentIdx).toBe(2);
  });

  it('updateStudent should merge fields into matching student', () => {
    const { result } = renderHook(() => useAgentWorkState());

    act(() => {
      result.current.actions.setStudents([
        { id: 1, name: 'A', status: '新线索' },
        { id: 2, name: 'B', status: '未接' },
      ]);
    });

    act(() => {
      result.current.actions.updateStudent(1, { status: '已联系' });
    });

    expect(result.current.state.students[0].status).toBe('已联系');
    expect(result.current.state.students[1].status).toBe('未接');
  });

  it('removeStudentFromQueue should remove a student, clamp currentIdx, and decrement pending stats', () => {
    const { result } = renderHook(() => useAgentWorkState());

    act(() => {
      result.current.actions.setStudents([
        { id: 1, name: 'A', status: '未联系' },
        { id: 2, name: 'B', status: '未联系' },
      ]);
      result.current.actions.setStats({ total: 2, done: 0, pending: 2, follow_up: 0, progress_pct: 0 });
      result.current.actions.setCurrentIdx(1);
    });

    act(() => {
      result.current.actions.removeStudentFromQueue(2);
    });

    expect(result.current.state.students).toEqual([{ id: 1, name: 'A', status: '未联系' }]);
    expect(result.current.state.currentIdx).toBe(0);
    expect(result.current.state.stats).toEqual({
      total: 1,
      done: 0,
      pending: 1,
      follow_up: 0,
      progress_pct: 0,
    });
  });

  it('setDialModal should update dial modal', () => {
    const { result } = renderHook(() => useAgentWorkState());
    const modal = { studentId: 1, studentName: 'Test' };

    act(() => {
      result.current.actions.setDialModal(modal);
    });

    expect(result.current.state.dial.modal).toEqual(modal);
  });

  it('toggleDetail should toggle detail show', () => {
    const { result } = renderHook(() => useAgentWorkState());

    expect(result.current.state.detail.show).toBe(false);

    act(() => {
      result.current.actions.toggleDetail(true);
    });
    expect(result.current.state.detail.show).toBe(true);

    act(() => {
      result.current.actions.toggleDetail(false);
    });
    expect(result.current.state.detail.show).toBe(false);
  });
});
