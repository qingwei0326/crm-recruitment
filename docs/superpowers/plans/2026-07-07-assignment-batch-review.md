# 分配批次复盘页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a read-only assignment batch review page that shows whether a distribution batch was dialed, effectively handled, and converted within 1/3/7/14 day windows.

**Architecture:** Add a focused backend statistics service over `OperationLog.batch_id`, expose it through a thin admin router guarded by `audit_logs`, then render a dedicated React admin page. Entry points stay local to the two existing batch surfaces: smart assignment success and audit log rows.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, pytest-asyncio, React, React Router, Vitest, Playwright, Tailwind CSS, lucide-react.

## Global Constraints

- Route: `/admin/assignment-batches/:batchId/review`.
- API: `GET /api/admin/assignment-batches/{batch_id}/review?window_days=7`.
- Permission: page access requires `audit_logs`; do not use `lead_governance` for this page.
- Supported windows: `1`, `3`, `7`, `14`; default is `7`.
- Statistics window starts at batch assignment time and ends at assignment time plus `window_days`.
- Effective handling counts only status progression into a non-`未联系` canonical status.
- Enrollment counts current canonical `StudentStatus.enrolled` or an `EnrollmentRecord` in the window.
- Do not create a new assignment batch table; keep batch identity based on `OperationLog.batch_id`.
- Do not alter assignment execution, rollback execution, or rollback safety behavior.
- `docs/` is ignored by `.gitignore`; plan/spec files require `git add -f`.
- Current worktree has user-side deletions under `docs/superpowers/specs`; do not stage or revert them while implementing this plan.
- Use `.venv-win\Scripts\python.exe -m pytest ...` for backend tests on this machine.
- Playwright config assumes an already running dev server at `http://localhost:5173`.

---

## File Structure

- Create `app/assignment_batch_review.py`: pure backend review builder, constants, parsing helpers, rate helpers, alert rules.
- Create `app/routers/admin_assignment_review.py`: FastAPI endpoint and permission/window validation.
- Modify `app/main.py`: import and include the new router.
- Create `tests/test_assignment_batch_review.py`: service and endpoint tests for counts, windows, permission, invalid input, missing batch.
- Create `frontend/src/pages/admin/AssignmentBatchReview.jsx`: read-only review page.
- Modify `frontend/src/App.jsx`: lazy import and protected route using `ADMIN_PAGE_PERMISSIONS.auditLogs`.
- Modify `frontend/src/__tests__/App.routes.test.jsx`: route mock and permission coverage.
- Create `frontend/src/pages/admin/__tests__/AssignmentBatchReview.test.jsx`: page API/load/window/error tests.
- Modify `frontend/src/pages/admin/SmartAssignment.jsx`: add “查看复盘” link after successful execution.
- Modify `frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx`: assert the success link.
- Modify `frontend/src/pages/admin/AuditLogs.jsx`: add “复盘” link for reviewable assignment batch rows.
- Modify `frontend/src/pages/admin/__tests__/AuditLogs.test.jsx`: assert the audit log link.
- Create `tests/e2e/assignment-batch-review.spec.js`: mocked Playwright smoke from audit logs to review page.

---

### Task 1: Backend Review Statistics Service

**Files:**
- Create: `app/assignment_batch_review.py`
- Create: `tests/test_assignment_batch_review.py`

**Interfaces:**
- Consumes: `OperationLog`, `Student`, `User`, `DialLog`, `EnrollmentRecord`, `parse_assignment_rollback_note`, `canonical_student_status`.
- Produces: `REVIEW_WINDOW_DAYS: tuple[int, ...]` and `async build_assignment_batch_review(db: AsyncSession, batch_id: str, window_days: int = 7) -> dict | None`.

- [ ] **Step 1: Write the failing service tests**

Create `tests/test_assignment_batch_review.py` with this content:

```python
from datetime import datetime, timedelta

import pytest

from app.assignment_batch_review import build_assignment_batch_review
from app.models import DialLog, EnrollmentRecord, OperationLog, Student, StudentStatus, User
from app.utils import make_assignment_rollback_note


def _agent(username: str, name: str) -> User:
    return User(
        username=username,
        hashed_password="x",
        role="agent",
        name=name,
        is_active=True,
    )


def _student(
    name: str,
    *,
    assigned_to: int,
    status=StudentStatus.not_contacted,
    updated_at: datetime | None = None,
) -> Student:
    student = Student(
        name=name,
        region="芗城区",
        school_name="测试中学",
        status=status,
        assigned_to=assigned_to,
        guardian_phone=f"1390000{abs(hash(name)) % 10000:04d}",
        case_no=f"case-{name}",
    )
    if updated_at is not None:
        student.updated_at = updated_at
    return student


def _assignment_log(admin_user, student: Student, agent_id: int, batch_id: str, created_at: datetime):
    return OperationLog(
        operator_id=admin_user.id,
        operator_name=admin_user.name,
        target_student_id=student.id,
        case_no=student.case_no,
        action="智能分配",
        content=f"智能分配给话务员 {agent_id}",
        old_status="unassigned",
        new_status=f"agent:{agent_id}",
        note_content=make_assignment_rollback_note(
            old_assigned_to=None,
            old_assigned_at=None,
            new_assigned_to=agent_id,
            new_assigned_at=created_at,
        ),
        batch_id=batch_id,
        created_at=created_at,
    )


async def _seed_review_batch(db, admin_user, agent_user):
    assigned_at = datetime(2026, 7, 7, 7, 0, 0)
    batch_id = "smart-assign-review-test"
    second_agent = _agent("review_agent_b", "坐席B")
    db.add(second_agent)
    await db.flush()

    handled = _student("已处理学生", assigned_to=agent_user.id)
    untouched = _student("未处理学生", assigned_to=agent_user.id)
    enrolled = _student(
        "已报名学生",
        assigned_to=second_agent.id,
        status=StudentStatus.enrolled,
        updated_at=assigned_at + timedelta(hours=3),
    )
    outside_status = _student(
        "窗口外状态学生",
        assigned_to=second_agent.id,
        status=StudentStatus.contacted,
        updated_at=assigned_at + timedelta(days=10),
    )
    db.add_all([handled, untouched, enrolled, outside_status])
    await db.flush()

    for student, agent_id in [
        (handled, agent_user.id),
        (untouched, agent_user.id),
        (enrolled, second_agent.id),
        (outside_status, second_agent.id),
    ]:
        db.add(_assignment_log(admin_user, student, agent_id, batch_id, assigned_at))

    db.add(
        OperationLog(
            operator_id=admin_user.id,
            operator_name=admin_user.name,
            action="智能分配汇总",
            content="智能分配执行：实际 4 条",
            batch_id=batch_id,
            created_at=assigned_at + timedelta(minutes=1),
        )
    )
    db.add_all(
        [
            DialLog(
                student_id=handled.id,
                agent_id=agent_user.id,
                dialed_at=assigned_at + timedelta(hours=1),
            ),
            DialLog(
                student_id=enrolled.id,
                agent_id=second_agent.id,
                dialed_at=assigned_at + timedelta(hours=2),
            ),
            OperationLog(
                operator_id=agent_user.id,
                operator_name=agent_user.name,
                target_student_id=handled.id,
                case_no=handled.case_no,
                action="修改状态",
                old_status="未联系",
                new_status="已联系",
                content="推进到已联系",
                created_at=assigned_at + timedelta(hours=2),
            ),
            EnrollmentRecord(
                student_id=enrolled.id,
                attributed_agent_id=second_agent.id,
                confirmed_by_admin_id=admin_user.id,
                current_assigned_agent_id=second_agent.id,
                student_name_snapshot=enrolled.name,
                guardian_phone_snapshot=enrolled.guardian_phone,
                region_snapshot=enrolled.region,
                school_name_snapshot=enrolled.school_name,
                enrolled_program="升学班",
                enrolled_at=assigned_at + timedelta(hours=3),
            ),
        ]
    )
    await db.commit()
    return batch_id, assigned_at, second_agent


@pytest.mark.asyncio
async def test_build_assignment_batch_review_counts_funnel_agents_and_unhandled(
    db, admin_user, agent_user
):
    batch_id, assigned_at, second_agent = await _seed_review_batch(db, admin_user, agent_user)

    review = await build_assignment_batch_review(db, batch_id, window_days=7)

    assert review is not None
    assert review["batch"]["batch_id"] == batch_id
    assert review["batch"]["action"] == "智能分配汇总"
    assert review["batch"]["operator_name"] == admin_user.name
    assert review["batch"]["assigned_at"].startswith("2026-07-07 07:00:00")
    assert review["batch"]["assigned_count"] == 4
    assert review["batch"]["window_days"] == 7
    assert review["batch"]["window_start"].startswith(str(assigned_at))
    assert review["funnel"] == {
        "assigned": 4,
        "dialed": 2,
        "effective_handled": 2,
        "enrolled": 1,
        "undialed": 2,
        "unhandled": 2,
        "dial_rate": 50.0,
        "effective_handle_rate": 50.0,
        "enrollment_rate": 25.0,
    }
    rows = {row["agent_id"]: row for row in review["agents"]}
    assert rows[agent_user.id]["agent_name"] == agent_user.name
    assert rows[agent_user.id]["assigned"] == 2
    assert rows[agent_user.id]["dialed"] == 1
    assert rows[agent_user.id]["effective_handled"] == 1
    assert rows[agent_user.id]["enrolled"] == 0
    assert rows[second_agent.id]["agent_name"] == second_agent.name
    assert rows[second_agent.id]["assigned"] == 2
    assert rows[second_agent.id]["dialed"] == 1
    assert rows[second_agent.id]["effective_handled"] == 1
    assert rows[second_agent.id]["enrolled"] == 1
    unhandled_names = {row["student_name"] for row in review["unhandled_students"]}
    assert unhandled_names == {"未处理学生", "窗口外状态学生"}
    assert any(alert["type"] == "undialed_rate" for alert in review["alerts"])


@pytest.mark.asyncio
async def test_build_assignment_batch_review_respects_window_days(
    db, admin_user, agent_user
):
    assigned_at = datetime(2026, 7, 7, 7, 0, 0)
    batch_id = "smart-assign-window-test"
    student = _student("第三天处理学生", assigned_to=agent_user.id)
    db.add(student)
    await db.flush()
    db.add(_assignment_log(admin_user, student, agent_user.id, batch_id, assigned_at))
    db.add(
        OperationLog(
            operator_id=agent_user.id,
            operator_name=agent_user.name,
            target_student_id=student.id,
            case_no=student.case_no,
            action="修改状态",
            old_status="未联系",
            new_status="待回访",
            content="第三天推进",
            created_at=assigned_at + timedelta(days=2, hours=1),
        )
    )
    await db.commit()

    one_day = await build_assignment_batch_review(db, batch_id, window_days=1)
    three_day = await build_assignment_batch_review(db, batch_id, window_days=3)

    assert one_day["funnel"]["effective_handled"] == 0
    assert three_day["funnel"]["effective_handled"] == 1


@pytest.mark.asyncio
async def test_build_assignment_batch_review_returns_none_for_missing_batch(db):
    review = await build_assignment_batch_review(db, "missing-batch", window_days=7)
    assert review is None
```

- [ ] **Step 2: Run the service tests to verify they fail**

Run:

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_batch_review.py::test_build_assignment_batch_review_counts_funnel_agents_and_unhandled tests/test_assignment_batch_review.py::test_build_assignment_batch_review_respects_window_days tests/test_assignment_batch_review.py::test_build_assignment_batch_review_returns_none_for_missing_batch -q
```

Expected: fail during collection with `ModuleNotFoundError: No module named 'app.assignment_batch_review'`.

- [ ] **Step 3: Implement the statistics service**

Create `app/assignment_batch_review.py` with this complete content:

```python
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DialLog, EnrollmentRecord, OperationLog, Student, StudentStatus, User
from app.status_policy import canonical_student_status
from app.utils import parse_assignment_rollback_note

REVIEW_WINDOW_DAYS = (1, 3, 7, 14)

ASSIGNMENT_DETAIL_ACTIONS = {
    "手动分配",
    "自动分配",
    "区域分配",
    "学校分配",
    "多学校分发",
    "智能分配",
}

ASSIGNMENT_SUMMARY_ACTIONS = {
    "批量分配",
    "自动分配汇总",
    "区域分配汇总",
    "学校分配汇总",
    "多学校分发汇总",
    "智能分配汇总",
}

STATUS_CHANGE_ACTIONS = {"修改状态", "修改报名后状态"}


def _as_text(value) -> str:
    return "" if value is None else str(value)


def _rate(part: int, total: int) -> float:
    if total <= 0:
        return 0
    return round(part * 100 / total, 1)


def _canonical_status(value) -> StudentStatus | None:
    try:
        return canonical_student_status(value)
    except ValueError:
        return None


def _is_effective_status(value) -> bool:
    canonical = _canonical_status(value)
    return canonical is not None and canonical != StudentStatus.not_contacted


def _is_enrolled_status(value) -> bool:
    return _canonical_status(value) == StudentStatus.enrolled


