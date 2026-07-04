import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AuditLogs from '../AuditLogs';
import api from '../../../api';

let mockUser;

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
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

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

const users = [
  { id: 1, name: '管理员' },
  { id: 7, name: '蒲安琪' },
];

const logsPayload = {
  total: 4,
  page: 1,
  page_size: 50,
  actions: [
    { action: '登录', count: 1 },
    { action: '学校分配', count: 1 },
    { action: '学校分配汇总', count: 1 },
    { action: '删除线索', count: 1 },
  ],
  categories: [
    { category: '登录安全', count: 1 },
    { category: '分配', count: 2 },
    { category: '删除', count: 1 },
  ],
  list: [
    {
      seq: 1,
      id: 3,
      operator_id: 1,
      operator_name: '管理员',
      action: '删除线索',
      category: '删除',
      content: '删除学生 陈同学',
      batch_id: 'phone-dedupe-test',
      student_id: 22,
      student_name: '陈同学',
      student_school_name: '长泰二中',
      case_no: 'case-delete',
      created_at: '2026-06-30 01:30:00',
    },
    {
      seq: 2,
      id: 4,
      operator_id: 1,
      operator_name: '管理员',
      action: '学校分配汇总',
      category: '分配',
      content: '学校「长泰二中」分发，共 1 名',
      batch_id: 'school-assign-test',
      can_rollback_assignment: true,
      student_id: null,
      student_name: '',
      student_school_name: '',
      case_no: '',
      created_at: '2026-06-30 01:25:00',
    },
    {
      seq: 3,
      id: 2,
      operator_id: 1,
      operator_name: '管理员',
      action: '学校分配',
      category: '分配',
      content: '学校「长泰二中」分配给话务员',
      batch_id: 'school-assign-test',
      can_rollback_assignment: false,
      student_id: 23,
      student_name: '林同学',
      student_school_name: '长泰二中',
      case_no: 'case-assign',
      created_at: '2026-06-30 01:20:00',
    },
    {
      seq: 4,
      id: 1,
      operator_id: 7,
      operator_name: '蒲安琪',
      action: '登录',
      category: '登录安全',
      content: 'IP 127.0.0.1',
      student_id: null,
      student_name: '',
      student_school_name: '',
      case_no: '',
      created_at: '2026-06-30 01:10:00',
    },
  ],
};

describe('AuditLogs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 1, role: 'admin', name: '管理员', is_super_admin: true };
    api.get.mockImplementation((url) => {
      if (url === '/admin/users') {
        return Promise.resolve({ data: { data: users } });
      }
      if (url === '/admin/assignment-rollbacks/school-assign-test') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              batch_id: 'school-assign-test',
              total_logs: 1,
              rollbackable_count: 1,
              skipped_count: 0,
              items: [
                {
                  log_id: 2,
                  student_id: 23,
                  student_name: '林同学',
                  school_name: '长泰二中',
                  old_assigned_to: null,
                  new_assigned_to: 7,
                  current_assigned_to: 7,
                  status: 'ok',
                  reason: '',
                },
              ],
            },
          },
        });
      }
      if (url === '/operation-logs') {
        return Promise.resolve({ data: { data: logsPayload } });
      }
      return Promise.resolve({ data: { data: {} } });
    });
    api.post.mockResolvedValue({
      data: {
        code: 0,
        data: { batch_id: 'school-assign-test', rolled_back_count: 1, skipped_count: 0 },
      },
    });
  });

  it('renders login, assignment, and delete audit rows', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/audit-logs']}>
        <AuditLogs />
      </MemoryRouter>,
    );

    expect(await screen.findByText('删除学生 陈同学')).toBeInTheDocument();
    expect(screen.getByText('学校「长泰二中」分配给话务员')).toBeInTheDocument();
    expect(screen.getByText('IP 127.0.0.1')).toBeInTheDocument();
    expect(screen.getByText('陈同学')).toBeInTheDocument();
    expect(screen.getByText('phone-dedupe-test')).toBeInTheDocument();
    expect(screen.getAllByText('school-assign-test')).toHaveLength(2);
    expect(screen.getAllByText('长泰二中').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('共 4 条')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '分配 2' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /回滚预览/ })).toHaveLength(1);
  });

  it('sends filters to the operation log API', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/audit-logs']}>
        <AuditLogs />
      </MemoryRouter>,
    );

    await screen.findByText('删除学生 陈同学');
    fireEvent.change(screen.getByLabelText('开始日期'), { target: { value: '2026-06-30' } });
    fireEvent.change(screen.getByLabelText('结束日期'), { target: { value: '2026-06-30' } });
    fireEvent.change(screen.getByLabelText('操作人'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('动作'), { target: { value: '删除线索' } });
    fireEvent.change(screen.getByLabelText('批次号'), { target: { value: 'phone-dedupe-test' } });
    fireEvent.change(screen.getByLabelText('关键字'), { target: { value: '长泰二中' } });
    fireEvent.click(screen.getByRole('button', { name: /查询/ }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/operation-logs', {
        params: {
          page: 1,
          page_size: 50,
          start_date: '2026-06-30',
          end_date: '2026-06-30',
          operator_id: '1',
          action: '删除线索',
          batch_id: 'phone-dedupe-test',
          q: '长泰二中',
        },
      });
    });
  });

  it('filters operation logs by category chip', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/audit-logs']}>
        <AuditLogs />
      </MemoryRouter>,
    );

    await screen.findByText('删除学生 陈同学');
    fireEvent.click(screen.getByRole('button', { name: '分配 2' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/operation-logs', {
        params: expect.objectContaining({
          page: 1,
          page_size: 50,
          category: '分配',
        }),
      });
    });
  });

  it('loads batch id from route query string', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/audit-logs?batch_id=phone-dedupe-test']}>
        <AuditLogs />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/operation-logs', {
        params: expect.objectContaining({
          page: 1,
          page_size: 50,
          batch_id: 'phone-dedupe-test',
        }),
      });
    });
    expect(screen.getByLabelText('批次号')).toHaveValue('phone-dedupe-test');
  });

  it('previews and confirms assignment rollback for super admin batches', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/audit-logs']}>
        <AuditLogs />
      </MemoryRouter>,
    );

    await screen.findByText('学校「长泰二中」分配给话务员');
    fireEvent.click(screen.getByRole('button', { name: /回滚预览/ }));

    expect(await screen.findByText('分配批次回滚预览')).toBeInTheDocument();
    expect(screen.getAllByText('可回滚').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('7 → 未分配')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /确认回滚/ }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith(
        '/admin/assignment-rollbacks/school-assign-test',
        { confirm: true },
      );
    });
  });
});
