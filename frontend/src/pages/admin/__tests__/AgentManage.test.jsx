import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AgentManage from '../AgentManage';
import api from '../../../api';

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
    user: { id: 99, role: 'admin', name: '管理员' },
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
    service_regions: '无',
    today_calls: 0,
    month_calls: 0,
    total_tasks: 3,
  },
  {
    id: 2,
    name: '郭',
    username: '15006033773',
    is_active: true,
    service_regions: '无',
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
    api.get.mockImplementation((url) => {
      if (url === '/admin/agents') {
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
    expect(screen.getByText('话务员列表 (2)')).toBeInTheDocument();
  });

  it('sorts active agents with tasks first and disabled agents last', async () => {
    const unorderedAgents = [
      {
        id: 3,
        name: '禁用有任务',
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
      if (url === '/admin/agents') {
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

    const renderedNames = screen
      .getAllByText(/启用有任务甲|启用有任务乙|启用无任务|禁用有任务/)
      .map((node) => node.childNodes[0]?.textContent);

    expect(renderedNames).toEqual(['启用有任务甲', '启用有任务乙', '启用无任务', '禁用有任务']);
  });
});
