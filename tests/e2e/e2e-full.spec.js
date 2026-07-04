// @ts-check
const { test, expect } = require('@playwright/test');

const adminUser = {
  id: 1,
  username: 'admin-smoke',
  name: '系统管理员',
  role: 'admin',
  is_active: true,
  is_super_admin: true,
  must_change_password: false,
};

const agentUser = {
  id: 22,
  username: 'agent-smoke',
  name: '话务员冒烟',
  role: 'agent',
  is_active: true,
  must_change_password: false,
};

const forcedPasswordUser = {
  ...agentUser,
  id: 23,
  username: 'force-change-agent',
  must_change_password: true,
};

const student = {
  id: 7001,
  name: '冒烟学生',
  school_name: '冒烟测试中学',
  region: '测试区',
  stage: '新线索',
  status: '未联系',
  status_detail: '',
  intent_level: 'A',
  guardian_name: '冒烟家长',
  guardian_phone: '13800007001',
  guardian2_name: '',
  guardian2_phone: '',
  score: 500,
  days_since_assigned: 1,
};

function ok(data) {
  return { code: 0, data };
}

function pagePayload(list, pageSize = 100) {
  return { total: list.length, page: 1, page_size: pageSize, list };
}

async function installSmokeApi(page, initialUser = null) {
  let currentUser = initialUser;

  if (initialUser) {
    await page.addInitScript((user) => {
      localStorage.setItem('crm_user', JSON.stringify(user));
    }, initialUser);
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');

    if (path === '/auth/me') {
      await route.fulfill({ json: currentUser ? ok(currentUser) : { code: -1, data: null } });
      return;
    }
    if (path === '/auth/login') {
      const body = request.postDataJSON();
      if (body.username === 'admin') currentUser = adminUser;
      else if (body.username === 'force') currentUser = forcedPasswordUser;
      else currentUser = agentUser;
      await route.fulfill({ json: ok({ user: currentUser, access_token: 'mock-token' }) });
      return;
    }
    if (path === '/auth/logout') {
      currentUser = null;
      await route.fulfill({ json: ok({}) });
      return;
    }
    if (path === '/auth/change-password') {
      currentUser = { ...forcedPasswordUser, must_change_password: false };
      await route.fulfill({ json: ok(currentUser) });
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
          list: [student],
          stats: { total: 1, done: 0, pending: 1, follow_up: 0, progress_pct: 0 },
          schools: [{ name: student.school_name, count: 1 }],
          truncated: false,
        }),
      });
      return;
    }
    if (path === '/students/agent/settings') {
      await route.fulfill({ json: ok({ dial_max_per_24h: 3 }) });
      return;
    }
    if (path === '/students' || path === '/students/enrolled') {
      await route.fulfill({ json: ok(pagePayload(path === '/students' ? [student] : [])) });
      return;
    }
    if (path === `/students/${student.id}`) {
      await route.fulfill({ json: ok(student) });
      return;
    }
    if (path === `/students/${student.id}/detail`) {
      await route.fulfill({
        json: ok({
          student,
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

    if (path === '/admin/users' || path === '/admin/agents') {
      await route.fulfill({ json: ok([adminUser, agentUser]) });
      return;
    }
    if (path === '/admin/daily-ops') {
      await route.fulfill({
        json: ok({
          summary: { total_items: 0, closed_items: 0, high_pending_items: 0 },
          items: [],
        }),
      });
      return;
    }
    if (path === '/admin/stale-a') {
      await route.fulfill({ json: ok([]) });
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
            today: { total_calls: 4, recorded_calls: 4, unrecorded_calls: 0 },
            month: { unrecorded_ratio: 0 },
          },
          students: { missing_phone_tasks: 0, unassigned_active: 1, invalid_total: 0 },
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
      await route.fulfill({ json: ok([]) });
      return;
    }

    if (path === '/admissions/work-items') {
      await route.fulfill({ json: ok(pagePayload([])) });
      return;
    }
    if (path.startsWith('/admissions/')) {
      await route.fulfill({ json: ok(pagePayload([])) });
      return;
    }

    if (path === '/stats/dashboard-summary') {
      await route.fulfill({ json: ok({ total_students: 1, available_unassigned: 1, today_calls: 4, today_a: 1, a_level: 1 }) });
      return;
    }
    if (path === '/stats/stages') {
      await route.fulfill({ json: ok({ 新线索: 1 }) });
      return;
    }
    if (path === '/stats/sources') {
      await route.fulfill({ json: ok([]) });
      return;
    }
    if (path === '/stats/funnel') {
      await route.fulfill({ json: ok({ stages: [{ name: '新线索', value: 1 }] }) });
      return;
    }
    if (path === '/stats/trend') {
      await route.fulfill({ json: ok({ daily: [{ date: '2026-07-03', calls: 4, enrolled: 0 }] }) });
      return;
    }
    if (path === '/stats/agent-ranking') {
      await route.fulfill({ json: ok({ ranking: [{ name: agentUser.name, a_to_enroll: 0 }] }) });
      return;
    }
    if (path === '/stats/admissions-report') {
      await route.fulfill({
        json: ok({
          overview: { total_students: 1, enrolled: 0 },
          regions: [],
          agents: [],
          visits: {},
          settlement: {},
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

test.describe('current e2e smoke contracts', () => {
  test('admin login uses the current dashboard route', async ({ page }) => {
    await installSmokeApi(page);

    await page.goto('/login');
    await page.getByPlaceholder('请输入用户名').fill('admin');
    await page.getByPlaceholder('请输入密码').fill('admin123');
    await page.getByRole('button', { name: '登 录' }).click();

    await expect(page).toHaveURL(/\/admin$/);
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '今日运营闭环' })).toBeVisible();
  });

  test('agent login uses the current desktop workbench route', async ({ page }) => {
    await installSmokeApi(page);

    await page.goto('/login');
    await page.getByPlaceholder('请输入用户名').fill('agent');
    await page.getByPlaceholder('请输入密码').fill('agent123');
    await page.getByRole('button', { name: '登 录' }).click();

    await expect(page).toHaveURL(/\/agent$/);
    await expect(page.getByRole('heading', { name: '待拨打' })).toBeVisible();
    await expect(page.getByText('冒烟学生')).toBeVisible();
  });

  test('forced password users are routed to change-password', async ({ page }) => {
    await installSmokeApi(page);

    await page.goto('/login');
    await page.getByPlaceholder('请输入用户名').fill('force');
    await page.getByPlaceholder('请输入密码').fill('init123');
    await page.getByRole('button', { name: '登 录' }).click();

    await expect(page).toHaveURL(/\/change-password$/);
    await expect(page.getByRole('heading', { name: '设置新密码' })).toBeVisible();
  });

  test('legacy report route aliases land in report center tabs', async ({ page }) => {
    await installSmokeApi(page, adminUser);

    await page.goto('/admin/report');
    await expect(page).toHaveURL(/\/admin\/report-center\?tab=summary/);
    await expect(page.getByRole('heading', { name: '报表中心' })).toBeVisible();

    await page.goto('/admin/trend');
    await expect(page).toHaveURL(/\/admin\/report-center\?tab=trend/);
    await expect(page.getByRole('button', { name: /趋势报表/ })).toBeVisible();

    await page.goto('/admin/call-volume');
    await expect(page).toHaveURL(/\/admin\/report-center\?tab=call-volume/);
    await expect(page.getByRole('button', { name: /通电量查询/ })).toBeVisible();
  });

  test('mobile viewport sends agents to the mobile workbench', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await installSmokeApi(page, agentUser);

    await page.goto('/agent');
    await expect(page).toHaveURL(/\/agent$/);

    await page.goto('/mobile');
    await expect(page.getByText('冒烟学生')).toBeVisible();
  });
});
