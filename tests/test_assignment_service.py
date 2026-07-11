from datetime import datetime

import pytest
from sqlalchemy import select, text

from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    StudentAssignment,
    WorkItem,
    WorkItemKind,
)
from app.models import OperationLog, Student, User, UserRole
from app.services.assignment_service import (
    AssignmentTarget,
    apply_assignment_changes,
)
from app.services.work_item_service import sync_student_work_items
from app.utils import parse_assignment_rollback_note

INITIAL_AT = datetime(2026, 7, 10, 1, 0, 0)
CHANGED_AT = datetime(2026, 7, 11, 1, 0, 0)


async def _seed_assignment(db, *, target_status=EmploymentStatus.active):
    operator = User(
        username="assignment-admin",
        hashed_password="test",
        role=UserRole.admin,
        name="Assignment Admin",
    )
    source = User(
        username="assignment-source",
        hashed_password="test",
        role=UserRole.agent,
        name="Source Agent",
    )
    target = User(
        username="assignment-target",
        hashed_password="test",
        role=UserRole.agent,
        name="Target Agent",
        is_active=target_status == EmploymentStatus.active,
    )
    db.add_all([operator, source, target])
    await db.flush()
    db.add_all(
        [
            AgentEmployment(user_id=source.id, status=EmploymentStatus.active),
            AgentEmployment(user_id=target.id, status=target_status),
        ]
    )
    student = Student(
        name="Assignment Student",
        case_no="assignment-case",
        assigned_to=source.id,
        assigned_at=INITIAL_AT,
    )
    db.add(student)
    await db.flush()
    db.add(
        StudentAssignment(
            student_id=student.id,
            agent_id=source.id,
            started_at=INITIAL_AT,
            start_reason="backfill",
            started_by=operator.id,
        )
    )
    await db.commit()
    return operator, source, target, student


