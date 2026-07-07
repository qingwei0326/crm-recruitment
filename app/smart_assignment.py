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
        "overdue_follow_ups": {
            int(agent_id): int(count or 0) for agent_id, count in overdue_rows
        },
    }


def _load_score(active: int, today_calls: int, handled_7d: int, overdue_follow_ups: int) -> float:
    return round(active * 1.0 + today_calls * 0.3 + handled_7d * 0.2 + overdue_follow_ups * 2.0, 1)


async def _agent_rows(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(User).where(User.is_active, User.role == UserRole.agent).order_by(User.id.asc())
    )
    agents = result.scalars().all()
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


def _allocate_counts(
    agent_rows: list[dict],
    candidate_count: int,
    per_agent_limit: int,
) -> dict[int, int]:
    if not agent_rows or candidate_count <= 0:
        return {}

    counts = {int(row["agent_id"]): 0 for row in agent_rows}
    remaining = candidate_count
    target_active = math.ceil(sum(row["active_tasks"] for row in agent_rows) / len(agent_rows))

    for row in sorted(
        agent_rows,
        key=lambda item: (item["active_tasks"], item["load_score"], item["agent_id"]),
    ):
        if remaining <= 0:
            break
        agent_id = int(row["agent_id"])
        capacity = per_agent_limit - counts[agent_id]
        needed = max(target_active - int(row["active_tasks"]), 0)
        amount = min(capacity, needed, remaining)
        if amount > 0:
            counts[agent_id] += amount
            remaining -= amount

    ordered = sorted(
        agent_rows,
        key=lambda item: (item["load_score"], item["active_tasks"], item["agent_id"]),
    )
    while remaining > 0:
        changed = False
        for row in ordered:
            agent_id = int(row["agent_id"])
            if counts[agent_id] >= per_agent_limit:
                continue
            counts[agent_id] += 1
            remaining -= 1
            changed = True
            if remaining <= 0:
                break
        if not changed:
            break

    return counts


def _assignments_by_agent(
    agent_rows: list[dict],
    candidate_ids: list[int],
    counts: dict[int, int],
) -> dict[int, list[int]]:
    assignments: dict[int, list[int]] = {}
    cursor = 0
    for row in agent_rows:
        agent_id = int(row["agent_id"])
        count = int(counts.get(agent_id, 0) or 0)
        if count <= 0:
            continue
        assignments[agent_id] = candidate_ids[cursor : cursor + count]
        cursor += count
    return assignments


def _plan_payload(
    *,
    params: SmartAssignParams,
    pool: dict,
    agent_rows: list[dict],
    assignments_by_agent: dict[int, list[int]],
    candidate_count: int,
) -> dict:
    planned = sum(len(student_ids) for student_ids in assignments_by_agent.values())
    pool = {
        **pool,
        "remaining_after_plan": max(pool["eligible_total"] - planned, 0),
    }
    per_agent = [
        {
            "agent_id": row["agent_id"],
            "agent_name": row["agent_name"],
            "count": len(assignments_by_agent.get(int(row["agent_id"]), [])),
        }
        for row in agent_rows
        if assignments_by_agent.get(int(row["agent_id"]))
    ]
    warnings = []
    if not agent_rows:
        warnings.append("没有启用话务员")
    if candidate_count == 0:
        warnings.append("没有符合条件的待分配线索")
    if agent_rows and candidate_count > planned:
        warnings.append("坐席单次上限不足，仍有线索未纳入本次计划")

    return {
        "params": {
            "school_name": params.school_name,
            "region": params.region,
            "limit": params.limit,
            "per_agent_limit": params.per_agent_limit,
        },
        "pool": pool,
        "agents": agent_rows,
        "plan": {
            "planned": planned,
            "per_agent": per_agent,
        },
        "warnings": warnings,
    }


async def build_smart_assignment_plan(
    db: AsyncSession,
    params: SmartAssignParams,
) -> SmartAssignmentPlan:
    params = params.normalized()
    pool = await _pool_payload(db, params)
    candidate_ids = await _candidate_student_ids(db, params)
    agent_rows = await _agent_rows(db)
    counts = _allocate_counts(agent_rows, len(candidate_ids), params.per_agent_limit)

    for row in agent_rows:
        row["suggested_count"] = counts.get(int(row["agent_id"]), 0)

    assignments_by_agent = _assignments_by_agent(agent_rows, candidate_ids, counts)
    payload = _plan_payload(
        params=params,
        pool=pool,
        agent_rows=agent_rows,
        assignments_by_agent=assignments_by_agent,
        candidate_count=len(candidate_ids),
    )
    return SmartAssignmentPlan(payload=payload, assignments_by_agent=assignments_by_agent)
