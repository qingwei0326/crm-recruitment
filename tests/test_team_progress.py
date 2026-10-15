"""Admin team progress: what each agent / region still has to do."""

from datetime import timedelta

import pytest

from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    DialLog,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    Note,
    Student,
    StudentStage,
    StudentStatus,
    User,
)
from app.utils import today_cst_date, utcnow


async def _student(
    db,
    agent,
    *,
    name="学生",
    status=StudentStatus.not_contacted,
    intent=IntentLevel.none,
    region="东山",
    assigned_hours_ago=1,
    enrolled_at=None,
):
    student = Student(
        name=name,
        status=status,
        intent_level=intent,
        stage=(
            StudentStage.enrolled
            if status == StudentStatus.enrolled
            else StudentStage.initial_contact
        ),
        guardian_phone="13800000000",
        region=region,
        assigned_to=agent.id if agent else None,
        assigned_at=utcnow() - timedelta(hours=assigned_hours_ago) if agent else None,
        enrolled_at=enrolled_at,
    )
    db.add(student)
    await db.flush()
    return student


async def _other_agent(db, name="小王", active=True):
    agent = User(
        username=f"agent-{name}", hashed_password="x", role="agent", name=name, is_active=active
    )
    db.add(agent)
    await db.flush()
    return agent


async def _progress(client, headers, group_by="agent"):
    resp = await client.get(
        "/api/admin/team-progress", params={"group_by": group_by}, headers=headers
    )
    assert resp.status_code == 200, resp.text
    return resp.json()["data"]


def _by_label(data):
    return {row["label"]: row for row in data["rows"]}


@pytest.mark.asyncio
async def test_agent_rows_count_what_is_left_to_do(client, db, admin_headers, agent_user):
    agent_name = agent_user.name
    await _student(db, agent_user, name="新线索")
    await _student(db, agent_user, name="压了两天", assigned_hours_ago=50)
    await _student(db, agent_user, name="未接今天没打", status=StudentStatus.not_reached)
    redialed = await _student(
        db, agent_user, name="未接今天已打", status=StudentStatus.not_reached
    )
    db.add(DialLog(student_id=redialed.id, agent_id=agent_user.id, dialed_at=utcnow()))
    db.add(DialLog(student_id=redialed.id, agent_id=agent_user.id, dialed_at=utcnow()))
    await _student(
        db, agent_user, name="A刚聊过", status=StudentStatus.pending_visit, intent=IntentLevel.A
    )
    quiet = await _student(
        db, agent_user, name="B很久没联系", status=StudentStatus.contacted, intent=IntentLevel.B,
        assigned_hours_ago=24 * 10,
    )
    db.add(Note(student_id=quiet.id, agent_id=agent_user.id, content="x",
                created_at=utcnow() - timedelta(days=5)))
    await _student(
        db, agent_user, name="C不算", status=StudentStatus.contacted, intent=IntentLevel.C
    )
    await _student(
        db, agent_user, name="A已无效不算", status=StudentStatus.invalid, intent=IntentLevel.A
    )
    visit_student = await _student(db, agent_user, name="待家访", status=StudentStatus.contacted)
    db.add(HomeVisitTask(student_id=visit_student.id, creator_agent_id=agent_user.id,
                         status=HomeVisitStatus.pending))
    done_visit = await _student(db, agent_user, name="家访完成", status=StudentStatus.contacted)
    db.add(HomeVisitTask(student_id=done_visit.id, creator_agent_id=agent_user.id,
                         status=HomeVisitStatus.completed))
    campus = await _student(db, agent_user, name="约到校", status=StudentStatus.contacted)
    db.add(CampusVisitTask(student_id=campus.id, creator_user_id=agent_user.id,
                           status=CampusVisitStatus.scheduled))
    await _student(db, agent_user, name="今天报名", status=StudentStatus.enrolled,
                   enrolled_at=today_cst_date())
    await _student(db, agent_user, name="以前报名", status=StudentStatus.enrolled,
                   enrolled_at=today_cst_date() - timedelta(days=3))
    await _student(db, None, name="没分配")
    await db.commit()

    data = await _progress(client, admin_headers)

    row = _by_label(data)[agent_name]
    assert row["pending_dial"] == 2
    assert row["overdue"] == 1
    assert row["missed_waiting"] == 1
    assert row["today_dials"] == 2
    assert row["intent_ab"] == 2
    assert row["intent_ab_quiet"] == 1
    assert row["open_visits"] == 2
    assert row["enrolled_today"] == 1
    assert row["enrolled_total"] == 2
    assert row["needs_leads"] is False
    assert data["totals"]["pending_dial"] == 2
    assert data["overdue_after_hours"] == 24


