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

  it('renders completed, pending, and legacy call recording states explicitly', () => {
    render(
      <StudentTimeline
        calls={[
          {
            id: 1,
            created_at: '2026-06-12T08:00:00',
            duration_seconds: 73,
            recording_state: 'completed',
          },
          {
            id: 2,
            created_at: '2026-06-12T07:00:00',
            duration_seconds: 0,
            recording_state: 'pending',
          },
          {
            id: 3,
            created_at: '2026-06-12T06:00:00',
            duration_seconds: 0,
            recording_state: 'legacy_missing',
          },
        ]}
      />,
    );

    expect(screen.getByText('通话 · 已完成 · 1分13秒')).toBeInTheDocument();
    expect(screen.getByText('通话 · 待完成')).toBeInTheDocument();
    expect(screen.getByText('通话 · 历史未回填')).toBeInTheDocument();
    expect(screen.queryByText(/0秒/)).not.toBeInTheDocument();
  });

  it('falls back to duration for legacy API payloads without recording state', () => {
    render(
      <StudentTimeline
        calls={[
          { id: 1, created_at: '2026-06-12T08:00:00', duration_seconds: 10 },
          { id: 2, created_at: '2026-06-12T07:00:00', duration_seconds: 0 },
        ]}
      />,
    );

    expect(screen.getByText('通话 · 已完成 · 10秒')).toBeInTheDocument();
    expect(screen.getByText('通话 · 待完成')).toBeInTheDocument();
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
