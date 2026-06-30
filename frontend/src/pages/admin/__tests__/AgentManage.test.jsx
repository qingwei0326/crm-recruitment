import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentManage from '../AgentManage';
import api from '../../../api';

let mockUser;

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
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
    user: mockUser,
    logout: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => true,
}));

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn(),
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

const agents = [
  {
    id: 1,
    name: '叶',
    username: '13459624561',
    is_active: true,
    service_regions: '龙海',
    today_calls: 0,
    month_calls: 0,
    total_tasks: 3,
  },
  {
    id: 2,
    name: '郭',
    username: '15006033773',
    is_active: true,
    service_regions: '芗城',
    today_calls: 1,
    month_calls: 10,
    total_tasks: 5,
  },
];

function taskPayload(agent = agents[0]) {
  return {
    agent,
    stats: {
      total: agent.total_tasks,
      done: 0,
      pending: agent.total_tasks,
      // follow_up removed in v2 status unification
      a_level: 0,
      view_count: 0,
      progress_pct: 0,
    },
    list: [],
  };
}

describe('AgentManage mobile navigation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 99, role: 'admin', name: '管理员', is_super_admin: true };
    api.get.mockImplementation((url) => {
      if (url === '/admin/users') {
        return Promise.resolve({ data: { data: agents } });
      }
      if (url === '/admin/agents/1/tasks') {
        return Promise.resolve({ data: { data: taskPayload(agents[0]) } });
      }
      if (url === '/admin/agents/2/tasks') {
        return Promise.resolve({ data: { data: taskPayload(agents[1]) } });
      }
      return Promise.resolve({ data: { data: {} } });
    });
  });

  it('stays on the agent list after tapping the mobile back button', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/agents']}>
        <AgentManage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('叶'));

    expect(await screen.findByRole('button', { name: /返回列表/ })).toBeInTheDocument();
    expect(screen.getByText('任务列表 (0)')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /返回列表/ }));

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(screen.queryByRole('button', { name: /返回列表/ })).not.toBeInTheDocument();
    expect(screen.getByText('账号列表 (2)')).toBeInTheDocument();
  });

  it('shows only active agents by default and keeps inactive agents under the offboard tab', async () => {
    const unorderedAgents = [
      {
        id: 3,
        name: '离职有任务',
        username: 'disabled',
        is_active: false,
        service_regions: '',
        today_calls: 0,
        total_tasks: 9,
        done_tasks: 0,
      },
      {
        id: 4,
        name: '启用无任务',
        username: 'empty',
        is_active: true,
        service_regions: '',
        today_calls: 0,
        total_tasks: 0,
        done_tasks: 0,
      },
      {
        id: 5,
        name: '启用有任务甲',
        username: 'busy-a',
        is_active: true,
        service_regions: '',
        today_calls: 0,
        total_tasks: 2,
        done_tasks: 0,
      },
      {
        id: 6,
        name: '启用有任务乙',
        username: 'busy-b',
        is_active: true,
        service_regions: '',
        today_calls: 0,
        total_tasks: 1,
        done_tasks: 0,
      },
    ];
    api.get.mockImplementation((url) => {
      if (url === '/admin/users') {
        return Promise.resolve({ data: { data: unorderedAgents } });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    render(
      <MemoryRouter initialEntries={['/admin/agents']}>
        <AgentManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('启用有任务甲')).toBeInTheDocument();
    expect(screen.queryByText('离职有任务')).not.toBeInTheDocument();
    expect(screen.getByText('账号列表 (3)')).toBeInTheDocument();

    const renderedNames = screen
      .getAllByText(/启用有任务甲|启用有任务乙|启用无任务/)
      .map((node) => node.childNodes[0]?.textContent);

    expect(renderedNames).toEqual(['启用有任务甲', '启用有任务乙', '启用无任务']);

    fireEvent.click(screen.getByRole('button', { name: '离职 1' }));

    expect(await screen.findByText('离职有任务')).toBeInTheDocument();
    expect(screen.queryByText('启用有任务甲')).not.toBeInTheDocument();
    expect(screen.getByText('账号列表 (1)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '回收' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '禁用' })).not.toBeInTheDocument();
  });

  it('hides account management actions for normal admins', async () => {
    mockUser = { id: 100, role: 'admin', name: '普通管理员', is_super_admin: false };

    render(
      <MemoryRouter initialEntries={['/admin/agents']}>
        <AgentManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('叶')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /添加账号/ })).not.toBeInTheDocument();
    expect(screen.queryByTitle('办理离职：回收线索、禁用账号、保留历史')).not.toBeInTheDocument();
    expect(screen.queryByTitle('解锁账号（清除登录失败锁定）')).not.toBeInTheDocument();
  });

  it('removes service region editing from the account modal and save payload', async () => {
    api.post.mockResolvedValue({ data: { code: 0 } });

    render(
      <MemoryRouter initialEntries={['/admin/agents']}>
        <AgentManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('叶')).toBeInTheDocument();
    expect(screen.queryByText('龙海')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '添加账号' }));

    expect(screen.queryByText('负责地域')).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('登录账号'), {
      target: { value: 'agent-new' },
    });
    fireEvent.change(screen.getByPlaceholderText('显示名称'), {
      target: { value: '新增坐席' },
    });
    fireEvent.change(screen.getByPlaceholderText('设置密码'), {
      target: { value: 'pw123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users', expect.any(Object)));
    const [, payload] = api.post.mock.calls[0];
    expect(payload).toEqual({
      username: 'agent-new',
      password: 'pw123456',
      name: '新增坐席',
      role: 'agent',
    });
    expect(payload).not.toHaveProperty('service_regions');
  });

  it('can create a super admin account from the add account modal', async () => {
    api.post.mockResolvedValue({ data: { code: 0 } });

    render(
      <MemoryRouter initialEntries={['/admin/agents']}>
        <AgentManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('叶')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '添加账号' }));
    fireEvent.change(screen.getByPlaceholderText('登录账号'), {
      target: { value: 'admin-new' },
    });
    fireEvent.change(screen.getByPlaceholderText('显示名称'), {
      target: { value: '新增超管' },
    });
    fireEvent.change(screen.getByLabelText('角色'), {
      target: { value: 'admin' },
    });
    fireEvent.click(screen.getByLabelText('超级管理员'));
    fireEvent.change(screen.getByPlaceholderText('设置密码'), {
      target: { value: 'pw123456' },
    });
    fireEvent.click(screen.getByRole('button', { name: '创建账号' }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/admin/users', expect.any(Object)));
    const [, payload] = api.post.mock.calls[0];
    expect(payload).toMatchObject({
      username: 'admin-new',
      password: 'pw123456',
      name: '新增超管',
      role: 'admin',
      is_super_admin: true,
    });
  });
});
