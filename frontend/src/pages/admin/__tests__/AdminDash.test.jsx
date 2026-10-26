import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminDash from '../AdminDash';
import api from '../../../api';

const mockIsMobile = vi.hoisted(() => vi.fn());
const mockUser = vi.hoisted(() => ({
  current: { id: 1, role: 'admin', name: '管理员', is_super_admin: true },
}));
const mockHelpModal = vi.hoisted(() => vi.fn(() => null));
let mockDailyOpsData;

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: mockIsMobile,
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser.current,
  }),
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
  }),
}));

vi.mock('../../../components/AdminLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../../../components/PageHeader', () => ({
  default: ({ title, children }) => (
    <header>
      <h1>{title}</h1>
      {children}
    </header>
  ),
}));

vi.mock('../../../components/HelpModal', () => ({
  default: mockHelpModal,
}));

vi.mock('../AdminMobileDash', () => ({
  default: () => <div>mobile admin dashboard page</div>,
}));

function dailyItem(overrides) {
  return {
    key: 'home_visit_due',
    title: '家访待处理',
    count: 3,
    severity: 'high',
    detail: '待确认、已安排或暂缓的家访。',
    to: '/admin/work-center?queue=home_visit',
    owners: [],
    ...overrides,
  };
}

function mockDashboardApis() {
  mockDailyOpsData = { date: '2026-07-03', summary: { total_items: 0, total_count: 0 }, items: [] };
  api.get.mockImplementation((url) => {
    if (url === '/admin/daily-ops') {
      return Promise.resolve({ data: { data: mockDailyOpsData } });
    }
    if (url === '/stats/dashboard-all') {
      return Promise.resolve({
        data: {
          data: {
            summary: {
              available_unassigned: 7,
              today_a: 2,
              today_calls: 18,
              a_level: 40,
              enrolled_total: 5,
              total_students: 1200,
              today_new_leads: 30,
            },
          },
        },
      });
    }
    return Promise.resolve({ data: { data: {} } });
  });
}

function renderDesktop() {
  mockIsMobile.mockReturnValue(false);
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
      <AdminDash />
    </MemoryRouter>,
  );
}

describe('AdminDash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = { id: 1, role: 'admin', name: '管理员', is_super_admin: true };
    mockDashboardApis();
  });

  it('uses the mobile admin command center on mobile screens', () => {
    mockIsMobile.mockReturnValue(true);

    render(<AdminDash />);

    expect(screen.getByText('mobile admin dashboard page')).toBeInTheDocument();
  });

  it('shows three blocks: key numbers, today’s to-do list and team progress', async () => {
    renderDesktop();

    expect(await screen.findByRole('link', { name: '今日呼出 18' })).toHaveAttribute(
      'href',
      '/admin/report-center?tab=call-volume',
    );
    expect(screen.getByRole('region', { name: '关键数字' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: '今日待处理' })).toBeInTheDocument();
    expect(screen.getByTestId('admin-team-progress')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'A 级意向 40' })).toBeInTheDocument();
    expect(screen.getByText('今日新增 2')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '总线索 1,200' })).toHaveAttribute('href', '/admin/leads');
    expect(screen.getByRole('link', { name: /完整报表/ })).toHaveAttribute('href', '/admin/report-center');
  });

  it('loads only the daily list and the summary, not the old panel feeds', async () => {
    renderDesktop();

    await screen.findByRole('link', { name: '今日呼出 18' });
    const urls = api.get.mock.calls.map(([url]) => url);
    expect(urls).toEqual(expect.arrayContaining(['/admin/daily-ops', '/stats/dashboard-all']));
    for (const dropped of [
      '/admin/stale-a',
      '/follow-ups',
      '/admin/agent-score-preview',
      '/admin/data-quality',
      '/stats/trend',
      '/students',
    ]) {
      expect(urls).not.toContain(dropped);
    }
  });

  it('points 已报名 at the settlement page while reports wait for confirmation', async () => {
    mockDailyOpsData.items = [
      dailyItem({
        key: 'pending_enrollment_reports',
        title: '报名待确认',
        count: 2,
        to: '/admin/enrollment-settlement',
      }),
    ];

    renderDesktop();

    expect(await screen.findByText('另有 2 条待确认')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '已报名 5' })).toHaveAttribute(
      'href',
      '/admin/enrollment-settlement',
    );
    expect(screen.getByText('报名待确认')).toBeInTheDocument();
  });

  it('lists the waiting items with the agents behind them and hides empty ones', async () => {
    mockDailyOpsData.items = [
      dailyItem({
        owners: [
          { agent_id: 7, agent_name: '王坐席', count: 2, max_age_days: 3, to: '/admin/work-center?queue=home_visit' },
        ],
      }),
      dailyItem({ key: 'help_requests', title: '已清空的求助', count: 0 }),
    ];

    renderDesktop();

    expect(await screen.findByText('家访待处理')).toBeInTheDocument();
    expect(screen.getByText('王坐席')).toBeInTheDocument();
    expect(screen.getByText('2项 · 3天')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /去处理/ })).toHaveAttribute(
      'href',
      '/admin/work-center?queue=home_visit',
    );
    expect(screen.queryByText('已清空的求助')).not.toBeInTheDocument();
    expect(screen.getByText('1 类')).toBeInTheDocument();
  });

  it('says so when nothing is waiting', async () => {
    renderDesktop();

    expect(await screen.findByText('今天没有待处理事项')).toBeInTheDocument();
  });

  it('shows retryable errors instead of zeros when a feed fails', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/admin/daily-ops') return Promise.reject(new Error('daily ops down'));
      if (url === '/stats/dashboard-all') {
        return Promise.resolve({ data: { code: 1, msg: 'dashboard aggregation failed' } });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    renderDesktop();

    expect(await screen.findByText('待处理事项加载失败')).toBeInTheDocument();
    expect(screen.getAllByText('--').length).toBe(5);
    expect(screen.queryByText('今天没有待处理事项')).not.toBeInTheDocument();

    const callsBefore = api.get.mock.calls.filter(([url]) => url === '/admin/daily-ops').length;
    fireEvent.click(screen.getByRole('button', { name: '重试待处理事项' }));
    await waitFor(() => {
      const calls = api.get.mock.calls.filter(([url]) => url === '/admin/daily-ops').length;
      expect(calls).toBeGreaterThan(callsBefore);
    });
  });

  it('opens the super admin guide for super admins', async () => {
    renderDesktop();

    await screen.findByRole('link', { name: '今日呼出 18' });

    expect(mockHelpModal.mock.calls.some(([props]) => props.role === 'super_admin')).toBe(true);
  });

  it('opens the normal admin guide and drops links the admin cannot open', async () => {
    mockUser.current = {
      id: 2,
      role: 'admin',
      name: '普通管理员',
      is_super_admin: false,
      page_permissions: ['leads_manage'],
    };

    renderDesktop();

    await screen.findByRole('link', { name: '可分配线索 7' });
    expect(mockHelpModal.mock.calls.some(([props]) => props.role === 'admin')).toBe(true);
    expect(screen.queryByRole('link', { name: /今日呼出/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /完整报表/ })).not.toBeInTheDocument();
  });
});
