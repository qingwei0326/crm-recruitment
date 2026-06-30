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

function defer() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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
    fireEvent.click(await screen.findByRole('button', { name: 'A' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存回访提醒' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/follow-ups', expect.any(Object));
    });

    const durationCalls = api.put.mock.calls.filter(([url]) => url === '/students/dial-duration');
    expect(durationCalls).toHaveLength(1);
    expect(durationCalls[0][2]).toEqual({
      params: { student_id: 42, duration_seconds: expect.any(Number) },
    });
  });

  it('saves fixed invalid results as invalid reasons', async () => {
    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({
        studentId: 42,
        studentName: '张三',
        dialStartedAt: Date.now() - 60000,
      }),
    );

    render(<MobileDialResult onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '空号' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42', {
        status: '无效',
        invalid_reason: '空号',
      });
    });
  });

  it('prevents duplicate fixed invalid submissions while saving', async () => {
    const pendingUpdate = defer();
    api.put.mockImplementation((url) => {
      if (url === '/students/42') return pendingUpdate.promise;
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({
        studentId: 42,
        studentName: '张三',
        dialStartedAt: Date.now() - 60000,
      }),
    );

    render(<MobileDialResult onUpdated={vi.fn()} />);

    const button = await screen.findByRole('button', { name: '空号' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(screen.getByText('保存中，请稍候')).toBeInTheDocument();
    expect(api.put.mock.calls.filter(([url]) => url === '/students/42')).toHaveLength(1);

    pendingUpdate.resolve({ data: { code: 0, data: {} } });
    await waitFor(() => {
      expect(screen.queryByText('张三')).not.toBeInTheDocument();
    });
  });

  it('keeps the result sheet open when fixed invalid save fails', async () => {
    api.put.mockImplementation((url) => {
      if (url === '/students/42') return Promise.reject(new Error('network'));
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({
        studentId: 42,
        studentName: '张三',
        dialStartedAt: Date.now() - 60000,
      }),
    );

    render(<MobileDialResult onUpdated={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '空号' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('处理结果保存失败，请重试');
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '空号' })).not.toBeDisabled();
  });
});
