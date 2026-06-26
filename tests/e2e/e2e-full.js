const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'http://localhost:8000';
const SS_DIR = 'D:/招生系统/screenshots';

if (!fs.existsSync(SS_DIR)) fs.mkdirSync(SS_DIR, { recursive: true });

let pass = 0, fail = 0, total = 0;
const results = [];

function log(emoji, msg) {
  console.log(`${emoji} ${msg}`);
}

async function screenshot(page, name) {
  const fp = path.join(SS_DIR, `${name}.png`);
  await page.screenshot({ path: fp, fullPage: true });
  return fp;
}

async function runTest(name, fn) {
  total++;
  try {
    await fn();
    pass++;
    log('✅', `[${total}] ${name}`);
    results.push({ name, status: 'PASS' });
  } catch (e) {
    fail++;
    log('❌', `[${total}] ${name}: ${e.message.substring(0, 120)}`);
    results.push({ name, status: 'FAIL', error: e.message.substring(0, 200) });
  }
}

async function loginAdmin(page) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 8000 });
  await page.fill('input[placeholder="请输入用户名"]', 'admin');
  await page.fill('input[placeholder="请输入密码"]', 'admin123');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/admin**', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

async function loginAgent(page) {
  await page.goto(`${BASE}/login`);
  await page.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 8000 });
  await page.fill('input[placeholder="请输入用户名"]', '18859689508');
  await page.fill('input[placeholder="请输入密码"]', '070901');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/agent**', { timeout: 15000 });
  await page.waitForTimeout(1500);
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ========== 管理员 ==========
  console.log('\n===== 管理员角色 =====');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await runTest('管理员登录', async () => {
      await loginAdmin(page);
      if (!page.url().includes('/admin')) throw new Error('未跳转到 /admin');
    });

    await runTest('仪表盘-统计卡片', async () => {
      await page.goto(`${BASE}/admin/dashboard`);
      await page.waitForTimeout(3000);
      const text = await page.textContent('body');
      if (!text.includes('待联系')) throw new Error('缺少待联系');
      if (!text.includes('跟进中')) throw new Error('缺少跟进中');
      if (!text.includes('已成交')) throw new Error('缺少已成交');
      if (!text.includes('已流失')) throw new Error('缺少已流失');
      if (!text.includes('已联系')) throw new Error('缺少已联系');
      await screenshot(page, '01-dashboard-stats');
    });

    await runTest('仪表盘-地域转化率', async () => {
      await page.goto(`${BASE}/admin/dashboard`);
      await page.waitForTimeout(2000);
      const text = await page.textContent('body');
      if (!text.includes('地域')) throw new Error('缺少地域');
      await screenshot(page, '02-dashboard-region');
    });

    await runTest('仪表盘-漏斗图', async () => {
      await page.goto(`${BASE}/admin/dashboard`);
      await page.waitForTimeout(2000);
      const text = await page.textContent('body');
      if (!text.includes('漏斗')) throw new Error('缺少漏斗');
      await screenshot(page, '03-dashboard-funnel');
    });

    await runTest('线索管理-页面加载', async () => {
      await page.goto(`${BASE}/admin/leads`);
      await page.waitForTimeout(3000);
      const text = await page.textContent('body');
      if (!text.includes('线索')) throw new Error('缺少线索');
      await screenshot(page, '04-leads-page');
    });

    await runTest('线索管理-工作进度条', async () => {
      await page.goto(`${BASE}/admin/leads`);
      await page.waitForTimeout(2000);
      const text = await page.textContent('body');
      const keys = ['待联系', '跟进中', '已成交', '已流失'];
      for (const k of keys) {
        if (!text.includes(k)) throw new Error(`缺少${k}`);
      }
      await screenshot(page, '05-leads-progress');
    });

    await runTest('线索管理-阶段tab切换', async () => {
      await page.goto(`${BASE}/admin/leads`);
      await page.waitForTimeout(2000);
      for (const tab of ['待联系', '跟进中', '已成交', '已流失']) {
        const btn = page.locator(`button:has-text("${tab}")`).first();
        if (await btn.isVisible()) {
          await btn.click();
          await page.waitForTimeout(800);
        }
      }
      await screenshot(page, '06-leads-tabs');
    });

    await runTest('线索管理-搜索', async () => {
      await page.goto(`${BASE}/admin/leads`);
      await page.waitForTimeout(2000);
      const searchInput = page.locator('input[placeholder*="搜索"], input[placeholder*="姓名"], input[placeholder*="手机"]').first();
      if (await searchInput.isVisible()) {
        await searchInput.fill('张');
        await page.waitForTimeout(1500);
      }
      await screenshot(page, '07-leads-search');
    });

    await runTest('线索详情页', async () => {
      await page.goto(`${BASE}/admin/leads`);
      await page.waitForTimeout(2000);
      const row = page.locator('tbody tr').first();
      if (await row.isVisible()) {
        await row.click();
        await page.waitForTimeout(2000);
        await screenshot(page, '08-lead-detail');
      }
    });

    await runTest('话务员管理-页面加载', async () => {
      await page.goto(`${BASE}/admin/agents`);
      await page.waitForTimeout(3000);
      const text = await page.textContent('body');
      if (!text.includes('话务员')) throw new Error('缺少话务员');
      await screenshot(page, '09-agents-page');
    });

    await runTest('话务员管理-回收弹窗', async () => {
      await page.goto(`${BASE}/admin/agents`);
      await page.waitForTimeout(3000);
      // 点击有数据的话务员
      const agentWith = page.locator('text=蒲安琪').first();
      if (await agentWith.isVisible()) {
        await agentWith.click();
        await page.waitForTimeout(2000);
      }
      const recycleBtn = page.locator('button:has-text("回收")').first();
      if (await recycleBtn.isVisible()) {
        await recycleBtn.click();
        await page.waitForTimeout(2000);
        const text = await page.textContent('body');
        if (!text.includes('学校') && !text.includes('未分类') && !text.includes('条线索')) {
          // 检查是否显示了"暂无可回收"
          if (!text.includes('暂无')) throw new Error('回收弹窗内容异常');
        }
        await screenshot(page, '10-agents-recycle');
      }
    });

    await runTest('通话量查询', async () => {
      await page.goto(`${BASE}/admin/call-volume`);
      await page.waitForTimeout(2000);
      await screenshot(page, '11-call-volume');
    });

    await runTest('报表', async () => {
      await page.goto(`${BASE}/admin/report`);
      await page.waitForTimeout(2000);
      await screenshot(page, '12-report');
    });

    await runTest('趋势报表', async () => {
      await page.goto(`${BASE}/admin/trend`);
      await page.waitForTimeout(2000);
      await screenshot(page, '13-trend');
    });

    await runTest('系统设置', async () => {
      await page.goto(`${BASE}/admin/settings`);
      await page.waitForTimeout(2000);
      await screenshot(page, '14-settings');
    });

    await runTest('修改密码页面', async () => {
      await page.goto(`${BASE}/change-password`);
      await page.waitForTimeout(2000);
      await screenshot(page, '15-change-password');
    });

    await runTest('线索治理', async () => {
      await page.goto(`${BASE}/admin/lead-governance`);
      await page.waitForTimeout(2000);
      await screenshot(page, '16-lead-governance');
    });

    await runTest('线索回收', async () => {
      await page.goto(`${BASE}/admin/lead-recycle`);
      await page.waitForTimeout(2000);
      await screenshot(page, '17-lead-recycle');
    });

    await runTest('按学校分配', async () => {
      await page.goto(`${BASE}/admin/distribute-by-schools`);
      await page.waitForTimeout(2000);
      await screenshot(page, '18-distribute-schools');
    });

    await runTest('无效线索回收', async () => {
      await page.goto(`${BASE}/admin/invalid-reclaim`);
      await page.waitForTimeout(2000);
      await screenshot(page, '19-invalid-reclaim');
    });

    await runTest('工作中心', async () => {
      await page.goto(`${BASE}/admin/work-center`);
      await page.waitForTimeout(2000);
      await screenshot(page, '20-work-center');
    });

    await ctx.close();
  }

  // ========== 话务员 ==========
  console.log('\n===== 话务员角色 =====');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await runTest('话务员登录', async () => {
      await loginAgent(page);
      if (!page.url().includes('/agent')) throw new Error('未跳转到 /agent');
    });

    await runTest('话务员工作台-页面加载', async () => {
      await page.goto(`${BASE}/agent/work`);
      await page.waitForTimeout(3000);
      const text = await page.textContent('body');
      if (!text.includes('待拨打') && !text.includes('累计') && !text.includes('待处理') && !text.includes('线索')) {
        throw new Error('工作台内容异常');
      }
      await screenshot(page, '21-agent-work');
    });

    await runTest('话务员工作台-统计栏', async () => {
      await page.goto(`${BASE}/agent/work`);
      await page.waitForTimeout(2000);
      await screenshot(page, '22-agent-stats');
    });

    await runTest('话务员工作台-待处理标签', async () => {
      await page.goto(`${BASE}/agent/work`);
      await page.waitForTimeout(2000);
      const text = await page.textContent('body');
      console.log('    标签:', text.includes('全部') ? '全部 ' : '', text.includes('待回访') ? '待回访 ' : '', text.includes('待处理') ? '待处理 ' : '');
      await screenshot(page, '23-agent-tabs');
    });

    await runTest('话务员工作台-学生表格', async () => {
      await page.goto(`${BASE}/agent/work`);
      await page.waitForTimeout(2000);
      const rows = await page.locator('tbody tr').count();
      console.log('    表格行数:', rows);
      await screenshot(page, '24-agent-table');
    });

    await runTest('话务员-点击学生查看', async () => {
      await page.goto(`${BASE}/agent/work`);
      await page.waitForTimeout(2000);
      const row = page.locator('tbody tr').first();
      if (await row.isVisible()) {
        await row.click();
        await page.waitForTimeout(2000);
        await screenshot(page, '25-agent-student-detail');
      }
    });

    await ctx.close();
  }

  // ========== 移动端 ==========
  console.log('\n===== 移动端角色 =====');
  {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 812 } });
    const page = await ctx.newPage();

    await runTest('移动端登录', async () => {
      await page.goto(`${BASE}/login`);
      await page.waitForTimeout(500);
      await page.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 8000 });
      await page.fill('input[placeholder="请输入用户名"]', '18859689508');
      await page.fill('input[placeholder="请输入密码"]', '070901');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(5000);
      console.log('    移动端登录后URL:', page.url());
      await screenshot(page, '26-mobile-login');
    });

    await runTest('移动端首页', async () => {
      await page.goto(`${BASE}/mobile/home`);
      await page.waitForTimeout(3000);
      const text = await page.textContent('body');
      console.log('    首页内容:', text.substring(0, 150));
      await screenshot(page, '27-mobile-home');
    });

    await runTest('移动端-拨号', async () => {
      await page.goto(`${BASE}/mobile/home`);
      await page.waitForTimeout(2000);
      const callBtn = page.locator('button').filter({ hasText: /拨打|拨号|call/ }).first();
      if (await callBtn.isVisible()) {
        await callBtn.click();
        await page.waitForTimeout(2000);
        await screenshot(page, '28-mobile-call');
      } else {
        console.log('    未找到拨号按钮');
      }
    });

    await ctx.close();
  }

  // ========== API ==========
  console.log('\n===== API 接口测试 =====');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await runTest('API-健康检查', async () => {
      const resp = await page.request.get(`${BASE}/api/health`);
      if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`);
    });

    let adminToken, agentToken;

    await runTest('API-管理员登录', async () => {
      const resp = await page.request.post(`${BASE}/api/auth/login`, {
        data: { username: 'admin', password: 'admin123' }
      });
      if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`);
      const body = await resp.json();
      if (body.code !== 0) throw new Error(body.msg);
      adminToken = body.data.access_token;
    });

    await runTest('API-话务员登录', async () => {
      const resp = await page.request.post(`${BASE}/api/auth/login`, {
        data: { username: '18859689508', password: '070901' }
      });
      if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`);
      const body = await resp.json();
      if (body.code !== 0) throw new Error(body.msg);
      agentToken = body.data.access_token;
    });

    await runTest('API-stages统计', async () => {
      const resp = await page.request.get(`${BASE}/api/stats/stages`, {
        headers: { Cookie: `access_token=${adminToken}` }
      });
      const body = await resp.json();
      if (body.code !== 0) throw new Error(body.msg);
      const d = body.data;
      console.log('    stages:', JSON.stringify(d));
      if (!d['待联系'] && !d['跟进中'] && !d['已成交'] && !d['已流失']) throw new Error('数据异常');
    });

    await runTest('API-sources统计', async () => {
      const resp = await page.request.get(`${BASE}/api/stats/sources`, {
        headers: { Cookie: `access_token=${adminToken}` }
      });
      const body = await resp.json();
      if (body.code !== 0) throw new Error(body.msg);
      console.log('    sources:', JSON.stringify(body.data));
    });

    await runTest('API-funnel漏斗', async () => {
      const resp = await page.request.get(`${BASE}/api/stats/funnel`, {
        headers: { Cookie: `access_token=${adminToken}` }
      });
      const body = await resp.json();
      if (body.code !== 0) throw new Error(body.msg);
      console.log('    funnel:', JSON.stringify(body.data));
    });

    await runTest('API-线索列表', async () => {
      const resp = await page.request.get(`${BASE}/api/students?page=1&page_size=5`, {
        headers: { Cookie: `access_token=${adminToken}` }
      });
      const body = await resp.json();
      if (body.code !== 0) throw new Error(body.msg);
      console.log('    total:', body.data.total);
    });

    await runTest('API-阶段过滤', async () => {
      for (const stage of ['待联系', '跟进中', '已成交', '已流失']) {
        const resp = await page.request.get(`${BASE}/api/students?page=1&page_size=3&stage=${encodeURIComponent(stage)}`, {
          headers: { Cookie: `access_token=${adminToken}` }
        });
        const body = await resp.json();
        console.log(`    ${stage}: ${body.data.total}条`);
      }
    });

    await runTest('API-话务员列表', async () => {
      const resp = await page.request.get(`${BASE}/api/admin/agents`, {
        headers: { Cookie: `access_token=${adminToken}` }
      });
      const body = await resp.json();
      console.log('    话务员:', body.data.length, '人');
    });

    await runTest('API-按学校分组回收', async () => {
      const resp = await page.request.get(`${BASE}/api/admin/agent-students-by-school?agent_id=7`, {
        headers: { Cookie: `access_token=${adminToken}` }
      });
      const body = await resp.json();
      if (body.code !== 0) throw new Error(body.msg);
      let total = 0;
      body.data.forEach(g => {
        console.log(`    ${g.school_name}: ${g.count}条`);
        total += g.count;
      });
      console.log(`    共 ${body.data.length} 所学校, ${total} 条`);
    });

    await runTest('API-话务员学生列表', async () => {
      const resp = await page.request.get(`${BASE}/api/students?page=1&page_size=5`, {
        headers: { Cookie: `access_token=${agentToken}` }
      });
      const body = await resp.json();
      console.log('    total:', body.data.total);
    });

    await runTest('API-回访列表', async () => {
      const resp = await page.request.get(`${BASE}/api/follow-ups?page=1&page_size=5`, {
        headers: { Cookie: `access_token=${agentToken}` }
      });
      const body = await resp.json();
      if (body.code !== 0) throw new Error(body.msg || 'code != 0');
      console.log('    follow-ups total:', body.data.total);
    });

    await runTest('API-通话记录', async () => {
      const resp = await page.request.get(`${BASE}/api/calls?page=1&page_size=5`, {
        headers: { Cookie: `access_token=${agentToken}` }
      });
      if (!resp.ok()) throw new Error(`HTTP ${resp.status()}`);
      console.log('    calls OK');
    });

    await runTest('API-访问汇总', async () => {
      const resp = await page.request.get(`${BASE}/api/visits/summary`, {
        headers: { Cookie: `access_token=${adminToken}` }
      });
      const body = await resp.json();
      console.log('    visits:', JSON.stringify(body.data));
    });

    await runTest('API-待处理', async () => {
      const resp = await page.request.get(`${BASE}/api/students/my-pending?page=1&page_size=10`, {
        headers: { Cookie: `access_token=${agentToken}` }
      });
      const body = await resp.json();
      console.log('    my-pending:', body.data?.total || body.data?.length || 'ok');
    });

    await ctx.close();
  }

  await browser.close();

  // ========== 结果汇总 ==========
  console.log('\n========================================');
  console.log(`总计: ${total}  通过: ${pass}  失败: ${fail}`);
  console.log('========================================');
  if (fail > 0) {
    console.log('\n失败列表:');
    results.filter(r => r.status === 'FAIL').forEach(r => {
      console.log(`  ❌ ${r.name}: ${r.error}`);
    });
  }

  fs.writeFileSync(path.join(SS_DIR, 'test-results.json'), JSON.stringify(results, null, 2));
  process.exit(fail > 0 ? 1 : 0);
})();
