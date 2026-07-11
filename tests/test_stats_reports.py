from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.dialects import postgresql

from app.models import (
    AttributionMethod,
    CampusVisitStatus,
    CampusVisitTask,
    DialLog,
    EnrollmentRecord,
    EnrollmentSource,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    SettlementStatus,
    Student,
    StudentStatus,
    User,
    UserRole,
)
from app.routers import stats_enrollment
from app.utils import today_cst_as_utc


@pytest.mark.asyncio
async def test_report_stats_require_report_page_permission(client, normal_admin_headers):
    trend_resp = await client.get("/api/stats/trend", headers=normal_admin_headers)
    admissions_resp = await client.get("/api/stats/admissions-report", headers=normal_admin_headers)

    assert trend_resp.status_code == 403
    assert admissions_resp.status_code == 403


@pytest.mark.asyncio
async def test_report_stats_allow_report_page_permission(
    client, db, normal_admin_user, normal_admin_headers
):
    normal_admin_user.page_permissions = "report_center"
    await db.commit()

    trend_resp = await client.get("/api/stats/trend", headers=normal_admin_headers)
    admissions_resp = await client.get("/api/stats/admissions-report", headers=normal_admin_headers)

    assert trend_resp.status_code == 200
    assert trend_resp.json()["code"] == 0
    assert admissions_resp.status_code == 200
    assert admissions_resp.json()["code"] == 0


@pytest.mark.asyncio
async def test_trend_uses_agent_ids_and_cst_days(
    client, admin_headers, db, admin_user, agent_user
):
    inactive_agent = User(
        username="trend-inactive-data",
        hashed_password="x",
        role=UserRole.agent,
        name=agent_user.name,
        is_active=False,
    )
    inactive_empty = User(
        username="trend-inactive-empty",
        hashed_password="x",
        role=UserRole.agent,
        name="离职无数据",
        is_active=False,
    )
    db.add_all([inactive_agent, inactive_empty])
    await db.flush()

    students = [Student(name="趋势测试" + str(index)) for index in range(5)]
    db.add_all(students)
    await db.flush()
    db.add_all(
        [
            DialLog(
                student_id=students[0].id,
                agent_id=agent_user.id,
                dialed_at=datetime(2026, 7, 9, 15, 59),
            ),
            DialLog(
                student_id=students[1].id,
                agent_id=agent_user.id,
                dialed_at=datetime(2026, 7, 9, 16, 0),
            ),
            DialLog(
                student_id=students[2].id,
                agent_id=inactive_agent.id,
                dialed_at=datetime(2026, 7, 9, 16, 30),
            ),
            DialLog(
                student_id=students[3].id,
                agent_id=agent_user.id,
                dialed_at=datetime(2026, 7, 2, 16, 0),
            ),
            DialLog(
                student_id=students[4].id,
                agent_id=admin_user.id,
                dialed_at=datetime(2026, 7, 9, 17, 0),
            ),
        ]
    )
    await db.commit()

    response = await client.get(
        "/api/stats/trend",
        params={"start_date": "2026-07-10", "end_date": "2026-07-10"},
        headers=admin_headers,
    )

    assert response.status_code == 200
    data = response.json()["data"]
    assert [agent["id"] for agent in data["agents"]] == sorted(
        agent["id"] for agent in data["agents"]
    )
    assert any(
        agent["id"] == inactive_agent.id and not agent["is_active"]
        for agent in data["agents"]
    )
    assert any(agent["id"] == inactive_empty.id for agent in data["agents"])
    row = data["daily"][0]
    assert row["calls"] == 2
    assert row["prev_calls"] == 1
    assert row["agent_calls_by_id"][str(agent_user.id)] == 1
    assert row["agent_calls_by_id"][str(inactive_agent.id)] == 1
    assert row["agent_calls_by_id"][str(inactive_empty.id)] == 0
    assert row["agent_calls"][agent_user.name] == 2
    assert sum(row["agent_calls_by_id"].values()) == row["calls"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("params", "message"),
    [
        (
            {"start_date": "2026-07-11", "end_date": "2026-07-10"},
            "开始日期不能晚于结束日期",
        ),
        (
            {"start_date": "2025-07-09", "end_date": "2026-07-10"},
            "查询范围最多 366 天",
        ),
    ],
)
async def test_trend_rejects_invalid_ranges(client, admin_headers, params, message):
    response = await client.get("/api/stats/trend", params=params, headers=admin_headers)

    assert response.status_code == 422
    assert response.json()["detail"] == message


