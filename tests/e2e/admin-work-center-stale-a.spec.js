// @ts-check
const { test, expect } = require('@playwright/test');

const adminUser = {
  id: 1,
  username: 'stale-a-admin',
  name: 'A超时测试管理员',
  role: 'admin',
  is_active: true,
  is_super_admin: true,
  must_change_password: false,
};

const staleAStudents = [
  {
    id: 601,
    name: '周八',
    region: '云霄',
    school_name: '云霄一中',
    status: '跟进中',
    status_detail: '持续跟进',
    stage: 'interested',
    intent_level: 'A',
    assigned_to: 12,
    agent_name: '吴坐席',
    last_activity_at: '2026-06-29T08:30:00',
    days_since: 4,
  },
];

const admissionsWorkItems = [
  {
    id: 'home_visit:101',
    kind: 'home_visit',
    queue: 'home_visit',
    priority: 'high',
    title: '张三 家访',
    student_id: 201,
    student_name: '张三',
    region: '龙海',
    school_name: '长泰二中',
    agent_name: '王坐席',
    due_at: '2026-07-02T09:00:00',
    status: 'pending',
    reason: '家访待确认',
    target_url: '/admin/home-visits',
    source_id: 101,
  },
];

function ok(data) {
  return { code: 0, data };
}

async function mockAdminApis(page) {
  await page.addInitScript((user) => {
    localStorage.setItem('crm_user', JSON.stringify(user));
  }, adminUser);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');

    if (path === '/auth/me') {
      await route.fulfill({ json: ok(adminUser) });
      return;
    }
    if (path === '/admin/daily-ops') {
      await route.fulfill({
        json: ok({
          date_key: '2026-07-03',
          summary: {
            total_items: 1,
            closed_items: 0,
            high_pending_items: 1,
          },
          items: [
            {
              key: 'stale_a',
              title: 'A 级超时未推进',
              count: 1,
              severity: 'high',
              detail: 'A 级且 3 天以上无新活动，优先回访或主管介入。',
              status: '待处理',
              is_closed: false,
              to: '/admin/work-center?queue=stale-a',
              owners: [
                {
                  agent_id: 12,
                  agent_name: '吴坐席',
                  count: 1,
                  max_age_days: 4,
                  to: '/admin/work-center?queue=stale-a',
                },
              ],
            },
          ],
        }),
      });
      return;
    }
    if (path === '/admin/stale-a') {
      await route.fulfill({ json: ok(staleAStudents) });
      return;
    }
    if (path === '/admissions/work-items') {
      await route.fulfill({
        json: ok({
          total: admissionsWorkItems.length,
          page: 1,
          page_size: 100,
          list: admissionsWorkItems,
        }),
      });
      return;
    }
    if (path === '/admin/agent-score-preview') {
      await route.fulfill({ json: ok({ items: [] }) });
      return;
    }
    if (path === '/admin/data-quality') {
      await route.fulfill({
        json: ok({
          calls: {
            today: { total_calls: 0, recorded_calls: 0, unrecorded_calls: 0 },
            month: { unrecorded_ratio: 0 },
          },
          students: {
            missing_phone_tasks: 0,
            unassigned_active: 0,
            invalid_total: 0,
          },
          follow_ups: {
            open_follow_ups: 0,
            overdue_follow_ups: 0,
          },
        }),
      });
      return;
    }
    if (path === '/admin/operation-logs') {
      await route.fulfill({ json: ok({ total: 0 }) });
      return;
    }
    if (path === '/stats/dashboard-summary') {
      await route.fulfill({
        json: ok({
          total_students: 1,
          available_unassigned: 0,
          today_calls: 0,
          today_a: 0,
          a_level: 1,
        }),
      });
      return;
    }
    if (path === '/stats/sources') {
      await route.fulfill({ json: ok([]) });
      return;
    }
    if (path === '/stats/stages') {
      await route.fulfill({ json: ok({}) });
      return;
    }
    if (path === '/stats/funnel') {
      await route.fulfill({ json: ok({ stages: [] }) });
      return;
    }
    if (path === '/visits/summary') {
      await route.fulfill({ json: ok({}) });
      return;
    }
    if (path === '/visits' || path === '/follow-ups') {
      await route.fulfill({ json: ok({ total: 0, page: 1, page_size: 100, list: [] }) });
      return;
    }
    if (path === '/students/enrolled') {
      await route.fulfill({ json: ok({ total: 0, page: 1, page_size: 1, list: [] }) });
      return;
    }
    if (path === '/students') {
      await route.fulfill({ json: ok({ total: 0, page: 1, page_size: 100, list: [] }) });
      return;
    }
    if (path === '/students/601') {
      await route.fulfill({
        json: ok({
          ...staleAStudents[0],
          guardian_name: '周八家长',
          guardian_phone: '13800000601',
        }),
      });
      return;
    }
    if (path === '/students/601/detail') {
      await route.fulfill({
        json: ok({
          calls: [],
          notes: [],
          follow_ups: [],
          visits: [],
          intent_timeline: [],
        }),
      });
      return;
    }

    await route.fulfill({ json: ok({}) });
  });
}

test.describe('admin work center stale A queue', () => {
  test('daily ops stale A view opens a populated stale A work-center queue', async ({ page }) => {
    await mockAdminApis(page);

    await page.goto('/admin');

    const staleACard = page
      .locator('section')
      .filter({ hasText: '今日运营闭环' })
      .locator('div')
      .filter({ hasText: 'A 级超时未推进' })
      .first();

    await expect(staleACard.getByText('A 级超时未推进')).toBeVisible();
    await expect(staleACard.getByText('吴坐席')).toBeVisible();

    await Promise.all([
      page.waitForURL('**/admin/work-center?queue=stale-a'),
      staleACard.getByRole('link', { name: /查看/ }).click(),
    ]);

    await expect(page.getByRole('heading', { name: '工作中心' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'A超时 1' })).toBeVisible();
    await expect(page.getByText('A超时待办')).toBeVisible();
    await expect(page.getByText('周八 A 级超时')).toBeVisible();
    await expect(page.getByText('4天未推进')).toBeVisible();
    await expect(page.getByText('张三 家访')).toHaveCount(0);
  });

  test('direct stale A queue exposes the student detail link', async ({ page }) => {
    await mockAdminApis(page);

    await page.goto('/admin/work-center?queue=stale-a');

    await expect(page.getByRole('button', { name: '全部 2' })).toBeVisible();
    await expect(page.getByRole('button', { name: '家访 1' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'A超时 1' })).toBeVisible();
    await expect(page.getByText('周八 A 级超时')).toBeVisible();
    await expect(page.getByText('张三 家访')).toHaveCount(0);

    const row = page
      .locator('div')
      .filter({ hasText: '周八 A 级超时' })
      .filter({ hasText: '4天未推进' })
      .first();
    const viewLink = row.getByRole('link', { name: '查看' });
    await expect(viewLink).toHaveAttribute('href', '/admin/leads/601');

    await Promise.all([
      page.waitForURL('**/admin/leads/601'),
      viewLink.click(),
    ]);
  });
});
