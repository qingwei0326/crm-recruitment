# 领域服务与兼容双写 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make assignment, employment, work-item, outcome, and handover services the only cross-table write paths while preserving existing API response shapes and legacy projections.

**Architecture:** New services own transactions but never call `commit`; routers validate permissions, call one service, and commit once. Existing fields remain synchronized projections, and a consistency auditor blocks read cutover until new and old models agree.

**Tech Stack:** FastAPI, SQLAlchemy 2 async ORM, Pydantic 2, pytest-asyncio, SQLite, existing OperationLog audit model.

## Global Constraints

- Requires phase 1 database revision `20260711_03` and a passing domain audit.
- Follow the approved spec at `docs/superpowers/specs/2026-07-10-agent-lifecycle-assignment-work-items-redesign.md`.
- Services flush but do not commit; the outer router owns the single transaction commit.
- Do not rewrite historical `Call.agent_id`, `Note.agent_id`, `FollowUp.agent_id`, visit creators, or enrollment attribution.
- Only `assignment_service` may mutate `Student.assigned_to` or `Student.assigned_at` after this phase.
- Only `employment_service` may mutate `User.is_active` for suspend/resume/offboarding after this phase.
- Open work items must have an active owner; suspended and handover items use their matching blocked states.
- Old API paths and response fields stay available.
- Do not deploy this phase to production unless the safe legacy offboard adapter in Task 6 is enabled.
- Use `.venv-win\Scripts\python.exe` for backend tests.
- Preserve unrelated dirty worktree changes.

---

## File Structure

- Create `app/services/__init__.py`.
- Create `app/services/assignment_service.py`.
- Create `app/services/employment_service.py`.
- Create `app/services/work_item_service.py`.
- Create `app/services/lead_outcome_service.py`.
- Create `app/services/handover_service.py`.
- Create `app/domain_errors.py`.
- Create `app/routers/admin_handover.py`.
- Create `app/routers/lead_outcomes.py`.
- Modify all assignment-writing routers listed in Task 2.
- Modify `app/routers/admin_users.py`, `follow_ups.py`, `admissions_home_visits.py`, `admissions_campus_visits.py`, `admissions_enrollments.py`, `students.py`, `students_enrollment.py`, and `admin_invalid.py`.
- Modify `app/main.py` to register new routers.
- Create focused service/API tests and a write-boundary guard test.

---

### Task 1: Assignment Service and Projection Invariants

**Files:**
- Create: `app/services/__init__.py`
- Create: `app/domain_errors.py`
- Create: `app/services/assignment_service.py`
- Create: `tests/test_assignment_service.py`

**Interfaces:**
- Produces `AssignmentTarget(student_id: int, agent_id: int | None)`.
- Produces `AssignmentResult(changed_ids: tuple[int, ...], unchanged_ids: tuple[int, ...])`.
- Produces `async apply_assignment_changes(db, targets, operator, reason, batch_id, at=None, handover_batch_id=None) -> AssignmentResult`.

- [ ] **Step 1: Write failing assignment tests**

Create `tests/test_assignment_service.py` with tests that:

```python
result = await apply_assignment_changes(
    db,
    [AssignmentTarget(student_id=student.id, agent_id=target.id)],
    operator=admin_user,
    reason="manual_assignment",
    batch_id="assign-test-1",
    at=datetime(2026, 7, 11, 1, 0, 0),
)
assert result.changed_ids == (student.id,)
await db.refresh(student)
assert student.assigned_to == target.id
assert student.assigned_at == datetime(2026, 7, 11, 1, 0, 0)

rows = (await db.execute(
    select(StudentAssignment).where(StudentAssignment.student_id == student.id)
)).scalars().all()
assert len(rows) == 2
assert rows[0].ended_at == datetime(2026, 7, 11, 1, 0, 0)
assert rows[1].agent_id == target.id
assert rows[1].previous_assignment_id == rows[0].id
```

Also cover unassignment, unchanged target, inactive target rejection, duplicate active assignment protection, missing student, operation-log batch ID, and no internal commit by rolling back the fixture session.

