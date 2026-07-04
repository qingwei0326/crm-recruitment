// @ts-check
const { test, expect } = require('@playwright/test');

const ADMIN = {
  username: process.env.E2E_ADMIN_USERNAME || 'e2eadmin',
  password: process.env.E2E_ADMIN_PASSWORD || 'admin123',
};

const RUN_E2E = process.env.RUN_E2E === '1';
const unique = `E2E招生${Date.now()}`;

const mockAdminUser = {
  id: 1,
  username: 'admissions-admin',
  name: '招生管理员',
  role: 'admin',
  is_active: true,
  is_super_admin: true,
  must_change_password: false,
};

const mockAgentUser = {
  id: 51,
  username: 'admissions-agent',
  name: '招生话务员',
  role: 'agent',
  is_active: true,
  must_change_password: false,
};

const mockHomeStudent = {
  id: 5101,
  name: '招生家访学生',
  region: '测试区',
  school_name: 'E2E测试中学',
  status: '已联系',
  status_detail: '家长有意向',
  stage: '有意向',
  intent_level: 'A',
  assigned_to: mockAgentUser.id,
  agent_name: mockAgentUser.name,
  guardian_name: '家访学生家长',
  guardian_phone: '13900005101',
  guardian2_name: '',
  guardian2_phone: '',
  score: 520,
  program: '护理',
  days_since_assigned: 1,
};

const mockDirectCampusStudent = {
  id: 5102,
  name: '招生到校学生',
  region: '测试区',
  school_name: 'E2E测试中学',
  status: '已联系',
  status_detail: '约到校',
  stage: '有意向',
  intent_level: 'A',
  assigned_to: mockAgentUser.id,
  agent_name: mockAgentUser.name,
  guardian_name: '到校学生家长',
  guardian_phone: '13900005102',
  guardian2_name: '',
  guardian2_phone: '',
  score: 535,
  program: '护理',
  days_since_assigned: 1,
};

function ok(data) {
  return { code: 0, data };
}

function pagePayload(list, pageSize = 100) {
  return { total: list.length, page: 1, page_size: pageSize, list };
}

function studentDetail(student, state) {
  const admissionsTimeline = [
    ...state.homeVisits
      .filter((item) => item.student_id === student.id)
      .map((item) => ({
        id: `home-${item.id}`,
        type: 'home_visit',
        title: '家访',
        status: item.result || item.status,
        happened_at: item.requested_visit_time || item.created_at,
      })),
    ...state.campusVisits
      .filter((item) => item.student_id === student.id)
      .map((item) => ({
        id: `campus-${item.id}`,
        type: 'campus_visit',
        title: '预约到校',
        status: item.result || item.status,
        happened_at: item.appointment_at || item.created_at,
      })),
  ];
  return {
    student,
    calls: [],
    notes: [],
    follow_ups: [],
    visits: [],
    intent_timeline: [],
    admissions_timeline: admissionsTimeline,
  };
}

