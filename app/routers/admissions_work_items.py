from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.auth import ADMIN_PAGE_WORK_CENTER, get_current_user
from app.database import get_db
from app.domain_models import WorkItem, WorkItemKind, WorkItemStatus
from app.expiry import build_last_activity_subquery
from app.models import (
    CampusVisitResult,
    CampusVisitStatus,
    CampusVisitTask,
    EnrollmentRecord,
    FollowUp,
    HomeVisitResult,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    SettlementStatus,
    Student,
    StudentStatus,
    User,
)
from app.permissions import is_admin
from app.routers.admissions import _page_payload, _require_admin_module
from app.schemas import Response
from app.status_policy import statuses_for_canonical
from app.task_stats import TERMINAL_STUDENT_STATUSES

router = APIRouter(prefix="/api/admissions", tags=["招生推进"])

WORK_ITEM_QUEUES = {
    "all",
    "lead_contact",
    "home_visit",
    "campus_visit",
    "follow_up",
    "settlement",
    "help",
    "stale-a",
}
WORK_ITEM_QUEUE_ALIASES = {
    "follow": "follow_up",
    "visit": "campus_visit",
    "lead": "lead_contact",
    "initial_contact": "lead_contact",
    "stale_a": "stale-a",
}
WORK_ITEM_PRIORITY_WEIGHT = {"high": 3, "normal": 2, "low": 1}
ACTIVE_WORK_ITEM_STATUSES = {
    WorkItemStatus.open,
    WorkItemStatus.blocked_suspension,
}
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
    if value in {"高", "high"}:
        return "high"
    if value in {"低", "low"}:
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
        "next_action": {
            "kind": {
                "follow_up": WorkItemKind.scheduled_follow_up.value,
                "settlement": WorkItemKind.enrollment_settlement.value,
                "help": WorkItemKind.help_request.value,
            }.get(kind, kind),
            "label": action_label,
            "owner_id": agent_id,
            "owner_name": agent_name,
            "due_at": str(due_at) if due_at else None,
            "priority": priority,
            "target_url": target_url,
            "source_id": source_id,
            "reason": reason,
        },
    }


async def _build_lead_contact_work_items(
    db: AsyncSession,
    current_user: User,
) -> list[dict]:
    owner = aliased(User)
    conditions = [
        Student.status.in_(statuses_for_canonical(StudentStatus.not_contacted)),
        WorkItem.kind == WorkItemKind.lead_contact,
        WorkItem.source_type == "student",
        WorkItem.source_id == Student.id,
        WorkItem.status.in_(ACTIVE_WORK_ITEM_STATUSES),
    ]
    if not is_admin(current_user):
        conditions.append(WorkItem.owner_agent_id == current_user.id)

    result = await db.execute(
        select(Student, WorkItem, owner)
        .join(
            WorkItem,
            and_(
                WorkItem.kind == WorkItemKind.lead_contact,
                WorkItem.source_type == "student",
                WorkItem.source_id == Student.id,
            ),
        )
        .join(owner, owner.id == WorkItem.owner_agent_id)
        .where(*conditions)
        .order_by(Student.assigned_at.asc(), Student.created_at.asc(), Student.id.asc())
    )
    rows = []
    for student, work_item, owner_user in result.all():
        rows.append(
            _work_item(
                kind="lead_contact",
                source_id=student.id,
                queue="lead_contact",
                priority=_work_priority(work_item.priority),
                title=f"{student.name} 首次联系",
                student_id=student.id,
                student_name=student.name,
                region=student.region,
                school_name=student.school_name,
                agent_id=work_item.owner_agent_id,
                agent_name=owner_user.name,
                due_at=work_item.due_at,
                status=student.status.value,
                reason="待首次联系",
                target_url=f"/admin/leads/{student.id}",
                action_label="开始首呼",
                created_at=student.assigned_at or student.created_at,
            )
        )
    return rows


