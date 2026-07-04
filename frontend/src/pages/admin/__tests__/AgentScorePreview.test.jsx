import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentScorePreview from '../AgentScorePreview';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: {
      id: 1,
      role: 'admin',
      name: '管理员',
      page_permissions: ['work_center', 'leads_manage', 'account_manage', 'report_center'],
    },
    logout: vi.fn(),
  }),
}));

vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({
    dark: false,
    toggle: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

function makeItem(overrides = {}) {
  const base = {
    agent: {
      id: 2,
      name: '王坐席',
      username: 'agentwang',
      is_active: true,
      service_regions: '龙海',
    },
    score: 48.5,
    level: 'risk',
    level_label: '风险',
    components: {
      task_progress: {
        label: '任务推进',
        score: 10,
        max: 30,
        detail: '推进率 33.3%，待联系 8/12',
        parts: [
          { label: '推进覆盖', score: 6.7, max: 20 },
          { label: '待联系清理', score: 3.3, max: 10 },
        ],
      },
      call_activity: { label: '今日通话', score: 5, max: 25, detail: '6/30 通' },
      follow_up_timeliness: { label: '回访及时', score: 0, max: 20 },
      intent_output: { label: '有效产出', score: 8, max: 15 },
      data_completeness: { label: '资料完整', score: 7, max: 10 },
    },
    metrics: {
      active_tasks: 12,
      progress_pct: 33.3,
      today_calls: 6,
      today_recorded_calls: 4,
      today_unrecorded_calls: 2,
      avg_recorded_duration_seconds: 60,
      open_follow_ups: 3,
      overdue_follow_ups: 2,
      missing_phone_tasks: 0,
      a_level_count: 1,
      enrolled_count: 1,
      notes_today: 4,
      data_completeness_pct: 70,
    },
    signals: [
      {
        key: 'overdue_follow_ups',
        severity: 'critical',
        label: '2 条逾期回访',
        count: 2,
      },
    ],
    recommended_action: '先处理逾期回访，防止高意向线索流失',
  };
  return {
    ...base,
    ...overrides,
    agent: { ...base.agent, ...(overrides.agent || {}) },
    metrics: { ...base.metrics, ...(overrides.metrics || {}) },
    signals: overrides.signals || base.signals,
  };
}

function scorePayload() {
  return {
    generated_at: '2026-06-26T10:00:00',
    daily_call_target: 30,
    items: [
      makeItem(),
      makeItem({
        agent: { id: 3, name: '李坐席', username: 'agentli', service_regions: '芗城' },
        score: 82,
        level: 'good',
        level_label: '正常',
        metrics: {
          today_calls: 18,
          today_recorded_calls: 18,
          today_unrecorded_calls: 0,
          avg_recorded_duration_seconds: 90,
          overdue_follow_ups: 0,
          a_level_count: 0,
        },
        signals: [],
        recommended_action: '继续推进 A/B 意向线索到回访或到访',
      }),
      makeItem({
        agent: { id: 4, name: '赵坐席', username: 'agentzhao', service_regions: '漳浦' },
        score: 62,
        level: 'watch',
        level_label: '关注',
        metrics: {
          today_calls: 1,
          today_recorded_calls: 0,
          today_unrecorded_calls: 1,
          avg_recorded_duration_seconds: 0,
          overdue_follow_ups: 0,
          missing_phone_tasks: 2,
          a_level_count: 0,
        },
        signals: [
          {
            key: 'low_call_activity',
            severity: 'warning',
            label: '今日通话低于目标 50%',
            count: 1,
          },
          {
            key: 'missing_phone_tasks',
            severity: 'warning',
            label: '2 条无电话数据',
            count: 2,
          },
          {
            key: 'unrecorded_call_duration',
            severity: 'info',
            label: '1 通未记录时长',
            count: 1,
          },
          {
            key: 'low_progress',
            severity: 'warning',
            label: '任务推进率偏低',
            count: 12,
          },
        ],
        recommended_action: '今日通话低于目标 50%',
      }),
    ],
  };
}

describe('AgentScorePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { data: scorePayload() } });
  });

  it('loads and renders agent score preview data', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/score-preview']}>
        <AgentScorePreview />
      </MemoryRouter>,
    );

    expect(await screen.findByText('王坐席')).toBeInTheDocument();
    expect(screen.getByText('风险')).toBeInTheDocument();
    expect(screen.getByText('2 条逾期回访')).toBeInTheDocument();
    expect(screen.getByText('先处理逾期回访，防止高意向线索流失')).toBeInTheDocument();
    expect(screen.getByText('有效记录')).toBeInTheDocument();
    expect(screen.getAllByText('未记录')[0]).toBeInTheDocument();
    expect(screen.getByText('拨号 6')).toBeInTheDocument();
    expect(screen.getByText('有效 4')).toBeInTheDocument();
    expect(screen.getByText('未记录 2')).toBeInTheDocument();
    expect(screen.getByText('均长 1分')).toBeInTheDocument();
    expect(screen.getAllByText('推进率 33.3%，待联系 8/12').length).toBeGreaterThan(0);
    expect(screen.queryByText('推进覆盖 6.7/20')).not.toBeInTheDocument();
    expect(screen.queryByText('待联系清理 3.3/10')).not.toBeInTheDocument();
    expect(screen.getAllByText('6/30 通').length).toBeGreaterThan(0);
    expect(screen.getByText('李坐席')).toBeInTheDocument();
    expect(screen.getByText('赵坐席')).toBeInTheDocument();
    expect(screen.getByText('本次按 30 通/人计算')).toBeInTheDocument();
    expect(screen.getByText('任务推进 30 = 推进覆盖 20 + 待联系清理 10')).toBeInTheDocument();
    expect(screen.getByText('今日通话 25 = 实际拨号 / 通话目标，达标封顶')).toBeInTheDocument();
    expect(screen.getByText('回访及时 20 = 未逾期回访占比')).toBeInTheDocument();
    expect(screen.getByText('有效产出 15 = A 级意向 + 报名')).toBeInTheDocument();
    expect(screen.getByText('资料完整 10 = 数据电话质量')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/admin/agent-score-preview', {
      params: { daily_call_target: 30 },
    });
  });

  it('turns score recommendations into executable links', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/score-preview']}>
        <AgentScorePreview />
      </MemoryRouter>,
    );

    await screen.findByText('王坐席');

    expect(screen.getByRole('link', { name: '看逾期回访' })).toHaveAttribute(
      'href',
      '/admin/work-center?queue=follow',
    );
    expect(screen.getByRole('link', { name: '看 A 级线索' })).toHaveAttribute(
      'href',
      '/admin/leads?intent=A',
    );
    expect(screen.getByRole('link', { name: '看无电话数据' })).toHaveAttribute(
      'href',
      '/admin/leads?active=1&missing_phone=1',
    );
    expect(screen.getByRole('link', { name: '看通话报表' })).toHaveAttribute(
      'href',
      '/admin/report-center?tab=call-volume',
    );
    expect(screen.getByRole('link', { name: '看低推进任务' })).toHaveAttribute(
      'href',
      '/admin/agents',
    );
    expect(screen.getAllByRole('link', { name: '看坐席任务' }).length).toBeGreaterThan(0);
  });

  it('reloads with adjusted preview parameters', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/score-preview']}>
        <AgentScorePreview />
      </MemoryRouter>,
    );

    await screen.findByText('王坐席');
    fireEvent.change(screen.getByLabelText('通话目标'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: '重新试算' }));

    await waitFor(() =>
      expect(api.get).toHaveBeenLastCalledWith('/admin/agent-score-preview', {
        params: { daily_call_target: 500 },
      }),
    );
  });

  it('filters overdue follow-up agents locally', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/score-preview']}>
        <AgentScorePreview />
      </MemoryRouter>,
    );

    await screen.findByText('王坐席');
    fireEvent.click(screen.getByRole('button', { name: '逾期回访' }));

    expect(screen.getByText('王坐席')).toBeInTheDocument();
    expect(screen.queryByText('李坐席')).not.toBeInTheDocument();
    expect(screen.queryByText('赵坐席')).not.toBeInTheDocument();
    expect(screen.getByText('当前 1 / 3')).toBeInTheDocument();
  });

  it('sorts agents by low call volume locally', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/score-preview']}>
        <AgentScorePreview />
      </MemoryRouter>,
    );

    await screen.findByText('王坐席');
    fireEvent.change(screen.getByLabelText('排序'), { target: { value: 'calls_asc' } });

    const agentCells = screen.getAllByText(/坐席$/);
    expect(agentCells.map((cell) => cell.textContent)).toEqual(['赵坐席', '王坐席', '李坐席']);
  });
});
