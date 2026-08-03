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
let mockSourceStats;
let mockStageStats;
let mockFunnelData;

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: mockIsMobile,
}));

vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({
    dark: false,
    toggle: vi.fn(),
  }),
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

vi.mock('../FunnelChart', () => ({
  default: () => <div>funnel chart</div>,
}));

vi.mock('../AdminMobileDash', () => ({
  default: () => <div>mobile admin dashboard page</div>,
}));

function mockDashboardApis() {
  mockDailyOpsData = {
    date: '2026-07-03',
    summary: {
      total_items: 0,
      closed_items: 0,
      pending_items: 0,
      high_pending_items: 0,
      total_count: 0,
    },
    items: [],
  };
  api.post.mockResolvedValue({ data: { code: 0, data: {} } });
  api.get.mockImplementation((url) => {
    if (url === '/admin/daily-ops') {
      return Promise.resolve({ data: { data: mockDailyOpsData } });
    }
    if (url === '/stats/sources') {
      return Promise.resolve({ data: { data: mockSourceStats } });
    }
    if (url === '/stats/dashboard-summary') {
      return Promise.resolve({
        data: {
          data: {
            available_unassigned: 7,
            today_a: 2,
            today_calls: 18,
          },
        },
      });
    }
    if (url === '/visits/summary') {
      return Promise.resolve({ data: { data: null } });
    }
    if (url === '/stats/stages') {
      return Promise.resolve({ data: { data: mockStageStats } });
    }
    if (url === '/students/enrolled?page_size=1') {
      return Promise.resolve({ data: { data: null } });
    }
    if (url === '/stats/funnel') {
      return Promise.resolve({ data: { data: mockFunnelData } });
    }
    if (url === '/students') {
      return Promise.resolve({ data: { data: { total: 0, list: [] } } });
    }
    if (url === '/follow-ups' || url === '/visits') {
      return Promise.resolve({ data: { data: { list: [] } } });
    }
    if (url === '/admin/agent-score-preview') {
      return Promise.resolve({ data: { data: { items: [] } } });
    }
    if (url === '/admin/stale-a') {
      return Promise.resolve({ data: { data: [] } });
    }
    if (url === '/admin/data-quality') {
      return Promise.resolve({ data: { data: { calls: { today: { recorded_calls: 12, unrecorded_calls: 1 } } } } });
    }
    if (url === '/admin/operation-logs?action=通知失败&days=7') {
      return Promise.resolve({ data: { data: { total: 0 } } });
    }
    return Promise.resolve({ data: { data: {} } });
  });
}