async function installAdmissionsMocks(page) {
  const state = {
    currentUser: null,
    students: [mockHomeStudent, mockDirectCampusStudent].map((student) => ({ ...student })),
    homeVisits: [],
    campusVisits: [],
    enrollments: [],
    nextHomeVisitId: 101,
    nextCampusVisitId: 201,
    nextEnrollmentId: 301,
  };

  const findStudent = (id) => state.students.find((student) => String(student.id) === String(id));

  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace('/api', '');
    const method = request.method();

    if (path === '/auth/me') {
      await route.fulfill({
        json: state.currentUser ? ok(state.currentUser) : { code: -1, data: null },
      });
      return;
    }
    if (path === '/auth/login') {
      const body = request.postDataJSON();
      state.currentUser = body.username === mockAgentUser.username ? mockAgentUser : mockAdminUser;
      await route.fulfill({ json: ok({ user: state.currentUser, access_token: 'mock-token' }) });
      return;
    }
    if (path === '/auth/logout') {
      state.currentUser = null;
      await route.fulfill({ json: ok({}) });
      return;
    }

    if (path === '/tasks/yesterday') {
      await route.fulfill({ json: ok({ stale_unconcat: [] }) });
      return;
    }
    if (path === '/students/agent/settings') {
      await route.fulfill({ json: ok({ dial_max_per_24h: 3 }) });
      return;
    }
    if (path === '/tasks/today') {
      await route.fulfill({
        json: ok({
          total: state.students.length,
          list: state.students,
          stats: {
            total: state.students.length,
            done: state.students.length,
            pending: 0,
            follow_up: 0,
            progress_pct: 100,
          },
          schools: [{ name: 'E2E测试中学', count: state.students.length }],
          truncated: false,
        }),
      });
      return;
    }
    if (path === '/tasks/handled') {
      await route.fulfill({
        json: ok({
          total: state.students.length,
          list_total: state.students.length,
          list: state.students,
          counts: { 已联系: state.students.length, 未接: 0, 待回访: 0 },
        }),
      });
      return;
    }
    if (path.endsWith('/detail') && path.startsWith('/students/')) {
      const studentId = path.split('/')[2];
      await route.fulfill({ json: ok(studentDetail(findStudent(studentId), state)) });
      return;
    }
    if (path.startsWith('/students/') && method === 'PUT') {
      const studentId = path.split('/')[2];
      const student = findStudent(studentId);
      Object.assign(student, request.postDataJSON());
      await route.fulfill({ json: ok(student) });
      return;
    }

    if (path === '/admissions/home-visits' && method === 'GET') {
      await route.fulfill({ json: ok(pagePayload(state.homeVisits)) });
      return;
    }
    if (path === '/admissions/home-visits' && method === 'POST') {
      const body = request.postDataJSON();
      const student = findStudent(body.student_id);
      const item = {
        id: state.nextHomeVisitId++,
        ...body,
        student_id: student.id,
        student_name: student.name,
        region: student.region,
        school_name: student.school_name,
        status: '待确认',
        result: '',
        result_notes: '',
        creator_agent_id: mockAgentUser.id,
        creator_agent_name: mockAgentUser.name,
        assigned_admin_name: '',
        created_at: '2026-07-03T09:00:00',
      };
      state.homeVisits.push(item);
      student.stage = '待家访';
      await route.fulfill({ json: ok(item) });
      return;
    }
    if (path.startsWith('/admissions/home-visits/') && method === 'PATCH') {
      const id = Number(path.split('/').pop());
      const item = state.homeVisits.find((row) => row.id === id);
      Object.assign(item, request.postDataJSON());
      await route.fulfill({ json: ok(item) });
      return;
    }

    if (path === '/admissions/campus-visits' && method === 'GET') {
      await route.fulfill({ json: ok(pagePayload(state.campusVisits)) });
      return;
    }
    if (path === '/admissions/campus-visits' && method === 'POST') {
      const body = request.postDataJSON();
      const student = findStudent(body.student_id);
      const fromAgent = state.currentUser?.role === 'agent';
      const item = {
        id: state.nextCampusVisitId++,
        ...body,
        student_id: student.id,
        student_name: student.name,
        region: student.region,
        school_name: student.school_name,
        status: '已预约',
        result: '',
        onsite_enrolled: false,
        result_notes: '',
        creator_user_id: fromAgent ? mockAgentUser.id : mockAdminUser.id,
        creator_user_name: fromAgent ? mockAgentUser.name : mockAdminUser.name,
        reception_admin_name: '',
        created_at: '2026-07-03T10:00:00',
      };
      state.campusVisits.push(item);
      student.stage = '到校参观已安排';
      await route.fulfill({ json: ok(item) });
      return;
    }
    if (path.startsWith('/admissions/campus-visits/') && method === 'PATCH') {
      const id = Number(path.split('/').pop());
      const item = state.campusVisits.find((row) => row.id === id);
      Object.assign(item, request.postDataJSON());
      await route.fulfill({ json: ok(item) });
      return;
    }

    if (path === '/admissions/enrollments' && method === 'GET') {
      await route.fulfill({ json: ok(pagePayload(state.enrollments)) });
      return;
    }
    if (path === '/admissions/enrollments' && method === 'POST') {
      const body = request.postDataJSON();
      const student = findStudent(body.student_id);
      const campus = state.campusVisits.find((item) => item.id === body.campus_visit_task_id);
      const source = body.source || (campus ? '到校参观后' : '家访后');
      const record = {
        id: state.nextEnrollmentId++,
        ...body,
        student_id: student.id,
        student_name: student.name,
        region: student.region,
        school_name: student.school_name,
        source,
        enrolled_program: body.enrolled_program || student.program || '',
        amount: body.amount ?? 0,
        enrolled_at: '2026-07-03T11:30:00',
        attributed_agent_id: mockAgentUser.id,
        attributed_agent_name: mockAgentUser.name,
        attribution_method: campus ? '自动到校预约人' : '自动家访申请人',
        settlement_status: '未结算',
        settlement_notes: '',
        first_assigned_agent_name: mockAgentUser.name,
        current_assigned_agent_name: mockAgentUser.name,
        last_effective_agent_name: mockAgentUser.name,
        home_visit_creator_agent_name: campus?.home_visit_task_id ? mockAgentUser.name : '',
        campus_visit_creator_user_name: campus?.creator_user_name || '',
        handover_policy: '工作手机交接时按报名链路证据确认归属。',
        attribution_recommendation: {
          agent_id: mockAgentUser.id,
          agent_name: mockAgentUser.name,
          confidence: 'high',
          reason: '由到校预约人促成报名',
        },
      };
      state.enrollments.push(record);
      if (campus) campus.enrollment_id = record.id;
      student.status = '已报名';
      student.stage = '已报名';
      await route.fulfill({ json: ok(record) });
      return;
    }
    if (path === '/admissions/enrollments/summary') {
      await route.fulfill({
        json: ok([
          {
            attributed_agent_id: mockAgentUser.id,
            attributed_agent_name: mockAgentUser.name,
            total: state.enrollments.length,
            unsettled: state.enrollments.length,
            settled: 0,
            postponed: 0,
            disputed: 0,
          },
        ]),
      });
      return;
    }
    if (path.startsWith('/admissions/enrollments/') && method === 'PATCH') {
      const id = Number(path.split('/').pop());
      const item = state.enrollments.find((row) => row.id === id);
      Object.assign(item, request.postDataJSON());
      await route.fulfill({ json: ok(item) });
      return;
    }

    if (path === '/admin/agents') {
      await route.fulfill({ json: ok([mockAgentUser]) });
      return;
    }

    await route.fulfill({ json: ok({}) });
  });

  return state;
}

