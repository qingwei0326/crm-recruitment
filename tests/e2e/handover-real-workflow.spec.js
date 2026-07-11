// @ts-check
const { test, expect } = require('@playwright/test');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const frontendRoot = path.join(projectRoot, 'frontend');
const seedScript = path.join(projectRoot, 'scripts', 'seed_handover_e2e.py');

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function pythonExecutable() {
  const candidates = process.platform === 'win32'
    ? [path.join(projectRoot, '.venv-win', 'Scripts', 'python.exe')]
    : [path.join(projectRoot, '.venv-linux', 'bin', 'python')];
  candidates.push(process.env.PYTHON || (process.platform === 'win32' ? 'python.exe' : 'python3'));
  return candidates.find((candidate) => !path.isAbsolute(candidate) || fs.existsSync(candidate));
}

function runChecked(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    env: options.env || process.env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout || 60_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${args.join(' ')}`,
      result.error?.message || '',
      result.stdout || '',
      result.stderr || '',
    ].filter(Boolean).join('\n'));
  }
  return result.stdout.trim();
}

function captureOutput(child, name) {
  let output = '';
  const append = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-16_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return () => `${name} output:\n${output}`;
}

async function waitForHttp(url, child, processOutput) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${child.spawnfile} exited before startup (code ${child.exitCode}).\n${processOutput()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}.\n${processOutput()}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
  } else {
    child.kill('SIGTERM');
  }
  if (child.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
  if (process.platform !== 'win32' && child.exitCode === null) child.kill('SIGKILL');
}

function startVite(port, backendUrl) {
  const viteArguments = [
    'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
  ];
  const command = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const args = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm ${viteArguments.join(' ')}`]
    : viteArguments;
  return spawn(command, args, {
    cwd: frontendRoot,
    env: { ...process.env, VITE_API_PROXY_TARGET: backendUrl },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
}

function disposableEnvironment(databasePath, tempRoot) {
  const environment = { ...process.env };
  delete environment.DATABASE_URL;
  Object.assign(environment, {
    DATABASE_PATH: databasePath,
    SECRET_KEY: 'e2e-real-workflow-only-secret-key',
    BCRYPT_ROUNDS: '4',
    APP_ENV: 'development',
    COOKIE_SECURE: '0',
    FRONTEND_DIR: path.join(tempRoot, 'no-static-frontend'),
  });
  return environment;
}

async function apiData(response) {
  expect(response.ok()).toBeTruthy();
  const payload = await response.json();
  expect(payload.code).toBe(0);
  return payload.data;
}

test('real backend preserves history and transfers current ownership', async ({ page }) => {
  test.setTimeout(120_000);

  const python = pythonExecutable();
  expect(python, 'A project Python runtime is required').toBeTruthy();
  const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'crm-handover-e2e-'));
  const databasePath = path.join(tempRoot, 'handover-e2e.db');
  const forbiddenDatabase = path.resolve(projectRoot, 'crm.db');
  expect(path.resolve(databasePath)).not.toBe(forbiddenDatabase);

  const environment = disposableEnvironment(databasePath, tempRoot);
  let backendProcess;
  let frontendProcess;
  let backendOutput = () => '';
  let frontendOutput = () => '';

  try {
    const unsafeDatabase = path.join(tempRoot, 'unsafe-non-e2e.db');
    runChecked(
      python,
      [
        '-c',
        'import sqlite3,sys; db=sqlite3.connect(sys.argv[1]); '
          + 'db.execute("create table users (username text not null)"); '
          + 'db.execute("insert into users values (\'real_user\')"); db.commit(); db.close()',
        unsafeDatabase,
      ],
      { env: environment },
    );
    const unsafeBefore = fs.readFileSync(unsafeDatabase);
    const rejectedSeed = spawnSync(
      python,
      [seedScript, '--database', unsafeDatabase],
      {
        cwd: projectRoot,
        env: environment,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 30_000,
      },
    );
    expect(rejectedSeed.status).toBe(2);
    expect(rejectedSeed.stdout).toBe('');
    expect(rejectedSeed.stderr).toContain('contains non-e2e users');
    expect(fs.readFileSync(unsafeDatabase).equals(unsafeBefore)).toBe(true);

    runChecked(python, ['-m', 'alembic', 'upgrade', 'head'], { env: environment });
    const seedOutput = runChecked(
      python,
      [seedScript, '--database', databasePath],
      { env: environment },
    );
    const credentials = JSON.parse(seedOutput);
    expect(Object.keys(credentials).sort()).toEqual(['password', 'username']);
    expect(credentials.username).toBe('e2e_admin');

    const backendPort = await reservePort();
    const frontendPort = await reservePort();
    const backendUrl = `http://127.0.0.1:${backendPort}`;
    const frontendUrl = `http://127.0.0.1:${frontendPort}`;

    backendProcess = spawn(
      python,
      [
        '-m', 'uvicorn', 'app.main:app',
        '--host', '127.0.0.1',
        '--port', String(backendPort),
        '--lifespan', 'off',
      ],
      {
        cwd: projectRoot,
        env: environment,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    backendOutput = captureOutput(backendProcess, 'FastAPI');
    await waitForHttp(`${backendUrl}/api/health`, backendProcess, backendOutput);

    frontendProcess = startVite(frontendPort, backendUrl);
    frontendOutput = captureOutput(frontendProcess, 'Vite');
    await waitForHttp(`${frontendUrl}/login`, frontendProcess, frontendOutput);

    await page.goto(`${frontendUrl}/login`);
    await page.getByPlaceholder('请输入用户名').fill(credentials.username);
    await page.getByPlaceholder('请输入密码').fill(credentials.password);
    await page.getByRole('button', { name: '登 录' }).click();
    await expect(page).toHaveURL(/\/admin$/);

    const agents = await apiData(await page.request.get(`${frontendUrl}/api/admin/agents`));
    const targetAgent = agents.find((agent) => agent.username === 'e2e_target');
    expect(targetAgent).toBeTruthy();

    await page.goto(`${frontendUrl}/admin/agents`);
    await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();
    const sourceRow = page.locator('div.cursor-pointer').filter({
      has: page.getByText('E2E Source Agent', { exact: true }),
    });
    await expect(sourceRow).toBeVisible();

    await sourceRow.getByRole('button', { name: '办理离职' }).click();
    await expect(page.getByText('学生状态、意向、阶段、跟进记录和来源进度全部原样保留')).toBeVisible();
    const startRequestPromise = page.waitForRequest((request) => (
      request.method() === 'POST' && /\/api\/admin\/users\/\d+\/offboarding\/start$/.test(request.url())
    ));
    await page.getByRole('button', { name: '开始交接' }).click();
    const startRequest = await startRequestPromise;
    const startBody = startRequest.postDataJSON();
    expect(startBody.expected_version).toBe(1);
    expect(startBody.idempotency_key).toMatch(/^handover-\d+-[0-9a-f-]+$/);

    await expect(page).toHaveURL(/\/admin\/handovers\?batch=\d+/);
    const batchId = Number(new URL(page.url()).searchParams.get('batch'));
    expect(batchId).toBeGreaterThan(0);
    await expect(page.getByText('E2E Source Agent 的交接')).toBeVisible();
    await expect(page.getByText('剩余 2 / 2').first()).toBeVisible();

    await page.getByLabel('逾期状态').selectOption('true');
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page.getByText('E2E Student Alpha')).toBeVisible();
    await expect(page.getByText('E2E Student Beta')).not.toBeVisible();
    await page.getByLabel('接手员工').selectOption({ label: 'E2E Target Agent' });
    await page.getByLabel('选择 E2E Student Alpha').check();
    await page.getByRole('button', { name: '转派所选' }).click();

    const partialDialog = page.getByRole('dialog', { name: '确认交接预览' });
    await expect(partialDialog).toContainText('E2E Student Alpha');
    const partialRequestPromise = page.waitForRequest((request) => (
      request.method() === 'POST'
      && new URL(request.url()).pathname === `/api/admin/handovers/${batchId}/transfers`
    ));
    await partialDialog.getByRole('button', { name: '确认交接' }).click();
    const partialBody = (await partialRequestPromise).postDataJSON();
    expect(partialBody).toEqual({
      target_agent_id: targetAgent.id,
      mode: 'selected',
      student_ids: [expect.any(Number)],
      expected_version: 1,
      idempotency_key: expect.stringMatching(/^handover-\d+-[0-9a-f-]+$/),
    });
    await expect(page.getByText('交接完成 1 条，跳过 0 条')).toBeVisible();
    await expect(page.getByText('剩余 1 / 2').first()).toBeVisible();

    await page.getByRole('button', { name: '全部接手' }).click();
    const allDialog = page.getByRole('dialog', { name: '确认交接预览' });
    await expect(allDialog).toContainText('全部剩余学生 → E2E Target Agent');
    const allRequestPromise = page.waitForRequest((request) => (
      request.method() === 'POST'
      && new URL(request.url()).pathname === `/api/admin/handovers/${batchId}/transfers`
    ));
    await allDialog.getByRole('button', { name: '确认交接' }).click();
    const allBody = (await allRequestPromise).postDataJSON();
    expect(allBody).toEqual({
      target_agent_id: targetAgent.id,
      mode: 'all_remaining',
      student_ids: [],
      expected_version: 2,
      idempotency_key: expect.stringMatching(/^handover-\d+-[0-9a-f-]+$/),
    });
    expect(allBody.idempotency_key).not.toBe(partialBody.idempotency_key);
    expect(partialBody.idempotency_key).not.toBe(startBody.idempotency_key);
    expect(allBody.idempotency_key).not.toBe(startBody.idempotency_key);

    await expect(page.getByText('交接完成 1 条，跳过 0 条，批次已完成')).toBeVisible();
    await expect(page.getByText('已完成').first()).toBeVisible();

    const detail = await apiData(
      await page.request.get(`${frontendUrl}/api/admin/handovers/${batchId}`),
    );
    expect(detail.batch.status).toBe('completed');
    expect(detail.batch.remaining_items).toBe(0);
    expect(detail.items).toHaveLength(2);
    expect(detail.items.every((item) => item.handover_status === 'transferred')).toBe(true);
    expect(detail.items.every((item) => item.target_agent_id === targetAgent.id)).toBe(true);
    expect(detail.items.every((item) => item.assigned_to === targetAgent.id)).toBe(true);

    const users = await apiData(await page.request.get(`${frontendUrl}/api/admin/users`));
    const sourceUser = users.find((user) => user.username === 'e2e_source');
    expect(sourceUser.employment_status).toBe('offboarded');
    expect(sourceUser.is_active).toBe(false);

    const auditOutput = runChecked(
      python,
      [seedScript, '--database', databasePath, '--verify-complete'],
      { env: environment },
    );
    expect(auditOutput).toBe('');
  } catch (error) {
    throw new Error(`${error.message}\n${backendOutput()}\n${frontendOutput()}`);
  } finally {
    await stopProcess(frontendProcess);
    await stopProcess(backendProcess);
    const resolvedTemp = path.resolve(tempRoot);
    const resolvedOsTemp = path.resolve(os.tmpdir());
    if (!resolvedTemp.startsWith(`${resolvedOsTemp}${path.sep}`)
      || !path.basename(resolvedTemp).startsWith('crm-handover-e2e-')) {
      throw new Error(`Refusing to remove unexpected temp directory: ${resolvedTemp}`);
    }
    await fs.promises.rm(resolvedTemp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