@pytest.mark.asyncio
async def test_reassignment_updates_history_projection_and_audit(db):
    operator, source, target, student = await _seed_assignment(db)
    (lead_item,) = await sync_student_work_items(
        db,
        student,
        operator,
        at=INITIAL_AT,
    )

    result = await apply_assignment_changes(
        db,
        [AssignmentTarget(student_id=student.id, agent_id=target.id)],
        operator=operator,
        reason="manual_assignment",
        batch_id="assign-test-1",
        at=CHANGED_AT,
    )

    assert result.changed_ids == (student.id,)
    assert result.unchanged_ids == ()
    await db.refresh(student)
    assert student.assigned_to == target.id
    assert student.assigned_at == CHANGED_AT
    await db.refresh(lead_item)
    assert lead_item.owner_agent_id == target.id
    assert lead_item.creator_user_id == source.id
    assert lead_item.kind == WorkItemKind.lead_contact
    assert (
        await db.execute(
            select(WorkItem).where(
                WorkItem.kind == WorkItemKind.lead_contact,
                WorkItem.source_type == "student",
                WorkItem.source_id == student.id,
            )
        )
    ).scalar_one().id == lead_item.id

    assignments = (
        (
            await db.execute(
                select(StudentAssignment)
                .where(StudentAssignment.student_id == student.id)
                .order_by(StudentAssignment.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(assignments) == 2
    assert assignments[0].agent_id == source.id
    assert assignments[0].ended_at == CHANGED_AT
    assert assignments[0].end_reason == "manual_assignment"
    assert assignments[0].ended_by == operator.id
    assert assignments[1].agent_id == target.id
    assert assignments[1].started_at == CHANGED_AT
    assert assignments[1].start_reason == "manual_assignment"
    assert assignments[1].previous_assignment_id == assignments[0].id

    log = (
        await db.execute(
            select(OperationLog).where(OperationLog.target_student_id == student.id)
        )
    ).scalar_one()
    assert log.action == "修改归属"
    assert log.batch_id == "assign-test-1"
    assert log.old_status == f"agent:{source.id}"
    assert log.new_status == f"agent:{target.id}"
    assert parse_assignment_rollback_note(log.note_content) == {
        "rollback_type": "assignment",
        "old_assigned_to": source.id,
        "old_assigned_at": INITIAL_AT.isoformat(),
        "new_assigned_to": target.id,
        "new_assigned_at": CHANGED_AT.isoformat(),
    }


@pytest.mark.asyncio
async def test_unassignment_closes_history_and_clears_projection(db):
    operator, _source, _target, student = await _seed_assignment(db)

    result = await apply_assignment_changes(
        db,
        [AssignmentTarget(student_id=student.id, agent_id=None)],
        operator=operator,
        reason="terminal_unassign",
        batch_id="unassign-test",
        at=CHANGED_AT,
    )

    assert result.changed_ids == (student.id,)
    await db.refresh(student)
    assert student.assigned_to is None
    assert student.assigned_at is None
    assignments = (
        (
            await db.execute(
                select(StudentAssignment).where(StudentAssignment.student_id == student.id)
            )
        )
        .scalars()
        .all()
    )
    assert len(assignments) == 1
    assert assignments[0].ended_at == CHANGED_AT


@pytest.mark.asyncio
async def test_unchanged_assignment_is_reported_without_new_rows(db):
    operator, source, _target, student = await _seed_assignment(db)

    result = await apply_assignment_changes(
        db,
        [
            AssignmentTarget(student_id=student.id, agent_id=source.id),
            AssignmentTarget(student_id=student.id, agent_id=source.id),
        ],
        operator=operator,
        reason="manual_assignment",
        batch_id="unchanged-test",
        at=CHANGED_AT,
    )

    assert result.changed_ids == ()
    assert result.unchanged_ids == (student.id,)
    assignment_rows = await db.execute(
        select(StudentAssignment).where(
            StudentAssignment.student_id == student.id
        )
    )
    assignment_count = len(assignment_rows.scalars().all())
    log_count = len((await db.execute(select(OperationLog))).scalars().all())
    assert assignment_count == 1
    assert log_count == 0


@pytest.mark.asyncio
async def test_conflicting_targets_for_one_student_are_rejected(db):
    from app.domain_errors import DomainConflict

    operator, source, target, student = await _seed_assignment(db)

    with pytest.raises(DomainConflict, match="多个目标负责人"):
        await apply_assignment_changes(
            db,
            [
                AssignmentTarget(student_id=student.id, agent_id=source.id),
                AssignmentTarget(student_id=student.id, agent_id=target.id),
            ],
            operator=operator,
            reason="manual_assignment",
            batch_id="conflict-test",
        )


@pytest.mark.asyncio
async def test_inactive_target_is_rejected_before_mutation(db):
    from app.domain_errors import InactiveAssignmentTarget

    operator, source, target, student = await _seed_assignment(
        db,
        target_status=EmploymentStatus.suspended,
    )

    with pytest.raises(InactiveAssignmentTarget, match=str(target.id)):
        await apply_assignment_changes(
            db,
            [AssignmentTarget(student_id=student.id, agent_id=target.id)],
            operator=operator,
            reason="manual_assignment",
            batch_id="inactive-target-test",
        )

    await db.refresh(student)
    assert student.assigned_to == source.id


@pytest.mark.asyncio
async def test_missing_student_is_rejected(db):
    from app.domain_errors import StudentNotFound

    operator, _source, _target, _student = await _seed_assignment(db)

    with pytest.raises(StudentNotFound, match="999999"):
        await apply_assignment_changes(
            db,
            [AssignmentTarget(student_id=999999, agent_id=None)],
            operator=operator,
            reason="manual_assignment",
            batch_id="missing-student-test",
        )


@pytest.mark.asyncio
async def test_duplicate_active_assignment_is_rejected(db):
    from app.domain_errors import DomainConflict

    operator, source, target, student = await _seed_assignment(db)
    await db.execute(text("DROP INDEX uq_student_assignments_active_student"))
    db.add(
        StudentAssignment(
            student_id=student.id,
            agent_id=source.id,
            started_at=INITIAL_AT,
            start_reason="corrupt-test-row",
            started_by=operator.id,
        )
    )
    await db.commit()

    with pytest.raises(DomainConflict, match="多个活跃归属"):
        await apply_assignment_changes(
            db,
            [AssignmentTarget(student_id=student.id, agent_id=target.id)],
            operator=operator,
            reason="manual_assignment",
            batch_id="duplicate-active-test",
        )


@pytest.mark.asyncio
async def test_service_flushes_without_committing(db):
    operator, source, target, student = await _seed_assignment(db)
    student_id = student.id
    source_id = source.id

    await apply_assignment_changes(
        db,
        [AssignmentTarget(student_id=student_id, agent_id=target.id)],
        operator=operator,
        reason="manual_assignment",
        batch_id="rollback-test",
        at=CHANGED_AT,
    )
    await db.rollback()

    persisted_student = await db.get(Student, student_id)
    assert persisted_student.assigned_to == source_id
    assignments = (
        (
            await db.execute(
                select(StudentAssignment).where(StudentAssignment.student_id == student_id)
            )
        )
        .scalars()
        .all()
    )
    assert len(assignments) == 1
    assert assignments[0].ended_at is None
    assert not (
        await db.execute(select(OperationLog).where(OperationLog.batch_id == "rollback-test"))
    ).scalar_one_or_none()