- [ ] **Step 2: Confirm missing service failure**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_service.py -q
```

Expected: import failure for `app.services.assignment_service`.

- [ ] **Step 3: Define stable domain errors**

Create `app/domain_errors.py`:

```python
class DomainError(Exception):
    code = "domain_error"
    http_status = 422

    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


class DomainConflict(DomainError):
    code = "version_conflict"
    http_status = 409


class InactiveAssignmentTarget(DomainError):
    code = "inactive_assignment_target"


class StudentNotFound(DomainError):
    code = "student_not_found"
```

- [ ] **Step 4: Implement the assignment service**

Use these exact public types:

```python
@dataclass(frozen=True)
class AssignmentTarget:
    student_id: int
    agent_id: int | None


@dataclass(frozen=True)
class AssignmentResult:
    changed_ids: tuple[int, ...]
    unchanged_ids: tuple[int, ...]


async def apply_assignment_changes(
    db: AsyncSession,
    targets: Sequence[AssignmentTarget],
    *,
    operator: User,
    reason: str,
    batch_id: str,
    at: datetime | None = None,
    handover_batch_id: int | None = None,
) -> AssignmentResult:
    requested: dict[int, int | None] = {}
    for target in targets:
        existing = requested.get(target.student_id)
        if target.student_id in requested and existing != target.agent_id:
            raise DomainConflict(f"学生 {target.student_id} 出现多个目标负责人")
        requested[target.student_id] = target.agent_id
    if not requested:
        return AssignmentResult((), ())

    now = at or utcnow()
    student_rows = await db.execute(
        select(Student).where(Student.id.in_(sorted(requested)))
    )
    students = {student.id: student for student in student_rows.scalars().all()}
    missing = sorted(set(requested) - set(students))
    if missing:
        raise StudentNotFound(f"学生不存在: {missing}")

    target_ids = sorted({agent_id for agent_id in requested.values() if agent_id is not None})
    if target_ids:
        target_rows = await db.execute(
            select(User, AgentEmployment)
            .join(AgentEmployment, AgentEmployment.user_id == User.id)
            .where(User.id.in_(target_ids))
        )
        valid_targets = {
            user.id
            for user, employment in target_rows.all()
            if user.role == UserRole.agent and employment.status == EmploymentStatus.active
        }
        invalid = sorted(set(target_ids) - valid_targets)
        if invalid:
            raise InactiveAssignmentTarget(f"目标员工不可接收学生: {invalid}")

    assignment_rows = await db.execute(
        select(StudentAssignment).where(
            StudentAssignment.student_id.in_(sorted(requested)),
            StudentAssignment.ended_at.is_(None),
        )
    )
    active_by_student = {
        assignment.student_id: assignment
        for assignment in assignment_rows.scalars().all()
    }
    changed: list[int] = []
    unchanged: list[int] = []
    for student_id in sorted(requested):
        student = students[student_id]
        current = active_by_student.get(student_id)
        current_agent_id = current.agent_id if current else None
        if current_agent_id != student.assigned_to:
            raise DomainConflict(f"学生 {student_id} 的归属投影不一致")
        target_agent_id = requested[student_id]
        if current_agent_id == target_agent_id:
            unchanged.append(student_id)
            continue
        if current is not None:
            current.ended_at = now
            current.end_reason = reason
            current.ended_by = operator.id
        if target_agent_id is not None:
            db.add(
                StudentAssignment(
                    student_id=student_id,
                    agent_id=target_agent_id,
                    started_at=now,
                    start_reason=reason,
                    started_by=operator.id,
                    handover_batch_id=handover_batch_id,
                    previous_assignment_id=current.id if current else None,
                )
            )
        student.assigned_to = target_agent_id
        student.assigned_at = now if target_agent_id is not None else None
        db.add(
            make_operation_log(
                operator,
                student.id,
                student.case_no or "",
                "修改归属",
                content=f"{current_agent_id or '未分配'} -> {target_agent_id or '未分配'}",
                old_status=assignment_state_label(current_agent_id),
                new_status=assignment_state_label(target_agent_id),
                batch_id=batch_id,
            )
        )
        changed.append(student_id)
    await db.flush()
    return AssignmentResult(tuple(changed), tuple(unchanged))
