import { beforeEach, describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LeadGovernance from '../LeadGovernance';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

const mockConfirm = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
let mockUser;

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
  }),
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

describe('LeadGovernance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      id: 1,
      role: 'admin',
      name: '管理员',
      is_super_admin: false,
      operation_permissions: ['governance_review'],
    };
    mockConfirm.mockResolvedValue(true);
    api.post.mockResolvedValue({
      data: {
        code: 0,
        data: {
          batch_id: 'phone-dedupe-test',
          affected_student_count: 2,
          cleared_count: 1,
          deleted_count: 1,
        },
      },
    });
    api.get.mockImplementation((url) => {
      if (url === '/admin/data-health') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              status: 'warning',
              total_issue_count: 9,
              signals: [
                {
                  key: 'duplicate_phone',
                  title: '重复手机号',
                  count: 2,
                  severity: 'high',
                  detail: '1 个手机号出现在多条线索中，需复核是否重复导入。',
                  to: '/admin/governance?section=duplicates',
                },
                {
                  key: 'same_name_school_phone',
                  title: '同名同校同手机号',
                  count: 1,
                  severity: 'high',
                  detail: '同一个姓名、学校、手机号同时重复。',
                  to: '/admin/governance?section=duplicates',
                },
                {
                  key: 'missing_phone',
                  title: '无手机号线索',
                  count: 1,
                  severity: 'medium',
                  detail: '活跃线索缺少两个监护人手机号。',
                  to: '/admin/leads?active=1&missing_phone=1',
                },
                {
                  key: 'enrolled_status_change',
                  title: '已报名异常变更',
                  count: 1,
                  severity: 'high',
                  detail: '近 7 天涉及已报名的状态变更。',
                  to: '/admin/audit-logs?action=%E4%BF%AE%E6%94%B9%E7%8A%B6%E6%80%81&q=%E5%B7%B2%E6%8A%A5%E5%90%8D',
                },
                {
                  key: 'stale_a',
                  title: 'A 级长期未跟进',
                  count: 1,
                  severity: 'high',
                  detail: 'A 级且 3 天以上无新活动。',
                  to: '/admin/work-center?queue=stale-a',
                },
                {
                  key: 'assigned_no_call',
                  title: '分配后无通话',
                  count: 2,
                  severity: 'medium',
                  detail: '已分配但没有拨号记录。',
                  to: '/admin/leads?active=1',
                },
                {
                  key: 'off_hours_status_change',
                  title: '非工作时间状态变更',
                  count: 1,
                  severity: 'high',
                  detail: '近 7 天在工作时间外修改状态。',
                  to: '/admin/audit-logs?action=%E4%BF%AE%E6%94%B9%E7%8A%B6%E6%80%81',
                },
              ],
            },
          },
        });
      }
      if (url === '/admin/lead-duplicates') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              total_groups: 1,
              groups: [
                {
                  type: '手机号重复',
                  key: '13800138000',
                  search_q: '13800138000',
                  count: 2,
                  students: [
                    { id: 10, name: '张三', school_name: '长泰二中', status: '未联系' },
                    { id: 11, name: '李四', school_name: '长泰一中', status: '未联系' },
                  ],
                },
              ],
            },
          },
        });
      }
      if (url === '/admin/lead-duplicates/cleanup-preview') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              duplicate_phone_count: 1,
              affected_student_count: 2,
              will_clear_count: 1,
              will_delete_count: 1,
              duplicate_phones: ['13800138000'],
            },
          },
        });
      }
      if (url === '/admin/risk-alerts') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              alerts: [
                {
                  type: 'delete_leads',
                  title: '近期存在删除操作',
                  severity: 'high',
                  count: 1,
                  detail: '近 7 天有 1 条删除类操作，请复核是否为预期清理。',
                  category: '删除',
                },
                {
                  type: 'enrolled_status_change',
                  title: '已报名相关状态变更',
                  severity: 'high',
                  count: 1,
                  detail: '近 7 天有 1 条涉及已报名的状态变更。',
                  action: '修改状态',
                  q: '已报名',
                },
                {
                  type: 'unsettled_enrollments',
                  title: '已报名未结算',
                  severity: 'high',
                  count: 2,
                  detail: '当前有 2 条报名记录未结算。',
                  to: '/admin/enrollment-settlement',
                },
              ],
            },
          },
        });
      }
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
  });

  it('groups all lead governance workflows in one admin entry page', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/governance']}>
        <LeadGovernance />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '线索治理' })).toBeInTheDocument();
    expect(await screen.findByText('数据健康中心')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('重复手机号')).toBeInTheDocument();
    expect(screen.getByText('同名同校同手机号')).toBeInTheDocument();
    expect(screen.getByText('无手机号线索')).toBeInTheDocument();
    expect(screen.getByText('已报名异常变更')).toBeInTheDocument();
    expect(screen.getByText('A 级长期未跟进')).toBeInTheDocument();
    expect(screen.getByText('分配后无通话')).toBeInTheDocument();
    expect(screen.getByText('非工作时间状态变更')).toBeInTheDocument();
    expect(await screen.findByText('疑似重复线索')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /学生管理与分配/ })).toHaveAttribute('href', '/admin/leads');
    expect(screen.getByRole('link', { name: /无效线索回收/ })).toHaveAttribute('href', '/admin/invalid-reclaim');
    expect(screen.getByRole('link', { name: /多学校分发/ })).toHaveAttribute('href', '/admin/distribute');
  });

  it('renders duplicate groups and risk alerts with review links', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/governance']}>
        <LeadGovernance />
      </MemoryRouter>,
    );

    expect(await screen.findByText('手机号重复')).toBeInTheDocument();
    expect(screen.getByText('13800138000')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /查看 张三/ })).toHaveAttribute(
      'href',
      '/admin/leads/10',
    );
    expect(screen.getByRole('link', { name: /搜索该组/ })).toHaveAttribute(
      'href',
      '/admin/leads?q=13800138000',
    );

    expect(await screen.findByText('近期存在删除操作')).toBeInTheDocument();
    const auditLinks = screen.getAllByRole('link', { name: /查看相关操作记录/ });
    expect(auditLinks[0]).toHaveAttribute(
      'href',
      '/admin/audit-logs?category=%E5%88%A0%E9%99%A4',
    );
    expect(auditLinks[1]).toHaveAttribute(
      'href',
      '/admin/audit-logs?action=%E4%BF%AE%E6%94%B9%E7%8A%B6%E6%80%81&q=%E5%B7%B2%E6%8A%A5%E5%90%8D',
    );
    expect(screen.getByRole('link', { name: /查看处理入口/ })).toHaveAttribute(
      'href',
      '/admin/enrollment-settlement',
    );

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/admin/data-health');
      expect(api.get).toHaveBeenCalledWith('/admin/lead-duplicates');
      expect(api.get).toHaveBeenCalledWith('/admin/lead-duplicates/cleanup-preview');
      expect(api.get).toHaveBeenCalledWith('/admin/risk-alerts');
    });
  });

  it('acknowledges health signal reviews and reloads governance data', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/governance']}>
        <LeadGovernance />
      </MemoryRouter>,
    );

    expect(await screen.findByText('重复手机号')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认已复核 重复手机号' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admin/governance-reviews', {
        key: 'duplicate_phone',
        title: '重复手机号',
        detail: '1 个手机号出现在多条线索中，需复核是否重复导入。',
        count: 2,
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('已确认复核');
    });
  });

  it('acknowledges risk alert reviews', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/governance']}>
        <LeadGovernance />
      </MemoryRouter>,
    );

    expect(await screen.findByText('近期存在删除操作')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '确认已复核 近期存在删除操作' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admin/governance-reviews', {
        key: 'delete_leads',
        title: '近期存在删除操作',
        detail: '近 7 天有 1 条删除类操作，请复核是否为预期清理。',
        count: 1,
      });
      expect(mockToastSuccess).toHaveBeenCalledWith('已确认复核');
    });
  });

  it('confirms and runs duplicate phone cleanup with batch audit link', async () => {
    mockUser = {
      id: 1,
      role: 'admin',
      name: '清理管理员',
      is_super_admin: false,
      operation_permissions: ['duplicate_cleanup', 'governance_review'],
    };
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/governance']}>
        <LeadGovernance />
      </MemoryRouter>,
    );

    expect(await screen.findByText('重复手机号清理预览')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清理重复手机号' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
        title: '清理重复手机号',
        confirmText: '确认清理',
        tone: 'danger',
      }));
      expect(api.post).toHaveBeenCalledWith('/admin/lead-duplicates/cleanup', { confirm: true });
      expect(mockToastSuccess).toHaveBeenCalledWith('清理完成：清号 1 条，删除 1 条');
    });
  });

  it('keeps cleanup preview read-only for normal admins', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin/governance']}>
        <LeadGovernance />
      </MemoryRouter>,
    );

    expect(await screen.findByText('重复手机号清理预览')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '清理重复手机号' })).not.toBeInTheDocument();
    expect(screen.getByText('当前账号仅可查看预览；清理重复手机号需授权操作权限。')).toBeInTheDocument();
  });
});
