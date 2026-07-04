// @ts-check
const { test, expect } = require('@playwright/test');

const adminUser = {
  id: 1,
  username: 'current-admin',
  name: '系统管理员',
  role: 'admin',
  is_active: true,
  is_super_admin: true,
  must_change_password: false,
};

const agentUser = {
  id: 21,
  username: 'current-agent',
  name: '工作流话务员',
  role: 'agent',
  is_active: true,
  must_change_password: false,
};

const lead = {
  id: 301,
  name: '工作流学生',
  school_name: '当前测试中学',
  region: '测试区',
  stage: '新线索',
  status: '未联系',
  status_detail: '',
  intent_level: 'A',
  guardian_name: '工作流家长',
  guardian_phone: '13800000301',
  guardian2_name: '',
  guardian2_phone: '',
  score: 520,
  assigned_to: agentUser.id,
  agent_name: agentUser.name,
  days_since_assigned: 1,
};

const staleAStudent = {
  id: 601,
  name: '周八',
  region: '云霄',
  school_name: '云霄一中',
  status: '跟进中',
  status_detail: '持续跟进',
  stage: '意向跟进',
  intent_level: 'A',
  assigned_to: agentUser.id,
  agent_name: agentUser.name,
  last_activity_at: '2026-06-29T08:30:00',
  days_since: 4,
};

function ok(data) {
  return { code: 0, data };
}

function pagePayload(list, pageSize = 100) {
  return { total: list.length, page: 1, page_size: pageSize, list };
}