async def _build_stale_a_work_items(
    db: AsyncSession,
    current_user: User,
    now: datetime,
    days: int,
) -> list[dict]:
    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("latest_activity_at")
    conditions = [
        Student.intent_level == IntentLevel.A,
        Student.status.not_in(TERMINAL_STUDENT_STATUSES),
        latest_activity_at < now - timedelta(days=days),
    ]
    if not is_admin(current_user):
        conditions.append(Student.assigned_to == current_user.id)

    result = await db.execute(
        select(Student, User.name.label("agent_name"), latest_activity_at)
        .outerjoin(User, User.id == Student.assigned_to)
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(*conditions)
        .order_by(latest_activity_at.asc(), Student.id.asc())
    )
    rows = []
    for student, agent_name, raw_last_activity_at in result.all():
        last_activity_at = _as_dt(raw_last_activity_at)
        days_since = max((now - last_activity_at).days, 0) if last_activity_at else 0
        rows.append(
            _work_item(
                kind="stale_a",
                source_id=student.id,
                queue="stale-a",
                priority="high",
                title=f"{student.name or '未命名学生'} A 级超时",
                student_id=student.id,
                student_name=student.name,
                region=student.region,
                school_name=student.school_name,
                agent_id=student.assigned_to,
                agent_name=agent_name or "",
                due_at=last_activity_at,
                status=student.status.value,
                reason=f"{days_since}天未推进",
                target_url=f"/admin/leads/{student.id}",
                action_label="处理超时线索",
                created_at=student.created_at,
            )
        )
    return rows


async def _build_home_visit_work_items(
    db: AsyncSession,
    current_user: User,
    now: datetime,
) -> list[dict]:
    owner = aliased(User)
    conditions = [
        HomeVisitTask.status.in_(HOME_VISIT_WORK_STATUSES),
        WorkItem.status.in_(ACTIVE_WORK_ITEM_STATUSES),
    ]
    if not is_admin(current_user):
        conditions.append(WorkItem.owner_agent_id == current_user.id)

    result = await db.execute(
        select(HomeVisitTask, WorkItem, owner)
        .join(
            WorkItem,
            and_(
                WorkItem.kind == WorkItemKind.home_visit,
                WorkItem.source_type == "home_visit",
                WorkItem.source_id == HomeVisitTask.id,
            ),
        )
        .join(owner, owner.id == WorkItem.owner_agent_id)
        .where(*conditions)
        .order_by(HomeVisitTask.created_at.desc())
    )
    rows = []
    for task, work_item, owner_user in result.all():
        if task.status == HomeVisitStatus.completed and task.result not in HOME_VISIT_NEXT_RESULTS:
            continue
        if task.status == HomeVisitStatus.completed and not (
            task.next_follow_up_at
            or task.next_action
            or task.result == HomeVisitResult.campus_visit
        ):
            continue

        due_at = (
            work_item.due_at
            or task.next_follow_up_at
            or task.scheduled_at
            or task.requested_visit_time
        )
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
                priority=_work_priority(work_item.priority, urgent=overdue),
                title=f"{task.student_name_snapshot or '学生'} 家访",
                student_id=task.student_id,
                student_name=task.student_name_snapshot,
                region=task.region_snapshot,
                school_name=task.school_name_snapshot,
                agent_id=work_item.owner_agent_id,
                agent_name=owner_user.name,
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
    owner = aliased(User)
    conditions = [
        CampusVisitTask.status.in_(CAMPUS_VISIT_WORK_STATUSES),
        WorkItem.status.in_(ACTIVE_WORK_ITEM_STATUSES),
    ]
    if not is_admin(current_user):
        conditions.append(WorkItem.owner_agent_id == current_user.id)

    result = await db.execute(
        select(CampusVisitTask, WorkItem, owner)
        .join(
            WorkItem,
            and_(
                WorkItem.kind == WorkItemKind.campus_visit,
                WorkItem.source_type == "campus_visit",
                WorkItem.source_id == CampusVisitTask.id,
            ),
        )
        .join(owner, owner.id == WorkItem.owner_agent_id)
        .where(*conditions)
        .order_by(CampusVisitTask.created_at.desc())
    )
    rows = []
    for task, work_item, owner_user in result.all():
        if task.status in {CampusVisitStatus.arrived, CampusVisitStatus.no_show} and not (
            task.next_follow_up_at or task.next_action or task.result in CAMPUS_VISIT_NEXT_RESULTS
        ):
            continue

        due_at = work_item.due_at or task.next_follow_up_at or task.appointment_at
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
                priority=_work_priority(work_item.priority, urgent=overdue),
                title=f"{task.student_name_snapshot or '学生'} 到校参观",
                student_id=task.student_id,
                student_name=task.student_name_snapshot,
                region=task.region_snapshot,
                school_name=task.school_name_snapshot,
                agent_id=work_item.owner_agent_id,
                agent_name=owner_user.name,
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
    owner = aliased(User)
    conditions = [
        FollowUp.is_completed.is_(False),
        WorkItem.status.in_(ACTIVE_WORK_ITEM_STATUSES),
    ]
    if not is_admin(current_user):
        conditions.append(WorkItem.owner_agent_id == current_user.id)

    result = await db.execute(
        select(FollowUp, Student, WorkItem, owner)
        .join(Student, Student.id == FollowUp.student_id)
        .join(
            WorkItem,
            and_(
                WorkItem.kind == WorkItemKind.scheduled_follow_up,
                WorkItem.source_type == "follow_up",
                WorkItem.source_id == FollowUp.id,
            ),
        )
        .join(owner, owner.id == WorkItem.owner_agent_id)
        .where(*conditions)
        .order_by(FollowUp.follow_up_date.asc())
    )
    rows = []
    for follow, student, work_item, owner_user in result.all():
        due_at = work_item.due_at or follow.follow_up_date
        overdue = _is_overdue(due_at, now)
        rows.append(
            _work_item(
                kind="follow_up",
                source_id=follow.id,
                queue="follow_up",
                priority=_work_priority(work_item.priority, urgent=overdue),
                title=f"{student.name} 回访",
                student_id=student.id,
                student_name=student.name,
                region=student.region,
                school_name=student.school_name,
                agent_id=work_item.owner_agent_id,
                agent_name=owner_user.name,
                due_at=due_at,
                status="待回访",
                reason="逾期回访" if overdue else "待回访",
                target_url=f"/admin/leads/{student.id}",
                action_label="完成回访",
                created_at=follow.created_at,
            )
        )
    return rows


