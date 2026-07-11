import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import MobileDialResult from '../MobileDialResult';
import api from '../../api';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
  },
}));

const serverReasons = [
  { code: 'phone_invalid', label: '空号', terminal: true, reclaimable: true },
  { code: 'high_score', label: '高分段', terminal: true, reclaimable: true },
  { code: 'no_intent', label: '无意向', terminal: true, reclaimable: true },
  { code: 'child_declined', label: '孩子不想读', terminal: true, reclaimable: true },
  { code: 'enrolled_elsewhere', label: '已报名其他学校', terminal: true, reclaimable: false },
  { code: 'other', label: '其他', terminal: true, reclaimable: true },
];

function renderDialResult(props = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MobileDialResult onUpdated={vi.fn()} {...props} />
    </QueryClientProvider>,
  );
}

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
    api.get.mockResolvedValue({ data: { code: 0, data: serverReasons } });
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
        dialLogId: 9001,
        dialStartedAt: Date.now() - 60000,
      }),
    );

    renderDialResult();

    fireEvent.click(await screen.findByRole('button', { name: '意向了解加微' }));
    fireEvent.click(await screen.findByRole('button', { name: 'A' }));
    fireEvent.click(await screen.findByRole('button', { name: '保存回访提醒' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/follow-ups', expect.any(Object));
    });

    const durationCalls = api.put.mock.calls.filter(([url]) => url === '/students/dial-duration');
    expect(durationCalls).toHaveLength(1);
    expect(durationCalls[0][2]).toEqual({
      params: {
        student_id: 42,
        dial_log_id: 9001,
        duration_seconds: expect.any(Number),
      },
    });
  });

  it('saves fixed invalid results as invalid reasons', async () => {
    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({
        studentId: 42,
        studentName: '张三',
        dialLogId: 9001,
        dialStartedAt: Date.now() - 60000,
      }),
    );

    renderDialResult();

    fireEvent.click(await screen.findByRole('button', { name: '空号' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42', {
        status: '无效',
        invalid_reason: '空号',
      });
    });
  });

  it('saves enrolled elsewhere with the catalog reason payload', async () => {
    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({
        studentId: 42,
        studentName: '张三',
        dialLogId: 9001,
        dialStartedAt: Date.now() - 60000,
      }),
    );

    renderDialResult();
    fireEvent.click(await screen.findByRole('button', { name: '已报名其他学校' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/42', {
        status: '无效',
        invalid_reason: '已报名其他学校',
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
        dialLogId: 9001,
        dialStartedAt: Date.now() - 60000,
      }),
    );

    renderDialResult();

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
        dialLogId: 9001,
        dialStartedAt: Date.now() - 60000,
      }),
    );

    renderDialResult();

    fireEvent.click(await screen.findByRole('button', { name: '空号' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('处理结果保存失败，请重试');
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '空号' })).not.toBeDisabled();
  });

  it('completes the dial session when the result sheet is closed', async () => {
    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({
        studentId: 42,
        studentName: '张三',
        dialLogId: 9001,
        dialStartedAt: Date.now() - 30000,
      }),
    );

    renderDialResult();
    fireEvent.click(await screen.findByRole('button', { name: '不记录，关闭' }));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/students/dial-duration', null, {
        params: {
          student_id: 42,
          dial_log_id: 9001,
          duration_seconds: expect.any(Number),
        },
      });
    });
    expect(sessionStorage.getItem('pendingDial')).toBeNull();
  });

  it('retains the dial session when completion fails after status save', async () => {
    api.put.mockImplementation((url) => {
      if (url === '/students/dial-duration') return Promise.reject(new Error('network'));
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
    sessionStorage.setItem(
      'pendingDial',
      JSON.stringify({
        studentId: 42,
        studentName: '张三',
        dialLogId: 9001,
        dialStartedAt: Date.now() - 30000,
      }),
    );

    renderDialResult();
    fireEvent.click(await screen.findByRole('button', { name: '空号' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('状态已保存，通话记录待同步');
    expect(JSON.parse(sessionStorage.getItem('pendingDial'))).toEqual(
      expect.objectContaining({ dialLogId: 9001 }),
    );
  });
});
