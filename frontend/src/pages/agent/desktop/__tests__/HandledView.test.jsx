import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HandledView from '../HandledView';
import api from '../../../../api';

vi.mock('../../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

describe('HandledView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    api.get.mockImplementation((url) => {
      if (url === '/personal-groups') {
        return Promise.resolve({ data: { code: 0, data: [{ id: 8, name: '今晚再打', member_count: 2 }] } });
      }
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            total: 3,
            counts: { 已联系: 1, 未接: 1, 待回访: 1 },
            list: [],
          },
        },
      });
    });
    api.post.mockResolvedValue({ data: { code: 0, data: { added_count: 1 } } });
  });

  it('renders all handled status filters and fetches follow-up status', async () => {
    render(<HandledView onOpenDetail={vi.fn()} />);

    expect(await screen.findByRole('button', { name: '全部 3' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '已联系 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '未接 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '待回访 1' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '待回访 1' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 50, offset: 0, status: '待回访' },
      });
    });
  });

  it('passes intent filter to handled tasks request', async () => {
    render(<HandledView onOpenDetail={vi.fn()} />);

    expect(await screen.findByRole('button', { name: '全部意向' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'A' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 50, offset: 0, intent_level: 'A' },
      });
    });
  });

  it('passes waiting-volunteer result filter to handled tasks request', async () => {
    render(<HandledView onOpenDetail={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '等待志愿' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 50, offset: 0, status_detail: '等待志愿' },
      });
    });
  });

  it('passes a private group filter to handled tasks request', async () => {
    render(<HandledView onOpenDetail={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '今晚再打 2' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 50, offset: 0, personal_group_id: 8 },
      });
    });
  });

  it('passes the ungrouped filter separately from a group id', async () => {
    render(<HandledView onOpenDetail={vi.fn()} />);

    fireEvent.click(await screen.findByRole('button', { name: '未分组' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/tasks/handled', {
        params: { limit: 50, offset: 0, ungrouped: true },
      });
    });
  });

  it('shows group badges and batch-adds selected students', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/personal-groups') {
        return Promise.resolve({
          data: { code: 0, data: [{ id: 8, name: '今晚再打', color: 'cyan', member_count: 2 }] },
        });
      }
      return Promise.resolve({
        data: {
          code: 0,
          data: {
            total: 1,
            list_total: 1,
            counts: { 已联系: 1 },
            list: [{
              id: 11,
              name: '林同学',
              status: '已联系',
              school_name: '一中',
              personal_groups: [{ id: 8, name: '今晚再打', color: 'cyan' }],
            }],
          },
        },
      });
    });
    render(<HandledView onOpenDetail={vi.fn()} />);

    expect(await screen.findByText('林同学')).toBeInTheDocument();
    expect(screen.getByText('今晚再打', { selector: 'span' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '批量整理' }));
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 林同学' }));
    fireEvent.change(screen.getByRole('combobox', { name: '批量加入的分组' }), {
      target: { value: '8' },
    });
    fireEvent.click(screen.getByRole('button', { name: '加入' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/personal-groups/8/members', {
        student_ids: [11],
      });
    });
  });
});