```

Implementation requirements:

- Deduplicate by `student_id`; reject one student mapped to multiple targets.
- Load students, target users/employment rows, and active assignments in three set-based queries.
- Reject missing students and non-active targets before mutation.
- For changed students, close the old assignment, create the new assignment if non-null, update the legacy projection, and add one `OperationLog` with `batch_id`.
- Use `utcnow()` only when `at` is absent.
- `await db.flush()` once after changes; never commit.
- Return IDs sorted ascending for deterministic tests.

- [ ] **Step 5: Run tests and lint**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_service.py -q
.venv-win\Scripts\python.exe -m ruff check app/services app/domain_errors.py tests/test_assignment_service.py
```

Expected: all tests pass and Ruff is clean.

- [ ] **Step 6: Commit**

```powershell
git add app/services app/domain_errors.py tests/test_assignment_service.py
git commit -m "feat: centralize student assignment writes"
```

---

### Task 2: Route Every Existing Assignment Through the Service

**Files:**
- Modify: `app/routers/students.py`
- Modify: `app/routers/students_assignment.py`
- Modify: `app/routers/admin_assignment.py`
- Modify: `app/routers/admin_smart_assignment.py`
- Modify: `app/routers/admin_invalid.py`
- Modify: `app/routers/admin_stale.py`
- Modify: `app/routers/admin_users.py`
- Modify: `app/routers/admissions_home_visits.py`
- Modify: `app/routers/admissions_campus_visits.py`
- Create: `tests/test_assignment_write_boundary.py`
- Modify: existing assignment/admin/student tests.

**Interfaces:**
- Consumes `apply_assignment_changes` from Task 1.
- Produces no direct router mutation of `Student.assigned_to` or `assigned_at`.

- [ ] **Step 1: Write the boundary guard**

Create `tests/test_assignment_write_boundary.py` using Python AST. It scans `app/routers/*.py` and fails on:

- assignment to an attribute named `assigned_to` or `assigned_at`;
- `update(Student).values` containing either projection keyword;
- any `setattr` call whose second argument is `"assigned_to"` or `"assigned_at"`.

Allow no router exceptions. Student creation must flush the new student first and call the service when an initial owner is requested.

