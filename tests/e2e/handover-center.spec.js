// @ts-check
const { test, expect } = require('@playwright/test');
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..', '..');
const frontendRoot = path.join(projectRoot, 'frontend');

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

function captureOutput(child) {
  let output = '';
  const append = (chunk) => {
    output = `${output}${chunk.toString()}`.slice(-12_000);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return () => output;
}

async function waitForHttp(url, child, processOutput) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before startup (code ${child.exitCode}).\n${processOutput()}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // The port is not accepting connections yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${url}.\n${processOutput()}`);
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill.exe', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 3_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

function ok(data) {
  return { code: 0, data, msg: 'ok' };
}

const adminUser = {
  id: 1,
  username: 'e2e_mock_admin',
  name: '合成超管',
  role: 'admin',
  is_active: true,
  is_super_admin: true,
  page_permissions: [],
  operation_permissions: [],
  must_change_password: false,
};

function handoverItem({ id, studentId, name, overdue, kinds, intent = 'B' }) {
  return {
    id,
    student_id: studentId,
    name,
    case_no: `E2E-${studentId}`,
    school_name: '合成测试学校',
    region: '合成测试地区',
    status: '已联系',
    status_detail: overdue ? '今天需回访' : '正常跟进',
    intent_level: intent,
    stage: '有意向',
    need_help: overdue,
    assigned_to: 11,
    handover_status: 'pending',
    target_agent_id: null,
    transfer_id: null,
    transferred_at: null,
    overdue,
    work_item_kinds: kinds,
    open_work_item_count: kinds.length,
  };
}

async function installApiMocks(page, captured) {
  const sourceAgent = {
    id: 11,
    username: 'e2e_mock_source',
    name: '原话务员',
    role: 'agent',
    is_active: true,
    employment_status: 'active',
    employment_version: 4,
    total_tasks: 2,
    done_tasks: 0,
    today_calls: 0,
    created_at: '2026-07-11 08:00:00',
  };
  const targetAgent = {
    id: 12,
    username: 'e2e_mock_target',
    name: '接手话务员',
    role: 'agent',
    is_active: true,
    employment_status: 'active',
    employment_version: 1,
    total_tasks: 0,
    done_tasks: 0,
    today_calls: 0,
    created_at: '2026-07-11 08:05:00',
  };
  const items = [
    handoverItem({
      id: 501,
      studentId: 101,
      name: '合成学生甲',
      overdue: true,
      kinds: ['scheduled_follow_up', 'home_visit'],
      intent: 'A',
    }),
    handoverItem({
      id: 502,
      studentId: 102,
      name: '合成学生乙',
      overdue: false,
      kinds: ['lead_contact', 'campus_visit'],
    }),
  ];
  const batch = {
    id: 71,
    source_agent: { id: sourceAgent.id, name: sourceAgent.name, username: sourceAgent.username },
    status: 'pending',
    version: 1,
    total_items: 2,
    remaining_items: 2,
    transferred_items: 0,
    initiated_by: adminUser.id,
    initiated_at: '2026-07-11 09:00:00',
    completed_by: null,
    completed_at: null,
  };
  let started = false;
  let nextTransferId = 801;

  await page.addInitScript((user) => {
    localStorage.setItem('crm_user', JSON.stringify(user));
  }, adminUser);

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const apiPath = url.pathname.replace(/^\/api/, '');
    const method = request.method();

    if (method === 'GET' && apiPath === '/auth/me') {
      await route.fulfill({ json: ok(adminUser) });
      return;
    }
    if (method === 'GET' && apiPath === '/admin/users') {
      await route.fulfill({ json: ok([adminUser, sourceAgent, targetAgent]) });
      return;
    }
    if (method === 'POST' && apiPath === `/admin/users/${sourceAgent.id}/offboarding/start`) {
      const body = request.postDataJSON();
      captured.start.push(body);
      started = true;
      sourceAgent.is_active = false;
      sourceAgent.employment_status = 'handover_pending';
      sourceAgent.employment_version += 1;
      await route.fulfill({ json: ok(batch) });
      return;
    }
    if (method === 'GET' && apiPath === '/admin/handovers') {
      await route.fulfill({
        json: ok({ total: started ? 1 : 0, page: 1, page_size: 200, list: started ? [batch] : [] }),
      });
      return;
    }
    if (method === 'GET' && apiPath === '/admin/agents') {
      await route.fulfill({ json: ok([sourceAgent, targetAgent]) });
      return;
    }
    if (method === 'GET' && apiPath === `/admin/handovers/${batch.id}`) {
      let visibleItems = items;
      if (url.searchParams.get('overdue') === 'true') {
        visibleItems = items.filter((item) => item.overdue);
      }
      const requestedStatus = url.searchParams.get('status');
      if (requestedStatus) {
        visibleItems = visibleItems.filter((item) => item.handover_status === requestedStatus);
      }
      await route.fulfill({
        json: ok({
          batch,
          total: visibleItems.length,
          page: 1,
          page_size: 50,
          items: visibleItems,
          filter_options: {
            regions: ['合成测试地区'],
            schools: ['合成测试学校'],
            intents: ['A', 'B'],
            kinds: ['scheduled_follow_up', 'home_visit', 'lead_contact', 'campus_visit'],
          },
        }),
      });
      return;
    }
    if (method === 'POST' && apiPath === `/admin/handovers/${batch.id}/preview-transfer`) {
      const body = request.postDataJSON();
      captured.preview.push(body);
      const selected = body.mode === 'selected'
        ? items.filter((item) => body.student_ids.includes(item.student_id) && item.handover_status === 'pending')
        : items.filter((item) => item.handover_status === 'pending');
      const selectedKinds = selected.flatMap((item) => item.work_item_kinds);
      const byKind = Object.fromEntries(
        [...new Set(selectedKinds)].map((kind) => [kind, selectedKinds.filter((item) => item === kind).length]),
      );
      await route.fulfill({
        json: ok({
          batch_id: batch.id,
          version: batch.version,
          mode: body.mode,
          selected_count: selected.length,
          open_work_item_count: selected.reduce((sum, item) => sum + item.open_work_item_count, 0),
          overdue_count: selected.filter((item) => item.overdue).length,
          high_intent_count: selected.filter((item) => item.intent_level === 'A').length,
          by_kind: byKind,
        }),
      });
      return;
    }
    if (method === 'POST' && apiPath === `/admin/handovers/${batch.id}/transfers`) {
      const body = request.postDataJSON();
      captured.transfer.push(body);
      if (body.expected_version !== batch.version) {
        await route.fulfill({ status: 409, json: { detail: '交接数据已变化' } });
        return;
      }
      const selected = body.mode === 'selected'
        ? items.filter((item) => body.student_ids.includes(item.student_id) && item.handover_status === 'pending')
        : items.filter((item) => item.handover_status === 'pending');
      const transferId = nextTransferId++;
      for (const item of selected) {
        item.handover_status = 'transferred';
        item.target_agent_id = targetAgent.id;
        item.transfer_id = transferId;
        item.transferred_at = '2026-07-11 09:10:00';
        item.assigned_to = targetAgent.id;
      }
      batch.remaining_items -= selected.length;
      batch.transferred_items += selected.length;
      batch.version += 1;
      batch.status = batch.remaining_items === 0 ? 'completed' : 'in_progress';
      if (batch.status === 'completed') {
        batch.completed_by = adminUser.id;
        batch.completed_at = '2026-07-11 09:10:00';
      }
      await route.fulfill({
        json: ok({
          transfer_id: transferId,
          transferred_ids: selected.map((item) => item.student_id),
          skipped_ids: [],
          remaining_count: batch.remaining_items,
          batch_version: batch.version,
          completed: batch.status === 'completed',
        }),
      });
      return;
    }

    await route.fulfill({ json: ok({}) });
  });
}

