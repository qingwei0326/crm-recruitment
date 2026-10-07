"""Coverage for agent task endpoints that previously had no tests.

/api/tasks/yesterday, /following, /backlog and the filter error branches of
/today and /handled.
"""

from datetime import timedelta

import pytest

from app.domain_models import PersonalGroup
from app.models import (
    Call,
    FollowUp,
    IntentLevel,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
)
from app.utils import today_cst_as_utc


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
    stale = await _student(
        db, agent_user, assignment_baseline, "昨日未联系", StudentStatus.not_contacted,
        IntentLevel.none, yesterday_noon,
    )
    db.add_all([
        Call(student_id=called.id, agent_id=agent_user.id, created_at=yesterday_noon),
        Call(student_id=called.id, agent_id=agent_user.id, created_at=yesterday_noon),
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
