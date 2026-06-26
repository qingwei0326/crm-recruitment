/**
 * Tests for useDialFlow custom hook.
 *
 * This hook manages:
 * - Duplicate call check via GET /api/calls/check
 * - Phone retrieval via GET /api/students/phone/:id
 * - Confirm dialog when call count >= 3
 * - sessionStorage('pendingDial') for post-call follow-up
 * - tel: redirect to initiate the phone call
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// ── Mock confirm / toast contexts ──
const mockConfirm = vi.fn();
const mockToast = { error: vi.fn(), info: vi.fn(), success: vi.fn() };

vi.mock('../../components/ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}));

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
  // ────────── checkDup ──────────
  describe('checkDup', () => {
    it('returns data object when API succeeds with code 0', async () => {
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { count: 2, last_call_at: '2025-01-01T00:00:00Z' } },
      });

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.checkDup(42);
      });

      expect(api.get).toHaveBeenCalledWith('/calls/check', {
        params: { student_id: 42, within_hours: 24 },
      });
      expect(res).toEqual({ count: 2, last_call_at: '2025-01-01T00:00:00Z' });
    });

    it('returns null when API call fails', async () => {
      api.get.mockRejectedValueOnce(new Error('network'));

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.checkDup(1);
      });

      expect(res).toBeNull();
    });

    it('returns null when API returns non-zero code', async () => {
      api.get.mockResolvedValueOnce({ data: { code: 500, msg: 'err' } });

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.checkDup(1);
      });

      expect(res).toBeNull();
    });
  });

  // ────────── dial ──────────
  describe('dial', () => {
    it('successfully dials when count < 3 and phone exists', async () => {
      // checkDup returns count=1
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 1 } },
        })
        // phone fetch
        .mockResolvedValueOnce({
          data: { code: 0, data: { guardian_phone: '13800138000' } },
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
        JSON.stringify({ studentId: 10, studentName: 'Alice' }),
      );
    });

    it('returns cancelled when confirm is dismissed at count >= 3', async () => {
      api.get.mockResolvedValueOnce({
        data: { code: 0, data: { count: 3 } },
      });
      mockConfirm.mockResolvedValueOnce(false); // user clicks cancel

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(5);
      });

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ title: '拨号频次提醒' }),
      );
      expect(res).toEqual({ ok: false, reason: 'cancelled' });
      // phone should NOT have been fetched
      expect(api.get).toHaveBeenCalledTimes(1);
    });

    it('proceeds after confirm at count >= 3 when user clicks confirm', async () => {
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 5 } },
        })
        .mockResolvedValueOnce({
          data: { code: 0, data: { guardian_phone: '13900139000' } },
        });
      mockConfirm.mockResolvedValueOnce(true);

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(7);
      });

      expect(res).toEqual({ ok: true, phone: '13900139000' });
    });

    it('returns phone_error when phone API fails', async () => {
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockRejectedValueOnce({
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
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockResolvedValueOnce({
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
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockResolvedValueOnce({
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
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockResolvedValueOnce({
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
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockResolvedValueOnce({
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
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockResolvedValueOnce({
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
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockRejectedValueOnce({
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
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockResolvedValueOnce({
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

      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockResolvedValueOnce({
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
      api.get
        .mockResolvedValueOnce({
          data: { code: 0, data: { count: 0 } },
        })
        .mockRejectedValueOnce({});

      const { result } = renderHook(() => useDialFlow());

      let res;
      await act(async () => {
        res = await result.current.dial(19);
      });

      expect(res).toEqual({ ok: false, reason: 'phone_error', message: '获取电话失败' });
    });
  });
});
