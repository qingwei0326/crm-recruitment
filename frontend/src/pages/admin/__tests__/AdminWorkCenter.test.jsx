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

function mockLoads() {
  api.get.mockImplementation((url, config = {}) => {
    if (url === '/students') {
      expect(config.params.need_help).toBe('1');
      return Promise.resolve({
        data: {
          data: {
            list: [
              {
                id: 10,
                name: '张三',
                region: '龙海',
                status: '待回访',
                intent_level: 'A',
                assigned_to: 2,
              },
            ],
          },
        },
      });
    }
    if (url === '/follow-ups') {
      return Promise.resolve({
        data: {
          data: {
            list: [
              {
                id: 20,
                student_id: 10,
                student_name: '张三',
                student_region: '龙海',
                agent_name: '王坐席',
                follow_up_date: '2026-06-11T10:00:00',
                follow_up_type: '电话',
                is_completed: false,
              },
            ],
          },
        },
      });
    }
    if (url === '/visits') {
      return Promise.resolve({
        data: {
          data: {
            list: [
              {
                id: 30,
                student_id: 11,
                student_name: '李四',
                student_region: '芗城',
                agent_name: '赵坐席',
                visit_type: '来校参观',
                scheduled_date: '2026-06-12T09:00:00',
                status: '待确认',
              },
            ],
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

  it('loads help requests, follow-ups, and visits for admins', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/work-center']}>
        <AdminWorkCenter />
      </MemoryRouter>,
    );

    expect(await screen.findAllByText('张三')).toHaveLength(2);
    expect(screen.getByText('李四')).toBeInTheDocument();
    expect(screen.getByText('王坐席')).toBeInTheDocument();
    expect(screen.getByText('赵坐席')).toBeInTheDocument();
  });

  it('lets admins clear help, complete follow-ups, and confirm visits', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/work-center']}>
        <AdminWorkCenter />
      </MemoryRouter>,
    );

    await screen.findAllByText('张三');

    fireEvent.click(screen.getByRole('button', { name: '已处理求助' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/students/10', { need_help: false }));

    fireEvent.click(screen.getByRole('button', { name: '完成回访' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/follow-ups/20', { is_completed: true }));

    fireEvent.click(screen.getByRole('button', { name: '确认到访' }));
    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/visits/30', { status: '已确认' }));
  });
});
