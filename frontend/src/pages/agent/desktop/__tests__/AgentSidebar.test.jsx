import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AgentSidebar from '../AgentSidebar';

function renderSidebar(overrides = {}) {
  const props = {
    viewTab: 'today',
    onTabChange: vi.fn(),
    onAddStudent: vi.fn(),
    onShowSettings: vi.fn(),
    dark: false,
    onToggleTheme: vi.fn(),
    onLogout: vi.fn(),
    isMobile: true,
    onCloseMenu: vi.fn(),
    ...overrides,
  };
  render(<AgentSidebar {...props} />);
  return props;
}

describe('AgentSidebar mobile actions', () => {
  it('closes the drawer and opens push settings', () => {
    const props = renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: '推送设置' }));

    expect(props.onCloseMenu).toHaveBeenCalledTimes(1);
    expect(props.onShowSettings).toHaveBeenCalledTimes(1);
  });

  it('closes the drawer before changing to the following view', () => {
    const props = renderSidebar();

    fireEvent.click(screen.getByRole('button', { name: '跟进中' }));

    expect(props.onCloseMenu).toHaveBeenCalledTimes(1);
    expect(props.onTabChange).toHaveBeenCalledWith('following');
  });
});