@pytest.mark.asyncio
async def test_trend_rejects_invalid_date_format(client, admin_headers):
    response = await client.get(
        "/api/stats/trend",
        params={"start_date": "not-a-date"},
        headers=admin_headers,
    )

    assert response.status_code == 422


@pytest.mark.asyncio
async def test_trend_defaults_to_current_cst_month(client, admin_headers, monkeypatch):
    monkeypatch.setattr(stats_enrollment, "today_cst_date", lambda: date(2026, 7, 10))

    response = await client.get("/api/stats/trend", headers=admin_headers)

    assert response.status_code == 200
    assert response.json()["data"]["start"] == "2026-07-01"
    assert response.json()["data"]["end"] == "2026-07-10"


def test_trend_postgresql_date_expression_uses_cst_offset():
    expression = stats_enrollment._dial_log_cst_date_expression("postgresql")
    sql = str(select(expression).compile(dialect=postgresql.dialect()))

    assert "INTERVAL '8 hours'" in sql


@pytest.mark.asyncio
async def test_agent_ranking_excludes_disabled_agents_with_no_data(
    client, admin_headers, db, agent_user
):
    disabled_empty = User(
        username="disabled-empty",
        hashed_password="x",
        role="agent",
        name="禁用无数据",
        is_active=False,
    )
    disabled_with_data = User(
        username="disabled-data",
        hashed_password="x",
        role="agent",
        name="禁用有数据",
        is_active=False,
    )
    db.add_all([disabled_empty, disabled_with_data])
    await db.flush()
    db.add(
        Student(
            name="历史线索",
            assigned_to=disabled_with_data.id,
            status=StudentStatus.contacted,
        )
    )
    await db.commit()

    resp = await client.get("/api/stats/agent-ranking", headers=admin_headers)
    body = resp.json()

    assert resp.status_code == 200
    names = [item["name"] for item in body["data"]["ranking"]]
    assert agent_user.name in names
    assert "禁用有数据" in names
    assert "禁用无数据" not in names


@pytest.mark.asyncio
async def test_heatmap_excludes_disabled_agents_with_no_calls(
    client, admin_headers, db, agent_user
):
    disabled_empty = User(
        username="disabled-heat-empty",
        hashed_password="x",
        role="agent",
        name="禁用热力无数据",
        is_active=False,
    )
    disabled_with_call = User(
        username="disabled-heat-data",
        hashed_password="x",
        role="agent",
        name="禁用热力有数据",
        is_active=False,
    )
    db.add_all([disabled_empty, disabled_with_call])
    await db.flush()
    student = Student(name="热力线索", assigned_to=disabled_with_call.id)
    db.add(student)
    await db.flush()
    today = today_cst_as_utc()
    db.add(
        DialLog(
            student_id=student.id,
            agent_id=disabled_with_call.id,
            dialed_at=today + timedelta(hours=1),
        )
    )
    await db.commit()

    resp = await client.get("/api/stats/heatmap", headers=admin_headers)
    body = resp.json()

    assert resp.status_code == 200
    agents = body["data"]["agents"]
    assert agent_user.name in agents
    assert "禁用热力有数据" in agents
    assert "禁用热力无数据" not in agents


