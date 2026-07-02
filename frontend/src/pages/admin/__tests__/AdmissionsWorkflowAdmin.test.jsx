import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomeVisitManage from '../HomeVisitManage';
import CampusVisitManage from '../CampusVisitManage';
import EnrollmentSettlement from '../EnrollmentSettlement';
import ReportCenter from '../ReportCenter';
import AdminSidebar from '../../../components/AdminSidebar';
import api from '../../../api';

let mockUser;
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
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
    success: mockToastSuccess,
    error: mockToastError,
  }),
}));

vi.mock('../Report', () => ({
  default: () => <div>summary report</div>,
}));

vi.mock('../TrendReport', () => ({
  default: () => <div>trend report</div>,
}));

vi.mock('../CallVolumeQuery', () => ({
  default: () => <div>call volume query</div>,
}));

const homeVisitRows = [
  {
    id: 101,
    student_id: 10,
    student_name: '张三',
    region: '龙海',
    school_name: '长泰二中',
    creator_agent_id: 7,
    creator_agent_name: '王坐席',
    assigned_admin_name: '管理员',
    status: '待确认',
    result: '',
    priority: '高',
    requested_visit_time: '2026-07-02 09:00:00',
    scheduled_at: '',
    address: '龙海区一号',
    notes: '家长已确认',
    enrollment_id: null,
  },
];

const campusVisitRows = [
  {
    id: 201,
    student_id: 10,
    student_name: '张三',
    region: '龙海',
    school_name: '长泰二中',
    creator_user_id: 7,
    creator_user_name: '王坐席',
    reception_admin_name: '管理员',
    home_visit_task_id: 101,
    status: '已预约',
    result: '',
    source: '家访后',
    appointment_at: '2026-07-03 10:00:00',
    needs_pickup: true,
    visitor_count: 2,
    current_concerns: '等中考成绩',
    enrollment_id: null,
  },
];

const enrollmentRows = [
  {
    id: 301,
    student_id: 10,
    student_name: '张三',
    region: '龙海',
    school_name: '长泰二中',
    attributed_agent_id: 7,
    attributed_agent_name: '王坐席',
    confirmed_by_admin_name: '管理员',
    source: '到校参观后',
    attribution_method: '自动到校预约人',
    attribution_reason: '',
    settlement_status: '争议',
    settlement_notes: '工作微信交接待确认',
    enrolled_program: '护理',
    enrolled_at: '2026-07-04 08:30:00',
    amount: 500,
    first_assigned_agent_name: '离职话务员',
    current_assigned_agent_name: '王坐席',
    last_effective_agent_name: '王坐席',
    home_visit_creator_agent_name: '离职话务员',
    campus_visit_creator_user_name: '王坐席',
    handover_policy: '工作手机/微信属于公司资产；交接后的同一微信号只能证明沟通渠道连续，不能单独证明原话务员促成报名。',
  },
];

const summaryRows = [
  {
    attributed_agent_id: 7,
    attributed_agent_name: '王坐席',
    total: 2,
    unsettled: 1,
    settled: 1,
    postponed: 0,
    disputed: 1,
  },
];

const admissionsReportData = {
  generated_at: '2026-07-01 23:40:00',
  funnel: [
    { key: 'leads', label: '线索', value: 10, rate: 100 },
    { key: 'a_intent', label: 'A意向', value: 6, rate: 60 },
    { key: 'home_visit_reported', label: '已上报家访', value: 4, rate: 40 },
    { key: 'home_visit_completed', label: '家访完成', value: 3, rate: 30 },
    { key: 'campus_visit_scheduled', label: '已安排到校', value: 2, rate: 20 },
    { key: 'campus_visit_arrived', label: '已到校', value: 1, rate: 10 },
    { key: 'enrolled', label: '已报名', value: 1, rate: 10 },
  ],
  regions: [
    {
      region: '芗城',
      total_leads: 10,
      a_count: 6,
      home_visits: 4,
      campus_visits: 2,
      enrollments: 1,
      a_rate: 60,
      enrollment_rate: 10,
    },
  ],
  agents: [
    {
      agent_id: 7,
      agent_name: '王坐席',
      is_active: true,
      calls: 30,
      total_leads: 10,
      a_count: 6,
      home_visit_reports: 4,
      campus_visit_appointments: 2,
      enrollments: 1,
      settlement_pending: 1,
    },
  ],
  visits: {
    home: { total: 4, pending: 1, scheduled: 1, completed: 2, postponed: 0, cancelled: 0, overdue: 1 },
    campus: { total: 2, pending: 0, scheduled: 1, arrived: 1, no_show: 0, cancelled: 0, overdue: 0 },
  },
  settlement: {
    total: 1,
    unsettled: 1,
    settled: 0,
    postponed: 0,
    disputed: 0,
    manual_attribution: 1,
    by_source: { 到校参观后: 1 },
    by_method: { 手动指定: 1 },
  },
};

