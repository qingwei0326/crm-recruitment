# Admissions Work Center Settlement Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a computed admissions work queue for administrators and close the disputed enrollment settlement workflow without adding new database tables.

**Architecture:** Add a computed `GET /api/admissions/work-items` endpoint that aggregates existing `HomeVisitTask`, `CampusVisitTask`, `FollowUp`, `EnrollmentRecord`, and `Student.need_help` data. Refactor the admin work center to consume that endpoint. Enrich enrollment payloads with attribution evidence and update the settlement page so administrators can resolve disputed attribution with a required reason and visible work-phone/WeChat handover policy.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, pytest/httpx, React 18, Vite, Vitest, Testing Library, Tailwind, lucide-react.

## Global Constraints

- Do not add a `work_items` database table in this iteration.
- Do not backfill historical enrollment records.
- Do not change existing enrollment attribution when a student is later reassigned.
- Settlement recognizes exactly one final attributed agent per enrollment.
- Work phone and work WeChat are company communication assets; a handed-over WeChat account is not proof that the departed agent personally converted the enrollment.
- Keep `queue=follow` links working as an alias for the new `queue=follow_up` value.
- Do not deploy to the server as part of this plan.
- Do not revert unrelated working tree changes.

---

## File Structure

- Modify `app/routers/admissions.py`: add computed work-item builders, `GET /work-items`, enrollment evidence payload fields, and richer joinedloads for enrollment lists.
- Create `tests/test_admissions_work_items.py`: backend tests for admin work queue aggregation, queue filtering, sorting, and agent scope.
- Modify `tests/test_admissions.py`: add settlement evidence and disputed-resolution audit assertions beside the existing enrollment tests.
- Modify `frontend/src/pages/admin/AdminWorkCenter.jsx`: replace multi-endpoint local aggregation with the unified admissions work-items endpoint.
- Modify `frontend/src/pages/admin/__tests__/AdminWorkCenter.test.jsx`: update mocks and assertions for home visit, campus visit, follow-up, settlement, and help queue rows.
- Modify `frontend/src/pages/admin/EnrollmentSettlement.jsx`: fetch agents, display attribution evidence and handover policy, and let admins resolve disputed attribution with a required reason.
- Modify `frontend/src/pages/admin/__tests__/AdmissionsWorkflowAdmin.test.jsx`: add settlement dispute/evidence assertions while preserving existing admissions page tests.

---

### Task 1: Backend Computed Work Items

**Files:**
- Create: `tests/test_admissions_work_items.py`
- Modify: `app/routers/admissions.py`

**Interfaces:**
- Produces: `GET /api/admissions/work-items`
- Produces work item dict fields: `id`, `kind`, `queue`, `priority`, `title`, `student_id`, `student_name`, `region`, `school_name`, `agent_id`, `agent_name`, `due_at`, `status`, `reason`, `target_url`, `action_label`, `source_id`, `created_at`
- Consumes existing enum values from `app.models`: `HomeVisitStatus`, `CampusVisitStatus`, `SettlementStatus`

- [ ] **Step 1: Write failing backend tests for the work queue**

Create `tests/test_admissions_work_items.py` with this content:

```python
from datetime import datetime, timedelta

import pytest

from app.auth import create_access_token, hash_password
from app.models import (
    AttributionMethod,
    CampusVisitTask,
    CampusVisitResult,
    CampusVisitStatus,
    EnrollmentRecord,
    EnrollmentSource,
    FollowUp,
    HomeVisitResult,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    SettlementStatus,
    Student,
    StudentStage,
    StudentStatus,
    User,
)


def _headers_for(user: User) -> dict:
    token = create_access_token(
        {
            "sub": str(user.id),
            "role": user.role,
            "tv": user.token_version,
        }
    )
    return {"Authorization": f"Bearer {token}"}


async def _agent(db, username: str, name: str) -> User:
    user = User(
        username=username,
        hashed_password=hash_password("agent123"),
        role="agent",
        name=name,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _student(db, agent: User, name: str, *, need_help: bool = False) -> Student:
    student = Student(
        name=name,
        region="长泰县",
        guardian_phone="13800138000",
        school_name="长泰二中",
        assigned_to=agent.id,
        assigned_at=datetime.now() - timedelta(days=1),
        stage=StudentStage.interested,
        status=StudentStatus.pending_visit,
        intent_level=IntentLevel.A,
        need_help=need_help,
        program="护理",
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)
    return student


@pytest.mark.asyncio
async def test_admin_work_items_include_all_admissions_queues(
    client, db, admin_headers, admin_user
):
    agent = await _agent(db, "work-item-agent", "王坐席")
    student = await _student(db, agent, "待办学生", need_help=True)
    yesterday = datetime.now() - timedelta(days=1)
    tomorrow = datetime.now() + timedelta(days=1)

    home = HomeVisitTask(
        student_id=student.id,
        creator_agent_id=agent.id,
        status=HomeVisitStatus.pending,
        priority="高",
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        requested_visit_time=yesterday,
        address="长泰测试地址",
    )
    completed_home = HomeVisitTask(
        student_id=student.id,
        creator_agent_id=agent.id,
        status=HomeVisitStatus.completed,
        result=HomeVisitResult.waiting_score,
        priority="中",
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        next_follow_up_at=tomorrow,
        address="长泰测试地址",
    )
    campus = CampusVisitTask(
        student_id=student.id,
        creator_user_id=agent.id,
        status=CampusVisitStatus.scheduled,
        appointment_at=yesterday,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program="护理",
    )
    arrived_campus = CampusVisitTask(
        student_id=student.id,
        creator_user_id=agent.id,
        status=CampusVisitStatus.arrived,
        result=CampusVisitResult.considering,
        appointment_at=yesterday,
        next_follow_up_at=tomorrow,
        next_action="继续确认报名",
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program="护理",
    )
    follow = FollowUp(
        student_id=student.id,
        agent_id=agent.id,
        follow_up_date=tomorrow,
        follow_up_type="电话",
        notes="继续跟进",
        is_completed=False,
    )
    enrollment = EnrollmentRecord(
        student_id=student.id,
        attributed_agent_id=agent.id,
        confirmed_by_admin_id=admin_user.id,
        first_assigned_agent_id=agent.id,
        current_assigned_agent_id=agent.id,
        last_effective_agent_id=agent.id,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program="护理",
        enrolled_program="护理",
        source=EnrollmentSource.admin,
        attribution_method=AttributionMethod.current_agent,
        settlement_status=SettlementStatus.disputed,
        settlement_notes="工作微信交接后待确认",
    )
    db.add_all([home, completed_home, campus, arrived_campus, follow, enrollment])
    await db.commit()

    resp = await client.get("/api/admissions/work-items", headers=admin_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    rows = body["data"]["list"]
    keys = {(row["kind"], row["source_id"]) for row in rows}
    assert ("home_visit", home.id) in keys
    assert ("home_visit", completed_home.id) in keys
    assert ("campus_visit", campus.id) in keys
    assert ("campus_visit", arrived_campus.id) in keys
    assert ("follow_up", follow.id) in keys
    assert ("settlement", enrollment.id) in keys
    assert ("help", student.id) in keys
    assert rows[0]["kind"] in {"settlement", "home_visit", "campus_visit"}
    assert all(row["target_url"].startswith("/admin/") for row in rows)


@pytest.mark.asyncio
async def test_work_items_filter_queue_and_accept_follow_alias(
    client, db, admin_headers, admin_user
):
    agent = await _agent(db, "queue-alias-agent", "林坐席")
    student = await _student(db, agent, "别名学生")
    follow = FollowUp(
        student_id=student.id,
        agent_id=agent.id,
        follow_up_date=datetime.now() - timedelta(hours=2),
        follow_up_type="电话",
        is_completed=False,
    )
    enrollment = EnrollmentRecord(
        student_id=student.id,
        attributed_agent_id=agent.id,
        confirmed_by_admin_id=admin_user.id,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        source=EnrollmentSource.admin,
        attribution_method=AttributionMethod.current_agent,
        settlement_status=SettlementStatus.unsettled,
    )
    db.add_all([follow, enrollment])
    await db.commit()

    resp = await client.get("/api/admissions/work-items?queue=follow", headers=admin_headers)

    assert resp.status_code == 200
    rows = resp.json()["data"]["list"]
    assert [row["kind"] for row in rows] == ["follow_up"]
    assert rows[0]["source_id"] == follow.id


@pytest.mark.asyncio
async def test_agent_work_items_are_scoped_to_own_students_and_records(
    client, db
):
    agent = await _agent(db, "scope-agent", "自己坐席")
    other_agent = await _agent(db, "scope-other-agent", "其他坐席")
    own_student = await _student(db, agent, "自己学生")
    other_student = await _student(db, other_agent, "别人学生")
    own_home = HomeVisitTask(
        student_id=own_student.id,
        creator_agent_id=agent.id,
        status=HomeVisitStatus.pending,
        student_name_snapshot=own_student.name,
        guardian_phone_snapshot=own_student.guardian_phone,
        region_snapshot=own_student.region,
        school_name_snapshot=own_student.school_name,
    )
    other_home = HomeVisitTask(
        student_id=other_student.id,
        creator_agent_id=other_agent.id,
        status=HomeVisitStatus.pending,
        student_name_snapshot=other_student.name,
        guardian_phone_snapshot=other_student.guardian_phone,
        region_snapshot=other_student.region,
        school_name_snapshot=other_student.school_name,
    )
    db.add_all([own_home, other_home])
    await db.commit()

    resp = await client.get("/api/admissions/work-items", headers=_headers_for(agent))

    assert resp.status_code == 200
    names = {row["student_name"] for row in resp.json()["data"]["list"]}
    assert "自己学生" in names
    assert "别人学生" not in names
```

- [ ] **Step 2: Run the backend tests and verify they fail**

Run:

```powershell
pytest tests/test_admissions_work_items.py -q
```

Expected: FAIL because `/api/admissions/work-items` does not exist.

- [ ] **Step 3: Add work-item helpers and endpoint**

In `app/routers/admissions.py`, change the datetime import:

```python
from datetime import date, datetime, time, timedelta
```

Add this import:

```python
from app.models import FollowUp
```

`CampusVisitResult` and `HomeVisitResult` are already imported in this file; reuse those existing imports for the next-action constants.

Add these constants below `CAMPUS_VISIT_OPEN_STATUSES`:

```python
WORK_ITEM_QUEUES = {"all", "home_visit", "campus_visit", "follow_up", "settlement", "help"}
WORK_ITEM_QUEUE_ALIASES = {"follow": "follow_up", "visit": "campus_visit"}
WORK_ITEM_PRIORITY_WEIGHT = {"high": 3, "normal": 2, "low": 1}

SETTLEMENT_WORK_STATUSES = {
    SettlementStatus.disputed,
    SettlementStatus.postponed,
    SettlementStatus.unsettled,
}
HOME_VISIT_WORK_STATUSES = {
    HomeVisitStatus.pending,
    HomeVisitStatus.confirmed,
    HomeVisitStatus.scheduled,
    HomeVisitStatus.completed,
    HomeVisitStatus.postponed,
}
CAMPUS_VISIT_WORK_STATUSES = {
    CampusVisitStatus.pending,
    CampusVisitStatus.scheduled,
    CampusVisitStatus.rescheduled,
    CampusVisitStatus.arrived,
    CampusVisitStatus.no_show,
}
HOME_VISIT_NEXT_RESULTS = {
    HomeVisitResult.considering,
    HomeVisitResult.waiting_score,
    HomeVisitResult.campus_visit,
}
CAMPUS_VISIT_NEXT_RESULTS = {
    CampusVisitResult.arrived,
    CampusVisitResult.no_show,
    CampusVisitResult.rescheduled,
    CampusVisitResult.considering,
}
```

Add helper functions above `list_home_visits`:

```python
def _as_dt(value) -> datetime | None:
    return value if isinstance(value, datetime) else None


def _is_overdue(value: datetime | None, now: datetime) -> bool:
    return bool(value and value < now)


def _work_priority(value: str | None, *, urgent: bool = False) -> str:
    if urgent:
        return "high"
    if value == "高":
        return "high"
    if value == "低":
        return "low"
    return "normal"


def _work_item(
    *,
    kind: str,
    source_id: int,
    queue: str,
    priority: str,
    title: str,
    student_id: int,
    student_name: str,
    region: str,
    school_name: str,
    agent_id: int | None,
    agent_name: str,
    due_at,
    status: str,
    reason: str,
    target_url: str,
    action_label: str,
    created_at,
) -> dict:
    return {
        "id": f"{kind}:{source_id}",
        "kind": kind,
        "queue": queue,
        "priority": priority,
        "title": title,
        "student_id": student_id,
        "student_name": student_name,
        "region": region,
        "school_name": school_name,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "due_at": str(due_at) if due_at else None,
        "status": status,
        "reason": reason,
        "target_url": target_url,
        "action_label": action_label,
        "source_id": source_id,
        "created_at": str(created_at) if created_at else None,
    }
```

Add builder functions below those helpers:

```python
async def _build_home_visit_work_items(
    db: AsyncSession,
    current_user: User,
    now: datetime,
) -> list[dict]:
    conditions = [HomeVisitTask.status.in_(HOME_VISIT_WORK_STATUSES)]
    if not is_admin(current_user):
        conditions.append(HomeVisitTask.creator_agent_id == current_user.id)
    result = await db.execute(
        select(HomeVisitTask)
        .options(joinedload(HomeVisitTask.creator_agent))
        .where(*conditions)
        .order_by(HomeVisitTask.created_at.desc())
    )
    rows = []
    for task in result.scalars().unique().all():
        if task.status == HomeVisitStatus.completed and task.result not in HOME_VISIT_NEXT_RESULTS:
            continue
        if task.status == HomeVisitStatus.completed and not (
            task.next_follow_up_at or task.next_action or task.result == HomeVisitResult.campus_visit
        ):
            continue
        due_at = task.next_follow_up_at or task.scheduled_at or task.requested_visit_time
        overdue = _is_overdue(_as_dt(due_at), now)
        if task.status == HomeVisitStatus.pending:
            reason = "家访待确认"
            action_label = "处理家访"
        elif task.status == HomeVisitStatus.confirmed and not task.scheduled_at:
            reason = "家访待安排"
            action_label = "安排家访"
        elif overdue:
            reason = "家访已超期"
            action_label = "处理超期家访"
        elif task.status == HomeVisitStatus.completed:
            reason = "家访后待下一步"
            action_label = "继续推进"
        else:
            reason = "家访待处理"
            action_label = "处理家访"
        rows.append(
            _work_item(
                kind="home_visit",
                source_id=task.id,
                queue="home_visit",
                priority=_work_priority(task.priority, urgent=overdue),
                title=f"{task.student_name_snapshot or '学生'} 家访",
                student_id=task.student_id,
                student_name=task.student_name_snapshot,
                region=task.region_snapshot,
                school_name=task.school_name_snapshot,
                agent_id=task.creator_agent_id,
                agent_name=task.creator_agent.name if task.creator_agent else "",
                due_at=due_at,
                status=task.status.value,
                reason=reason,
                target_url="/admin/home-visits",
                action_label=action_label,
                created_at=task.created_at,
            )
        )
    return rows
```

```python
async def _build_campus_visit_work_items(
    db: AsyncSession,
    current_user: User,
    now: datetime,
) -> list[dict]:
    conditions = [CampusVisitTask.status.in_(CAMPUS_VISIT_WORK_STATUSES)]
    if not is_admin(current_user):
        conditions.append(CampusVisitTask.creator_user_id == current_user.id)
    result = await db.execute(
        select(CampusVisitTask)
        .options(joinedload(CampusVisitTask.creator_user))
        .where(*conditions)
        .order_by(CampusVisitTask.created_at.desc())
    )
    rows = []
    for task in result.scalars().unique().all():
        if task.status in {CampusVisitStatus.arrived, CampusVisitStatus.no_show} and not (
            task.next_follow_up_at or task.next_action or task.result in CAMPUS_VISIT_NEXT_RESULTS
        ):
            continue
        due_at = task.next_follow_up_at or task.appointment_at
        overdue = _is_overdue(_as_dt(due_at), now)
        if task.status == CampusVisitStatus.pending:
            reason = "到校待预约"
            action_label = "预约到校"
        elif task.status in {CampusVisitStatus.arrived, CampusVisitStatus.no_show}:
            reason = "到校后待跟进"
            action_label = "继续跟进"
        elif overdue:
            reason = "到校已超期"
            action_label = "处理到校"
        else:
            reason = "到校待处理"
            action_label = "处理到校"
        rows.append(
            _work_item(
                kind="campus_visit",
                source_id=task.id,
                queue="campus_visit",
                priority=_work_priority(None, urgent=overdue),
                title=f"{task.student_name_snapshot or '学生'} 到校参观",
                student_id=task.student_id,
                student_name=task.student_name_snapshot,
                region=task.region_snapshot,
                school_name=task.school_name_snapshot,
                agent_id=task.creator_user_id,
                agent_name=task.creator_user.name if task.creator_user else "",
                due_at=due_at,
                status=task.status.value,
                reason=reason,
                target_url="/admin/campus-visits",
                action_label=action_label,
                created_at=task.created_at,
            )
        )
    return rows
```

```python
async def _build_follow_up_work_items(db: AsyncSession, current_user: User, now: datetime) -> list[dict]:
    conditions = [FollowUp.is_completed.is_(False)]
    if not is_admin(current_user):
        conditions.append(FollowUp.agent_id == current_user.id)
    result = await db.execute(
        select(FollowUp, Student, User)
        .join(Student, Student.id == FollowUp.student_id)
        .join(User, User.id == FollowUp.agent_id)
        .where(*conditions)
        .order_by(FollowUp.follow_up_date.asc())
    )
    rows = []
    for follow, student, agent in result.all():
        overdue = _is_overdue(follow.follow_up_date, now)
        rows.append(
            _work_item(
                kind="follow_up",
                source_id=follow.id,
                queue="follow_up",
                priority="high" if overdue else "normal",
                title=f"{student.name} 回访",
                student_id=student.id,
                student_name=student.name,
                region=student.region,
                school_name=student.school_name,
                agent_id=agent.id,
                agent_name=agent.name,
                due_at=follow.follow_up_date,
                status="待回访",
                reason="逾期回访" if overdue else "待回访",
                target_url=f"/admin/leads/{student.id}",
                action_label="完成回访",
                created_at=follow.created_at,
            )
        )
    return rows
```

