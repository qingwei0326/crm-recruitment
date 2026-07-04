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
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/governance']}>
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
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminSidebar onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: '系统设置' })).not.toBeInTheDocument();
    ADMIN_NAV_ITEMS.filter((item) => item.permission).forEach((item) => {
      expect(screen.queryByRole('link', { name: item.label })).not.toBeInTheDocument();
    });
    ADMIN_NAV_ITEMS.filter((item) => !item.superOnly).forEach((item) => {
      if (!item.permission) {
        expect(screen.getByRole('link', { name: item.label })).toHaveAttribute('href', item.to);
      }
    });
  });
  it('shows granted page-permission entries for normal admins', () => {
    mockUser = {
      id: 3,
      role: 'admin',
      name: '普通管理员',
      is_super_admin: false,
      page_permissions: ['score_preview', 'report_center', 'home_visits', 'leads_manage'],
    };

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminSidebar onClose={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: '评分预览' })).toHaveAttribute(
      'href',
      '/admin/score-preview',
    );
    expect(screen.getByRole('link', { name: '报表中心' })).toHaveAttribute(
      'href',
      '/admin/report-center',
    );
    expect(screen.getByRole('link', { name: '家访任务' })).toHaveAttribute(
      'href',
      '/admin/home-visits',
    );
    expect(screen.getByRole('link', { name: '学生管理' })).toHaveAttribute(
      'href',
      '/admin/leads',
    );
    expect(screen.getByRole('link', { name: '全局搜索' })).toHaveAttribute(
      'href',
      '/admin/search',
    );
    expect(screen.queryByRole('link', { name: '账号管理' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '操作记录' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: '系统设置' })).not.toBeInTheDocument();
  });
  it('uses one lead governance entry instead of separate reclaim/distribute entries', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/governance']}>
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