async def _build_settlement_work_items(db: AsyncSession, current_user: User) -> list[dict]:
    owner = aliased(User)
    conditions = [
        EnrollmentRecord.settlement_status.in_(SETTLEMENT_WORK_STATUSES),
        WorkItem.status.in_(ACTIVE_WORK_ITEM_STATUSES),
    ]
    if not is_admin(current_user):
        conditions.append(WorkItem.owner_agent_id == current_user.id)

    result = await db.execute(
        select(EnrollmentRecord, WorkItem, owner)
        .join(
            WorkItem,
            and_(
                WorkItem.kind == WorkItemKind.enrollment_settlement,
                WorkItem.source_type == "enrollment",
                WorkItem.source_id == EnrollmentRecord.id,
            ),
        )
        .join(owner, owner.id == WorkItem.owner_agent_id)
        .where(*conditions)
        .order_by(EnrollmentRecord.enrolled_at.desc())
    )
    rows = []
    for record, work_item, owner_user in result.all():
        urgent = record.settlement_status == SettlementStatus.disputed
        rows.append(
            _work_item(
                kind="settlement",
                source_id=record.id,
                queue="settlement",
                priority=_work_priority(work_item.priority, urgent=urgent),
                title=f"{record.student_name_snapshot or '学生'} 报名结算",
                student_id=record.student_id,
                student_name=record.student_name_snapshot,
                region=record.region_snapshot,
                school_name=record.school_name_snapshot,
                agent_id=work_item.owner_agent_id,
                agent_name=owner_user.name,
                due_at=work_item.due_at or record.enrolled_at,
                status=record.settlement_status.value,
                reason=f"结算{record.settlement_status.value}",
                target_url="/admin/enrollment-settlement",
                action_label="处理结算",
                created_at=record.created_at,
            )
        )
    return rows


