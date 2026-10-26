import pytest
from sqlalchemy import select

from app.domain_models import WorkItem, WorkItemKind, WorkItemStatus
from app.models import (
    CampusVisitTask,
    HomeVisitTask,
    IntentLevel,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
)


async def _student(db, name: str, assign=None) -> int:
    student = Student(
        name=name,
        region="长泰区",
        guardian_phone="13800138000",
        school_name="长泰一中",
        stage=StudentStage.initial_contact,
        status=StudentStatus.contacted,
        intent_level=IntentLevel.A,
    )
    if assign is not None:
        await assign(student)
    else:
        db.add(student)
    await db.commit()
    return student.id


@pytest.fixture
def assign_to_agent(agent_user, assignment_baseline):
    return lambda student: assignment_baseline(student, agent_user)


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
async def test_one_report_files_a_home_visit_and_a_campus_visit(
    client, db, agent_user, agent_headers, assign_to_agent
):
    student_id = await _student(db, "岩溪学生", assign_to_agent)

    resp = await client.post(
        "/api/admissions/visit-reports",
        json={
            "student_id": student_id,
            "intent_program": "无人机",
            "exam_score_text": "200-300分",
            "home_visit_note": "晚上有空，具体哪天明天确认",
            "campus_visit_at": "2026-07-14T09:30:00",
            "address": "长泰岩溪田头村",
            "situation": "家里爸爸做主",
        },
        headers=agent_headers,
    )

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    home, campus = data["home_visit"], data["campus_visit"]
    assert home["visit_time_note"] == "晚上有空，具体哪天明天确认"
    assert home["requested_visit_time"] is None
    assert home["exam_score_text"] == "200-300分"
    assert home["exam_score"] is None
    assert home["intent_program"] == "无人机"
    assert home["address"] == "长泰岩溪田头村"
    assert home["student_situation"] == "家里爸爸做主"
    assert home["creator_agent_id"] == agent_user.id
    assert campus["status"] == "已预约"
    assert campus["appointment_at"].startswith("2026-07-14 09:30")
    assert campus["exam_score_text"] == "200-300分"
    assert campus["current_concerns"] == "家里爸爸做主"
    assert campus["creator_user_id"] == agent_user.id
    assert data["stage"] == StudentStage.campus_visit_scheduled.value

    home_item = await _work_item(db, WorkItemKind.home_visit, "home_visit", home["id"])
    campus_item = await _work_item(db, WorkItemKind.campus_visit, "campus_visit", campus["id"])
    assert home_item.status == WorkItemStatus.open
    assert home_item.due_at is None
    assert campus_item.status == WorkItemStatus.open
    assert campus_item.due_at.isoformat().startswith("2026-07-14T09:30")
    actions = (
        await db.execute(
            select(OperationLog.action).where(OperationLog.target_student_id == student_id)
        )
    ).scalars().all()
    assert {"申请家访", "预约到校"} <= set(actions)


@pytest.mark.asyncio
async def test_a_plain_score_is_also_kept_as_a_number(
    client, db, agent_headers, assign_to_agent
):
    student_id = await _student(db, "考了378", assign_to_agent)

    resp = await client.post(
        "/api/admissions/visit-reports",
        json={
            "student_id": student_id,
            "exam_score_text": "378分",
            "home_visit_at": "2026-07-02T15:30:00",
        },
        headers=agent_headers,
    )

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["campus_visit"] is None
    assert data["home_visit"]["exam_score"] == 378.0
    assert data["home_visit"]["exam_score_text"] == "378分"
    assert data["home_visit"]["requested_visit_time"].startswith("2026-07-02 15:30")


@pytest.mark.asyncio
async def test_a_report_needs_a_home_or_campus_visit_time(
    client, db, agent_headers, assign_to_agent
):
    student_id = await _student(db, "没写时间", assign_to_agent)

    resp = await client.post(
        "/api/admissions/visit-reports",
        json={"student_id": student_id, "home_visit_note": "  ", "address": "某村"},
        headers=agent_headers,
    )

    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_an_open_campus_visit_rejects_the_whole_report(
    client, db, agent_headers, assign_to_agent
):
    student_id = await _student(db, "已约到校", assign_to_agent)
    first = await client.post(
        "/api/admissions/visit-reports",
        json={"student_id": student_id, "campus_visit_note": "成绩出来后"},
        headers=agent_headers,
    )
    assert first.status_code == 200, first.text

    second = await client.post(
        "/api/admissions/visit-reports",
        json={
            "student_id": student_id,
            "home_visit_note": "周末",
            "campus_visit_note": "下周",
        },
        headers=agent_headers,
    )

    assert second.status_code == 400, second.text
    homes = (
        await db.execute(select(HomeVisitTask).where(HomeVisitTask.student_id == student_id))
    ).scalars().all()
    campuses = (
        await db.execute(
            select(CampusVisitTask).where(CampusVisitTask.student_id == student_id)
        )
    ).scalars().all()
    assert homes == []
    assert len(campuses) == 1
    assert campuses[0].visit_time_note == "成绩出来后"


@pytest.mark.asyncio
async def test_an_agent_cannot_report_for_a_student_they_do_not_own(
    client, db, agent_headers
):
    student_id = await _student(db, "别人的学生")

    resp = await client.post(
        "/api/admissions/visit-reports",
        json={"student_id": student_id, "home_visit_note": "明天"},
        headers=agent_headers,
    )

    assert resp.status_code == 403, resp.text


@pytest.mark.asyncio
async def test_an_admin_report_is_filed_under_the_students_agent(
    client, db, agent_user, admin_headers, assign_to_agent
):
    student_id = await _student(db, "管理员代报", assign_to_agent)

    resp = await client.post(
        "/api/admissions/visit-reports",
        json={
            "student_id": student_id,
            "home_visit_note": "周六上午",
            "campus_visit_note": "周日",
        },
        headers=admin_headers,
    )

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["home_visit"]["creator_agent_id"] == agent_user.id
    assert data["campus_visit"]["creator_user_id"] == agent_user.id
