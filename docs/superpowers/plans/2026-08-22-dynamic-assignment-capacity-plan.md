# Dynamic Assignment Capacity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed per-batch assignment limits with a server-enforced, dynamically calculated release capacity that every assignment route obeys.

**Architecture:** Add one capacity service that computes each agent's recent distinct processing capacity, today's released count, unfinished backlog, and releasable amount. Keep `app/services/assignment_service.py` as the only low-level writer for `Student.assigned_to` and `StudentAssignment`; every route calls a capacity-aware orchestration wrapper before reaching that writer.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, SQLite/PostgreSQL-compatible SQL, Pydantic v2, React 18, Vitest, Testing Library, pytest.

**Spec:** `docs/superpowers/specs/2026-08-22-admissions-efficiency-design.md`

## Global Constraints

- 本计划实现规格中的统一动态分配容量规则，所有分配入口共享同一个容量服务和写入边界。
- All assignment routes use one capacity service: manual batch, school, region, smart, automatic, reassignment, handover, assistant tools, and future routes.
- Capacity uses distinct students observed through recent `DialLog.student_id` rows, not raw dial count.
- `active_unfinished_backlog` excludes students released in the current day because today's releases are counted separately.
- Unassigned overflow stays in the unassigned pool; it is not silently assigned beyond capacity.
- Normal admins cannot bypass capacity. Super-admin force assignment requires a non-empty reason and an audit record.
- The server reloads candidate students and agent capacity during execution; frontend IDs are hints and never authority.
- Existing `Student.assigned_to`, `Student.assigned_at`, `StudentAssignment`, and work-item synchronization remain the write contract.
- Existing rollback, handover, invalid-reclaim, and assistant behavior must report partial skips instead of pretending a partial batch fully succeeded.
- Keep the current `SystemConfig` key/value storage for capacity settings; do not add a second settings table.

## File Map

- Create `app/services/assignment_capacity_service.py`: settings, snapshots, candidate allocation, overflow classification, and force checks.
- Create `tests/test_assignment_capacity_service.py`: formula, deduplication, backlog, clamping, overflow, and insufficient-history tests.
- Modify `app/admin_config.py`: allow and validate capacity settings.
- Modify `app/services/assignment_service.py` and `app/domain_errors.py`: add the capacity-aware write boundary and typed errors.
- Modify `app/smart_assignment.py` and `app/routers/admin_smart_assignment.py`: dynamic smart preview and execution.
- Modify `app/routers/admin_assignment.py`, `app/routers/students_assignment.py`, `app/routers/admin_invalid.py`, `app/routers/admin_stale.py`, `app/routers/admin_users.py`, `app/routers/students.py`, `app/services/handover_service.py`, and `app/assistant_tools.py`: migrate all assignment writers.
- Create `tests/test_assignment_capacity_routes.py`; modify `tests/test_smart_assignment.py`, `tests/test_assignment_service.py`, and `tests/test_assignment_write_boundary.py`.
- Modify `frontend/src/pages/admin/SmartAssignment.jsx`, `DistributeBySchools.jsx`, `LeadsManage.jsx`, `SystemSettings.jsx`, and their existing tests.
- Create `tests/e2e/assignment-capacity.spec.js`.

### Task 1: Capacity Settings and Service Contract

**Files:**
- Create: `app/services/assignment_capacity_service.py`
- Create: `tests/test_assignment_capacity_service.py`
- Modify: `app/admin_config.py`

**Interfaces:**
- Produce `CapacitySettings(lookback_days: int, observed_days: int, min_daily_capacity: int, max_daily_capacity: int, insufficient_history_mode: str)`.
- Produce `AgentCapacitySnapshot(agent_id: int, agent_name: str, recent_distinct_students: int, observed_days: int, estimated_daily_capacity: int, today_distinct_released: int, active_unfinished_backlog: int, releasable_today: int, data_quality: str)`.
- Produce `CapacityPlan(candidate_count: int, planned_count: int, overflow_count: int, assignments_by_agent: dict[int, tuple[int, ...]], overflow_student_ids: tuple[int, ...], agents: tuple[AgentCapacitySnapshot, ...], skipped: dict[str, int])`.
- Produce `async load_capacity_settings(db: AsyncSession) -> CapacitySettings` and `async build_capacity_plan(db: AsyncSession, candidate_student_ids: Sequence[int], target_agent_ids: Sequence[int], *, at: datetime | None = None) -> CapacityPlan`.

- [ ] **Step 1: Write failing service tests**