test.describe('employee handover center mocked workflow', () => {
  test.describe.configure({ mode: 'serial' });

  let frontendProcess;
  let frontendUrl;

  test.beforeAll(async () => {
    const port = await reservePort();
    frontendUrl = `http://127.0.0.1:${port}`;
    const viteArguments = [
      'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort',
    ];
    const npmCommand = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'npm';
    const npmArguments = process.platform === 'win32'
      ? ['/d', '/s', '/c', `npm ${viteArguments.join(' ')}`]
      : viteArguments;
    frontendProcess = spawn(
      npmCommand,
      npmArguments,
      {
        cwd: frontendRoot,
        env: { ...process.env },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    );
    const processOutput = captureOutput(frontendProcess);
    await waitForHttp(`${frontendUrl}/login`, frontendProcess, processOutput);
  });

  test.afterAll(async () => {
    await stopProcess(frontendProcess);
  });

  test('starts offboarding, transfers selected students, then completes the batch', async ({ page }) => {
    const captured = { start: [], preview: [], transfer: [] };
    await installApiMocks(page, captured);

    await page.goto(`${frontendUrl}/admin/agents`);
    await expect(page.getByRole('heading', { name: '账号管理' })).toBeVisible();
    await expect(page.getByText('原话务员').first()).toBeVisible();

    const sourceRow = page.locator('div.cursor-pointer').filter({
      has: page.getByText('原话务员', { exact: true }),
    });
    await sourceRow.getByRole('button', { name: '办理离职' }).click();
    await expect(page.getByText('学生状态、意向、阶段、跟进记录和来源进度全部原样保留')).toBeVisible();
    await page.getByRole('button', { name: '开始交接' }).click();

    await expect(page).toHaveURL(/\/admin\/handovers\?batch=71/);
    await expect(page.getByRole('heading', { name: '离职交接' })).toBeVisible();
    await expect(page.getByText('原话务员 的交接')).toBeVisible();
    await expect(page.getByText('剩余 2 / 2').first()).toBeVisible();

    await page.getByLabel('逾期状态').selectOption('true');
    await expect(page).toHaveURL(/overdue=true/);
    await expect(page.getByText('合成学生甲')).toBeVisible();
    await expect(page.getByText('合成学生乙')).not.toBeVisible();

    await page.getByLabel('接手员工').selectOption('12');
    await page.getByLabel('选择 合成学生甲').check();
    await page.getByRole('button', { name: '转派所选' }).click();

    const partialDialog = page.getByRole('dialog', { name: '确认交接预览' });
    await expect(partialDialog).toContainText('转派所选学生 → 接手话务员');
    await expect(partialDialog).toContainText('合成学生甲');
    await expect(partialDialog).toContainText('A 级意向');
    await partialDialog.getByRole('button', { name: '确认交接' }).click();
    await expect(page.getByText('交接完成 1 条，跳过 0 条')).toBeVisible();
    await expect(page.getByText('剩余 1 / 2').first()).toBeVisible();

    await page.getByRole('button', { name: '全部接手' }).click();
    const allDialog = page.getByRole('dialog', { name: '确认交接预览' });
    await expect(allDialog).toContainText('全部剩余学生 → 接手话务员');
    await allDialog.getByRole('button', { name: '确认交接' }).click();

    await expect(page.getByText('交接完成 1 条，跳过 0 条，批次已完成')).toBeVisible();
    await expect(page.getByText('已完成').first()).toBeVisible();

    expect(captured.start).toHaveLength(1);
    expect(captured.start[0]).toEqual({
      expected_version: 4,
      idempotency_key: expect.stringMatching(/^handover-11-[0-9a-f-]+$/),
    });
    expect(captured.preview).toEqual([
      { mode: 'selected', student_ids: [101] },
      { mode: 'all_remaining', student_ids: [] },
    ]);
    expect(captured.transfer).toHaveLength(2);
    expect(captured.transfer[0]).toEqual({
      target_agent_id: 12,
      mode: 'selected',
      student_ids: [101],
      expected_version: 1,
      idempotency_key: expect.stringMatching(/^handover-71-[0-9a-f-]+$/),
    });
    expect(captured.transfer[1]).toEqual({
      target_agent_id: 12,
      mode: 'all_remaining',
      student_ids: [],
      expected_version: 2,
      idempotency_key: expect.stringMatching(/^handover-71-[0-9a-f-]+$/),
    });
    expect(new Set([
      captured.start[0].idempotency_key,
      captured.transfer[0].idempotency_key,
      captured.transfer[1].idempotency_key,
    ]).size).toBe(3);
  });
});
