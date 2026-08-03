import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AssistantOverlay from '../AssistantOverlay';

let assistant;

vi.mock('../../../context/AssistantContext', () => ({
  useAssistant: () => assistant,
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => true,
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/admin', search: '' }),
}));

vi.mock('../AssistantPanel', () => ({
  default: () => <div>assistant panel</div>,
}));

describe('AssistantOverlay mobile layout', () => {
  beforeEach(() => {
    assistant = {
      active: true,
      open: false,
      setOpen: vi.fn(),
      openAssistant: vi.fn(),
      maximized: false,
      width: 420,
      setWidth: vi.fn(),
    };
  });

  it('keeps the floating entry above the phone safe area', () => {
    render(<AssistantOverlay />);
    const button = screen.getByRole('button', { name: '打开 AI 助手' });
    expect(button.className).toContain('bottom-[calc(env(safe-area-inset-bottom)+1rem)]');
  });

  it('uses the dynamic mobile viewport instead of a desktop inset height', () => {
    assistant.open = true;
    render(<AssistantOverlay />);
    const panel = screen.getByRole('region', { name: 'AI 助手' });
    expect(panel.className).toContain('h-[100dvh]');
    expect(panel.className).toContain('inset-x-0');
  });
});
