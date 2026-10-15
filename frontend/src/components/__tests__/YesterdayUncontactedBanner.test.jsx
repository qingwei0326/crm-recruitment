import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import YesterdayUncontactedBanner from '../YesterdayUncontactedBanner';
import { selectStaleLeads } from '../../utils/staleLeads';
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
      { id: 101, name: '张三', assigned_at: '2026-06-29 10:00:00', days_since_assigned: 1 },
      { id: 102, name: '李四', assigned_at: '2026-06-28 10:00:00', days_since_assigned: 2 },
      // Handed out late last night: a previous calendar day, but not 24 hours yet.
      { id: 103, name: '王五', assigned_at: '2026-06-29 23:30:00', days_since_assigned: 0 },
    ],
  },
};

describe('selectStaleLeads', () => {
  it('keeps leads waiting a full 24 hours or more and leads with no assignment time', () => {
    const picked = selectStaleLeads([
      { id: 1, days_since_assigned: 0 },
      { id: 2, days_since_assigned: 1 },
      { id: 3, days_since_assigned: 5 },
      { id: 4, days_since_assigned: null },
    ]);
    expect(picked.map((item) => item.id)).toEqual([2, 3, 4]);
  });

  it('tolerates a missing list', () => {
    expect(selectStaleLeads(undefined)).toEqual([]);
  });
});

describe('YesterdayUncontactedBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('shows a non-blocking banner counting only leads waiting 24 hours or more', async () => {
    api.get.mockResolvedValue({ data: stalePayload });

    render(<YesterdayUncontactedBanner user={agent} onHandleNow={vi.fn()} />);

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.getByText(/有 2 个线索分配超过 24 小时还没联系/)).toBeInTheDocument();
    expect(screen.getByText(/最久 2 天/)).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/tasks/yesterday');
  });

  it('stays hidden when everything was assigned less than 24 hours ago', async () => {
    api.get.mockResolvedValue({
      data: { code: 0, data: { stale_unconcat: [stalePayload.data.stale_unconcat[2]] } },
    });

    render(<YesterdayUncontactedBanner user={agent} onHandleNow={vi.fn()} />);

    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('calls onHandleNow and hides when choosing to handle now', async () => {
    const onHandleNow = vi.fn();
    api.get.mockResolvedValue({ data: stalePayload });

    render(<YesterdayUncontactedBanner user={agent} onHandleNow={onHandleNow} />);

    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: '去处理' }));

    expect(onHandleNow).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('stays dismissed for the rest of the session after choosing to ignore it', async () => {
    api.get.mockResolvedValue({ data: stalePayload });

    const { rerender } = render(<YesterdayUncontactedBanner user={agent} onHandleNow={vi.fn()} />);

    await screen.findByRole('status');
    fireEvent.click(screen.getByRole('button', { name: '先不管' }));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    api.get.mockClear();
    rerender(<YesterdayUncontactedBanner user={agent} onHandleNow={vi.fn()} />);

    await waitFor(() => {
      expect(api.get).not.toHaveBeenCalled();
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('does not show for admins or empty stale lists', async () => {
    api.get.mockResolvedValue({ data: { code: 0, data: { stale_unconcat: [] } } });

    const { rerender } = render(
      <YesterdayUncontactedBanner user={{ id: 1, role: 'admin' }} onHandleNow={vi.fn()} />,
    );
    expect(api.get).not.toHaveBeenCalled();

    rerender(<YesterdayUncontactedBanner user={agent} onHandleNow={vi.fn()} />);

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/tasks/yesterday');
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
