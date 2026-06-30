// @ts-check
const { test, expect } = require('@playwright/test');

const adminUser = {
  id: 1,
  username: 'mobile-admin',
  name: '移动管理员',
  role: 'admin',
  is_active: true,
  must_change_password: false,
};

test.describe('admin mobile dashboard', () => {
  test('shows mobile command center metrics and agent risks', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
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
            total_students: 120,
            contacted: 60,
            a_level: 8,
            today_calls: 12,
            enrolled_total: 3,
          },
        },
      });
    });
    await page.route('**/api/admin/data-quality', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            status: 'warning',
            calls: {
              today: { total_calls: 12, recorded_calls: 9, unrecorded_calls: 3 },
              month: { unrecorded_ratio: 25, avg_recorded_duration_seconds: 80 },
            },
            students: {
              missing_phone_tasks: 2,
              unassigned_active: 5,
              invalid_total: 4,
              invalid_reasons: [{ reason: '空号', count: 2 }],
            },
            follow_ups: {
              open_follow_ups: 6,
              overdue_follow_ups: 1,
            },
          },
        },
      });
    });
    await page.route('**/api/admin/ops-health', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            status: 'warning',
            business: {
              notification_failures_7d: 1,
              locked_users: 0,
            },
          },
        },
      });
    });
    await page.route('**/api/admin/agent-score-preview**', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            generated_at: '2026-06-29T00:00:00',
            daily_call_target: 30,
            items: [
              {
                agent: { id: 7, name: '蒲安琪', username: 'pu', is_active: true },
                score: 52.5,
                level: 'watch',
                level_label: '关注',
                metrics: {
                  today_calls: 4,
                  today_recorded_calls: 2,
                  today_unrecorded_calls: 2,
                  avg_recorded_duration_seconds: 75,
                },
                recommended_action: '先补齐通话记录并处理待回访',
              },
              {
                agent: { id: 8, name: '王坐席', username: 'wang', is_active: true },
                score: 88,
                level: 'good',
                level_label: '正常',
                metrics: {
                  today_calls: 18,
                  today_recorded_calls: 18,
                  today_unrecorded_calls: 0,
                  avg_recorded_duration_seconds: 90,
                },
                recommended_action: '继续推进 A/B 意向线索',
              },
            ],
          },
        },
      });
    });

    await page.goto('/admin');

    await expect(page.getByRole('heading', { name: '移动管理' })).toBeVisible();
    await expect(page.getByText('今日有事项需要处理')).toBeVisible();
    await expect(page.getByText('今日拨号')).toBeVisible();
    await expect(page.getByText('有效 9 · 未记录 3')).toBeVisible();
    await expect(page.getByText('逾期回访')).toBeVisible();
    await expect(page.getByText('未分配线索')).toBeVisible();
    await expect(page.getByText('缺电话任务')).toBeVisible();
    await expect(page.getByText('2 条待补手机号')).toBeVisible();
    await expect(page.getByText('今日 3 通，本月占比 25%')).toBeVisible();
    await expect(page.getByText('蒲安琪')).toBeVisible();
    await expect(page.getByText('先补齐通话记录并处理待回访')).toBeVisible();
  });
});
