from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.domain_errors import DomainConflict
from app.domain_models import (
    AgentEmployment,
    AgentEmploymentEvent,
    EmploymentStatus,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import Student
from app.services.employment_service import set_employment_status

SUSPENDED_AT = datetime(2026, 7, 11, 2, 0, 0)
RESUMED_AT = SUSPENDED_AT + timedelta(hours=1)


async def _seed_work_items(db, agent_user):
    student = Student(name="Employment Student")
    db.add(student)
    await db.flush()
    open_item = WorkItem(
        student_id=student.id,
        kind=WorkItemKind.lead_contact,
        status=WorkItemStatus.open,
        owner_agent_id=agent_user.id,
        creator_user_id=agent_user.id,
        source_type="student",
        source_id=student.id,
    )
    completed_item = WorkItem(
        student_id=student.id,
        kind=WorkItemKind.help_request,
        status=WorkItemStatus.completed,
        owner_agent_id=agent_user.id,
        creator_user_id=agent_user.id,
        source_type="student_help",
        source_id=student.id,
    )
    db.add_all([open_item, completed_item])
    await db.commit()
    return open_item, completed_item


@pytest.mark.asyncio
async def test_suspend_updates_auth_employment_event_and_open_work_items(
    db,
    admin_user,
    agent_user,
):
    open_item, completed_item = await _seed_work_items(db, agent_user)
    initial_token_version = agent_user.token_version

    employment = await set_employment_status(
        db,
        agent_user,
        EmploymentStatus.suspended,
        operator=admin_user,
        reason="admin_suspend",
        expected_version=1,
        at=SUSPENDED_AT,
    )

    assert employment.status == EmploymentStatus.suspended
    assert employment.version == 2
    assert employment.status_changed_at == SUSPENDED_AT
    assert employment.updated_by == admin_user.id
    assert agent_user.is_active is False
    assert agent_user.token_version == initial_token_version + 1
    await db.refresh(open_item)
    await db.refresh(completed_item)
    assert open_item.status == WorkItemStatus.blocked_suspension
    assert open_item.updated_at == SUSPENDED_AT
    assert completed_item.status == WorkItemStatus.completed

    event = (
        await db.execute(
            select(AgentEmploymentEvent).where(AgentEmploymentEvent.user_id == agent_user.id)
        )
    ).scalar_one()
    assert event.from_status == EmploymentStatus.active
    assert event.to_status == EmploymentStatus.suspended
    assert event.reason == "admin_suspend"
    assert event.operator_id == admin_user.id
    assert event.created_at == SUSPENDED_AT


@pytest.mark.asyncio
async def test_resume_reopens_only_suspension_blocked_work_items(
    db,
    admin_user,
    agent_user,
):
    open_item, _completed_item = await _seed_work_items(db, agent_user)
    handover_item = WorkItem(
        student_id=open_item.student_id,
        kind=WorkItemKind.scheduled_follow_up,
        status=WorkItemStatus.blocked_handover,
        owner_agent_id=agent_user.id,
        creator_user_id=agent_user.id,
        source_type="follow_up",
        source_id=999,
    )
    db.add(handover_item)
    await db.commit()
    await set_employment_status(
        db,
        agent_user,
        EmploymentStatus.suspended,
        operator=admin_user,
        reason="admin_suspend",
        expected_version=1,
        at=SUSPENDED_AT,
    )
    token_version_after_suspend = agent_user.token_version

    employment = await set_employment_status(
        db,
        agent_user,
        EmploymentStatus.active,
        operator=admin_user,
        reason="admin_resume",
        expected_version=2,
        at=RESUMED_AT,
    )

    assert employment.status == EmploymentStatus.active
    assert employment.version == 3
    assert employment.status_changed_at == RESUMED_AT
    assert agent_user.is_active is True
    assert agent_user.token_version == token_version_after_suspend
    await db.refresh(open_item)
    await db.refresh(handover_item)
    assert open_item.status == WorkItemStatus.open
    assert open_item.updated_at == RESUMED_AT
    assert handover_item.status == WorkItemStatus.blocked_handover

    events = (
        (
            await db.execute(
                select(AgentEmploymentEvent)
                .where(AgentEmploymentEvent.user_id == agent_user.id)
                .order_by(AgentEmploymentEvent.id)
            )
        )
        .scalars()
        .all()
    )
    assert [event.to_status for event in events] == [
        EmploymentStatus.suspended,
        EmploymentStatus.active,
    ]


@pytest.mark.asyncio
async def test_stale_employment_version_rejects_all_changes(
    db,
    admin_user,
    agent_user,
):
    open_item, _completed_item = await _seed_work_items(db, agent_user)
    initial_token_version = agent_user.token_version

    with pytest.raises(DomainConflict, match="刷新后重试"):
        await set_employment_status(
            db,
            agent_user,
            EmploymentStatus.suspended,
            operator=admin_user,
            reason="admin_suspend",
            expected_version=99,
            at=SUSPENDED_AT,
        )

    employment = await db.get(AgentEmployment, agent_user.id)
    assert employment.status == EmploymentStatus.active
    assert employment.version == 1
    assert agent_user.is_active is True
    assert agent_user.token_version == initial_token_version
    await db.refresh(open_item)
    assert open_item.status == WorkItemStatus.open
    assert not (await db.execute(select(AgentEmploymentEvent))).scalars().all()


@pytest.mark.asyncio
async def test_service_does_not_commit_and_rejects_invalid_transition(
    db,
    admin_user,
    agent_user,
):
    agent_id = agent_user.id
    with pytest.raises(DomainConflict, match="不允许"):
        await set_employment_status(
            db,
            agent_user,
            EmploymentStatus.offboarded,
            operator=admin_user,
            reason="invalid_direct_offboard",
        )

    await set_employment_status(
        db,
        agent_user,
        EmploymentStatus.suspended,
        operator=admin_user,
        reason="admin_suspend",
        at=SUSPENDED_AT,
    )
    await db.rollback()

    employment = await db.get(AgentEmployment, agent_id)
    persisted_user = await db.get(type(agent_user), agent_id)
    assert employment.status == EmploymentStatus.active
    assert employment.version == 1
    assert persisted_user.is_active is True
    assert not (await db.execute(select(AgentEmploymentEvent))).scalars().all()
