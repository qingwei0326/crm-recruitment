# Admin Exception Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Turn the existing administrator dashboard and daily-ops framework into an exception-first work queue for overdue follow-ups, stalled A leads, assigned-but-undialed students, repeated no-answer students, and missing next actions.

**Architecture:** Keep the existing daily-ops aggregation and review log contract. Add two SQL-backed exception categories to it, expose one common paginated detail endpoint for all exception kinds, and add one read/act page under the existing work-center permission. The page reuses student detail and existing follow-up/status actions rather than inventing a new task table.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, React 18, Vite, Vitest, Testing Library, pytest, Playwright.

**Spec:** docs/superpowers/specs/2026-08-22-admissions-efficiency-design.md

## Global Constraints

- Exception counts use status_policy.py, task_stats.py, and existing work-item semantics.
- Exception queries are read-only except for existing follow-up completion/status/note actions.
- The default time zone and current CST date helpers remain the source of truth.
- A student is not considered progressed merely because a raw dial log exists; the query must distinguish no dial, repeated no-answer, and an active follow-up.
- Do not use AI to classify notes or generate exception labels.
- Normal administrators can view and process exceptions within their existing page/operation permissions.
- The page must return partial data errors visibly; it must not turn a failed category query into a zero count.
- Keep existing daily-ops review logs and statuses; adding a category must not change student business state.

## File Map

- Modify app/admin_daily_ops.py: add repeated-no-answer and missing-next-action counts, owner breakdowns, payload items, and thresholds.
- Create app/routers/admin_exceptions.py: paginated detail endpoint for all exception kinds.
- Modify app/main.py: include the exception router.
- Create tests/test_admin_exceptions.py: count, owner, filtering, permissions, and detail endpoint tests.
- Modify tests/test_task_stats_contract.py and tests/test_admissions_work_items.py: protect status and follow-up semantics.
- Create frontend/src/pages/admin/ExceptionQueue.jsx: exception list and filters.
- Modify frontend/src/pages/admin/dashboard/AdminOpsRail.jsx, AdminDash.jsx, adminWorkflow.js, and frontend/src/App.jsx: links, route, and error states.
- Create frontend/src/pages/admin/__tests__/ExceptionQueue.test.jsx; modify AdminDash.test.jsx and AdminWorkCenter.test.jsx.
- Create tests/e2e/admin-exception-center.spec.js.

### Task 1: Add SQL-Backed Exception Categories

**Files:**
- Modify: app/admin_daily_ops.py
- Create: tests/test_admin_exceptions.py
- Modify: tests/test_task_stats_contract.py

**Interfaces:**
- Extend _daily_ops_counts(db) with repeated_no_answer and missing_next_action.
- Extend _daily_ops_owner_breakdowns(db) with the same keys.
- Extend _build_daily_ops_payload(db, date_key) with items whose keys are exactly repeated_no_answer and missing_next_action.

- [ ] **Step 1: Write failing count and owner tests**

Seed these fixed cases:

~~~python
Student(name="连续未接", assigned_to=agent.id, status=StudentStatus.not_reached)
Student(name="已安排回访", assigned_to=agent.id, status=StudentStatus.not_reached)
Student(name="缺下一步", assigned_to=agent.id, status=StudentStatus.contacted)
Student(name="已完成", assigned_to=agent.id, status=StudentStatus.enrolled)
~~~

Add four dial logs for 连续未接 inside seven days, three dial logs for the same student older than seven days, and one recent dial log for 缺下一步. Add an open FollowUp for 已安排回访. Request /api/admin/daily-ops and assert:

~~~python
items = {item["key"]: item for item in response.json()["data"]["items"]}
assert items["repeated_no_answer"]["count"] == 1
assert items["missing_next_action"]["count"] == 1
assert items["repeated_no_answer"]["owners"][0]["agent_id"] == agent.id
assert items["missing_next_action"]["owners"][0]["agent_id"] == agent.id
~~~

The test must also assert terminal students are excluded and an existing open follow-up excludes a student from missing_next_action.

- [ ] **Step 2: Run the tests and verify they fail**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_admin_exceptions.py -q
~~~

Expected: the new keys are absent from the daily-ops payload.

- [ ] **Step 3: Implement the two metrics**

Use a seven-day window ending at utcnow() for repeated no-answer. Define it as a non-terminal assigned student with canonical status StudentStatus.not_reached and at least three distinct DialLog rows in the window. Use a grouped subquery by student_id; do not count repeated rows for the same dial attempt.

Define missing next action as an assigned, non-terminal student with at least one dial log after assignment and no incomplete FollowUp row. Exclude students with an open WorkItem of kind scheduled_follow_up so a synchronized work item counts as the next action. Return owner count and oldest activity through the existing _owner_rows helper.

Add both items to _build_daily_ops_payload with:

~~~text
repeated_no_answer: "7天内至少3次未接通，仍没有有效下一步。"
missing_next_action: "已处理过但没有未完成回访或下一步动作。"
~~~

Use links /admin/exceptions?kind=repeated_no_answer and /admin/exceptions?kind=missing_next_action. Keep review status behavior identical to existing daily-ops items.

- [ ] **Step 4: Run backend tests**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_admin_exceptions.py tests/test_task_stats_contract.py tests/test_admissions_work_items.py -q
~~~

Expected: all selected tests pass.

- [ ] **Step 5: Commit the metric contract**

~~~powershell
git add app/admin_daily_ops.py tests/test_admin_exceptions.py tests/test_task_stats_contract.py
git commit -m "feat: add repeated-no-answer and next-action exceptions"
~~~

### Task 2: Add the Exception Detail API

**Files:**
- Create: app/routers/admin_exceptions.py
- Modify: app/main.py
- Modify: tests/test_admin_exceptions.py

**Interfaces:**
- Produce GET /api/admin/exception-queue.
- Query parameters: kind in overdue_followups, stale_a, assigned_no_call, repeated_no_answer, missing_next_action; days in 1..30; optional agent_id; page and page_size.
- Return {total, page, page_size, kind, threshold, list}.
- Each row contains student_id, student_name, school_name, region, agent_id, agent_name, status, intent_level, last_activity_at, dial_count, next_follow_up_at, reason, and target_url.

- [ ] **Step 1: Add failing endpoint tests**

Add tests that request each kind and assert the expected row, pagination, agent filter, and permission behavior:

~~~python
response = await client.get(
    "/api/admin/exception-queue?kind=repeated_no_answer&days=7&page_size=10",
    headers=admin_headers,
)
data = response.json()["data"]
assert data["total"] == 1
assert data["list"][0]["student_name"] == "连续未接"
assert data["list"][0]["dial_count"] == 4
assert data["list"][0]["target_url"] == f"/admin/leads/{student.id}"

denied = await client.get(
    "/api/admin/exception-queue?kind=missing_next_action",
    headers=agent_headers,
)
assert denied.status_code in {401, 403}
~~~

- [ ] **Step 2: Run endpoint tests and verify they fail**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_admin_exceptions.py -q
~~~

Expected: the router and endpoint do not exist.

- [ ] **Step 3: Implement the endpoint**

Create shared query builders in admin_exceptions.py for the five kinds. Reuse build_last_activity_subquery, canonical status sets, and FollowUp/WorkItem joins. Order by severity first, then oldest due/activity time, then student ID. Apply agent_id before pagination and return the same _page_payload shape used by admissions work items.

Require ADMIN_PAGE_WORK_CENTER through _require_admin_module or require_page_permission. Reject unknown kinds with HTTP 422. Do not return note content, phone numbers, or transcript fields in an exception row; the detail page links to the existing student detail route where current permissions apply.

- [ ] **Step 4: Run endpoint and permission tests**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_admin_exceptions.py tests/test_permissions.py -q
~~~

Expected: all selected tests pass.

- [ ] **Step 5: Commit the detail API**

~~~powershell
git add app/routers/admin_exceptions.py app/main.py tests/test_admin_exceptions.py
git commit -m "feat: add paginated admin exception queue api"
~~~

### Task 3: Build the Exception Queue Page

**Files:**
- Create: frontend/src/pages/admin/ExceptionQueue.jsx
- Create: frontend/src/pages/admin/__tests__/ExceptionQueue.test.jsx
- Modify: frontend/src/App.jsx
- Modify: frontend/src/pages/admin/adminWorkflow.js

**Interfaces:**
- Consume /api/admin/exception-queue.
- Protect /admin/exceptions with the existing work_center page permission.
- Support tabs for all five kinds, agent filter, days selector, refresh, pagination, and links to student detail.

- [ ] **Step 1: Write failing page tests**

Mock the endpoint with one row for each kind and assert:

~~~jsx
expect(screen.getByRole("heading", { name: "异常处理" })).toBeInTheDocument();
expect(screen.getByRole("tab", { name: "连续未接" })).toBeInTheDocument();
expect(screen.getByText("连续未接")).toBeInTheDocument();
expect(screen.getByText("缺下一步")).toBeInTheDocument();
expect(screen.getByRole("link", { name: /打开学生详情/ })).toHaveAttribute(
  "href",
  "/admin/leads/101",
);
~~~

Add loading, empty, API error, and no-page-permission route tests.

- [ ] **Step 2: Run page tests and verify they fail**

~~~powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/ExceptionQueue.test.jsx src/__tests__/App.routes.test.jsx
~~~

Expected: the page and route do not exist.

- [ ] **Step 3: Implement the page and route**

Create a dense table with columns student, school/region, agent, status/intent, last activity, dial count, next follow-up, reason, and a detail link. Use role=tab for kind selection and preserve kind in the URL query string. Render -- for missing values and a visible error panel for failed requests.

