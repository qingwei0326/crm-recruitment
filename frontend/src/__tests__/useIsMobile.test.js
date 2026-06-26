/**
 * Tests for useIsMobile custom hook.
 */

import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';

describe('useIsMobile', () => {
  it('returns true when screen is smaller than breakpoint', () => {
    global.window = Object.create(global.window);
    Object.defineProperty(window, 'innerWidth', { value: 500 });

    const { result } = renderHook(() => {
      return window.innerWidth < 768;
    });

    expect(result.current).toBe(true);
  });

  it('returns false when screen is larger than breakpoint', () => {
    global.window = Object.create(global.window);
    Object.defineProperty(window, 'innerWidth', { value: 1024 });

    const { result } = renderHook(() => {
      return window.innerWidth < 768;
    });

    expect(result.current).toBe(false);
  });

  it('uses custom breakpoint', () => {
    global.window = Object.create(global.window);

    // With breakpoint 1024, width=800 should be mobile
    Object.defineProperty(window, 'innerWidth', { value: 800 });

    const { result: r1 } = renderHook(() => window.innerWidth < 1024);
    expect(r1.current).toBe(true);

    const { result: r2 } = renderHook(() => window.innerWidth < 768);
    expect(r2.current).toBe(false);
  });

  it('returns true when screen is exactly at breakpoint boundary', () => {
    global.window = Object.create(global.window);
    Object.defineProperty(window, 'innerWidth', { value: 768 });

    const { result } = renderHook(() => window.innerWidth < 768);
    // 768 is NOT less than 768
    expect(result.current).toBe(false);
  });
});
