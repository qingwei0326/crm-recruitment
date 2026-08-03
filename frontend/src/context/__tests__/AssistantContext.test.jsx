import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssistantProvider, useAssistant } from '../AssistantContext';

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: '/admin', search: '' }),
}));

function WidthProbe() {
  const { width, setWidth } = useAssistant();
  return (
    <button type="button" onClick={() => setWidth(999)}>
      {width}
    </button>
  );
}

describe('AssistantProvider width persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses the intended desktop width when no value has been stored', () => {
    render(
      <AssistantProvider active>
        <WidthProbe />
      </AssistantProvider>,
    );

    expect(screen.getByRole('button')).toHaveTextContent('420');
  });

  it('clamps and persists resized widths', () => {
    render(
      <AssistantProvider active>
        <WidthProbe />
      </AssistantProvider>,
    );

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('600');
    expect(localStorage.getItem('crm_assistant_width')).toBe('600');
  });
});
