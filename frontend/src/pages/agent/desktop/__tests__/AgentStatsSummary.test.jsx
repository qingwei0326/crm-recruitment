import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentStatsSummary from '../AgentStatsSummary';

describe('AgentStatsSummary', () => {
  it('renders completed, pending, and legacy call metrics separately', () => {
    render(
      <AgentStatsSummary
        stats={{
          today_calls: 3,
          today_recorded_calls: 2,
          today_unrecorded_calls: 1,
          today_pending_dial_sessions: 1,
          today_legacy_missing_duration: 0,
          month_calls: 8,
          month_recorded_calls: 6,
          month_unrecorded_calls: 2,
          month_pending_dial_sessions: 1,
          month_legacy_missing_duration: 1,
          today_a_count: 1,
          month_a_count: 4,
          conversion_rate: 25,
          avg_duration_seconds: 75,
        }}
      />,
    );

    expect(screen.getByText('今日拨打')).toBeInTheDocument();
    expect(screen.getByText('今日已完成')).toBeInTheDocument();
    expect(screen.getByText('今日待完成')).toBeInTheDocument();
    expect(screen.getByText('今日历史未回填')).toBeInTheDocument();
    expect(screen.getByText('本月已完成')).toBeInTheDocument();
    expect(screen.getByText('本月待完成')).toBeInTheDocument();
    expect(screen.getByText('本月历史未回填')).toBeInTheDocument();
    expect(screen.getByText('平均流程耗时')).toBeInTheDocument();
    expect(screen.getByText('1分15秒')).toBeInTheDocument();
  });

  it('uses compatibility unrecorded counts as pending when lifecycle fields are absent', () => {
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

    expect(screen.getByText('平均流程耗时')).toBeInTheDocument();
    expect(screen.getByText('今日待完成').parentElement).toHaveTextContent('1');
    expect(screen.getByText('本月待完成').parentElement).toHaveTextContent('1');
    expect(screen.getByText('今日历史未回填').parentElement).toHaveTextContent('0');
    expect(screen.getByText('本月历史未回填').parentElement).toHaveTextContent('0');
    expect(screen.getByText('-')).toBeInTheDocument();
    expect(screen.queryByText('未记录')).not.toBeInTheDocument();
    expect(screen.queryByText('0秒')).not.toBeInTheDocument();
  });
});