- [ ] **Step 2: Confirm the guard reports current writers**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_write_boundary.py -q
```

Expected: failure lists at least `students_assignment.py`, `admin_assignment.py`, `admin_smart_assignment.py`, `admin_invalid.py`, `admin_stale.py`, and `admin_users.py`.

- [ ] **Step 3: Replace each mutation family**

For every existing assignment batch, preserve its current target calculation and audit `batch_id`, then call once:

```python
await apply_assignment_changes(
    db,
    [AssignmentTarget(student_id=s.id, agent_id=target_by_id[s.id]) for s in students],
    operator=current_user,
    reason="school_assignment",  # use a stable per-endpoint code
    batch_id=batch_id,
    at=now,
)
```

Use these stable reason codes: `student_create`, `student_edit`, `manual_assignment`, `auto_assignment`, `region_assignment`, `school_assignment`, `smart_assignment`, `invalid_reclaim`, `stale_reassign`, `stale_recycle`, `terminal_unassign`, `user_delete`.

Do not duplicate the service's per-student assignment log. Keep existing summary logs only.

- [ ] **Step 4: Preserve endpoint contracts with focused tests**

Extend existing tests to assert each endpoint still returns its current payload plus that a matching `StudentAssignment` row exists. Include assignment rollback: rollback must call `assignment_service` with reason `assignment_rollback` instead of directly updating students.

- [ ] **Step 5: Run assignment regression suite**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_write_boundary.py tests/test_admin.py tests/test_students.py tests/test_smart_assignment.py tests/test_assignment_batch_review.py -q
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit**

```powershell
git add app/routers/students.py app/routers/students_assignment.py app/routers/admin_assignment.py app/routers/admin_smart_assignment.py app/routers/admin_invalid.py app/routers/admin_stale.py app/routers/admin_users.py app/routers/admissions_home_visits.py app/routers/admissions_campus_visits.py tests/test_assignment_write_boundary.py tests/test_admin.py tests/test_students.py tests/test_smart_assignment.py tests/test_assignment_batch_review.py
git commit -m "refactor: route assignments through domain service"
```

---

### Task 3: Employment Service for Suspend and Resume

**Files:**
- Create: `app/services/employment_service.py`
- Modify: `app/routers/admin_users.py`
- Create: `tests/test_employment_service.py`
- Modify: `frontend/src/pages/admin/agentManageUtils.js` only in phase 3, not here.

**Interfaces:**
- Produces `async set_employment_status(db, user, status, operator, reason, expected_version=None, handover_batch_id=None) -> AgentEmployment`.
- Produces user payload fields `employment_status`, `employment_version`, and `employment_status_changed_at`.

- [ ] **Step 1: Write failing suspend/resume tests**

Assert suspend sets employment to `suspended`, `User.is_active=False`, increments token version once, and moves open work items to `blocked_suspension`. Resume reverses these projections and work-item states. Assert a stale `expected_version` raises `DomainConflict` and no rows change.

- [ ] **Step 2: Implement `set_employment_status`**

Exact contract:

```python
async def set_employment_status(
    db: AsyncSession,
    user: User,
    status: EmploymentStatus,
    *,
    operator: User,
    reason: str,
    expected_version: int | None = None,
    handover_batch_id: int | None = None,
    at: datetime | None = None,
) -> AgentEmployment:
    now = at or utcnow()
    row = await db.execute(
        select(AgentEmployment)
        .where(AgentEmployment.user_id == user.id)
        .with_for_update()
    )
    employment = row.scalar_one()
    if expected_version is not None and employment.version != expected_version:
        raise DomainConflict("员工状态已变化，请刷新后重试")
    if employment.status == status:
        return employment
    allowed = {
        EmploymentStatus.active: {
            EmploymentStatus.suspended,
            EmploymentStatus.handover_pending,
        },
        EmploymentStatus.suspended: {
            EmploymentStatus.active,
            EmploymentStatus.handover_pending,
        },
        EmploymentStatus.handover_pending: {EmploymentStatus.offboarded},
        EmploymentStatus.offboarded: set(),
    }
    if status not in allowed[employment.status]:
        raise DomainConflict(f"不允许的员工状态变化: {employment.status} -> {status}")

    previous = employment.status
    employment.status = status
    employment.version += 1
    employment.status_changed_at = now
    employment.updated_by = operator.id
    if status == EmploymentStatus.handover_pending:
        employment.offboarding_started_at = now
    if status == EmploymentStatus.offboarded:
        employment.offboarded_at = now

    if previous == EmploymentStatus.active and status != EmploymentStatus.active:
        user.is_active = False
        invalidate_user_tokens(user)
    elif status == EmploymentStatus.active:
        user.is_active = True
    if status == EmploymentStatus.suspended:
        await db.execute(
            update(WorkItem)
            .where(
                WorkItem.owner_agent_id == user.id,
                WorkItem.status == WorkItemStatus.open,
            )
            .values(status=WorkItemStatus.blocked_suspension, updated_at=now)
        )
    elif previous == EmploymentStatus.suspended and status == EmploymentStatus.active:
        await db.execute(
            update(WorkItem)
            .where(
                WorkItem.owner_agent_id == user.id,
                WorkItem.status == WorkItemStatus.blocked_suspension,
            )
            .values(status=WorkItemStatus.open, updated_at=now)
        )
    db.add(
        AgentEmploymentEvent(
            user_id=user.id,
            from_status=previous,
            to_status=status,
            reason=reason,
            operator_id=operator.id,
            handover_batch_id=handover_batch_id,
            created_at=now,
        )
    )
    await db.flush()
    return employment
```

- Only active-to-suspended and suspended-to-active transitions are permitted through the normal user-edit endpoint.
- `handover_pending` and `offboarded` require the handover service.
- Changing away from active invalidates tokens exactly once.
- Every change appends `AgentEmploymentEvent`.
- The function flushes but does not commit.

- [ ] **Step 3: Replace `UserUpdateReq.is_active` mutation**

Keep the request field for compatibility. Map `true -> active` and `false -> suspended`; add the employment fields to `/admin/users` and `/admin/agents` payloads.

- [ ] **Step 4: Run tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_employment_service.py tests/test_admin.py tests/test_token_revocation.py -q
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/services/employment_service.py app/routers/admin_users.py tests/test_employment_service.py tests/test_admin.py tests/test_token_revocation.py
git commit -m "feat: model employee suspension lifecycle"
```