def _row_metrics(assigned: int, dialed: int, handled: int, enrolled: int) -> dict:
    undialed = max(assigned - dialed, 0)
    unhandled = max(assigned - handled, 0)
    return {
        "assigned": assigned,
        "dialed": dialed,
        "effective_handled": handled,
        "enrolled": enrolled,
        "undialed": undialed,
        "unhandled": unhandled,
        "dial_rate": _rate(dialed, assigned),
        "effective_handle_rate": _rate(handled, assigned),
        "enrollment_rate": _rate(enrolled, assigned),
    }


def _assignment_agent_id(log: OperationLog, student: Student | None) -> tuple[int | None, bool]:
    payload = parse_assignment_rollback_note(log.note_content or "")
    if payload is not None and "new_assigned_to" in payload:
        return payload.get("new_assigned_to"), False
    return (student.assigned_to if student is not None else None), True


async def build_assignment_batch_review(
    db: AsyncSession,
    batch_id: str,
    window_days: int = 7,
) -> dict | None:
    batch_id = (batch_id or "").strip()
    if not batch_id:
        return None

    detail_rows = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action.in_(ASSIGNMENT_DETAIL_ACTIONS),
            OperationLog.target_student_id.is_not(None),
        )
        .order_by(OperationLog.created_at.asc(), OperationLog.id.asc())
    )
    detail_logs = detail_rows.scalars().all()
    if not detail_logs:
        return None

    summary_rows = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action.in_(ASSIGNMENT_SUMMARY_ACTIONS),
        )
        .order_by(OperationLog.created_at.asc(), OperationLog.id.asc())
    )
    summary_logs = summary_rows.scalars().all()
    summary_log = summary_logs[0] if summary_logs else detail_logs[0]

    student_ids = []
    for log in detail_logs:
        if log.target_student_id not in student_ids:
            student_ids.append(log.target_student_id)

    students_rows = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    students_by_id = {student.id: student for student in students_rows.scalars().all()}

    assigned_at = detail_logs[0].created_at
    window_start = assigned_at
    window_end = assigned_at + timedelta(days=window_days)

    assignments: dict[int, int | None] = {}
    incomplete_assignment_trace = False
    for log in detail_logs:
        student = students_by_id.get(log.target_student_id)
        agent_id, incomplete = _assignment_agent_id(log, student)
        incomplete_assignment_trace = incomplete_assignment_trace or incomplete
        assignments[log.target_student_id] = agent_id

    agent_ids = sorted({agent_id for agent_id in assignments.values() if agent_id is not None})
    users_by_id: dict[int, User] = {}
    if agent_ids:
        user_rows = await db.execute(select(User).where(User.id.in_(agent_ids)))
        users_by_id = {user.id: user for user in user_rows.scalars().all()}

    dial_rows = await db.execute(
        select(DialLog.student_id)
        .where(
            DialLog.student_id.in_(student_ids),
            DialLog.dialed_at >= window_start,
            DialLog.dialed_at < window_end,
        )
        .distinct()
    )
    dialed_student_ids = set(dial_rows.scalars().all())

    status_rows = await db.execute(
        select(OperationLog.target_student_id, OperationLog.new_status)
        .where(
            OperationLog.target_student_id.in_(student_ids),
            OperationLog.action.in_(STATUS_CHANGE_ACTIONS),
            OperationLog.created_at >= window_start,
            OperationLog.created_at < window_end,
        )
    )
    handled_student_ids = {
        student_id
        for student_id, new_status in status_rows.all()
        if student_id is not None and _is_effective_status(new_status)
    }
    for student_id, student in students_by_id.items():
        if student_id in handled_student_ids:
            continue
        if (
            _is_effective_status(student.status)
            and student.updated_at is not None
            and window_start <= student.updated_at < window_end
        ):
            handled_student_ids.add(student_id)

    enrollment_rows = await db.execute(
        select(EnrollmentRecord.student_id)
        .where(
            EnrollmentRecord.student_id.in_(student_ids),
            EnrollmentRecord.enrolled_at >= window_start,
            EnrollmentRecord.enrolled_at < window_end,
        )
        .distinct()
    )
    enrolled_student_ids = set(enrollment_rows.scalars().all())
    for student_id, student in students_by_id.items():
        if _is_enrolled_status(student.status):
            enrolled_student_ids.add(student_id)

    assigned_count = len(student_ids)
    funnel = _row_metrics(
        assigned=assigned_count,
        dialed=len(dialed_student_ids),
        handled=len(handled_student_ids),
        enrolled=len(enrolled_student_ids),
    )

    grouped: dict[int | None, dict[str, set[int]]] = defaultdict(
        lambda: {"assigned": set(), "dialed": set(), "handled": set(), "enrolled": set()}
    )
    for student_id, agent_id in assignments.items():
        grouped[agent_id]["assigned"].add(student_id)
        if student_id in dialed_student_ids:
            grouped[agent_id]["dialed"].add(student_id)
        if student_id in handled_student_ids:
            grouped[agent_id]["handled"].add(student_id)
        if student_id in enrolled_student_ids:
            grouped[agent_id]["enrolled"].add(student_id)

    agents = []
    for agent_id, sets in grouped.items():
        metrics = _row_metrics(
            assigned=len(sets["assigned"]),
            dialed=len(sets["dialed"]),
            handled=len(sets["handled"]),
            enrolled=len(sets["enrolled"]),
        )
        user = users_by_id.get(agent_id) if agent_id is not None else None
        agents.append(
            {
                "agent_id": agent_id,
                "agent_name": user.name if user else ("未记录坐席" if agent_id is None else f"坐席 {agent_id}"),
                **metrics,
            }
        )
    agents.sort(key=lambda row: (-row["assigned"], row["agent_name"]))

    unhandled_students = []
    for student_id in student_ids:
        if student_id in dialed_student_ids and student_id in handled_student_ids:
            continue
        student = students_by_id.get(student_id)
        if student is None:
            continue
        agent_id = assignments.get(student_id)
        user = users_by_id.get(agent_id) if agent_id is not None else None
        unhandled_students.append(
            {
                "student_id": student.id,
                "student_name": student.name,
                "school_name": student.school_name or "",
                "region": student.region or "",
                "agent_id": agent_id,
                "agent_name": user.name if user else ("未记录坐席" if agent_id is None else f"坐席 {agent_id}"),
                "status": _as_text(student.status.value if hasattr(student.status, "value") else student.status),
                "dialed": student_id in dialed_student_ids,
                "effective_handled": student_id in handled_student_ids,
            }
        )

    alerts = []
    if funnel["undialed"] > 0 and funnel["undialed"] / assigned_count > 0.3:
        alerts.append(
            {
                "type": "undialed_rate",
                "severity": "high",
                "title": "未拨打比例偏高",
                "detail": f"窗口内 {funnel['undialed']} 条线索仍未拨打，未拨打率 {funnel['undialed'] * 100 / assigned_count:.1f}%。",
            }
        )
    if assigned_count >= 10 and funnel["effective_handle_rate"] < 50:
        alerts.append(
            {
                "type": "effective_handle_rate",
                "severity": "medium",
                "title": "有效处理率偏低",
                "detail": f"窗口内有效处理率为 {funnel['effective_handle_rate']}%。",
            }
        )
    for row in agents:
        if row["assigned"] >= 5 and row["undialed"] / row["assigned"] > 0.5:
            alerts.append(
                {
                    "type": "agent_undialed_rate",
                    "severity": "medium",
                    "title": f"{row['agent_name']} 未拨打比例偏高",
                    "detail": f"{row['agent_name']} 分到 {row['assigned']} 条，仍有 {row['undialed']} 条未拨打。",
                }
            )
    if incomplete_assignment_trace:
        alerts.append(
            {
                "type": "incomplete_assignment_trace",
                "severity": "medium",
                "title": "部分学生缺少完整分配回溯信息",
                "detail": "部分分配日志缺少回滚元数据，坐席归属使用当前负责人兜底。",
            }
        )

    return {
        "batch": {
            "batch_id": batch_id,
            "action": summary_log.action,
            "operator_name": summary_log.operator_name,
            "assigned_at": _as_text(assigned_at),
            "assigned_count": assigned_count,
            "window_days": window_days,
            "window_start": _as_text(window_start),
            "window_end": _as_text(window_end),
            "incomplete_assignment_trace": incomplete_assignment_trace,
        },
        "funnel": funnel,
        "agents": agents,
        "unhandled_students": unhandled_students,
        "alerts": alerts,
    }
