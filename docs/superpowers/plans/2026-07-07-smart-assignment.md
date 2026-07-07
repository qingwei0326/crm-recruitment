# 智能分配作战台 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a smart assignment workbench that previews fair workload-based lead distribution, lets an admin confirm execution, and preserves existing batch audit and rollback behavior.

**Architecture:** Put the assignment algorithm in a backend service module, expose preview/execute endpoints through a small admin router, and add a focused React admin page under lead governance. Keep existing manual assignment, auto assignment, school distribution, and rollback flows unchanged.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, SQLite/PostgreSQL-compatible SQL, Pydantic v2, React 18, Vite, Tailwind CSS, Vitest, Testing Library, pytest.

## Global Constraints

- The first version optimizes for fair workload, not conversion-rate maximization.
- Do not silently auto-assign; admins must preview and confirm.
- Do not create a new assignment task table in the first version.
- Default candidate leads are unassigned, uncontacted, non-terminal, with at least one phone number.
- Default candidate leads exclude high-risk duplicate primary phone groups.
- Execute must recalculate on the server and must not trust frontend-provided student IDs.
- Execution must write per-student operation logs, a summary batch log, and rollback metadata.
- Existing manual assignment, auto assignment, school distribution, and batch rollback behavior must continue to work.
- Keep the new frontend page separate from `frontend/src/pages/admin/LeadsManage.jsx`.
- Reuse `lead_governance` page permission for page access and `student_assign` operation permission for execution.

---

## File Map

- Create `app/smart_assignment.py`
  - Owns `SmartAssignParams`, `SmartAssignmentPlan`, candidate filtering, duplicate-primary-phone exclusion, agent load metrics, fair allocation, and execute helper.
- Create `app/routers/admin_smart_assignment.py`
  - Owns `GET /api/admin/smart-assign/preview` and `POST /api/admin/smart-assign/execute`.
- Modify `app/main.py`
  - Imports and includes the new admin smart assignment router.
- Modify `app/routers/admin_assignment.py`
  - Adds `智能分配` to rollbackable assignment actions.
- Modify `app/routers/admin_governance.py`
  - Adds `智能分配汇总` to distribution summary actions used by risk alerts.
- Modify `app/routers/operation_logs.py`
  - Categorizes `智能分配` and `智能分配汇总` as assignment actions and makes summary batches rollback-previewable.
- Create `tests/test_smart_assignment.py`
  - Covers backend planner, preview endpoint, execute endpoint, permissions, logs, rollback integration, filters, duplicate exclusion, and no-agent/no-lead states.
- Create `frontend/src/pages/admin/SmartAssignment.jsx`
  - Owns the smart assignment workbench UI.
- Modify `frontend/src/App.jsx`
  - Adds lazy import and `/admin/smart-assign` route under `lead_governance` permission.
- Modify `frontend/src/pages/admin/LeadGovernance.jsx`
  - Adds a “智能分配” workflow card that links to `/admin/smart-assign`.
- Modify `frontend/src/__tests__/App.routes.test.jsx`
  - Covers the new route and permission behavior.
- Modify `frontend/src/pages/admin/__tests__/LeadGovernance.test.jsx`
  - Verifies the new workflow card.
- Create `frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx`
  - Covers preview rendering, parameter changes, empty states, execute confirmation, success, and no-permission execution state.
- Modify `frontend/src/pages/admin/AuditLogs.jsx`
  - Adds badge tone for `智能分配` and `智能分配汇总`.

---

### Task 1: Backend Planner Service

**Files:**
- Create: `app/smart_assignment.py`
- Create: `tests/test_smart_assignment.py`

**Interfaces:**
- Produces: `SmartAssignParams(school_name: str = "", region: str = "", limit: int = 500, per_agent_limit: int = 100)`
- Produces: `SmartAssignmentPlan(payload: dict, assignments_by_agent: dict[int, list[int]])`
- Produces: `async build_smart_assignment_plan(db: AsyncSession, params: SmartAssignParams) -> SmartAssignmentPlan`
- Consumes: existing `Student`, `User`, `DialLog`, `FollowUp`, `OperationLog`, `StudentStatus`, `UserRole`, `ACTIVE_TASK_STATUSES`, `statuses_for_canonical()`, `today_cst_as_utc()`, `utcnow()`

- [ ] **Step 1: Write failing planner tests**

Add these tests to a new `tests/test_smart_assignment.py`:

```python
from datetime import timedelta

import pytest

from app.models import DialLog, FollowUp, OperationLog, Student, StudentStatus, User
from app.smart_assignment import SmartAssignParams, build_smart_assignment_plan
from app.utils import today_cst_as_utc, utcnow


def _agent(username: str, name: str, active: bool = True) -> User:
    return User(
        username=username,
        hashed_password="x",
        role="agent",
        name=name,
        is_active=active,
    )


def _student(
    name: str,
    *,
    status=StudentStatus.not_contacted,
    assigned_to=None,
    school_name="测试中学",
    region="芗城区",
    guardian_phone="13900000000",
) -> Student:
    return Student(
        name=name,
        status=status,
        assigned_to=assigned_to,
        school_name=school_name,
        region=region,
        guardian_phone=guardian_phone,
    )


@pytest.mark.asyncio
async def test_smart_assign_preview_fills_lower_load_agent_first(db):
    low = _agent("low_load", "低负载")
    high = _agent("high_load", "高负载")
    db.add_all([low, high])
    await db.flush()
    for index in range(12):
        db.add(_student(f"高负载现有{index}", assigned_to=high.id, guardian_phone=f"1391000{index:04d}"))
    for index in range(4):
        db.add(_student(f"候选{index}", guardian_phone=f"1392000{index:04d}"))
    await db.commit()

    plan = await build_smart_assignment_plan(
        db,
        SmartAssignParams(limit=4, per_agent_limit=4),
    )

    low_row = next(row for row in plan.payload["agents"] if row["agent_id"] == low.id)
    high_row = next(row for row in plan.payload["agents"] if row["agent_id"] == high.id)
    assert low_row["suggested_count"] == 4
    assert high_row["suggested_count"] == 0
    assert plan.payload["plan"]["planned"] == 4
    assert plan.assignments_by_agent == {low.id: plan.assignments_by_agent[low.id]}
    assert len(plan.assignments_by_agent[low.id]) == 4


@pytest.mark.asyncio
async def test_smart_assign_preview_excludes_duplicate_primary_phone_groups(db):
    agent = _agent("agent_a", "坐席A")
    db.add(agent)
    await db.flush()
    db.add_all(
        [
            _student("重复1", guardian_phone="13911112222"),
            _student("重复2", guardian_phone="13911112222"),
            _student("唯一", guardian_phone="13933334444"),
        ]
    )
    await db.commit()

    plan = await build_smart_assignment_plan(db, SmartAssignParams(limit=10, per_agent_limit=10))

    assert plan.payload["pool"]["total_unassigned"] == 3
    assert plan.payload["pool"]["excluded_duplicate_phone"] == 2
    assert plan.payload["pool"]["eligible_total"] == 1
    assert plan.payload["plan"]["planned"] == 1


@pytest.mark.asyncio
async def test_smart_assign_preview_respects_filters_and_agent_limit(db):
    agent_a = _agent("agent_a", "坐席A")
    agent_b = _agent("agent_b", "坐席B")
    db.add_all([agent_a, agent_b])
    await db.flush()
    db.add_all(
        [
            _student("命中1", school_name="龙海一中", region="龙海区", guardian_phone="13900000001"),
            _student("命中2", school_name="龙海一中", region="龙海区", guardian_phone="13900000002"),
            _student("其他学校", school_name="漳浦一中", region="漳浦县", guardian_phone="13900000003"),
        ]
    )
    await db.commit()

    plan = await build_smart_assignment_plan(
        db,
        SmartAssignParams(
            school_name="龙海一中",
            region="龙海区",
            limit=3,
            per_agent_limit=1,
        ),
    )

    assert plan.payload["pool"]["eligible_total"] == 2
    assert plan.payload["plan"]["planned"] == 2
    assert all(row["suggested_count"] <= 1 for row in plan.payload["agents"])


@pytest.mark.asyncio
async def test_smart_assign_preview_returns_warning_when_no_active_agents(db):
    db.add(_student("候选", guardian_phone="13900000001"))
    await db.commit()

    plan = await build_smart_assignment_plan(db, SmartAssignParams(limit=10, per_agent_limit=10))

    assert plan.payload["plan"]["planned"] == 0
    assert plan.payload["agents"] == []
    assert "没有启用话务员" in plan.payload["warnings"]


@pytest.mark.asyncio
async def test_smart_assign_load_score_uses_calls_recent_handling_and_overdue_followups(db):
    agent = _agent("agent_a", "坐席A")
    db.add(agent)
    await db.flush()
    existing = _student("现有任务", assigned_to=agent.id, guardian_phone="13900000001")
    db.add(existing)
    await db.flush()
    db.add(DialLog(student_id=existing.id, agent_id=agent.id, dialed_at=today_cst_as_utc() + timedelta(hours=1)))
    db.add(
        OperationLog(
            operator_id=agent.id,
            operator_name=agent.name,
            target_student_id=existing.id,
            case_no="",
            action="修改状态",
            content="测试处理",
            created_at=utcnow() - timedelta(days=1),
        )
    )
    db.add(
        FollowUp(
            student_id=existing.id,
            agent_id=agent.id,
            follow_up_date=utcnow() - timedelta(hours=1),
            is_completed=False,
        )
    )
    db.add(_student("候选", guardian_phone="13900000002"))
    await db.commit()

    plan = await build_smart_assignment_plan(db, SmartAssignParams(limit=1, per_agent_limit=1))

    row = plan.payload["agents"][0]
    assert row["active_tasks"] == 1
    assert row["today_calls"] == 1
    assert row["handled_7d"] == 1
    assert row["overdue_follow_ups"] == 1
    assert row["load_score"] == 3.5
```

- [ ] **Step 2: Run planner tests to verify they fail**

Run:

```powershell
pytest tests/test_smart_assignment.py -q
```

Expected: FAIL during collection with `ModuleNotFoundError: No module named 'app.smart_assignment'`.

- [ ] **Step 3: Create the smart assignment planner**

Create `app/smart_assignment.py` with these public objects and helper boundaries:

```python
import math
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DialLog, FollowUp, OperationLog, Student, StudentStatus, User, UserRole
from app.status_policy import statuses_for_canonical
from app.task_stats import ACTIVE_TASK_STATUSES, TERMINAL_STUDENT_STATUSES
from app.utils import today_cst_as_utc, utcnow


@dataclass(frozen=True)
class SmartAssignParams:
    school_name: str = ""
    region: str = ""
    limit: int = 500
    per_agent_limit: int = 100

    def normalized(self) -> "SmartAssignParams":
        return SmartAssignParams(
            school_name=(self.school_name or "").strip(),
            region=(self.region or "").strip(),
            limit=max(1, min(int(self.limit or 500), 5000)),
            per_agent_limit=max(1, min(int(self.per_agent_limit or 100), 1000)),
        )


@dataclass(frozen=True)
class SmartAssignmentPlan:
    payload: dict
    assignments_by_agent: dict[int, list[int]]


def _duplicate_primary_phone_subquery():
    return (
        select(Student.guardian_phone)
        .where(Student.guardian_phone != "")
        .group_by(Student.guardian_phone)
        .having(func.count(Student.id) > 1)
    )


def _scoped_unassigned_filters(params: SmartAssignParams) -> list:
    filters = [Student.assigned_to.is_(None)]
    if params.school_name:
        filters.append(Student.school_name == params.school_name)
    if params.region:
        filters.append(Student.region == params.region)
    return filters


def _eligible_filters(params: SmartAssignParams) -> list:
    duplicate_phone_subq = _duplicate_primary_phone_subquery()
    return [
        *_scoped_unassigned_filters(params),
        Student.status.in_(statuses_for_canonical(StudentStatus.not_contacted)),
        Student.status.not_in(TERMINAL_STUDENT_STATUSES),
        or_(Student.guardian_phone != "", Student.guardian2_phone != ""),
        or_(Student.guardian_phone == "", Student.guardian_phone.not_in(duplicate_phone_subq)),
    ]


async def _scalar_count(db: AsyncSession, filters: list) -> int:
    result = await db.execute(select(func.count(Student.id)).where(*filters))
    return int(result.scalar() or 0)


async def _pool_payload(db: AsyncSession, params: SmartAssignParams) -> dict:
    duplicate_phone_subq = _duplicate_primary_phone_subquery()
    scoped = _scoped_unassigned_filters(params)
    candidate_without_duplicate_filter = [
        *scoped,
        Student.status.in_(statuses_for_canonical(StudentStatus.not_contacted)),
        Student.status.not_in(TERMINAL_STUDENT_STATUSES),
        or_(Student.guardian_phone != "", Student.guardian2_phone != ""),
    ]
    total_unassigned = await _scalar_count(db, scoped)
    duplicate_count = await _scalar_count(
        db,
        [*candidate_without_duplicate_filter, Student.guardian_phone.in_(duplicate_phone_subq)],
    )
    eligible_total = await _scalar_count(db, _eligible_filters(params))
    excluded_invalid_status = max(total_unassigned - eligible_total - duplicate_count, 0)
    return {
        "total_unassigned": total_unassigned,
        "eligible_total": eligible_total,
        "eligible": min(params.limit, eligible_total),
        "excluded_duplicate_phone": duplicate_count,
        "excluded_invalid_status": excluded_invalid_status,
        "remaining_after_plan": 0,
    }


async def _candidate_student_ids(db: AsyncSession, params: SmartAssignParams) -> list[int]:
    result = await db.execute(
        select(Student.id)
        .where(*_eligible_filters(params))
        .order_by(
            Student.assigned_at.is_not(None),
            Student.created_at.asc(),
            Student.id.asc(),
        )
        .limit(params.limit)
    )
    return [int(row[0]) for row in result.all()]


async def _agent_metric_counts(db: AsyncSession, agent_ids: list[int]) -> dict[str, dict[int, int]]:
    if not agent_ids:
        return {
            "active": {},
            "not_contacted": {},
            "today_calls": {},
            "handled_7d": {},
            "overdue_follow_ups": {},
        }
    now = utcnow()
    today = today_cst_as_utc()
    tomorrow = today + timedelta(days=1)
    week_ago = now - timedelta(days=7)

    active_rows = (
        await db.execute(
            select(Student.assigned_to, func.count(Student.id))
            .where(Student.assigned_to.in_(agent_ids), Student.status.in_(ACTIVE_TASK_STATUSES))
            .group_by(Student.assigned_to)
        )
    ).all()
    not_contacted_rows = (
        await db.execute(
            select(Student.assigned_to, func.count(Student.id))
            .where(
                Student.assigned_to.in_(agent_ids),
                Student.status.in_(statuses_for_canonical(StudentStatus.not_contacted)),
            )
            .group_by(Student.assigned_to)
        )
    ).all()
    call_rows = (
        await db.execute(
            select(DialLog.agent_id, func.count(DialLog.id))
            .where(
                DialLog.agent_id.in_(agent_ids),
                DialLog.dialed_at >= today,
                DialLog.dialed_at < tomorrow,
            )
            .group_by(DialLog.agent_id)
        )
    ).all()
    handled_rows = (
        await db.execute(
            select(OperationLog.operator_id, func.count(OperationLog.id))
            .where(
                OperationLog.operator_id.in_(agent_ids),
                OperationLog.created_at >= week_ago,
            )
            .group_by(OperationLog.operator_id)
        )
    ).all()
    overdue_rows = (
        await db.execute(
            select(FollowUp.agent_id, func.count(FollowUp.id))
            .where(
                FollowUp.agent_id.in_(agent_ids),
                FollowUp.is_completed.is_(False),
                FollowUp.follow_up_date < now,
            )
            .group_by(FollowUp.agent_id)
        )
    ).all()
    return {
        "active": {int(agent_id): int(count or 0) for agent_id, count in active_rows},
        "not_contacted": {int(agent_id): int(count or 0) for agent_id, count in not_contacted_rows},
        "today_calls": {int(agent_id): int(count or 0) for agent_id, count in call_rows},
        "handled_7d": {int(agent_id): int(count or 0) for agent_id, count in handled_rows},
        "overdue_follow_ups": {int(agent_id): int(count or 0) for agent_id, count in overdue_rows},
    }


def _load_score(active: int, today_calls: int, handled_7d: int, overdue_follow_ups: int) -> float:
    return round(active * 1.0 + today_calls * 0.3 + handled_7d * 0.2 + overdue_follow_ups * 2.0, 1)


async def _agent_rows(db: AsyncSession) -> list[dict]:
    agents = (
        (
            await db.execute(
                select(User).where(User.is_active, User.role == UserRole.agent).order_by(User.id.asc())
            )
        )
        .scalars()
        .all()
    )
    agent_ids = [agent.id for agent in agents]
    metrics = await _agent_metric_counts(db, agent_ids)
    rows = []
    for agent in agents:
        active = metrics["active"].get(agent.id, 0)
        today_calls = metrics["today_calls"].get(agent.id, 0)
        handled_7d = metrics["handled_7d"].get(agent.id, 0)
        overdue_follow_ups = metrics["overdue_follow_ups"].get(agent.id, 0)
        rows.append(
            {
                "agent_id": agent.id,
                "agent_name": agent.name,
                "active_tasks": active,
                "not_contacted": metrics["not_contacted"].get(agent.id, 0),
                "today_calls": today_calls,
                "handled_7d": handled_7d,
                "overdue_follow_ups": overdue_follow_ups,
                "load_score": _load_score(active, today_calls, handled_7d, overdue_follow_ups),
                "suggested_count": 0,
            }
        )
    return rows


def _allocate_counts(agent_rows: list[dict], candidate_count: int, per_agent_limit: int) -> dict[int, int]:
    if not agent_rows or candidate_count <= 0:
        return {}
    counts = {int(row["agent_id"]): 0 for row in agent_rows}
    remaining = candidate_count
    target_active = math.ceil(sum(row["active_tasks"] for row in agent_rows) / len(agent_rows))

    for row in sorted(agent_rows, key=lambda item: (item["active_tasks"], item["load_score"], item["agent_id"])):
        if remaining <= 0:
            break
        capacity = per_agent_limit - counts[row["agent_id"]]
        needed = max(target_active - row["active_tasks"], 0)
        amount = min(capacity, needed, remaining)
        if amount > 0:
            counts[row["agent_id"]] += amount
            remaining -= amount

    ordered = sorted(agent_rows, key=lambda item: (item["load_score"], item["active_tasks"], item["agent_id"]))
    while remaining > 0:
        changed = False
        for row in ordered:
            agent_id = row["agent_id"]
            if counts[agent_id] >= per_agent_limit:
                continue
            counts[agent_id] += 1
            remaining -= 1
            changed = True
            if remaining <= 0:
                break
        if not changed:
            break
    return {agent_id: count for agent_id, count in counts.items() if count > 0}


def _split_candidate_ids(candidate_ids: list[int], counts: dict[int, int]) -> dict[int, list[int]]:
    assignments: dict[int, list[int]] = {}
    index = 0
    for agent_id, count in counts.items():
        assignments[agent_id] = candidate_ids[index : index + count]
        index += count
    return {agent_id: ids for agent_id, ids in assignments.items() if ids}


async def build_smart_assignment_plan(db: AsyncSession, params: SmartAssignParams) -> SmartAssignmentPlan:
    params = params.normalized()
    pool = await _pool_payload(db, params)
    agents = await _agent_rows(db)
    candidate_ids = await _candidate_student_ids(db, params)
    warnings: list[str] = []
    if not agents:
        warnings.append("没有启用话务员")
    if not candidate_ids:
        warnings.append("当前筛选范围无可分配线索")

    counts = _allocate_counts(agents, len(candidate_ids), params.per_agent_limit)
    assignments_by_agent = _split_candidate_ids(candidate_ids, counts)
    planned = sum(len(ids) for ids in assignments_by_agent.values())
    for row in agents:
        row["suggested_count"] = len(assignments_by_agent.get(row["agent_id"], []))
    pool["remaining_after_plan"] = max(pool["eligible_total"] - planned, 0)
    plan_rows = [
        {
            "agent_id": row["agent_id"],
            "agent_name": row["agent_name"],
            "count": row["suggested_count"],
        }
        for row in agents
        if row["suggested_count"] > 0
    ]
    return SmartAssignmentPlan(
        payload={
            "pool": pool,
            "agents": agents,
            "plan": {
                "requested": params.limit,
                "planned": planned,
                "per_agent": plan_rows,
            },
            "warnings": warnings,
            "filters": {
                "school_name": params.school_name,
                "region": params.region,
                "limit": params.limit,
                "per_agent_limit": params.per_agent_limit,
            },
        },
        assignments_by_agent=assignments_by_agent,
    )
```