---

### Task 4: Unified Work-Item Synchronization and Dual Write

**Files:**
- Create: `app/services/work_item_service.py`
- Modify: `app/routers/students.py`
- Modify: `app/routers/students_enrollment.py`
- Modify: `app/routers/follow_ups.py`
- Modify: `app/routers/admissions_home_visits.py`
- Modify: `app/routers/admissions_campus_visits.py`
- Modify: `app/routers/admissions_enrollments.py`
- Create: `tests/test_work_item_service.py`
- Modify: admissions/follow-up/student tests.

**Interfaces:**
- Produces `async sync_student_work_items(db, student, actor, at=None) -> tuple[WorkItem, ...]`.
- Produces `async sync_source_work_item(db, kind, source_type, source_id, student, creator_user_id, due_at, completed, actor) -> WorkItem`.
- Produces `async transfer_open_work_items(db, student_ids, target_agent_id, from_status, to_status, handover_batch_id=None) -> int`.

- [ ] **Step 1: Write failing lifecycle tests**

Cover these transitions:

- assigned nonterminal student creates one `lead_contact` work item;
- terminal student completes the lead item;
- open follow-up creates/updates `scheduled_follow_up`, completion closes it;
- pending home/campus visit creates an open item, terminal status closes it;
- enrollment settlement and help request create their kinds;
- repeated sync returns the same item ID;
- creator stays unchanged when owner changes.

- [ ] **Step 2: Implement the service with stable source keys**

Use the source keys from the migration plan. `sync_source_work_item` queries by the unique `(kind, source_type, source_id)` tuple, mutates only current-state fields, and never overwrites `creator_user_id` after creation.

`sync_student_work_items` calls the lead/help synchronizers after status, assignment, stage, or `need_help` changes. Terminal status means canonical enrolled or invalid.

- [ ] **Step 3: Add dual writes at source transaction boundaries**

Call synchronization before the existing router commit in each source create/update/complete/delete path. Do not add a second commit. Follow-up deletion cancels its work item; reopening a source reopens the same item.

- [ ] **Step 4: Run focused regression tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_work_item_service.py tests/test_task_stats_contract.py tests/test_edge_cases.py tests/test_admissions.py tests/test_admissions_work_items.py tests/test_students.py -q
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/services/work_item_service.py app/routers/students.py app/routers/students_enrollment.py app/routers/follow_ups.py app/routers/admissions_home_visits.py app/routers/admissions_campus_visits.py app/routers/admissions_enrollments.py tests/test_work_item_service.py tests/test_task_stats_contract.py tests/test_edge_cases.py tests/test_admissions.py tests/test_admissions_work_items.py tests/test_students.py
git commit -m "feat: dual write unified work items"
```

---

### Task 5: Outcome Catalog and Non-Reclaimable Enrollment Elsewhere

**Files:**
- Create: `app/services/lead_outcome_service.py`
- Create: `app/routers/lead_outcomes.py`
- Modify: `app/main.py`
- Modify: `app/status_policy.py`
- Modify: `app/routers/students.py`
- Modify: `app/routers/admin_invalid.py`
- Create: `tests/test_lead_outcomes.py`
- Modify: `tests/test_status_policy.py`
- Modify: `tests/test_students.py`
- Modify: `tests/test_admin.py`

**Interfaces:**
- `GET /api/lead-outcome-reasons` returns active catalog rows ordered by `sort_order`.
- Produces `async resolve_outcome_reason(db, value: str) -> LeadOutcomeReason`.
- Produces `async require_reclaimable_reason(db, student: Student) -> None`.

- [ ] **Step 1: Write failing catalog and reclaim tests**

Assert the catalog contains:

```json
{
  "code": "enrolled_elsewhere",
  "label": "已报名其他学校",
  "terminal": true,
  "reclaimable": false
}
```

Assert writing `{status: "无效", invalid_reason: "已报名其他学校"}` stores `outcome_reason_code="enrolled_elsewhere"`, and single/bulk/one-click invalid reclaim reject it without changing assignment or status.

- [ ] **Step 2: Implement catalog lookup and legacy projection**

`resolve_outcome_reason` accepts a code or exact active label. When writing an invalid status, store both the stable code and current label in `status_detail`. Clearing invalid status clears the code. Unknown free text maps to `other` while retaining the text in `status_detail` for audit.

- [ ] **Step 3: Register the router and protect reclaim paths**

The read catalog requires any authenticated user. Every reclaim helper must call `require_reclaimable_reason` before mutating a student; bulk requests fail atomically and list up to three blocked student IDs, not names.

- [ ] **Step 4: Run tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_lead_outcomes.py tests/test_status_policy.py tests/test_students.py tests/test_admin.py -q
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/services/lead_outcome_service.py app/routers/lead_outcomes.py app/main.py app/status_policy.py app/routers/students.py app/routers/admin_invalid.py tests/test_lead_outcomes.py tests/test_status_policy.py tests/test_students.py tests/test_admin.py
git commit -m "feat: centralize lead outcome rules"
```