```

- [ ] **Step 4: Run the service tests to verify they pass**

Run:

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_batch_review.py::test_build_assignment_batch_review_counts_funnel_agents_and_unhandled tests/test_assignment_batch_review.py::test_build_assignment_batch_review_respects_window_days tests/test_assignment_batch_review.py::test_build_assignment_batch_review_returns_none_for_missing_batch -q
```

Expected: `3 passed`.

- [ ] **Step 5: Commit the service**

Run:

```powershell
git add app/assignment_batch_review.py tests/test_assignment_batch_review.py
git commit -m "feat: add assignment batch review statistics"
```

Expected: commit succeeds and does not stage deleted files under `docs/superpowers/specs`.

---

### Task 2: Backend Review API

**Files:**
- Modify: `tests/test_assignment_batch_review.py`
- Create: `app/routers/admin_assignment_review.py`
- Modify: `app/main.py`

**Interfaces:**
- Consumes: `build_assignment_batch_review(db, batch_id, window_days)` and `REVIEW_WINDOW_DAYS`.
- Produces: `GET /api/admin/assignment-batches/{batch_id}/review`.

- [ ] **Step 1: Write the failing endpoint tests**

Append these tests to `tests/test_assignment_batch_review.py`:

```python
@pytest.mark.asyncio
async def test_assignment_batch_review_endpoint_requires_audit_logs_permission(
    client, normal_admin_headers
):
    resp = await client.get(
        "/api/admin/assignment-batches/smart-assign-review-test/review",
        headers=normal_admin_headers,
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_assignment_batch_review_endpoint_allows_audit_logs_permission(
    client, db, normal_admin_user, normal_admin_headers, admin_user, agent_user
):
    normal_admin_user.page_permissions = "audit_logs"
    batch_id, _assigned_at, _second_agent = await _seed_review_batch(db, admin_user, agent_user)

    resp = await client.get(
        f"/api/admin/assignment-batches/{batch_id}/review",
        params={"window_days": 7},
        headers=normal_admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["batch"]["batch_id"] == batch_id
    assert body["data"]["funnel"]["assigned"] == 4


@pytest.mark.asyncio
async def test_assignment_batch_review_endpoint_rejects_invalid_window(
    client, admin_headers
):
    resp = await client.get(
        "/api/admin/assignment-batches/smart-assign-review-test/review",
        params={"window_days": 2},
        headers=admin_headers,
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_assignment_batch_review_endpoint_returns_clear_missing_batch(
    client, admin_headers
):
    resp = await client.get(
        "/api/admin/assignment-batches/missing-batch/review",
        headers=admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 1
    assert body["msg"] == "未找到该分配批次"
```

- [ ] **Step 2: Run the endpoint tests to verify they fail**

Run:

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_batch_review.py::test_assignment_batch_review_endpoint_requires_audit_logs_permission tests/test_assignment_batch_review.py::test_assignment_batch_review_endpoint_allows_audit_logs_permission tests/test_assignment_batch_review.py::test_assignment_batch_review_endpoint_rejects_invalid_window tests/test_assignment_batch_review.py::test_assignment_batch_review_endpoint_returns_clear_missing_batch -q
```

Expected: fail with `404 Not Found` for the new route.

- [ ] **Step 3: Add the router**

Create `app/routers/admin_assignment_review.py` with this complete content:

```python
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.assignment_batch_review import REVIEW_WINDOW_DAYS, build_assignment_batch_review
from app.auth import ADMIN_PAGE_AUDIT_LOGS, require_page_permission
from app.database import get_db
from app.models import User
from app.schemas import Response

router = APIRouter(prefix="/api/admin", tags=["管理"])


@router.get("/assignment-batches/{batch_id}/review")
async def assignment_batch_review(
    batch_id: str,
    window_days: int = Query(default=7),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_AUDIT_LOGS)),
):
    batch_id = (batch_id or "").strip()
    if not batch_id:
        return Response.error(code=1, msg="batch_id不能为空")
    if window_days not in REVIEW_WINDOW_DAYS:
        raise HTTPException(status_code=422, detail="window_days 只支持 1、3、7、14")

    review = await build_assignment_batch_review(db, batch_id, window_days=window_days)
    if review is None:
        return Response.error(code=1, msg="未找到该分配批次")
    return Response.ok(review)