- [ ] **Step 4: Run planner tests to verify they pass**

Run:

```powershell
pytest tests/test_smart_assignment.py -q
```

Expected: PASS for the five planner tests.

- [ ] **Step 5: Commit planner service**

Run:

```powershell
git add app/smart_assignment.py tests/test_smart_assignment.py
git commit -m "feat: add smart assignment planner"
```

Expected: commit succeeds and `git status --short` does not show these two files.

---

### Task 2: Backend Preview/Execute API and Audit Integration

**Files:**
- Create: `app/routers/admin_smart_assignment.py`
- Modify: `app/main.py`
- Modify: `app/routers/admin_assignment.py`
- Modify: `app/routers/admin_governance.py`
- Modify: `app/routers/operation_logs.py`
- Modify: `tests/test_smart_assignment.py`

**Interfaces:**
- Consumes: `build_smart_assignment_plan(db, SmartAssignParams(school_name="", region="", limit=500, per_agent_limit=100))`
- Produces: `GET /api/admin/smart-assign/preview`
- Produces: `POST /api/admin/smart-assign/execute`
- Produces rollbackable actions: `智能分配`, `智能分配汇总`

- [ ] **Step 1: Add failing API tests**

Append these tests to `tests/test_smart_assignment.py`:

```python
from sqlalchemy import select

from app.models import OperationLog


@pytest.mark.asyncio
async def test_smart_assign_preview_requires_lead_governance_page_permission(
    client,
    normal_admin_headers,
):
    resp = await client.get("/api/admin/smart-assign/preview", headers=normal_admin_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_smart_assign_preview_allows_lead_governance_page_permission(
    client,
    db,
    normal_admin_user,
    normal_admin_headers,
    agent_user,
):
    normal_admin_user.page_permissions = "lead_governance"
    db.add(_student("候选", guardian_phone="13900000001"))
    await db.commit()

    resp = await client.get("/api/admin/smart-assign/preview", headers=normal_admin_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["pool"]["eligible_total"] == 1


@pytest.mark.asyncio
async def test_smart_assign_execute_requires_student_assign_permission(
    client,
    db,
    normal_admin_user,
    normal_admin_headers,
    agent_user,
):
    normal_admin_user.page_permissions = "lead_governance"
    db.add(_student("候选", guardian_phone="13900000001"))
    await db.commit()

    resp = await client.post(
        "/api/admin/smart-assign/execute",
        headers=normal_admin_headers,
        json={"limit": 1, "per_agent_limit": 1, "confirm": True},
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_smart_assign_execute_requires_confirm(client, admin_headers):
    resp = await client.post(
        "/api/admin/smart-assign/execute",
        headers=admin_headers,
        json={"limit": 1, "per_agent_limit": 1, "confirm": False},
    )
    assert resp.status_code == 200
    assert resp.json()["code"] == 1
    assert resp.json()["msg"] == "请确认后再执行智能分配"


@pytest.mark.asyncio
async def test_smart_assign_execute_recalculates_and_writes_rollbackable_logs(
    client,
    db,
    admin_headers,
    agent_user,
):
    second_agent = _agent("second_agent", "第二坐席")
    db.add(second_agent)
    await db.flush()
    db.add_all(
        [
            _student("候选1", guardian_phone="13900000001"),
            _student("候选2", guardian_phone="13900000002"),
            _student("重复1", guardian_phone="13999990000"),
            _student("重复2", guardian_phone="13999990000"),
        ]
    )
    await db.commit()

    resp = await client.post(
        "/api/admin/smart-assign/execute",
        headers=admin_headers,
        json={"limit": 3, "per_agent_limit": 2, "confirm": True},
    )
    body = resp.json()

    assert body["code"] == 0
    assert body["data"]["assigned_count"] == 2
    assert body["data"]["skipped_count"] == 0
    assert body["data"]["batch_id"].startswith("smart-assign-")

    assigned = (
        (
            await db.execute(
                select(Student).where(Student.name.in_(["候选1", "候选2"])).order_by(Student.id)
            )
        )
        .scalars()
        .all()
    )
    assert all(student.assigned_to is not None for student in assigned)
    logs = (
        (
            await db.execute(
                select(OperationLog)
                .where(OperationLog.batch_id == body["data"]["batch_id"])
                .order_by(OperationLog.id)
            )
        )
        .scalars()
        .all()
    )
    assert [log.action for log in logs].count("智能分配") == 2
    assert logs[-1].action == "智能分配汇总"

    rollback_resp = await client.get(
        f"/api/admin/assignment-rollbacks/{body['data']['batch_id']}",
        headers=admin_headers,
    )
    rollback_body = rollback_resp.json()
    assert rollback_body["code"] == 0
    assert rollback_body["data"]["rollbackable_count"] == 2
```

- [ ] **Step 2: Run API tests to verify they fail**

Run:

```powershell
pytest tests/test_smart_assignment.py -q
```

Expected: planner tests pass and API tests fail with 404 for `/api/admin/smart-assign/preview`.

- [ ] **Step 3: Create admin smart assignment router**

Create `app/routers/admin_smart_assignment.py`:

```python
from pydantic import BaseModel, Field, field_validator
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_STUDENT_ASSIGN,
    ADMIN_PAGE_LEAD_GOVERNANCE,
    require_operation_permission,
    require_page_permission,
)
from app.database import get_db
from app.models import Student, User
from app.schemas import Response
from app.smart_assignment import SmartAssignParams, build_smart_assignment_plan
from app.utils import (
    assignment_state_label,
    make_assignment_rollback_note,
    make_batch_id,
    make_operation_log,
    utcnow,
)

router = APIRouter(prefix="/api/admin", tags=["管理"])


class SmartAssignExecuteReq(BaseModel):
    school_name: str = ""
    region: str = ""
    limit: int = Field(default=500, ge=1, le=5000)
    per_agent_limit: int = Field(default=100, ge=1, le=1000)
    confirm: bool = False

    @field_validator("school_name", "region")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return (value or "").strip()

    def params(self) -> SmartAssignParams:
        return SmartAssignParams(
            school_name=self.school_name,
            region=self.region,
            limit=self.limit,
            per_agent_limit=self.per_agent_limit,
        )


def _params_from_query(
    school_name: str = "",
    region: str = "",
    limit: int = Query(default=500, ge=1, le=5000),
    per_agent_limit: int = Query(default=100, ge=1, le=1000),
) -> SmartAssignParams:
    return SmartAssignParams(
        school_name=(school_name or "").strip(),
        region=(region or "").strip(),
        limit=limit,
        per_agent_limit=per_agent_limit,
    )


@router.get("/smart-assign/preview")
async def smart_assign_preview(
    params: SmartAssignParams = Depends(_params_from_query),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
    plan = await build_smart_assignment_plan(db, params)
    return Response.ok(plan.payload)


@router.post("/smart-assign/execute")
async def smart_assign_execute(
    body: SmartAssignExecuteReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_ASSIGN)),
):
    if not body.confirm:
        return Response.error(code=1, msg="请确认后再执行智能分配")

    plan = await build_smart_assignment_plan(db, body.params())
    if not plan.assignments_by_agent:
        return Response.ok(
            {
                "batch_id": "",
                "assigned_count": 0,
                "skipped_count": 0,
                "per_agent": [],
                "warnings": plan.payload.get("warnings", []),
            }
        )

    now = utcnow()
    batch_id = make_batch_id("smart-assign")
    all_student_ids = [
        student_id
        for ids in plan.assignments_by_agent.values()
        for student_id in ids
    ]
    students = (
        (
            await db.execute(select(Student).where(Student.id.in_(all_student_ids)))
        )
        .scalars()
        .all()
    )
    students_by_id = {student.id: student for student in students}
    assigned_count = 0
    skipped_count = 0

    for agent_id, student_ids in plan.assignments_by_agent.items():
        for student_id in student_ids:
            student = students_by_id.get(student_id)
            if student is None or student.assigned_to is not None:
                skipped_count += 1
                continue
            old_assigned_to = student.assigned_to
            old_assigned_at = student.assigned_at
            student.assigned_to = agent_id
            student.assigned_at = now
            db.add(
                make_operation_log(
                    current_user,
                    student.id,
                    student.case_no or "",
                    "智能分配",
                    content=f"智能分配给话务员 {agent_id}",
                    old_status=assignment_state_label(old_assigned_to),
                    new_status=assignment_state_label(agent_id),
                    note_content=make_assignment_rollback_note(
                        old_assigned_to=old_assigned_to,
                        old_assigned_at=old_assigned_at,
                        new_assigned_to=agent_id,
                        new_assigned_at=now,
                    ),
                    batch_id=batch_id,
                )
            )
            assigned_count += 1

    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="智能分配汇总",
            content=(
                f"智能分配执行：计划 {plan.payload['plan']['planned']} 条，"
                f"实际 {assigned_count} 条，跳过 {skipped_count} 条；"
                f"学校：{body.school_name or '全部'}；区县：{body.region or '全部'}"
            ),
            batch_id=batch_id,
        )
    )
    await db.commit()
    per_agent = []
    for row in plan.payload["plan"]["per_agent"]:
        assigned_for_agent = len(plan.assignments_by_agent.get(row["agent_id"], []))
        if assigned_for_agent:
            per_agent.append({**row, "count": assigned_for_agent})
    return Response.ok(
        {
            "batch_id": batch_id,
            "assigned_count": assigned_count,
            "skipped_count": skipped_count,
            "per_agent": per_agent,
            "warnings": plan.payload.get("warnings", []),
        }
    )
```

- [ ] **Step 4: Register router and audit actions**

In `app/main.py`, add `admin_smart_assignment` to the router import list and include it after `admin_assignment`:

```python
from app.routers import (
    admin,
    admin_assignment,
    admin_config,
    admin_daily,
    admin_governance,
    admin_invalid,
    admin_misc,
    admin_smart_assignment,
    admin_stale,
    admin_users,
    admissions,
    admissions_campus_visits,
    admissions_enrollments,
    admissions_home_visits,
    admissions_work_items,
    auth,
    calls,
    follow_ups,
    notes,
    operation_logs,
    stats,
    stats_agents,
    stats_dashboard,
    stats_enrollment,
    students,
    students_assignment,
    students_enrollment,
    students_import,
    students_phone,
    students_query,
    tasks,
    visits,
)
```

```python
app.include_router(admin_assignment.router)
app.include_router(admin_smart_assignment.router)
```

In `app/routers/admin_assignment.py`, add the new action:

```python
ASSIGNMENT_ROLLBACK_ACTIONS = {
    "手动分配",
    "自动分配",
    "区域分配",
    "学校分配",
    "多学校分发",
    "智能分配",
}
```

In `app/routers/admin_governance.py`, add the summary action:

```python
BATCH_DISTRIBUTION_SUMMARY_ACTIONS = {
    "批量分配",
    "自动分配汇总",
    "区域分配汇总",
    "学校分配汇总",
    "多学校分发汇总",
    "智能分配汇总",
}
```

In `app/routers/operation_logs.py`, add both action categories and rollback summary action:

```python
ACTION_CATEGORY["智能分配"] = "分配"
ACTION_CATEGORY["智能分配汇总"] = "分配"
```

```python
ASSIGNMENT_ROLLBACK_BATCH_ACTIONS = {
    "批量分配",
    "自动分配汇总",
    "区域分配汇总",
    "学校分配汇总",
    "多学校分发汇总",
    "智能分配汇总",
}
```

- [ ] **Step 5: Run backend tests**

Run:

```powershell
pytest tests/test_smart_assignment.py tests/test_call_volume.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit backend API**

Run:

```powershell
git add app/main.py app/routers/admin_smart_assignment.py app/routers/admin_assignment.py app/routers/admin_governance.py app/routers/operation_logs.py tests/test_smart_assignment.py
git commit -m "feat: add smart assignment API"
```

Expected: commit succeeds and `git status --short` does not show these files.

---

### Task 3: Frontend Route and Governance Entry

**Files:**
- Create: `frontend/src/pages/admin/SmartAssignment.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/pages/admin/LeadGovernance.jsx`
- Modify: `frontend/src/__tests__/App.routes.test.jsx`
- Modify: `frontend/src/pages/admin/__tests__/LeadGovernance.test.jsx`

**Interfaces:**
- Produces route: `/admin/smart-assign`
- Consumes page permission: `ADMIN_PAGE_PERMISSIONS.leadGovernance`
- Produces governance workflow card label: `智能分配`

- [ ] **Step 1: Add failing route and governance tests**

In `frontend/src/__tests__/App.routes.test.jsx`, add a mock near the other admin page mocks:

```jsx
vi.mock('../pages/admin/SmartAssignment', () => ({
  default: () => <div>smart assignment page</div>,
}));
```

Add `/admin/smart-assign` to both permission tables:

```jsx
['/admin/smart-assign', 'smart assignment page'],
```

```jsx
['/admin/smart-assign', ['lead_governance'], 'smart assignment page'],
```

In `frontend/src/pages/admin/__tests__/LeadGovernance.test.jsx`, update the first test expectations:

```jsx
expect(screen.getByRole('link', { name: /智能分配/ })).toHaveAttribute('href', '/admin/smart-assign');
```

- [ ] **Step 2: Run frontend route tests to verify they fail**

Run:

```powershell
cd frontend
npm test -- --run src/__tests__/App.routes.test.jsx src/pages/admin/__tests__/LeadGovernance.test.jsx
```

Expected: FAIL because the app does not import or route `SmartAssignment`, and governance does not link to it.

- [ ] **Step 3: Create the page skeleton and route**

Create `frontend/src/pages/admin/SmartAssignment.jsx`:

```jsx
import { useState } from 'react';
import { Moon, RefreshCcw, Sun } from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import useIsMobile from '../../hooks/useIsMobile';

