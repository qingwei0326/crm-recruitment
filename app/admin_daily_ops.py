import re
from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.expiry import build_last_activity_subquery
from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    DialLog,
    EnrollmentRecord,
    FollowUp,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    OperationLog,
    SettlementStatus,
    Student,
    StudentStatus,
    User,
)
from app.task_stats import ACTIVE_TASK_STATUSES, TERMINAL_STUDENT_STATUSES
from app.utils import today_cst_as_utc, utcnow

DAILY_OPS_REVIEW_PREFIX = "daily-ops:"
DAILY_OPS_REVIEW_STATUSES = {
    "处理中",
    "已处理",
    "已忽略",
    "暂缓",
    "明日继续跟进",
    "无需处理",
}
DAILY_OPS_CLOSED_STATUSES = {
    "已处理",
    "已忽略",
    "暂缓",
    "明日继续跟进",
    "无需处理",
}


def _to_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


def _today_cst_date_key() -> str:
    return (today_cst_as_utc() + timedelta(hours=8)).date().isoformat()


def _daily_ops_batch_id(date_key: str, key: str) -> str:
    safe_key = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", (key or "").strip())[:40]
    return f"{DAILY_OPS_REVIEW_PREFIX}{date_key}:{safe_key}"


async def _latest_daily_ops_reviews(db: AsyncSession, date_key: str) -> dict[str, dict]:
    prefix = f"{DAILY_OPS_REVIEW_PREFIX}{date_key}:"
    rows = (
        (
            await db.execute(
                select(OperationLog)
                .where(
                    OperationLog.action == "每日运营闭环",
                    OperationLog.batch_id.like(f"{prefix}%"),
                )
                .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
            )
        )
        .scalars()
        .all()
    )
    reviews = {}
    for log in rows:
        key = (log.batch_id or "")[len(prefix) :].strip()
        if not key or key in reviews:
            continue
        try:
            reviewed_count = int(log.old_status or 0)
        except (TypeError, ValueError):
            reviewed_count = 0
        reviews[key] = {
            "status": log.new_status or "已处理",
            "note": log.note_content or "",
            "reviewed_count": reviewed_count,
            "reviewed_by": log.operator_name or "",
            "reviewed_at": log.created_at,
        }
    return reviews


def _daily_ops_item(
    *,
    key: str,
    title: str,
    count: int,
    severity: str,
    detail: str,
    to: str,
    reviews: dict[str, dict],
    owners: list[dict] | None = None,
) -> dict:
    review = reviews.get(key) or {}
    count = int(count or 0)
    status = review.get("status") or ("已处理" if count == 0 else "待处理")
    return {
        "key": key,
        "title": title,
        "count": count,
        "severity": severity if count else "low",
        "detail": detail,
        "to": to,
        "status": status,
        "is_closed": count == 0 or status in DAILY_OPS_CLOSED_STATUSES,
        "reviewed_count": int(review.get("reviewed_count") or 0),
        "reviewed_by": review.get("reviewed_by") or "",
        "reviewed_at": review["reviewed_at"].isoformat() if review.get("reviewed_at") else "",
        "note": review.get("note") or "",
        "owners": owners or [],
    }


def _age_days(value, now: datetime) -> int:
    dt = _to_datetime(value)
    if not dt:
        return 0
    return max((now - dt).days, 0)


def _owner_payload(
    agent_id: int | None,
    agent_name: str | None,
    count: int,
    oldest_at,
    now: datetime,
    to: str,
) -> dict:
    return {
        "agent_id": agent_id,
        "agent_name": agent_name or ("未分配" if agent_id is None else f"话务员 #{agent_id}"),
        "count": int(count or 0),
        "oldest_at": _to_datetime(oldest_at).isoformat() if _to_datetime(oldest_at) else "",
        "max_age_days": _age_days(oldest_at, now),
        "to": to,
    }


async def _owner_rows(
    db: AsyncSession,
    *,
    owner_col,
    owner_name_col,
    oldest_col,
    where_clauses: list,
    base_from,
    joins: list = None,
    to: str,
    limit: int = 5,
) -> list[dict]:
    now = utcnow()
    query = select(
        owner_col.label("agent_id"),
        owner_name_col.label("agent_name"),
        func.count().label("count"),
        func.min(oldest_col).label("oldest_at"),
    ).select_from(base_from)
    for join_target, join_on, is_outer in joins or []:
        if is_outer:
            query = query.outerjoin(join_target, join_on)
        else:
            query = query.join(join_target, join_on)
    query = (
        query.where(*where_clauses)
        .group_by(owner_col, owner_name_col)
        .order_by(func.count().desc(), func.min(oldest_col).asc())
        .limit(limit)
    )
    result = await db.execute(query)
    return [
        _owner_payload(agent_id, agent_name, count, oldest_at, now, to)
        for agent_id, agent_name, count, oldest_at in result.all()
    ]


