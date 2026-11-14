import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AdminLayout from '../AdminLayout';

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', name: '管理员', is_super_admin: true },
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

function renderLayout(props = {}) {
  return render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }} initialEntries={['/admin']}>
      <AdminLayout isMobile={false} sidebarOpen={false} onClose={vi.fn()} {...props}>
        <main>页面内容</main>
      </AdminLayout>
    </MemoryRouter>,
  );
}

function setScreen(width, height) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

describe('AdminLayout', () => {
  beforeEach(() => {
    localStorage.clear();
    setScreen(1440, 900);
  });

  it('renders shared sidebar and page content', () => {
    renderLayout();

    expect(screen.getByRole('link', { name: '仪表盘' })).toBeInTheDocument();
    expect(screen.getByText('页面内容')).toBeInTheDocument();
  });

  it('closes the mobile overlay when tapped', () => {
    const onClose = vi.fn();
    const { container } = renderLayout({ isMobile: true, sidebarOpen: true, onClose });

    fireEvent.click(container.querySelector('.fixed.inset-0'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows the labelled menu on a large screen and remembers a collapse', () => {
    const first = renderLayout();
    expect(screen.getByText('学生管理')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '收起导航' }));
    expect(screen.queryByText('学生管理')).not.toBeInTheDocument();
    // Icon-only links keep their name for screen readers and tooltips.
    expect(screen.getByRole('link', { name: '学生管理' })).toHaveAttribute('href', '/admin/leads');
    first.unmount();

    renderLayout();
    expect(screen.getByRole('button', { name: '展开导航' })).toBeInTheDocument();
  });

  it('starts with icons only on a small laptop screen', () => {
    setScreen(1280, 720);
    renderLayout();

    expect(screen.queryByText('学生管理')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '展开导航' })).toBeInTheDocument();
  });
});
