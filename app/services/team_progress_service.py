"""Team progress for the admin home: what each agent (or region) still has to do.

The manager used to ask these in the work group ("你那些未接的有没有在打", "先打一会儿
给你派过去", "东山能家访都发出来"). Every number here is a count of students, keyed by
the student's current owner or region, so a row always adds up to people on the lists.
"""

from collections.abc import Iterable
from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain_errors import InvalidFilter
from app.expiry import build_last_activity_subquery
from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    DialLog,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    Student,
    StudentStatus,
    User,
    UserRole,
)
from app.status_policy import statuses_for_canonical
from app.task_stats import ACTIVE_TASK_STATUSES, AGENT_TODAY_TASK_STATUSES
from app.utils import (
    OVERDUE_AFTER_HOURS,
    overdue_cutoff,
    today_cst_as_utc,
    today_cst_date,
    utcnow,
)

GROUP_BY_AGENT = "agent"
GROUP_BY_REGION = "region"
QUIET_AFTER_DAYS = 3
UNKNOWN_REGION_LABEL = "未填片区"

OPEN_HOME_VISIT_STATUSES = (
    HomeVisitStatus.pending,
    HomeVisitStatus.confirmed,
    HomeVisitStatus.scheduled,
    HomeVisitStatus.postponed,
)
OPEN_CAMPUS_VISIT_STATUSES = (
    CampusVisitStatus.pending,
    CampusVisitStatus.scheduled,
    CampusVisitStatus.rescheduled,
)

METRIC_KEYS = (
    "today_dials",
    "pending_dial",
    "overdue",
    "missed_waiting",
    "intent_ab",
    "intent_ab_quiet",
    "open_visits",
    "enrolled_today",
    "enrolled_total",
)


async def _grouped_counts(db: AsyncSession, key_col, base, *where) -> dict:
    result = await db.execute(
        base.add_columns(key_col, func.count(func.distinct(Student.id)))
        .where(*where)
        .group_by(key_col)
    )
    return {key: int(count or 0) for key, count in result.all()}


def _students():
    return select().select_from(Student)


async def _student_metrics(db: AsyncSession, key_col) -> dict[str, dict]:
    now = utcnow()
    today = today_cst_as_utc()
    owned = Student.assigned_to.is_not(None)
    dialed_today = select(DialLog.student_id).where(DialLog.dialed_at >= today)
    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    )
    intent_ab = (
        owned,
        Student.intent_level.in_([IntentLevel.A, IntentLevel.B]),
        Student.status.in_(ACTIVE_TASK_STATUSES),
    )
    pending = (owned, Student.status.in_(AGENT_TODAY_TASK_STATUSES))
    enrolled = (owned, Student.status == StudentStatus.enrolled)

    return {
        "pending_dial": await _grouped_counts(db, key_col, _students(), *pending),
        "overdue": await _grouped_counts(
            db,
            key_col,
            _students(),
            *pending,
            Student.assigned_at.is_not(None),
            Student.assigned_at <= overdue_cutoff(now),
        ),
        "missed_waiting": await _grouped_counts(
            db,
            key_col,
            _students(),
            owned,
            Student.status.in_(statuses_for_canonical(StudentStatus.not_reached)),
            Student.id.not_in(dialed_today),
        ),
        "intent_ab": await _grouped_counts(db, key_col, _students(), *intent_ab),
        "intent_ab_quiet": await _grouped_counts(
            db,
            key_col,
            _students().outerjoin(last_activity, last_activity.c.student_id == Student.id),
            *intent_ab,
            latest_activity_at < now - timedelta(days=QUIET_AFTER_DAYS),
        ),
        "open_visits": _merge_counts(
            await _grouped_counts(
                db,
                key_col,
                select().select_from(HomeVisitTask).join(
                    Student, Student.id == HomeVisitTask.student_id
                ),
                owned,
                HomeVisitTask.status.in_(OPEN_HOME_VISIT_STATUSES),
            ),
            await _grouped_counts(
                db,
                key_col,
                select().select_from(CampusVisitTask).join(
                    Student, Student.id == CampusVisitTask.student_id
                ),
                owned,
                CampusVisitTask.status.in_(OPEN_CAMPUS_VISIT_STATUSES),
            ),
        ),
        "enrolled_today": await _grouped_counts(
            db, key_col, _students(), *enrolled, Student.enrolled_at == today_cst_date()
        ),
        "enrolled_total": await _grouped_counts(db, key_col, _students(), *enrolled),
    }


