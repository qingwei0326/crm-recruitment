import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminSidebar, { ADMIN_NAV_ITEMS } from '../AdminSidebar';

let mockUser;

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
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
  beforeEach(() => {
    mockUser = { id: 1, role: 'admin', name: '管理员', is_super_admin: true };
  });

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
  it('hides super-admin-only entries for normal admins', () => {
    mockUser = { id: 2, role: 'admin', name: '普通管理员', is_super_admin: false };

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminSidebar onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: '系统设置' })).not.toBeInTheDocument();
    ADMIN_NAV_ITEMS.filter((item) => !item.superOnly).forEach((item) => {
      expect(screen.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to);
    });
  });
  it('uses one lead governance entry instead of separate reclaim/distribute entries', () => {
    render(
      <MemoryRouter initialEntries={['/admin/governance']}>
        <AdminSidebar onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: '线索治理' })).toHaveAttribute('href', '/admin/governance');
    expect(screen.getByRole('link', { name: '评分预览' })).toHaveAttribute('href', '/admin/score-preview');
    expect(screen.getByRole('link', { name: '报表中心' })).toHaveAttribute('href', '/admin/report-center');
    expect(screen.queryByRole('link', { name: '汇总报表' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '趋势报表' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '通电量查询' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '线索回收' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '无效线索回收' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '多学校分发' })).not.toBeInTheDocument();
  });
});