```python
async def _build_settlement_work_items(db: AsyncSession, current_user: User) -> list[dict]:
    conditions = [EnrollmentRecord.settlement_status.in_(SETTLEMENT_WORK_STATUSES)]
    if not is_admin(current_user):
        conditions.append(EnrollmentRecord.attributed_agent_id == current_user.id)
    result = await db.execute(
        select(EnrollmentRecord)
        .options(joinedload(EnrollmentRecord.attributed_agent))
        .where(*conditions)
        .order_by(EnrollmentRecord.enrolled_at.desc())
    )
    rows = []
    for record in result.scalars().unique().all():
        urgent = record.settlement_status == SettlementStatus.disputed
        rows.append(
            _work_item(
                kind="settlement",
                source_id=record.id,
                queue="settlement",
                priority="high" if urgent else "normal",
                title=f"{record.student_name_snapshot or '学生'} 报名结算",
                student_id=record.student_id,
                student_name=record.student_name_snapshot,
                region=record.region_snapshot,
                school_name=record.school_name_snapshot,
                agent_id=record.attributed_agent_id,
                agent_name=record.attributed_agent.name if record.attributed_agent else "",
                due_at=record.enrolled_at,
                status=record.settlement_status.value,
                reason=f"结算{record.settlement_status.value}",
                target_url="/admin/enrollment-settlement",
                action_label="处理结算",
                created_at=record.created_at,
            )
        )
    return rows
```

```python
async def _build_help_work_items(db: AsyncSession, current_user: User) -> list[dict]:
    conditions = [Student.need_help.is_(True)]
    if not is_admin(current_user):
        conditions.append(Student.assigned_to == current_user.id)
    result = await db.execute(
        select(Student, User)
        .outerjoin(User, User.id == Student.assigned_to)
        .where(*conditions)
        .order_by(Student.updated_at.desc())
    )
    rows = []
    for student, agent in result.all():
        rows.append(
            _work_item(
                kind="help",
                source_id=student.id,
                queue="help",
                priority="high",
                title=f"{student.name} 求助",
                student_id=student.id,
                student_name=student.name,
                region=student.region,
                school_name=student.school_name,
                agent_id=student.assigned_to,
                agent_name=agent.name if agent else "",
                due_at=student.updated_at,
                status=student.status.value,
                reason="话务员请求主管介入",
                target_url=f"/admin/leads/{student.id}",
                action_label="处理求助",
                created_at=student.created_at,
            )
        )
    return rows
```

Add the endpoint before `@router.get("/home-visits")`:

```python
@router.get("/work-items")
async def list_work_items(
    queue: str = Query("all"),
    priority: str = Query(""),
    region: str = Query(""),
    agent_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_queue = WORK_ITEM_QUEUE_ALIASES.get(queue, queue)
    if normalized_queue not in WORK_ITEM_QUEUES:
        raise HTTPException(status_code=422, detail="不支持的待办队列")

    now = datetime.now()
    rows: list[dict] = []
    if normalized_queue in {"all", "home_visit"}:
        rows.extend(await _build_home_visit_work_items(db, current_user, now))
    if normalized_queue in {"all", "campus_visit"}:
        rows.extend(await _build_campus_visit_work_items(db, current_user, now))
    if normalized_queue in {"all", "follow_up"}:
        rows.extend(await _build_follow_up_work_items(db, current_user, now))
    if normalized_queue in {"all", "settlement"}:
        rows.extend(await _build_settlement_work_items(db, current_user))
    if normalized_queue in {"all", "help"}:
        rows.extend(await _build_help_work_items(db, current_user))

    if priority:
        rows = [row for row in rows if row["priority"] == priority]
    if region:
        rows = [row for row in rows if region in (row["region"] or "")]
    if agent_id is not None:
        rows = [row for row in rows if row["agent_id"] == agent_id]

    rows.sort(
        key=lambda row: (
            -WORK_ITEM_PRIORITY_WEIGHT.get(row["priority"], 0),
            row["due_at"] or "9999-12-31 23:59:59",
            row["created_at"] or "",
        )
    )
    total = len(rows)
    start = (page - 1) * page_size
    return Response.ok(_page_payload(total, page, page_size, rows[start : start + page_size]))
```

- [ ] **Step 4: Run the new backend tests**

Run:

```powershell
pytest tests/test_admissions_work_items.py -q
```

Expected: PASS.

- [ ] **Step 5: Run admissions regression tests**

Run:

```powershell
pytest tests/test_admissions.py tests/test_stats_reports.py -q
```

Expected: PASS.

- [ ] **Step 6: Commit backend work-items changes**

Run:

```powershell
git add app/routers/admissions.py tests/test_admissions_work_items.py
git commit -m "feat: add admissions work items endpoint"
```

Expected: commit succeeds with only these two files staged.

---

### Task 2: Admin Work Center Unified Queue

**Files:**
- Modify: `frontend/src/pages/admin/AdminWorkCenter.jsx`
- Modify: `frontend/src/pages/admin/__tests__/AdminWorkCenter.test.jsx`

**Interfaces:**
- Consumes: `GET /api/admissions/work-items`
- Consumes work item fields produced in Task 1.
- Preserves: `PUT /api/students/{student_id}` for help completion.
- Preserves: `PUT /api/follow-ups/{source_id}` for follow-up completion.

- [ ] **Step 1: Replace the AdminWorkCenter test data**

In `frontend/src/pages/admin/__tests__/AdminWorkCenter.test.jsx`, replace `mockLoads()` with:

```jsx
function workItems() {
  return [
    {
      id: 'home_visit:101',
      kind: 'home_visit',
      queue: 'home_visit',
      priority: 'high',
      title: '张三 家访',
      student_id: 10,
      student_name: '张三',
      region: '长泰县',
      school_name: '长泰二中',
      agent_id: 7,
      agent_name: '王坐席',
      due_at: '2026-07-02 09:00:00',
      status: '待确认',
      reason: '家访待确认',
      target_url: '/admin/home-visits',
      action_label: '处理家访',
      source_id: 101,
      created_at: '2026-07-01 09:00:00',
    },
    {
      id: 'campus_visit:201',
      kind: 'campus_visit',
      queue: 'campus_visit',
      priority: 'normal',
      title: '李四 到校参观',
      student_id: 11,
      student_name: '李四',
      region: '华安县',
      school_name: '华安一中',
      agent_id: 8,
      agent_name: '赵坐席',
      due_at: '2026-07-03 10:00:00',
      status: '已预约',
      reason: '到校待处理',
      target_url: '/admin/campus-visits',
      action_label: '处理到校',
      source_id: 201,
      created_at: '2026-07-01 10:00:00',
    },
    {
      id: 'follow_up:301',
      kind: 'follow_up',
      queue: 'follow_up',
      priority: 'high',
      title: '王五 回访',
      student_id: 12,
      student_name: '王五',
      region: '长泰县',
      school_name: '长泰三中',
      agent_id: 7,
      agent_name: '王坐席',
      due_at: '2026-06-30 10:00:00',
      status: '待回访',
      reason: '逾期回访',
      target_url: '/admin/leads/12',
      action_label: '完成回访',
      source_id: 301,
      created_at: '2026-06-29 10:00:00',
    },
    {
      id: 'settlement:401',
      kind: 'settlement',
      queue: 'settlement',
      priority: 'high',
      title: '赵六 报名结算',
      student_id: 13,
      student_name: '赵六',
      region: '华安县',
      school_name: '华安二中',
      agent_id: 8,
      agent_name: '赵坐席',
      due_at: '2026-07-01 08:30:00',
      status: '争议',
      reason: '结算争议',
      target_url: '/admin/enrollment-settlement',
      action_label: '处理结算',
      source_id: 401,
      created_at: '2026-07-01 08:30:00',
    },
    {
      id: 'help:501',
      kind: 'help',
      queue: 'help',
      priority: 'high',
      title: '孙七 求助',
      student_id: 501,
      student_name: '孙七',
      region: '长泰县',
      school_name: '长泰四中',
      agent_id: 7,
      agent_name: '王坐席',
      due_at: '2026-07-02 11:00:00',
      status: '待回访',
      reason: '话务员请求主管介入',
      target_url: '/admin/leads/501',
      action_label: '处理求助',
      source_id: 501,
      created_at: '2026-07-01 11:00:00',
    },
  ];
}

function mockLoads() {
  api.get.mockImplementation((url, config = {}) => {
    if (url === '/admissions/work-items') {
      return Promise.resolve({
        data: { data: { total: workItems().length, page: 1, page_size: 100, list: workItems() } },
      });
    }
    return Promise.resolve({ data: { data: { total: 0, list: [] } } });
  });
  api.put.mockResolvedValue({ data: { code: 0, data: {} } });
}
```

- [ ] **Step 2: Update AdminWorkCenter tests**

Replace the first test with:

```jsx
it('loads unified admissions work items for admins', async () => {
  render(
    <MemoryRouter initialEntries={['/admin/work-center']}>
      <AdminWorkCenter />
    </MemoryRouter>,
  );

  expect(await screen.findByText('张三 家访')).toBeInTheDocument();
  expect(screen.getByText('李四 到校参观')).toBeInTheDocument();
  expect(screen.getByText('王五 回访')).toBeInTheDocument();
  expect(screen.getByText('赵六 报名结算')).toBeInTheDocument();
  expect(screen.getByText('孙七 求助')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /家访/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /到校/ })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /结算/ })).toBeInTheDocument();
});
```

Replace the second test with:

```jsx
it('keeps help and follow-up completion actions working', async () => {
  render(
    <MemoryRouter initialEntries={['/admin/work-center']}>
      <AdminWorkCenter />
    </MemoryRouter>,
  );

  await screen.findByText('孙七 求助');

  fireEvent.click(screen.getByRole('button', { name: '已处理求助' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/students/501', { need_help: false }));

  fireEvent.click(screen.getByRole('button', { name: '完成回访' }));
  await waitFor(() => expect(api.put).toHaveBeenCalledWith('/follow-ups/301', { is_completed: true }));
});
```

Add this third test:

```jsx
it('normalizes legacy follow queue links to follow_up', async () => {
  render(
    <MemoryRouter initialEntries={['/admin/work-center?queue=follow']}>
      <AdminWorkCenter />
    </MemoryRouter>,
  );

  expect(await screen.findByText('王五 回访')).toBeInTheDocument();
  expect(screen.queryByText('张三 家访')).not.toBeInTheDocument();
  await waitFor(() => {
    expect(api.get).toHaveBeenCalledWith('/admissions/work-items', {
      params: { queue: 'all', page_size: 100 },
    });
  });
});
```

- [ ] **Step 3: Run the updated frontend test and verify it fails**

Run:

```powershell
cd frontend
npm test -- AdminWorkCenter.test.jsx
```

Expected: FAIL because `AdminWorkCenter` still calls `/students`, `/follow-ups`, and `/visits`.

- [ ] **Step 4: Refactor AdminWorkCenter to use work items**

In `frontend/src/pages/admin/AdminWorkCenter.jsx`:

1. Replace the three arrays `helpRequests`, `followUps`, and `visits` with a single `items` state:

```jsx
const [items, setItems] = useState([]);
```

2. Add queue normalization:

```jsx
function normalizeQueue(value) {
  if (value === 'follow') return 'follow_up';
  if (value === 'visit') return 'campus_visit';
  return value || 'all';
}
```

3. Change `queue` initialization:

```jsx
const queue = normalizeQueue(searchParams.get('queue'));
```

4. Replace `load` with:

```jsx
const load = async () => {
  setLoading(true);
  try {
    const res = await api.get('/admissions/work-items', {
      params: { queue: 'all', page_size: 100 },
    });
    setItems(dataList(res));
  } catch (error) {
    toast?.error(getApiErrorMessage(error));
  } finally {
    setLoading(false);
  }
};
```

5. Change the effect dependency:

```jsx
useEffect(() => {
  load();
}, [queue]);
```

6. Replace queue tabs with:

```jsx
const queueTabs = [
  { key: 'all', label: '全部', count: items.length },
  { key: 'home_visit', label: '家访', count: items.filter((item) => item.queue === 'home_visit').length },
  { key: 'campus_visit', label: '到校', count: items.filter((item) => item.queue === 'campus_visit').length },
  { key: 'follow_up', label: '回访', count: items.filter((item) => item.queue === 'follow_up').length },
  { key: 'settlement', label: '结算', count: items.filter((item) => item.queue === 'settlement').length },
  { key: 'help', label: '求助', count: items.filter((item) => item.queue === 'help').length },
];
```

7. Derive visible rows from the URL queue:

```jsx
const visibleItems = queue === 'all' ? items : items.filter((item) => item.queue === queue);
```

8. Use a single list render with `QueueRow` over `visibleItems`. The row action logic must be:

```jsx
function toneFor(item) {
  if (item.priority === 'high') return 'red';
  if (item.priority === 'low') return 'gray';
  if (item.queue === 'campus_visit') return 'blue';
  if (item.queue === 'settlement') return item.status === '争议' ? 'red' : 'amber';
  return 'amber';
}

function actionFor(item) {
  if (item.kind === 'help') {
    return (
      <button
        type="button"
        onClick={() => completeHelp(item.student_id)}
        disabled={savingKey === `help-${item.student_id}`}
        className="inline-flex min-h-9 items-center gap-1.5 px-3 rounded-lg bg-orange-600 text-white text-sm disabled:opacity-50"
      >
        {savingKey === `help-${item.student_id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        已处理求助
      </button>
    );
  }
  if (item.kind === 'follow_up') {
    return (
      <button
        type="button"
        onClick={() => completeFollowUp(item.source_id)}
        disabled={savingKey === `follow-${item.source_id}`}
        className="inline-flex min-h-9 items-center gap-1.5 px-3 rounded-lg bg-amber-600 text-white text-sm disabled:opacity-50"
      >
        {savingKey === `follow-${item.source_id}` ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
        完成回访
      </button>
    );
  }
  return null;
}
```

9. Remove `updateVisitStatus`; old generic `/visits` confirmation is no longer part of the admissions work center.

- [ ] **Step 5: Run AdminWorkCenter tests**

Run:

```powershell
cd frontend
npm test -- AdminWorkCenter.test.jsx
```

Expected: PASS.

- [ ] **Step 6: Run admissions admin page regression tests**

Run:

```powershell
cd frontend
npm test -- AdmissionsWorkflowAdmin.test.jsx
```

Expected: PASS.

- [ ] **Step 7: Commit frontend work-center changes**

Run:

```powershell
git add frontend/src/pages/admin/AdminWorkCenter.jsx frontend/src/pages/admin/__tests__/AdminWorkCenter.test.jsx
git commit -m "feat: use admissions work items in admin center"
```

Expected: commit succeeds with only these two files staged.

---

### Task 3: Settlement Evidence and Dispute Resolution

**Files:**
- Modify: `app/routers/admissions.py`
- Modify: `tests/test_admissions.py`
- Modify: `frontend/src/pages/admin/EnrollmentSettlement.jsx`
- Modify: `frontend/src/pages/admin/__tests__/AdmissionsWorkflowAdmin.test.jsx`

**Interfaces:**
- Produces additional enrollment payload fields: `first_assigned_agent_name`, `current_assigned_agent_name`, `last_effective_agent_name`, `home_visit_creator_agent_name`, `campus_visit_creator_user_name`, `handover_policy`
- Consumes existing `PATCH /api/admissions/enrollments/{record_id}` with `attributed_agent_id`, `attribution_reason`, `settlement_status`, `settlement_notes`
- Consumes existing `GET /api/admin/agents` for attribution select options.

- [ ] **Step 1: Add backend tests for settlement evidence and audit log**

Append these tests to `tests/test_admissions.py`:

```python
@pytest.mark.asyncio
async def test_enrollment_payload_includes_attribution_evidence(
    client, db, admin_headers, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user, name="证据学生")
    home_resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "证据家访地址"},
        headers=agent_headers,
    )
    home_id = home_resp.json()["data"]["id"]
    campus_resp = await client.post(
        "/api/admissions/campus-visits",
        json={
            "student_id": student.id,
            "home_visit_task_id": home_id,
            "source": "家访后",
            "appointment_at": "2026-07-04T09:30:00",
        },
        headers=admin_headers,
    )
    campus_id = campus_resp.json()["data"]["id"]
    enrollment_resp = await client.post(
        "/api/admissions/enrollments",
        json={
            "student_id": student.id,
            "source": "到校参观后",
            "campus_visit_task_id": campus_id,
        },
        headers=admin_headers,
    )
    enrollment_id = enrollment_resp.json()["data"]["id"]

    list_resp = await client.get("/api/admissions/enrollments", headers=admin_headers)

    row = next(item for item in list_resp.json()["data"]["list"] if item["id"] == enrollment_id)
    assert row["first_assigned_agent_name"] == agent_user.name
    assert row["current_assigned_agent_name"] == agent_user.name
    assert row["last_effective_agent_name"] == agent_user.name
    assert row["home_visit_creator_agent_name"] == agent_user.name
    assert row["campus_visit_creator_user_name"] == agent_user.name
    assert "工作手机/微信属于公司资产" in row["handover_policy"]


