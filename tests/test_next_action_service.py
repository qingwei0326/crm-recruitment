from datetime import timedelta

import pytest

from app.models import (
    EnrollmentRecord,
    FollowUp,
    IntentLevel,
    SettlementStatus,
    Student,
    StudentStage,
    StudentStatus,
)
from app.services.next_action_service import build_next_action_map
from app.utils import utcnow


def _student(
    *,
    name: str,
    assigned_to: int | None,
    status: StudentStatus = StudentStatus.contacted,
    need_help: bool = False,
) -> Student:
    now = utcnow()
    return Student(
        name=name,
        region="思明区",
        school_name="测试学校",
        assigned_to=assigned_to,
        assigned_at=now - timedelta(hours=1) if assigned_to else None,
        status=status,
        stage=(
            StudentStage.enrolled if status == StudentStatus.enrolled else StudentStage.interested
        ),
        intent_level=IntentLevel.A,
        need_help=need_help,
    )


@pytest.mark.asyncio
async def test_build_next_action_map_covers_assignment_lead_gap_and_terminal_states(db, agent_user):
    lead = _student(
        name="待首呼",
        assigned_to=agent_user.id,
        status=StudentStatus.not_contacted,
    )
    missing = _student(name="缺下一步", assigned_to=agent_user.id)
    unassigned = _student(name="待分配", assigned_to=None, status=StudentStatus.not_contacted)
    enrolled = _student(name="已报名", assigned_to=agent_user.id, status=StudentStatus.enrolled)
    db.add_all([lead, missing, unassigned, enrolled])
    await db.commit()

    actions = await build_next_action_map(db, [lead, missing, unassigned, enrolled])

    assert actions[lead.id] == {
        "kind": "lead_contact",
        "label": "开始首呼",
        "owner_id": agent_user.id,
        "owner_name": agent_user.name,
        "due_at": None,
        "priority": "normal",
        "target_url": f"/admin/leads/{lead.id}",
        "source_id": lead.id,
        "reason": "待首次联系",
    }
    assert actions[missing.id]["kind"] == "missing_next_action"
    assert actions[missing.id]["label"] == "补充下一步"
    assert actions[missing.id]["owner_name"] == agent_user.name
    assert actions[unassigned.id]["kind"] == "assignment"
    assert actions[unassigned.id]["label"] == "先分配坐席"
    assert actions[enrolled.id] is None


@pytest.mark.asyncio
async def test_next_action_prioritizes_help_over_overdue_followup_and_exposes_settlement(
    db, agent_user, admin_user
):
    now = utcnow()
    help_student = _student(
        name="需要协助",
        assigned_to=agent_user.id,
        need_help=True,
    )
    overdue_student = _student(name="逾期回访", assigned_to=agent_user.id)
    enrolled_student = _student(
        name="待结算",
        assigned_to=agent_user.id,
        status=StudentStatus.enrolled,
    )
    follow_up = FollowUp(
        student=overdue_student,
        agent_id=agent_user.id,
        follow_up_date=now - timedelta(days=1),
        follow_up_type="电话",
        notes="逾期测试",
        is_completed=False,
    )
    enrollment = EnrollmentRecord(
        student=enrolled_student,
        attributed_agent_id=agent_user.id,
        confirmed_by_admin_id=admin_user.id,
        current_assigned_agent_id=agent_user.id,
        last_effective_agent_id=agent_user.id,
        settlement_status=SettlementStatus.disputed,
    )
    db.add_all([help_student, overdue_student, enrolled_student, follow_up, enrollment])
    await db.commit()

    actions = await build_next_action_map(
        db,
        [help_student, overdue_student, enrolled_student],
        now=now,
    )

    assert actions[help_student.id]["kind"] == "help_request"
    assert actions[help_student.id]["label"] == "处理求助"
    assert actions[help_student.id]["priority"] == "high"
    assert actions[overdue_student.id]["kind"] == "scheduled_follow_up"
    assert actions[overdue_student.id]["label"] == "完成回访"
    assert actions[overdue_student.id]["priority"] == "high"
    assert actions[overdue_student.id]["due_at"] == str(follow_up.follow_up_date)
    assert actions[enrolled_student.id]["kind"] == "enrollment_settlement"
    assert actions[enrolled_student.id]["label"] == "处理结算"
    assert actions[enrolled_student.id]["priority"] == "high"
    assert actions[enrolled_student.id]["owner_name"] == agent_user.name


@pytest.mark.asyncio
async def test_student_list_and_detail_return_next_action_projection(
    client, db, admin_headers, agent_user
):
    student = _student(
        name="列表投影",
        assigned_to=agent_user.id,
        status=StudentStatus.not_contacted,
    )
    db.add(student)
    await db.commit()

    list_response = await client.get(
        f"/api/students?q={student.name}",
        headers=admin_headers,
    )
    assert list_response.status_code == 200
    list_action = list_response.json()["data"]["list"][0]["next_action"]
    assert list_action["kind"] == "lead_contact"
    assert list_action["owner_name"] == agent_user.name

    detail_response = await client.get(
        f"/api/students/{student.id}/detail",
        headers=admin_headers,
    )
    assert detail_response.status_code == 200
    detail_action = detail_response.json()["data"]["student"]["next_action"]
    assert detail_action["label"] == "开始首呼"
    assert detail_action["target_url"] == f"/admin/leads/{student.id}"
