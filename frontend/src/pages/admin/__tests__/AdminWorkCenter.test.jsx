import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminWorkCenter from '../AdminWorkCenter';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', name: '管理员' },
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

const workItems = [
  {
    id: 'home_visit:101',
    kind: 'home_visit',
    queue: 'home_visit',
    priority: 'high',
    title: '张三 家访',
    student_id: 201,
    student_name: '张三',
    region: '龙海',
    school_name: '长泰二中',
    agent_name: '王坐席',
    due_at: '2026-07-02T09:00:00',
    status: 'pending',
    reason: '家访待确认',
    target_url: '/admin/home-visits',
    action_label: '处理家访',
    source_id: 101,
  },
  {
    id: 'campus_visit:201',
    kind: 'campus_visit',
    queue: 'campus_visit',
    priority: 'normal',
    title: '李四 到校参观',
    student_id: 202,
    student_name: '李四',
    region: '芗城',
    school_name: '芗城一中',
    agent_name: '赵坐席',
    due_at: '2026-07-03T10:00:00',
    status: 'scheduled',
    reason: '到校待处理',
    target_url: '/admin/campus-visits',
    action_label: '处理到校',
    source_id: 201,
  },
  {
    id: 'follow_up:301',
    kind: 'follow_up',
    queue: 'follow_up',
    priority: 'high',
    title: '王五 回访',
    student_id: 203,
    student_name: '王五',
    region: '漳浦',
    school_name: '漳浦三中',
    agent_name: '陈坐席',
    due_at: '2026-07-01T15:00:00',
    status: 'open',
    reason: '回访已超期',
    target_url: '/admin/leads/203',
    action_label: '完成回访',
    source_id: 301,
  },
  {
    id: 'settlement:401',
    kind: 'settlement',
    queue: 'settlement',
    priority: 'normal',
    title: '赵六 结算',
    student_id: 204,
    student_name: '赵六',
    region: '南靖',
    school_name: '南靖一中',
    agent_name: '林坐席',
    due_at: null,
    status: '争议',
    reason: '结算争议待处理',
    target_url: '/admin/enrollment-settlement',
    action_label: '处理结算',
    source_id: 401,
  },
  {
    id: 'help:501',
    kind: 'help',
    queue: 'help',
    priority: 'high',
    title: '孙七 求助',
    student_id: 501,
    student_name: '孙七',
    region: '平和',
    school_name: '平和二中',
    agent_name: '许坐席',
    due_at: null,
    status: 'need_help',
    reason: '学生请求协助',
    target_url: '/admin/leads/501',
    action_label: '已处理求助',
    source_id: 501,
  },
];

function mockLoads() {
  api.get.mockImplementation((url, config = {}) => {
    if (url === '/admissions/work-items') {
      expect(config.params).toEqual({ queue: 'all', page_size: 100 });
      return Promise.resolve({
        data: {
          data: {
            list: workItems,
          },
        },
      });
    }
    return Promise.resolve({ data: { data: {} } });
  });
  api.put.mockResolvedValue({ data: { code: 0, data: {} } });
}

describe('AdminWorkCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLoads();
  });

  it('loads unified admissions work items for all admin queues', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/work-center']}>
        <AdminWorkCenter />
      </MemoryRouter>,
    );

    expect(await screen.findByText('张三 家访')).toBeInTheDocument();
    expect(screen.getByText('李四 到校参观')).toBeInTheDocument();
    expect(screen.getByText('王五 回访')).toBeInTheDocument();
    expect(screen.getByText('赵六 结算')).toBeInTheDocument();
    expect(screen.getByText('孙七 求助')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '全部 5' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '家访 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '到校 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '回访 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '结算 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '求助 1' })).toBeInTheDocument();
  });

  it('keeps legacy help and follow-up completion endpoints', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/work-center']}>
        <AdminWorkCenter />
      </MemoryRouter>,
    );

    await screen.findByText('孙七 求助');

    fireEvent.click(screen.getByRole('button', { name: '已处理求助' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/students/501', { need_help: false }));

    fireEvent.click(screen.getByRole('button', { name: '完成回访' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/follow-ups/301', { is_completed: true }));
  });

  it('normalizes legacy follow queue links to follow_up', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/work-center?queue=follow']}>
        <AdminWorkCenter />
      </MemoryRouter>,
    );

    expect(await screen.findByText('王五 回访')).toBeInTheDocument();
    expect(screen.queryByText('张三 家访')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/admissions/work-items', {
        params: { queue: 'all', page_size: 100 },
      });
    });
  });
});