@pytest.mark.asyncio
async def test_agent_with_nothing_left_to_dial_is_flagged_and_listed_first(
    client, db, admin_headers, agent_user
):
    agent_name = agent_user.name
    await _student(db, agent_user, name="还有")
    idle = await _other_agent(db, "小王")
    await _student(db, idle, name="已联系", status=StudentStatus.contacted)
    await db.commit()

    data = await _progress(client, admin_headers)

    labels = [row["label"] for row in data["rows"]]
    assert labels.index("小王") < labels.index(agent_name)
    assert _by_label(data)["小王"]["needs_leads"] is True
    assert _by_label(data)[agent_name]["needs_leads"] is False


@pytest.mark.asyncio
async def test_inactive_agents_only_show_when_they_still_own_work(
    client, db, admin_headers, agent_user
):
    await _other_agent(db, "离职空手", active=False)
    holder = await _other_agent(db, "离职还有线索", active=False)
    await _student(db, holder, name="遗留")
    await db.commit()

    rows = _by_label(await _progress(client, admin_headers))

    assert "离职空手" not in rows
    assert rows["离职还有线索"]["is_active"] is False
    assert rows["离职还有线索"]["needs_leads"] is False
    assert rows["离职还有线索"]["pending_dial"] == 1


@pytest.mark.asyncio
async def test_region_rows_group_the_same_numbers_by_area(client, db, admin_headers, agent_user):
    other = await _other_agent(db, "小王")
    await _student(db, agent_user, region="东山")
    await _student(db, other, region="东山")
    missed = await _student(db, other, region="云霄", status=StudentStatus.not_reached)
    await _student(db, agent_user, region="", status=StudentStatus.contacted, intent=IntentLevel.A)
    db.add(DialLog(student_id=missed.id, agent_id=other.id, dialed_at=utcnow() - timedelta(days=2)))
    await db.commit()

    data = await _progress(client, admin_headers, group_by="region")

    rows = _by_label(data)
    assert rows["东山"]["pending_dial"] == 2
    assert rows["云霄"]["missed_waiting"] == 1
    assert rows["云霄"]["today_dials"] == 0
    assert rows["未填片区"]["intent_ab"] == 1
    assert [row["label"] for row in data["rows"]][0] == "东山"
    assert data["totals"]["pending_dial"] == 2


@pytest.mark.asyncio
async def test_region_today_dials_follow_the_dialed_student(client, db, admin_headers, agent_user):
    student = await _student(db, agent_user, region="华安", status=StudentStatus.contacted)
    db.add(DialLog(student_id=student.id, agent_id=agent_user.id, dialed_at=utcnow()))
    await db.commit()

    rows = _by_label(await _progress(client, admin_headers, group_by="region"))

    assert rows["华安"]["today_dials"] == 1


@pytest.mark.asyncio
async def test_rejects_an_unknown_grouping(client, admin_headers):
    resp = await client.get(
        "/api/admin/team-progress", params={"group_by": "school"}, headers=admin_headers
    )

    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_agents_cannot_see_team_progress(client, agent_headers):
    resp = await client.get("/api/admin/team-progress", headers=agent_headers)

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_empty_database_returns_empty_rows(client, admin_headers, agent_user):
    data = await _progress(client, admin_headers)

    assert [row["label"] for row in data["rows"]] == [agent_user.name]
    assert data["rows"][0]["needs_leads"] is True
    assert data["totals"]["pending_dial"] == 0

    regions = await _progress(client, admin_headers, group_by="region")
    assert regions["rows"] == []
