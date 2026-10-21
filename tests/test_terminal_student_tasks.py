from datetime import timedelta

import pytest
from sqlalchemy import select

from app.domain_consistency import audit_domain_consistency
from app.domain_models import WorkItem, WorkItemKind, WorkItemStatus
from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    FollowUp,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
)
from app.utils import utcnow


async def _assigned_student(db, agent_user, assignment_baseline, name: str) -> Student:
    student = Student(
        name=name,
        region="芗城区",
        guardian_phone="13800138000",
        school_name="漳州一中",
        stage=StudentStage.initial_contact,
        status=StudentStatus.not_contacted,
        intent_level=IntentLevel.A,
    )
    await assignment_baseline(student, agent_user)
    await db.commit()
    await db.refresh(student)
    return student


async def _add_follow_up(client, agent_headers, student_id: int) -> int:
    resp = await client.post(
        "/api/follow-ups",
        json={
            "student_id": student_id,
            "follow_up_date": (utcnow() + timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S"),
        },
        headers=agent_headers,
    )
    assert resp.json()["code"] == 0, resp.text
    return resp.json()["data"]["id"]


async def _add_home_visit(client, agent_headers, student_id: int) -> int:
    resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student_id, "address": "芗城区某小区"},
        headers=agent_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["id"]


async def _add_campus_visit(client, agent_headers, student_id: int) -> int:
    resp = await client.post(
        "/api/admissions/campus-visits",
        json={"student_id": student_id, "appointment_at": "2026-07-04T09:30:00"},
        headers=agent_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]["id"]


async def _work_item(db, kind: WorkItemKind, source_type: str, source_id: int) -> WorkItem:
    return (
        await db.execute(
            select(WorkItem).where(
                WorkItem.kind == kind,
                WorkItem.source_type == source_type,
                WorkItem.source_id == source_id,
            )
        )
    ).scalar_one()


@pytest.mark.asyncio
async def test_marking_invalid_closes_open_follow_ups_and_visits(
    client, db, admin_headers, agent_user, agent_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline, "转去别校")
    other = await _assigned_student(db, agent_user, assignment_baseline, "仍在跟进")
    follow_up_id = await _add_follow_up(client, agent_headers, student.id)
    other_follow_up_id = await _add_follow_up(client, agent_headers, other.id)
    home_id = await _add_home_visit(client, agent_headers, student.id)
    campus_id = await _add_campus_visit(client, agent_headers, student.id)

    student_id = student.id
    marked = await client.put(
        f"/api/students/{student_id}",
        json={"status": "无效", "invalid_reason": "已报名其他学校"},
        headers=admin_headers,
    )

    assert marked.status_code == 200, marked.text
    db.expire_all()
    assert (await db.get(FollowUp, follow_up_id)).is_completed is True
    assert (await db.get(FollowUp, other_follow_up_id)).is_completed is False
    assert (await db.get(HomeVisitTask, home_id)).status == HomeVisitStatus.cancelled
    assert (await db.get(CampusVisitTask, campus_id)).status == CampusVisitStatus.cancelled
    for kind, source_type, source_id in (
        (WorkItemKind.scheduled_follow_up, "follow_up", follow_up_id),
        (WorkItemKind.home_visit, "home_visit", home_id),
        (WorkItemKind.campus_visit, "campus_visit", campus_id),
    ):
        item = await _work_item(db, kind, source_type, source_id)
        assert item.status == WorkItemStatus.cancelled
        assert item.owner_agent_id is None
    other_item = await _work_item(
        db, WorkItemKind.scheduled_follow_up, "follow_up", other_follow_up_id
    )
    assert other_item.status == WorkItemStatus.open

    log = (
        await db.execute(
            select(OperationLog).where(
                OperationLog.action == "自动关闭待办",
                OperationLog.target_student_id == student_id,
            )
        )
    ).scalar_one()
    assert log.content == "学生无效，关闭回访 1 条、家访 1 条、到校 1 条"

    report = await audit_domain_consistency(db)
    assert report["source_work_item_projection_mismatches"] == 0


@pytest.mark.asyncio
async def test_enrolling_keeps_the_visit_it_came_from_and_cancels_other_visits(
    client, db, admin_headers, agent_user, agent_headers, assignment_baseline
):
    student = await _assigned_student(db, agent_user, assignment_baseline, "到校后报名")
    student_id = student.id
    campus_id = await _add_campus_visit(client, agent_headers, student_id)
    home_id = await _add_home_visit(client, agent_headers, student_id)
    campus_status_before = (await db.get(CampusVisitTask, campus_id)).status

    enrolled = await client.post(
        "/api/admissions/enrollments",
        json={
            "student_id": student_id,
            "source": "到校参观后",
            "campus_visit_task_id": campus_id,
        },
        headers=admin_headers,
    )

    assert enrolled.status_code == 200, enrolled.text
    db.expire_all()
    assert (await db.get(Student, student_id)).status == StudentStatus.enrolled
    assert (await db.get(CampusVisitTask, campus_id)).status == campus_status_before
    assert (await db.get(HomeVisitTask, home_id)).status == HomeVisitStatus.cancelled
    settlement = await _work_item(
        db,
        WorkItemKind.enrollment_settlement,
        "enrollment",
        enrolled.json()["data"]["id"],
    )
    assert settlement.status == WorkItemStatus.open
