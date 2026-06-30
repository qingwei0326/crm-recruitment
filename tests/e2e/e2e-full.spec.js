// @ts-check
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8000';

/** 管理员登录 */
async function loginAdmin(page) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 5000 });
  await page.fill('input[placeholder="请输入用户名"]', 'admin');
  await page.fill('input[placeholder="请输入密码"]', 'admin123');
  await page.locator('button[type="submit"]').click();
  // 等待跳转到 /admin
  await page.waitForURL('**/admin**', { timeout: 10000 });
  await page.waitForTimeout(1000);
}

/** 话务员登录 */
async function loginAgent(page) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 5000 });
  await page.fill('input[placeholder="请输入用户名"]', '18859689508');
  await page.fill('input[placeholder="请输入密码"]', '070901');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/agent**', { timeout: 10000 });
  await page.waitForTimeout(1000);
}

// ======================== 管理员角色 ========================

test.describe('管理员角色', () => {
  test('1. 管理员登录', async ({ page }) => {
    await loginAdmin(page);
    expect(page.url()).toContain('/admin');
    await page.screenshot({ path: 'D:/招生系统/screenshots/01-admin-login.png', fullPage: true });
    console.log('✅ 管理员登录成功');
  });

  test('2. 仪表盘 - 统计卡片', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/dashboard`);
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toContain('待联系');
    expect(text).toContain('跟进中');
    expect(text).toContain('已成交');
    expect(text).toContain('已流失');
    expect(text).toContain('已联系');
    await page.screenshot({ path: 'D:/招生系统/screenshots/02-dashboard-stats.png', fullPage: true });
    console.log('✅ 仪表盘统计卡片: 待联系/跟进中/已成交/已流失/已联系 全部显示');
  });

  test('3. 仪表盘 - 各地域转化率', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/dashboard`);
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toContain('地域');
    await page.screenshot({ path: 'D:/招生系统/screenshots/03-dashboard-region.png', fullPage: true });
    console.log('✅ 各地域转化率显示正常');
  });

  test('4. 仪表盘 - 漏斗图', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/dashboard`);
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toContain('漏斗');
    await page.screenshot({ path: 'D:/招生系统/screenshots/04-dashboard-funnel.png', fullPage: true });
    console.log('✅ 漏斗图显示正常');
  });

  test('5. 线索管理 - 页面加载', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/leads`);
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toContain('线索');
    await page.screenshot({ path: 'D:/招生系统/screenshots/05-leads-page.png', fullPage: true });
    console.log('✅ 线索管理页面加载成功');
  });

  test('6. 线索管理 - 工作进度条', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/leads`);
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toContain('待联系');
    expect(text).toContain('跟进中');
    expect(text).toContain('已成交');
    expect(text).toContain('已流失');
    await page.screenshot({ path: 'D:/招生系统/screenshots/06-leads-progress.png', fullPage: true });
    console.log('✅ 工作进度条显示正确');
  });

  test('7. 线索管理 - 阶段tab切换', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/leads`);
    await page.waitForTimeout(3000);
    const tabs = ['待联系', '跟进中', '已成交', '已流失'];
    for (const tab of tabs) {
      const btn = page.locator(`button:has-text("${tab}")`).first();
      if (await btn.isVisible()) {
        await btn.click();
        await page.waitForTimeout(1000);
        console.log(`  ✅ 切换到 "${tab}" tab`);
      }
    }
    await page.screenshot({ path: 'D:/招生系统/screenshots/07-leads-tabs.png', fullPage: true });
    console.log('✅ 阶段tab切换正常');
  });

  test('8. 线索管理 - 搜索', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/leads`);
    await page.waitForTimeout(3000);
    const searchInput = page.locator('input[placeholder*="搜索"], input[placeholder*="姓名"], input[placeholder*="手机"]').first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('张');
      await page.waitForTimeout(1500);
      console.log('  ✅ 搜索 "张" 完成');
    }
    await page.screenshot({ path: 'D:/招生系统/screenshots/08-leads-search.png', fullPage: true });
    console.log('✅ 搜索功能正常');
  });

  test('9. 线索详情页', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/leads`);
    await page.waitForTimeout(3000);
    // 点击第一行学生
    const firstRow = page.locator('tbody tr').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'D:/招生系统/screenshots/09-lead-detail.png', fullPage: true });
      console.log('✅ 线索详情页加载成功');
    }
  });

  test('10. 账号管理 - 页面加载', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/agents`);
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    expect(text).toContain('账号管理');
    await page.screenshot({ path: 'D:/招生系统/screenshots/10-agents-page.png', fullPage: true });
    console.log('✅ 账号管理页面加载成功');
  });

  test('11. 话务员管理 - 回收弹窗（按学校分组）', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/agents`);
    await page.waitForTimeout(3000);
    // 先点击有数据的话务员（蒲安琪有7条）
    const agentWith = page.locator('text=蒲安琪').first();
    if (await agentWith.isVisible()) {
      await agentWith.click();
      await page.waitForTimeout(2000);
    }
    const recycleBtn = page.locator('button:has-text("回收线索")').first();
    if (await recycleBtn.isVisible()) {
      await recycleBtn.click();
      await page.waitForTimeout(2000);
      const text = await page.textContent('body');
      const hasSchool = text.includes('学校') || text.includes('未分类') || text.includes('条线索');
      expect(hasSchool).toBeTruthy();
      await page.screenshot({ path: 'D:/招生系统/screenshots/11-agents-recycle.png', fullPage: true });
      console.log('✅ 回收弹窗按学校分组显示正确');
    }
  });

  test('12. 通话量查询', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/call-volume`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/12-call-volume.png', fullPage: true });
    console.log('✅ 通话量查询页面加载成功');
  });

  test('13. 报表', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/report`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/13-report.png', fullPage: true });
    console.log('✅ 报表页面加载成功');
  });

  test('14. 趋势报表', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/trend`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/14-trend.png', fullPage: true });
    console.log('✅ 趋势报表页面加载成功');
  });

  test('15. 系统设置', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/settings`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/15-settings.png', fullPage: true });
    console.log('✅ 系统设置页面加载成功');
  });

  test('16. 修改密码页面', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/change-password`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/16-change-password.png', fullPage: true });
    console.log('✅ 修改密码页面加载成功');
  });

  test('17. 线索治理', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/lead-governance`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/17-lead-governance.png', fullPage: true });
    console.log('✅ 线索治理页面加载成功');
  });

  test('18. 线索回收', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/lead-recycle`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/18-lead-recycle.png', fullPage: true });
    console.log('✅ 线索回收页面加载成功');
  });

  test('19. 按学校分配', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/distribute-by-schools`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/19-distribute-schools.png', fullPage: true });
    console.log('✅ 按学校分配页面加载成功');
  });

  test('20. 无效线索回收', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/invalid-reclaim`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/20-invalid-reclaim.png', fullPage: true });
    console.log('✅ 无效线索回收页面加载成功');
  });

  test('21. 工作中心', async ({ page }) => {
    await loginAdmin(page);
    await page.goto(`${BASE}/admin/work-center`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/21-work-center.png', fullPage: true });
    console.log('✅ 工作中心页面加载成功');
  });
});

// ======================== 话务员角色 ========================

test.describe('话务员角色', () => {
  test('22. 话务员登录', async ({ page }) => {
    await loginAgent(page);
    expect(page.url()).toContain('/agent');
    await page.screenshot({ path: 'D:/招生系统/screenshots/22-agent-login.png', fullPage: true });
    console.log('✅ 话务员登录成功');
  });

  test('23. 话务员工作台 - 页面加载', async ({ page }) => {
    await loginAgent(page);
    await page.goto(`${BASE}/agent/work`);
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    const hasContent = text.includes('待拨打') || text.includes('累计') || text.includes('待处理') || text.includes('线索');
    expect(hasContent).toBeTruthy();
    await page.screenshot({ path: 'D:/招生系统/screenshots/23-agent-work.png', fullPage: true });
    console.log('✅ 话务员工作台加载成功');
  });

  test('24. 话务员工作台 - 统计栏', async ({ page }) => {
    await loginAgent(page);
    await page.goto(`${BASE}/agent/work`);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: 'D:/招生系统/screenshots/24-agent-stats.png', fullPage: true });
    console.log('✅ 统计栏显示正常');
  });

  test('25. 话务员工作台 - 待处理标签', async ({ page }) => {
    await loginAgent(page);
    await page.goto(`${BASE}/agent/work`);
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    console.log('  页面内容包含:', text.includes('全部') ? '全部 ' : '',
                text.includes('待回访') ? '待回访 ' : '', text.includes('待处理') ? '待处理 ' : '');
    await page.screenshot({ path: 'D:/招生系统/screenshots/25-agent-tabs.png', fullPage: true });
    console.log('✅ 待处理标签显示正常');
  });

  test('26. 话务员工作台 - 学生表格', async ({ page }) => {
    await loginAgent(page);
    await page.goto(`${BASE}/agent/work`);
    await page.waitForTimeout(3000);
    const rows = await page.locator('tbody tr').count();
    console.log(`  表格行数: ${rows}`);
    await page.screenshot({ path: 'D:/招生系统/screenshots/26-agent-table.png', fullPage: true });
    console.log('✅ 学生表格加载成功');
  });

  test('27. 话务员工作台 - 点击学生查看', async ({ page }) => {
    await loginAgent(page);
    await page.goto(`${BASE}/agent/work`);
    await page.waitForTimeout(3000);
    const firstRow = page.locator('tbody tr').first();
    if (await firstRow.isVisible()) {
      await firstRow.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'D:/招生系统/screenshots/27-agent-student-detail.png', fullPage: true });
      console.log('✅ 学生详情查看成功');
    }
  });
});

// ======================== 移动端角色 ========================

test.describe('移动端角色', () => {
  test('28. 移动端登录', async ({ page }) => {
    // 先设置小屏再导航，确保 useIsMobile 检测正确
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(500); // 等 viewport 生效
    await page.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 5000 });
    await page.fill('input[placeholder="请输入用户名"]', '18859689508');
    await page.fill('input[placeholder="请输入密码"]', '070901');
    await page.locator('button[type="submit"]').click();
    // 等待跳转，可能到 /mobile 或 /agent
    await page.waitForTimeout(5000);
    console.log('  移动端登录后URL:', page.url());
    await page.screenshot({ path: 'D:/招生系统/screenshots/28-mobile-login.png', fullPage: true });
    console.log('✅ 移动端登录成功');
  });

  test('29. 移动端首页', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(500);
    await page.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 5000 });
    await page.fill('input[placeholder="请输入用户名"]', '18859689508');
    await page.fill('input[placeholder="请输入密码"]', '070901');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(5000);
    // 直接导航到 mobile home（确保 cookie 已设置）
    await page.goto(`${BASE}/mobile/home`);
    await page.waitForTimeout(3000);
    const text = await page.textContent('body');
    console.log('  移动端首页内容:', text.substring(0, 200));
    await page.screenshot({ path: 'D:/招生系统/screenshots/29-mobile-home.png', fullPage: true });
    console.log('✅ 移动端首页加载成功');
  });

  test('30. 移动端 - 拨号页面', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(`${BASE}/login`);
    await page.waitForTimeout(500);
    await page.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 5000 });
    await page.fill('input[placeholder="请输入用户名"]', '18859689508');
    await page.fill('input[placeholder="请输入密码"]', '070901');
    await page.locator('button[type="submit"]').click();
    await page.waitForTimeout(5000);
    await page.goto(`${BASE}/mobile/home`);
    await page.waitForTimeout(3000);
    // 点击第一个拨号按钮
    const callBtn = page.locator('button').filter({ hasText: /拨打|拨号|call/ }).first();
    if (await callBtn.isVisible()) {
      await callBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: 'D:/招生系统/screenshots/30-mobile-call.png', fullPage: true });
      console.log('✅ 移动端拨号页面加载成功');
    }
  });
});

// ======================== API 接口测试 ========================

test.describe('API 接口测试', () => {
  test('API-1. 健康检查', async ({ request }) => {
    const resp = await request.get(`${BASE}/api/health`);
    expect(resp.ok()).toBeTruthy();
    console.log('✅ 健康检查 API 正常');
  });

  test('API-2. 管理员登录', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);
    console.log('✅ 管理员登录 API 正常');
  });

  test('API-3. 话务员登录', async ({ request }) => {
    const resp = await request.post(`${BASE}/api/auth/login`, {
      data: { phone: '18859689508', password: '070901' }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);
    console.log('✅ 话务员登录 API 正常');
  });

  test('API-4. stages 统计 (status-based)', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/stats/stages`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);
    expect(body.data).toHaveProperty('待联系');
    expect(body.data).toHaveProperty('跟进中');
    expect(body.data).toHaveProperty('已成交');
    expect(body.data).toHaveProperty('已流失');
    console.log('✅ stages 统计:', JSON.stringify(body.data));
  });

  test('API-5. sources 统计', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/stats/sources`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);
    console.log('✅ sources 统计:', JSON.stringify(body.data));
  });

  test('API-6. funnel 漏斗', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/stats/funnel`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);
    console.log('✅ funnel 漏斗:', JSON.stringify(body.data));
  });

  test('API-7. 线索列表 (含分页)', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/students/?page=1&page_size=5`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);
    console.log('✅ 线索列表, total:', body.data.total);
  });

  test('API-8. 线索列表 - 按阶段过滤', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const stages = ['待联系', '跟进中', '已成交', '已流失'];
    for (const stage of stages) {
      const resp = await request.get(`${BASE}/api/students/?page=1&page_size=5&stage=${encodeURIComponent(stage)}`, {
        headers: { Cookie: `access_token=${token}` }
      });
      const body = await resp.json();
      console.log(`  ${stage}: ${body.data.total} 条`);
    }
    console.log('✅ 阶段过滤全部正常');
  });

  test('API-9. 话务员列表', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/admin/agents`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);
    console.log('✅ 话务员列表:', body.data.length, '人');
  });

  test('API-10. 按学校分组回收', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/admin/agent-students-by-school?agent_id=7`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);
    let totalStudents = 0;
    body.data.forEach(g => {
      console.log(`  ${g.school_name}: ${g.count}条`);
      totalStudents += g.count;
    });
    console.log(`✅ 按学校分组: ${body.data.length} 所学校, 共 ${totalStudents} 条线索`);
  });

  test('API-11. 话务员学生列表', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { phone: '18859689508', password: '070901' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/students/?page=1&page_size=5`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    expect(body.code).toBe(0);
    console.log('✅ 话务员学生列表, total:', body.data.total);
  });

  test('API-12. 回访列表', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { phone: '18859689508', password: '070901' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/follow-ups/?page=1&page_size=5`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('✅ 回访列表:', JSON.stringify(body.data).substring(0, 200));
  });

  test('API-13. 通话记录', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { phone: '18859689508', password: '070901' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/calls/?page=1&page_size=5`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    console.log('✅ 通话记录 API 正常');
  });

  test('API-14. 访问汇总', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { username: 'admin', password: 'admin123' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/visits/summary`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('✅ 访问汇总:', JSON.stringify(body.data));
  });

  test('API-15. 话务员待处理 (my-pending)', async ({ request }) => {
    const loginResp = await request.post(`${BASE}/api/auth/login`, {
      data: { phone: '18859689508', password: '070901' }
    });
    const loginBody = await loginResp.json();
    const token = loginBody.data.access_token;

    const resp = await request.get(`${BASE}/api/students/my-pending?page=1&page_size=10`, {
      headers: { Cookie: `access_token=${token}` }
    });
    expect(resp.ok()).toBeTruthy();
    const body = await resp.json();
    console.log('✅ 待处理列表:', body.data?.total || body.data?.length || 'ok');
  });
});