def _merge_counts(*maps: dict) -> dict:
    merged: dict = {}
    for counts in maps:
        for key, value in counts.items():
            merged[key] = merged.get(key, 0) + value
    return merged


async def _today_dials(db: AsyncSession, group_by: str) -> dict:
    today = today_cst_as_utc()
    if group_by == GROUP_BY_AGENT:
        key_col = DialLog.agent_id
        query = select(key_col, func.count(DialLog.id)).where(DialLog.dialed_at >= today)
    else:
        key_col = func.coalesce(Student.region, "")
        query = (
            select(key_col, func.count(DialLog.id))
            .join(Student, Student.id == DialLog.student_id)
            .where(DialLog.dialed_at >= today)
        )
    result = await db.execute(query.group_by(key_col))
    return {key: int(count or 0) for key, count in result.all()}


def _row(key, label: str, metrics: dict[str, dict]) -> dict:
    row = {"key": key, "label": label}
    for name in METRIC_KEYS:
        row[name] = int(metrics.get(name, {}).get(key, 0))
    return row


def _has_numbers(row: dict) -> bool:
    return any(row[name] for name in METRIC_KEYS)


def _totals(rows: Iterable[dict]) -> dict:
    totals = {name: 0 for name in METRIC_KEYS}
    for row in rows:
        for name in METRIC_KEYS:
            totals[name] += row[name]
    return totals


async def _agent_rows(db: AsyncSession, metrics: dict[str, dict]) -> list[dict]:
    keys_with_numbers = {key for counts in metrics.values() for key in counts}
    result = await db.execute(
        select(User).where(
            User.role == UserRole.agent,
            or_(User.is_active.is_(True), User.id.in_(keys_with_numbers or {-1})),
        )
    )
    rows = []
    for agent in result.scalars().all():
        row = _row(agent.id, agent.name or agent.username, metrics)
        row["is_active"] = bool(agent.is_active)
        if not agent.is_active and not _has_numbers(row):
            continue
        # Nothing left to dial: the manager can hand this agent new leads.
        row["needs_leads"] = row["is_active"] and row["pending_dial"] == 0
        rows.append(row)
    rows.sort(key=lambda r: (not r["is_active"], r["pending_dial"], r["label"]))
    return rows


def _region_rows(metrics: dict[str, dict]) -> list[dict]:
    keys = {key for counts in metrics.values() for key in counts}
    rows = [_row(key, key or UNKNOWN_REGION_LABEL, metrics) for key in keys]
    rows = [row for row in rows if _has_numbers(row)]
    rows.sort(
        key=lambda r: (-(r["pending_dial"] + r["missed_waiting"] + r["intent_ab"]), r["label"])
    )
    return rows


async def team_progress(db: AsyncSession, group_by: str = GROUP_BY_AGENT) -> dict:
    if group_by not in (GROUP_BY_AGENT, GROUP_BY_REGION):
        raise InvalidFilter("group_by 只能是 agent 或 region")

    key_col = (
        Student.assigned_to
        if group_by == GROUP_BY_AGENT
        else func.coalesce(Student.region, "")
    )
    metrics = await _student_metrics(db, key_col)
    metrics["today_dials"] = await _today_dials(db, group_by)
    if group_by == GROUP_BY_AGENT:
        metrics = {
            name: {key: value for key, value in counts.items() if key is not None}
            for name, counts in metrics.items()
        }
        rows = await _agent_rows(db, metrics)
    else:
        rows = _region_rows(metrics)

    return {
        "group_by": group_by,
        "overdue_after_hours": OVERDUE_AFTER_HOURS,
        "quiet_after_days": QUIET_AFTER_DAYS,
        "generated_at": str(utcnow()),
        "rows": rows,
        "totals": _totals(rows),
    }
