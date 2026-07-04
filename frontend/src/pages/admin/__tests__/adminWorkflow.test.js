import { describe, expect, it } from 'vitest';
import { buildDashboardActions } from '../adminWorkflow';

describe('buildDashboardActions', () => {
  it('returns only actionable risk items for the dashboard todo area', () => {
    const actions = buildDashboardActions({
      helpCount: 0,
      followUps: [{ follow_up_date: new Date(Date.now() + 86400000).toISOString() }],
      visits: [{ scheduled_date: new Date().toISOString() }],
      scoreItems: [
        { level: 'good', signals: [] },
        { level: 'excellent', signals: [] },
      ],
      missingPhoneCount: 0,
      staleAItems: [],
      notifyFails: 0,
      canViewSystemSettings: true,
    });

    expect(actions).toEqual([]);
  });

  it('keeps urgent help, overdue follow-ups, data quality, attention agents, stale A, and notification failures', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString();
    const actions = buildDashboardActions({
      helpCount: 2,
      followUps: [{ follow_up_date: yesterday }],
      visits: [{ scheduled_date: new Date().toISOString() }],
      scoreItems: [
        {
          level: 'watch',
          signals: [{ key: 'low_call_activity' }],
        },
      ],
      missingPhoneCount: 3,
      staleAItems: [{ id: 1 }],
      notifyFails: 1,
      canViewSystemSettings: true,
      canViewWorkCenter: true,
      canViewLeadsManage: true,
      canViewScorePreview: true,
    });

    expect(actions.map((item) => item.key)).toEqual([
      'help',
      'follow',
      'missing-phone',
      'agent',
      'stale-a',
      'notify',
    ]);
    expect(actions.find((item) => item.key === 'follow')).toMatchObject({
      value: 1,
      detail: '1 条逾期，1 条未完成回访',
      tone: 'red',
    });
    expect(actions.find((item) => item.key === 'stale-a')).toMatchObject({
      to: '/admin/work-center?queue=stale-a',
    });
  });
});
