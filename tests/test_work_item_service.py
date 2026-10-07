from datetime import datetime, timedelta

import pytest
from sqlalchemy import event, select

from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    HandoverBatch,
    HandoverBatchStatus,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import Student, StudentStatus, User, UserRole
from app.services.work_item_service import (
    cancel_source_work_item,
    sync_source_work_item,
    sync_student_work_items,
    sync_students_work_items,
    transfer_open_work_items,
)

NOW = datetime(2026, 7, 11, 3, 0, 0)


async def _second_agent(db) -> User:
    user = User(
        username="work-item-target",
        hashed_password="test",
        role=UserRole.agent,
        name="Work Item Target",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    db.add(
        AgentEmployment(
            user_id=user.id,
            status=EmploymentStatus.active,
        )
    )
    await db.flush()
    return user


async def _assigned_student(db, agent_user, **values) -> Student:
    student = Student(
        name="Work Item Student",
        assigned_to=agent_user.id,
        status=StudentStatus.not_contacted,
        **values,
    )
    db.add(student)
    await db.flush()
    return student


@pytest.mark.asyncio
async def test_student_sync_creates_one_lead_and_preserves_creator_on_owner_change(
    db,
    admin_user,
    agent_user,
):
    target = await _second_agent(db)
    student = await _assigned_student(db, agent_user)

    first = await sync_student_work_items(db, student, admin_user, at=NOW)
    repeated = await sync_student_work_items(db, student, admin_user, at=NOW)

    lead = next(item for item in first if item.kind == WorkItemKind.lead_contact)
    repeated_lead = next(item for item in repeated if item.kind == WorkItemKind.lead_contact)
    assert repeated_lead.id == lead.id
    assert lead.status == WorkItemStatus.open
    assert lead.owner_agent_id == agent_user.id
    assert lead.creator_user_id == agent_user.id

    student.assigned_to = target.id
    changed = await sync_student_work_items(
        db,
        student,
        admin_user,
        at=NOW + timedelta(minutes=1),
    )
    changed_lead = next(item for item in changed if item.kind == WorkItemKind.lead_contact)
    assert changed_lead.id == lead.id
    assert changed_lead.owner_agent_id == target.id
    assert changed_lead.creator_user_id == agent_user.id


@pytest.mark.asyncio
async def test_terminal_student_completes_existing_lead_item(
    db,
    admin_user,
    agent_user,
):
    student = await _assigned_student(db, agent_user)
    items = await sync_student_work_items(db, student, admin_user, at=NOW)
    lead = next(item for item in items if item.kind == WorkItemKind.lead_contact)

    student.status = StudentStatus.invalid
    completed = await sync_student_work_items(
        db,
        student,
        admin_user,
        at=NOW + timedelta(hours=1),
    )

    completed_lead = next(item for item in completed if item.kind == WorkItemKind.lead_contact)
    assert completed_lead.id == lead.id
    assert completed_lead.status == WorkItemStatus.completed
    assert completed_lead.completed_at == NOW + timedelta(hours=1)


@pytest.mark.asyncio
async def test_help_request_uses_stable_student_source_key(
    db,
    admin_user,
    agent_user,
):
    student = await _assigned_student(db, agent_user, need_help=True)

    items = await sync_student_work_items(db, student, admin_user, at=NOW)

    help_item = next(item for item in items if item.kind == WorkItemKind.help_request)
    assert help_item.source_type == "help"
    assert help_item.source_id == student.id
    assert help_item.priority == "high"
    assert help_item.status == WorkItemStatus.open
    repeated = await sync_student_work_items(
        db,
        student,
        admin_user,
        at=NOW + timedelta(minutes=1),
    )
    repeated_help = next(item for item in repeated if item.kind == WorkItemKind.help_request)
    assert repeated_help.due_at == NOW
    assert repeated_help.version == 1

    student.need_help = False
    items = await sync_student_work_items(
        db,
        student,
        admin_user,
        at=NOW + timedelta(minutes=5),
    )
    closed = next(item for item in items if item.kind == WorkItemKind.help_request)
    assert closed.id == help_item.id
    assert closed.status == WorkItemStatus.completed


@pytest.mark.asyncio
async def test_follow_up_completion_and_reopen_reuse_item_and_creator(
    db,
    admin_user,
    agent_user,
):
    target = await _second_agent(db)
    student = await _assigned_student(db, agent_user)
    due_at = NOW + timedelta(days=1)

    item = await sync_source_work_item(
        db,
        WorkItemKind.scheduled_follow_up,
        "follow_up",
        101,
        student,
        agent_user.id,
        due_at,
        False,
        admin_user,
        at=NOW,
    )
    assert item.status == WorkItemStatus.open
    assert item.creator_user_id == agent_user.id

    completed = await sync_source_work_item(
        db,
        WorkItemKind.scheduled_follow_up,
        "follow_up",
        101,
        student,
        agent_user.id,
        due_at,
        True,
        admin_user,
        at=NOW + timedelta(hours=1),
    )
    assert completed.id == item.id
    assert completed.status == WorkItemStatus.completed

    student.assigned_to = target.id
    reopened = await sync_source_work_item(
        db,
        WorkItemKind.scheduled_follow_up,
        "follow_up",
        101,
        student,
        target.id,
        due_at + timedelta(days=1),
        False,
        admin_user,
        at=NOW + timedelta(hours=2),
    )
    assert reopened.id == item.id
    assert reopened.status == WorkItemStatus.open
    assert reopened.owner_agent_id == target.id
    assert reopened.creator_user_id == agent_user.id
    assert reopened.due_at == due_at + timedelta(days=1)


@pytest.mark.asyncio
async def test_open_source_item_falls_back_to_creator_when_student_is_unassigned(
    db,
    admin_user,
    agent_user,
):
    student = Student(
        name="Unassigned Enrolled Student",
        assigned_to=None,
        status=StudentStatus.enrolled,
    )
    db.add(student)
    await db.flush()

    item = await sync_source_work_item(
        db,
        WorkItemKind.enrollment_settlement,
        "enrollment",
        102,
        student,
        agent_user.id,
        NOW,
        False,
        admin_user,
        at=NOW,
    )

    assert item.status == WorkItemStatus.open
    assert item.owner_agent_id == agent_user.id
    assert item.creator_user_id == agent_user.id


@pytest.mark.asyncio
async def test_cancel_source_item_preserves_history_and_is_idempotent(
    db,
    admin_user,
    agent_user,
):
    student = await _assigned_student(db, agent_user)
    item = await sync_source_work_item(
        db,
        WorkItemKind.scheduled_follow_up,
        "follow_up",
        103,
        student,
        agent_user.id,
        NOW,
        False,
        admin_user,
        at=NOW,
    )

    cancelled = await cancel_source_work_item(
        db,
        WorkItemKind.scheduled_follow_up,
        "follow_up",
        103,
        at=NOW + timedelta(minutes=1),
    )
    repeated = await cancel_source_work_item(
        db,
        WorkItemKind.scheduled_follow_up,
        "follow_up",
        103,
        at=NOW + timedelta(minutes=2),
    )

    assert cancelled is item
    assert repeated is item
    assert item.status == WorkItemStatus.cancelled
    assert item.owner_agent_id is None
    assert item.creator_user_id == agent_user.id
    assert item.version == 2
    assert item.updated_at == NOW + timedelta(minutes=1)


@pytest.mark.asyncio
async def test_bulk_student_sync_uses_constant_select_count(
    db,
    admin_user,
    agent_user,
):
    students = [
        await _assigned_student(db, agent_user, need_help=index % 2 == 0) for index in range(20)
    ]
    statements: list[str] = []

    def record_selects(_conn, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            statements.append(statement)

    sync_engine = db.bind.sync_engine
    event.listen(sync_engine, "before_cursor_execute", record_selects)
    try:
        items = await sync_students_work_items(
            db,
            students,
            admin_user,
            at=NOW,
        )
    finally:
        event.remove(sync_engine, "before_cursor_execute", record_selects)

    assert len(items) == 30
    assert len(statements) <= 2


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("kind", "source_type", "source_id"),
    [
        (WorkItemKind.home_visit, "home_visit", 201),
        (WorkItemKind.campus_visit, "campus_visit", 301),
        (WorkItemKind.enrollment_settlement, "enrollment", 401),
    ],
)
async def test_source_kinds_open_and_complete_with_stable_keys(
    db,
    admin_user,
    agent_user,
    kind,
    source_type,
    source_id,
):
    student = await _assigned_student(db, agent_user)
    item = await sync_source_work_item(
        db,
        kind,
        source_type,
        source_id,
        student,
        agent_user.id,
        NOW,
        False,
        admin_user,
        at=NOW,
    )
    completed = await sync_source_work_item(
        db,
        kind,
        source_type,
        source_id,
        student,
        agent_user.id,
        NOW,
        True,
        admin_user,
        at=NOW + timedelta(minutes=1),
    )

    assert completed.id == item.id
    assert completed.status == WorkItemStatus.completed
    rows = (
        (
            await db.execute(
                select(WorkItem).where(
                    WorkItem.kind == kind,
                    WorkItem.source_type == source_type,
                    WorkItem.source_id == source_id,
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_transfer_moves_only_matching_open_items_and_preserves_creator(
    db,
    admin_user,
    agent_user,
):
    target = await _second_agent(db)
    batch = HandoverBatch(
        source_agent_id=agent_user.id,
        status=HandoverBatchStatus.pending,
        initiated_by=admin_user.id,
        idempotency_key="work-item-transfer-test",
    )
    db.add(batch)
    await db.flush()
    first = await _assigned_student(db, agent_user)
    second = await _assigned_student(db, agent_user)
    open_item = await sync_source_work_item(
        db,
        WorkItemKind.home_visit,
        "home_visit",
        501,
        first,
        agent_user.id,
        NOW,
        False,
        admin_user,
        at=NOW,
    )
    completed_item = await sync_source_work_item(
        db,
        WorkItemKind.campus_visit,
        "campus_visit",
        502,
        second,
        agent_user.id,
        NOW,
        True,
        admin_user,
        at=NOW,
    )

    count = await transfer_open_work_items(
        db,
        [first.id, second.id],
        target.id,
        WorkItemStatus.open,
        WorkItemStatus.blocked_handover,
        handover_batch_id=batch.id,
        at=NOW + timedelta(hours=1),
    )

    assert count == 1
    await db.refresh(open_item)
    await db.refresh(completed_item)
    assert open_item.owner_agent_id == target.id
    assert open_item.creator_user_id == agent_user.id
    assert open_item.status == WorkItemStatus.blocked_handover
    assert open_item.handover_batch_id == batch.id
    assert open_item.version == 2
    assert completed_item.owner_agent_id == agent_user.id
    assert completed_item.status == WorkItemStatus.completed
