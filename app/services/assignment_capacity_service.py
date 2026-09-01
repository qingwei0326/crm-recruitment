"""Dynamic daily release capacity for assignment planning.

This module is deliberately read-only. It calculates a stable plan from the
current database state; assignment writers are migrated in a later task.
"""

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_config import (
    ASSIGNMENT_CAPACITY_DEFAULTS,
    validate_capacity_settings,
)
from app.domain_models import AgentEmployment, EmploymentStatus
from app.models import DialLog, Student, SystemConfig, User, UserRole
from app.task_stats import ASSIGNABLE_STUDENT_STATUSES
from app.utils import cst_date_start_as_utc, utcnow

_CST = timezone(timedelta(hours=8))


@dataclass(frozen=True, slots=True)
class CapacitySettings:
    lookback_days: int
    observed_days: int
    min_daily_capacity: int
    max_daily_capacity: int
    insufficient_history_mode: str


@dataclass(frozen=True, slots=True)
class AgentCapacitySnapshot:
    agent_id: int
    agent_name: str
    recent_distinct_students: int
    observed_days: int
    estimated_daily_capacity: int
    today_distinct_released: int
    active_unfinished_backlog: int
    releasable_today: int
    data_quality: str


@dataclass(frozen=True, slots=True)
class CapacityPlan:
    candidate_count: int
    planned_count: int
    overflow_count: int
    assignments_by_agent: dict[int, tuple[int, ...]]
    overflow_student_ids: tuple[int, ...]
    agents: tuple[AgentCapacitySnapshot, ...]
    skipped: dict[str, int]


def _as_utc_naive(value: datetime) -> datetime:
    """Normalize test and database timestamps to the project's UTC-naive form."""
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _business_day_start(at: datetime) -> datetime:
    at_aware = at.replace(tzinfo=UTC).astimezone(_CST)
    return cst_date_start_as_utc(at_aware.date())


def _business_day(value: datetime) -> date:
    return value.replace(tzinfo=UTC).astimezone(_CST).date()


def _parse_int_setting(values: dict[str, str], key: str) -> int:
    raw = values.get(key, "").strip()
    if not raw:
        return int(ASSIGNMENT_CAPACITY_DEFAULTS[key])
    try:
        return int(raw)
    except ValueError as exc:
        raise ValueError(f"{key} must be an integer") from exc


async def load_capacity_settings(db: AsyncSession) -> CapacitySettings:
    """Load and validate capacity settings from the existing key/value table."""
    keys = tuple(ASSIGNMENT_CAPACITY_DEFAULTS)
    result = await db.execute(select(SystemConfig).where(SystemConfig.key.in_(keys)))
    values = {row.key: row.value for row in result.scalars().all()}

    settings = CapacitySettings(
        lookback_days=_parse_int_setting(values, "assignment_capacity_lookback_days"),
        observed_days=_parse_int_setting(values, "assignment_capacity_observed_days"),
        min_daily_capacity=_parse_int_setting(values, "assignment_capacity_min"),
        max_daily_capacity=_parse_int_setting(values, "assignment_capacity_max"),
        insufficient_history_mode=(
            values.get(
                "assignment_capacity_insufficient_history",
                ASSIGNMENT_CAPACITY_DEFAULTS["assignment_capacity_insufficient_history"],
            ).strip()
            or ASSIGNMENT_CAPACITY_DEFAULTS["assignment_capacity_insufficient_history"]
        ),
    )
    valid, error = validate_capacity_settings(
        lookback_days=settings.lookback_days,
        observed_days=settings.observed_days,
        min_daily_capacity=settings.min_daily_capacity,
        max_daily_capacity=settings.max_daily_capacity,
        insufficient_history_mode=settings.insufficient_history_mode,
    )
    if not valid:
        raise ValueError(error or "Invalid assignment capacity settings")
    return settings


def _empty_plan(candidate_count: int, skipped: dict[str, int] | None = None) -> CapacityPlan:
    return CapacityPlan(
        candidate_count=candidate_count,
        planned_count=0,
        overflow_count=0,
        assignments_by_agent={},
        overflow_student_ids=(),
        agents=(),
        skipped=skipped or {},
    )