```

Modify `app/main.py`.

Add `admin_assignment_review` to the router imports:

```python
from app.routers import (
    admin,
    admin_assignment,
    admin_assignment_review,
    admin_config,
```

Include it immediately after the existing assignment router:

```python
app.include_router(admin_assignment.router)
app.include_router(admin_assignment_review.router)
app.include_router(admin_smart_assignment.router)
```

- [ ] **Step 4: Run the endpoint tests to verify they pass**

Run:

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_batch_review.py -q
```

Expected: all tests in `tests/test_assignment_batch_review.py` pass.

- [ ] **Step 5: Commit the API**

Run:

```powershell
git add app/routers/admin_assignment_review.py app/main.py tests/test_assignment_batch_review.py
git commit -m "feat: expose assignment batch review API"
```

Expected: commit succeeds.

---

### Task 3: Frontend Review Page and Protected Route

**Files:**
- Create: `frontend/src/pages/admin/AssignmentBatchReview.jsx`
- Create: `frontend/src/pages/admin/__tests__/AssignmentBatchReview.test.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/__tests__/App.routes.test.jsx`

**Interfaces:**
- Consumes: `GET /admin/assignment-batches/:batchId/review?window_days=N` through the shared `api` client.
- Produces: route `/admin/assignment-batches/:batchId/review` guarded by `ADMIN_PAGE_PERMISSIONS.auditLogs`.

- [ ] **Step 1: Write the failing frontend tests**

Create `frontend/src/pages/admin/__tests__/AssignmentBatchReview.test.jsx` with this complete content:

```jsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import AssignmentBatchReview from '../AssignmentBatchReview';
import api from '../../../api';

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn(),
  },
}));

vi.mock('../../../hooks/useIsMobile', () => ({
  default: () => false,
}));

vi.mock('../../../components/Toast', () => ({
  useToast: () => ({
    error: vi.fn(),
  }),
}));

const reviewPayload = {
  batch: {
    batch_id: 'smart-assign-review-test',
    action: '智能分配汇总',
    operator_name: '测试管理员',
    assigned_at: '2026-07-07 07:00:00',
    assigned_count: 4,
    window_days: 7,
    window_start: '2026-07-07 07:00:00',
    window_end: '2026-07-14 07:00:00',
    incomplete_assignment_trace: false,
  },
  funnel: {
    assigned: 4,
    dialed: 2,
    effective_handled: 2,
    enrolled: 1,
    undialed: 2,
    unhandled: 2,
    dial_rate: 50,
    effective_handle_rate: 50,
    enrollment_rate: 25,
  },
  agents: [
    {
      agent_id: 1,
      agent_name: '坐席A',
      assigned: 2,
      dialed: 1,
      effective_handled: 1,
      enrolled: 0,
      undialed: 1,
      unhandled: 1,
      dial_rate: 50,
      effective_handle_rate: 50,
      enrollment_rate: 0,
    },
  ],
  unhandled_students: [
    {
      student_id: 101,
      student_name: '未处理学生',
      school_name: '测试中学',
      region: '芗城区',
      agent_id: 1,
      agent_name: '坐席A',
      status: '未联系',
      dialed: false,
      effective_handled: false,
    },
  ],
  alerts: [
    {
      type: 'undialed_rate',
      severity: 'high',
      title: '未拨打比例偏高',
      detail: '窗口内 2 条线索仍未拨打。',
    },
  ],
};

function renderPage() {
  return render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/admin/assignment-batches/smart-assign-review-test/review']}
    >
      <Routes>
        <Route path="/admin/assignment-batches/:batchId/review" element={<AssignmentBatchReview />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('AssignmentBatchReview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { code: 0, data: reviewPayload } });
  });

  it('loads and renders batch funnel, agents, unhandled students, and alerts', async () => {
    renderPage();

    expect(await screen.findByText('分配批次复盘')).toBeInTheDocument();
    expect(screen.getByText('smart-assign-review-test')).toBeInTheDocument();
    expect(screen.getByText('智能分配汇总')).toBeInTheDocument();
    expect(screen.getByText('已分配')).toBeInTheDocument();
    expect(screen.getByText('已拨打')).toBeInTheDocument();
    expect(screen.getByText('有效处理')).toBeInTheDocument();
    expect(screen.getByText('已报名')).toBeInTheDocument();
    expect(screen.getByText('坐席A')).toBeInTheDocument();
    expect(screen.getByText('未处理学生')).toBeInTheDocument();
    expect(screen.getByText('未拨打比例偏高')).toBeInTheDocument();
    expect(api.get).toHaveBeenCalledWith(
      '/admin/assignment-batches/smart-assign-review-test/review',
      { params: { window_days: 7 } },
    );
  });

  it('reloads when switching window days', async () => {
    renderPage();

    expect(await screen.findByText('分配批次复盘')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3天' }));

    await waitFor(() => {
      expect(api.get).toHaveBeenLastCalledWith(
        '/admin/assignment-batches/smart-assign-review-test/review',
        { params: { window_days: 3 } },
      );
    });
  });

  it('shows missing batch state from API code 1', async () => {
    api.get.mockResolvedValue({ data: { code: 1, msg: '未找到该分配批次' } });

    renderPage();

    expect(await screen.findByText('未找到该分配批次')).toBeInTheDocument();
  });
});
```

Modify `frontend/src/__tests__/App.routes.test.jsx`.

Add this mock beside the existing admin page mocks:

```jsx
vi.mock('../pages/admin/AssignmentBatchReview', () => ({
  default: () => <div>assignment batch review page</div>,
}));
```

Add the route to the protected route denial table:

```jsx
['/admin/assignment-batches/batch-1/review', 'assignment batch review page'],
```

Add the route to the allowed permission table:

```jsx
['/admin/assignment-batches/batch-1/review', ['audit_logs'], 'assignment batch review page'],
```

Add this dedicated route assertion near the audit log route assertion:

```jsx
it('routes assignment batch review to the review page', async () => {
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      initialEntries={['/admin/assignment-batches/batch-1/review']}
    >
      <App />
    </MemoryRouter>,
  );

  expect(await screen.findByText('assignment batch review page')).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the frontend tests to verify they fail**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/AssignmentBatchReview.test.jsx src/__tests__/App.routes.test.jsx
```

Expected: fail because `AssignmentBatchReview.jsx` and the route do not exist.

- [ ] **Step 3: Implement the page and route**

Create `frontend/src/pages/admin/AssignmentBatchReview.jsx` with this complete content:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  PhoneCall,
  Users,
} from 'lucide-react';
import AdminLayout from '../../components/AdminLayout';
import PageHeader from '../../components/PageHeader';
import { useToast } from '../../components/Toast';
import useIsMobile from '../../hooks/useIsMobile';
import api from '../../api';
import { formatDateTime, getApiErrorMessage } from '../../utils';

const WINDOWS = [1, 3, 7, 14];
const numberFmt = new Intl.NumberFormat('zh-CN');

function fmt(value) {
  return numberFmt.format(Number(value || 0));
}

function pct(value) {
  return `${Number(value || 0).toFixed(1).replace('.0', '')}%`;
}