Use fixed UTC datetimes and the existing `db` fixture. Add tests proving that duplicate `DialLog` rows for one student count once, a five-day average is clamped to configured minimum/maximum, today's assigned students are subtracted separately from older unfinished backlog, and no history uses `data_quality="insufficient_history"` plus the configured minimum.

The core assertions must be:

```python
snapshot.recent_distinct_students == 3
snapshot.estimated_daily_capacity == 150
snapshot.today_distinct_released == 2
snapshot.active_unfinished_backlog == 1
snapshot.releasable_today == 5
```

Add a candidate allocation test with 200 eligible students and one agent whose releasable capacity is 150; assert `planned_count == 150`, `overflow_count == 50`, and all 50 overflow IDs remain unassigned.

- [ ] **Step 2: Run the focused tests and verify they fail**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_capacity_service.py -q
```

Expected: collection fails because the service module and public types do not exist.

- [ ] **Step 3: Add settings validation and implement the service**

Add these keys to `ALLOWED_CONFIG_KEYS` in `app/admin_config.py`:

```python
"assignment_capacity_lookback_days",
"assignment_capacity_observed_days",
"assignment_capacity_min",
"assignment_capacity_max",
"assignment_capacity_insufficient_history",
```

Use defaults lookback `7`, observed days `5`, minimum `150`, maximum `200`, insufficient-history mode `"configured_min"`. Reject lookback/observed days outside `1..30`, capacity outside `1..5000`, and a minimum greater than the maximum.

In the service, query `DialLog` with distinct student IDs grouped by agent inside the lookback window. Query active assigned students through `ASSIGNABLE_STUDENT_STATUSES`; use `Student.assigned_at < today_start` for older backlog and `Student.assigned_at >= today_start` for today's release. Calculate:

```python
estimated_daily_capacity = clamp(
    round(recent_distinct_students / max(observed_days, 1)),
    settings.min_daily_capacity,
    settings.max_daily_capacity,
)
releasable_today = max(
    0,
    estimated_daily_capacity - today_distinct_released - active_unfinished_backlog,
)
```

Allocate candidates in stable `Student.created_at, Student.id` order, round-robin over agents with positive capacity, and return overflow IDs rather than assigning them. When history is absent or shorter than the configured observation window, use the minimum and mark the snapshot as estimated.

- [ ] **Step 4: Run service and config tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_capacity_service.py tests/test_admin.py -q
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit the capacity contract**

```powershell
git add app/services/assignment_capacity_service.py app/admin_config.py tests/test_assignment_capacity_service.py
git commit -m "feat: add dynamic assignment capacity service"
```

### Task 2: Dynamic Smart-Assignment Preview and Execution

**Files:**
- Modify: `app/smart_assignment.py`
- Modify: `app/routers/admin_smart_assignment.py`
- Modify: `tests/test_smart_assignment.py`

**Interfaces:**
- Consume `build_capacity_plan` from Task 1.
- Produce preview fields `capacity_settings`, per-agent `releasable_today`, `plan.planned`, `plan.overflow`, and `plan.per_agent`.
- Produce execution fields `batch_id`, `candidate_count`, `assigned_count`, `overflow_count`, `skipped_count`, and `partial`.

- [ ] **Step 1: Add failing smart-assignment tests**

Extend `tests/test_smart_assignment.py` with a preview request using `limit=500, per_agent_limit=1000`. Assert that planned count never exceeds the sum of agent releasable capacity and that `plan.overflow == eligible_total - plan.planned`. Add an execution test asserting:

```python
data["assigned_count"] + data["overflow_count"] + data["skipped_count"] == data["candidate_count"]
data["partial"] is True
```

- [ ] **Step 2: Run smart-assignment tests and verify the old static behavior fails**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_smart_assignment.py -q
```

Expected: the new assertions fail because the current implementation treats `per_agent_limit` as the hard capacity and has no overflow fields.

- [ ] **Step 3: Replace static planning with capacity planning**

Keep `SmartAssignParams` input parsing for compatibility, but treat `per_agent_limit` only as an optional upper bound. The dynamic snapshot is the effective limit. Add the capacity section to `_plan_payload`; do not trust frontend candidate IDs during execution.

Execution must reload the current candidate set, rebuild the plan, pass only server-produced assignments to the capacity-aware wrapper from Task 3, and write a summary log containing planned, actual, overflow, skipped, and partial values. Never return a full-success message when actual count is lower than planned.

- [ ] **Step 4: Run focused backend tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_smart_assignment.py tests/test_assignment_batch_review.py -q
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit smart preview/execution**

