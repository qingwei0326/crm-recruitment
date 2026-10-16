"""Coverage for agent task endpoints that previously had no tests.

/api/tasks/yesterday, /following, /backlog and the filter error branches of
/today and /handled.
"""

from datetime import timedelta

import pytest

from app.admin_daily_ops import _daily_ops_counts
from app.domain_models import PersonalGroup
from app.models import (
    DialLog,
    FollowUp,
    IntentLevel,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
    User,
)
from app.services.agent_task_service import SEARCH_RESULT_LIMIT
from app.utils import today_cst_as_utc, utcnow


async def _student(db, agent, assignment_baseline, name, status, intent, assigned_at):
    student = Student(
        name=name,
        status=status,
        intent_level=intent,
        stage=StudentStage.initial_contact,
        guardian_phone="13800000000",
    )
    db.add(student)
    await db.flush()
    await assignment_baseline(student, agent, started_at=assigned_at)
    student.assigned_at = assigned_at
    return student


@pytest.mark.asyncio
async def test_yesterday_review_counts_calls_upgrades_and_stale_work(
    client, db, agent_user, agent_headers, assignment_baseline
):
    today = today_cst_as_utc()
    yesterday_noon = today - timedelta(hours=12)
    called = await _student(
        db, agent_user, assignment_baseline, "昨日通话", StudentStatus.pending_visit,
        IntentLevel.A, today - timedelta(days=4),
    )
    # Yesterday's midnight is both "assigned yesterday" and 24+ hours ago at any hour.
    stale = await _student(
        db, agent_user, assignment_baseline, "昨日未联系", StudentStatus.not_contacted,
        IntentLevel.none, today - timedelta(days=1),
    )
    db.add_all([
        DialLog(student_id=called.id, agent_id=agent_user.id, dialed_at=yesterday_noon),
        DialLog(student_id=called.id, agent_id=agent_user.id, dialed_at=yesterday_noon),
        OperationLog(
            operator_id=agent_user.id, operator_name="坐席", target_student_id=called.id,
            case_no="", action="手动评级", old_status="B", new_status="A",
            created_at=yesterday_noon,
        ),
        FollowUp(
            student_id=called.id, agent_id=agent_user.id,
            follow_up_date=today + timedelta(hours=3),
        ),
    ])
    await db.commit()

    data = (await client.get("/api/tasks/yesterday", headers=agent_headers)).json()["data"]
    assert data["yesterday_calls"] == 2
    assert data["yesterday_a"] == 1
    assert data["conversion_rate"] == 100.0
    assert [item["name"] for item in data["list"]] == ["昨日未联系"]
    assert [item["student_name"] for item in data["follow_up_list"]] == ["昨日通话"]
    assert [item["id"] for item in data["stale_unconcat"]] == [stale.id]


@pytest.mark.asyncio
async def test_following_lists_intent_students_waiting_for_follow_up(
    client, db, agent_user, agent_headers, assignment_baseline
):
    today = today_cst_as_utc()
    await _student(
        db, agent_user, assignment_baseline, "跟进A", StudentStatus.pending_visit,
        IntentLevel.A, today - timedelta(days=2),
    )
    await _student(
        db, agent_user, assignment_baseline, "无意向待回访", StudentStatus.pending_visit,
        IntentLevel.none, today,
    )
    await _student(
        db, agent_user, assignment_baseline, "已联系B", StudentStatus.contacted,
        IntentLevel.B, today,
    )
    await db.commit()

    data = (await client.get("/api/tasks/following", headers=agent_headers)).json()["data"]
    assert data["total"] == 1
    assert data["intent_counts"] == {"A": 1}
    assert data["list"][0]["name"] == "跟进A"
    assert data["list"][0]["days_since_assigned"] >= 1


