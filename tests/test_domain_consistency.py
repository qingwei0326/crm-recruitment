from datetime import datetime

import pytest
from sqlalchemy import select

from app.domain_consistency import audit_domain_consistency
from app.domain_models import (
    HandoverBatch,
    HandoverBatchStatus,
    HandoverItem,
    HandoverItemStatus,
    StudentAssignment,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import FollowUp, IntentLevel, Student, StudentStage, StudentStatus
from app.services.work_item_service import sync_source_work_item, sync_student_work_items

NOW = datetime(2026, 7, 11, 8, 0, 0)
EXPECTED_KEYS = {
    "ok",
    "users_without_employment",
    "duplicate_active_assignments",
    "active_assignment_projection_mismatches",
    "open_items_without_owner",
    "open_items_owned_by_inactive",
    "duplicate_source_work_items",
    "invalid_reasons_without_catalog_entry",
    "foreign_key_violations",
    "employment_projection_mismatches",
    "lead_work_item_projection_mismatches",
    "source_work_item_projection_mismatches",
    "handover_count_mismatches",
    "outcome_projection_mismatches",
}


async def _healthy_domain(db, admin_user, agent_user, assignment_baseline):
    student = Student(
        name="Consistency Lead",
        assigned_to=agent_user.id,
        status=StudentStatus.pending_visit,
        intent_level=IntentLevel.A,
        stage=StudentStage.interested,
    )
    invalid_student = Student(
        name="Consistency Invalid",
        status=StudentStatus.invalid,
        status_detail="空号",
        outcome_reason_code="phone_invalid",
    )
    db.add_all([student, invalid_student])
    await db.flush()
    assignment = await assignment_baseline(student, agent_user, started_at=NOW)
    await sync_student_work_items(db, student, admin_user, at=NOW)

    follow_up = FollowUp(
        student_id=student.id,
        agent_id=agent_user.id,
        follow_up_date=NOW,
        is_completed=False,
    )
    db.add(follow_up)
    await db.flush()
    await sync_source_work_item(
        db,
        WorkItemKind.scheduled_follow_up,
        "follow_up",
        follow_up.id,
        student,
        agent_user.id,
        follow_up.follow_up_date,
        False,
        admin_user,
        at=NOW,
    )

    batch = HandoverBatch(
        source_agent_id=agent_user.id,
        status=HandoverBatchStatus.pending,
        version=1,
        total_items=1,
        remaining_items=1,
        transferred_items=0,
        initiated_by=admin_user.id,
        initiated_at=NOW,
        idempotency_key="consistency-batch",
    )
    db.add(batch)
    await db.flush()
    db.add(
        HandoverItem(
            handover_batch_id=batch.id,
            student_id=student.id,
            source_assignment_id=assignment.id,
            status=HandoverItemStatus.pending,
            created_at=NOW,
            updated_at=NOW,
        )
    )
    await db.commit()
    return {
        "student": student,
        "invalid_student": invalid_student,
        "follow_up": follow_up,
        "batch": batch,
    }


@pytest.mark.asyncio
async def test_healthy_domain_consistency_report_is_aggregate_only(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    await _healthy_domain(db, admin_user, agent_user, assignment_baseline)

    report = await audit_domain_consistency(db)

    assert set(report) == EXPECTED_KEYS
    assert report["ok"] is True
    assert all(value == 0 for key, value in report.items() if key != "ok")
    assert all(isinstance(value, (bool, int)) for value in report.values())


@pytest.mark.asyncio
async def test_assignment_projection_corruption_keeps_phase_one_gate(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    seeded = await _healthy_domain(db, admin_user, agent_user, assignment_baseline)
    seeded["student"].assigned_to = admin_user.id
    await db.flush()

    report = await audit_domain_consistency(db)

    assert report["ok"] is False
    assert report["active_assignment_projection_mismatches"] == 1


@pytest.mark.asyncio
async def test_employment_projection_corruption_is_reported(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    await _healthy_domain(db, admin_user, agent_user, assignment_baseline)
    agent_user.is_active = False
    await db.flush()

    report = await audit_domain_consistency(db)

    assert report["employment_projection_mismatches"] == 1
    assert report["ok"] is False


@pytest.mark.asyncio
async def test_lead_work_item_projection_corruption_is_reported(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    seeded = await _healthy_domain(db, admin_user, agent_user, assignment_baseline)
    lead_item = (
        await db.execute(
            select(WorkItem).where(
                WorkItem.kind == WorkItemKind.lead_contact,
                WorkItem.source_id == seeded["student"].id,
            )
        )
    ).scalar_one()
    lead_item.owner_agent_id = admin_user.id
    await db.flush()

    report = await audit_domain_consistency(db)

    assert report["lead_work_item_projection_mismatches"] == 1
    assert report["ok"] is False


@pytest.mark.asyncio
async def test_source_work_item_projection_corruption_is_reported(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    seeded = await _healthy_domain(db, admin_user, agent_user, assignment_baseline)
    source_item = (
        await db.execute(
            select(WorkItem).where(
                WorkItem.kind == WorkItemKind.scheduled_follow_up,
                WorkItem.source_id == seeded["follow_up"].id,
            )
        )
    ).scalar_one()
    source_item.owner_agent_id = admin_user.id
    await db.flush()

    report = await audit_domain_consistency(db)

    assert report["source_work_item_projection_mismatches"] == 1
    assert report["ok"] is False


@pytest.mark.asyncio
async def test_unassigned_source_item_preserves_its_current_active_owner(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    seeded = await _healthy_domain(db, admin_user, agent_user, assignment_baseline)
    student = seeded["student"]
    student.assigned_to = None
    assignment = (
        await db.execute(
            select(StudentAssignment).where(
                StudentAssignment.student_id == student.id,
                StudentAssignment.ended_at.is_(None),
            )
        )
    ).scalar_one()
    assignment.ended_at = NOW
    lead_item = (
        await db.execute(
            select(WorkItem).where(
                WorkItem.kind == WorkItemKind.lead_contact,
                WorkItem.source_id == student.id,
            )
        )
    ).scalar_one()
    lead_item.status = WorkItemStatus.cancelled
    lead_item.owner_agent_id = None
    source_item = (
        await db.execute(
            select(WorkItem).where(
                WorkItem.kind == WorkItemKind.scheduled_follow_up,
                WorkItem.source_id == seeded["follow_up"].id,
            )
        )
    ).scalar_one()
    source_item.owner_agent_id = admin_user.id
    await db.flush()

    report = await audit_domain_consistency(db)

    assert report["source_work_item_projection_mismatches"] == 0


@pytest.mark.asyncio
async def test_handover_count_corruption_is_reported(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    seeded = await _healthy_domain(db, admin_user, agent_user, assignment_baseline)
    seeded["batch"].remaining_items = 0
    await db.flush()

    report = await audit_domain_consistency(db)

    assert report["handover_count_mismatches"] == 1
    assert report["ok"] is False


@pytest.mark.asyncio
async def test_outcome_projection_corruption_is_reported(
    db,
    admin_user,
    agent_user,
    assignment_baseline,
):
    seeded = await _healthy_domain(db, admin_user, agent_user, assignment_baseline)
    seeded["invalid_student"].outcome_reason_code = "other"
    await db.flush()

    report = await audit_domain_consistency(db)

    assert report["invalid_reasons_without_catalog_entry"] == 0
    assert report["outcome_projection_mismatches"] == 1
    assert report["ok"] is False
