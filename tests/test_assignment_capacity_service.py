"""Focused tests for the dynamic assignment capacity contract."""

from datetime import datetime, timedelta

import pytest

from app.admin_config import validate_capacity_settings, validate_config_value
from app.domain_models import AgentEmployment, EmploymentStatus
from app.models import DialLog, Student, StudentStatus, SystemConfig, User
from app.services.assignment_capacity_service import (
    build_capacity_plan,
    load_capacity_settings,
)

AT = datetime(2026, 8, 22, 4, 0, 0)


def _agent(username: str, name: str) -> User:
    return User(
        username=username,
        hashed_password="test",
        role="agent",
        name=name,
        is_active=True,
    )


def _student(name: str, *, created_at: datetime, assigned_to=None, assigned_at=None) -> Student:
    return Student(
        name=name,
        status=StudentStatus.not_contacted,
        created_at=created_at,
        assigned_to=assigned_to,
        assigned_at=assigned_at,
    )


def _student_with_status(
    name: str,
    *,
    created_at: datetime,
    status: StudentStatus,
    assigned_to=None,
    assigned_at=None,
) -> Student:
    student = _student(
        name,
        created_at=created_at,
        assigned_to=assigned_to,
        assigned_at=assigned_at,
    )
    student.status = status
    return student


async def _activate_agent(db, agent: User) -> None:
    db.add(agent)
    await db.flush()
    db.add(AgentEmployment(user_id=agent.id, status=EmploymentStatus.active))


@pytest.mark.asyncio
async def test_load_capacity_settings_uses_defaults_and_config_rows(db):
    settings = await load_capacity_settings(db)
    assert settings.lookback_days == 7
    assert settings.observed_days == 5
    assert settings.min_daily_capacity == 150
    assert settings.max_daily_capacity == 200
    assert settings.insufficient_history_mode == "configured_min"

    db.add_all(
        [
            SystemConfig(key="assignment_capacity_lookback_days", value="10"),
            SystemConfig(key="assignment_capacity_observed_days", value="4"),
            SystemConfig(key="assignment_capacity_min", value="80"),
            SystemConfig(key="assignment_capacity_max", value="300"),
        ]
    )
    await db.commit()
    settings = await load_capacity_settings(db)
    assert settings.lookback_days == 10
    assert settings.observed_days == 4
    assert settings.min_daily_capacity == 80
    assert settings.max_daily_capacity == 300


@pytest.mark.asyncio
async def test_capacity_service_deduplicates_history_and_separates_today_from_backlog(db):
    agent = _agent("capacity-agent", "容量坐席")
    await _activate_agent(db, agent)
    today_start = datetime(2026, 8, 21, 16, 0, 0)
    today_student = _student(
        "今日一", created_at=AT, assigned_to=agent.id, assigned_at=today_start
    )
    today_student_2 = _student(
        "今日二",
        created_at=AT + timedelta(seconds=1),
        assigned_to=agent.id,
        assigned_at=today_start,
    )
    backlog = _student(
        "旧积压",
        created_at=AT - timedelta(days=2),
        assigned_to=agent.id,
        assigned_at=today_start - timedelta(days=1),
    )
    history_students = [
        _student(f"历史{i}", created_at=AT - timedelta(days=10, seconds=i))
        for i in range(3)
    ]
    db.add_all([today_student, today_student_2, backlog, *history_students])
    await db.flush()
    db.add_all(
        [
            DialLog(
                student_id=history_students[0].id,
                agent_id=agent.id,
                dialed_at=AT - timedelta(days=4),
            ),
            DialLog(
                student_id=history_students[0].id,
                agent_id=agent.id,
                dialed_at=AT - timedelta(days=4, seconds=-1),
            ),
            DialLog(
                student_id=history_students[1].id,
                agent_id=agent.id,
                dialed_at=AT - timedelta(days=3),
            ),
            DialLog(
                student_id=history_students[2].id,
                agent_id=agent.id,
                dialed_at=AT - timedelta(days=2),
            ),
        ]
    )
    await db.commit()

    plan = await build_capacity_plan(db, [], [agent.id], at=AT)
    snapshot = plan.agents[0]
    assert snapshot.recent_distinct_students == 3
    assert snapshot.today_distinct_released == 2
    assert snapshot.active_unfinished_backlog == 1
    assert snapshot.estimated_daily_capacity == 150
    assert snapshot.releasable_today == 147
    assert snapshot.data_quality == "insufficient_history"


@pytest.mark.asyncio
async def test_terminal_student_assigned_today_still_uses_capacity(db):
    agent = _agent("terminal-capacity-agent", "终态容量坐席")
    await _activate_agent(db, agent)
    terminal_student = _student_with_status(
        "今日已报名",
        created_at=AT,
        status=StudentStatus.enrolled,
        assigned_to=agent.id,
        assigned_at=datetime(2026, 8, 21, 16, 0, 0),
    )
    db.add(terminal_student)
    await db.commit()

    plan = await build_capacity_plan(db, [], [agent.id], at=AT)

    snapshot = plan.agents[0]
    assert snapshot.today_distinct_released == 1
    assert snapshot.active_unfinished_backlog == 0
    assert snapshot.releasable_today == 149


