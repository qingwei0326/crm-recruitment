import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminSidebar, { ADMIN_NAV_ITEMS } from '../AdminSidebar';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', name: '管理员' },
    logout: vi.fn(),
  }),
}));

vi.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    dark: false,
    toggle: vi.fn(),
  }),
}));

vi.mock('../../hooks/useIsMobile', () => ({
  default: () => false,
}));

describe('AdminSidebar', () => {
  it('contains every admin entry in one shared navigation', () => {
    render(
      <MemoryRouter initialEntries={['/admin/governance']}>
        <AdminSidebar onClose={vi.fn()} />
      </MemoryRouter>,
    );

    ADMIN_NAV_ITEMS.forEach((item) => {
      expect(screen.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to);
    });
    expect(screen.getByRole('button', { name: '暗色模式' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeInTheDocument();
  });
  it('uses one lead governance entry instead of separate reclaim/distribute entries', () => {
    render(
      <MemoryRouter initialEntries={['/admin/governance']}>
        <AdminSidebar onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: '线索治理' })).toHaveAttribute('href', '/admin/governance');
    expect(screen.getByRole('link', { name: '评分预览' })).toHaveAttribute('href', '/admin/score-preview');
    expect(screen.queryByRole('link', { name: '线索回收' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '无效线索回收' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '多学校分发' })).not.toBeInTheDocument();
  });
});
