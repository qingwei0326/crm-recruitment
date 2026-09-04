import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  DashboardCardPicker,
  hasDashboardCardData,
  useDashboardCardPreferences,
} from '../DashboardCardPicker';

const cards = [
  { key: 'core', label: '核心指标', value: 0, hideWhenEmpty: false },
  { key: 'optional', label: '可选指标', value: 3, defaultVisible: false },
];

function Harness() {
  const preferences = useDashboardCardPreferences({ cards, scope: 'test', userKey: '1' });
  return (
    <>
      <DashboardCardPicker
        cards={cards}
        hiddenKeys={preferences.hiddenKeys}
        onToggle={preferences.toggleCard}
        onReset={preferences.resetCards}
      />
      <div data-testid="visible-cards">
        {preferences.visibleCards.filter((card) => hasDashboardCardData(card)).map((card) => card.label).join(',')}
      </div>
    </>
  );
}

describe('DashboardCardPicker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps core zero metrics while hiding optional cards until selected', () => {
    render(<Harness />);

    expect(screen.getByTestId('visible-cards')).toHaveTextContent('核心指标');
    expect(screen.getByTestId('visible-cards')).not.toHaveTextContent('可选指标');

    fireEvent.click(screen.getByRole('button', { name: /更多/ }));
    fireEvent.click(screen.getByLabelText('可选指标'));

    expect(screen.getByTestId('visible-cards')).toHaveTextContent('核心指标,可选指标');
    expect(localStorage.getItem('crm_admin_dashboard_cards:v1:1:test')).toBe('{"hiddenKeys":[]}');
  });

  it('reports empty cards as unavailable when they are configured to auto-hide', () => {
    expect(hasDashboardCardData({ value: 0, hideWhenEmpty: true })).toBe(false);
    expect(hasDashboardCardData({ value: 0, hideWhenEmpty: false })).toBe(true);
  });
});
