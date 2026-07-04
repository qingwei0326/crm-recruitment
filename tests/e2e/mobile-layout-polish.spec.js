// @ts-check
const { test, expect } = require('@playwright/test');

const agentUser = {
  id: 902,
  username: 'mobile-layout-agent',
  name: '移动话务员',
  role: 'agent',
  is_active: true,
  must_change_password: false,
};

const adminUser = {
  id: 1,
  username: 'mobile-layout-admin',
  name: '移动管理员',
  role: 'admin',
  is_active: true,
  is_super_admin: true,
  must_change_password: false,
};

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    body: document.body.scrollWidth,
    doc: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(metrics.body).toBeLessThanOrEqual(metrics.viewport + 1);
  expect(metrics.doc).toBeLessThanOrEqual(metrics.viewport + 1);
}

test.describe('mobile layout polish', () => {
  test('agent task cards stay contained on narrow phones', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript(({ user }) => {
      localStorage.setItem('crm_user', JSON.stringify(user));
    }, { user: agentUser });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ json: { code: 0, data: agentUser } });
    });
    await page.route('**/api/students/agent/settings', async (route) => {
      await route.fulfill({ json: { code: 0, data: { dial_max_per_24h: 3 } } });
    });
    await page.route('**/api/tasks/yesterday', async (route) => {
      await route.fulfill({ json: { code: 0, data: { stale_unconcat: [] } } });
    });
    await page.route('**/api/tasks/today**', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            total: 2,
            stats: { total: 2, done: 0, pending: 2, follow_up: 0, progress_pct: 0 },
            schools: [{ name: '超长学校名称第一实验中学高中部东校区', count: 2 }],
            truncated: false,
            list: [
              {
                id: 301,
                name: '超长名字学生甲乙丙丁',
                school_name: '超长学校名称第一实验中学高中部东校区',
                region: '超长区域名称',
                stage: '初次联系',
                status: '未联系',
                status_detail: '',
                intent_level: 'A',
                guardian_name: '超长监护人称呼一号',
                guardian_phone: '13800000301',
                guardian2_name: '第二监护人很长',
                guardian2_phone: '13800000302',
                days_since_assigned: 5,
              },
            ],
          },
        },
      });
    });

    await page.goto('/mobile');

    await expect(page.getByText('超长名字学生甲乙丙丁')).toBeVisible();
    await expect(page.getByText('下一步：首次呼出')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: 'test-results/mobile-agent-polish.png', fullPage: true });
  });

  test('admin mobile dashboard stays contained on narrow phones', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    await page.addInitScript(({ user }) => {
      localStorage.setItem('crm_user', JSON.stringify(user));
    }, { user: adminUser });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ json: { code: 0, data: adminUser } });
    });
    await page.route('**/api/stats/dashboard-summary', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            today_calls: 12345,
            today_a: 234,
            available_unassigned: 567,
            a_level: 89,
          },
        },
      });
    });
    await page.route('**/api/admin/data-quality', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            calls: {
              today: { total_calls: 12345, recorded_calls: 8888, unrecorded_calls: 3457 },
              month: { unrecorded_ratio: 38 },
            },
            students: {
              missing_phone_tasks: 12,
              unassigned_active: 567,
              invalid_total: 44,
            },
            follow_ups: {
              open_follow_ups: 66,
              overdue_follow_ups: 7,
            },
          },
        },
      });
    });
    await page.route('**/api/admin/ops-health', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: { business: { notification_failures_7d: 3, locked_users: 1 } },
        },
      });
    });
    await page.route('**/api/admin/agent-score-preview**', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            items: [
              {
                agent: { id: 1, name: '超长姓名话务员一号' },
                score: 49.5,
                level: 'risk',
                level_label: '风险',
                metrics: {
                  today_calls: 1,
                  today_recorded_calls: 0,
                  today_unrecorded_calls: 1,
                  avg_recorded_duration_seconds: 0,
                },
                recommended_action: '优先处理逾期回访和低通话量线索，避免高意向线索流失',
              },
            ],
          },
        },
      });
    });

    await page.goto('/admin');

    await expect(page.getByRole('heading', { name: '移动管理' })).toBeVisible();
    await expect(page.getByText('可分配有效线索')).toBeVisible();
    await expect(page.getByText('超长姓名话务员一号')).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: 'test-results/mobile-admin-polish.png', fullPage: true });
  });
});