describe('AdminDash responsive entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = { id: 1, role: 'admin', name: '管理员', is_super_admin: true };
    mockSourceStats = [];
    mockStageStats = {};
    mockFunnelData = null;
    mockDashboardApis();
  });

  it('uses the mobile admin command center on mobile screens', () => {
    mockIsMobile.mockReturnValue(true);

    render(<AdminDash />);

    expect(screen.getByText('mobile admin dashboard page')).toBeInTheDocument();
  });

  it('routes the desktop call-volume metric through report center', async () => {
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDash />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /今日呼出/ })).toHaveAttribute(
      'href',
      '/admin/report-center?tab=call-volume',
    );
  });

  it('routes desktop lead metrics to matching filtered lead lists', async () => {
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDash />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /可分配有效线索/ })).toHaveAttribute(
      'href',
      '/admin/leads?assignment=unassigned&active=1',
    );
    expect(screen.getByRole('link', { name: /今日新增 A/ })).toHaveAttribute(
      'href',
      '/admin/leads?intent=A&today_a=1',
    );
  });

  it('stacks dashboard modules on compact desktops and uses a 7/5 wide-screen grid', async () => {
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDash />
      </MemoryRouter>,
    );

    await screen.findByText('各阶段线索实时沉淀与工作进展');
    expect(screen.getByTestId('admin-dashboard-scroll')).toHaveClass('h-screen', 'overflow-y-auto');
    const columns = screen.getByTestId('admin-dashboard-columns');
    expect(columns).toHaveClass('grid-cols-1', 'lg:grid-cols-12');
    expect(columns.children[0]).toHaveClass('w-full', 'lg:col-span-7');
    expect(columns.children[1]).toHaveClass('w-full', 'lg:col-span-5');
  });

  it('keeps the desktop todo area focused on actual risk items', async () => {
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDash />
      </MemoryRouter>,
    );

    expect(await screen.findByText('今日暂无待处理风险项')).toBeInTheDocument();
    expect(screen.getByText('今日运营闭环')).toBeInTheDocument();
    expect(screen.getByText('今日运营闭环暂无待处理事项')).toBeInTheDocument();
    expect(screen.queryByText('今日到访')).not.toBeInTheDocument();
    expect(screen.queryByText('求助待处理')).not.toBeInTheDocument();
  });

  it('renders daily ops items and records closure actions', async () => {
    mockDailyOpsData = {
      date: '2026-07-03',
      summary: {
        total_items: 1,
        closed_items: 0,
        pending_items: 1,
        high_pending_items: 1,
        total_count: 3,
      },
      items: [
        {
          key: 'home_visit_due',
          title: '家访待处理',
          count: 3,
          severity: 'high',
          detail: '待确认、已安排或暂缓的家访。',
          to: '/admin/work-center?queue=home_visit',
          status: '待处理',
          is_closed: false,
          owners: [
            {
              agent_id: 7,
              agent_name: '王坐席',
              count: 2,
              max_age_days: 3,
              to: '/admin/work-center?queue=home_visit',
            },
          ],
        },
      ],
    };
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDash />
      </MemoryRouter>,
    );

    expect(await screen.findByText('家访待处理')).toBeInTheDocument();
    expect(screen.getByText('王坐席')).toBeInTheDocument();
    expect(screen.getByText('2项 · 3天')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /查看/ })).toHaveAttribute(
      'href',
      '/admin/work-center?queue=home_visit',
    );
    fireEvent.click(screen.getByRole('button', { name: '确认处理' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admin/daily-ops/reviews', {
        key: 'home_visit_due',
        status: '已处理',
        count: 3,
      });
    });
  });

  it('removes completed daily ops cards from the rail', async () => {
    mockDailyOpsData = {
      date: '2026-07-03',
      summary: {
        total_items: 1,
        closed_items: 1,
        pending_items: 0,
        high_pending_items: 0,
        total_count: 3,
      },
      items: [
        {
          key: 'home_visit_due',
          title: '已完成家访待办',
          count: 3,
          severity: 'low',
          detail: '本批事项已经复核。',
          to: '/admin/work-center?queue=home_visit',
          status: '已处理',
          is_closed: true,
        },
      ],
    };

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminDash />
      </MemoryRouter>,
    );

    expect(await screen.findByText('今日运营闭环暂无待处理事项')).toBeInTheDocument();
    expect(screen.queryByText('已完成家访待办')).not.toBeInTheDocument();
  });

  it('shows retryable panel errors instead of zero and no-risk fallbacks', async () => {
    mockIsMobile.mockReturnValue(false);
    const normalGet = api.get.getMockImplementation();
    api.get.mockImplementation((url, config) => {
      if (url === '/admin/daily-ops') return Promise.reject(new Error('daily ops down'));
      if (url === '/stats/stages') {
        return Promise.resolve({ data: { code: 1, msg: 'stage aggregation failed' } });
      }
      if (url === '/stats/dashboard-summary') {
        return Promise.resolve({ data: { code: 1, msg: 'summary failed' } });
      }
      if (url === '/admin/stale-a') return Promise.reject(new Error('stale queue down'));
      return normalGet(url, config);
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminDash />
      </MemoryRouter>,
    );

    expect(await screen.findByText('运营闭环数据加载失败')).toBeInTheDocument();
    expect(screen.getByText('阶段分布加载失败')).toBeInTheDocument();
    expect(screen.getByText('待办风险数据加载失败')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '重试今日新增 A' })).toBeInTheDocument();
    expect(screen.queryByText('今日运营闭环暂无待处理事项')).not.toBeInTheDocument();
    expect(screen.queryByText('今日暂无待处理风险项')).not.toBeInTheDocument();

    const stageCallsBeforeRetry = api.get.mock.calls.filter(([url]) => url === '/stats/stages').length;
    fireEvent.click(screen.getByRole('button', { name: '重试阶段分布' }));
    await waitFor(() => {
      const stageCalls = api.get.mock.calls.filter(([url]) => url === '/stats/stages').length;
      expect(stageCalls).toBeGreaterThan(stageCallsBeforeRetry);
    });
  });

  it('opens the super admin guide for super admins', async () => {
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDash />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: /可分配有效线索/ });

    expect(mockHelpModal.mock.calls.some(([props]) => props.role === 'super_admin')).toBe(true);
  });

  it('opens the normal admin guide for normal admins', async () => {
    mockUser.current = {
      id: 2,
      role: 'admin',
      name: '普通管理员',
      is_super_admin: false,
      page_permissions: ['leads_manage', 'report_center'],
    };
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDash />
      </MemoryRouter>,
    );

    await screen.findByRole('link', { name: /可分配有效线索/ });

    expect(mockHelpModal.mock.calls.some(([props]) => props.role === 'admin')).toBe(true);
  });

  it('renders stage distribution, funnel, and conversion-ranked regions', async () => {
    mockStageStats = {
      '初次联系': 120,
      '有意向': 35,
      '已报名': 2,
    };
    mockFunnelData = {
      stages: [
        { name: '总线索', value: 52122 },
        { name: 'A 级', value: 45 },
      ],
    };
    mockSourceStats = [
      { source: '龙文区', total: 200, a_count: 30, conversion_rate: 15 },
      { source: '芗城区', total: 100, a_count: 60, conversion_rate: 60 },
    ];
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDash />
      </MemoryRouter>,
    );

    expect(await screen.findByText('各阶段线索实时沉淀与工作进展')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /120.*新线索/ })).toHaveAttribute(
      'href',
      '/admin/leads?stage=%E5%88%9D%E6%AC%A1%E8%81%94%E7%B3%BB',
    );
    expect(screen.getByText('funnel chart')).toBeInTheDocument();
    expect(screen.getByText('芗城区')).toBeInTheDocument();
    expect(screen.getByText('龙文区')).toBeInTheDocument();
  });

  it('does not load the unassigned student table inside the dashboard', async () => {
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <AdminDash />
      </MemoryRouter>,
    );

    await screen.findByText('各阶段线索实时沉淀与工作进展');
    expect(api.get).not.toHaveBeenCalledWith(
      '/students',
      expect.objectContaining({
        params: expect.objectContaining({ assignment: 'unassigned' }),
      }),
    );
  });
});
