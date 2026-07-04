import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StudentTimeline, { buildStudentTimeline } from '../StudentTimeline';

describe('buildStudentTimeline', () => {
  it('merges assignment, activity, and intent events newest first', () => {
    const items = buildStudentTimeline({
      student: { id: 1, assigned_at: '2026-06-10T08:00:00' },
      calls: [{ id: 2, created_at: '2026-06-12T08:00:00' }],
      notes: [{ id: 3, created_at: '2026-06-11T08:00:00' }],
      followUps: [{ id: 4, follow_up_date: '2026-06-13T08:00:00' }],
      visits: [{ id: 5, scheduled_date: '2026-06-14T08:00:00' }],
      intentTimeline: [{ intent_level: 'A', created_at: '2026-06-15T08:00:00' }],
      admissionsTimeline: [{ id: 6, type: 'home_visit', occurred_at: '2026-06-16T08:00:00' }],
    });

    expect(items.map((item) => item.kind)).toEqual([
      'admission',
      'intent',
      'visit',
      'follow_up',
      'call',
      'note',
      'assignment',
    ]);
  });

  it('labels zero-second call duration as unrecorded', () => {
    render(
      <StudentTimeline
        calls={[{ id: 1, created_at: '2026-06-12T08:00:00', duration_seconds: 0 }]}
      />,
    );

    expect(screen.getByText('通话 · 未记录')).toBeInTheDocument();
    expect(screen.queryByText(/0秒/)).not.toBeInTheDocument();
  });

  it('renders admissions workflow events', () => {
    render(
      <StudentTimeline
        admissionsTimeline={[
          {
            id: 7,
            type: 'campus_visit',
            title: '预约到校',
            status: '已预约',
            summary: '周六上午到校',
            occurred_at: '2026-07-04T09:30:00',
          },
        ]}
      />,
    );

    expect(screen.getByText('预约到校 · 已预约')).toBeInTheDocument();
    expect(screen.getByText('周六上午到校')).toBeInTheDocument();
  });
});
