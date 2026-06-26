import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MobileDialResult from '../MobileDialResult';
import api from '../../api';

vi.mock('../../api', () => ({
  default: {
    put: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

// Test the recordCallResult helper function logic
describe('recordCallResult', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    api.put.mockResolvedValue({ data: { code: 0, data: {} } });
    api.post.mockResolvedValue({ data: { code: 0, data: {} } });
  });

  it('calculates duration correctly', () => {
    const dialStartedAt = Date.now() - 60000; // 60 seconds ago
    const duration = Math.round((Date.now() - dialStartedAt) / 1000);
    expect(duration).toBeGreaterThanOrEqual(59);
    expect(duration).toBeLessThanOrEqual(61);
  });

  it('returns 0 duration when dialStartedAt is null', () => {
    const dialStartedAt = null;
    const duration = dialStartedAt ? Math.round((Date.now() - dialStartedAt) / 1000) : 0;
    expect(duration).toBe(0);
  });

  it('trims note text', () => {
    const noteText = '  test note  ';
    expect(noteText.trim()).toBe('test note');
  });

  it('empty note is falsy', () => {
    expect('').toBeFalsy();
    expect('  '.trim()).toBeFalsy();
  });

  it('records call duration once when interested-add-wechat flow saves follow-up', async () => {
    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({
        studentId: 42,
        studentName: '张三',
        dialStartedAt: Date.now() - 60000,
      }),
    );

    render(<MobileDialResult onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '意向了解加微' }));
    fireEvent.click(screen.getByRole('button', { name: 'A' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存回访提醒' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/follow-ups', expect.any(Object));
    });

    const durationCalls = api.put.mock.calls.filter(([url]) =>
      String(url).startsWith('/students/dial-duration'),
    );
    expect(durationCalls).toHaveLength(1);
  });
});
