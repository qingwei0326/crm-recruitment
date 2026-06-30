import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import HeatmapChart from '../HeatmapChart';

describe('HeatmapChart', () => {
  it('renders sparse readable date labels for the 30-day header', () => {
    const dates = Array.from({ length: 30 }, (_, index) => {
      const day = String(index + 1).padStart(2, '0');
      return `2026-06-${day}`;
    });

    render(
      <HeatmapChart
        data={{
          agents: ['沈雨晨'],
          dates,
          data: [dates.map((_, index) => (index === 29 ? 3 : 0))],
        }}
      />,
    );

    expect(screen.getByText('06-01')).toBeInTheDocument();
    expect(screen.getByText('06-06')).toBeInTheDocument();
    expect(screen.getByText('06-30')).toBeInTheDocument();
    expect(screen.queryByText('06-02')).not.toBeInTheDocument();
    expect(screen.getByLabelText('2026-06-02')).toBeInTheDocument();
  });
});