async def _daily_ops_counts(db: AsyncSession) -> dict[str, int]:
    now = utcnow()
    today = today_cst_as_utc()
    tomorrow = today + timedelta(days=1)

    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("latest_activity_at")

    stale_a_count = (
        await db.execute(
            select(func.count(Student.id))
            .outerjoin(last_activity, last_activity.c.student_id == Student.id)
            .where(
                Student.intent_level == IntentLevel.A,
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
                latest_activity_at < now - timedelta(days=3),
            )
        )
    ).scalar() or 0
    home_visit_due_count = (
        await db.execute(
            select(func.count(HomeVisitTask.id)).where(
                HomeVisitTask.status.in_(
                    [
                        HomeVisitStatus.pending,
                        HomeVisitStatus.confirmed,
                        HomeVisitStatus.scheduled,
                        HomeVisitStatus.postponed,
                    ]
                ),
                or_(
                    HomeVisitTask.requested_visit_time.is_(None),
                    HomeVisitTask.requested_visit_time < tomorrow,
                    HomeVisitTask.scheduled_at < tomorrow,
                ),
            )
        )
    ).scalar() or 0
    campus_visit_due_count = (
        await db.execute(
            select(func.count(CampusVisitTask.id)).where(
                or_(
                    CampusVisitTask.status == CampusVisitStatus.pending,
                    and_(
                        CampusVisitTask.status.in_(
                            [CampusVisitStatus.scheduled, CampusVisitStatus.rescheduled]
                        ),
                        CampusVisitTask.appointment_at.is_not(None),
                        CampusVisitTask.appointment_at < tomorrow,
                    ),
                )
            )
        )
    ).scalar() or 0
    unsettled_enrollment_count = (
        await db.execute(
            select(func.count(EnrollmentRecord.id)).where(
                EnrollmentRecord.settlement_status != SettlementStatus.settled
            )
        )
    ).scalar() or 0
    help_request_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.need_help.is_(True),
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            )
        )
    ).scalar() or 0
    dialed_student_ids = select(DialLog.student_id).distinct()
    assigned_no_call_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to.is_not(None),
                Student.assigned_at.is_not(None),
                Student.status.in_(ACTIVE_TASK_STATUSES),
                Student.id.not_in(dialed_student_ids),
            )
        )
    ).scalar() or 0
    yesterday_uncontacted_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to.is_not(None),
                Student.status == StudentStatus.not_contacted,
                Student.assigned_at.is_not(None),
                Student.assigned_at < today,
            )
        )
    ).scalar() or 0
    overdue_follow_up_count = (
        await db.execute(
            select(func.count(FollowUp.id)).where(
                FollowUp.is_completed.is_(False),
                FollowUp.follow_up_date < now,
            )
        )
    ).scalar() or 0

    return {
        "stale_a": int(stale_a_count),
        "home_visit_due": int(home_visit_due_count),
        "campus_visit_due": int(campus_visit_due_count),
        "unsettled_enrollments": int(unsettled_enrollment_count),
        "help_requests": int(help_request_count),
        "assigned_no_call": int(assigned_no_call_count),
        "yesterday_uncontacted": int(yesterday_uncontacted_count),
        "overdue_followups": int(overdue_follow_up_count),
    }