```powershell
git add app/smart_assignment.py app/routers/admin_smart_assignment.py tests/test_smart_assignment.py
git commit -m "feat: make smart assignment capacity-aware"
```

### Task 3: Central Capacity Enforcement for Every Assignment Writer

**Files:**
- Modify: `app/services/assignment_service.py`
- Modify: `app/domain_errors.py`
- Modify: `app/routers/admin_assignment.py`
- Modify: `app/routers/students_assignment.py`
- Modify: `app/routers/admin_invalid.py`
- Modify: `app/routers/admin_stale.py`
- Modify: `app/routers/admin_users.py`
- Modify: `app/routers/students.py`
- Modify: `app/services/handover_service.py`
- Modify: `app/assistant_tools.py`
- Create: `tests/test_assignment_capacity_routes.py`
- Modify: `tests/test_assignment_service.py`
- Modify: `tests/test_assignment_write_boundary.py`

**Interfaces:**
- Produce `async apply_assignment_with_capacity(db, targets, *, operator, reason, batch_id, at=None, mode="release", force_reason="") -> AssignmentExecutionResult`.
- Produce `AssignmentExecutionResult.assignment` (`AssignmentResult`), `.capacity` (`CapacityPlan`), and `.partial` (`bool`).
- Keep `apply_assignment_changes(...) -> AssignmentResult` as the low-level writer called only by the orchestration service and direct projection unit tests.

- [ ] **Step 1: Add failing route-enforcement tests**

Add tests proving that school distribution with 200 candidates and 150 capacity returns `assigned_count=150`, `left_unassigned_count=50), and leaves 50 students unassigned. Add a normal-admin test that a force reason returns 403, and a super-admin test that a non-empty force reason assigns the overflow and creates an operation log with action `分配容量强制执行`.

Extend `tests/test_assignment_write_boundary.py` with an AST assertion that no file under `app/routers` imports or calls `apply_assignment_changes` directly; only `assignment_service.py` may call the low-level writer.

- [ ] **Step 2: Run route tests and verify they fail**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_capacity_routes.py tests/test_assignment_write_boundary.py -q
```

Expected: current school/manual routes assign the whole candidate set and direct low-level calls remain in routers.

- [ ] **Step 3: Implement the wrapper and force authorization**

Add typed `AssignmentCapacityExceeded` and `AssignmentForceForbidden` errors. Classify targets as `release`, `transfer`, `unassign`, `handover), or `rollback`. Capacity-check release, transfer, handover, and rollback; allow unassign without consuming capacity. If overflow exists, trim the target list for normal admins and return overflow. Accept force only when `operator.is_super_admin` is true and `force_reason.strip()` is non-empty. Reject the request before any write otherwise.

The wrapper calls the existing low-level writer with the allowed subset, preserves per-student logs and work-item synchronization, and writes one summary log containing mode, requested, actual, overflow, skipped, forced, partial, and reason values.

- [ ] **Step 4: Migrate every assignment caller**

Update `admin_assignment.py` (school distribution and rollback), `students_assignment.py` (direct, automatic, region, school), `admin_invalid.py` (reclaim/restore), `admin_stale.py` (stale reassignment), `admin_users.py` (offboarding), `students.py` (student reassignment), `handover_service.py` (handover mode), and `assistant_tools.py` (assign and school tools). Preserve their candidate filters, but route the final target list through the wrapper.

Every response keeps old fields such as `total_assigned` and adds `assigned_count`, `left_unassigned_count`, `skipped_count`, `forced_count`, `partial`, and `batch_id`.

- [ ] **Step 5: Run assignment regression tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_capacity_service.py tests/test_assignment_capacity_routes.py tests/test_assignment_service.py tests/test_assignment_write_boundary.py tests/test_smart_assignment.py tests/test_handover_service.py tests/test_admin_handover.py -q
```

Expected: all selected tests pass, including existing projection/history/work-item tests.

- [ ] **Step 6: Commit central enforcement**

```powershell
git add app/domain_errors.py app/services/assignment_service.py app/routers app/assistant_tools.py tests/test_assignment_capacity_routes.py tests/test_assignment_service.py tests/test_assignment_write_boundary.py
git commit -m "feat: enforce assignment capacity across all routes"
```

### Task 4: Capacity-Aware Admin UI and Settings

**Files:**
- Modify: `frontend/src/pages/admin/SmartAssignment.jsx`
- Modify: `frontend/src/pages/admin/DistributeBySchools.jsx`
- Modify: `frontend/src/pages/admin/LeadsManage.jsx`
- Modify: `frontend/src/pages/admin/SystemSettings.jsx`
- Modify: existing tests under `frontend/src/pages/admin/__tests__`

