import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SystemSettings from '../SystemSettings';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
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
  default: () => false,
}));

const opsPayload = {
  status: 'warning',
  generated_at: '2026-06-27T15:30:00',
  database: { status: 'ok', db_ms: 4 },
  backups: {
    status: 'ok',
    count: 2,
    max_keep: 7,
    latest: { name: 'crm_20260627_101010.db', modified_at: '2026-06-27T10:10:10', size: 4096 },
  },
  logs: {
    status: 'ok',
    files: [
      { name: 'backend.log', exists: true },
      { name: 'backend_stderr.log', exists: false },
    ],
  },
  business: {
    active_agents: 3,
    locked_users: 1,
    unassigned_active: 5,
    overdue_follow_ups: 2,
    notification_failures_7d: 1,
    frontend_errors_24h: 1,
  },
};

const qualityPayload = {
  status: 'warning',
  generated_at: '2026-06-27T16:30:00',
  calls: {
    today: { total_calls: 3, recorded_calls: 2, unrecorded_calls: 1 },
    month: {
      total_calls: 10,
      recorded_calls: 7,
      unrecorded_calls: 3,
      unrecorded_ratio: 30,
      avg_recorded_duration_seconds: 75,
    },
    agents: [
      {
        agent_id: 7,
        agent_name: '蒲安琪',
        total_calls: 10,
        recorded_calls: 7,
        unrecorded_calls: 3,
        unrecorded_ratio: 30,
        avg_recorded_duration_seconds: 75,
      },
    ],
  },
  students: {
    missing_phone_tasks: 2,
    unassigned_active: 5,
    invalid_total: 4,
    invalid_reasons: [{ reason: '空号', count: 2 }],
  },
  follow_ups: { open_follow_ups: 4, overdue_follow_ups: 1 },
};

describe('SystemSettings ops health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockImplementation((url) => {
      if (url === '/admin/config') {
        return Promise.resolve({ data: { data: { score_daily_call_target: '35' } } });
      }
      if (url === '/admin/backups') {
        return Promise.resolve({ data: { data: [] } });
      }
      if (url === '/admin/ops-health') {
        return Promise.resolve({ data: { data: opsPayload } });
      }
      if (url === '/admin/data-quality') {
        return Promise.resolve({ data: { data: qualityPayload } });
      }
      return Promise.resolve({ data: { data: {} } });
    });
  });

  it('loads and renders admin ops health metrics', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/settings']}>
        <SystemSettings />
      </MemoryRouter>,
    );

    expect(await screen.findByText('运行状态')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/admin/ops-health');
    expect(screen.getAllByText('需关注').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('4 ms')).toBeInTheDocument();
    expect(screen.getByText('2026-06-27 10:10:10')).toBeInTheDocument();
    expect(screen.getByText('2/7')).toBeInTheDocument();
    expect(screen.getByText('日志文件：1 个可用')).toBeInTheDocument();
    expect(screen.getByText('活跃话务员')).toBeInTheDocument();
    expect(screen.getByText('评分设置')).toBeInTheDocument();
    expect(screen.getByLabelText('默认通话目标')).toHaveValue(35);
    expect(api.get).toHaveBeenCalledWith('/admin/data-quality');
    expect(screen.getByText('数据质量')).toBeInTheDocument();
    expect(screen.getByText('本月未记录')).toBeInTheDocument();
    expect(screen.getByText('平均有效时长')).toBeInTheDocument();
    expect(screen.getByText('1分15秒')).toBeInTheDocument();
    expect(screen.getByText('蒲安琪')).toBeInTheDocument();
    expect(screen.getByText('空号')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /可分配有效线索/ })[0]).toHaveAttribute(
      'href',
      '/admin/leads?assignment=unassigned&active=1',
    );
    expect(screen.getByRole('link', { name: /无电话数据/ })).toHaveAttribute(
      'href',
      '/admin/leads?active=1&missing_phone=1',
    );
    expect(screen.getAllByRole('link', { name: /逾期回访/ })[0]).toHaveAttribute(
      'href',
      '/admin/work-center?queue=follow',
    );
    expect(screen.getByRole('link', { name: /今日未记录/ })).toHaveAttribute(
      'href',
      '/admin/report-center?tab=call-volume',
    );
    expect(screen.getByRole('link', { name: /无效线索/ })).toHaveAttribute(
      'href',
      '/admin/invalid-reclaim',
    );
  });

  it('saves the default score call target', async () => {
    api.put.mockResolvedValue({ data: { code: 0, data: { key: 'score_daily_call_target', value: '42' } } });
    render(
      <MemoryRouter initialEntries={['/admin/settings']}>
        <SystemSettings />
      </MemoryRouter>,
    );

    const input = await screen.findByLabelText('默认通话目标');
    fireEvent.change(input, { target: { value: '42' } });
    fireEvent.click(screen.getAllByRole('button', { name: '保存' }).at(-1));

    await waitFor(() => {
      expect(api.put).toHaveBeenCalledWith('/admin/config', {
        key: 'score_daily_call_target',
        value: '42',
      });
    });
  });
});
