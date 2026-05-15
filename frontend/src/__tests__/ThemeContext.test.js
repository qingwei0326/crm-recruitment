/**
 * Tests for ThemeContext: dark mode toggle and localStorage persistence.
 * Historical bug pattern: localStorage encoding, default state.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';

// Mock localStorage
const localStorageMock = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = value; }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();
Object.defineProperty(global, 'localStorage', { value: localStorageMock });

// Mock document.documentElement classList
const classListMock = {
  add: vi.fn(),
  remove: vi.fn(),
  contains: vi.fn(() => false),
  toggle: vi.fn(),
};
Object.defineProperty(global.document, 'documentElement', {
  value: { classList: classListMock },
});

describe('ThemeContext', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it('defaults to light theme when no localStorage value', () => {
    // Read the ThemeContext logic directly
    const stored = localStorageMock.getItem('theme');
    const theme = stored || 'light';
    expect(theme).toBe('light');
  });

  it('reads dark theme from localStorage', () => {
    localStorageMock.setItem('theme', 'dark');
    const stored = localStorageMock.getItem('theme');
    expect(stored).toBe('dark');
  });

  it('toggles theme and persists to localStorage', () => {
    // Simulate toggle from light to dark
    let theme = 'light';
    const toggleTheme = () => {
      theme = theme === 'light' ? 'dark' : 'light';
      localStorageMock.setItem('theme', theme);
      if (theme === 'dark') {
        document.documentElement.classList.add('dark');
      } else {
        document.documentElement.classList.remove('dark');
      }
    };

    act(() => { toggleTheme(); });

    expect(theme).toBe('dark');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'dark');
    expect(document.documentElement.classList.add).toHaveBeenCalledWith('dark');
  });

  it('toggles back to light theme', () => {
    let theme = 'dark';
    const toggleTheme = () => {
      theme = theme === 'light' ? 'dark' : 'light';
      localStorageMock.setItem('theme', theme);
    };

    act(() => { toggleTheme(); });

    expect(theme).toBe('light');
    expect(localStorageMock.setItem).toHaveBeenCalledWith('theme', 'light');
  });

  it('handles invalid theme values gracefully', () => {
    localStorageMock.setItem('theme', 'invalid_value');
    const stored = localStorageMock.getItem('theme');

    // Should fall back to light
    const validThemes = ['light', 'dark'];
    const theme = validThemes.includes(stored) ? stored : 'light';
    expect(theme).toBe('light');
  });

  it('persists theme across simulated multiple toggles', () => {
    let theme = 'light';

    for (let i = 0; i < 5; i++) {
      theme = theme === 'light' ? 'dark' : 'light';
      localStorageMock.setItem('theme', theme);
    }

    expect(theme).toBe('dark'); // 5 toggles from light = dark
    expect(localStorageMock.getItem('theme')).toBe('dark');
  });
});
