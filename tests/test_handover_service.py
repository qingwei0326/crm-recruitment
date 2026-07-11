from datetime import timedelta

import pytest
from sqlalchemy import func, select

import app.services.handover_service as handover_service
from app.domain_errors import DomainConflict
from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    HandoverBatch,
    HandoverBatchStatus,
    HandoverItem,
    HandoverItemStatus,
    HandoverTransfer,
    HandoverTransferMode,
    StudentAssignment,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    EnrollmentRecord,
    FollowUp,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    Student,
    StudentStage,
    StudentStatus,
    User,
    UserRole,
)
from app.services.handover_service import (
    execute_transfer,
    preview_transfer,
    start_handover,
)
from app.services.work_item_service import (
    sync_source_work_item,
    sync_student_work_items,
)
from app.utils import utcnow


async def _source_agent(db) -> User:
    source = User(
        username="handover-source",
        hashed_password="test",
        role=UserRole.agent,
        name="Handover Source",
        is_active=True,
    )
    db.add(source)
    await db.flush()
    db.add(
        AgentEmployment(
            user_id=source.id,
            status=EmploymentStatus.active,
            updated_by=source.id,
        )
    )
    await db.flush()
    return source


async def _handover_case(db, admin_user, agent_user, assignment_baseline):
    source = await _source_agent(db)
    students = [
        Student(
            name="Default Lead",
            assigned_to=source.id,
            status=StudentStatus.not_contacted,
            status_detail="",
            intent_level=IntentLevel.none,
            stage=StudentStage.initial_contact,
        ),
        Student(
            name="Progressed Lead",
            assigned_to=source.id,
            status=StudentStatus.contacted,
            status_detail="非常有意向",
            intent_level=IntentLevel.A,
            stage=StudentStage.materials_sent,
            need_help=True,
        ),
        Student(
            name="Follow Up Lead",
            assigned_to=source.id,
            status=StudentStatus.pending_visit,
            intent_level=IntentLevel.B,
            stage=StudentStage.interested,
        ),
        Student(
            name="Home Visit Lead",
            assigned_to=source.id,
            status=StudentStatus.contacted,
            intent_level=IntentLevel.A,
            stage=StudentStage.home_visit_scheduled,
        ),
        Student(
            name="Campus Visit Lead",
            assigned_to=source.id,
            status=StudentStatus.pending_visit,
            intent_level=IntentLevel.C,
            stage=StudentStage.campus_visit_scheduled,
        ),
        Student(
            name="Invalid History",
            assigned_to=source.id,
            status=StudentStatus.invalid,
            status_detail="已报名其他学校",
            outcome_reason_code="enrolled_elsewhere",
            intent_level=IntentLevel.C,
            stage=StudentStage.interested,
        ),
        Student(
            name="Enrolled History",
            assigned_to=source.id,
            status=StudentStatus.enrolled,
            intent_level=IntentLevel.A,
            stage=StudentStage.enrolled,
        ),
    ]
    db.add_all(students)
    await db.flush()
    for student in students:
        await assignment_baseline(student, source)

    await sync_student_work_items(db, students[0], admin_user)
    await sync_student_work_items(db, students[1], admin_user)
    await sync_student_work_items(db, students[2], admin_user)
    await sync_student_work_items(db, students[3], admin_user)
    await sync_student_work_items(db, students[4], admin_user)

    follow_up = FollowUp(
        student_id=students[2].id,
        agent_id=source.id,
        follow_up_date=utcnow() - timedelta(days=1),
    )
    home_visit = HomeVisitTask(
        student_id=students[3].id,
        creator_agent_id=source.id,
        status=HomeVisitStatus.scheduled,
        scheduled_at=utcnow() + timedelta(days=1),
    )
    campus_visit = CampusVisitTask(
        student_id=students[4].id,
        creator_user_id=source.id,
        status=CampusVisitStatus.scheduled,
        appointment_at=utcnow() + timedelta(days=2),
    )
    db.add_all([follow_up, home_visit, campus_visit])
    await db.flush()
    await sync_source_work_item(
        db,
        WorkItemKind.scheduled_follow_up,
        "follow_up",
        follow_up.id,
        students[2],
        source.id,
        follow_up.follow_up_date,
        False,
        admin_user,
    )
    await sync_source_work_item(
        db,
        WorkItemKind.home_visit,
        "home_visit",
        home_visit.id,
        students[3],
        source.id,
        home_visit.scheduled_at,
        False,
        admin_user,
    )
    await sync_source_work_item(
        db,
        WorkItemKind.campus_visit,
        "campus_visit",
        campus_visit.id,
        students[4],
        source.id,
        campus_visit.appointment_at,
        False,
        admin_user,
    )

    enrollment = EnrollmentRecord(
        student_id=students[6].id,
        attributed_agent_id=source.id,
        confirmed_by_admin_id=admin_user.id,
        first_assigned_agent_id=source.id,
        current_assigned_agent_id=source.id,
        last_effective_agent_id=source.id,
        student_name_snapshot=students[6].name,
        enrolled_program="护理",
    )
    db.add(enrollment)
    await db.commit()
    return source, agent_user, students, enrollment


