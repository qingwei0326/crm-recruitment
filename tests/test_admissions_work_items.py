from datetime import datetime, timedelta

import pytest

from app.auth import create_access_token, hash_password
from app.models import (
    AttributionMethod,
    CampusVisitResult,
    CampusVisitStatus,
    CampusVisitTask,
    EnrollmentRecord,
    EnrollmentSource,
    FollowUp,
    HomeVisitResult,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    SettlementStatus,
    Student,
    StudentStage,
    StudentStatus,
    User,
)


def _headers_for(user: User) -> dict:
    token = create_access_token(
        {
            "sub": str(user.id),
            "role": user.role,
            "tv": user.token_version,
        }
    )
    return {"Authorization": f"Bearer {token}"}


async def _agent(db, username: str, name: str) -> User:
    user = User(
        username=username,
        hashed_password=hash_password("agent123"),
        role="agent",
        name=name,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _student(db, agent: User, name: str, *, need_help: bool = False) -> Student:
    student = Student(
        name=name,
        region="长泰县",
        guardian_phone="13800138000",
        school_name="长泰二中",
        assigned_to=agent.id,
        assigned_at=datetime.now() - timedelta(days=1),
        stage=StudentStage.interested,
        status=StudentStatus.pending_visit,
        intent_level=IntentLevel.A,
        need_help=need_help,
        program="护理",
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)
    return student


@pytest.mark.asyncio
async def test_admin_work_items_include_all_admissions_queues(
    client, db, admin_headers, admin_user
):
    agent = await _agent(db, "work-item-agent", "王坐席")
    student = await _student(db, agent, "待办学生", need_help=True)
    yesterday = datetime.now() - timedelta(days=1)
    tomorrow = datetime.now() + timedelta(days=1)

    home = HomeVisitTask(
        student_id=student.id,
        creator_agent_id=agent.id,
        status=HomeVisitStatus.pending,
        priority="高",
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        requested_visit_time=yesterday,
        address="长泰测试地址",
    )
    completed_home = HomeVisitTask(
        student_id=student.id,
        creator_agent_id=agent.id,
        status=HomeVisitStatus.completed,
        result=HomeVisitResult.waiting_score,
        priority="中",
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        next_follow_up_at=tomorrow,
        address="长泰测试地址",
    )
    campus = CampusVisitTask(
        student_id=student.id,
        creator_user_id=agent.id,
        status=CampusVisitStatus.scheduled,
        appointment_at=yesterday,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program="护理",
    )
    arrived_campus = CampusVisitTask(
        student_id=student.id,
        creator_user_id=agent.id,
        status=CampusVisitStatus.arrived,
        result=CampusVisitResult.considering,
        appointment_at=yesterday,
        next_follow_up_at=tomorrow,
        next_action="继续确认报名",
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program="护理",
    )
    follow = FollowUp(
        student_id=student.id,
        agent_id=agent.id,
        follow_up_date=tomorrow,
        follow_up_type="电话",
        notes="继续跟进",
        is_completed=False,
    )
    enrollment = EnrollmentRecord(
        student_id=student.id,
        attributed_agent_id=agent.id,
        confirmed_by_admin_id=admin_user.id,
        first_assigned_agent_id=agent.id,
        current_assigned_agent_id=agent.id,
        last_effective_agent_id=agent.id,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program="护理",
        enrolled_program="护理",
        source=EnrollmentSource.admin,
        attribution_method=AttributionMethod.current_agent,
        settlement_status=SettlementStatus.disputed,
        settlement_notes="工作微信交接后待确认",
    )
    db.add_all([home, completed_home, campus, arrived_campus, follow, enrollment])
    await db.commit()

    resp = await client.get("/api/admissions/work-items", headers=admin_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    rows = body["data"]["list"]
    keys = {(row["kind"], row["source_id"]) for row in rows}
    assert ("home_visit", home.id) in keys
    assert ("home_visit", completed_home.id) in keys
    assert ("campus_visit", campus.id) in keys
    assert ("campus_visit", arrived_campus.id) in keys
    assert ("follow_up", follow.id) in keys
    assert ("settlement", enrollment.id) in keys
    assert ("help", student.id) in keys
    assert rows[0]["kind"] in {"settlement", "home_visit", "campus_visit"}
    assert all(row["target_url"].startswith("/admin/") for row in rows)


@pytest.mark.asyncio
async def test_work_items_filter_queue_and_accept_follow_alias(
    client, db, admin_headers, admin_user
):
    agent = await _agent(db, "queue-alias-agent", "林坐席")
    student = await _student(db, agent, "别名学生")
    follow = FollowUp(
        student_id=student.id,
        agent_id=agent.id,
        follow_up_date=datetime.now() - timedelta(hours=2),
        follow_up_type="电话",
        is_completed=False,
    )
    enrollment = EnrollmentRecord(
        student_id=student.id,
        attributed_agent_id=agent.id,
        confirmed_by_admin_id=admin_user.id,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        source=EnrollmentSource.admin,
        attribution_method=AttributionMethod.current_agent,
        settlement_status=SettlementStatus.unsettled,
    )
    db.add_all([follow, enrollment])
    await db.commit()

    resp = await client.get("/api/admissions/work-items?queue=follow", headers=admin_headers)

    assert resp.status_code == 200
    rows = resp.json()["data"]["list"]
    assert [row["kind"] for row in rows] == ["follow_up"]
    assert rows[0]["source_id"] == follow.id


@pytest.mark.asyncio
async def test_agent_work_items_are_scoped_to_own_students_and_records(client, db):
    agent = await _agent(db, "scope-agent", "自己坐席")
    other_agent = await _agent(db, "scope-other-agent", "其他坐席")
    own_student = await _student(db, agent, "自己学生")
    other_student = await _student(db, other_agent, "别人学生")
    own_home = HomeVisitTask(
        student_id=own_student.id,
        creator_agent_id=agent.id,
        status=HomeVisitStatus.pending,
        student_name_snapshot=own_student.name,
        guardian_phone_snapshot=own_student.guardian_phone,
        region_snapshot=own_student.region,
        school_name_snapshot=own_student.school_name,
    )
    other_home = HomeVisitTask(
        student_id=other_student.id,
        creator_agent_id=other_agent.id,
        status=HomeVisitStatus.pending,
        student_name_snapshot=other_student.name,
        guardian_phone_snapshot=other_student.guardian_phone,
        region_snapshot=other_student.region,
        school_name_snapshot=other_student.school_name,
    )
    db.add_all([own_home, other_home])
    await db.commit()

    resp = await client.get("/api/admissions/work-items", headers=_headers_for(agent))

    assert resp.status_code == 200
    names = {row["student_name"] for row in resp.json()["data"]["list"]}
    assert "自己学生" in names
    assert "别人学生" not in names