function Metric({ label, value, hint, icon: Icon }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</span>
        {Icon && <Icon className="h-4 w-4 text-blue-600 dark:text-blue-300" />}
      </div>
      <div className="mt-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">{fmt(value)}</div>
      {hint && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{hint}</div>}
    </div>
  );
}

function RateCell({ count, rate }) {
  return (
    <div className="text-right">
      <div className="font-medium text-gray-900 dark:text-gray-100">{fmt(count)}</div>
      <div className="text-xs text-gray-500 dark:text-gray-400">{pct(rate)}</div>
    </div>
  );
}

export default function AssignmentBatchReview() {
  const { batchId = '' } = useParams();
  const isMobile = useIsMobile();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [windowDays, setWindowDays] = useState(7);
  const [loading, setLoading] = useState(true);
  const [review, setReview] = useState(null);
  const [error, setError] = useState('');

  const encodedBatchId = useMemo(() => encodeURIComponent(batchId), [batchId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    api
      .get(`/admin/assignment-batches/${encodedBatchId}/review`, {
        params: { window_days: windowDays },
      })
      .then((res) => {
        if (!alive) return;
        if (res.data.code === 0) {
          setReview(res.data.data || null);
          return;
        }
        setReview(null);
        setError(res.data.msg || '分配批次复盘加载失败');
      })
      .catch((err) => {
        if (!alive) return;
        const msg = getApiErrorMessage(err);
        setError(msg);
        toast?.error?.(msg);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encodedBatchId, windowDays]);

  const batch = review?.batch || {};
  const funnel = review?.funnel || {};
  const agents = review?.agents || [];
  const unhandledStudents = review?.unhandled_students || [];
  const alerts = review?.alerts || [];

  return (
    <AdminLayout isMobile={isMobile} sidebarOpen={sidebarOpen} onClose={() => setSidebarOpen(false)}>
      <main className="flex-1 min-w-0">
        <PageHeader
          title="分配批次复盘"
          isMobile={isMobile}
          onMenuClick={() => setSidebarOpen(true)}
        />

        <div className="mx-auto max-w-7xl space-y-4 p-4 lg:p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Link
              to="/admin/audit-logs"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              <ArrowLeft className="h-4 w-4" />
              返回操作记录
            </Link>
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 dark:border-gray-700 dark:bg-gray-800">
              {WINDOWS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => setWindowDays(days)}
                  className={`min-h-8 rounded-md px-3 text-sm font-medium ${
                    windowDays === days
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                >
                  {days}天
                </button>
              ))}
            </div>
          </div>

          {loading && (
            <div className="flex min-h-64 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-400 dark:border-gray-700 dark:bg-gray-800">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200">
              {error}
            </div>
          )}

          {!loading && !error && review && (
            <>
              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="font-mono text-sm text-blue-700 dark:text-blue-300">
                      {batch.batch_id}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-sm text-gray-600 dark:text-gray-300">
                      <span>{batch.action || '-'}</span>
                      <span>操作人：{batch.operator_name || '-'}</span>
                      <span>分配时间：{formatDateTime(batch.assigned_at, true)}</span>
                    </div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                      统计窗口：{formatDateTime(batch.window_start, true)} 至 {formatDateTime(batch.window_end, true)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-900/40 dark:text-gray-300">
                    当前窗口 {batch.window_days || windowDays} 天
                  </div>
                </div>
              </section>

              {alerts.length > 0 && (
                <section className="grid gap-2">
                  {alerts.map((alert) => (
                    <div
                      key={`${alert.type}-${alert.title}`}
                      className="flex gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-200"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <div className="font-medium">{alert.title}</div>
                        <div className="text-xs opacity-90">{alert.detail}</div>
                      </div>
                    </div>
                  ))}
                </section>
              )}

              <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Metric label="已分配" value={funnel.assigned} icon={Users} />
                <Metric label="已拨打" value={funnel.dialed} hint={pct(funnel.dial_rate)} icon={PhoneCall} />
                <Metric label="有效处理" value={funnel.effective_handled} hint={pct(funnel.effective_handle_rate)} icon={CheckCircle2} />
                <Metric label="已报名" value={funnel.enrolled} hint={pct(funnel.enrollment_rate)} icon={CheckCircle2} />
              </section>

              <section className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">处理漏斗</h2>
                <div className="mt-4 grid gap-3 md:grid-cols-4">
                  {[
                    ['已分配', funnel.assigned, 100],
                    ['已拨打', funnel.dialed, funnel.dial_rate],
                    ['有效处理', funnel.effective_handled, funnel.effective_handle_rate],
                    ['已报名', funnel.enrolled, funnel.enrollment_rate],
                  ].map(([label, value, rate]) => (
                    <div key={label}>
                      <div className="mb-1 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span>{label}</span>
                        <span>{pct(rate)}</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-700">
                        <div className="h-full rounded-full bg-blue-600" style={{ width: `${Math.min(Number(rate || 0), 100)}%` }} />
                      </div>
                      <div className="mt-1 text-sm font-medium text-gray-900 dark:text-gray-100">{fmt(value)}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="border-b border-gray-200 px-4 py-3 text-sm font-semibold text-gray-900 dark:border-gray-700 dark:text-gray-100">
                  坐席拆分
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                      <tr>
                        <th className="px-3 py-2 text-left">坐席</th>
                        <th className="px-3 py-2 text-right">分配</th>
                        <th className="px-3 py-2 text-right">拨打</th>
                        <th className="px-3 py-2 text-right">有效处理</th>
                        <th className="px-3 py-2 text-right">报名</th>
                        <th className="px-3 py-2 text-right">未处理</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {agents.map((agent) => (
                        <tr key={agent.agent_id ?? 'unknown'}>
                          <td className="px-3 py-2 font-medium text-gray-900 dark:text-gray-100">{agent.agent_name}</td>
                          <td className="px-3 py-2 text-right">{fmt(agent.assigned)}</td>
                          <td className="px-3 py-2"><RateCell count={agent.dialed} rate={agent.dial_rate} /></td>
                          <td className="px-3 py-2"><RateCell count={agent.effective_handled} rate={agent.effective_handle_rate} /></td>
                          <td className="px-3 py-2"><RateCell count={agent.enrolled} rate={agent.enrollment_rate} /></td>
                          <td className="px-3 py-2 text-right">{fmt(agent.unhandled)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="rounded-lg border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800">
                <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3 dark:border-gray-700">
                  <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">未处理名单</h2>
                  <span className="text-xs text-gray-500 dark:text-gray-400">{fmt(unhandledStudents.length)} 条</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-50 text-xs text-gray-500 dark:bg-gray-900/40 dark:text-gray-400">
                      <tr>
                        <th className="px-3 py-2 text-left">学生</th>
                        <th className="px-3 py-2 text-left">学校/地区</th>
                        <th className="px-3 py-2 text-left">坐席</th>
                        <th className="px-3 py-2 text-left">状态</th>
                        <th className="px-3 py-2 text-left">拨打</th>
                        <th className="px-3 py-2 text-left">有效处理</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {unhandledStudents.map((student) => (
                        <tr key={student.student_id}>
                          <td className="px-3 py-2">
                            <Link className="font-medium text-blue-700 hover:underline dark:text-blue-300" to={`/admin/leads/${student.student_id}`}>
                              {student.student_name}
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{student.school_name || '-'} / {student.region || '-'}</td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{student.agent_name || '-'}</td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{student.status || '-'}</td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{student.dialed ? '已拨打' : '未拨打'}</td>
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{student.effective_handled ? '已处理' : '未处理'}</td>
                        </tr>
                      ))}
                      {unhandledStudents.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-gray-400">
                            该窗口内暂无未处理线索
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </main>
    </AdminLayout>
  );
}
```

Modify `frontend/src/App.jsx`.

Add the lazy import near `SmartAssignment`:

```jsx
const AssignmentBatchReview = lazy(() => import('./pages/admin/AssignmentBatchReview'));
```

Add the protected route after `/admin/smart-assign`:

```jsx
<Route
  path="/admin/assignment-batches/:batchId/review"
  element={
    <Protected role="admin" permission={ADMIN_PAGE_PERMISSIONS.auditLogs}>
      <RouteError><AssignmentBatchReview /></RouteError>
    </Protected>
  }
/>
```

- [ ] **Step 4: Run the frontend page and route tests to verify they pass**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/AssignmentBatchReview.test.jsx src/__tests__/App.routes.test.jsx
```

Expected: both test files pass.

- [ ] **Step 5: Commit the page and route**

Run:

```powershell
git add frontend/src/pages/admin/AssignmentBatchReview.jsx frontend/src/pages/admin/__tests__/AssignmentBatchReview.test.jsx frontend/src/App.jsx frontend/src/__tests__/App.routes.test.jsx
git commit -m "feat: add assignment batch review page"
```

Expected: commit succeeds.

---

### Task 4: Smart Assignment and Audit Log Entry Links

**Files:**
- Modify: `frontend/src/pages/admin/SmartAssignment.jsx`
- Modify: `frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx`
- Modify: `frontend/src/pages/admin/AuditLogs.jsx`
- Modify: `frontend/src/pages/admin/__tests__/AuditLogs.test.jsx`

**Interfaces:**
- Consumes: `executeResult.batch_id`, audit log `batch_id`, `action`, and `can_rollback_assignment`.
- Produces: link text `查看复盘` on smart assignment success and link text `复盘` on reviewable audit log rows.

- [ ] **Step 1: Write failing tests for the entry links**

In `frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx`, extend the execution test by adding these assertions after the existing batch ID assertion:

```jsx
const reviewLink = screen.getByRole('link', { name: '查看复盘' });
expect(reviewLink).toHaveAttribute(
  'href',
  '/admin/assignment-batches/smart-assign-20260707150000-abcd1234/review',
);
```

In `frontend/src/pages/admin/__tests__/AuditLogs.test.jsx`, extend `renders login, assignment, and delete audit rows` by adding:

```jsx
const reviewLink = screen.getByRole('link', { name: '复盘' });
expect(reviewLink).toHaveAttribute(
  'href',
  '/admin/assignment-batches/school-assign-test/review',
);
```

- [ ] **Step 2: Run the entry tests to verify they fail**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx src/pages/admin/__tests__/AuditLogs.test.jsx
```

Expected: fail because the links are not rendered.

- [ ] **Step 3: Add the Smart Assignment success link**

Modify `frontend/src/pages/admin/SmartAssignment.jsx`.

Change the imports:

```jsx
import { Link } from 'react-router-dom';
```

Replace the `executeResult` success block with:

```jsx
{executeResult && (
  <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 dark:border-green-900/50 dark:bg-green-900/20 dark:text-green-200">
    <CheckCircle2 className="h-4 w-4" />
    <span>
      批次 {executeResult.batch_id}，实际分配 {fmt(executeResult.assigned_count)} 条，跳过{' '}
      {fmt(executeResult.skipped_count)} 条
    </span>
    {executeResult.batch_id && (
      <Link
        to={`/admin/assignment-batches/${encodeURIComponent(executeResult.batch_id)}/review`}
        className="rounded-full bg-white px-2 py-1 text-xs font-medium text-green-700 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-200"
      >
        查看复盘
      </Link>
    )}
  </div>
)}
```

- [ ] **Step 4: Add the Audit Logs review link**

Modify `frontend/src/pages/admin/AuditLogs.jsx`.

Change the router import:

```jsx
import { Link, useSearchParams } from 'react-router-dom';
```

Add this set below `actionTone`:

```jsx
const assignmentSummaryActions = new Set([
  '批量分配',
  '自动分配汇总',
  '区域分配汇总',
  '学校分配汇总',
  '多学校分发汇总',
  '智能分配汇总',
]);

function canReviewAssignmentBatch(log) {
  return Boolean(
    log?.batch_id
    && (log.can_rollback_assignment || assignmentSummaryActions.has(log.action)),
  );
}
```

Add this link after the rollback preview button inside the action cell:

```jsx
{canReviewAssignmentBatch(log) && (
  <Link
    to={`/admin/assignment-batches/${encodeURIComponent(log.batch_id)}/review`}
    className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-200"
  >
    复盘
  </Link>
)}
```

- [ ] **Step 5: Run the entry tests to verify they pass**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SmartAssignment.test.jsx src/pages/admin/__tests__/AuditLogs.test.jsx
```

Expected: both test files pass.

- [ ] **Step 6: Commit the entry links**

Run:

```powershell
git add frontend/src/pages/admin/SmartAssignment.jsx frontend/src/pages/admin/__tests__/SmartAssignment.test.jsx frontend/src/pages/admin/AuditLogs.jsx frontend/src/pages/admin/__tests__/AuditLogs.test.jsx
git commit -m "feat: link assignment batches to review"
```

Expected: commit succeeds.

---

### Task 5: Regression, Build, and Playwright Smoke

**Files:**
- Create: `tests/e2e/assignment-batch-review.spec.js`

**Interfaces:**
- Consumes: implemented API/page/links from Tasks 1-4.
- Produces: final evidence that backend tests, frontend tests, lint/build, and browser smoke pass.

- [ ] **Step 1: Add the Playwright smoke spec**

Create `tests/e2e/assignment-batch-review.spec.js` with this complete content:

```javascript
// @ts-check
const { test, expect } = require('@playwright/test');

const adminUser = {
  id: 1,
  username: 'review-admin',
  name: '复盘管理员',
  role: 'admin',
  is_active: true,
  is_super_admin: true,
  must_change_password: false,
};

function ok(data) {
  return { code: 0, data };
}

async function mockApis(page) {
  await page.addInitScript((user) => {
    localStorage.setItem('crm_user', JSON.stringify(user));
  }, adminUser);

  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api', '');

    if (path === '/auth/me') {
      await route.fulfill({ json: ok(adminUser) });
      return;
    }
    if (path === '/admin/users') {
      await route.fulfill({ json: ok([adminUser]) });
      return;
    }
    if (path === '/operation-logs') {
      await route.fulfill({
        json: ok({
          total: 1,
          page: 1,
          page_size: 50,
          actions: [{ action: '智能分配汇总', count: 1 }],
          categories: [{ category: '分配', count: 1 }],
          list: [
            {
              seq: 1,
              id: 1,
              operator_id: 1,
              operator_name: '复盘管理员',
              action: '智能分配汇总',
              category: '分配',
              content: '智能分配执行：实际 4 条',
              batch_id: 'smart-assign-review-test',
              can_rollback_assignment: true,
              student_id: null,
              student_name: '',
              student_school_name: '',
              case_no: '',
              created_at: '2026-07-07 07:01:00',
            },
          ],
        }),
      });
      return;
    }
    if (path === '/admin/assignment-batches/smart-assign-review-test/review') {
      await route.fulfill({
        json: ok({
          batch: {
            batch_id: 'smart-assign-review-test',
            action: '智能分配汇总',
            operator_name: '复盘管理员',
            assigned_at: '2026-07-07 07:00:00',
            assigned_count: 4,
            window_days: Number(url.searchParams.get('window_days') || 7),
            window_start: '2026-07-07 07:00:00',
            window_end: '2026-07-14 07:00:00',
            incomplete_assignment_trace: false,
          },
          funnel: {
            assigned: 4,
            dialed: 2,
            effective_handled: 2,
            enrolled: 1,
            undialed: 2,
            unhandled: 2,
            dial_rate: 50,
            effective_handle_rate: 50,
            enrollment_rate: 25,
          },
          agents: [
            {
              agent_id: 7,
              agent_name: '坐席A',
              assigned: 4,
              dialed: 2,
              effective_handled: 2,
              enrolled: 1,
              undialed: 2,
              unhandled: 2,
              dial_rate: 50,
              effective_handle_rate: 50,
              enrollment_rate: 25,
            },
          ],
          unhandled_students: [
            {
              student_id: 101,
              student_name: '未处理学生',
              school_name: '测试中学',
              region: '芗城区',
              agent_id: 7,
              agent_name: '坐席A',
              status: '未联系',
              dialed: false,
              effective_handled: false,
            },
          ],
          alerts: [
            {
              type: 'undialed_rate',
              severity: 'high',
              title: '未拨打比例偏高',
              detail: '窗口内 2 条线索仍未拨打。',
            },
          ],
        }),
      });
      return;
    }

    await route.fulfill({ json: ok({}) });
  });
}

test('opens assignment batch review from audit logs and switches window', async ({ page }) => {
  await mockApis(page);

  await page.goto('/admin/audit-logs');
  await expect(page.getByText('智能分配执行：实际 4 条')).toBeVisible();
  await page.getByRole('link', { name: '复盘' }).click();

  await expect(page).toHaveURL(/\/admin\/assignment-batches\/smart-assign-review-test\/review/);
  await expect(page.getByText('分配批次复盘')).toBeVisible();
  await expect(page.getByText('smart-assign-review-test')).toBeVisible();
  await expect(page.getByText('未拨打比例偏高')).toBeVisible();
  await expect(page.getByText('未处理学生')).toBeVisible();

  await page.getByRole('button', { name: '3天' }).click();
  await expect(page.getByText('当前窗口 3 天')).toBeVisible();
});
```

- [ ] **Step 2: Run targeted backend tests**

Run:

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_batch_review.py tests/test_smart_assignment.py tests/test_call_volume.py -q
```

Expected: all selected backend tests pass.

- [ ] **Step 3: Run backend lint**

Run:

```powershell
.venv-win\Scripts\python.exe -m ruff check app tests
```

Expected: `All checks passed!`.

- [ ] **Step 4: Run targeted frontend tests**

Run:

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/AssignmentBatchReview.test.jsx src/pages/admin/__tests__/SmartAssignment.test.jsx src/pages/admin/__tests__/AuditLogs.test.jsx src/__tests__/App.routes.test.jsx
```

Expected: all selected frontend tests pass.

- [ ] **Step 5: Build the frontend**

Run:

```powershell
cd frontend
npm run build
```

Expected: Vite build completes successfully.

- [ ] **Step 6: Run Playwright smoke with a local dev server**

Start Vite from the repo root:

```powershell
Start-Process -FilePath "cmd.exe" -ArgumentList @('/c','npm run dev -- --host 127.0.0.1 --port 5173') -WorkingDirectory (Join-Path (Get-Location).Path 'frontend') -WindowStyle Hidden
```

Wait until the server responds:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:5173/' -TimeoutSec 5
```

Run Playwright:

```powershell
npx playwright test tests/e2e/assignment-batch-review.spec.js
```

Expected: `1 passed`.

Stop the Vite process found on port `5173` after the smoke run:

```powershell
Get-NetTCPConnection -LocalPort 5173 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

- [ ] **Step 7: Commit the smoke test and final verification state**

Run:

```powershell
git add tests/e2e/assignment-batch-review.spec.js
git commit -m "test: cover assignment batch review smoke"
```

Expected: commit succeeds.

- [ ] **Step 8: Final status check**

Run:

```powershell
git status --short
```

Expected: only pre-existing user-side deletions under `docs/superpowers/specs` remain unstaged. No implementation files from this plan should be unstaged.

---

## Self-Review Notes

- Spec coverage: backend API, `audit_logs` permission, 1/3/7/14 windows, status-only effective handling, enrollment counting, read-only page, smart assignment entry, audit log entry, and Playwright smoke are all covered by tasks.
- Placeholder scan: this plan uses exact file paths, concrete snippets, commands, expected outputs, and commit messages.
- Type consistency: backend service returns `batch`, `funnel`, `agents`, `unhandled_students`, and `alerts`; the frontend page and tests consume the same keys.
