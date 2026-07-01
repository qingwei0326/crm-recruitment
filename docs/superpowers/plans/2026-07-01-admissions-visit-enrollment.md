# Admissions Visit Enrollment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the home visit, campus visit, enrollment attribution, and settlement workflow described in `docs/superpowers/specs/2026-07-01-admissions-visit-enrollment-design.md`.

**Architecture:** Add three focused backend resources: home visit tasks, campus visit tasks, and enrollment records. Each resource has its own SQLAlchemy model, schema, router, and API tests; frontend pages consume those APIs with small forms from the agent student detail and admin task pages.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, SQLite/PostgreSQL-compatible startup migrations, pytest/httpx, React/Vite/Tailwind, Vitest, Playwright.

## Global Constraints

- Every implementation step must be followed by the verification command listed in that task.
- Do not revert or overwrite unrelated existing worktree changes.
- Current settlement recognizes exactly one final attributed agent per enrollment.
- Campus visit result entry is admin-only.
- Agents may create campus visit appointments; admins may process all appointments.
- Enrollment records are settlement evidence and must not change when a student is later reassigned.
- Existing `Visit` rows remain supported; new workflow data goes into dedicated tables.

---

### Task 1: Backend Models, Schemas, Router Skeleton, and Migration

**Files:**
- Modify: `app/models.py`
- Modify: `app/schemas.py`
- Modify: `app/database.py`
- Create: `app/routers/admissions.py`
- Modify: `app/main.py`
- Test: `tests/test_admissions.py`

**Interfaces:**
- Produces SQLAlchemy models: `HomeVisitTask`, `CampusVisitTask`, `EnrollmentRecord`.
- Produces enums: `HomeVisitStatus`, `HomeVisitResult`, `CampusVisitStatus`, `CampusVisitResult`, `EnrollmentSource`, `AttributionMethod`, `SettlementStatus`.
- Produces router mounted at `/api/admissions`.
- Produces list endpoints:
  - `GET /api/admissions/home-visits`
  - `GET /api/admissions/campus-visits`
  - `GET /api/admissions/enrollments`

- [ ] **Step 1: Write failing model/API tests**

Create `tests/test_admissions.py` with tests that import the new models and assert the empty list endpoints exist.

Run: `pytest tests/test_admissions.py -q`

Expected: FAIL because the models/router do not exist.

- [ ] **Step 2: Add models and enums**

Add the new enum classes and SQLAlchemy models to `app/models.py`, with relationships to `Student` and `User`.

- [ ] **Step 3: Add schema classes**

Add Pydantic request/response models to `app/schemas.py` for list payloads and future create/update bodies.

- [ ] **Step 4: Add startup migration helper**

Add `_migrate_admissions_workflow_tables()` to `app/database.py` and call it from `init_db()` after `Base.metadata.create_all`. The helper must create indexes that `create_all` does not add to older existing SQLite databases, and it must be no-op when tables already exist.

- [ ] **Step 5: Add router skeleton**

Create `app/routers/admissions.py` with authenticated list endpoints returning paginated empty/list data. Mount it in `app/main.py`.

- [ ] **Step 6: Verify Task 1**

Run: `pytest tests/test_admissions.py -q`

Expected: PASS.

Run: `pytest tests/test_config.py tests/test_students.py -q`

Expected: PASS.

### Task 2: Home Visit Create, Admin Processing, and Permission Rules

**Files:**
- Modify: `app/routers/admissions.py`
- Modify: `app/schemas.py`
- Test: `tests/test_admissions.py`

**Interfaces:**
- Produces `POST /api/admissions/home-visits`.
- Produces `PATCH /api/admissions/home-visits/{task_id}` for admin status/result processing and limited agent edits.
- On create, student stage should move to existing `预约参观` as the compatible representation of pending visit work.

- [ ] **Step 1: Add failing tests**

Add tests for:
- Agent can create a home visit for an assigned student.
- Admin can list and update all home visits.
- Agent cannot create a home visit for another agent's student.
- Agent cannot fill the final home visit result.

Run: `pytest tests/test_admissions.py -q`

Expected: FAIL because create/update are not implemented.

- [ ] **Step 2: Implement home visit creation**

Validate student access with `get_accessible_student`. Persist the student snapshot fields, request fields, creator agent, and initial `待确认` status. Write an operation log action `申请家访`.