@pytest.mark.asyncio
async def test_admissions_report_summarizes_workflow(
    client, admin_headers, db, admin_user, agent_user
):
    other_agent = User(
        username="admissions-report-agent",
        hashed_password="x",
        role=UserRole.agent,
        name="后续坐席",
        is_active=True,
    )
    db.add(other_agent)
    await db.flush()

    enrolled_student = Student(
        name="报名学生",
        region="芗城",
        school_name="一中",
        assigned_to=agent_user.id,
        status=StudentStatus.enrolled,
        intent_level=IntentLevel.A,
    )
    visiting_student = Student(
        name="家访学生",
        region="龙海",
        school_name="二中",
        assigned_to=other_agent.id,
        status=StudentStatus.contacted,
        intent_level=IntentLevel.A,
    )
    legacy_enrolled_student = Student(
        name="历史报名学生",
        region="龙海",
        school_name="二中",
        assigned_to=other_agent.id,
        status=StudentStatus.enrolled,
        intent_level=IntentLevel.none,
    )
    blank_region_student = Student(
        name="空区域线索",
        region="",
        assigned_to=None,
        status=StudentStatus.not_contacted,
        intent_level=IntentLevel.none,
    )
    db.add_all([enrolled_student, visiting_student, legacy_enrolled_student, blank_region_student])
    await db.flush()

    db.add_all(
        [
            DialLog(student_id=enrolled_student.id, agent_id=agent_user.id),
            DialLog(student_id=enrolled_student.id, agent_id=agent_user.id),
            DialLog(student_id=visiting_student.id, agent_id=other_agent.id),
            DialLog(student_id=visiting_student.id, agent_id=other_agent.id),
            DialLog(student_id=visiting_student.id, agent_id=other_agent.id),
            HomeVisitTask(
                student_id=enrolled_student.id,
                creator_agent_id=agent_user.id,
                status=HomeVisitStatus.completed,
                student_name_snapshot=enrolled_student.name,
                region_snapshot="芗城",
                school_name_snapshot="一中",
            ),
            HomeVisitTask(
                student_id=visiting_student.id,
                creator_agent_id=other_agent.id,
                status=HomeVisitStatus.pending,
                student_name_snapshot=visiting_student.name,
                region_snapshot="龙海",
                school_name_snapshot="二中",
            ),
            CampusVisitTask(
                student_id=enrolled_student.id,
                creator_user_id=agent_user.id,
                status=CampusVisitStatus.arrived,
                source="家访后",
                student_name_snapshot=enrolled_student.name,
                region_snapshot="芗城",
                school_name_snapshot="一中",
            ),
            CampusVisitTask(
                student_id=visiting_student.id,
                creator_user_id=other_agent.id,
                status=CampusVisitStatus.scheduled,
                source="家访后",
                student_name_snapshot=visiting_student.name,
                region_snapshot="龙海",
                school_name_snapshot="二中",
                appointment_at=datetime(2026, 7, 2, 9, 0, 0),
            ),
            EnrollmentRecord(
                student_id=enrolled_student.id,
                attributed_agent_id=agent_user.id,
                confirmed_by_admin_id=admin_user.id,
                student_name_snapshot=enrolled_student.name,
                region_snapshot="芗城",
                school_name_snapshot="一中",
                source=EnrollmentSource.campus_visit,
                attribution_method=AttributionMethod.manual,
                attribution_reason="离职后重新确认归属",
                settlement_status=SettlementStatus.unsettled,
            ),
        ]
    )
    await db.commit()

    resp = await client.get("/api/stats/admissions-report", headers=admin_headers)
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0

    funnel = {item["key"]: item for item in body["data"]["funnel"]}
    assert funnel["leads"]["value"] == 4
    assert funnel["a_intent"]["value"] == 2
    assert funnel["home_visit_reported"]["value"] == 2
    assert funnel["campus_visit_arrived"]["value"] == 1
    assert funnel["enrolled"]["value"] == 2

    regions = {item["region"]: item for item in body["data"]["regions"]}
    assert regions["芗城"]["total_leads"] == 1
    assert regions["芗城"]["enrollments"] == 1
    assert regions["龙海"]["total_leads"] == 2
    assert regions["龙海"]["home_visits"] == 1
    assert regions["龙海"]["enrollments"] == 1
    assert regions["未知"]["total_leads"] == 1

    agent_rows = body["data"]["agents"]
    assert [item["calls"] for item in agent_rows] == sorted(
        (item["calls"] for item in agent_rows), reverse=True
    )
    agents = {item["agent_name"]: item for item in agent_rows}
    assert agents[agent_user.name]["calls"] == 2
    assert agents["后续坐席"]["calls"] == 3
    assert agents[agent_user.name]["home_visit_reports"] == 1
    assert agents[agent_user.name]["enrollments"] == 1
    assert agents[agent_user.name]["settlement_pending"] == 1
    assert agents["后续坐席"]["campus_visit_appointments"] == 1

    assert body["data"]["visits"]["home"]["completed"] == 1
    assert body["data"]["visits"]["campus"]["scheduled"] == 1
    assert body["data"]["settlement"]["total"] == 1
    assert body["data"]["settlement"]["unsettled"] == 1
    assert body["data"]["settlement"]["manual_attribution"] == 1
    assert body["data"]["settlement"]["by_source"]["到校参观后"] == 1