async function login(page, username, password) {
  await page.goto('/login');
  await page.getByPlaceholder('请输入用户名').fill(username);
  await page.getByPlaceholder('请输入密码').fill(password);
  await page.getByRole('button', { name: '登 录' }).click();
  await page.waitForURL(/\/(admin|agent|change-password|mobile)/, { timeout: 20_000 });
}

async function resetBrowserAuth(page, mockState) {
  mockState.currentUser = null;
  await page.evaluate(() => localStorage.clear()).catch(() => {});
  await page.context().clearCookies();
}

async function openAgentDetailFromHandled(page, studentName) {
  await page.goto('/agent');
  await page.getByRole('button', { name: /待处理/ }).click();
  await expect(page.getByText(studentName)).toBeVisible({ timeout: 20_000 });
  await page.getByText(studentName).first().click();
  await expect(page.getByText('招生推进')).toBeVisible({ timeout: 20_000 });
}

if (!RUN_E2E) {
  test.describe('admissions visit enrollment workflow', () => {
    test('agent and admin complete home visit, campus visit, enrollment, and settlement', async ({ page }) => {
      const state = await installAdmissionsMocks(page);

      await login(page, mockAgentUser.username, 'agent123');

      await openAgentDetailFromHandled(page, mockHomeStudent.name);
      await page.getByRole('button', { name: '申请家访' }).click();
      await page.getByLabel('家访地址').fill('测试区一号');
      await page.getByLabel('家访优先级').selectOption('高');
      await page.getByLabel('家长意向说明').fill('家长愿意安排家访');
      await page.getByLabel('情况').fill('中考前先按平时成绩评估');
      await page.getByLabel('家访备注').fill('E2E 家访申请');
      await page.getByRole('button', { name: '提交家访申请' }).click();
      await expect.poll(() => state.homeVisits.length).toBe(1);

      await resetBrowserAuth(page, state);
      await login(page, ADMIN.username, ADMIN.password);

      await page.goto('/admin/home-visits');
      await expect(page.getByText(mockHomeStudent.name)).toBeVisible({ timeout: 20_000 });
      const homeVisit = state.homeVisits[0];
      await page.getByLabel(`家访状态 ${homeVisit.id}`, { exact: true }).selectOption('已完成');
      await page.getByLabel(`家访结果 ${homeVisit.id}`, { exact: true }).selectOption('安排到校参观');
      await page.getByLabel(`家访结果备注 ${homeVisit.id}`, { exact: true }).fill('家访后安排到校');
      await page.getByRole('button', { name: `保存家访结果 ${homeVisit.id}` }).click();
      await expect.poll(() => state.homeVisits[0].result).toBe('安排到校参观');

      await page.getByLabel(`到校时间 ${homeVisit.id}`, { exact: true }).fill('2026-07-03T10:00');
      await page.getByRole('button', { name: `安排到校 ${homeVisit.id}` }).click();
      await expect.poll(() => state.campusVisits.some((item) => item.student_id === mockHomeStudent.id)).toBe(true);

      await resetBrowserAuth(page, state);
      await login(page, mockAgentUser.username, 'agent123');

      await openAgentDetailFromHandled(page, mockDirectCampusStudent.name);
      await page.getByRole('button', { name: '预约到校' }).click();
      await page.getByLabel('预约到校时间').fill('2026-07-04T14:00');
      await page.getByLabel('来校人数').fill('2');
      await page.getByLabel('当前顾虑').fill('担心成绩是否够');
      await page.getByLabel('到校备注').fill('E2E 直接到校预约');
      await page.getByRole('button', { name: '提交到校预约' }).click();
      await expect
        .poll(() => state.campusVisits.some((item) => item.student_id === mockDirectCampusStudent.id))
        .toBe(true);

      await resetBrowserAuth(page, state);
      await login(page, ADMIN.username, ADMIN.password);

      await page.goto('/admin/campus-visits');
      await expect(page.getByText(mockHomeStudent.name)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(mockDirectCampusStudent.name)).toBeVisible({ timeout: 20_000 });

      const directCampus = state.campusVisits.find((item) => item.student_id === mockDirectCampusStudent.id);
      await page.getByLabel(`到校状态 ${directCampus.id}`, { exact: true }).selectOption('已到校');
      await page.getByLabel(`到校结果 ${directCampus.id}`, { exact: true }).selectOption('现场报名');
      await page.getByRole('button', { name: `保存到校结果 ${directCampus.id}` }).click();
      await expect.poll(() => directCampus.result).toBe('现场报名');

      await page.getByLabel(`报名专业 ${directCampus.id}`, { exact: true }).fill('护理');
      await page.getByLabel(`报名金额 ${directCampus.id}`, { exact: true }).fill('500');
      await page.getByRole('button', { name: `登记报名 ${directCampus.id}` }).click();

      await expect.poll(() => {
        const enrollment = state.enrollments.find((item) => item.student_id === mockDirectCampusStudent.id);
        return enrollment && {
          agentName: enrollment.attributed_agent_name,
          method: enrollment.attribution_method,
        };
      }).toEqual({
        agentName: mockAgentUser.name,
        method: '自动到校预约人',
      });

      await page.goto('/admin/enrollment-settlement');
      await expect(page.getByText(mockAgentUser.name).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(mockDirectCampusStudent.name)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('自动到校预约人')).toBeVisible();
      await expect(page.getByText('页面出了点问题')).toHaveCount(0);
    });
  });
}

