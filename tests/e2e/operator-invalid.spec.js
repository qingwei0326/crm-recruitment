// @ts-check
const { test, expect } = require('@playwright/test');

const agentUser = {
  id: 901,
  username: 'e2e-agent',
  name: 'E2E话务员',
  role: 'agent',
  is_active: true,
  must_change_password: false,
};

const students = [
  {
    id: 1001,
    name: 'E2E空号学生',
    school_name: '测试中学',
    region: '测试区',
    stage: '初次联系',
    status: '未联系',
    status_detail: '',
    intent_level: '无',
    guardian_name: '家长A',
    guardian_phone: '13800000001',
    guardian2_name: '',
    guardian2_phone: '',
    score: 520,
    days_since_assigned: 1,
  },
  {
    id: 1002,
    name: 'E2E下一条学生',
    school_name: '测试中学',
    region: '测试区',
    stage: '初次联系',
    status: '未联系',
    status_detail: '',
    intent_level: '无',
    guardian_name: '家长B',
    guardian_phone: '13800000002',
    guardian2_name: '',
    guardian2_phone: '',
    score: 480,
    days_since_assigned: 2,
  },
];

test.describe('operator invalid result flow', () => {
  test('fixed invalid reason saves without remark prompt and moves to next valid student', async ({ page }) => {
    const updateRequests = [];

    await page.addInitScript(({ user }) => {
      localStorage.setItem('crm_user', JSON.stringify(user));
      sessionStorage.setItem(
        'pendingDial',
        JSON.stringify({
          studentId: 1001,
          studentName: 'E2E空号学生',
          dialStartedAt: Date.now() - 30_000,
        }),
      );
    }, { user: agentUser });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ json: { code: 0, data: agentUser } });
    });
    await page.route('**/api/tasks/today', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            list: students,
            stats: { total: 2, done: 0, pending: 2, follow_up: 0, progress_pct: 0 },
            schools: [{ name: '测试中学', count: 2 }],
          },
        },
      });
    });
    await page.route('**/api/calls/check**', async (route) => {
      await route.fulfill({ json: { code: 0, data: { count: 0, can_call: true } } });
    });
    await page.route('**/api/students/1001/detail', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: { calls: [], notes: [], follow_ups: [], visits: [], intent_timeline: [] },
        },
      });
    });
    await page.route('**/api/students/dial-duration**', async (route) => {
      await route.fulfill({ json: { code: 0, data: {} } });
    });
    await page.route('**/api/students/1001', async (route) => {
      if (route.request().method() === 'PUT') {
        updateRequests.push(route.request().postDataJSON());
        await route.fulfill({
          json: {
            code: 0,
            data: {
              ...students[0],
              status: '无效',
              status_detail: '空号',
              invalid_reason: '空号',
            },
          },
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/agent');

    await expect(page.getByRole('heading', { name: '待拨打' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'E2E空号学生' })).toBeVisible();

    await page.getByRole('button', { name: '空号', exact: true }).click();

    await expect(page.getByRole('heading', { name: 'E2E空号学生' })).not.toBeVisible();
    await expect(page.getByText('E2E空号学生')).not.toBeVisible();
    await expect(page.getByText('E2E下一条学生')).toBeVisible();
    await expect(page.getByText('1 / 1')).toBeVisible();
    expect(updateRequests).toEqual([{ status: '无效', invalid_reason: '空号' }]);
  });
});