---

### Task 6: Handover Service, API, and Safe Legacy Offboard Adapter

**Files:**
- Create: `app/services/handover_service.py`
- Create: `app/routers/admin_handover.py`
- Modify: `app/routers/admin_users.py`
- Modify: `app/main.py`
- Create: `tests/test_handover_service.py`
- Create: `tests/test_admin_handover.py`
- Modify: `tests/test_offboard.py`

**Interfaces:**
- `async start_handover(db, source_user, operator, idempotency_key, expected_employment_version=None) -> HandoverBatch`.
- `async preview_transfer(db, batch_id, student_ids=None) -> HandoverPreview`.
- `async execute_transfer(db, batch_id, target_agent_id, mode, operator, idempotency_key, expected_batch_version, student_ids=()) -> HandoverExecutionResult`.
- New API paths exactly match the approved spec.

- [ ] **Step 1: Write failing service tests**

Build one source agent with default, progressed, invalid, enrolled, follow-up, home-visit, and campus-visit students. Assert start:

- disables login and increments token version;
- creates one batch and items only for nonterminal students;
- preserves all nonterminal status/intent/stage/detail fields;
- closes terminal assignments without changing terminal state;
- blocks open work items;
- repeated idempotency key returns the same batch.

Assert selected transfer moves only selected items; all-remaining completes the batch/employment; historical creator and attribution fields remain unchanged.

- [ ] **Step 2: Implement handover dataclasses and service**

Use exact immutable return types:

```python
@dataclass(frozen=True)
class HandoverPreview:
    batch_id: int
    version: int
    selected_count: int
    open_work_item_count: int
    overdue_count: int
    high_intent_count: int
    by_kind: dict[str, int]

@dataclass(frozen=True)
class HandoverExecutionResult:
    transfer_id: int
    transferred_ids: tuple[int, ...]
    skipped_ids: tuple[int, ...]
    remaining_count: int
    batch_version: int
    completed: bool
```

Batch version mismatch raises `DomainConflict` before writes. After version validation, non-pending selected items go to `skipped_ids`; eligible items transfer atomically through `assignment_service` and `work_item_service`. No eligible items raises HTTP-mapped 409.

- [ ] **Step 3: Expose thin API routes**

Define Pydantic requests with non-empty, max-128-character `idempotency_key`, nonnegative `expected_version`, unique positive student IDs, and `mode: Literal["selected", "all_remaining"]`. Require `ADMIN_OP_USER_OFFBOARD`; starting or completing an admin handover additionally requires super admin.

- [ ] **Step 4: Replace the destructive legacy endpoint**

`POST /api/admin/users/{id}/offboard` calls `start_handover` and returns:

```python
{
    "user_id": user.id,
    "handover_batch_id": batch.id,
    "pending_handover_count": batch.remaining_items,
    "terminal_history_count": terminal_history_count,
    "recycled_count": 0,
    "preserved_count": batch.remaining_items + terminal_history_count,
    "was_already_disabled": was_already_disabled,
}
```

Because the legacy endpoint has no request body, its adapter resolves idempotency deterministically:

1. Query the source employee's existing `pending` or `in_progress` handover batch and return it when present, regardless of the key that originally created it.
2. Otherwise call `start_handover` with `idempotency_key=f"legacy-offboard:user:{user.id}"`; the globally unique handover key makes repeated or concurrent bodyless calls return the first result instead of creating a second batch.
3. If that deterministic key already belongs to a completed batch, return the completed result and counts; do not reopen the employment lifecycle.

Add tests for two sequential legacy calls, two concurrent legacy calls, and a legacy call after the new start endpoint has already created an active batch. Every case must leave exactly one handover batch for the employee. The adapter must never reset status, detail, intent, stage, or `need_help`.

- [ ] **Step 5: Run tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_handover_service.py tests/test_admin_handover.py tests/test_offboard.py tests/test_permissions.py tests/test_token_revocation.py -q
```

Expected: all selected tests pass; old offboard reset assertions are replaced with preservation assertions.

- [ ] **Step 6: Commit**

```powershell
git add app/services/handover_service.py app/routers/admin_handover.py app/routers/admin_users.py app/main.py tests/test_handover_service.py tests/test_admin_handover.py tests/test_offboard.py
git commit -m "feat: add safe employee handover backend"
```

---

### Task 7: Dual-Write Consistency Gate on the Migrated Snapshot

**Files:**
- Create: `app/domain_consistency.py`
- Create: `scripts/audit_domain_consistency.py`
- Create: `tests/test_domain_consistency.py`
- Modify: `scripts/release-check.ps1`

**Interfaces:**
- Produces `async audit_domain_consistency(db: AsyncSession) -> dict[str, int | bool]`.
- CLI prints aggregate-only JSON and exits nonzero on mismatch.

- [ ] **Step 1: Write failing mismatch tests**

Seed one healthy projection, then independently corrupt current assignment, work-item owner, employment projection, and outcome projection. Assert each corruption increments its named counter and sets `ok=False`.

- [ ] **Step 2: Implement set-based consistency queries**

Return the phase-1 audit keys plus:

```python
{
    "employment_projection_mismatches": int,
    "lead_work_item_projection_mismatches": int,
    "source_work_item_projection_mismatches": int,
    "handover_count_mismatches": int,
    "outcome_projection_mismatches": int,
}
```

No result may include personal fields.

- [ ] **Step 3: Add CLI and release check**

The CLI accepts `--database PATH --expect-revision 20260711_03`. `release-check.ps1` runs it only when `DOMAIN_AUDIT_DATABASE` is set, so normal unit-test releases do not inspect a production clone accidentally.

- [ ] **Step 4: Run the complete backend gate**

```powershell
.venv-win\Scripts\python.exe -m pytest -q
.venv-win\Scripts\python.exe -m ruff check app alembic scripts tests
$domainDb = Get-ChildItem .\backups\server-audit\working\crm_domain_*.db | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$env:DOMAIN_AUDIT_DATABASE=$domainDb.FullName
.\scripts\release-check.ps1
```

Expected: all backend tests pass, Ruff passes, consistency JSON has `ok=true`, and release check succeeds.

- [ ] **Step 5: Commit**

```powershell
git add app/domain_consistency.py scripts/audit_domain_consistency.py scripts/release-check.ps1 tests/test_domain_consistency.py
git commit -m "test: gate domain dual write consistency"
```

---

## Phase Acceptance Gate

- Every assignment mutation is guarded by the boundary test and produces assignment history.
- Suspend/resume maintains auth and work-item projections.
- All source workflows dual-write work items without changing historical creators.
- “已报名其他学校” is persisted by code and cannot be automatically reclaimed.
- Starting offboard preserves all nonterminal progress and creates a handover batch.
- Existing API routes remain compatible.
- Full backend suite, Ruff, and snapshot consistency audit pass.

## Self-Review Notes

- Spec coverage: the five service boundaries, legacy projection, safe offboard adapter, outcome catalog, idempotency, concurrency, and consistency monitoring are assigned to concrete tasks.
- Placeholder scan: public signatures, reason codes, route files, commands, response fields, and error semantics are fixed.
- Type consistency: all services consume phase-1 model/enums; handover calls the assignment/work-item/employment services rather than duplicating writes.