@pytest.mark.asyncio
async def test_dispute_resolution_change_writes_operation_log(
    client, db, admin_headers, agent_user
):
    from app.models import OperationLog

    student = await _create_assigned_student(db, agent_user, name="争议处理学生")
    enrollment_resp = await client.post(
        "/api/admissions/enrollments",
        json={"student_id": student.id, "source": "管理员补录"},
        headers=admin_headers,
    )
    enrollment_id = enrollment_resp.json()["data"]["id"]
    other_agent = await _create_agent(db, "resolved-dispute-agent", name="新接手话务员")

    resp = await client.patch(
        f"/api/admissions/enrollments/{enrollment_id}",
        json={
            "attributed_agent_id": other_agent.id,
            "attribution_reason": "工作手机微信已交接，新话务员继续推进后报名",
            "settlement_status": "未结算",
            "settlement_notes": "争议已处理",
        },
        headers=admin_headers,
    )

    assert resp.status_code == 200
    logs = (
        await db.execute(
            select(OperationLog).where(
                OperationLog.target_student_id == student.id,
                OperationLog.action == "修改报名结算",
            )
        )
    ).scalars().all()
    assert logs
    assert "工作手机微信已交接" in logs[-1].note_content
```

- [ ] **Step 2: Run backend tests and verify they fail**

Run:

```powershell
pytest tests/test_admissions.py::test_enrollment_payload_includes_attribution_evidence tests/test_admissions.py::test_dispute_resolution_change_writes_operation_log -q
```

Expected: first test FAILS because evidence fields are missing. The second test may already pass; keep it to guard the resolution flow.

- [ ] **Step 3: Enrich enrollment payloads**

In `app/routers/admissions.py`, update `_enrollment_payload(record)` to include:

```python
"first_assigned_agent_id": record.first_assigned_agent_id,
"first_assigned_agent_name": record.first_assigned_agent.name if record.first_assigned_agent else "",
"current_assigned_agent_id": record.current_assigned_agent_id,
"current_assigned_agent_name": record.current_assigned_agent.name if record.current_assigned_agent else "",
"last_effective_agent_id": record.last_effective_agent_id,
"last_effective_agent_name": record.last_effective_agent.name if record.last_effective_agent else "",
"home_visit_task_id": record.home_visit_task_id,
"home_visit_creator_agent_id": (
    record.home_visit_task.creator_agent_id if record.home_visit_task else None
),
"home_visit_creator_agent_name": (
    record.home_visit_task.creator_agent.name
    if record.home_visit_task and record.home_visit_task.creator_agent
    else ""
),
"campus_visit_task_id": record.campus_visit_task_id,
"campus_visit_creator_user_id": (
    record.campus_visit_task.creator_user_id if record.campus_visit_task else None
),
"campus_visit_creator_user_name": (
    record.campus_visit_task.creator_user.name
    if record.campus_visit_task and record.campus_visit_task.creator_user
    else ""
),
"handover_policy": "工作手机/微信属于公司资产；交接后的同一微信号只能证明沟通渠道连续，不能单独证明原话务员促成报名。",
```

In `list_enrollments`, add joinedloads:

```python
joinedload(EnrollmentRecord.first_assigned_agent),
joinedload(EnrollmentRecord.current_assigned_agent),
joinedload(EnrollmentRecord.last_effective_agent),
joinedload(EnrollmentRecord.home_visit_task).joinedload(HomeVisitTask.creator_agent),
joinedload(EnrollmentRecord.campus_visit_task).joinedload(CampusVisitTask.creator_user),
```

In `_get_enrollment_or_404`, add the same joinedloads so patched records return the same evidence fields.

- [ ] **Step 4: Run backend settlement tests**

Run:

```powershell
pytest tests/test_admissions.py::test_enrollment_payload_includes_attribution_evidence tests/test_admissions.py::test_dispute_resolution_change_writes_operation_log -q
```

Expected: PASS.

- [ ] **Step 5: Add frontend dispute evidence test data**

In `frontend/src/pages/admin/__tests__/AdmissionsWorkflowAdmin.test.jsx`, update `enrollmentRows[0]`:

```jsx
const enrollmentRows = [
  {
    id: 301,
    student_id: 10,
    student_name: '张三',
    region: '龙海',
    school_name: '长泰二中',
    attributed_agent_id: 7,
    attributed_agent_name: '王坐席',
    confirmed_by_admin_name: '管理员',
    source: '到校参观后',
    attribution_method: '自动到校预约人',
    attribution_reason: '',
    settlement_status: '争议',
    settlement_notes: '工作微信交接待确认',
    enrolled_program: '护理',
    enrolled_at: '2026-07-04 08:30:00',
    amount: 500,
    first_assigned_agent_name: '离职话务员',
    current_assigned_agent_name: '王坐席',
    last_effective_agent_name: '王坐席',
    home_visit_creator_agent_name: '离职话务员',
    campus_visit_creator_user_name: '王坐席',
    handover_policy: '工作手机/微信属于公司资产；交接后的同一微信号只能证明沟通渠道连续，不能单独证明原话务员促成报名。',
  },
];
```

Update `summaryRows[0].disputed` to `1`.

- [ ] **Step 6: Add frontend dispute resolution assertions**

In the settlement test, replace the existing settlement status update section with:

```jsx
expect(screen.getByText('工作微信交接待确认')).toBeInTheDocument();
expect(screen.getByText('离职话务员')).toBeInTheDocument();
expect(screen.getByText(/工作手机\/微信属于公司资产/)).toBeInTheDocument();

fireEvent.change(screen.getByLabelText('结算状态 301'), { target: { value: '未结算' } });
fireEvent.change(screen.getByLabelText('归属话务员 301'), { target: { value: '7' } });
fireEvent.change(screen.getByLabelText('归属原因 301'), {
  target: { value: '工作手机微信已交接，新话务员继续推进后报名' },
});
fireEvent.change(screen.getByLabelText('结算备注 301'), { target: { value: '争议已处理' } });
fireEvent.click(screen.getByRole('button', { name: '保存结算 301' }));

await waitFor(() => {
  expect(api.patch).toHaveBeenCalledWith('/admissions/enrollments/301', {
    settlement_status: '未结算',
    settlement_notes: '争议已处理',
    attribution_reason: '工作手机微信已交接，新话务员继续推进后报名',
  });
});
```

Add a second assertion after changing attribution to a different agent:

```jsx
fireEvent.change(screen.getByLabelText('归属话务员 301'), { target: { value: '8' } });
fireEvent.change(screen.getByLabelText('归属原因 301'), {
  target: { value: '管理员确认归属赵坐席' },
});
fireEvent.click(screen.getByRole('button', { name: '保存结算 301' }));

