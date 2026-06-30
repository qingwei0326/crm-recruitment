import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminDash from '../AdminDash';
import api from '../../../api';

const mockIsMobile = vi.hoisted(() => vi.fn());

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: mockIsMobile,
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
  }),
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
  }),
}));

vi.mock('../../../components/AdminLayout', () => ({
  default: ({ children }) => <div>{children}</div>,
}));

vi.mock('../../../components/PageHeader', () => ({
  default: ({ title, children }) => (
    <header>
      <h1>{title}</h1>
      {children}
    </header>
  ),
}));

vi.mock('../../../components/HelpModal', () => ({
  default: () => null,
}));

vi.mock('../FunnelChart', () => ({
  default: () => <div>funnel chart</div>,
}));

vi.mock('../AdminMobileDash', () => ({
  default: () => <div>mobile admin dashboard page</div>,
}));

function mockDashboardApis() {
  api.get.mockImplementation((url) => {
    if (url === '/stats/sources') {
      return Promise.resolve({ data: { data: [] } });
    }
    if (url === '/students?page_size=1') {
      return Promise.resolve({ data: { data: { total: 120 } } });
    }
    if (url === '/admin/agents') {
      return Promise.resolve({ data: { data: [{ id: 2, name: '陈老师', today_calls: 18 }] } });
    }
    if (url === '/visits/summary') {
      return Promise.resolve({ data: { data: null } });
    }
    if (url === '/stats/stages') {
      return Promise.resolve({ data: { data: {} } });
    }
    if (url === '/students/enrolled?page_size=1') {
      return Promise.resolve({ data: { data: null } });
    }
    if (url === '/stats/funnel') {
      return Promise.resolve({ data: { data: null } });
    }
    if (url === '/students') {
      return Promise.resolve({ data: { data: { total: 0, list: [] } } });
    }
    if (url === '/follow-ups' || url === '/visits') {
      return Promise.resolve({ data: { data: { list: [] } } });
    }
    if (url === '/admin/agent-score-preview') {
      return Promise.resolve({ data: { data: { items: [] } } });
    }
    if (url === '/admin/operation-logs?action=通知失败&days=7') {
      return Promise.resolve({ data: { data: { total: 0 } } });
    }
    return Promise.resolve({ data: { data: {} } });
  });
}

describe('AdminDash responsive entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDashboardApis();
  });

  it('uses the mobile admin command center on mobile screens', () => {
    mockIsMobile.mockReturnValue(true);

    render(<AdminDash />);

    expect(screen.getByText('mobile admin dashboard page')).toBeInTheDocument();
  });

  it('routes the desktop call-volume metric through report center', async () => {
    mockIsMobile.mockReturnValue(false);

    render(
      <MemoryRouter>
        <AdminDash />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('link', { name: /今日呼出/ })).toHaveAttribute(
      'href',
      '/admin/report-center?tab=call-volume',
    );
  });
});