async function installApiMocks(page, user = adminUser) {
  await page.addInitScript((currentUser) => {
    localStorage.setItem('crm_user', JSON.stringify(currentUser));
  }, user);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');

    if (path === '/auth/me') {
      await route.fulfill({ json: ok(user) });
      return;
    }
    if (path === '/auth/login') {
      await route.fulfill({ json: ok({ user, access_token: 'mock-token' }) });
      return;
    }
    if (path === '/auth/logout') {
      await route.fulfill({ json: ok({}) });
      return;
    }

    if (path === '/admin/daily-ops') {
      await route.fulfill({
        json: ok({
          summary: { total_items: 1, closed_items: 0, high_pending_items: 1 },
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
              owners: [{ agent_id: agentUser.id, agent_name: agentUser.name, count: 1, max_age_days: 4 }],
            },
          ],
        }),
      });
      return;
    }
    if (path === '/admin/stale-a') {
      await route.fulfill({ json: ok([staleAStudent]) });
      return;
    }
    if (path === '/admin/agents') {
      await route.fulfill({ json: ok([agentUser]) });
      return;
    }
    if (path === '/admin/users') {
      await route.fulfill({ json: ok([adminUser, agentUser]) });
      return;
    }
    if (path === '/admin/agent-score-preview') {
      await route.fulfill({
        json: ok({
          items: [
            {
              agent: { id: agentUser.id, name: agentUser.name, is_active: true },
              score: 82,
              level: 'good',
              level_label: '正常',
              metrics: { today_calls: 10, today_recorded_calls: 9, today_unrecorded_calls: 1 },
            },
          ],
        }),
      });
      return;
    }
    if (path === '/admin/data-quality') {
      await route.fulfill({
        json: ok({
          calls: {
            today: { total_calls: 10, recorded_calls: 9, unrecorded_calls: 1 },
            month: { unrecorded_ratio: 10 },
          },
          students: { missing_phone_tasks: 0, unassigned_active: 2, invalid_total: 0 },
          follow_ups: { open_follow_ups: 0, overdue_follow_ups: 0 },
        }),
      });
      return;
    }
    if (path === '/admin/ops-health') {
      await route.fulfill({ json: ok({ business: { notification_failures_7d: 0, locked_users: 0 } }) });
      return;
    }
    if (path === '/admin/config') {
      await route.fulfill({ json: ok({ pushplus_token: '', stale_days: '3' }) });
      return;
    }
    if (path === '/admin/backups') {
      await route.fulfill({
        json: ok([
          {
            name: 'workflow-smoke-backup.db',
            modified_at: '2026-07-03T08:00:00',
            size: 2048,
          },
        ]),
      });
      return;
    }
    if (path === '/admin/data-health') {
      await route.fulfill({ json: ok({ total_students: 1, missing_phone: 0, duplicate_phone_groups: 0 }) });
      return;
    }
    if (path === '/admin/lead-duplicates' || path === '/admin/lead-duplicates/cleanup-preview') {
      await route.fulfill({ json: ok({ groups: [], total: 0, duplicate_phone_count: 0 }) });
      return;
    }
    if (path === '/admin/risk-alerts') {
      await route.fulfill({ json: ok({ alerts: [] }) });
      return;
    }
    if (path === '/admin/operation-logs') {
      await route.fulfill({ json: ok({ total: 0 }) });
      return;
    }

    if (path === '/admissions/work-items') {
      await route.fulfill({
        json: ok(pagePayload([
          {
            id: 'home_visit:101',
            kind: 'home_visit',
            queue: 'home_visit',
            priority: 'high',
            title: '工作流学生 家访',
            student_id: lead.id,
            student_name: lead.name,
            region: lead.region,
            school_name: lead.school_name,
            agent_name: agentUser.name,
            due_at: '2026-07-03T09:00:00',
            status: 'pending',
            reason: '家访待确认',
            target_url: '/admin/home-visits',
            source_id: 101,
          },
        ])),
      });
      return;
    }
    if (path.startsWith('/admissions/')) {
      await route.fulfill({ json: ok(pagePayload([])) });
      return;
    }

    if (path === '/students/agent/settings') {
      await route.fulfill({ json: ok({ dial_max_per_24h: 3 }) });
      return;
    }
    if (path === '/tasks/yesterday') {
      await route.fulfill({ json: ok({ stale_unconcat: [] }) });
      return;
    }
    if (path === '/tasks/today') {
      await route.fulfill({
        json: ok({
          total: 1,
          list: [lead],
          stats: { total: 1, done: 0, pending: 1, follow_up: 0, progress_pct: 0 },
          schools: [{ name: lead.school_name, count: 1 }],
          truncated: false,
        }),
      });
      return;
    }
    if (path === '/students') {
      await route.fulfill({ json: ok(pagePayload([lead])) });
      return;
    }
    if (path === '/students/enrolled') {
      await route.fulfill({ json: ok(pagePayload([])) });
      return;
    }
    if (path === `/students/${lead.id}` || path === `/students/${staleAStudent.id}`) {
      const data = path.endsWith(String(staleAStudent.id)) ? staleAStudent : lead;
      await route.fulfill({ json: ok(data) });
      return;
    }
    if (path.endsWith('/detail') && path.startsWith('/students/')) {
      await route.fulfill({
        json: ok({
          student: lead,
          calls: [],
          notes: [],
          follow_ups: [],
          visits: [],
          intent_timeline: [],
          admissions_timeline: [],
        }),
      });
      return;
    }

    if (path === '/stats/dashboard-summary') {
      await route.fulfill({ json: ok({ total_students: 1, available_unassigned: 2, today_calls: 10, today_a: 1, a_level: 1 }) });
      return;
    }
    if (path === '/stats/stages') {
      await route.fulfill({ json: ok({ 新线索: 1, 意向跟进: 1, 已报名: 0 }) });
      return;
    }
    if (path === '/stats/sources') {
      await route.fulfill({ json: ok([]) });
      return;
    }
    if (path === '/stats/funnel') {
      await route.fulfill({ json: ok({ stages: [{ name: '新线索', value: 1 }, { name: '意向跟进', value: 1 }] }) });
      return;
    }
    if (path === '/stats/trend') {
      await route.fulfill({ json: ok({ daily: [{ date: '2026-07-03', calls: 10, enrolled: 1 }] }) });
      return;
    }
    if (path === '/stats/agent-ranking') {
      await route.fulfill({ json: ok({ ranking: [{ name: agentUser.name, a_to_enroll: 20 }] }) });
      return;
    }
    if (path === '/stats/admissions-report') {
      await route.fulfill({
        json: ok({
          overview: { total_students: 1, enrolled: 0 },
          regions: [{ name: '测试区', total: 1, enrolled: 0 }],
          agents: [{ name: agentUser.name, total: 1, enrolled: 0 }],
          visits: { home_visits: 0, campus_visits: 0 },
          settlement: { settled: 0, unsettled: 0 },
        }),
      });
      return;
    }
    if (path === '/visits/summary') {
      await route.fulfill({ json: ok({}) });
      return;
    }
    if (path === '/visits' || path === '/follow-ups' || path === '/notes') {
      await route.fulfill({ json: ok(pagePayload([])) });
      return;
    }
    if (path === '/operation-logs' || path === '/operation-logs/call-volume') {
      await route.fulfill({ json: ok(pagePayload([])) });
      return;
    }

    await route.fulfill({ json: ok({}) });
  });
}