async def _daily_ops_owner_breakdowns(db: AsyncSession) -> dict[str, list[dict]]:
    now = utcnow()
    today = today_cst_as_utc()
    tomorrow = today + timedelta(days=1)
    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("latest_activity_at")
    home_due_time = func.coalesce(
        HomeVisitTask.requested_visit_time,
        HomeVisitTask.scheduled_at,
        HomeVisitTask.created_at,
    )
    campus_due_time = func.coalesce(
        CampusVisitTask.appointment_at,
        CampusVisitTask.created_at,
    )
    enrollment_due_time = func.coalesce(
        EnrollmentRecord.enrolled_at,
        EnrollmentRecord.created_at,
    )
    student_due_time = func.coalesce(Student.assigned_at, Student.created_at)

    stale_a_where = [
        Student.intent_level == IntentLevel.A,
        Student.status.not_in(TERMINAL_STUDENT_STATUSES),
        latest_activity_at < now - timedelta(days=3),
    ]
    home_visit_where = [
        HomeVisitTask.status.in_(
            [
                HomeVisitStatus.pending,
                HomeVisitStatus.confirmed,
                HomeVisitStatus.scheduled,
                HomeVisitStatus.postponed,
            ]
        ),
        or_(
            HomeVisitTask.requested_visit_time.is_(None),
            HomeVisitTask.requested_visit_time < tomorrow,
            HomeVisitTask.scheduled_at < tomorrow,
        ),
    ]
    campus_visit_where = [
        or_(
            CampusVisitTask.status == CampusVisitStatus.pending,
            and_(
                CampusVisitTask.status.in_(
                    [CampusVisitStatus.scheduled, CampusVisitStatus.rescheduled]
                ),
                CampusVisitTask.appointment_at.is_not(None),
                CampusVisitTask.appointment_at < tomorrow,
            ),
        )
    ]
    unsettled_where = [EnrollmentRecord.settlement_status != SettlementStatus.settled]
    help_where = [
        Student.need_help.is_(True),
        Student.status.not_in(TERMINAL_STUDENT_STATUSES),
    ]
    assigned_no_call_where = [
        Student.assigned_to.is_not(None),
        Student.assigned_at.is_not(None),
        Student.status.in_(ACTIVE_TASK_STATUSES),
        Student.id.not_in(select(DialLog.student_id).distinct()),
    ]
    yesterday_uncontacted_where = [
        Student.assigned_to.is_not(None),
        Student.status == StudentStatus.not_contacted,
        Student.assigned_at.is_not(None),
        Student.assigned_at < today,
    ]
    overdue_follow_up_where = [
        FollowUp.is_completed.is_(False),
        FollowUp.follow_up_date < now,
    ]

    return {
        "stale_a": await _owner_rows(
            db,
            owner_col=Student.assigned_to,
            owner_name_col=User.name,
            oldest_col=latest_activity_at,
            where_clauses=stale_a_where,
            base_from=Student,
            joins=[
                (User, User.id == Student.assigned_to, True),
                (last_activity, last_activity.c.student_id == Student.id, True),
            ],
            to="/admin/work-center?queue=stale-a",
        ),
        "home_visit_due": await _owner_rows(
            db,
            owner_col=HomeVisitTask.creator_agent_id,
            owner_name_col=User.name,
            oldest_col=home_due_time,
            where_clauses=home_visit_where,
            base_from=HomeVisitTask,
            joins=[(User, User.id == HomeVisitTask.creator_agent_id, True)],
            to="/admin/work-center?queue=home_visit",
        ),
        "campus_visit_due": await _owner_rows(
            db,
            owner_col=CampusVisitTask.creator_user_id,
            owner_name_col=User.name,
            oldest_col=campus_due_time,
            where_clauses=campus_visit_where,
            base_from=CampusVisitTask,
            joins=[(User, User.id == CampusVisitTask.creator_user_id, True)],
            to="/admin/work-center?queue=campus_visit",
        ),
        "unsettled_enrollments": await _owner_rows(
            db,
            owner_col=EnrollmentRecord.attributed_agent_id,
            owner_name_col=User.name,
            oldest_col=enrollment_due_time,
            where_clauses=unsettled_where,
            base_from=EnrollmentRecord,
            joins=[(User, User.id == EnrollmentRecord.attributed_agent_id, True)],
            to="/admin/enrollment-settlement",
        ),
        "help_requests": await _owner_rows(
            db,
            owner_col=Student.assigned_to,
            owner_name_col=User.name,
            oldest_col=student_due_time,
            where_clauses=help_where,
            base_from=Student,
            joins=[(User, User.id == Student.assigned_to, True)],
            to="/admin/work-center?queue=help",
        ),
        "assigned_no_call": await _owner_rows(
            db,
            owner_col=Student.assigned_to,
            owner_name_col=User.name,
            oldest_col=student_due_time,
            where_clauses=assigned_no_call_where,
            base_from=Student,
            joins=[(User, User.id == Student.assigned_to, True)],
            to="/admin/leads?active=1",
        ),
        "yesterday_uncontacted": await _owner_rows(
            db,
            owner_col=Student.assigned_to,
            owner_name_col=User.name,
            oldest_col=Student.assigned_at,
            where_clauses=yesterday_uncontacted_where,
            base_from=Student,
            joins=[(User, User.id == Student.assigned_to, True)],
            to="/admin/leads?status=%E6%9C%AA%E8%81%94%E7%B3%BB&active=1",
        ),
        "overdue_followups": await _owner_rows(
            db,
            owner_col=FollowUp.agent_id,
            owner_name_col=User.name,
            oldest_col=FollowUp.follow_up_date,
            where_clauses=overdue_follow_up_where,
            base_from=FollowUp,
            joins=[(User, User.id == FollowUp.agent_id, True)],
            to="/admin/work-center?queue=follow",
        ),
    }


