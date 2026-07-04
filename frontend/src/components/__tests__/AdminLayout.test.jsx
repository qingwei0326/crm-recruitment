import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminLayout from '../AdminLayout';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', name: '管理员' },
    logout: vi.fn(),
  }),
}));

vi.mock('../../context/ThemeContext', () => ({
  useTheme: () => ({
    dark: false,
    toggle: vi.fn(),
  }),
}));

vi.mock('../../hooks/useIsMobile', () => ({
  default: () => false,
}));

describe('AdminLayout', () => {
  it('renders shared sidebar and page content', () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminLayout isMobile={false} sidebarOpen={false} onClose={vi.fn()}>
          <main>页面内容</main>
        </AdminLayout>
      </MemoryRouter>,
    );

    expect(screen.getByRole('link', { name: '仪表盘' })).toBeInTheDocument();
    expect(screen.getByText('页面内容')).toBeInTheDocument();
  });

  it('closes the mobile overlay when tapped', () => {
    const onClose = vi.fn();
    const { container } = render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
        <AdminLayout isMobile sidebarOpen onClose={onClose}>
          <main>页面内容</main>
        </AdminLayout>
      </MemoryRouter>,
    );

    fireEvent.click(container.querySelector('.fixed.inset-0'));
    expect(onClose).toHaveBeenCalled();
  });
});
