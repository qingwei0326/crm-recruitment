import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LeadsManage from '../LeadsManage';
import api from '../../../api';

let isMobileMock = false;
let studentStageMock = '待到校参观';
const mockConfirm = vi.fn();

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
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
    user: { id: 1, role: 'admin', name: '管理员', is_super_admin: true },
    logout: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => isMobileMock,
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}));

describe('LeadsManage privacy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isMobileMock = false;
    studentStageMock = '待到校参观';
    mockConfirm.mockResolvedValue(true);
    api.post.mockResolvedValue({ data: { code: 0, data: {} } });
    api.delete.mockResolvedValue({ data: { code: 0 } });
    api.get.mockImplementation((url, config) => {
      if (url === '/students') {
        const params = config?.params || {};
        const list = [
          {
            id: 10,
            name: '脱敏学生',
            region: '龙文区',
            score: 580,
            guardian_name: '林父',
            guardian_phone: '139****8706',
            guardian_phone_raw: null,
            guardian2_name: '林母',
            guardian2_phone: '189****0618',
            guardian2_phone_raw: null,
            school_name: '龙文中学',
            status: '未联系',
            stage: studentStageMock,
            intent_level: '无',
          },
        ];
        if (params?.status === '已报名') {
          list[0] = {
            ...list[0],
            id: 11,
            name: '已报名学生',
            status: '已报名',
            stage: '已报名',
          };
        }
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              total: 1,
              list,
            },
          },
        });
      }
      if (url === '/admin/agents') {
        return Promise.resolve({ data: { code: 0, data: [{ id: 2, name: '陈老师' }] } });
      }
      if (url === '/stats/stages') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              未分配: 55107,
              初次联系: 1507,
              有意向: 12,
              待家访: 5,
              到校参观已安排: 3,
              已到校参观: 2,
              已报名: 19,
            },
          },
        });
      }
      if (url === '/students/10') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              id: 10,
              name: '脱敏学生',
              region: '龙文区',
              score: 580,
              guardian_name: '林父',
              guardian_phone: '139****8706',
              guardian_phone_raw: null,
              guardian2_name: '林母',
              guardian2_phone: '189****0618',
              guardian2_phone_raw: null,
              school_name: '龙文中学',
              status: '未联系',
              stage: studentStageMock,
              intent_level: '无',
            },
          },
        });
      }
      if (url === '/notes?student_id=10') {
        return Promise.resolve({ data: { code: 0, data: [] } });
      }
      if (url === '/students/10/phone-plain') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              guardian_phone: '13960118706',
              guardian2_phone: '18960100618',
            },
          },
        });
      }
      if (url === '/students/phone/10') {
        return Promise.resolve({
          data: {
            code: 0,
            data: {
              guardian_phone: '13960118706',
              guardian2_phone: '18960100618',
            },
          },
        });
      }
      return Promise.resolve({ data: { code: 0, data: {} } });
    });
  });

  it('loads plaintext phone through the audited endpoint before editing', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('脱敏学生'));
    fireEvent.click(await screen.findByRole('button', { name: /编辑信息/ }));

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith('/students/10/phone-plain');
    });
    expect(await screen.findByDisplayValue('13960118706')).toBeInTheDocument();
    expect(screen.getByDisplayValue('18960100618')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('139****8706')).not.toBeInTheDocument();
  });

  it('lets admins click phone numbers in expanded student rows to dial', async () => {
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, href: 'http://localhost/' },
    });

    try {
      render(
        <MemoryRouter initialEntries={['/admin/leads']}>
          <LeadsManage />
        </MemoryRouter>,
      );

      fireEvent.click(await screen.findByText('脱敏学生'));
      fireEvent.click(await screen.findByRole('button', { name: /拨打监护人电话/ }));

      await waitFor(() => {
        expect(api.get).toHaveBeenCalledWith('/students/phone/10');
      });
      expect(window.location.href).toBe('tel:13960118706');
    } finally {
      Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation,
      });
    }
  });

  it('renders compact filters and applies ownership filters from the dropdown', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('脱敏学生')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'A 级未报名' })).not.toBeInTheDocument();
    expect(screen.queryByText('搜索姓名/电话/学校...')).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText('搜姓名 / 电话 / 学校')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /需协助/ })).toHaveClass('whitespace-nowrap');
    expect(await screen.findByRole('option', { name: '陈老师' })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '按分配状态筛选学生' }), {
      target: { value: 'unassigned' },
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/students',
        expect.objectContaining({
          params: expect.objectContaining({ assignment: 'unassigned' }),
        }),
      );
    });
    expect(screen.getByRole('button', { name: /未分配/ })).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: '按分配状态筛选学生' }), {
      target: { value: 'agent:2' },
    });

    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/students',
        expect.objectContaining({
          params: expect.objectContaining({ assigned_to: '2' }),
        }),
      );
    });
    expect(screen.getByRole('button', { name: /归属：陈老师/ })).toBeInTheDocument();
  });

  it('applies dashboard lead filters from the URL', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads?assignment=unassigned&active=1&intent=A&today_a=1&missing_phone=1']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('脱敏学生')).toBeInTheDocument();
    await waitFor(() => {
      expect(api.get).toHaveBeenCalledWith(
        '/students',
        expect.objectContaining({
          params: expect.objectContaining({
            assignment: 'unassigned',
            active: '1',
            intent_level: 'A',
            today_a: '1',
            missing_phone: '1',
          }),
        }),
      );
    });
    expect(screen.getByRole('button', { name: /未分配/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /仍需跟进/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /意向：A/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /今日新增 A/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /无电话数据/ })).toBeInTheDocument();
  });

  it('does not show global stage distribution while a list filter is active', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads?stage=已报名']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('脱敏学生')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /阶段：已报名/ })).toBeInTheDocument();
    expect(screen.queryByText('跟进阶段分布')).not.toBeInTheDocument();
    expect(screen.queryByText('55107')).not.toBeInTheDocument();
  });

  it('shows global stage distribution only when no list filter is active', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('脱敏学生')).toBeInTheDocument();
    expect(screen.getByText('跟进阶段分布')).toBeInTheDocument();
    expect(screen.getByText('55107')).toBeInTheDocument();
  });

  it('shows admissions workflow stages in filters, distribution, and row selectors', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('脱敏学生'));

    const stageFilter = screen.getByRole('combobox', { name: '按跟进阶段筛选学生' });
    expect(within(stageFilter).getByRole('option', { name: '待家访' })).toBeInTheDocument();
    expect(within(stageFilter).getByRole('option', { name: '到校参观已安排' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '待家访 5人' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '到校参观已安排 3人' })).toBeInTheDocument();

    const rowStageSelect = await screen.findByRole('combobox', {
      name: '设置 脱敏学生 跟进阶段',
    });
    expect(within(rowStageSelect).getByRole('option', { name: '家访完成' })).toBeInTheDocument();
    expect(within(rowStageSelect).getByRole('option', { name: '已到校参观' })).toBeInTheDocument();
  });

  it('creates a campus visit task from the expanded admin student row', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads?stage=待到校参观']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('脱敏学生'));
    fireEvent.click(await screen.findByRole('button', { name: '生成到校任务' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/campus-visits', {
        student_id: 10,
        source: '管理员补录',
        intent_program: '',
        visitor_count: 1,
        notes: '管理员从学生管理页生成到校任务',
      });
    });
  });

  it('creates a home visit task from the expanded admin student row', async () => {
    studentStageMock = '待家访';

    render(
      <MemoryRouter initialEntries={['/admin/leads?stage=待家访']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    fireEvent.click(await screen.findByText('脱敏学生'));
    fireEvent.click(await screen.findByRole('button', { name: '生成家访任务' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/home-visits', {
        student_id: 10,
        intent_program: '',
        exam_score: 580,
        address: '',
        priority: '中',
        notes: '管理员从学生管理页生成家访任务',
      });
    });
  });

  it('does not expose phone numbers on the initial mobile lead list', async () => {
    isMobileMock = true;

    render(
      <MemoryRouter initialEntries={['/admin/leads']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('脱敏学生')).toBeInTheDocument();
    expect(screen.queryByText('139****8706')).not.toBeInTheDocument();
    expect(screen.queryByText('189****0618')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /拨打联系人/ })).not.toBeInTheDocument();
    expect(screen.queryByText('未填')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: '详情' })).toHaveAttribute('href', '/admin/leads/10');
    expect(screen.getByRole('button', { name: '编辑' })).toBeInTheDocument();
  });

  it('blocks batch assignment when selected students include enrolled records', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads?status=已报名']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('已报名学生')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /选择 已报名学生/ }));
    fireEvent.click(screen.getByRole('button', { name: /分配已选/ }));

    expect(screen.getByText(/已选中 1 名已报名学生/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '确认分配' })).toBeDisabled();
  });

  it('confirms batch assignment before calling the assign API', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('脱敏学生')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /选择 脱敏学生/ }));
    fireEvent.click(screen.getByRole('button', { name: /分配已选/ }));
    fireEvent.change(screen.getByLabelText('选择批量分配话务员'), {
      target: { value: '2' },
    });
    fireEvent.click(screen.getByRole('button', { name: '确认分配' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
        title: '确认批量分配',
        message: expect.stringContaining('将 1 名学生分配给'),
      }));
    });
    expect(api.post).toHaveBeenCalledWith('/students/assign', {
      student_ids: [10],
      agent_id: 2,
    });
  });

  it('confirms student deletion with a danger prompt', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/leads']}>
        <LeadsManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('脱敏学生')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '删除 脱敏学生' }));

    await waitFor(() => {
      expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
        title: '确认删除学生',
        tone: 'danger',
      }));
    });
    expect(api.delete).toHaveBeenCalledWith('/students/10');
  });
});