export default function SmartAssignment() {
  const { dark, toggle } = useTheme();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const closeSidebar = () => setSidebarOpen(false);

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="智能分配"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        >
          <button type="button" onClick={toggle} aria-label={dark ? '亮色模式' : '暗色模式'}>
            {dark ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5 text-gray-500" />}
          </button>
        </PageHeader>
        <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
              <RefreshCcw className="h-4 w-4 text-blue-600" />
              智能分配预览
            </div>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              根据未分配线索和坐席负载生成公平分配建议，确认后再执行。
            </p>
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
```

In `frontend/src/App.jsx`, add the lazy import:

```jsx
const SmartAssignment = lazy(() => import('./pages/admin/SmartAssignment'));
```

Add the route after `/admin/governance`:

```jsx
<Route
  path="/admin/smart-assign"
  element={
    <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.leadGovernance}>
      <RouteError><SmartAssignment /></RouteError>
    </Protected>
  }
/>
```

In `frontend/src/pages/admin/LeadGovernance.jsx`, import `RefreshCcw` is already present. Insert a workflow item between student management and invalid reclaim:

```jsx
{
  step: '2',
  title: '智能分配',
  description: '按未分配池和坐席负载生成公平分配建议，管理员确认后批量执行。',
  outcome: '适合每天批量补齐坐席任务量，并保留批次回滚。',
  to: '/admin/smart-assign',
  icon: RefreshCcw,
  tone: 'amber',
},
```

Renumber the later workflow `step` values so “无效线索回收”为 `3`，“多学校分发”为 `4`.

- [ ] **Step 4: Run route tests**

Run:

```powershell
cd frontend
npm test -- --run src/__tests__/App.routes.test.jsx src/pages/admin/__tests__/LeadGovernance.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit route and entry**

Run:

```powershell
git add frontend/src/pages/admin/SmartAssignment.jsx frontend/src/App.jsx frontend/src/pages/admin/LeadGovernance.jsx frontend/src/__tests__/App.routes.test.jsx frontend/src/pages/admin/__tests__/LeadGovernance.test.jsx
git commit -m "feat: add smart assignment admin entry"
```

Expected: commit succeeds and `git status --short` does not show these files.

---

### Task 4: Frontend Preview Workbench

**Files:**
- Modify: `frontend/src/pages/admin/SmartAssignment.jsx`
- Create: `frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx`

**Interfaces:**
- Consumes: `GET /api/admin/smart-assign/preview`
- Produces state fields: `schoolName`, `region`, `limit`, `perAgentLimit`, `preview`, `loading`
- Produces visible sections: `分配池概览`, `筛选与参数`, `坐席负载`, `分配建议`

- [ ] **Step 1: Write failing preview UI tests**

Create `frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx`:

```jsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SmartAssignment from '../SmartAssignment';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
  },
}));

vi.mock('../../../context/ThemeContext', () => ({
  useTheme: () => ({
    dark: false,
    toggle: vi.fn(),
  }),
}));

let mockUser;

vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser,
    logout: vi.fn(),
  }),
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => vi.fn().mockResolvedValue(true),
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

function previewPayload(overrides = {}) {
  return {
    pool: {
      total_unassigned: 54150,
      eligible_total: 500,
      eligible: 500,
      excluded_duplicate_phone: 120,
      excluded_invalid_status: 30,
      remaining_after_plan: 0,
    },
    agents: [
      {
        agent_id: 1,
        agent_name: '坐席A',
        active_tasks: 80,
        not_contacted: 60,
        today_calls: 20,
        handled_7d: 120,
        overdue_follow_ups: 0,
        load_score: 110,
        suggested_count: 100,
      },
      {
        agent_id: 2,
        agent_name: '坐席B',
        active_tasks: 20,
        not_contacted: 10,
        today_calls: 5,
        handled_7d: 20,
        overdue_follow_ups: 1,
        load_score: 27.5,
        suggested_count: 400,
      },
    ],
    plan: {
      requested: 500,
      planned: 500,
      per_agent: [
        { agent_id: 1, agent_name: '坐席A', count: 100 },
        { agent_id: 2, agent_name: '坐席B', count: 400 },
      ],
    },
    warnings: [],
    filters: {
      school_name: '',
      region: '',
      limit: 500,
      per_agent_limit: 100,
    },
    ...overrides,
  };
}

describe('SmartAssignment', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = {
      id: 1,
      role: 'admin',
      name: '管理员',
      is_super_admin: false,
      operation_permissions: ['student_assign'],
    };
    api.get.mockResolvedValue({ data: { code: 0, data: previewPayload() } });
  });

  it('loads and renders pool, agent load, and plan preview', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SmartAssignment />
      </MemoryRouter>,
    );

    expect(await screen.findByText('分配池概览')).toBeInTheDocument();
    expect(screen.getByText('54150')).toBeInTheDocument();
    expect(screen.getByText('重复手机号排除')).toBeInTheDocument();
    expect(screen.getByText('坐席A')).toBeInTheDocument();
    expect(screen.getByText('坐席B')).toBeInTheDocument();
    expect(screen.getByText('计划分配 500 条')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith('/admin/smart-assign/preview', {
      params: { school_name: '', region: '', limit: 500, per_agent_limit: 100 },
    });
  });

  it('reloads preview with edited filters', async () => {
    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SmartAssignment />
      </MemoryRouter>,
    );

    expect(await screen.findByText('分配池概览')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('学校'), { target: { value: '龙海一中' } });
    fireEvent.change(screen.getByLabelText('地区'), { target: { value: '龙海区' } });
    fireEvent.change(screen.getByLabelText('本次分配总量'), { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('单坐席上限'), { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: '刷新预览' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith('/admin/smart-assign/preview', {
        params: { school_name: '龙海一中', region: '龙海区', limit: 300, per_agent_limit: 80 },
      });
    });
  });

  it('renders empty and warning states', async () => {
    api.get.mockResolvedValue({
      data: {
        code: 0,
        data: previewPayload({
          pool: {
            total_unassigned: 0,
            eligible_total: 0,
            eligible: 0,
            excluded_duplicate_phone: 0,
            excluded_invalid_status: 0,
            remaining_after_plan: 0,
          },
          agents: [],
          plan: { requested: 500, planned: 0, per_agent: [] },
          warnings: ['没有启用话务员', '当前筛选范围无可分配线索'],
        }),
      },
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <SmartAssignment />
      </MemoryRouter>,
    );

    expect(await screen.findByText('没有启用话务员')).toBeInTheDocument();
    expect(screen.getByText('当前筛选范围无可分配线索')).toBeInTheDocument();
    expect(screen.getByText('暂无可执行分配建议')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run preview UI tests to verify they fail**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx
```

Expected: FAIL because the skeleton page does not call the preview API or render the preview sections.

- [ ] **Step 3: Implement preview UI**

Replace `frontend/src/pages/admin/SmartAssignment.jsx` with a focused page that contains these functions and sections:

```jsx
import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Moon,
  RefreshCcw,
  Sun,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useTheme } from '../../context/ThemeContext';
import { useAuth } from '../../context/AuthContext';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import { getApiErrorMessage } from '../../utils';
import { useToast } from '../../components/Toast';
import { ADMIN_OPERATION_PERMISSIONS, canPerformAdminOperation } from '../../adminPermissions';

const numberFmt = new Intl.NumberFormat('zh-CN');

function fmt(value) {
  return numberFmt.format(Number(value || 0));
}

function Metric({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="text-xs text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-gray-900 dark:text-gray-100">{fmt(value)}</div>
      {hint && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  );
}

export default function SmartAssignment() {
  const { dark, toggle } = useTheme();
  const { user } = useAuth();
  const toast = useToast();
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [schoolName, setSchoolName] = useState('');
  const [region, setRegion] = useState('');
  const [limit, setLimit] = useState('500');
  const [perAgentLimit, setPerAgentLimit] = useState('100');
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [executeResult, setExecuteResult] = useState(null);
  const canExecute = canPerformAdminOperation(user, ADMIN_OPERATION_PERMISSIONS.studentAssign);
  const closeSidebar = () => setSidebarOpen(false);

  const previewParams = useMemo(() => ({
    school_name: schoolName.trim(),
    region: region.trim(),
    limit: Number(limit || 500),
    per_agent_limit: Number(perAgentLimit || 100),
  }), [schoolName, region, limit, perAgentLimit]);

  const loadPreview = async () => {
    setLoading(true);
    setExecuteResult(null);
    try {
      const res = await api.get('/admin/smart-assign/preview', { params: previewParams });
      if (res.data.code === 0) {
        setPreview(res.data.data || null);
      } else {
        toast?.error(res.data.msg || '加载智能分配预览失败');
      }
    } catch (e) {
      toast?.error(getApiErrorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pool = preview?.pool || {};
  const plan = preview?.plan || { planned: 0, per_agent: [] };
  const warnings = preview?.warnings || [];

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={closeSidebar}>
      <main className="flex-1 min-w-0">
        <PageHeader title="智能分配" isMobile={isMobile} onMenuClick={() => setSidebarOpen(true)}>
          <button type="button" onClick={toggle} aria-label={dark ? '亮色模式' : '暗色模式'}>
            {dark ? <Sun className="h-5 w-5 text-amber-400" /> : <Moon className="h-5 w-5 text-gray-500" />}
          </button>
        </PageHeader>

        <div className="p-4 lg:p-6 max-w-6xl mx-auto space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end">
              <label className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-200">
                学校
                <input value={schoolName} onChange={(e) => setSchoolName(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
              </label>
              <label className="flex-1 text-sm font-medium text-gray-700 dark:text-gray-200">
                地区
                <input value={region} onChange={(e) => setRegion(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
              </label>
              <label className="w-full text-sm font-medium text-gray-700 dark:text-gray-200 lg:w-40">
                本次分配总量
                <input type="number" min="1" max="5000" value={limit} onChange={(e) => setLimit(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
              </label>
              <label className="w-full text-sm font-medium text-gray-700 dark:text-gray-200 lg:w-40">
                单坐席上限
                <input type="number" min="1" max="1000" value={perAgentLimit} onChange={(e) => setPerAgentLimit(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100" />
              </label>
              <button type="button" onClick={loadPreview} disabled={loading} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-medium text-white disabled:opacity-60">
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCcw className="h-4 w-4" />}
                刷新预览
              </button>
            </div>
          </section>

          {warnings.length > 0 && (
            <section className="space-y-2">
              {warnings.map((warning) => (
                <div key={warning} className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  {warning}
                </div>
              ))}
            </section>
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-gray-900 dark:text-gray-100">分配池概览</h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="未分配线索" value={pool.total_unassigned} />
              <Metric label="可分配线索" value={pool.eligible_total} />
              <Metric label="重复手机号排除" value={pool.excluded_duplicate_phone} />
              <Metric label="状态/资料排除" value={pool.excluded_invalid_status} />
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">坐席负载</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 dark:text-gray-400">
                  <tr>
                    <th className="px-3 py-2 text-left">坐席</th>
                    <th className="px-3 py-2 text-right">活跃任务</th>
                    <th className="px-3 py-2 text-right">未联系</th>
                    <th className="px-3 py-2 text-right">今日拨号</th>
                    <th className="px-3 py-2 text-right">近7天处理</th>
                    <th className="px-3 py-2 text-right">逾期回访</th>
                    <th className="px-3 py-2 text-right">负载分</th>
                    <th className="px-3 py-2 text-right">建议新增</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                  {(preview?.agents || []).map((agent) => (
                    <tr key={agent.agent_id}>
                      <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{agent.agent_name}</td>
                      <td className="px-3 py-2 text-right">{fmt(agent.active_tasks)}</td>
                      <td className="px-3 py-2 text-right">{fmt(agent.not_contacted)}</td>
                      <td className="px-3 py-2 text-right">{fmt(agent.today_calls)}</td>
                      <td className="px-3 py-2 text-right">{fmt(agent.handled_7d)}</td>
                      <td className="px-3 py-2 text-right">{fmt(agent.overdue_follow_ups)}</td>
                      <td className="px-3 py-2 text-right">{agent.load_score}</td>
                      <td className="px-3 py-2 text-right font-semibold text-blue-600">{fmt(agent.suggested_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(!preview?.agents || preview.agents.length === 0) && (
                <div className="py-8 text-center text-sm text-gray-400">暂无可用坐席</div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">分配建议</h2>
              <div className="text-sm font-semibold text-blue-600">计划分配 {fmt(plan.planned)} 条</div>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(plan.per_agent || []).map((item) => (
                <div key={item.agent_id} className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/40">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{item.agent_name}</div>
                  <div className="text-xs text-gray-500 dark:text-gray-400">新增 {fmt(item.count)} 条</div>
                </div>
              ))}
            </div>
            {(!plan.per_agent || plan.per_agent.length === 0) && (
              <div className="mt-3 rounded-lg bg-gray-50 px-3 py-6 text-center text-sm text-gray-400 dark:bg-gray-900/40">
                暂无可执行分配建议
              </div>
            )}
            {executeResult && (
              <div className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200">
                <CheckCircle2 className="h-4 w-4" />
                批次 {executeResult.batch_id}，实际分配 {fmt(executeResult.assigned_count)} 条，跳过 {fmt(executeResult.skipped_count)} 条
              </div>
            )}
            {!canExecute && (
              <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                当前账号仅可查看预览；执行智能分配需要“分配/改派学生”权限。
              </div>
            )}
          </section>
        </div>
      </main>
    </AdminLayout>
  );
}
```

Task 5 will add `handleExecute` and the execute button.

- [ ] **Step 4: Run preview UI tests**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx
```

Expected: PASS for the three preview tests.

- [ ] **Step 5: Commit preview UI**

Run:

```powershell
git add frontend/src/pages/admin/SmartAssignment.jsx frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx
git commit -m "feat: build smart assignment preview UI"
```

Expected: commit succeeds and `git status --short` does not show these files.

---

### Task 5: Frontend Execute Flow and Audit Badge

**Files:**
- Modify: `frontend/src/pages/admin/SmartAssignment.jsx`
- Modify: `frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx`
- Modify: `frontend/src/pages/admin/AuditLogs.jsx`

**Interfaces:**
- Consumes: `POST /api/admin/smart-assign/execute`
- Consumes: `useConfirm()`
- Produces execute success panel with `batch_id`, `assigned_count`, `skipped_count`

- [ ] **Step 1: Add failing execute tests**

Append these tests to `frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx`:

```jsx
const mockConfirm = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../../components/ConfirmDialog', () => ({
  useConfirm: () => mockConfirm,
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    success: mockToastSuccess,
    error: mockToastError,
    warning: vi.fn(),
  }),
}));