**Interfaces:**
- Consume the API fields from Tasks 2 and 3.
- Produce preview, partial execution, retained-pool, next-wave, and super-admin force-reason states.

- [ ] **Step 1: Add failing UI assertions**

Extend existing tests with:

```jsx
expect(screen.getByText("今日可释放")).toBeInTheDocument();
expect(screen.getByText("留在未分配池")).toBeInTheDocument();
expect(screen.getByText("本次释放 150 条，剩余 50 条等待下一波")).toBeInTheDocument();
expect(screen.queryByRole("button", { name: "强制分配" })).not.toBeInTheDocument();
```

In the super-admin case, click `强制分配`, require a non-empty reason, and assert that `force_reason` is sent. In the settings test, assert that min/max/lookback values load and save through `/admin/config`.

- [ ] **Step 2: Run focused frontend tests and verify they fail**

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx src/pages/admin/__tests__/DistributeBySchools.test.jsx src/pages/admin/__tests__/LeadsManage.test.jsx src/pages/admin/__tests__/SystemSettings.test.jsx
```

Expected: failures show missing capacity metrics, overflow copy, and settings controls.

- [ ] **Step 3: Implement dynamic preview and release-wave UI**

In `SmartAssignment.jsx`, display each agent's estimated daily capacity, today's released count, unfinished backlog, releasable amount, and data-quality marker. Keep the old per-agent input only as a compatibility upper bound, never as the displayed business capacity.

In `DistributeBySchools.jsx` and `LeadsManage.jsx`, show actual assigned count and retained-pool count. Partial results link back to the unassigned filter and offer `刷新容量后再释放`. Disable double-click execution while a batch runs.

Show a force control only to super-admins and only when preview reports overflow. Confirmation requires a reason. Normal admins see the overflow and next-wave action but no force control.

- [ ] **Step 4: Add settings controls**

Add a `分配容量` section to `SystemSettings.jsx` with numeric inputs for lookback days, observed days, minimum, and maximum. Save through the existing config endpoint, preserve unrelated masked secrets, and display server validation errors without replacing unsaved fields. Keep the administrator AI assistant section unchanged.

- [ ] **Step 5: Run frontend tests and build**

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx src/pages/admin/__tests__/DistributeBySchools.test.jsx src/pages/admin/__tests__/LeadsManage.test.jsx src/pages/admin/__tests__/SystemSettings.test.jsx
npm run build
```

Expected: all selected tests pass and Vite exits with code 0.

- [ ] **Step 6: Commit the capacity UI**

```powershell
git add frontend/src/pages/admin frontend/src/pages/admin/__tests__
git commit -m "feat: show dynamic assignment capacity and release waves"
```

### Task 5: End-to-End Verification

**Files:**
- Create: `tests/e2e/assignment-capacity.spec.js`

**Interfaces:**
- Consume all API/UI contracts above.
- Produce browser evidence for a capped preview, partial execution, and retained pool.

- [ ] **Step 1: Add the browser smoke test**

Mock preview with two agents whose combined `releasable_today` is 150, `eligible_total` is 200, and `overflow` is 50. Mock execution with `assigned_count: 150`, `overflow_count: 50`, `skipped_count: 0`, and `partial: true`. Navigate to `/admin/smart-assign`, assert both capacity rows, execute, and assert `留在未分配池 50 条`.

- [ ] **Step 2: Run complete targeted verification**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_capacity_service.py tests/test_assignment_capacity_routes.py tests/test_assignment_service.py tests/test_smart_assignment.py -q
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx src/pages/admin/__tests__/DistributeBySchools.test.jsx src/pages/admin/__tests__/LeadsManage.test.jsx
npm run build
cd ..
npx playwright test tests/e2e/assignment-capacity.spec.js
```

Expected: backend and frontend tests pass, the build succeeds, and Playwright reports one passing test.

- [ ] **Step 3: Commit the smoke test**

```powershell
git add tests/e2e/assignment-capacity.spec.js
git commit -m "test: cover dynamic assignment capacity flow"
```

## Self-Review Notes

- Coverage includes formula, deduplication, backlog subtraction, min/max clamping, insufficient history, preview/execution races, every known assignment caller, normal-admin denial, super-admin force audit, retained pool, settings, and browser verification.
- The low-level projection writer remains isolated so existing history and work-item tests continue to verify it independently.
- No new assignment table is introduced; capacity parameters use existing `SystemConfig`, and batch IDs remain the audit/rollback linkage.
