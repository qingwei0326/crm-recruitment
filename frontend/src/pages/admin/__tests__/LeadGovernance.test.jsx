import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LeadGovernance from '../LeadGovernance';

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: { id: 1, role: 'admin', name: '管理员' },
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
  it('groups all lead governance workflows in one admin entry page', () => {
    render(
      <MemoryRouter initialEntries={['/admin/governance']}>
        <LeadGovernance />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: '线索治理' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /学生管理与分配/ })).toHaveAttribute('href', '/admin/leads');
    expect(screen.getByRole('link', { name: /超时线索回收/ })).toHaveAttribute('href', '/admin/recycle');
    expect(screen.getByRole('link', { name: /无效线索回收/ })).toHaveAttribute('href', '/admin/invalid-reclaim');
    expect(screen.getByRole('link', { name: /多学校分发/ })).toHaveAttribute('href', '/admin/distribute');
  });
});
