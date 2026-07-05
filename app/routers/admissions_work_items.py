from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import ADMIN_PAGE_WORK_CENTER, get_current_user
from app.database import get_db
from app.models import (
    CampusVisitResult,
    CampusVisitStatus,
    CampusVisitTask,
    EnrollmentRecord,
    FollowUp,
    HomeVisitResult,
    HomeVisitStatus,
    HomeVisitTask,
    SettlementStatus,
    Student,
    User,
)
from app.permissions import is_admin
from app.routers.admissions import _page_payload, _require_admin_module
from app.schemas import Response

router = APIRouter(prefix="/api/admissions", tags=["招生推进"])

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
HOME_VISIT_NEXT_RESULTS = {
    HomeVisitResult.considering,
    HomeVisitResult.waiting_score,
    HomeVisitResult.campus_visit,
}
CAMPUS_VISIT_WORK_STATUSES = {
    CampusVisitStatus.pending,
    CampusVisitStatus.scheduled,
    CampusVisitStatus.rescheduled,
    CampusVisitStatus.arrived,
    CampusVisitStatus.no_show,
}
CAMPUS_VISIT_NEXT_RESULTS = {
    CampusVisitResult.arrived,
    CampusVisitResult.no_show,
    CampusVisitResult.rescheduled,
    CampusVisitResult.considering,
}


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
            task.next_follow_up_at
            or task.next_action
            or task.result == HomeVisitResult.campus_visit
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
        elif task.status == HomeVisitStatus.completed:
            reason = "家访后待下一步"
            action_label = "继续推进"
        elif overdue:
            reason = "家访已超期"
            action_label = "处理超期家访"
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


async def _build_follow_up_work_items(
    db: AsyncSession,
    current_user: User,
    now: datetime,
) -> list[dict]:
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
    _require_admin_module(current_user, ADMIN_PAGE_WORK_CENTER)
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
