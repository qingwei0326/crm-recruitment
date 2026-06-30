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

vi.mock('../pages/admin/LeadGovernance', () => ({
  default: () => <div>lead governance page</div>,
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
});
