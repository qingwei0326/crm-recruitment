from __future__ import annotations

from collections import defaultdict
from datetime import timedelta

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


def _student_status_text(student: Student) -> str:
    status = student.status
    return status.value if hasattr(status, "value") else _as_text(status)


def _agent_name(agent_id: int | None, users_by_id: dict[int, User]) -> str:
    if agent_id is None:
        return "未记录坐席"
    user = users_by_id.get(agent_id)
    return user.name if user else f"坐席 {agent_id}"


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

    student_ids: list[int] = []
    for log in detail_logs:
        if log.target_student_id is not None and log.target_student_id not in student_ids:
            student_ids.append(log.target_student_id)

    students_rows = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    students_by_id = {student.id: student for student in students_rows.scalars().all()}

    assigned_at = detail_logs[0].created_at
    window_start = assigned_at
    window_end = assigned_at + timedelta(days=window_days)

    assignments: dict[int, int | None] = {}
    incomplete_assignment_trace = False
    for log in detail_logs:
        student_id = log.target_student_id
        if student_id is None:
            continue
        student = students_by_id.get(student_id)
        agent_id, incomplete = _assignment_agent_id(log, student)
        incomplete_assignment_trace = incomplete_assignment_trace or incomplete
        assignments[student_id] = agent_id

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
        select(OperationLog.target_student_id, OperationLog.new_status).where(
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
        agents.append(
            {
                "agent_id": agent_id,
                "agent_name": _agent_name(agent_id, users_by_id),
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
        unhandled_students.append(
            {
                "student_id": student.id,
                "student_name": student.name,
                "school_name": student.school_name or "",
                "region": student.region or "",
                "agent_id": agent_id,
                "agent_name": _agent_name(agent_id, users_by_id),
                "status": _student_status_text(student),
                "dialed": student_id in dialed_student_ids,
                "effective_handled": student_id in handled_student_ids,
            }
        )

    alerts = []
    if assigned_count and funnel["undialed"] / assigned_count > 0.3:
        undialed_rate = _rate(funnel["undialed"], assigned_count)
        alerts.append(
            {
                "type": "undialed_rate",
                "severity": "high",
                "title": "未拨打比例偏高",
                "detail": (
                    f"窗口内 {funnel['undialed']} 条线索仍未拨打，"
                    f"未拨打率 {undialed_rate}%。"
                ),
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
                    "detail": (
                        f"{row['agent_name']} 分到 {row['assigned']} 条，"
                        f"仍有 {row['undialed']} 条未拨打。"
                    ),
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
