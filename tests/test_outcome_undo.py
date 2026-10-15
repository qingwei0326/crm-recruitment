"""Agents can take back the first outcome they just marked on a lead."""

from datetime import timedelta

import pytest
from sqlalchemy import select

from app.domain_models import WorkItem, WorkItemKind, WorkItemStatus
from app.models import (
    DialLog,
    FollowUp,
    IntentLevel,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
)
from app.services.outcome_undo_service import UNDO_LOG_ACTION, UNDO_WINDOW_MINUTES
from app.utils import utcnow


async def _assigned_student(db, agent, assignment_baseline, status=StudentStatus.not_contacted):
    student = Student(
        name="张三",
        status=status,
        intent_level=IntentLevel.none,
        stage=StudentStage.initial_contact,
        guardian_phone="13800000000",
    )
    db.add(student)
    await db.flush()
    await assignment_baseline(student, agent, started_at=utcnow() - timedelta(days=2))
    db.add(DialLog(student_id=student.id, agent_id=agent.id, dialed_at=utcnow()))
    await db.commit()
    return student


async def _mark(client, headers, student_id, status):
    resp = await client.put(f"/api/students/{student_id}", json={"status": status}, headers=headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["code"] == 0, resp.text


async def _undo(client, headers, student_id):
    resp = await client.post(f"/api/students/{student_id}/undo-outcome", headers=headers)
    return resp.status_code, resp.json()


async def _reload(db, student_id):
    db.expire_all()
    return (await db.execute(select(Student).where(Student.id == student_id))).scalar_one()


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["已联系", "未接", "待回访", "无效"])
async def test_agent_can_undo_the_first_mark_and_the_lead_returns_to_the_dial_list(
    client, db, agent_user, agent_headers, assignment_baseline, outcome
):
    agent_id = agent_user.id
    student = await _assigned_student(db, agent_user, assignment_baseline)
    student_id = student.id
    await _mark(client, agent_headers, student_id, outcome)
    assert (await _reload(db, student_id)).status != StudentStatus.not_contacted

    status_code, body = await _undo(client, agent_headers, student_id)

    assert status_code == 200 and body["code"] == 0
    assert body["data"]["status"] == "未联系"
    refreshed = await _reload(db, student_id)
    assert refreshed.status == StudentStatus.not_contacted
    assert (refreshed.status_detail or "") == ""
    assert refreshed.outcome_reason_code is None
    assert refreshed.assigned_to == agent_id

    today = (await client.get("/api/tasks/today", headers=agent_headers)).json()["data"]
    assert [item["id"] for item in today["list"]] == [student_id]

    logs = (
        await db.execute(
            select(OperationLog).where(
                OperationLog.target_student_id == student_id,
                OperationLog.action == UNDO_LOG_ACTION,
            )
        )
    ).scalars().all()
    assert len(logs) == 1
    assert logs[0].operator_id == agent_id
    assert logs[0].new_status == "未联系"


@pytest.mark.asyncio
async def test_undo_cannot_be_repeated(client, db, agent_user, agent_headers, assignment_baseline):
    student = await _assigned_student(db, agent_user, assignment_baseline)
    await _mark(client, agent_headers, student.id, "已联系")
    assert (await _undo(client, agent_headers, student.id))[1]["code"] == 0

    _, body = await _undo(client, agent_headers, student.id)

    assert body["code"] == 1


@pytest.mark.asyncio
async def test_undo_refuses_after_the_window(
    client, db, agent_user, agent_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline)
    await _mark(client, agent_headers, student.id, "已联系")
    log = (
        await db.execute(
            select(OperationLog).where(
                OperationLog.target_student_id == student.id,
                OperationLog.action == "修改状态",
            )
        )
    ).scalar_one()
    log.created_at = utcnow() - timedelta(minutes=UNDO_WINDOW_MINUTES + 1)
    await db.commit()

    _, body = await _undo(client, agent_headers, student.id)

    assert body["code"] == 1
    assert (await _reload(db, student.id)).status == StudentStatus.contacted


@pytest.mark.asyncio
async def test_undo_only_covers_the_first_mark(
    client, db, agent_user, agent_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline)
    await _mark(client, agent_headers, student.id, "已联系")
    await _mark(client, agent_headers, student.id, "待回访")

    _, body = await _undo(client, agent_headers, student.id)

    assert body["code"] == 1
    assert (await _reload(db, student.id)).status == StudentStatus.pending_visit


