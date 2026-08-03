import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useMobileDialAutoAdvance from '../useMobileDialAutoAdvance';

const students = [
  { id: 11, name: '林同学' },
  { id: 12, name: '陈同学' },
  { id: 13, name: '张同学' },
];

describe('useMobileDialAutoAdvance', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('advances to the next student and can return by student id', () => {
    const setCurrentIdx = vi.fn();
    const { result } = renderHook(() => useMobileDialAutoAdvance({
      enabled: true,
      students,
      currentStudentId: 11,
      setCurrentIdx,
    }));

    act(() => {
      result.current.handleDialComplete({ studentId: 11 });
    });

    expect(setCurrentIdx).toHaveBeenCalledWith(1);
    expect(result.current.notice).toEqual(expect.objectContaining({
      kind: 'advanced',
      previousStudentId: 11,
      message: '已进入 陈同学',
    }));

    act(() => {
      result.current.undo();
    });

    expect(setCurrentIdx).toHaveBeenLastCalledWith(0);
    expect(result.current.notice).toBeNull();
  });

  it('does not skip again when a terminal result already removed the current student', () => {
    const setCurrentIdx = vi.fn();
    const { result } = renderHook(() => useMobileDialAutoAdvance({
      enabled: true,
      students,
      currentStudentId: 11,
      setCurrentIdx,
    }));

    act(() => {
      result.current.handleDialComplete({ studentId: 11, removedFromQueue: true });
    });

    expect(setCurrentIdx).not.toHaveBeenCalled();
    expect(result.current.notice).toEqual(expect.objectContaining({
      kind: 'removed',
      previousStudentId: null,
    }));
  });

  it('only runs for the active mobile queue student', () => {
    const setCurrentIdx = vi.fn();
    const { result } = renderHook(() => useMobileDialAutoAdvance({
      enabled: true,
      students,
      currentStudentId: 11,
      setCurrentIdx,
    }));

    act(() => {
      result.current.handleDialComplete({ studentId: 12 });
    });

    expect(setCurrentIdx).not.toHaveBeenCalled();
    expect(result.current.notice).toBeNull();
  });

  it('dismisses the notice after six seconds', () => {
    const { result } = renderHook(() => useMobileDialAutoAdvance({
      enabled: true,
      students,
      currentStudentId: 11,
      setCurrentIdx: vi.fn(),
    }));

    act(() => {
      result.current.handleDialComplete({ studentId: 11 });
      vi.advanceTimersByTime(6000);
    });

    expect(result.current.notice).toBeNull();
  });
});
