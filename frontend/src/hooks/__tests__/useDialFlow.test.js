/**
 * Tests for useDialFlow custom hook.
 *
 * This hook manages:
 * - Phone retrieval via GET /api/students/phone/:id
 * - sessionStorage('pendingDial') for post-call follow-up
 * - tel: redirect to initiate the phone call
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mock confirm / toast contexts ──
const mockToast = { error: vi.fn(), info: vi.fn(), success: vi.fn() };

vi.mock('../../components/Toast', () => ({
  useToast: () => mockToast,
}));

// ── Mock api module ──
vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

import api from '../../api';
// Re-import to get the real hook
let useDialFlow;
beforeEach(async () => {
  const mod = await import('../useDialFlow.js');
  useDialFlow = mod.default;
});

// ── sessionStorage mock ──
let sessionStorageMock = {};
const sessionStorageSpy = {
  getItem: vi.fn((k) => sessionStorageMock[k] ?? null),
  setItem: vi.fn((k, v) => { sessionStorageMock[k] = String(v); }),
  removeItem: vi.fn((k) => { delete sessionStorageMock[k]; }),
  clear: vi.fn(() => { sessionStorageMock = {}; }),
};
Object.defineProperty(global, 'sessionStorage', { value: sessionStorageSpy });

// ── window.location mock ──
let originalHref;
beforeEach(() => {
  originalHref = window.location.href;
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, href: 'http://localhost/' },
  });
  vi.clearAllMocks();
  sessionStorageMock = {};
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { href: originalHref },
  });
});

describe('useDialFlow', () => {
  // ────────── dial ──────────
  describe('dial', () => {
    it('successfully dials when phone exists', async () => {
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { guardian_phone: '13800138000', dial_log_id: 9001 } },
      });

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(10, { studentName: 'Alice' });
      });

      expect(res).toEqual({ ok: true, phone: '13800138000' });
      expect(window.location.href).toBe('tel:13800138000');
      expect(sessionStorageSpy.setItem).toHaveBeenCalledWith(
        'pendingDial',
        expect.any(String),
      );
      const pendingDialCall = sessionStorageSpy.setItem.mock.calls.find(
        ([key]) => key === 'pendingDial',
      );
      const pendingDial = JSON.parse(pendingDialCall[1]);
      expect(pendingDial).toEqual({
        studentId: 10,
        studentName: 'Alice',
        dialLogId: 9001,
        dialStartedAt: expect.any(Number),
      });
    });

    it('reuses a stored dial log id for the same student', async () => {
      sessionStorage.setItem('pendingDial', JSON.stringify({
        studentId: 10,
        studentName: 'Alice',
        dialLogId: 9001,
        dialStartedAt: Date.now() - 10_000,
      }));
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { guardian_phone: '13800138000', dial_log_id: 9001 } },
      });

      const { result } = renderHook(() => useDialFlow());
      await act(async () => {
        await result.current.dial(10, { studentName: 'Alice' });
      });

      expect(api.get).toHaveBeenCalledWith('/students/phone/10', {
        params: { dial_log_id: 9001 },
      });
    });

    it('returns phone_error when phone API fails', async () => {
      api.get.mockRejectedValueOnce({
          response: { data: { detail: 'Phone fetch failed' } },
      });

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(9);
      });

      expect(res).toEqual({ ok: false, reason: 'phone_error', message: 'Phone fetch failed' });
      expect(mockToast.error).toHaveBeenCalledWith('Phone fetch failed');
    });

    it('returns no_phone when guardian_phone is empty', async () => {
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { guardian_phone: '' } },
      });

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(11);
      });

      expect(res).toEqual({ ok: false, reason: 'no_phone', message: '该联系人没有电话' });
      expect(mockToast.error).toHaveBeenCalledWith('该联系人没有电话');
    });

    it('returns no_phone when guardian_phone is null', async () => {
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { guardian_phone: null } },
      });

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(12);
      });

      expect(res).toEqual({ ok: false, reason: 'no_phone', message: '该联系人没有电话' });
    });

    it('fetches guardian2_phone when contactKey=guardian2', async () => {
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { guardian_phone: '13800000001', guardian2_phone: '13800000002' } },
      });

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(13, { contactKey: 'guardian2' });
      });

      expect(res).toEqual({ ok: true, phone: '13800000002' });
    });

    it('returns no_phone when guardian2_phone is missing', async () => {
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { guardian_phone: '13800000001' } },
      });

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(14, { contactKey: 'guardian2' });
      });

      expect(res).toEqual({ ok: false, reason: 'no_phone', message: '该联系人没有电话' });
    });

    it('calls onSuccess callback after successful dial', async () => {
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { guardian_phone: '13800000000' } },
      });

      const onSuccess = vi.fn();
      const { result } = renderHook(() => useDialFlow());

      await act(async () => {
        await result.current.dial(15, { onSuccess });
      });

      expect(onSuccess).toHaveBeenCalledWith('13800000000');
    });

    it('calls onError callback on phone fetch error', async () => {
      api.get.mockRejectedValueOnce({
          response: { data: { detail: 'Server error' } },
      });

      const onError = vi.fn();
      const { result } = renderHook(() => useDialFlow());

      await act(async () => {
        await result.current.dial(16, { onError });
      });

      expect(onError).toHaveBeenCalledWith('Server error');
    });

    it('calls onError callback when phone is empty', async () => {
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { guardian_phone: '' } },
      });

      const onError = vi.fn();
      const { result } = renderHook(() => useDialFlow());

      await act(async () => {
        await result.current.dial(17, { onError });
      });

      expect(onError).toHaveBeenCalledWith('该联系人没有电话');
    });

    it('does not block when sessionStorage is unavailable', async () => {
      sessionStorageSpy.setItem.mockImplementationOnce(() => {
        throw new Error('quota exceeded');
      });

      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { guardian_phone: '13800000000' } },
      });

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(18);
      });

      expect(res).toEqual({ ok: true, phone: '13800000000' });
      expect(window.location.href).toBe('tel:13800000000');
    });

    it('falls back to generic message when phone error has no detail', async () => {
      api.get.mockRejectedValueOnce({});

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(19);
      });

      expect(res).toEqual({ ok: false, reason: 'phone_error', message: '获取电话失败' });
    });
  });
});