await waitFor(() => {
  expect(api.patch).toHaveBeenLastCalledWith('/admissions/enrollments/301', {
    settlement_status: '未结算',
    settlement_notes: '争议已处理',
    attributed_agent_id: 8,
    attribution_reason: '管理员确认归属赵坐席',
  });
});
```

- [ ] **Step 7: Run frontend settlement test and verify it fails**

Run:

```powershell
cd frontend
npm test -- AdmissionsWorkflowAdmin.test.jsx
```

Expected: FAIL because `EnrollmentSettlement` does not display evidence or attribution controls yet.

- [ ] **Step 8: Implement EnrollmentSettlement evidence and controls**

In `frontend/src/pages/admin/EnrollmentSettlement.jsx`:

1. Add `users` icon import:

```jsx
import { BarChart3, Loader2, Receipt, RefreshCw, UsersRound } from 'lucide-react';
```

2. Add agent state:

```jsx
const [agents, setAgents] = useState([]);
```

3. Load agents with existing data:

```jsx
const [recordsRes, summaryRes, agentsRes] = await Promise.all([
  api.get('/admissions/enrollments', { params: { page_size: 100 } }),
  api.get('/admissions/enrollments/summary'),
  api.get('/admin/agents'),
]);
setAgents(dataList(agentsRes));
```

4. In the settlement form area, add the attribution select and reason input before the notes input:

```jsx
<select
  aria-label={`归属话务员 ${item.id}`}
  value={form.attributed_agent_id || item.attributed_agent_id || ''}
  onChange={(event) => updateForm(item.id, { attributed_agent_id: event.target.value })}
  className="h-9 rounded-lg border border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-gray-900"
>
  <option value="">选择话务员</option>
  {agents.map((agent) => (
    <option key={agent.id} value={agent.id}>{agent.name}</option>
  ))}
</select>
<input
  aria-label={`归属原因 ${item.id}`}
  value={form.attribution_reason || ''}
  onChange={(event) => updateForm(item.id, { attribution_reason: event.target.value })}
  className="h-9 rounded-lg border border-gray-200 px-2 dark:border-gray-700 dark:bg-gray-900"
  placeholder="归属/争议处理原因"
/>
```

5. Add an evidence block under each row's attribution column:

```jsx
<div className="mt-3 rounded-lg border border-gray-100 bg-gray-50 p-3 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900/40 dark:text-gray-300">
  <div className="mb-2 flex items-center gap-1.5 font-medium text-gray-800 dark:text-gray-100">
    <UsersRound className="w-3.5 h-3.5" />
    归属证据
  </div>
  <div>首次分配：{item.first_assigned_agent_name || '-'}</div>
  <div>当前负责：{item.current_assigned_agent_name || '-'}</div>
  <div>最后跟进：{item.last_effective_agent_name || '-'}</div>
  <div>家访申请：{item.home_visit_creator_agent_name || '-'}</div>
  <div>到校预约：{item.campus_visit_creator_user_name || '-'}</div>
  <div className="mt-2 text-amber-700 dark:text-amber-300">{item.handover_policy}</div>
</div>
```

6. Keep existing `saveSettlement` payload behavior, but include `attribution_reason` whenever it is filled:

```jsx
if (String(form.attributed_agent_id || '') !== String(item.attributed_agent_id || '')) {
  payload.attributed_agent_id = Number(form.attributed_agent_id);
  payload.attribution_reason = form.attribution_reason || '';
} else if (form.attribution_reason) {
  payload.attribution_reason = form.attribution_reason;
}
```

- [ ] **Step 9: Run frontend settlement test**

Run:

```powershell
cd frontend
npm test -- AdmissionsWorkflowAdmin.test.jsx
```

Expected: PASS.

- [ ] **Step 10: Run combined backend/frontend regression checks**

Run:

```powershell
pytest tests/test_admissions.py tests/test_admissions_work_items.py tests/test_stats_reports.py -q
```

Expected: PASS.

Run:

```powershell
cd frontend
npm test -- AdminWorkCenter.test.jsx AdmissionsWorkflowAdmin.test.jsx
```

Expected: PASS.

- [ ] **Step 11: Commit settlement closure changes**

Run:

```powershell
git add app/routers/admissions.py tests/test_admissions.py frontend/src/pages/admin/EnrollmentSettlement.jsx frontend/src/pages/admin/__tests__/AdmissionsWorkflowAdmin.test.jsx
git commit -m "feat: close settlement dispute resolution"
```

Expected: commit succeeds with only these four files staged.

---

### Task 4: Final Verification

**Files:**
- No source edits expected in this task.

**Interfaces:**
- Verifies backend work queue, admissions workflow, stats report, work center UI, settlement UI, and frontend build.

- [ ] **Step 1: Run focused backend tests**

Run:

```powershell
pytest tests/test_admissions.py tests/test_admissions_work_items.py tests/test_stats_reports.py tests/test_backfill_enrollment_records.py -q
```

Expected: PASS.

- [ ] **Step 2: Run focused frontend tests**

Run:

```powershell
cd frontend
npm test -- AdminWorkCenter.test.jsx AdmissionsWorkflowAdmin.test.jsx App.routes.test.jsx
```

Expected: PASS.

- [ ] **Step 3: Build frontend**

Run:

```powershell
cd frontend
npm run build
```

Expected: PASS with Vite build output and no fatal errors.

- [ ] **Step 4: Review staged and unstaged changes**

Run:

```powershell
git status --short
```

Expected: only unrelated pre-existing working tree changes remain unstaged, or no changes remain.

- [ ] **Step 5: Report verification results**

Return a concise summary containing:

```text
Backend tests: <command> -> PASS
Frontend tests: <command> -> PASS
Frontend build: <command> -> PASS
Server deploy: not performed
Historical enrollment backfill: not performed
```
