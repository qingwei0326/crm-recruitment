const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on('console', msg => {
    if (msg.type() === 'error') console.log('CONSOLE ERROR:', msg.text());
  });
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));

  // 登录
  await page.goto('http://localhost:8000/login');
  await page.waitForSelector('input[placeholder="请输入用户名"]', { timeout: 5000 });
  await page.fill('input[placeholder="请输入用户名"]', '18859689508');
  await page.fill('input[placeholder="请输入密码"]', '070901');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/agent**', { timeout: 10000 });
  console.log('登录后URL:', page.url());

  await page.goto('http://localhost:8000/agent/work');
  await page.waitForTimeout(3000);
  const text = await page.textContent('body');
  console.log('页面前300字:', text.substring(0, 300));
  await page.screenshot({ path: 'D:/招生系统/screenshots/agent-work-check.png', fullPage: true });
  console.log('截图已保存');

  await browser.close();
})();
