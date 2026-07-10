import { beforeEach, describe, expect, it, vi } from 'vitest';

import api from '../api';
import {
  clearPendingDial,
  completePendingDial,
  readPendingDial,
  savePendingDial,
} from '../dialSession';

vi.mock('../api', () => ({
  default: {
    put: vi.fn(),
  },
}));

const pending = () => ({
  studentId: 42,
  studentName: '张三',
  dialLogId: 9001,
  dialStartedAt: Date.now() - 30_000,
});

describe('dialSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    api.put.mockResolvedValue({ data: { code: 0, data: {} } });
  });

  it('persists and clears only the matching session', () => {
    const session = pending();

    expect(savePendingDial(session)).toBe(true);
    expect(readPendingDial()).toEqual(session);
    expect(clearPendingDial(9999)).toBe(false);
    expect(readPendingDial()).toEqual(session);
    expect(clearPendingDial(9001)).toBe(true);
    expect(readPendingDial()).toBeNull();
  });

  it('completes the exact dial log and clears it after success', async () => {
    savePendingDial(pending());

    const result = await completePendingDial(42);

    expect(result).toEqual({ completed: true });
    expect(api.put).toHaveBeenCalledWith('/students/dial-duration', null, {
      params: {
        student_id: 42,
        dial_log_id: 9001,
        duration_seconds: expect.any(Number),
      },
    });
    expect(readPendingDial()).toBeNull();
  });

  it('does nothing when the stored session belongs to another student', async () => {
    savePendingDial(pending());

    await expect(completePendingDial(43)).resolves.toEqual({
      completed: false,
      reason: 'no_match',
    });
    expect(api.put).not.toHaveBeenCalled();
    expect(readPendingDial()).not.toBeNull();
  });

  it('retains the session when duration sync fails', async () => {
    const session = pending();
    savePendingDial(session);
    api.put.mockRejectedValue(new Error('network'));

    await expect(completePendingDial(42)).rejects.toThrow('network');
    expect(readPendingDial()).toEqual(session);
  });

  it('records at least one second for an immediate completion', async () => {
    savePendingDial({ ...pending(), dialStartedAt: Date.now() });

    await completePendingDial(42);

    expect(api.put.mock.calls[0][2].params.duration_seconds).toBe(1);
  });
});