Use useSearchParams and the existing api/getApiErrorMessage utilities. Use one table surface and compact filter controls consistent with AdminWorkCenter.

Add a lazy route under the existing work_center permission. Add 异常处理 to adminWorkflow.js only where navigation metadata is already centralized; do not add a new permission key.

- [ ] **Step 4: Run focused frontend tests**

~~~powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/ExceptionQueue.test.jsx src/__tests__/App.routes.test.jsx
~~~

Expected: all selected tests pass.

- [ ] **Step 5: Commit the page**

~~~powershell
git add frontend/src/pages/admin/ExceptionQueue.jsx frontend/src/pages/admin/__tests__/ExceptionQueue.test.jsx frontend/src/App.jsx frontend/src/pages/admin/adminWorkflow.js
git commit -m "feat: add admin exception queue page"
~~~

### Task 4: Put Exceptions First on the Dashboard

**Files:**
- Modify: frontend/src/pages/admin/dashboard/AdminOpsRail.jsx
- Modify: frontend/src/pages/admin/AdminDash.jsx
- Modify: frontend/src/pages/admin/__tests__/AdminDash.test.jsx
- Modify: frontend/src/pages/admin/__tests__/AdminWorkCenter.test.jsx
- Create: tests/e2e/admin-exception-center.spec.js

**Interfaces:**
- Consume the new daily-ops keys and detail route.
- Preserve existing daily-ops review actions and risk queue data.
- Produce direct links from each exception card to /admin/exceptions?kind=...

- [ ] **Step 1: Add failing dashboard assertions**

Mock /api/admin/daily-ops with repeated_no_answer and missing_next_action items. Assert their titles, counts, links, and visible review status. Assert that a failed exception-queue request shows an error panel instead of a zero count.

- [ ] **Step 2: Run dashboard tests and verify they fail**

~~~powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/AdminDash.test.jsx src/pages/admin/__tests__/AdminWorkCenter.test.jsx
~~~

Expected: the new item titles/links are not rendered or error states are not covered.

- [ ] **Step 3: Wire the dashboard cards**

Keep DailyOps data-driven so the two new items render through the existing severity/review controls. Update AdminOpsRail copy to emphasize uncontacted, repeated no-answer, and missing next action alongside overdue follow-ups and stale A leads. Update any buildDashboardActions item that duplicates these categories to point to the new exception page rather than a broad student list.

Do not remove existing work-center queues or daily review API. The dashboard remains a summary; the exception page is the detail surface.

- [ ] **Step 4: Run UI and browser tests**

~~~powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/AdminDash.test.jsx src/pages/admin/__tests__/AdminWorkCenter.test.jsx src/pages/admin/__tests__/ExceptionQueue.test.jsx
npm run build
cd ..
npx playwright test tests/e2e/admin-exception-center.spec.js
~~~

Expected: selected tests pass, build succeeds, and the browser test opens the exception queue from the dashboard.

- [ ] **Step 5: Commit dashboard integration**

~~~powershell
git add frontend/src/pages/admin/AdminDash.jsx frontend/src/pages/admin/dashboard/AdminOpsRail.jsx frontend/src/pages/admin/__tests__ tests/e2e/admin-exception-center.spec.js
git commit -m "feat: prioritize exceptions on admin dashboard"
~~~

### Task 5: Regression Verification

**Files:**
- No source changes unless a failing verification command identifies a concrete defect.

- [ ] **Step 1: Run backend regression**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_admin_exceptions.py tests/test_task_stats_contract.py tests/test_admissions_work_items.py tests/test_call_volume.py tests/test_admin.py -q
~~~

Expected: all selected backend tests pass.

- [ ] **Step 2: Run frontend regression**

~~~powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/AdminDash.test.jsx src/pages/admin/__tests__/AdminWorkCenter.test.jsx src/pages/admin/__tests__/ExceptionQueue.test.jsx src/__tests__/App.routes.test.jsx
npm run build
~~~

Expected: all selected tests pass and the build exits with code 0.

- [ ] **Step 3: Check stale copy and commit verified adjustments**

~~~powershell
rg -n "分配后无通话|连续未接|缺下一步|逾期回访|A 级超时" frontend/src/pages/admin app/admin_daily_ops.py
git status --short
~~~

Confirm every user-visible exception label maps to a real daily-ops key or exception endpoint. Commit only verified test/copy adjustments with:

~~~powershell
git add app frontend/src/pages/admin tests
git commit -m "test: verify admin exception center"
~~~

## Self-Review Notes

- Existing daily-ops review state is preserved; the plan only adds categories and a detail surface.
- All five required exception classes have a count, owner breakdown, detail endpoint, dashboard link, and UI test.
- Thresholds are explicit: A stale is three days, repeated no-answer is three distinct dials in seven days, and missing next action requires a recent dial with no open follow-up/work item.