async def _build_help_work_items(db: AsyncSession, current_user: User) -> list[dict]:
    owner = aliased(User)
    conditions = [
        Student.need_help.is_(True),
        WorkItem.status.in_(ACTIVE_WORK_ITEM_STATUSES),
    ]
    if not is_admin(current_user):
        conditions.append(WorkItem.owner_agent_id == current_user.id)

    result = await db.execute(
        select(Student, WorkItem, owner)
        .join(
            WorkItem,
            and_(
                WorkItem.kind == WorkItemKind.help_request,
                WorkItem.source_type == "help",
                WorkItem.source_id == Student.id,
            ),
        )
        .join(owner, owner.id == WorkItem.owner_agent_id)
        .where(*conditions)
        .order_by(Student.updated_at.desc())
    )
    rows = []
    for student, work_item, owner_user in result.all():
        rows.append(
            _work_item(
                kind="help",
                source_id=student.id,
                queue="help",
                priority=_work_priority(work_item.priority),
                title=f"{student.name} 求助",
                student_id=student.id,
                student_name=student.name,
                region=student.region,
                school_name=student.school_name,
                agent_id=work_item.owner_agent_id,
                agent_name=owner_user.name,
                due_at=work_item.due_at or student.updated_at,
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
    q: str = Query("", max_length=80),
    agent_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    stale_days: int = Query(3, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_module(current_user, ADMIN_PAGE_WORK_CENTER)
    normalized_queue = WORK_ITEM_QUEUE_ALIASES.get(queue, queue)
    if normalized_queue not in WORK_ITEM_QUEUES:
        raise HTTPException(status_code=422, detail="不支持的待办队列")

    now = datetime.now()
    rows: list[dict] = []
    rows.extend(await _build_lead_contact_work_items(db, current_user))
    rows.extend(await _build_home_visit_work_items(db, current_user, now))
    rows.extend(await _build_campus_visit_work_items(db, current_user, now))
    rows.extend(await _build_follow_up_work_items(db, current_user, now))
    rows.extend(await _build_settlement_work_items(db, current_user))
    rows.extend(await _build_help_work_items(db, current_user))
    rows.extend(
        await _build_stale_a_work_items(db, current_user, now, stale_days)
    )

    if priority:
        rows = [row for row in rows if row["priority"] == priority]
    if region:
        rows = [row for row in rows if region in (row["region"] or "")]
    if agent_id is not None:
        rows = [row for row in rows if row["agent_id"] == agent_id]
    query_text = q.strip().casefold()
    if query_text:
        searchable_fields = (
            "title",
            "student_name",
            "region",
            "school_name",
            "agent_name",
            "reason",
            "status",
            "source_id",
        )
        rows = [
            row
            for row in rows
            if any(
                query_text in str(row.get(field) or "").casefold()
                for field in searchable_fields
            )
        ]

    available_regions = sorted(
        {row["region"] for row in rows if row.get("region")},
        key=lambda value: value.casefold(),
    )
    queue_counts = {key: 0 for key in WORK_ITEM_QUEUES if key != "all"}
    for row in rows:
        if row["queue"] in queue_counts:
            queue_counts[row["queue"]] += 1
    queue_counts["all"] = len(rows)

    if normalized_queue != "all":
        rows = [row for row in rows if row["queue"] == normalized_queue]

    rows.sort(
        key=lambda row: (
            -WORK_ITEM_PRIORITY_WEIGHT.get(row["priority"], 0),
            row["due_at"] or "9999-12-31 23:59:59",
            row["created_at"] or "",
        )
    )
    total = len(rows)
    start = (page - 1) * page_size
    payload = _page_payload(total, page, page_size, rows[start : start + page_size])
    payload.update(
        {
            "has_more": start + page_size < total,
            "queue_counts": queue_counts,
            "regions": available_regions,
        }
    )
    return Response.ok(payload)
