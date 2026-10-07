from datetime import datetime, timedelta

import pytest

from app.assignment_batch_review import build_assignment_batch_review
from app.models import DialLog, EnrollmentRecord, OperationLog, Student, StudentStatus, User
from app.utils import make_assignment_rollback_note


def _agent(username: str, name: str) -> User:
    return User(
        username=username,
        hashed_password="x",
        role="agent",
        name=name,
        is_active=True,
    )


def _student(
    name: str,
    *,
    assigned_to: int,
    status=StudentStatus.not_contacted,
    updated_at: datetime | None = None,
) -> Student:
    student = Student(
        name=name,
        region="芗城区",
        school_name="测试中学",
        status=status,
        assigned_to=assigned_to,
        guardian_phone=f"1390000{abs(hash(name)) % 10000:04d}",
        case_no=f"case-{name}",
    )
    if updated_at is not None:
        student.updated_at = updated_at
    return student


def _assignment_log(
    admin_user, student: Student, agent_id: int, batch_id: str, created_at: datetime
):
    return OperationLog(
        operator_id=admin_user.id,
        operator_name=admin_user.name,
        target_student_id=student.id,
        case_no=student.case_no,
        action="智能分配",
        content=f"智能分配给话务员 {agent_id}",
        old_status="unassigned",
        new_status=f"agent:{agent_id}",
        note_content=make_assignment_rollback_note(
            old_assigned_to=None,
            old_assigned_at=None,
            new_assigned_to=agent_id,
            new_assigned_at=created_at,
        ),
        batch_id=batch_id,
        created_at=created_at,
    )


async def _seed_review_batch(db, admin_user, agent_user):
    assigned_at = datetime(2026, 7, 7, 7, 0, 0)
    batch_id = "smart-assign-review-test"
    second_agent = _agent("review_agent_b", "坐席B")
    db.add(second_agent)
    await db.flush()

    handled = _student("已处理学生", assigned_to=agent_user.id)
    untouched = _student("未处理学生", assigned_to=agent_user.id)
    enrolled = _student(
        "已报名学生",
        assigned_to=second_agent.id,
        status=StudentStatus.enrolled,
        updated_at=assigned_at + timedelta(hours=3),
    )
    outside_status = _student(
        "窗口外状态学生",
        assigned_to=second_agent.id,
        status=StudentStatus.contacted,
        updated_at=assigned_at + timedelta(days=10),
    )
    db.add_all([handled, untouched, enrolled, outside_status])
    await db.flush()

    for student, agent_id in [
        (handled, agent_user.id),
        (untouched, agent_user.id),
        (enrolled, second_agent.id),
        (outside_status, second_agent.id),
    ]:
        db.add(_assignment_log(admin_user, student, agent_id, batch_id, assigned_at))

    db.add(
        OperationLog(
            operator_id=admin_user.id,
            operator_name=admin_user.name,
            action="智能分配汇总",
            content="智能分配执行：实际 4 条",
            batch_id=batch_id,
            created_at=assigned_at + timedelta(minutes=1),
        )
    )
    db.add_all(
        [
            DialLog(
                student_id=handled.id,
                agent_id=agent_user.id,
                dialed_at=assigned_at + timedelta(hours=1),
            ),
            DialLog(
                student_id=enrolled.id,
                agent_id=second_agent.id,
                dialed_at=assigned_at + timedelta(hours=2),
            ),
            OperationLog(
                operator_id=agent_user.id,
                operator_name=agent_user.name,
                target_student_id=handled.id,
                case_no=handled.case_no,
                action="修改状态",
                old_status="未联系",
                new_status="已联系",
                content="推进到已联系",
                created_at=assigned_at + timedelta(hours=2),
            ),
            EnrollmentRecord(
                student_id=enrolled.id,
                attributed_agent_id=second_agent.id,
                confirmed_by_admin_id=admin_user.id,
                current_assigned_agent_id=second_agent.id,
                student_name_snapshot=enrolled.name,
                guardian_phone_snapshot=enrolled.guardian_phone,
                region_snapshot=enrolled.region,
                school_name_snapshot=enrolled.school_name,
                enrolled_program="升学班",
                enrolled_at=assigned_at + timedelta(hours=3),
            ),
        ]
    )
    await db.commit()
    return batch_id, assigned_at, second_agent