function mockAdmissionsApis() {
  api.get.mockImplementation((url) => {
    if (url === '/admissions/home-visits') {
      return Promise.resolve({ data: { data: { total: 1, list: homeVisitRows } } });
    }
    if (url === '/admissions/campus-visits') {
      return Promise.resolve({ data: { data: { total: 1, list: campusVisitRows } } });
    }
    if (url === '/admissions/enrollments') {
      return Promise.resolve({ data: { data: { total: 1, list: enrollmentRows } } });
    }
    if (url === '/admissions/enrollments/summary') {
      return Promise.resolve({ data: { data: { list: summaryRows } } });
    }
    if (url === '/admin/agents') {
      return Promise.resolve({ data: { data: [{ id: 7, name: '王坐席' }, { id: 8, name: '赵坐席' }] } });
    }
    if (url === '/stats/admissions-report') {
      return Promise.resolve({ data: { data: admissionsReportData } });
    }
    if (url === '/stats/trend' || url === '/stats/agent-ranking') {
      return Promise.resolve({ data: { data: {} } });
    }
    return Promise.resolve({ data: { data: {} } });
  });
  api.patch.mockResolvedValue({ data: { code: 0, data: {} } });
  api.post.mockResolvedValue({ data: { code: 0, data: {} } });
}