- [ ] **Step 3: Implement home visit update**

Allow admins to set status, scheduled time, assignee, result fields, next follow-up time, and notes. Allow the creating agent to update only request notes/address/time while status is not terminal. Write operation logs for status/result changes.

- [ ] **Step 4: Verify Task 2**

Run: `pytest tests/test_admissions.py -q`

Expected: PASS.

Run: `pytest tests/test_admin.py tests/test_students.py -q`

Expected: PASS.

### Task 3: Campus Visit Appointment and Admin-Only Result

**Files:**
- Modify: `app/routers/admissions.py`
- Modify: `app/schemas.py`
- Test: `tests/test_admissions.py`

**Interfaces:**
- Produces `POST /api/admissions/campus-visits`.
- Produces `PATCH /api/admissions/campus-visits/{task_id}`.
- Enforces one open campus visit per student.
- Admin-only fields include result status, reception details, and onsite enrollment decision.

- [ ] **Step 1: Add failing tests**

Add tests for:
- Agent can create a campus visit for an assigned student.
- Duplicate open campus visit for the same student is rejected.
- Agent cannot fill campus result fields.
- Admin can mark a campus visit as `已到校`.

Run: `pytest tests/test_admissions.py -q`

Expected: FAIL.

- [ ] **Step 2: Implement campus visit creation**

Validate student access. Allow creation from agent direct call, home visit, or admin supplemental source. Persist snapshot fields and set initial status to `已预约` when appointment time is present.

- [ ] **Step 3: Implement campus visit update**

Allow admins to modify all fields and result fields. Allow creator agents to modify appointment time, people count, need pickup, concerns, and notes only while open. Reject result updates from agents.

- [ ] **Step 4: Verify Task 3**

Run: `pytest tests/test_admissions.py -q`

Expected: PASS.

Run: `pytest tests/test_admin.py tests/test_edge_cases.py -q`

Expected: PASS.

### Task 4: Enrollment Records, Attribution Rules, and Settlement API

**Files:**
- Modify: `app/routers/admissions.py`
- Modify: `app/schemas.py`
- Test: `tests/test_admissions.py`

**Interfaces:**
- Produces `POST /api/admissions/enrollments`.
- Produces `PATCH /api/admissions/enrollments/{record_id}` for settlement status and manual attribution changes.
- Produces `GET /api/admissions/enrollments/summary`.
- Attribution priority:
  1. Campus visit appointment creator.
  2. Home visit creator.
  3. Student current assigned agent.
  4. Required admin manual selection.

- [ ] **Step 1: Add failing tests**

Add tests for:
- Enrollment from campus visit attributes to campus appointment creator.
- Enrollment from home visit attributes to home visit creator.
- Direct admin enrollment attributes to current assigned agent.
- Reassigning the student later does not change enrollment attribution.
- Manual attribution change requires a reason.
- Settlement summary groups by attributed agent.

Run: `pytest tests/test_admissions.py -q`

Expected: FAIL.

- [ ] **Step 2: Implement enrollment creation**

Admins create enrollment records. Resolve attributed agent by source priority unless `attributed_agent_id` is provided. Snapshot student fields. Mark student `已报名`, stage `已报名`, and enrollment date.

- [ ] **Step 3: Implement settlement updates**

Allow admins to set settlement status and notes. Allow attributed agent override only with `attribution_reason`. Write operation logs for enrollment and attribution changes.

- [ ] **Step 4: Implement summary**

Aggregate enrollments by attributed agent and settlement status for report usage.

- [ ] **Step 5: Verify Task 4**

Run: `pytest tests/test_admissions.py -q`

Expected: PASS.

Run: `pytest tests/test_admin.py tests/test_students.py tests/test_task_stats_contract.py -q`

Expected: PASS.

### Task 5: Student Timeline Aggregation

**Files:**
- Modify: `app/routers/students.py`
- Test: `tests/test_admissions.py`

**Interfaces:**
- Existing student detail response should include `admissions_timeline` or a dedicated endpoint under `/api/students/{id}/timeline`.
- Timeline entries include home visit, campus visit, and enrollment events.

- [ ] **Step 1: Add failing tests**

Add tests that create one home visit, one campus visit, and one enrollment, then assert the student timeline returns all three event types.

Run: `pytest tests/test_admissions.py -q`

Expected: FAIL.

