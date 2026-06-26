const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 监听网络请求
  page.on('request', req => {
    if (req.url().includes('/api/')) {
      console.log('REQUEST:', req.method(), req.url());
    }
  });
  page.on('response', resp => {
    if (resp.url().includes('/api/')) {
      console.log('RESPONSE:', resp.status(), resp.url());
    }
  });
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('CONSOLE ERROR:', msg.text());
    }
  });
  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.message);
  });

  console.log('=== 登录页 ===');
  await page.goto('http://localhost:8000/login');
  await page.waitForTimeout(2000);

  // 填写表单
  const inputs = await page.locator('input').all();
  console.log('Found inputs:', inputs.length);

  // 用 placeholder 定位
  const usernameInput = page.locator('input[placeholder="请输入用户名"]');
  const passwordInput = page.locator('input[placeholder="请输入密码"]');

  if (await usernameInput.count() > 0) {
    console.log('Filling username...');
    await usernameInput.fill('admin');
  }
  if (await passwordInput.count() > 0) {
    console.log('Filling password...');
    await passwordInput.fill('admin123');
  }

  // 点击登录按钮
  const loginBtn = page.locator('button').filter({ hasText: '登' });
  console.log('Login button count:', await loginBtn.count());
  if (await loginBtn.count() > 0) {
    console.log('Clicking login button...');
    await loginBtn.first().click();
  }

  await page.waitForTimeout(5000);
  console.log('After login URL:', page.url());

  // 检查 localStorage 中是否有 token
  const token = await page.evaluate(() => localStorage.getItem('token'));
  console.log('Token in localStorage:', token ? 'YES' : 'NO');

  // 检查页面内容
  const bodyText = await page.textContent('body');
  console.log('Page contains error?', bodyText.includes('错误') || bodyText.includes('失败'));

  await browser.close();
})();