async def build_capacity_plan(
    db: AsyncSession,
    candidate_student_ids: Sequence[int],
    target_agent_ids: Sequence[int],
    *,
    at: datetime | None = None,
    preferred_agent_ids_by_student: Mapping[int, Sequence[int]] | None = None,
) -> CapacityPlan:
    """Build a stable, capacity-limited, read-only assignment plan.

    ``preferred_agent_ids_by_student`` lets region-aware callers keep their
    existing matching rule while still falling back to any available target
    when a preferred agent has no remaining capacity.
    """
    settings = await load_capacity_settings(db)
    current_at = _as_utc_naive(at or utcnow())
    today_start = _business_day_start(current_at)
    tomorrow_start = today_start + timedelta(days=1)
    lookback_start = current_at - timedelta(days=settings.lookback_days)

    raw_candidate_ids = [int(student_id) for student_id in candidate_student_ids]
    unique_candidate_ids = tuple(dict.fromkeys(raw_candidate_ids))
    skipped: dict[str, int] = {}
    duplicate_count = len(raw_candidate_ids) - len(unique_candidate_ids)
    if duplicate_count:
        skipped["duplicate_candidate_ids"] = duplicate_count

    candidate_rows: list[Student] = []
    if unique_candidate_ids:
        candidates_result = await db.execute(
            select(Student)
            .where(Student.id.in_(unique_candidate_ids))
            .order_by(Student.created_at.asc(), Student.id.asc())
        )
        rows_by_id = {student.id: student for student in candidates_result.scalars().all()}
        missing_count = len(set(unique_candidate_ids) - rows_by_id.keys())
        if missing_count:
            skipped["missing_candidate_ids"] = missing_count
        for student_id in unique_candidate_ids:
            student = rows_by_id.get(student_id)
            if student is None:
                continue
            if student.assigned_to is not None:
                skipped["already_assigned"] = skipped.get("already_assigned", 0) + 1
                continue
            if student.status not in ASSIGNABLE_STUDENT_STATUSES:
                skipped["ineligible_status"] = skipped.get("ineligible_status", 0) + 1
                continue
            candidate_rows.append(student)
        candidate_rows.sort(key=lambda student: (student.created_at, student.id))

    target_ids = tuple(sorted({int(agent_id) for agent_id in target_agent_ids}))
    agents: list[User] = []
    if target_ids:
        agents_result = await db.execute(
            select(User)
            .join(AgentEmployment, AgentEmployment.user_id == User.id)
            .where(
                User.id.in_(target_ids),
                User.role == UserRole.agent,
                User.is_active.is_(True),
                AgentEmployment.status == EmploymentStatus.active,
            )
            .order_by(User.id.asc())
        )
        agents = list(agents_result.scalars().all())

    invalid_target_count = len(target_ids) - len(agents)
    if invalid_target_count:
        skipped["invalid_target_agents"] = invalid_target_count

    if not agents:
        return CapacityPlan(
            candidate_count=len(raw_candidate_ids),
            planned_count=0,
            overflow_count=len(candidate_rows),
            assignments_by_agent={},
            overflow_student_ids=tuple(student.id for student in candidate_rows),
            agents=(),
            skipped=skipped,
        )

    agent_id_set = {agent.id for agent in agents}
    log_rows_result = await db.execute(
        select(DialLog.agent_id, DialLog.student_id, DialLog.dialed_at)
        .where(
            DialLog.agent_id.in_(agent_id_set),
            DialLog.dialed_at >= lookback_start,
            DialLog.dialed_at <= current_at,
        )
    )
    recent_students: dict[int, set[int]] = {agent.id: set() for agent in agents}
    observed_dates: dict[int, set[date]] = {agent.id: set() for agent in agents}
    for agent_id, student_id, dialed_at in log_rows_result.all():
        if dialed_at is None:
            continue
        recent_students[agent_id].add(student_id)
        observed_dates[agent_id].add(_business_day(_as_utc_naive(dialed_at)))

    assigned_rows_result = await db.execute(
        select(Student.id, Student.assigned_to, Student.assigned_at)
        .where(
            Student.assigned_to.in_(agent_id_set),
            Student.assigned_at.is_not(None),
            Student.assigned_at <= current_at,
        )
    )
    today_released: dict[int, set[int]] = {agent.id: set() for agent in agents}
    old_backlog: dict[int, set[int]] = {agent.id: set() for agent in agents}
    assigned_status_result = await db.execute(
        select(Student.id, Student.status)
        .where(Student.assigned_to.in_(agent_id_set), Student.assigned_at.is_not(None))
    )
    current_status_by_student = {
        student_id: status for student_id, status in assigned_status_result.all()
    }
    for student_id, agent_id, assigned_at in assigned_rows_result.all():
        assigned_at = _as_utc_naive(assigned_at)
        if today_start <= assigned_at < tomorrow_start:
            today_released[agent_id].add(student_id)
        elif (
            assigned_at < today_start
            and current_status_by_student.get(student_id) in ASSIGNABLE_STUDENT_STATUSES
        ):
            old_backlog[agent_id].add(student_id)

    snapshots: list[AgentCapacitySnapshot] = []
    for agent in agents:
        recent_count = len(recent_students[agent.id])
        actual_observed_days = len(observed_dates[agent.id])
        if actual_observed_days < settings.observed_days:
            estimated_capacity = settings.min_daily_capacity
            data_quality = "insufficient_history"
        else:
            estimated_capacity = min(
                settings.max_daily_capacity,
                max(
                    settings.min_daily_capacity,
                    round(recent_count / max(settings.observed_days, 1)),
                ),
            )
            data_quality = "observed"
        today_count = len(today_released[agent.id])
        backlog_count = len(old_backlog[agent.id])
        releasable = max(0, estimated_capacity - today_count - backlog_count)
        snapshots.append(
            AgentCapacitySnapshot(
                agent_id=agent.id,
                agent_name=agent.name,
                recent_distinct_students=recent_count,
                observed_days=actual_observed_days,
                estimated_daily_capacity=estimated_capacity,
                today_distinct_released=today_count,
                active_unfinished_backlog=backlog_count,
                releasable_today=releasable,
                data_quality=data_quality,
            )
        )

    remaining_capacity = {
        snapshot.agent_id: snapshot.releasable_today
        for snapshot in snapshots
        if snapshot.releasable_today > 0
    }
    assignments: dict[int, list[int]] = {}
    overflow: list[int] = []
    round_robin_ids = [snapshot.agent_id for snapshot in snapshots]
    pointer = 0
    for student in candidate_rows:
        preferred_ids = tuple(
            int(agent_id)
            for agent_id in (preferred_agent_ids_by_student or {}).get(student.id, ())
        )
        preferred_available = [
            agent_id
            for agent_id in preferred_ids
            if agent_id in remaining_capacity and remaining_capacity[agent_id] > 0
        ]
        if preferred_available:
            agent_id = max(
                preferred_available,
                key=lambda item: (remaining_capacity[item], -item),
            )
        else:
            available_ids = [
                agent_id
                for agent_id in round_robin_ids
                if remaining_capacity.get(agent_id, 0) > 0
            ]
            if not available_ids:
                overflow.append(student.id)
                continue
            agent_id = next(
                round_robin_ids[(pointer + offset) % len(round_robin_ids)]
                for offset in range(len(round_robin_ids))
                if round_robin_ids[(pointer + offset) % len(round_robin_ids)]
                in available_ids
            )

        if not round_robin_ids:
            overflow.append(student.id)
            continue
        assignments.setdefault(agent_id, []).append(student.id)
        remaining_capacity[agent_id] -= 1
        pointer = (round_robin_ids.index(agent_id) + 1) % len(round_robin_ids)

    frozen_assignments = {agent_id: tuple(ids) for agent_id, ids in assignments.items()}
    return CapacityPlan(
        candidate_count=len(raw_candidate_ids),
        planned_count=sum(len(ids) for ids in frozen_assignments.values()),
        overflow_count=len(overflow),
        assignments_by_agent=frozen_assignments,
        overflow_student_ids=tuple(overflow),
        agents=tuple(snapshots),
        skipped=skipped,
    )