- [ ] **Step 2: Implement timeline aggregation**

Add a focused helper in `students.py` that queries the new tables for the student and returns ordered timeline entries without affecting existing call/note/follow-up behavior.

- [ ] **Step 3: Verify Task 5**

Run: `pytest tests/test_admissions.py -q`

Expected: PASS.

Run: `pytest tests/test_students.py -q`

Expected: PASS.

### Task 6: Agent Frontend Actions

**Files:**
- Modify: `frontend/src/pages/agent/AgentWork.jsx`
- Modify: `frontend/src/pages/agent/AgentWorkMobile.jsx`
- Modify: `frontend/src/pages/agent/desktop/HandledView.jsx`
- Create: `frontend/src/components/admissions/HomeVisitForm.jsx`
- Create: `frontend/src/components/admissions/CampusVisitForm.jsx`
- Test: focused Vitest files under existing `frontend/src/pages/agent/.../__tests__`

**Interfaces:**
- Agent student detail exposes “申请家访” and “预约到校”.
- Forms POST to `/api/admissions/home-visits` and `/api/admissions/campus-visits`.

- [ ] **Step 1: Add failing frontend tests**

Add tests that render agent detail/actions and assert the two action buttons submit the expected API calls.

Run: `cd frontend; npm test -- --runInBand`

Expected: FAIL for missing UI.

- [ ] **Step 2: Implement reusable forms**

Create focused form components with accessible labels and compact fields for the design-required data.

- [ ] **Step 3: Wire desktop and mobile agent actions**

Add buttons and modal/drawer behavior in the existing agent detail surfaces.

- [ ] **Step 4: Verify Task 6**

Run: `cd frontend; npm test -- --runInBand`

Expected: PASS.

Run: `cd frontend; npm run build`

Expected: PASS.

### Task 7: Admin Frontend Task Pages and Settlement Report

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/AdminSidebar.jsx`
- Create: `frontend/src/pages/admin/HomeVisitManage.jsx`
- Create: `frontend/src/pages/admin/CampusVisitManage.jsx`
- Create: `frontend/src/pages/admin/EnrollmentSettlement.jsx`
- Modify: `frontend/src/pages/admin/ReportCenter.jsx`
- Test: focused Vitest admin route tests

**Interfaces:**
- Admin can access home visits, campus visits, and enrollment settlement from navigation.
- Admin can process home visit results and campus visit results.
- Settlement report displays totals grouped by attributed agent.

- [ ] **Step 1: Add failing admin frontend tests**

Add route/navigation tests for the three new admin pages and an API-driven rendering test for settlement rows.

Run: `cd frontend; npm test -- --runInBand`

Expected: FAIL.

- [ ] **Step 2: Implement admin pages**

Build compact table views with filters for status, region, agent, and date. Add inline action forms for admin processing.

- [ ] **Step 3: Wire routes and navigation**

Add routes and sidebar entries consistent with existing admin navigation.

- [ ] **Step 4: Verify Task 7**

Run: `cd frontend; npm test -- --runInBand`

Expected: PASS.

Run: `cd frontend; npm run build`

Expected: PASS.

### Task 8: Full Backend, Frontend, and Playwright Verification

**Files:**
- Modify or create Playwright specs under `tests/e2e` only if existing coverage cannot drive the workflow.

**Interfaces:**
- Full flow must verify admin and agent roles:
  1. Agent creates home visit.
  2. Admin processes home visit and creates/links campus visit.
  3. Agent directly creates another campus visit.
  4. Admin fills campus result and creates enrollment.
  5. Settlement report attributes enrollment to the expected agent.

- [ ] **Step 1: Run backend tests**

Run: `pytest -q`

Expected: PASS.

- [ ] **Step 2: Run frontend tests**

Run: `cd frontend; npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 3: Build frontend**

Run: `cd frontend; npm run build`

Expected: PASS.

- [ ] **Step 4: Start the local app**

Run the existing project start path or a dev server pair. Confirm `/api/health` returns `{"code":0,...}`.

- [ ] **Step 5: Run Playwright full-role flow**

Run the relevant Playwright spec with `RUN_E2E=1`.

Expected: PASS and screenshots/traces show both roles can complete the workflow.

- [ ] **Step 6: Final status audit**

Check `git status --short`, summarize changed files, and do not claim completion unless every verification above passed.
