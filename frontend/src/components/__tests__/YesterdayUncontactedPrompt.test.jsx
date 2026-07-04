import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import YesterdayUncontactedPrompt from '../YesterdayUncontactedPrompt';
import api from '../../api';

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

const agent = { id: 7, role: 'agent', name: '话务员' };

const stalePayload = {
  code: 0,
  data: {
    stale_unconcat: [
      {
        id: 101,
        name: '张三',
        school_name: '长泰二中',
        region: '长泰',
        assigned_at: '2026-06-29 10:00:00',
        days_since_assigned: 1,
      },
      {
        id: 102,
        name: '李四',
        school_name: '长泰一中',
        region: '长泰',
        assigned_at: '2026-06-28 10:00:00',
        days_since_assigned: 2,
      },
    ],
  },
};

describe('YesterdayUncontactedPrompt', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows yesterday uncontacted students for agents', async () => {
    api.get.mockResolvedValue({ data: stalePayload });

    render(<YesterdayUncontactedPrompt user={agent} onHandleNow={vi.fn()} />);

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('昨日遗留未联系 2 个')).toBeInTheDocument();
    expect(screen.getByText('张三')).toBeInTheDocument();
    expect(screen.getByText('李四')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/tasks/yesterday');
  });

  it('calls onHandleNow and closes when choosing to handle now', async () => {
    const onHandleNow = vi.fn();
    api.get.mockResolvedValue({ data: stalePayload });

    render(<YesterdayUncontactedPrompt user={agent} onHandleNow={onHandleNow} />);

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '先处理' }));

    expect(onHandleNow).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('dismisses the reminder for the current session after choosing later', async () => {
    api.get.mockResolvedValue({ data: stalePayload });

    const { rerender } = render(
      <YesterdayUncontactedPrompt user={agent} onHandleNow={vi.fn()} />,
    );

    await screen.findByRole('dialog');
    fireEvent.click(screen.getByRole('button', { name: '稍后' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    api.get.mockClear();
    rerender(<YesterdayUncontactedPrompt user={agent} onHandleNow={vi.fn()} />);

    await waitFor(() => {
      expect(api.get).not.toHaveBeenCalled();
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not show for admins or empty stale lists', async () => {
    api.get.mockResolvedValue({ data: { code: 0, data: { stale_unconcat: [] } } });

    const { rerender } = render(
      <YesterdayUncontactedPrompt user={{ id: 1, role: 'admin' }} onHandleNow={vi.fn()} />,
    );
    expect(api.get).not.toHaveBeenCalled();

    rerender(<YesterdayUncontactedPrompt user={agent} onHandleNow={vi.fn()} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/tasks/yesterday');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