describe('Admissions workflow admin pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 1, role: 'admin', name: '管理员', is_super_admin: true };
    mockAdmissionsApis();
  });

  it('exposes home visit, campus visit, and settlement entries in admin navigation', () => {
    render(
      <MemoryRouter initialEntries={['/admin/home-visits']}>
        <AdminSidebar />
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: /家访任务/ })).toHaveAttribute('href', '/admin/home-visits');
    expect(screen.getByRole('link', { name: /到校参观/ })).toHaveAttribute('href', '/admin/campus-visits');
    expect(screen.getByRole('link', { name: /报名结算/ })).toHaveAttribute('href', '/admin/enrollment-settlement');
  });

  it('loads and processes home visit tasks', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/home-visits']}>
        <HomeVisitManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '家访任务' })).toBeInTheDocument();
    expect(screen.getByText('王坐席')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('家访状态 101'), { target: { value: '已完成' } });
    fireEvent.change(screen.getByLabelText('家访结果 101'), { target: { value: '安排到校参观' } });
    fireEvent.change(screen.getByLabelText('家访结果备注 101'), { target: { value: '家长同意到校' } });
    fireEvent.click(screen.getByRole('button', { name: '保存家访结果 101' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/admissions/home-visits/101', {
        status: '已完成',
        result: '安排到校参观',
        result_notes: '家长同意到校',
      });
    });
  });

  it('lets admins schedule campus visits from a home visit row', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/home-visits']}>
        <HomeVisitManage />
      </MemoryRouter>,
    );

    await screen.findByText('张三');
    fireEvent.change(screen.getByLabelText('到校时间 101'), { target: { value: '2026-07-03T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: '安排到校 101' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/campus-visits', {
        student_id: 10,
        home_visit_task_id: 101,
        source: '家访后',
        appointment_at: '2026-07-03T10:00',
        visitor_count: 1,
        needs_pickup: false,
      });
    });
  });

  it('lets admins register enrollment from a home visit row', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/home-visits']}>
        <HomeVisitManage />
      </MemoryRouter>,
    );

    await screen.findByText('张三');
    fireEvent.change(screen.getByLabelText('家访报名专业 101'), { target: { value: '护理' } });
    fireEvent.change(screen.getByLabelText('家访报名金额 101'), { target: { value: '600' } });
    fireEvent.click(screen.getByRole('button', { name: '登记家访报名 101' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/enrollments', {
        student_id: 10,
        home_visit_task_id: 101,
        source: '家访后',
        enrolled_program: '护理',
        amount: 600,
      });
    });
  });

  it('loads and processes campus visit results and enrollments', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/campus-visits']}>
        <CampusVisitManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('张三')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '到校参观' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('到校状态 201'), { target: { value: '已到校' } });
    fireEvent.change(screen.getByLabelText('到校结果 201'), { target: { value: '现场报名' } });
    fireEvent.click(screen.getByRole('button', { name: '保存到校结果 201' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/admissions/campus-visits/201', {
        status: '已到校',
        result: '现场报名',
        onsite_enrolled: false,
      });
    });

    fireEvent.change(screen.getByLabelText('报名专业 201'), { target: { value: '护理' } });
    fireEvent.change(screen.getByLabelText('报名金额 201'), { target: { value: '500' } });
    fireEvent.click(screen.getByRole('button', { name: '登记报名 201' }));

    await waitFor(() => {
      expect(api.post).toHaveBeenCalledWith('/admissions/enrollments', {
        student_id: 10,
        campus_visit_task_id: 201,
        source: '到校参观后',
        enrolled_program: '护理',
        amount: 500,
      });
    });
  });

  it('does not show duplicate campus enrollment action when enrollment already exists', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/admissions/campus-visits') {
        return Promise.resolve({
          data: { data: { total: 1, list: [{ ...campusVisitRows[0], enrollment_id: 301 }] } },
        });
      }
      return Promise.resolve({ data: { data: {} } });
    });

    render(
      <MemoryRouter initialEntries={['/admin/campus-visits']}>
        <CampusVisitManage />
      </MemoryRouter>,
    );

    expect(await screen.findByText('已生成报名记录 #301')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '登记报名 201' })).not.toBeInTheDocument();
  });

  it('renders settlement summary rows and updates settlement status', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/enrollment-settlement']}>
        <EnrollmentSettlement />
      </MemoryRouter>,
    );

    expect((await screen.findAllByText('王坐席')).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByRole('heading', { name: '报名结算' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('自动到校预约人')).toBeInTheDocument();
    expect(screen.getByText('工作微信交接待确认')).toBeInTheDocument();
    expect(screen.getAllByText(/离职话务员/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/工作手机\/微信属于公司资产/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('结算状态 301'), { target: { value: '未结算' } });
    fireEvent.change(screen.getByLabelText('归属话务员 301'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('归属原因 301'), {
      target: { value: '工作手机微信已交接，新话务员继续推进后报名' },
    });
    fireEvent.change(screen.getByLabelText('结算备注 301'), { target: { value: '争议已处理' } });
    fireEvent.click(screen.getByRole('button', { name: '保存结算 301' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenCalledWith('/admissions/enrollments/301', {
        settlement_status: '未结算',
        settlement_notes: '争议已处理',
        attribution_reason: '工作手机微信已交接，新话务员继续推进后报名',
      });
    });

    fireEvent.change(screen.getByLabelText('归属话务员 301'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('归属原因 301'), {
      target: { value: '管理员确认归属赵坐席' },
    });
    fireEvent.click(screen.getByRole('button', { name: '保存结算 301' }));

    await waitFor(() => {
      expect(api.patch).toHaveBeenLastCalledWith('/admissions/enrollments/301', {
        settlement_status: '未结算',
        settlement_notes: '争议已处理',
        attributed_agent_id: 8,
        attribution_reason: '管理员确认归属赵坐席',
      });
    });
  });

  it('shows admissions report tabs and renders overview metrics', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/report-center?tab=admissions-overview']}>
        <ReportCenter />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '招生总览' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /区域转化/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /话务员转化/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /家访到校/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /结算归属/ })).toBeInTheDocument();
    expect(screen.getAllByText('已上报家访').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('4').length).toBeGreaterThanOrEqual(1);
  });

  it('renders region conversion and visit execution report tabs', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/report-center?tab=admissions-regions']}>
        <ReportCenter />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '区域转化' })).toBeInTheDocument();
    expect(screen.getByText('芗城')).toBeInTheDocument();
    expect(screen.getAllByText('60.0%').length).toBeGreaterThanOrEqual(1);

    fireEvent.click(screen.getByRole('button', { name: /家访到校/ }));

    expect(await screen.findByRole('heading', { name: '家访到校' })).toBeInTheDocument();
    expect(screen.getByText('家访执行')).toBeInTheDocument();
    expect(screen.getByText('到校参观执行')).toBeInTheDocument();
  });

  it('shows settlement attribution as a report center tab', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/report-center?tab=settlement']}>
        <ReportCenter />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('heading', { name: '结算归属' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /结算归属/ })).toBeInTheDocument();
    expect(screen.getByText('手动归属')).toBeInTheDocument();
    expect(screen.getByText('到校参观后')).toBeInTheDocument();
  });
});
