/**
 * Full E2E flow verification — all roles, all pages.
 * Run: npx playwright test tests/e2e/full-flow.spec.js
 *
 * Strategy: login once per role via beforeAll, save storageState, reuse.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const ADMIN = { username: 'admin', password: 'admin123' };
const ADMIN_STATE = path.join(__dirname, '.auth-admin.json');
const AGENT_STATE = path.join(__dirname, '.auth-agent.json');

// ─── Helpers ───────────────────────────────────────────────

async function loginViaUI(page, { username, password }) {
  await page.goto('/login');
  await page.waitForLoadState('domcontentloaded');
  await page.getByPlaceholder('请输入用户名').fill(username);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: '登 录' }).click();
  await page.waitForURL(/\/(admin|agent|mobile|change-password)/, { timeout: 20000 });
}

async function resetAgentPassword(page) {
  // Login as admin first
  await loginViaUI(page, ADMIN);
  // Call API to reset agent password
  const resp = await page.evaluate(async () => {
    const lr = await fetch(window.location.origin + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin123' }),
    }).then(r => r.json());
    const rr = await fetch(window.location.origin + '/api/admin/users/4/reset-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lr.data.access_token}` },
      body: JSON.stringify({ new_password: 'agent123' }),
    }).then(r => r.json());
    return rr;
  });
  return { username: '15006033773', password: resp.data.new_password };
}

async function handlePasswordChange(page, password) {
  if (page.url().includes('change-password')) {
    await page.getByPlaceholder('管理员给你的初始密码').fill(password);
    await page.getByPlaceholder('至少 6 位').fill('agent123');
    await page.getByPlaceholder('再次输入新密码').fill('agent123');
    await page.getByRole('button', { name: '保存新密码' }).click();
    await page.waitForURL(/\/agent/, { waitUntil: 'commit' });
  }
}

// ─── Setup: Create auth states ─────────────────────────────

test.describe('Setup Auth', () => {
  test('Login as admin and save state', async ({ page }) => {
    await loginViaUI(page, ADMIN);
    await expect(page).toHaveURL(/\/admin/);
    await page.context().storageState({ path: ADMIN_STATE });
  });

  test('Login as agent and save state', async ({ page }) => {
    const agentCreds = await resetAgentPassword(page);
    // Clear admin session
    await page.context().clearCookies();
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    // Login as agent
    await loginViaUI(page, agentCreds);
    await handlePasswordChange(page, agentCreds.password);
    await expect(page).toHaveURL(/\/agent/);
    await page.context().storageState({ path: AGENT_STATE });
  });
});

// ─── Admin Role Tests ──────────────────────────────────────

test.describe('Admin Role', () => {
  test.use({ storageState: ADMIN_STATE });

  test('Dashboard loads with all stats', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: '仪表盘' })).toBeVisible();
    await expect(page.getByText('学生总数').first()).toBeVisible();
    await expect(page.getByText('已联系').first()).toBeVisible();
    await expect(page.getByText('A 级意向').first()).toBeVisible();
    await expect(page.getByText('今日呼出').first()).toBeVisible();
    await expect(page.getByText('线索流转漏斗')).toBeVisible();
    await expect(page.getByText('各地域转化率')).toBeVisible();
    await expect(page.getByText('工作进度')).toBeVisible();
  });

  test('Student Management page loads with table', async ({ page }) => {
    await page.goto('/admin/leads');
    await expect(page.getByRole('heading', { name: '学生管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '新建' })).toBeVisible();
    await expect(page.getByRole('button', { name: '导入' })).toBeVisible();
    await expect(page.getByPlaceholder('搜索姓名/电话/学校...')).toBeVisible();
    await expect(page.getByText(/共 \d+ 条/)).toBeVisible();
  });

  test('Create student modal opens and submits', async ({ page }) => {
    await page.goto('/admin/leads');
    await page.getByRole('button', { name: '新建' }).click();
    await expect(page.getByRole('heading', { name: '新建学生' })).toBeVisible();
    const nameInput = page.locator('input').nth(1);
    await nameInput.fill('E2E自动测试');
    await page.getByRole('button', { name: '创建' }).click();
    await expect(page.getByRole('heading', { name: '新建学生' })).not.toBeVisible();
    // Verify and cleanup via API
    const result = await page.evaluate(async () => {
      const r = await fetch(window.location.origin + '/api/students?search=E2E自动测试&page_size=1');
      return r.json();
    });
    expect(result.data.list[0].name).toBe('E2E自动测试');
    await page.evaluate(async (id) => {
      await fetch(window.location.origin + `/api/students/${id}`, { method: 'DELETE' });
    }, result.data.list[0].id);
  });

  test('Student detail page loads', async ({ page }) => {
    // Navigate directly to a known student detail page
    await page.goto('/admin/leads/54321');
    await expect(page.getByRole('button', { name: '基本信息' })).toBeVisible();
    await expect(page.getByRole('button', { name: '完整时间线' })).toBeVisible();
    await expect(page.getByRole('button', { name: '意向轨迹' })).toBeVisible();
    await expect(page.getByRole('button', { name: '通话记录' })).toBeVisible();
  });

  test('Agent Management page loads', async ({ page }) => {
    await page.goto('/admin/agents');
    await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '添加账号' })).toBeVisible();
    await expect(page.getByText(/账号列表/)).toBeVisible();
  });

  test('Governance page loads', async ({ page }) => {
    await page.goto('/admin/governance');
    await expect(page.getByRole('heading', { name: '线索治理' })).toBeVisible();
    await expect(page.getByText('统一处理线索分配')).toBeVisible();
  });

  test('Report page loads', async ({ page }) => {
    await page.goto('/admin/report');
    await expect(page.getByRole('heading', { name: '汇总报表' })).toBeVisible();
  });

  test('Settings page loads', async ({ page }) => {
    await page.goto('/admin/settings');
    await expect(page.getByRole('heading', { name: '系统设置' })).toBeVisible();
  });

  test('Sidebar navigation works', async ({ page }) => {
    await page.goto('/admin');
    const links = ['工作中心', '学生管理', '线索治理', '账号管理', '汇总报表', '趋势报表', '通电量查询', '系统设置'];
    for (const name of links) {
      await page.getByRole('link', { name }).click();
      await page.waitForLoadState('domcontentloaded');
    }
  });
});

// ─── Agent Role Tests ──────────────────────────────────────

test.describe('Agent Role', () => {
  test.use({ storageState: AGENT_STATE });

  test('Agent work center loads with student table', async ({ page }) => {
    await page.goto('/agent');
    await expect(page.getByRole('heading', { name: '待拨打' })).toBeVisible();
    await expect(page.getByRole('button', { name: '待拨打' })).toBeVisible();
    await expect(page.getByRole('button', { name: '跟进中' })).toBeVisible();
    await expect(page.getByRole('button', { name: '待处理' })).toBeVisible();
    await expect(page.getByRole('button', { name: '添加学生', exact: true })).toBeVisible();
    await expect(page.getByText(/\d+ \/ \d+/)).toBeVisible();
  });

  test('Clicking student row expands detail (no crash)', async ({ page }) => {
    await page.goto('/agent');
    const firstRow = page.locator('table tbody tr').first();
    await firstRow.click();
    await page.waitForTimeout(500);
    await expect(page.getByText('页面出了点问题')).not.toBeVisible();
    await expect(page.getByText('联系人1')).toBeVisible();
    await expect(page.getByText('AI分析')).toBeVisible();
  });

  test('跟进中 tab loads', async ({ page }) => {
    await page.goto('/agent');
    await page.getByRole('button', { name: '跟进中' }).click();
    await expect(page.getByRole('heading', { name: '跟进中' })).toBeVisible();
  });

  test('待处理 tab loads', async ({ page }) => {
    await page.goto('/agent');
    await page.getByRole('button', { name: '待处理' }).click();
    await expect(page.getByRole('heading', { name: '待处理' })).toBeVisible();
  });

  test('Phone buttons visible on rows', async ({ page }) => {
    await page.goto('/agent');
    // Phone buttons are in the action cell of each row
    // They show as masked numbers like "139****6559" or full numbers
    const actionButtons = page.locator('table tbody tr td:last-child button');
    await expect(actionButtons.first()).toBeVisible();
  });
});

// ─── Permission Tests ──────────────────────────────────────

test.describe('Permissions', () => {
  test('Unauthenticated → /admin redirects to /login', async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/login/);
    await context.close();
  });

  test('Agent → /admin redirects to /agent', async ({ page }) => {
    // First reset agent password (this logs in as admin)
    const agentCreds = await resetAgentPassword(page);
    // Now clear the admin session completely
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    // Reload login page to clear SPA state
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    // Login as agent
    await loginViaUI(page, agentCreds);
    await handlePasswordChange(page, agentCreds.password);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/agent/);
  });

  test('Agent API returns 403 for admin endpoints', async ({ page }) => {
    const agentCreds = await resetAgentPassword(page);
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');
    await loginViaUI(page, agentCreds);
    await handlePasswordChange(page, agentCreds.password);
    const result = await page.evaluate(async () => {
      const r = await fetch(window.location.origin + '/api/admin/config');
      return r.json();
    });
    expect(result.detail).toBe('权限不足');
  });
});

// ─── Change Password Flow ──────────────────────────────────

test.describe('Change Password', () => {
  test('Forced password change page renders', async ({ page }) => {
    const agentCreds = await resetAgentPassword(page);
    await page.context().clearCookies();
    await page.goto('/login');
    await page.evaluate(() => localStorage.clear());
    await loginViaUI(page, agentCreds);
    await expect(page).toHaveURL(/\/change-password/);
    await expect(page.getByRole('heading', { name: '设置新密码' })).toBeVisible();
    await expect(page.getByText('首次登录请先设置你自己的密码')).toBeVisible();
  });
});
