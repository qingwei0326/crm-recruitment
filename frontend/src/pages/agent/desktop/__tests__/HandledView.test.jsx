import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HandledView from '../HandledView';
import api from '../../../../api';

vi.mock('../../../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

describe('HandledView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({
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
});
