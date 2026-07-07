// @ts-check
const { test, expect } = require('@playwright/test');

const adminUser = {
  id: 1,
  username: 'review-admin',
  name: '复盘管理员',
  role: 'admin',
  is_active: true,
  is_super_admin: true,
  must_change_password: false,
};

function ok(data) {
  return { code: 0, data };
}

async function mockApis(page) {
  await page.addInitScript((user) => {
    localStorage.setItem('crm_user', JSON.stringify(user));
  }, adminUser);

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api', '');

    if (path === '/auth/me') {
      await route.fulfill({ json: ok(adminUser) });
      return;
    }
    if (path === '/admin/users') {
      await route.fulfill({ json: ok([adminUser]) });
      return;
    }
    if (path === '/operation-logs') {
      await route.fulfill({
        json: ok({
          total: 1,
          page: 1,
          page_size: 50,
          actions: [{ action: '智能分配汇总', count: 1 }],
          categories: [{ category: '分配', count: 1 }],
          list: [
            {
              seq: 1,
              id: 1,
              operator_id: 1,
              operator_name: '复盘管理员',
              action: '智能分配汇总',
              category: '分配',
              content: '智能分配执行：实际 4 条',
              batch_id: 'smart-assign-review-test',
              can_rollback_assignment: true,
              student_id: null,
              student_name: '',
              student_school_name: '',
              case_no: '',
              created_at: '2026-07-07 07:01:00',
            },
          ],
        }),
      });
      return;
    }
    if (path === '/admin/assignment-batches/smart-assign-review-test/review') {
      await route.fulfill({
        json: ok({
          batch: {
            batch_id: 'smart-assign-review-test',
            action: '智能分配汇总',
            operator_name: '复盘管理员',
            assigned_at: '2026-07-07 07:00:00',
            assigned_count: 4,
            window_days: Number(url.searchParams.get('window_days') || 7),
            window_start: '2026-07-07 07:00:00',
            window_end: '2026-07-14 07:00:00',
            incomplete_assignment_trace: false,
          },
          funnel: {
            assigned: 4,
            dialed: 2,
            effective_handled: 2,
            enrolled: 1,
            undialed: 2,
            unhandled: 2,
            dial_rate: 50,
            effective_handle_rate: 50,
            enrollment_rate: 25,
          },
          agents: [
            {
              agent_id: 7,
              agent_name: '坐席A',
              assigned: 4,
              dialed: 2,
              effective_handled: 2,
              enrolled: 1,
              undialed: 2,
              unhandled: 2,
              dial_rate: 50,
              effective_handle_rate: 50,
              enrollment_rate: 25,
            },
          ],
          unhandled_students: [
            {
              student_id: 101,
              student_name: '未处理学生',
              school_name: '测试中学',
              region: '芗城区',
              agent_id: 7,
              agent_name: '坐席A',
              status: '未联系',
              dialed: false,
              effective_handled: false,
            },
          ],
          alerts: [
            {
              type: 'undialed_rate',
              severity: 'high',
              title: '未拨打比例偏高',
              detail: '窗口内 2 条线索仍未拨打。',
            },
          ],
        }),
      });
      return;
    }

    await route.fulfill({ json: ok({}) });
  });
}

test('opens assignment batch review from audit logs and switches window', async ({ page }) => {
  await mockApis(page);

  await page.goto('/admin/audit-logs');
  await expect(page.getByText('智能分配执行：实际 4 条')).toBeVisible();
  await page.getByRole('link', { name: '复盘' }).click();

  await expect(page).toHaveURL(/\/admin\/assignment-batches\/smart-assign-review-test\/review/);
  await expect(page.getByText('分配批次复盘')).toBeVisible();
  await expect(page.getByText('smart-assign-review-test')).toBeVisible();
  await expect(page.getByText('未拨打比例偏高')).toBeVisible();
  await expect(page.getByText('未处理学生')).toBeVisible();

  await page.getByRole('button', { name: '3天' }).click();
  await expect(page.getByText('当前窗口 3 天')).toBeVisible();
});
