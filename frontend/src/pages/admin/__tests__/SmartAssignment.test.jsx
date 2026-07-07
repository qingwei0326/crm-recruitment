import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SmartAssignment from '../SmartAssignment';
import api from '../../../api';

const mockConfirm = vi.hoisted(() => vi.fn());
const mockToastSuccess = vi.hoisted(() => vi.fn());
const mockToastError = vi.hoisted(() => vi.fn());

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({
    dark: false,
    toggle: vi.fn(),
  }),
}));

let mockUser;

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    warning: vi.fn(),
  }),
}));

function previewPayload(overrides = {}) {
  return {
    pool: {
      total_unassigned: 54150,
      eligible_total: 500,
      eligible: 500,
      excluded_duplicate_phone: 120,
      excluded_invalid_status: 30,
      remaining_after_plan: 0,
    },
    agents: [
      {
        agent_id: 1,
        agent_name: '坐席A',
        active_tasks: 80,
        not_contacted: 60,
        today_calls: 20,
        handled_7d: 120,
        overdue_follow_ups: 0,
        load_score: 110,
        suggested_count: 100,
      },
      {
        agent_id: 2,
        agent_name: '坐席B',
        active_tasks: 20,
        not_contacted: 10,
        today_calls: 5,
        handled_7d: 20,
        overdue_follow_ups: 1,
        load_score: 27.5,
        suggested_count: 400,
      },
    ],
    plan: {
      requested: 500,
      planned: 500,
      per_agent: [
        { agent_id: 1, agent_name: '坐席A', count: 100 },
        { agent_id: 2, agent_name: '坐席B', count: 400 },
      ],
    },
    warnings: [],
    filters: {
      school_name: '',
      region: '',
      limit: 500,
      per_agent_limit: 100,
    },
    ...overrides,
  };
}

describe('SmartAssignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      id: 1,
      role: 'admin',
      name: '管理员',
      is_super_admin: false,
      operation_permissions: ['student_assign'],
    };
    mockConfirm.mockResolvedValue(true);
    api.get.mockResolvedValue({ data: { code: 0, data: previewPayload() } });
  });

  it('loads and renders pool, agent load, and plan preview', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SmartAssignment />
      </MemoryRouter>,
    );

    expect(await screen.findByText('分配池概览')).toBeInTheDocument();
    expect(screen.getByText('54,150')).toBeInTheDocument();
    expect(screen.getByText('重复手机号排除')).toBeInTheDocument();
    expect(screen.getAllByText('坐席A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('坐席B').length).toBeGreaterThan(0);
    expect(screen.getByText('计划分配 500 条')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/admin/smart-assign/preview', {
      params: { school_name: '', region: '', limit: 500, per_agent_limit: 100 },
    });
  });

  it('reloads preview with edited filters', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SmartAssignment />
      </MemoryRouter>,
    );

    expect(await screen.findByText('分配池概览')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('学校'), { target: { value: '龙海一中' } });
    fireEvent.change(screen.getByLabelText('地区'), { target: { value: '龙海区' } });
    fireEvent.change(screen.getByLabelText('本次分配总量'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('单坐席上限'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: '刷新预览' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/admin/smart-assign/preview', {
        params: { school_name: '龙海一中', region: '龙海区', limit: 300, per_agent_limit: 80 },
      });
    });
  });

  it('renders empty and warning states', async () => {
    api.get.mockResolvedValue({
      data: {
        code: 0,
        data: previewPayload({
          pool: {
            total_unassigned: 0,
            eligible_total: 0,
            eligible: 0,
            excluded_duplicate_phone: 0,
            excluded_invalid_status: 0,
            remaining_after_plan: 0,
          },
          agents: [],
          plan: { requested: 500, planned: 0, per_agent: [] },
          warnings: ['没有启用话务员', '当前筛选范围无可分配线索'],
        }),
      },
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SmartAssignment />
      </MemoryRouter>,
    );

    expect(await screen.findByText('没有启用话务员')).toBeInTheDocument();
    expect(screen.getByText('当前筛选范围无可分配线索')).toBeInTheDocument();
    expect(screen.getByText('暂无可执行分配建议')).toBeInTheDocument();
  });

  it('confirms and executes the current preview parameters', async () => {
    mockConfirm.mockResolvedValue(true);
    api.post.mockResolvedValue({
      data: {
        code: 0,
        data: {
          batch_id: 'smart-assign-20260707150000-abcd1234',
          assigned_count: 500,
          skipped_count: 0,
          per_agent: [],
        },
      },
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SmartAssignment />
      </MemoryRouter>,
    );

    expect(await screen.findByText('计划分配 500 条')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认执行智能分配' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
        title: '确认执行智能分配',
        confirmText: '确认分配',
      }));
      expect(api.post).toHaveBeenCalledWith('/admin/smart-assign/execute', {
        school_name: '',
        region: '',
        limit: 500,
        per_agent_limit: 100,
        confirm: true,
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('智能分配已执行：500 条');
    });
    expect(screen.getByText(/smart-assign-20260707150000-abcd1234/)).toBeInTheDocument();
    const reviewLink = screen.getByRole('link', { name: '查看复盘' });
    expect(reviewLink).toHaveAttribute(
      'href',
      '/admin/assignment-batches/smart-assign-20260707150000-abcd1234/review',
    );
  });

  it('hides execute action when admin lacks student assignment permission', async () => {
    mockUser = {
      id: 2,
      role: 'admin',
      name: '只读管理员',
      is_super_admin: false,
      operation_permissions: [],
    };

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SmartAssignment />
      </MemoryRouter>,
    );

    expect(await screen.findByText('当前账号仅可查看预览；执行智能分配需要“分配/改派学生”权限。')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '确认执行智能分配' })).not.toBeInTheDocument();
  });
});
