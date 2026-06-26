const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // 检查登录页
  await page.goto('http://localhost:8000/login');
  await page.waitForTimeout(2000);
  const html = await page.content();
  console.log('=== 登录页 HTML ===');
  // 找 form 元素
  const forms = await page.locator('form').all();
  console.log('Forms:', forms.length);
  const inputs = await page.locator('input').all();
  console.log('Inputs:', inputs.length);
  for (const input of inputs) {
    const placeholder = await input.getAttribute('placeholder');
    const type = await input.getAttribute('type');
    const name = await input.getAttribute('name');
    console.log(`  input: type=${type}, name=${name}, placeholder=${placeholder}`);
  }
  const buttons = await page.locator('button').all();
  console.log('Buttons:', buttons.length);
  for (const btn of buttons) {
    const text = await btn.textContent();
    console.log(`  button: "${text.trim()}"`);
  }
  // 也检查 select 元素
  const selects = await page.locator('select').all();
  console.log('Selects:', selects.length);

  // 尝试登录
  console.log('\n=== 尝试登录 ===');
  // 可能有用户名或手机号输入
  if (inputs.length >= 2) {
    await inputs[0].fill('admin');
    await inputs[1].fill('admin123');
  }
  // 点击按钮
  if (buttons.length > 0) {
    await buttons[0].click();
    await page.waitForTimeout(3000);
    console.log('登录后URL:', page.url());
    console.log('登录后页面标题:', await page.title());
  }

  // 检查话务员登录
  console.log('\n=== 话务员登录页 ===');
  await page.goto('http://localhost:8000/agent/work');
  await page.waitForTimeout(2000);
  console.log('URL:', page.url());

  // 检查移动端登录
  console.log('\n=== 移动端登录页 ===');
  await page.goto('http://localhost:8000/mobile/home');
  await page.waitForTimeout(2000);
  console.log('URL:', page.url());

  await browser.close();
})();