async def _build_daily_ops_payload(db: AsyncSession, date_key: str) -> dict:
    counts = await _daily_ops_counts(db)
    owner_breakdowns = await _daily_ops_owner_breakdowns(db)
    reviews = await _latest_daily_ops_reviews(db, date_key)
    items = [
        _daily_ops_item(
            key="stale_a",
            title="A 级超时未推进",
            count=counts["stale_a"],
            severity="high",
            detail="A 级且 3 天以上无新活动，优先回访或主管介入。",
            to="/admin/work-center?queue=stale-a",
            reviews=reviews,
            owners=owner_breakdowns.get("stale_a"),
        ),
        _daily_ops_item(
            key="home_visit_due",
            title="家访待处理",
            count=counts["home_visit_due"],
            severity="high",
            detail="待确认、已安排或暂缓的家访，需要确认安排、结果或下一步。",
            to="/admin/work-center?queue=home_visit",
            reviews=reviews,
            owners=owner_breakdowns.get("home_visit_due"),
        ),
        _daily_ops_item(
            key="campus_visit_due",
            title="到校待确认",
            count=counts["campus_visit_due"],
            severity="high",
            detail="待预约或已到预约时间但未确认结果的到校任务。",
            to="/admin/work-center?queue=campus_visit",
            reviews=reviews,
            owners=owner_breakdowns.get("campus_visit_due"),
        ),
        _daily_ops_item(
            key="unsettled_enrollments",
            title="已报名未结算",
            count=counts["unsettled_enrollments"],
            severity="high",
            detail="已报名但仍未结算、暂缓或争议，需要确认结算归属。",
            to="/admin/enrollment-settlement",
            reviews=reviews,
            owners=owner_breakdowns.get("unsettled_enrollments"),
        ),
        _daily_ops_item(
            key="help_requests",
            title="话务员求助",
            count=counts["help_requests"],
            severity="high",
            detail="话务员标记需要管理员协助的学生。",
            to="/admin/work-center?queue=help",
            reviews=reviews,
            owners=owner_breakdowns.get("help_requests"),
        ),
        _daily_ops_item(
            key="assigned_no_call",
            title="分配后无通话",
            count=counts["assigned_no_call"],
            severity="medium",
            detail="已分配但没有拨号记录，需确认话务员是否开始处理。",
            to="/admin/leads?active=1",
            reviews=reviews,
            owners=owner_breakdowns.get("assigned_no_call"),
        ),
        _daily_ops_item(
            key="yesterday_uncontacted",
            title="昨日遗留未联系",
            count=counts["yesterday_uncontacted"],
            severity="medium",
            detail="昨天及更早分配但仍未联系的学生，避免继续过期。",
            to="/admin/leads?status=%E6%9C%AA%E8%81%94%E7%B3%BB&active=1",
            reviews=reviews,
            owners=owner_breakdowns.get("yesterday_uncontacted"),
        ),
        _daily_ops_item(
            key="overdue_followups",
            title="逾期回访",
            count=counts["overdue_followups"],
            severity="medium",
            detail="回访时间已过但未完成，需要话务员补跟进。",
            to="/admin/work-center?queue=follow",
            reviews=reviews,
            owners=owner_breakdowns.get("overdue_followups"),
        ),
    ]
    active_items = [item for item in items if item["count"] > 0]
    closed_items = [item for item in active_items if item["is_closed"]]
    pending_items = [item for item in active_items if not item["is_closed"]]
    high_pending = [item for item in pending_items if item["severity"] == "high"]
    return {
        "date": date_key,
        "generated_at": utcnow().isoformat(),
        "summary": {
            "total_items": len(active_items),
            "closed_items": len(closed_items),
            "pending_items": len(pending_items),
            "high_pending_items": len(high_pending),
            "total_count": sum(item["count"] for item in active_items),
            "max_age_days": max(
                [
                    owner.get("max_age_days", 0)
                    for item in active_items
                    for owner in item.get("owners", [])
                ]
                or [0]
            ),
        },
        "items": items,
    }