@pytest.mark.asyncio
async def test_start_handover_preserves_progress_and_blocks_open_work(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    source, _target, students, enrollment = await _handover_case(
        db,
        admin_user,
        agent_user,
        assignment_baseline,
    )
    nonterminal = students[:5]
    terminal = students[5:]
    snapshots = {
        student.id: (
            student.status,
            student.status_detail,
            student.intent_level,
            student.stage,
            student.need_help,
        )
        for student in students
    }
    token_version = source.token_version

    batch = await start_handover(
        db,
        source,
        admin_user,
        "handover-start-1",
        expected_employment_version=1,
    )
    repeated = await start_handover(
        db,
        source,
        admin_user,
        "handover-start-1",
        expected_employment_version=1,
    )

    assert repeated.id == batch.id
    assert batch.status == HandoverBatchStatus.pending
    assert batch.total_items == 5
    assert batch.remaining_items == 5
    assert batch.transferred_items == 0
    assert source.is_active is False
    assert source.token_version == token_version + 1
    employment = await db.get(AgentEmployment, source.id)
    assert employment.status == EmploymentStatus.handover_pending
    assert employment.version == 2

    items = (
        await db.execute(
            select(HandoverItem).where(HandoverItem.handover_batch_id == batch.id)
        )
    ).scalars().all()
    assert {item.student_id for item in items} == {
        student.id for student in nonterminal
    }
    assert all(item.status == HandoverItemStatus.pending for item in items)

    for student in students:
        await db.refresh(student)
        assert (
            student.status,
            student.status_detail,
            student.intent_level,
            student.stage,
            student.need_help,
        ) == snapshots[student.id]
    assert all(student.assigned_to == source.id for student in nonterminal)
    assert all(student.assigned_to is None for student in terminal)

    blocked_work = (
        await db.execute(
            select(WorkItem).where(
                WorkItem.student_id.in_([student.id for student in nonterminal])
            )
        )
    ).scalars().all()
    assert blocked_work
    assert all(item.status == WorkItemStatus.blocked_handover for item in blocked_work)
    assert all(item.owner_agent_id == source.id for item in blocked_work)
    assert all(item.handover_batch_id == batch.id for item in blocked_work)
    assert enrollment.attributed_agent_id == source.id
    batch_count = (
        await db.execute(select(func.count(HandoverBatch.id)))
    ).scalar_one()
    assert batch_count == 1


@pytest.mark.asyncio
async def test_preview_selected_transfer_and_complete_all_remaining(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    source, target, students, enrollment = await _handover_case(
        db,
        admin_user,
        agent_user,
        assignment_baseline,
    )
    batch = await start_handover(
        db,
        source,
        admin_user,
        "handover-start-2",
    )
    selected_ids = (students[1].id, students[2].id)

    preview = await preview_transfer(db, batch.id, selected_ids)

    assert preview.batch_id == batch.id
    assert preview.version == 1
    assert preview.selected_count == 2
    assert preview.open_work_item_count >= 3
    assert preview.overdue_count == 1
    assert preview.high_intent_count == 1
    assert preview.by_kind[WorkItemKind.scheduled_follow_up.value] == 1

    selected = await execute_transfer(
        db,
        batch.id,
        target.id,
        HandoverTransferMode.selected,
        admin_user,
        "handover-transfer-selected",
        1,
        selected_ids,
    )
    repeated = await execute_transfer(
        db,
        batch.id,
        target.id,
        HandoverTransferMode.selected,
        admin_user,
        "handover-transfer-selected",
        1,
        selected_ids,
    )

    assert repeated.transfer_id == selected.transfer_id
    assert selected.transferred_ids == tuple(sorted(selected_ids))
    assert selected.skipped_ids == ()
    assert selected.remaining_count == 3
    assert selected.batch_version == 2
    assert selected.completed is False
    with pytest.raises(DomainConflict, match="幂等键"):
        await execute_transfer(
            db,
            batch.id,
            target.id,
            HandoverTransferMode.selected,
            admin_user,
            "handover-transfer-selected",
            2,
            selected_ids,
        )
    with pytest.raises(DomainConflict, match="幂等键"):
        await execute_transfer(
            db,
            batch.id,
            target.id,
            HandoverTransferMode.selected,
            admin_user,
            "handover-transfer-selected",
            1,
            (students[0].id, students[2].id),
        )
    for student in students[:5]:
        await db.refresh(student)
        expected_owner = target.id if student.id in selected_ids else source.id
        assert student.assigned_to == expected_owner

    completed = await execute_transfer(
        db,
        batch.id,
        target.id,
        HandoverTransferMode.all_remaining,
        admin_user,
        "handover-transfer-all",
        2,
    )
    replayed_selected = await execute_transfer(
        db,
        batch.id,
        target.id,
        HandoverTransferMode.selected,
        admin_user,
        "handover-transfer-selected",
        1,
        selected_ids,
    )

    assert completed.remaining_count == 0
    assert completed.batch_version == 3
    assert completed.completed is True
    assert replayed_selected == selected
    await db.refresh(batch)
    assert batch.status == HandoverBatchStatus.completed
    employment = await db.get(AgentEmployment, source.id)
    assert employment.status == EmploymentStatus.offboarded
    assert employment.version == 3
    for student in students[:5]:
        await db.refresh(student)
        assert student.assigned_to == target.id

    open_work = (
        await db.execute(
            select(WorkItem).where(
                WorkItem.student_id.in_([student.id for student in students[:5]])
            )
        )
    ).scalars().all()
    assert all(item.status == WorkItemStatus.open for item in open_work)
    assert all(item.owner_agent_id == target.id for item in open_work)
    assert all(item.creator_user_id == source.id for item in open_work)
    assert enrollment.attributed_agent_id == source.id
    assert (
        await db.execute(select(func.count(HandoverTransfer.id)))
    ).scalar_one() == 2


@pytest.mark.asyncio
async def test_transfer_version_conflict_happens_before_writes(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    source, target, students, _enrollment = await _handover_case(
        db,
        admin_user,
        agent_user,
        assignment_baseline,
    )
    batch = await start_handover(
        db,
        source,
        admin_user,
        "handover-start-3",
    )

    with pytest.raises(DomainConflict, match="刷新"):
        await execute_transfer(
            db,
            batch.id,
            target.id,
            HandoverTransferMode.selected,
            admin_user,
            "handover-transfer-stale",
            99,
            (students[0].id,),
        )

    await db.refresh(students[0])
    assert students[0].assigned_to == source.id
    assert (
        await db.execute(select(func.count(HandoverTransfer.id)))
    ).scalar_one() == 0
    item = (
        await db.execute(
            select(HandoverItem).where(
                HandoverItem.handover_batch_id == batch.id,
                HandoverItem.student_id == students[0].id,
            )
        )
    ).scalar_one()
    assert item.status == HandoverItemStatus.pending


@pytest.mark.asyncio
async def test_normal_assignment_cannot_bypass_pending_handover(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    from app.services.assignment_service import (
        AssignmentTarget,
        apply_assignment_changes,
    )

    source, target, students, _enrollment = await _handover_case(
        db,
        admin_user,
        agent_user,
        assignment_baseline,
    )
    await start_handover(db, source, admin_user, "handover-start-4")

    with pytest.raises(DomainConflict, match="交接"):
        await apply_assignment_changes(
            db,
            [AssignmentTarget(student_id=students[0].id, agent_id=target.id)],
            operator=admin_user,
            reason="manual_assignment",
            batch_id="handover-bypass-test",
        )

    active = (
        await db.execute(
            select(StudentAssignment).where(
                StudentAssignment.student_id == students[0].id,
                StudentAssignment.ended_at.is_(None),
            )
        )
    ).scalar_one()
    assert active.agent_id == source.id


@pytest.mark.asyncio
async def test_start_handover_integrity_conflict_preserves_outer_transaction(
    db,
    admin_user,
    agent_user,
    monkeypatch,
):
    source = await _source_agent(db)
    conflicting = HandoverBatch(
        source_agent_id=agent_user.id,
        status=HandoverBatchStatus.completed,
        version=1,
        total_items=0,
        remaining_items=0,
        transferred_items=0,
        initiated_by=admin_user.id,
        initiated_at=utcnow(),
        completed_by=admin_user.id,
        completed_at=utcnow(),
        idempotency_key="handover-conflicting-key",
    )
    db.add(conflicting)
    await db.commit()

    marker = Student(name="Outer Transaction Marker")
    db.add(marker)
    await db.flush()
    marker_id = marker.id

    original_lookup = handover_service._batch_by_idempotency_key
    lookup_count = 0

    async def hide_first_lookup(session, idempotency_key):
        nonlocal lookup_count
        lookup_count += 1
        if lookup_count == 1:
            return None
        return await original_lookup(session, idempotency_key)

    monkeypatch.setattr(
        handover_service,
        "_batch_by_idempotency_key",
        hide_first_lookup,
    )

    with pytest.raises(DomainConflict, match="其他员工"):
        await start_handover(
            db,
            source,
            admin_user,
            "handover-conflicting-key",
        )

    await db.commit()
    assert await db.get(Student, marker_id) is not None