@pytest.mark.asyncio
async def test_undo_refuses_when_an_admin_changed_the_status_afterwards(
    client, db, agent_user, agent_headers, admin_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline)
    await _mark(client, agent_headers, student.id, "已联系")
    await _mark(client, admin_headers, student.id, "待回访")

    _, body = await _undo(client, agent_headers, student.id)

    assert body["code"] == 1
    assert (await _reload(db, student.id)).status == StudentStatus.pending_visit


@pytest.mark.asyncio
async def test_undo_refuses_marks_made_by_someone_else(
    client, db, agent_user, agent_headers, admin_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline)
    await _mark(client, admin_headers, student.id, "已联系")

    _, body = await _undo(client, agent_headers, student.id)

    assert body["code"] == 1
    assert (await _reload(db, student.id)).status == StudentStatus.contacted


@pytest.mark.asyncio
async def test_undo_refuses_a_student_that_is_not_assigned_to_the_agent(
    client, db, agent_headers, sample_student
):
    status_code, _ = await _undo(client, agent_headers, sample_student.id)

    assert status_code == 403


@pytest.mark.asyncio
async def test_undo_requires_login(client, sample_student):
    resp = await client.post(f"/api/students/{sample_student.id}/undo-outcome")

    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_undo_reopens_the_lead_contact_work_item_closed_by_an_invalid_mark(
    client, db, agent_user, agent_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline)
    student_id = student.id

    async def lead_contact_item():
        db.expire_all()
        return (
            await db.execute(
                select(WorkItem).where(
                    WorkItem.kind == WorkItemKind.lead_contact,
                    WorkItem.source_type == "student",
                    WorkItem.source_id == student_id,
                )
            )
        ).scalar_one_or_none()

    await _mark(client, agent_headers, student_id, "无效")
    closed = await lead_contact_item()
    assert closed is None or closed.status != WorkItemStatus.open

    await _undo(client, agent_headers, student_id)

    reopened = await lead_contact_item()
    assert reopened is not None
    assert reopened.status == WorkItemStatus.open


@pytest.mark.asyncio
async def test_put_flags_only_the_first_mark_as_undoable(
    client, db, agent_user, agent_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline)

    first = await client.put(
        f"/api/students/{student.id}", json={"status": "已联系"}, headers=agent_headers
    )
    second = await client.put(
        f"/api/students/{student.id}", json={"status": "未接"}, headers=agent_headers
    )

    assert first.json()["data"]["outcome_undoable"] is True
    assert second.json()["data"]["outcome_undoable"] is False


@pytest.mark.asyncio
async def test_put_without_a_status_change_is_not_undoable(
    client, db, agent_user, agent_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline)

    resp = await client.put(
        f"/api/students/{student.id}", json={"score": 380}, headers=agent_headers
    )

    assert resp.json()["data"]["outcome_undoable"] is False


@pytest.mark.asyncio
async def test_undo_also_drops_the_reminder_set_right_after_the_mark(
    client, db, agent_user, agent_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline)
    student_id = student.id
    await _mark(client, agent_headers, student_id, "未接")
    created = await client.post(
        "/api/follow-ups",
        json={
            "student_id": student_id,
            "follow_up_date": (utcnow() + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S"),
        },
        headers=agent_headers,
    )
    assert created.json()["code"] == 0, created.text
    assert (await _reload(db, student_id)).status == StudentStatus.pending_visit

    status_code, body = await _undo(client, agent_headers, student_id)

    assert status_code == 200 and body["code"] == 0, body
    refreshed = await _reload(db, student_id)
    assert refreshed.status == StudentStatus.not_contacted
    reminders = (
        await db.execute(select(FollowUp).where(FollowUp.student_id == student_id))
    ).scalars().all()
    assert reminders == []
    follow_up_items = (
        await db.execute(
            select(WorkItem).where(
                WorkItem.kind == WorkItemKind.scheduled_follow_up,
                WorkItem.status == WorkItemStatus.open,
            )
        )
    ).scalars().all()
    assert follow_up_items == []


@pytest.mark.asyncio
async def test_undo_keeps_reminders_set_before_the_mark(
    client, db, agent_user, agent_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline)
    student_id = student.id
    db.add(
        FollowUp(
            student_id=student_id,
            agent_id=agent_user.id,
            follow_up_date=utcnow() + timedelta(days=1),
            created_at=utcnow() - timedelta(hours=5),
        )
    )
    await db.commit()
    await _mark(client, agent_headers, student_id, "已联系")

    await _undo(client, agent_headers, student_id)

    kept = (
        await db.execute(select(FollowUp).where(FollowUp.student_id == student_id))
    ).scalars().all()
    assert len(kept) == 1
