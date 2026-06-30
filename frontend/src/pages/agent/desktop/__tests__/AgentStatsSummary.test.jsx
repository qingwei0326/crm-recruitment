import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentStatsSummary from '../AgentStatsSummary';

describe('AgentStatsSummary', () => {
  it('renders recorded and unrecorded call metrics separately', () => {
    render(
      <AgentStatsSummary
        stats={{
          today_calls: 3,
          today_recorded_calls: 2,
          today_unrecorded_calls: 1,
          month_calls: 8,
          month_recorded_calls: 6,
          month_unrecorded_calls: 2,
          today_a_count: 1,
          month_a_count: 4,
          conversion_rate: 25,
          avg_duration_seconds: 75,
        }}
      />,
    );

    expect(screen.getByText('今日拨打')).toBeInTheDocument();
    expect(screen.getByText('今日有效')).toBeInTheDocument();
    expect(screen.getByText('今日未记录')).toBeInTheDocument();
    expect(screen.getByText('本月有效')).toBeInTheDocument();
    expect(screen.getByText('本月未记录')).toBeInTheDocument();
    expect(screen.getByText('平均有效通话')).toBeInTheDocument();
    expect(screen.getByText('1分15秒')).toBeInTheDocument();
  });

  it('shows unrecorded instead of zero seconds when no positive duration exists', () => {
    render(
      <AgentStatsSummary
        stats={{
          today_calls: 1,
          today_unrecorded_calls: 1,
          month_calls: 1,
          month_unrecorded_calls: 1,
          avg_duration_seconds: 0,
        }}
      />,
    );

    expect(screen.getByText('平均有效通话')).toBeInTheDocument();
    expect(screen.getByText('未记录')).toBeInTheDocument();
    expect(screen.queryByText('0秒')).not.toBeInTheDocument();
  });
});
