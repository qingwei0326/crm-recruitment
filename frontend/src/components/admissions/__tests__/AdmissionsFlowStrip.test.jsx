import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AdmissionsFlowStrip, { buildAdmissionsFlowSteps } from '../AdmissionsFlowStrip';

describe('AdmissionsFlowStrip', () => {
  it('derives completed home visit, campus visit, and enrollment steps', () => {
    const steps = buildAdmissionsFlowSteps({
      student: {
        status: '已报名',
        stage: '已报名',
        intent_level: 'A',
      },
      admissionsTimeline: [
        {
          type: 'home_visit',
          status: '已完成',
          result: '安排到校参观',
          occurred_at: '2026-07-01T09:00:00',
        },
        {
          type: 'campus_visit',
          status: '已到校',
          result: '已到校',
          occurred_at: '2026-07-02T09:00:00',
        },
        {
          type: 'enrollment',
          status: '未结算',
          summary: '护理',
          occurred_at: '2026-07-03T09:00:00',
        },
      ],
    });

    expect(steps.map((step) => [step.key, step.state])).toEqual([
      ['phone', 'done'],
      ['home_reported', 'done'],
      ['home_completed', 'done'],
      ['campus_scheduled', 'done'],
      ['campus_arrived', 'done'],
      ['enrolled', 'done'],
    ]);
  });

  it('renders the admissions workflow labels', () => {
    render(
      <AdmissionsFlowStrip
        student={{ status: '待回访', stage: '待家访', intent_level: 'A' }}
        admissionsTimeline={[
          {
            type: 'home_visit',
            status: '待确认',
            scheduled_at: '2026-07-04T09:30:00',
            occurred_at: '2026-07-03T09:30:00',
          },
        ]}
      />,
    );

    expect(screen.getByText('招生流程')).toBeInTheDocument();
    expect(screen.getByText('电话确认')).toBeInTheDocument();
    expect(screen.getByText('家访上报')).toBeInTheDocument();
    expect(screen.getByText('家访完成')).toBeInTheDocument();
    expect(screen.getByText('到校预约')).toBeInTheDocument();
    expect(screen.getByText('已到校')).toBeInTheDocument();
    expect(screen.getByText('报名')).toBeInTheDocument();
  });
});