test.describe('current full role workflow', () => {
  test('admin dashboard links into the stale A work-center queue', async ({ page }) => {
    await installApiMocks(page, adminUser);

    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
    await expect(page.getByText('A 级超时未推进')).toBeVisible();

    await page.getByRole('link', { name: /查看/ }).first().click();
    await expect(page).toHaveURL(/\/admin\/work-center\?queue=stale-a/);
    await expect(page.getByRole('button', { name: 'A超时 1' })).toBeVisible();
    await expect(page.getByText('周八 A 级超时')).toBeVisible();
  });

  test('admin core modules render with current route names', async ({ page }) => {
    await installApiMocks(page, adminUser);

    const routes = [
      ['/admin/leads', '学生管理', '工作流学生'],
      ['/admin/agents', '账号管理', '工作流话务员'],
      ['/admin/report-center', '报表中心', '招生总览'],
      ['/admin/governance', '线索治理', '数据健康中心'],
      ['/admin/settings', '系统设置', 'workflow-smoke-backup.db'],
    ];

    for (const [route, heading, readyText] of routes) {
      await page.goto(route);
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
      await expect(page.getByText(readyText).first()).toBeVisible();
      await expect(page.getByText('页面出了点问题')).toHaveCount(0);
    }
  });

  test('agent desktop workbench loads assigned students and opens detail', async ({ page }) => {
    await installApiMocks(page, agentUser);

    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: '待拨打' })).toBeVisible();
    await expect(page.getByText('工作流学生')).toBeVisible();

    await page.getByText('工作流学生').first().click();
    await expect(page.getByText('联系人1')).toBeVisible();
    await expect(page.getByText('页面出了点问题')).toHaveCount(0);
  });

  test('mobile agent home renders the same task queue on small screens', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installApiMocks(page, agentUser);

    await page.goto('/mobile');
    await expect(page.getByText('工作流学生')).toBeVisible();
    await expect(page.getByText('下一步：首次呼出')).toBeVisible();
  });

  test('protected routing uses current role defaults', async ({ browser }) => {
    const anonymous = await browser.newContext();
    const anonymousPage = await anonymous.newPage();
    await anonymousPage.route('**/api/auth/me', async (route) => {
      await route.fulfill({ json: { code: -1, data: null } });
    });
    await anonymousPage.goto('/admin');
    await expect(anonymousPage).toHaveURL(/\/login/);
    await anonymous.close();

    const agentContext = await browser.newContext();
    const agentPage = await agentContext.newPage();
    await installApiMocks(agentPage, agentUser);
    await agentPage.goto('/admin');
    await expect(agentPage).toHaveURL(/\/agent/);
    await agentContext.close();
  });
});
