const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => console.log('PAGE ERROR:', e.message));
  page.on('console', m => { if (m.type()==='error') console.log('CONSOLE:', m.text()); });
  await page.goto('http://localhost:8000/login');
  await page.fill('input[placeholder="请输入用户名"]', '18859689508');
  await page.fill('input[placeholder="请输入密码"]', '070901');
  await page.locator('button[type="submit"]').click();
  await page.waitForURL('**/agent**', { timeout: 10000 });
  await page.goto('http://localhost:8000/agent/work');
  await page.waitForTimeout(3000);
  const pendingBtn = page.locator('text=待处理').first();
  if (await pendingBtn.isVisible()) {
    await pendingBtn.click();
    await page.waitForTimeout(2000);
  }
  const text = await page.textContent('body');
  console.log('待处理:', text.substring(0, 500));
  await page.screenshot({ path: 'D:/招生系统/screenshots/agent-pending.png', fullPage: true });
  await browser.close();
})();
