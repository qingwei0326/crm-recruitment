import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminMobileDash from '../AdminMobileDash';
import api from '../../../api';

const mockUser = vi.hoisted(() => ({
  current: {
    id: 1,
    role: 'admin',
    name: '管理员',
    is_super_admin: false,
    page_permissions: ['work_center', 'leads_manage', 'score_preview', 'account_manage', 'report_center'],
  },
}));
const mockHelpModal = vi.hoisted(() => vi.fn(() => null));

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
  },
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
    logout: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => true,
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
  }),
}));

vi.mock('../../../components/HelpModal', () => ({
  default: mockHelpModal,
}));

const summaryPayload = {
  total_students: 120,
  contacted: 60,
  a_level: 8,
  today_calls: 12,
  today_a: 2,
  available_unassigned: 5,
  enrolled_total: 3,
};

const qualityPayload = {
  status: 'warning',
  calls: {
    today: { total_calls: 12, recorded_calls: 9, unrecorded_calls: 3 },
    month: { unrecorded_ratio: 25, avg_recorded_duration_seconds: 80 },
  },
  students: {
    missing_phone_tasks: 2,
    unassigned_active: 5,
    invalid_total: 4,
  },
  follow_ups: {
    open_follow_ups: 6,
    overdue_follow_ups: 1,
  },
};

const opsPayload = {
  status: 'warning',
  business: {
    notification_failures_7d: 1,
    locked_users: 0,
  },
};

const scorePayload = {
  items: [
    {
      agent: { id: 7, name: '蒲安琪', username: 'pu' },
      score: 52.5,
      level: 'watch',
      level_label: '关注',
      metrics: {
        today_calls: 4,
        today_recorded_calls: 2,
        today_unrecorded_calls: 2,
        avg_recorded_duration_seconds: 75,
      },
      recommended_action: '先补齐通话记录并处理待回访',
    },
    {
      agent: { id: 8, name: '王坐席', username: 'wang' },
      score: 88,
      level: 'good',
      level_label: '正常',
      metrics: {
        today_calls: 18,
        today_recorded_calls: 18,
        today_unrecorded_calls: 0,
        avg_recorded_duration_seconds: 90,
      },
      recommended_action: '继续推进 A/B 意向线索',
    },
  ],
};

describe('AdminMobileDash', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.current = {
      id: 1,
      role: 'admin',
      name: '管理员',
      is_super_admin: false,
      page_permissions: ['work_center', 'leads_manage', 'score_preview', 'account_manage', 'report_center'],
    };
    api.get.mockImplementation((url) => {
      if (url === '/stats/dashboard-summary') {
        return Promise.resolve({ data: { data: summaryPayload } });
      }
      if (url === '/admin/data-quality') {
        return Promise.resolve({ data: { data: qualityPayload } });
      }
      if (url === '/admin/ops-health') {
        return Promise.resolve({ data: { data: opsPayload } });
      }
      if (url === '/admin/agent-score-preview') {
        return Promise.resolve({ data: { data: scorePayload } });
      }
      return Promise.resolve({ data: { data: {} } });
    });
  });

  it('renders the mobile admin command center with key risk metrics', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminMobileDash />
      </MemoryRouter>,
    );

    expect(await screen.findByText('移动管理')).toBeInTheDocument();
    expect(screen.getByText('今日有事项需要处理')).toBeInTheDocument();
    expect(screen.getByText('今日呼出')).toBeInTheDocument();
    expect(screen.getByText('有效 9 · 未记录 3')).toBeInTheDocument();
    expect(screen.getByText('今日新增 A')).toBeInTheDocument();
    expect(screen.getByText('今日评级进入 A')).toBeInTheDocument();
    expect(screen.getByText('可分配有效线索')).toBeInTheDocument();
    expect(screen.getByText('未分配且仍需跟进')).toBeInTheDocument();
    expect(screen.getByText('需关注坐席')).toBeInTheDocument();
    expect(screen.getByText('逾期回访')).toBeInTheDocument();
    expect(screen.getByText('逾期 1 条 · 未完成 6 条')).toBeInTheDocument();
    expect(screen.getByText('无电话数据')).toBeInTheDocument();
    expect(screen.getByText('2 条线索没有可拨电话')).toBeInTheDocument();
    expect(screen.getByText('未记录通话')).toBeInTheDocument();
    expect(screen.getByText('今日 3 通，本月占比 25%')).toBeInTheDocument();
    expect(screen.getByText('蒲安琪')).toBeInTheDocument();
    expect(screen.getByText('先补齐通话记录并处理待回访')).toBeInTheDocument();
    expect(screen.getByText('A 级线索')).toBeInTheDocument();
    expect(screen.getByText('当前 8 条重点线索')).toBeInTheDocument();
  });

  it('routes mobile lead metrics to matching filtered lead lists', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminMobileDash />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /今日新增 A/ })).toHaveAttribute(
      'href',
      '/admin/leads?intent=A&today_a=1',
    );
    expect(screen.getByRole('link', { name: /可分配有效线索/ })).toHaveAttribute(
      'href',
      '/admin/leads?assignment=unassigned&active=1',
    );
    expect(screen.getByRole('link', { name: /无电话数据/ })).toHaveAttribute(
      'href',
      '/admin/leads?active=1&missing_phone=1',
    );
  });

  it('loads the existing admin summary, data quality, ops and score APIs', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminMobileDash />
      </MemoryRouter>,
    );

    await screen.findByText('移动管理');
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/stats/dashboard-summary');
      expect(api.get).toHaveBeenCalledWith('/admin/data-quality');
      expect(api.get).toHaveBeenCalledWith('/admin/ops-health');
      expect(api.get).toHaveBeenCalledWith('/admin/agent-score-preview', {
        params: { daily_call_target: 30 },
      });
    });
  });

  it('uses the admin guide on mobile for normal admins', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminMobileDash />
      </MemoryRouter>,
    );

    await screen.findByText('移动管理');

    expect(mockHelpModal.mock.calls.some(([props]) => props.role === 'admin')).toBe(true);
  });

  it('uses the super admin guide on mobile for super admins', async () => {
    mockUser.current = { id: 2, role: 'admin', name: '超管', is_super_admin: true };

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminMobileDash />
      </MemoryRouter>,
    );

    await screen.findByText('移动管理');

    expect(mockHelpModal.mock.calls.some(([props]) => props.role === 'super_admin')).toBe(true);
  });
});