it('confirms and executes the current preview parameters', async () => {
  mockConfirm.mockResolvedValue(true);
  api.post.mockResolvedValue({
    data: {
      code: 0,
      data: {
        batch_id: 'smart-assign-20260707150000-abcd1234',
        assigned_count: 500,
        skipped_count: 0,
        per_agent: [],
      },
    },
  });

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SmartAssignment />
    </MemoryRouter>,
  );

  expect(await screen.findByText('计划分配 500 条')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '确认执行智能分配' }));

  await waitFor(() => {
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: '确认执行智能分配',
      confirmText: '确认分配',
    }));
    expect(api.post).toHaveBeenCalledWith('/admin/smart-assign/execute', {
      school_name: '',
      region: '',
      limit: 500,
      per_agent_limit: 100,
      confirm: true,
    });
    expect(mockToastSuccess).toHaveBeenCalledWith('智能分配已执行：500 条');
  });
  expect(screen.getByText(/smart-assign-20260707150000-abcd1234/)).toBeInTheDocument();
});

it('hides execute action when admin lacks student assignment permission', async () => {
  mockUser = {
    id: 2,
    role: 'admin',
    name: '只读管理员',
    is_super_admin: false,
    operation_permissions: [],
  };

  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <SmartAssignment />
    </MemoryRouter>,
  );

  expect(await screen.findByText('当前账号仅可查看预览；执行智能分配需要“分配/改派学生”权限。')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '确认执行智能分配' })).not.toBeInTheDocument();
});
```

If the test file already imports `useConfirm` and `useToast` mocks from Task 4, move `mockConfirm`, `mockToastSuccess`, and `mockToastError` definitions to the top of the file before the `vi.mock()` calls so Vitest can hoist the mocks correctly.

- [ ] **Step 2: Run execute tests to verify they fail**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx
```