@pytest.mark.asyncio
async def test_build_assignment_batch_review_counts_funnel_agents_and_unhandled(
    db, admin_user, agent_user
):
    batch_id, assigned_at, second_agent = await _seed_review_batch(db, admin_user, agent_user)

    review = await build_assignment_batch_review(db, batch_id, window_days=7)

    assert review is not None
    assert review["batch"]["batch_id"] == batch_id
    assert review["batch"]["action"] == "智能分配汇总"
    assert review["batch"]["operator_name"] == admin_user.name
    assert review["batch"]["assigned_at"].startswith("2026-07-07 07:00:00")
    assert review["batch"]["assigned_count"] == 4
    assert review["batch"]["window_days"] == 7
    assert review["batch"]["window_start"].startswith(str(assigned_at))
    assert review["funnel"] == {
        "assigned": 4,
        "dialed": 2,
        "effective_handled": 2,
        "enrolled": 1,
        "undialed": 2,
        "unhandled": 2,
        "dial_rate": 50.0,
        "effective_handle_rate": 50.0,
        "enrollment_rate": 25.0,
    }
    rows = {row["agent_id"]: row for row in review["agents"]}
    assert rows[agent_user.id]["agent_name"] == agent_user.name
    assert rows[agent_user.id]["assigned"] == 2
    assert rows[agent_user.id]["dialed"] == 1
    assert rows[agent_user.id]["effective_handled"] == 1
    assert rows[agent_user.id]["enrolled"] == 0
    assert rows[second_agent.id]["agent_name"] == second_agent.name
    assert rows[second_agent.id]["assigned"] == 2
    assert rows[second_agent.id]["dialed"] == 1
    assert rows[second_agent.id]["effective_handled"] == 1
    assert rows[second_agent.id]["enrolled"] == 1
    unhandled_names = {row["student_name"] for row in review["unhandled_students"]}
    assert unhandled_names == {"未处理学生", "窗口外状态学生"}
    assert any(alert["type"] == "undialed_rate" for alert in review["alerts"])


@pytest.mark.asyncio
async def test_build_assignment_batch_review_respects_window_days(db, admin_user, agent_user):
    assigned_at = datetime(2026, 7, 7, 7, 0, 0)
    batch_id = "smart-assign-window-test"
    student = _student("第三天处理学生", assigned_to=agent_user.id)
    db.add(student)
    await db.flush()
    db.add(_assignment_log(admin_user, student, agent_user.id, batch_id, assigned_at))
    db.add(
        OperationLog(
            operator_id=agent_user.id,
            operator_name=agent_user.name,
            target_student_id=student.id,
            case_no=student.case_no,
            action="修改状态",
            old_status="未联系",
            new_status="待回访",
            content="第三天推进",
            created_at=assigned_at + timedelta(days=2, hours=1),
        )
    )
    await db.commit()

    one_day = await build_assignment_batch_review(db, batch_id, window_days=1)
    three_day = await build_assignment_batch_review(db, batch_id, window_days=3)

    assert one_day["funnel"]["effective_handled"] == 0
    assert three_day["funnel"]["effective_handled"] == 1


@pytest.mark.asyncio
async def test_build_assignment_batch_review_returns_none_for_missing_batch(db):
    review = await build_assignment_batch_review(db, "missing-batch", window_days=7)
    assert review is None


@pytest.mark.asyncio
async def test_assignment_batch_review_endpoint_requires_audit_logs_permission(
    client, normal_admin_headers
):
    resp = await client.get(
        "/api/admin/assignment-batches/smart-assign-review-test/review",
        headers=normal_admin_headers,
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_assignment_batch_review_endpoint_allows_audit_logs_permission(
    client, db, normal_admin_user, normal_admin_headers, admin_user, agent_user
):
    normal_admin_user.page_permissions = "audit_logs"
    batch_id, _assigned_at, _second_agent = await _seed_review_batch(db, admin_user, agent_user)

    resp = await client.get(
        f"/api/admin/assignment-batches/{batch_id}/review",
        params={"window_days": 7},
        headers=normal_admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["batch"]["batch_id"] == batch_id
    assert body["data"]["funnel"]["assigned"] == 4


@pytest.mark.asyncio
async def test_assignment_batch_review_endpoint_rejects_invalid_window(client, admin_headers):
    resp = await client.get(
        "/api/admin/assignment-batches/smart-assign-review-test/review",
        params={"window_days": 2},
        headers=admin_headers,
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_assignment_batch_review_endpoint_returns_clear_missing_batch(client, admin_headers):
    resp = await client.get(
        "/api/admin/assignment-batches/missing-batch/review",
        headers=admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 400
    assert body["code"] == 1
    assert body["msg"] == "未找到该分配批次"