@pytest.mark.asyncio
async def test_backlog_counts_non_terminal_students_older_than_threshold(
    client, db, agent_user, agent_headers, assignment_baseline
):
    today = today_cst_as_utc()
    await _student(
        db, agent_user, assignment_baseline, "积压", StudentStatus.not_contacted,
        IntentLevel.none, today - timedelta(days=6),
    )
    await _student(
        db, agent_user, assignment_baseline, "已报名不算", StudentStatus.enrolled,
        IntentLevel.A, today - timedelta(days=9),
    )
    await _student(
        db, agent_user, assignment_baseline, "新分配不算", StudentStatus.not_contacted,
        IntentLevel.none, today,
    )
    await db.commit()

    data = (await client.get("/api/tasks/backlog", headers=agent_headers)).json()["data"]
    assert data["count"] == 1
    assert data["oldest_days"] >= 5
    assert data["threshold_days"] == 3


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["/api/tasks/today", "/api/tasks/handled"])
async def test_group_and_ungrouped_filters_are_mutually_exclusive(
    client, agent_headers, endpoint
):
    response = await client.get(
        f"{endpoint}?personal_group_id=1&ungrouped=true", headers=agent_headers
    )
    assert response.status_code == 422
    assert response.json()["detail"] == "分组筛选与未分组筛选不能同时使用"


@pytest.mark.asyncio
async def test_today_rejects_other_agents_personal_group(
    client, db, admin_user, agent_headers
):
    group = PersonalGroup(owner_id=admin_user.id, name="别人的分组", color="blue")
    db.add(group)
    await db.commit()

    response = await client.get(
        f"/api/tasks/today?personal_group_id={group.id}", headers=agent_headers
    )
    assert response.status_code == 404
    assert response.json()["detail"] == "分组不存在"


@pytest.mark.asyncio
async def test_today_rejects_unknown_intent_but_handled_returns_empty(client, agent_headers):
    today = await client.get("/api/tasks/today?intent_level=Z", headers=agent_headers)
    assert today.status_code == 422
    assert today.json()["detail"] == "意向等级无效"

    handled = await client.get("/api/tasks/handled?intent_level=Z", headers=agent_headers)
    assert handled.status_code == 200
    assert handled.json()["data"] == {
        "total": 0,
        "list_total": 0,
        "counts": {"已联系": 0, "未接": 0, "待回访": 0},
        "list": [],
    }


@pytest.mark.asyncio
async def test_overdue_means_assigned_at_least_24_hours_ago_not_before_midnight(
    client, db, agent_user, agent_headers, assignment_baseline
):
    now = utcnow()
    recent = await _student(
        db, agent_user, assignment_baseline, "23小时前", StudentStatus.not_contacted,
        IntentLevel.none, now - timedelta(hours=23),
    )
    old = await _student(
        db, agent_user, assignment_baseline, "25小时前", StudentStatus.not_contacted,
        IntentLevel.none, now - timedelta(hours=25),
    )
    await db.commit()

    today = (await client.get("/api/tasks/today", headers=agent_headers)).json()["data"]
    flags = {item["name"]: item["is_overdue"] for item in today["list"]}
    assert flags == {"23小时前": False, "25小时前": True}
    assert today["overdue_count"] == 1

    only_overdue = (
        await client.get("/api/tasks/today?overdue=true", headers=agent_headers)
    ).json()["data"]
    assert [item["id"] for item in only_overdue["list"]] == [old.id]

    stale = (await client.get("/api/tasks/yesterday", headers=agent_headers)).json()["data"]
    assert [item["id"] for item in stale["stale_unconcat"]] == [old.id]
    assert recent.id not in [item["id"] for item in stale["stale_unconcat"]]


@pytest.mark.asyncio
async def test_admin_daily_ops_counts_the_same_24_hour_rule(
    db, agent_user, assignment_baseline
):
    now = utcnow()
    await _student(
        db, agent_user, assignment_baseline, "23小时前", StudentStatus.not_contacted,
        IntentLevel.none, now - timedelta(hours=23),
    )
    await _student(
        db, agent_user, assignment_baseline, "25小时前", StudentStatus.not_contacted,
        IntentLevel.none, now - timedelta(hours=25),
    )
    await db.commit()

    counts = await _daily_ops_counts(db)

    assert counts["yesterday_uncontacted"] == 1