Expected: FAIL because there is no execute button or `api.post` call.

- [ ] **Step 3: Implement execute flow**

In `frontend/src/pages/admin/SmartAssignment.jsx`, add imports:

```jsx
import { Send } from 'lucide-react';
import { useConfirm } from '../../components/ConfirmDialog';
```

Inside `SmartAssignment`, add:

```jsx
const confirm = useConfirm();
```

Add this function after `loadPreview`:

```jsx
const handleExecute = async () => {
  if (!canExecute || !preview?.plan?.planned) return;
  const ok = await confirm({
    title: '确认执行智能分配',
    message: `将按当前预览分配 ${preview.plan.planned} 条线索。执行时服务端会重新计算，实际数量可能变化。`,
    confirmText: '确认分配',
  });
  if (!ok) return;
  setExecuting(true);
  try {
    const res = await api.post('/admin/smart-assign/execute', {
      ...previewParams,
      confirm: true,
    });
    if (res.data.code === 0) {
      const data = res.data.data || {};
      setExecuteResult(data);
      toast?.success(`智能分配已执行：${data.assigned_count || 0} 条`);
      await loadPreview();
    } else {
      toast?.error(res.data.msg || '智能分配执行失败');
    }
  } catch (e) {
    toast?.error(getApiErrorMessage(e));
  } finally {
    setExecuting(false);
  }
};
```

In the “分配建议” section, before the read-only permission message, add:

```jsx
{canExecute && plan.planned > 0 && (
  <button
    type="button"
    onClick={handleExecute}
    disabled={executing}
    className="mt-4 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 text-sm font-medium text-white disabled:opacity-60"
  >
    {executing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
    确认执行智能分配
  </button>
)}
```

In `frontend/src/pages/admin/AuditLogs.jsx`, add badge tones:

```jsx
智能分配: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
智能分配汇总: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-200',
```

- [ ] **Step 4: Run execute UI tests**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit execute flow**

Run:

```powershell
git add frontend/src/pages/admin/SmartAssignment.jsx frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx frontend/src/pages/admin/AuditLogs.jsx
git commit -m "feat: execute smart assignment from workbench"
```

Expected: commit succeeds and `git status --short` does not show these files.

---

### Task 6: Full Regression Verification

**Files:**
- No source file changes unless a verification command exposes a real defect.

**Interfaces:**
- Consumes all previous tasks.
- Produces verified implementation status.

- [ ] **Step 1: Run backend targeted tests**

Run:

```powershell
pytest tests/test_smart_assignment.py tests/test_students.py tests/test_admin.py::TestAdminAgents tests/test_call_volume.py -q
```

Expected: PASS.

- [ ] **Step 2: Run frontend targeted tests**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx src/pages/admin/__tests__/LeadGovernance.test.jsx src/__tests__/App.routes.test.jsx src/pages/admin/__tests__/AuditLogs.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Run lint and build checks**

Run:

```powershell
ruff check app tests
```

Expected: PASS with no reported lint errors.

Run:

```powershell
cd frontend
npm run build
```

Expected: Vite build exits with code 0.

- [ ] **Step 4: Inspect final diff**

Run:

```powershell
git status --short
git diff --stat
```

Expected: `git status --short` is empty if every implementation task committed. If verification fixes were needed after the last task, status should only show those fix files.

- [ ] **Step 5: Commit verification fixes if any**

If Step 4 shows files changed by verification fixes, run:

```powershell
git add app frontend tests
git commit -m "fix: polish smart assignment regressions"
```

Expected: commit succeeds. If Step 4 shows a clean tree, skip this step.

---

## Self-Review Notes

- Spec coverage: backend preview, backend execute, duplicate exclusion, fair load, page placement, permissions, audit logs, rollback, frontend preview, frontend execution, empty states, and regression tests are each mapped to a task.
- Type consistency: all tasks use `SmartAssignParams`, `SmartAssignmentPlan`, `build_smart_assignment_plan`, `/api/admin/smart-assign/preview`, and `/api/admin/smart-assign/execute`.
- Scope boundary: first version remains manual-preview/manual-confirm and does not create new database tables or automatic daily assignment.
