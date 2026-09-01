// @ts-check
const { test, expect } = require('@playwright/test');

const agentUser = {
  id: 902,
  username: 'mobile-e2e-agent',
  name: '移动话务员',
  role: 'agent',
  is_active: true,
  must_change_password: false,
};

const firstStudent = {
  id: 2001,
  name: '移动空号学生',
  school_name: '移动测试中学',
  region: '测试区',
  stage: '初次联系',
  status: '未联系',
  status_detail: '',
  intent_level: '无',
  guardian_name: '家长A',
  guardian_phone: '13800002001',
  guardian2_name: '',
  guardian2_phone: '',
  score: 510,
  days_since_assigned: 1,
};

const nextStudent = {
  id: 2002,
  name: '移动下一条学生',
  school_name: '移动测试中学',
  region: '测试区',
  stage: '初次联系',
  status: '未联系',
  status_detail: '',
  intent_level: '无',
  guardian_name: '家长B',
  guardian_phone: '13800002002',
  guardian2_name: '',
  guardian2_phone: '',
  score: 490,
  days_since_assigned: 2,
};

function todayPayload(list) {
  return {
    code: 0,
    data: {
      list,
      total: list.length,
      stats: {
        total: list.length,
        done: 0,
        pending: list.length,
        follow_up: 0,
        progress_pct: 0,
      },
      schools: [{ name: '移动测试中学', count: list.length }],
      truncated: false,
    },
  };
}

test.describe('mobile dial result flow', () => {
  test('fixed invalid reason saves and mobile task list refreshes to next student', async ({ page }) => {
    const updateRequests = [];
    let durationRequestUrl = '';
    let refreshedAfterInvalid = false;

    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(({ user }) => {
      localStorage.setItem('crm_user', JSON.stringify(user));
      sessionStorage.setItem(
        'pendingDial',
        JSON.stringify({
          studentId: 2001,
          studentName: '移动空号学生',
          dialLogId: 9001,
          dialStartedAt: Date.now() - 25_000,
        }),
      );
    }, { user: agentUser });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ json: { code: 0, data: agentUser } });
    });
    await page.route('**/api/tasks/yesterday', async (route) => {
      await route.fulfill({ json: { code: 0, data: { stale_unconcat: [] } } });
    });
    await page.route('**/api/tasks/today**', async (route) => {
      await route.fulfill({
        json: refreshedAfterInvalid
          ? todayPayload([nextStudent])
          : todayPayload([firstStudent, nextStudent]),
      });
    });
    await page.route('**/api/students/dial-duration**', async (route) => {
      durationRequestUrl = route.request().url();
      await route.fulfill({ json: { code: 0, data: {} } });
    });
    await page.route('**/api/students/2001', async (route) => {
      if (route.request().method() === 'PUT') {
        updateRequests.push(route.request().postDataJSON());
        refreshedAfterInvalid = true;
        await route.fulfill({
          json: {
            code: 0,
            data: {
              ...firstStudent,
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

    await page.goto('/mobile');

    await expect(page.getByText('移动空号学生')).toHaveCount(2);
    await expect(page.getByText('通话已完成，请选择处理结果')).toBeVisible();

    await page.getByRole('button', { name: '空号', exact: true }).click();

    await expect(page.getByText('移动空号学生')).toHaveCount(0);
    await expect(page.getByText('移动下一条学生')).toBeVisible();
    await expect(page.getByText('通话已完成，请选择处理结果')).not.toBeVisible();
    expect(updateRequests).toEqual([{ status: '无效', invalid_reason: '空号' }]);
    expect(new URL(durationRequestUrl).searchParams.get('dial_log_id')).toBe('9001');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('pendingDial'))).toBeNull();
  });

  test('direct detail status update completes the exact pending dial session', async ({ page }) => {
    let durationRequestUrl = '';
    const updateRequests = [];

    await page.setViewportSize({ width: 390, height: 844 });
    await page.addInitScript(({ user }) => {
      localStorage.setItem('crm_user', JSON.stringify(user));
    }, { user: agentUser });

    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({ json: { code: 0, data: agentUser } });
    });
    await page.route('**/api/students/2001/detail', async (route) => {
      await route.fulfill({
        json: {
          code: 0,
          data: {
            student: firstStudent,
            calls: [],
            notes: [],
            follow_ups: [],
            visits: [],
            intent_timeline: [],
          },
        },
      });
    });
    await page.route('**/api/students/dial-duration**', async (route) => {
      durationRequestUrl = route.request().url();
      await route.fulfill({ json: { code: 0, data: {} } });
    });
    await page.route('**/api/students/2001', async (route) => {
      if (route.request().method() === 'PUT') {
        updateRequests.push(route.request().postDataJSON());
        await route.fulfill({
          json: {
            code: 0,
            data: { ...firstStudent, status: '无效', invalid_reason: '空号' },
          },
        });
        return;
      }
      await route.fallback();
    });

    await page.goto('/mobile/student/2001');
    await expect(page.getByText('完整时间线')).toBeVisible();
    await page.evaluate(() => {
      sessionStorage.setItem('pendingDial', JSON.stringify({
        studentId: 2001,
        studentName: '移动空号学生',
        dialLogId: 9001,
        dialStartedAt: Date.now() - 20_000,
      }));
    });

    await page.getByRole('group', { name: '处理结果' })
      .getByRole('button', { name: '空号', exact: true })
      .click();

    await expect.poll(() => durationRequestUrl).not.toBe('');
    expect(updateRequests).toEqual([{ status: '无效', invalid_reason: '空号' }]);
    expect(new URL(durationRequestUrl).searchParams.get('dial_log_id')).toBe('9001');
    await expect.poll(() => page.evaluate(() => sessionStorage.getItem('pendingDial'))).toBeNull();
  });
});