@pytest.mark.asyncio
async def test_non_active_employment_does_not_provide_capacity(db):
    active_agent = _agent("active-capacity-agent", "有效坐席")
    inactive_employment_agent = _agent("suspended-capacity-agent", "停用员工坐席")
    await _activate_agent(db, active_agent)
    db.add(inactive_employment_agent)
    await db.flush()
    db.add(
        AgentEmployment(
            user_id=inactive_employment_agent.id,
            status=EmploymentStatus.suspended,
        )
    )
    await db.commit()

    plan = await build_capacity_plan(
        db,
        [],
        [active_agent.id, inactive_employment_agent.id],
        at=AT,
    )

    assert [snapshot.agent_id for snapshot in plan.agents] == [active_agent.id]
    assert plan.skipped["invalid_target_agents"] == 1


@pytest.mark.asyncio
async def test_invalid_target_agents_are_reported_and_candidates_overflow(db):
    agent = _agent("valid-target-agent", "有效目标")
    non_agent = User(
        username="admin-target",
        hashed_password="test",
        role="admin",
        name="管理员目标",
        is_active=True,
    )
    await _activate_agent(db, agent)
    db.add(non_agent)
    await db.flush()
    db.add(AgentEmployment(user_id=non_agent.id, status=EmploymentStatus.active))
    students = [_student(f"无效目标候选{i}", created_at=AT) for i in range(3)]
    db.add_all(students)
    await db.commit()

    plan = await build_capacity_plan(
        db,
        [student.id for student in students],
        [agent.id, non_agent.id, 999999],
        at=AT,
    )

    assert plan.skipped["invalid_target_agents"] == 2
    assert plan.planned_count == 3
    assert plan.overflow_count == 0


@pytest.mark.asyncio
async def test_two_hundred_candidates_are_limited_to_one_hundred_fifty(db):
    agent = _agent("large-batch-agent", "大批量坐席")
    await _activate_agent(db, agent)
    students = [
        _student(f"大批量候选{i}", created_at=AT + timedelta(seconds=i))
        for i in range(200)
    ]
    db.add_all(students)
    await db.commit()

    plan = await build_capacity_plan(
        db,
        [student.id for student in students],
        [agent.id],
        at=AT,
    )

    assert plan.planned_count == 150
    assert plan.overflow_count == 50
    assert len(plan.overflow_student_ids) == 50


@pytest.mark.asyncio
async def test_capacity_is_clamped_to_configured_minimum_and_maximum(db):
    agent = _agent("clamp-agent", "边界坐席")
    await _activate_agent(db, agent)
    db.add_all(
        [
            SystemConfig(key="assignment_capacity_lookback_days", value="7"),
            SystemConfig(key="assignment_capacity_observed_days", value="5"),
            SystemConfig(key="assignment_capacity_min", value="10"),
            SystemConfig(key="assignment_capacity_max", value="20"),
        ]
    )
    history = [
        _student(f"历史{i}", created_at=AT - timedelta(days=10, seconds=i))
        for i in range(100)
    ]
    db.add_all(history)
    await db.flush()
    for offset, student in enumerate(history[:25]):
        db.add(
            DialLog(
                student_id=student.id,
                agent_id=agent.id,
                dialed_at=AT - timedelta(days=offset % 5),
            )
        )
    await db.commit()

    plan = await build_capacity_plan(db, [], [agent.id], at=AT)
    assert plan.agents[0].recent_distinct_students == 25
    assert plan.agents[0].observed_days == 5
    assert plan.agents[0].estimated_daily_capacity == 10

    for offset, student in enumerate(history[25:], start=25):
        db.add(
            DialLog(
                student_id=student.id,
                agent_id=agent.id,
                dialed_at=AT - timedelta(days=offset % 5),
            )
        )
    minimum = await db.get(SystemConfig, "assignment_capacity_min")
    maximum = await db.get(SystemConfig, "assignment_capacity_max")
    minimum.value = "1"
    maximum.value = "5"
    await db.commit()
    plan = await build_capacity_plan(db, [], [agent.id], at=AT)
    assert plan.agents[0].estimated_daily_capacity == 5


@pytest.mark.asyncio
async def test_capacity_round_robin_is_stable_and_returns_overflow(db):
    first = _agent("first-agent", "第一坐席")
    second = _agent("second-agent", "第二坐席")
    await _activate_agent(db, first)
    await _activate_agent(db, second)
    db.add_all(
        [
            SystemConfig(key="assignment_capacity_min", value="2"),
            SystemConfig(key="assignment_capacity_max", value="2"),
            SystemConfig(key="assignment_capacity_observed_days", value="1"),
        ]
    )
    students = [_student(f"候选{i}", created_at=AT + timedelta(seconds=i)) for i in range(5)]
    db.add_all(students)
    await db.commit()

    plan = await build_capacity_plan(
        db,
        [student.id for student in reversed(students)],
        [second.id, first.id],
        at=AT,
    )
    assert plan.candidate_count == 5
    assert plan.planned_count == 4
    assert plan.overflow_count == 1
    assert plan.assignments_by_agent[first.id] == (students[0].id, students[2].id)
    assert plan.assignments_by_agent[second.id] == (students[1].id, students[3].id)
    assert plan.overflow_student_ids == (students[4].id,)
    assert all(student.assigned_to is None for student in students)


def test_capacity_config_validation_covers_ranges_mode_and_bounds():
    assert validate_config_value("assignment_capacity_lookback_days", "30") == ("30", None)
    assert validate_config_value("assignment_capacity_observed_days", "0")[1]
    assert validate_config_value("assignment_capacity_min", "5001")[1]
    assert validate_config_value("assignment_capacity_insufficient_history", "other")[1]
    valid, error = validate_capacity_settings(
        lookback_days=7,
        observed_days=5,
        min_daily_capacity=201,
        max_daily_capacity=200,
        insufficient_history_mode="configured_min",
    )
    assert valid is False
    assert "min" in error
