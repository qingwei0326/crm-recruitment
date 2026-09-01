import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SeasonArchive from '../SeasonArchive';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({ dark: false, toggle: vi.fn() }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('../../../components/AdminLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

const preview = {
  student_count: 1,
  student_id_hash: '1234567890abcdef1234567890abcdef',
  counts: {
    students: 1,
    calls: 2,
    notes: 3,
    follow_ups: 1,
  },
  latest_backup: { name: 'crm_20260823_120000.db' },
};

const prepared = {
  ready: true,
  archive_id: 'season-archive-1',
  name: 'crm_season_20260823_120000_abc.zip',
  size: 2048,
  backup_name: 'crm_20260823_120000.db',
  confirm_text: '清理本招生季',
  counts: preview.counts,
  backup: { valid: true, size: 4096, integrity_check: 'ok' },
};

describe('SeasonArchive', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { code: 0, data: preview } });
    api.post.mockImplementation((url) => {
      if (url.endsWith('/prepare')) return Promise.resolve({ data: { code: 0, data: prepared } });
      return Promise.resolve({ data: { code: 0, data: { deleted: true } } });
    });
  });

  it('shows current-season counts and backup status', async () => {
    render(
      <MemoryRouter>
        <SeasonArchive />
      </MemoryRouter>,
    );

    expect(await screen.findByText('当前招生季数据')).toBeInTheDocument();
    expect(screen.getByText(/crm_20260823_120000\.db/)).toBeInTheDocument();
    expect(screen.getByText('通话')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('requires the generated confirmation phrase before cleanup', async () => {
    render(
      <MemoryRouter>
        <SeasonArchive />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByRole('button', { name: '生成导出并校验备份' }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/season-archive/prepare'));

    const cleanupButton = screen.getByRole('button', { name: '确认并清理本招生季' });
    expect(cleanupButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('输入确认词：清理本招生季'), {
      target: { value: '清理本招生季' },
    });
    expect(cleanupButton).toBeEnabled();
    fireEvent.click(cleanupButton);

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admin/season-archive/cleanup', {
        archive_id: prepared.archive_id,
        export_name: prepared.name,
        backup_name: prepared.backup_name,
        confirm_text: '清理本招生季',
        reason: '本招生季结束，已完成导出和数据库备份校验',
      });
    });
  });
});
