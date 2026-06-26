import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', name: '管理员', must_change_password: false },
    loading: false,
  }),
}));

vi.mock('../hooks/useIsMobile', () => ({
  default: () => false,
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

vi.mock('../pages/admin/LeadGovernance', () => ({
  default: () => <div>lead governance page</div>,
}));

vi.mock('../pages/admin/InvalidStudentReclaim', () => ({
  default: () => <div>invalid reclaim page</div>,
}));

vi.mock('../pages/admin/DistributeBySchools', () => ({
  default: () => <div>distribute schools page</div>,
}));

describe('admin compatibility routes', () => {
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
});
