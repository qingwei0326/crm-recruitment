import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import App from '../App';

let mockUser;

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    loading: false,
  }),
}));

vi.mock('../hooks/useIsMobile', () => ({
  default: vi.fn(() => false),
}));

vi.mock('../hooks/useSyncManager', () => ({
  default: () => ({ isOnline: true }),
}));

vi.mock('../hooks/useErrorMonitor', () => ({
  default: () => undefined,
}));

vi.mock('../components/ConnectionStatus', () => ({
  default: () => null,
}));

vi.mock('../api', () => ({
  default: {},
  setGlobalToast: vi.fn(),
}));

vi.mock('../pages/admin/AdminDash', () => ({
  default: () => <div>admin dashboard page</div>,
}));

vi.mock('../pages/admin/AdminMobileDash', () => ({
  default: () => <div>mobile admin dashboard page</div>,
}));

vi.mock('../pages/admin/AdminWorkCenter', () => ({
  default: () => <div>work center page</div>,
}));

vi.mock('../pages/admin/LeadsManage', () => ({
  default: () => <div>leads manage page</div>,
}));

vi.mock('../pages/admin/GlobalSearch', () => ({
  default: () => <div>global search page</div>,
}));

vi.mock('../pages/admin/StudentDetail', () => ({
  default: () => <div>student detail page</div>,
}));

vi.mock('../pages/admin/LeadGovernance', () => ({
  default: () => <div>lead governance page</div>,
}));

vi.mock('../pages/admin/AgentScorePreview', () => ({
  default: () => <div>agent score preview page</div>,
}));

vi.mock('../pages/admin/AgentManage', () => ({
  default: () => <div>agent manage page</div>,
}));

vi.mock('../pages/admin/InvalidStudentReclaim', () => ({
  default: () => <div>invalid reclaim page</div>,
}));

vi.mock('../pages/admin/DistributeBySchools', () => ({
  default: () => <div>distribute schools page</div>,
}));

vi.mock('../pages/admin/ReportCenter', () => ({
  default: function MockReportCenter() {
    const location = useLocation();
    return <div>report center page {location.search}</div>;
  },
}));

vi.mock('../pages/admin/SystemSettings', () => ({
  default: () => <div>system settings page</div>,
}));

vi.mock('../pages/admin/AuditLogs', () => ({
  default: () => <div>audit logs page</div>,
}));

vi.mock('../pages/admin/HomeVisitManage', () => ({
  default: () => <div>home visit manage page</div>,
}));

vi.mock('../pages/admin/CampusVisitManage', () => ({
  default: () => <div>campus visit manage page</div>,
}));

vi.mock('../pages/admin/EnrollmentSettlement', () => ({
  default: () => <div>enrollment settlement page</div>,
}));

describe('admin compatibility routes', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockUser = { id: 1, role: 'admin', name: '管理员', must_change_password: false, is_super_admin: true };
    const useIsMobile = (await import('../hooks/useIsMobile')).default;
    useIsMobile.mockReturnValue(false);
  });

  it('routes admin home to the admin dashboard', async () => {
    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('admin dashboard page')).toBeInTheDocument();
  });

  it('keeps admin home available on mobile screens', async () => {
    const useIsMobile = (await import('../hooks/useIsMobile')).default;
    useIsMobile.mockReturnValue(true);

    render(
      <MemoryRouter initialEntries={['/admin']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('admin dashboard page')).toBeInTheDocument();
  });

  it('redirects recycle aliases to lead governance', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/recycle-center']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('lead governance page')).toBeInTheDocument();
  });

  it('routes invalid reclaim to the invalid reclaim page', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/invalid-reclaim']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('invalid reclaim page')).toBeInTheDocument();
  });

  it('keeps the historical distribute-by-schools path working', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/distribute-by-schools']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('distribute schools page')).toBeInTheDocument();
  });

  it('routes audit logs to the operation log page', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/audit-logs']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('audit logs page')).toBeInTheDocument();
  });

  it.each([
    ['/admin/home-visits', 'home visit manage page'],
    ['/admin/campus-visits', 'campus visit manage page'],
    ['/admin/enrollment-settlement', 'enrollment settlement page'],
  ])('routes %s to the admissions workflow page', async (path, text) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(text)).toBeInTheDocument();
  });

  it.each([
    ['/admin/report', '?tab=summary'],
    ['/admin/trend', '?tab=trend'],
    ['/admin/call-volume', '?tab=call-volume'],
  ])('redirects %s to report center %s', async (path, tab) => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(`report center page ${tab}`)).toBeInTheDocument();
  });

  it('redirects normal admins away from system settings', async () => {
    mockUser = {
      id: 2,
      role: 'admin',
      name: '普通管理员',
      must_change_password: false,
      is_super_admin: false,
    };

    render(
      <MemoryRouter initialEntries={['/admin/settings']}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('admin dashboard page')).toBeInTheDocument();
    expect(screen.queryByText('system settings page')).not.toBeInTheDocument();
  });

  it.each([
    ['/admin/score-preview', 'agent score preview page'],
    ['/admin/agents', 'agent manage page'],
    ['/admin/report-center', 'report center page '],
    ['/admin/audit-logs', 'audit logs page'],
    ['/admin/work-center', 'work center page'],
    ['/admin/search', 'global search page'],
    ['/admin/leads', 'leads manage page'],
    ['/admin/governance', 'lead governance page'],
    ['/admin/invalid-reclaim', 'invalid reclaim page'],
    ['/admin/distribute', 'distribute schools page'],
    ['/admin/home-visits', 'home visit manage page'],
    ['/admin/campus-visits', 'campus visit manage page'],
    ['/admin/enrollment-settlement', 'enrollment settlement page'],
    ['/admin/report', 'report center page ?tab=summary'],
    ['/admin/trend', 'report center page ?tab=trend'],
    ['/admin/call-volume', 'report center page ?tab=call-volume'],
  ])('redirects normal admins away from protected module %s without permission', async (path, text) => {
    mockUser = {
      id: 2,
      role: 'admin',
      name: '普通管理员',
      must_change_password: false,
      is_super_admin: false,
      page_permissions: [],
    };

    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText('admin dashboard page')).toBeInTheDocument();
    expect(screen.queryByText(text)).not.toBeInTheDocument();
  });

  it.each([
    ['/admin/work-center', ['work_center'], 'work center page'],
    ['/admin/search', ['leads_manage'], 'global search page'],
    ['/admin/leads', ['leads_manage'], 'leads manage page'],
    ['/admin/governance', ['lead_governance'], 'lead governance page'],
    ['/admin/invalid-reclaim', ['invalid_reclaim'], 'invalid reclaim page'],
    ['/admin/distribute', ['school_distribution'], 'distribute schools page'],
    ['/admin/home-visits', ['home_visits'], 'home visit manage page'],
    ['/admin/campus-visits', ['campus_visits'], 'campus visit manage page'],
    ['/admin/enrollment-settlement', ['enrollment_settlement'], 'enrollment settlement page'],
    ['/admin/score-preview', ['score_preview'], 'agent score preview page'],
    ['/admin/agents', ['account_manage'], 'agent manage page'],
    ['/admin/report-center', ['report_center'], /report center page/],
    ['/admin/audit-logs', ['audit_logs'], 'audit logs page'],
  ])('allows normal admins with page permission to open %s', async (path, permissions, text) => {
    mockUser = {
      id: 3,
      role: 'admin',
      name: '授权管理员',
      must_change_password: false,
      is_super_admin: false,
      page_permissions: permissions,
    };

    render(
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>,
    );

    expect(await screen.findByText(text)).toBeInTheDocument();
  });
});