@pytest.mark.asyncio
async def test_search_finds_students_in_every_status_the_agent_owns(
    client, db, agent_user, agent_headers, assignment_baseline
):
    now = utcnow()
    for name, status in [
        ("陈待拨", StudentStatus.not_contacted),
        ("陈待办", StudentStatus.pending_visit),
        ("陈无效", StudentStatus.invalid),
        ("陈报名", StudentStatus.enrolled),
    ]:
        await _student(
            db, agent_user, assignment_baseline, name, status, IntentLevel.none, now
        )
    other_agent = User(
        username="otheragent", hashed_password="x", role="agent", name="别人", is_active=True
    )
    db.add(other_agent)
    await db.flush()
    foreign = Student(
        name="陈别人的", status=StudentStatus.not_contacted, guardian_phone="13900000000"
    )
    db.add(foreign)
    await db.flush()
    foreign.assigned_to = other_agent.id
    await db.commit()

    data = (
        await client.get("/api/tasks/search", params={"q": "陈"}, headers=agent_headers)
    ).json()["data"]

    assert data["total"] == 4
    by_name = {item["name"]: item for item in data["list"]}
    assert set(by_name) == {"陈待拨", "陈待办", "陈无效", "陈报名"}
    assert by_name["陈待拨"]["queue_label"] == "待拨打"
    assert by_name["陈待办"]["queue_label"] == "待处理"
    assert by_name["陈无效"]["queue_label"] == "已移出（无效）"
    assert by_name["陈无效"]["in_my_lists"] is False
    assert by_name["陈报名"]["queue_label"] == "已报名"


@pytest.mark.asyncio
async def test_search_matches_phone_and_guardian_name(
    client, db, agent_user, agent_headers, assignment_baseline
):
    student = await _student(
        db, agent_user, assignment_baseline, "李小明", StudentStatus.invalid,
        IntentLevel.none, utcnow(),
    )
    student.guardian_name = "李建国"
    student.guardian_phone = "13866668888"
    await db.commit()

    by_phone = (
        await client.get("/api/tasks/search", params={"q": "13866668888"}, headers=agent_headers)
    ).json()["data"]
    by_guardian = (
        await client.get("/api/tasks/search", params={"q": "建国"}, headers=agent_headers)
    ).json()["data"]
    by_tail = (
        await client.get("/api/tasks/search", params={"q": "8888"}, headers=agent_headers)
    ).json()["data"]

    assert [item["id"] for item in by_phone["list"]] == [student.id]
    assert [item["id"] for item in by_guardian["list"]] == [student.id]
    assert [item["id"] for item in by_tail["list"]] == [student.id]


@pytest.mark.asyncio
async def test_search_with_a_blank_keyword_returns_nothing(
    client, db, agent_user, agent_headers, assignment_baseline
):
    await _student(
        db, agent_user, assignment_baseline, "李小明", StudentStatus.not_contacted,
        IntentLevel.none, utcnow(),
    )
    await db.commit()

    for q in ("", "   "):
        data = (
            await client.get("/api/tasks/search", params={"q": q}, headers=agent_headers)
        ).json()["data"]
        assert data == {"total": 0, "list": []}


@pytest.mark.asyncio
async def test_search_caps_the_result_list_but_reports_the_full_total(
    client, db, agent_user, agent_headers, assignment_baseline
):
    for i in range(SEARCH_RESULT_LIMIT + 5):
        await _student(
            db, agent_user, assignment_baseline, f"王{i:02d}", StudentStatus.not_contacted,
            IntentLevel.none, utcnow(),
        )
    await db.commit()

    data = (
        await client.get("/api/tasks/search", params={"q": "王"}, headers=agent_headers)
    ).json()["data"]

    assert data["total"] == SEARCH_RESULT_LIMIT + 5
    assert len(data["list"]) == SEARCH_RESULT_LIMIT


@pytest.mark.asyncio
async def test_search_requires_login(client):
    resp = await client.get("/api/tasks/search", params={"q": "王"})

    assert resp.status_code in (401, 403)
