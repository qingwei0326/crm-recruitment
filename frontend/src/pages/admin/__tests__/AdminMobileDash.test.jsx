import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminMobileDash from '../AdminMobileDash';
import api from '../../../api';

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
    user: { id: 1, role: 'admin', name: '管理员' },
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

const summaryPayload = {
  total_students: 120,
  contacted: 60,
  a_level: 8,
  today_calls: 12,
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
      <MemoryRouter initialEntries={['/admin']}>
        <AdminMobileDash />
      </MemoryRouter>,
    );

    expect(await screen.findByText('移动管理')).toBeInTheDocument();
    expect(screen.getByText('今日有事项需要处理')).toBeInTheDocument();
    expect(screen.getByText('今日拨号')).toBeInTheDocument();
    expect(screen.getByText('有效 9 · 未记录 3')).toBeInTheDocument();
    expect(screen.getByText('逾期回访')).toBeInTheDocument();
    expect(screen.getByText('未分配线索')).toBeInTheDocument();
    expect(screen.getByText('需关注坐席')).toBeInTheDocument();
    expect(screen.getByText('缺电话任务')).toBeInTheDocument();
    expect(screen.getByText('2 条待补手机号')).toBeInTheDocument();
    expect(screen.getByText('未记录通话')).toBeInTheDocument();
    expect(screen.getByText('今日 3 通，本月占比 25%')).toBeInTheDocument();
    expect(screen.getByText('蒲安琪')).toBeInTheDocument();
    expect(screen.getByText('先补齐通话记录并处理待回访')).toBeInTheDocument();
    expect(screen.getByText('A 级意向')).toBeInTheDocument();
    expect(screen.getByText('8 条重点线索')).toBeInTheDocument();
  });

  it('loads the existing admin summary, data quality, ops and score APIs', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
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
});