async function apiLogin(request, credentials = ADMIN) {
  const res = await request.post('/api/auth/login', { data: credentials });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.code).toBe(0);
  return body.data.access_token;
}

function authHeaders(token) {
  return { Authorization: `Bearer ${token}` };
}

async function createAgent(request, token) {
  const username = `${unique}-agent`;
  const password = 'agent123';
  const res = await request.post('/api/admin/users', {
    headers: authHeaders(token),
    data: {
      username,
      password,
      name: `${unique}话务员`,
      role: 'agent',
      service_regions: '测试区',
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.code).toBe(0);
  return { ...body.data, username, password };
}

async function createStudent(request, token, agentId, name, phoneSuffix, status = '已联系') {
  const res = await request.post('/api/students', {
    headers: authHeaders(token),
    data: {
      name,
      region: '测试区',
      status,
      intent_level: 'A',
      stage: '有意向',
      assigned_to: agentId,
      join_reasons: 'E2E 招生流程',
      program: '护理',
      score: 520,
      guardian_name: '测试家长',
      guardian_phone: `139${phoneSuffix}`,
      school_name: 'E2E测试中学',
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.code).toBe(0);
  return body.data;
}

async function changeAgentPasswordIfRequired(page, oldPassword, newPassword) {
  if (!page.url().includes('/change-password')) return;
  await page.getByPlaceholder('管理员给你的初始密码').fill(oldPassword);
  await page.getByPlaceholder('至少 6 位').fill(newPassword);
  await page.getByPlaceholder('再次输入新密码').fill(newPassword);
  await page.getByRole('button', { name: '保存新密码' }).click();
  await page.waitForURL(/\/agent/, { timeout: 20_000 });
}

if (RUN_E2E) {
  test.describe('admissions visit enrollment workflow', () => {
    test('agent and admin complete home visit, campus visit, enrollment, and settlement', async ({ page, request }) => {
      const adminToken = await apiLogin(request);
      const agent = await createAgent(request, adminToken);
      const homeStudent = await createStudent(
        request,
        adminToken,
        agent.id,
        `${unique}家访学生`,
        '00001001',
      );
      const directCampusStudent = await createStudent(
        request,
        adminToken,
        agent.id,
        `${unique}直访学生`,
        '00001002',
      );

      await login(page, agent.username, agent.password);
      await changeAgentPasswordIfRequired(page, agent.password, `${agent.password}x`);

      await openAgentDetailFromHandled(page, homeStudent.name);
      await page.getByRole('button', { name: '申请家访' }).click();
      await page.getByLabel('家访地址').fill('测试区一号');
      await page.getByLabel('家访优先级').selectOption('高');
      await page.getByLabel('家长意向说明').fill('家长愿意安排家访');
      await page.getByLabel('情况').fill('中考前先按平时成绩评估');
      await page.getByLabel('家访备注').fill('E2E 家访申请');
      await page.getByRole('button', { name: '提交家访申请' }).click();
      await expect.poll(async () => {
        const res = await request.get('/api/admissions/home-visits', {
          headers: authHeaders(adminToken),
        });
        const body = await res.json();
        return body.data.list.find((item) => item.student_id === homeStudent.id)?.id || 0;
      }).toBeGreaterThan(0);
      const homeVisitRes = await request.get('/api/admissions/home-visits', {
        headers: authHeaders(adminToken),
      });
      const homeVisitBody = await homeVisitRes.json();
      const homeVisit = homeVisitBody.data.list.find(
        (item) => item.student_id === homeStudent.id,
      );
      expect(homeVisit).toBeTruthy();

      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
      await login(page, ADMIN.username, ADMIN.password);

      await page.goto('/admin/home-visits');
      await expect(page.getByText(homeStudent.name)).toBeVisible({ timeout: 20_000 });
      await page.getByLabel(`家访状态 ${homeVisit.id}`, { exact: true }).selectOption('已完成');
      await page.getByLabel(`家访结果 ${homeVisit.id}`, { exact: true }).selectOption('安排到校参观');
      await page.getByLabel(`家访结果备注 ${homeVisit.id}`, { exact: true }).fill('家访后安排到校');
      await page.getByRole('button', { name: `保存家访结果 ${homeVisit.id}` }).click();
      await expect.poll(async () => {
        const res = await request.get('/api/admissions/home-visits', {
          headers: authHeaders(adminToken),
        });
        const body = await res.json();
        return body.data.list.find((item) => item.student_id === homeStudent.id)?.result;
      }).toBe('安排到校参观');

      await page.getByLabel(`到校时间 ${homeVisit.id}`, { exact: true }).fill('2026-07-03T10:00');
      await page.getByRole('button', { name: `安排到校 ${homeVisit.id}` }).click();
      await expect.poll(async () => {
        const res = await request.get('/api/admissions/campus-visits', {
          headers: authHeaders(adminToken),
        });
        const body = await res.json();
        return body.data.list.some((item) => item.student_id === homeStudent.id);
      }).toBe(true);

      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
      await login(page, agent.username, `${agent.password}x`);

      await openAgentDetailFromHandled(page, directCampusStudent.name);
      await page.getByRole('button', { name: '预约到校' }).click();
      await page.getByLabel('预约到校时间').fill('2026-07-04T14:00');
      await page.getByLabel('来校人数').fill('2');
      await page.getByLabel('当前顾虑').fill('担心成绩是否够');
      await page.getByLabel('到校备注').fill('E2E 直接到校预约');
      await page.getByRole('button', { name: '提交到校预约' }).click();
      await expect.poll(async () => {
        const res = await request.get('/api/admissions/campus-visits', {
          headers: authHeaders(adminToken),
        });
        const body = await res.json();
        return body.data.list.some((item) => item.student_id === directCampusStudent.id);
      }).toBe(true);

      await page.context().clearCookies();
      await page.evaluate(() => localStorage.clear());
      await login(page, ADMIN.username, ADMIN.password);

      await page.goto('/admin/campus-visits');
      await expect(page.getByText(homeStudent.name)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(directCampusStudent.name)).toBeVisible({ timeout: 20_000 });

      const campusRes = await request.get('/api/admissions/campus-visits', {
        headers: authHeaders(adminToken),
      });
      const campusBody = await campusRes.json();
      const directCampus = campusBody.data.list.find((item) => item.student_id === directCampusStudent.id);
      expect(directCampus).toBeTruthy();

      await page.getByLabel(`到校状态 ${directCampus.id}`, { exact: true }).selectOption('已到校');
      await page.getByLabel(`到校结果 ${directCampus.id}`, { exact: true }).selectOption('现场报名');
      await page.getByRole('button', { name: `保存到校结果 ${directCampus.id}` }).click();
      await expect.poll(async () => {
        const res = await request.get('/api/admissions/campus-visits', {
          headers: authHeaders(adminToken),
        });
        const body = await res.json();
        return body.data.list.find((item) => item.id === directCampus.id)?.result;
      }).toBe('现场报名');

      await page.getByLabel(`报名专业 ${directCampus.id}`, { exact: true }).fill('护理');
      await page.getByLabel(`报名金额 ${directCampus.id}`, { exact: true }).fill('500');
      await page.getByRole('button', { name: `登记报名 ${directCampus.id}` }).click();

      await expect.poll(async () => {
        const res = await request.get('/api/admissions/enrollments', {
          headers: authHeaders(adminToken),
        });
        const body = await res.json();
        const enrollment = body.data.list.find((item) => item.student_id === directCampusStudent.id);
        return enrollment && {
          agentName: enrollment.attributed_agent_name,
          method: enrollment.attribution_method,
        };
      }).toEqual({
        agentName: agent.name,
        method: '自动到校预约人',
      });

      await page.goto('/admin/enrollment-settlement');
      await expect(page.getByText(agent.name).first()).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText(directCampusStudent.name)).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('自动到校预约人')).toBeVisible();

      await page.screenshot({
        path: `test-results/admissions-workflow-${Date.now()}.png`,
        fullPage: true,
      });
    });
  });
}
