from datetime import timedelta

import pytest
from sqlalchemy import select

from app.models import DialLog, FollowUp, OperationLog, Student, StudentStatus, User
from app.smart_assignment import SmartAssignParams, build_smart_assignment_plan
from app.utils import today_cst_as_utc, utcnow


def _agent(username: str, name: str, active: bool = True) -> User:
    return User(
        username=username,
        hashed_password="x",
        role="agent",
        name=name,
        is_active=active,
    )


def _student(
    name: str,
    *,
    status=StudentStatus.not_contacted,
    assigned_to=None,
    school_name="测试中学",
    region="芗城区",
    guardian_phone="13900000000",
) -> Student:
    return Student(
        name=name,
        status=status,
        assigned_to=assigned_to,
        school_name=school_name,
        region=region,
        guardian_phone=guardian_phone,
    )


@pytest.mark.asyncio
async def test_smart_assign_preview_fills_lower_load_agent_first(db):
    low = _agent("low_load", "低负载")
    high = _agent("high_load", "高负载")
    db.add_all([low, high])
    await db.flush()
    for index in range(12):
        db.add(
            _student(
                f"高负载现有{index}",
                assigned_to=high.id,
                guardian_phone=f"1391000{index:04d}",
            )
        )
    for index in range(4):
        db.add(_student(f"候选{index}", guardian_phone=f"1392000{index:04d}"))
    await db.commit()

    plan = await build_smart_assignment_plan(
        db,
        SmartAssignParams(limit=4, per_agent_limit=4),
    )

    low_row = next(row for row in plan.payload["agents"] if row["agent_id"] == low.id)
    high_row = next(row for row in plan.payload["agents"] if row["agent_id"] == high.id)
    assert low_row["suggested_count"] == 4
    assert high_row["suggested_count"] == 0
    assert plan.payload["plan"]["planned"] == 4
    assert plan.assignments_by_agent == {low.id: plan.assignments_by_agent[low.id]}
    assert len(plan.assignments_by_agent[low.id]) == 4


@pytest.mark.asyncio
async def test_smart_assign_preview_excludes_duplicate_primary_phone_groups(db):
    agent = _agent("agent_a", "坐席A")
    db.add(agent)
    await db.flush()
    db.add_all(
        [
            _student("重复1", guardian_phone="13911112222"),
            _student("重复2", guardian_phone="13911112222"),
            _student("唯一", guardian_phone="13933334444"),
        ]
    )
    await db.commit()

    plan = await build_smart_assignment_plan(db, SmartAssignParams(limit=10, per_agent_limit=10))

    assert plan.payload["pool"]["total_unassigned"] == 3
    assert plan.payload["pool"]["excluded_duplicate_phone"] == 2
    assert plan.payload["pool"]["eligible_total"] == 1
    assert plan.payload["plan"]["planned"] == 1


@pytest.mark.asyncio
async def test_smart_assign_preview_respects_filters_and_agent_limit(db):
    agent_a = _agent("agent_a", "坐席A")
    agent_b = _agent("agent_b", "坐席B")
    db.add_all([agent_a, agent_b])
    await db.flush()
    db.add_all(
        [
            _student(
                "命中1",
                school_name="龙海一中",
                region="龙海区",
                guardian_phone="13900000001",
            ),
            _student(
                "命中2",
                school_name="龙海一中",
                region="龙海区",
                guardian_phone="13900000002",
            ),
            _student(
                "其他学校",
                school_name="漳浦一中",
                region="漳浦县",
                guardian_phone="13900000003",
            ),
        ]
    )
    await db.commit()

    plan = await build_smart_assignment_plan(
        db,
        SmartAssignParams(
            school_name="龙海一中",
            region="龙海区",
            limit=3,
            per_agent_limit=1,
        ),
    )

    assert plan.payload["pool"]["eligible_total"] == 2
    assert plan.payload["plan"]["planned"] == 2
    assert all(row["suggested_count"] <= 1 for row in plan.payload["agents"])


@pytest.mark.asyncio
async def test_smart_assign_preview_returns_warning_when_no_active_agents(db):
    db.add(_student("候选", guardian_phone="13900000001"))
    await db.commit()

    plan = await build_smart_assignment_plan(db, SmartAssignParams(limit=10, per_agent_limit=10))

    assert plan.payload["plan"]["planned"] == 0
    assert plan.payload["agents"] == []
    assert "没有启用话务员" in plan.payload["warnings"]


@pytest.mark.asyncio
async def test_smart_assign_load_score_uses_calls_recent_handling_and_overdue_followups(db):
    agent = _agent("agent_a", "坐席A")
    db.add(agent)
    await db.flush()
    existing = _student("现有任务", assigned_to=agent.id, guardian_phone="13900000001")
    db.add(existing)
    await db.flush()
    db.add(
        DialLog(
            student_id=existing.id,
            agent_id=agent.id,
            dialed_at=today_cst_as_utc() + timedelta(hours=1),
        )
    )
    db.add(
        OperationLog(
            operator_id=agent.id,
            operator_name=agent.name,
            target_student_id=existing.id,
            case_no="",
            action="修改状态",
            content="测试处理",
            created_at=utcnow() - timedelta(days=1),
        )
    )
    db.add(
        FollowUp(
            student_id=existing.id,
            agent_id=agent.id,
            follow_up_date=utcnow() - timedelta(hours=1),
            is_completed=False,
        )
    )
    db.add(_student("候选", guardian_phone="13900000002"))
    await db.commit()

    plan = await build_smart_assignment_plan(db, SmartAssignParams(limit=1, per_agent_limit=1))

    row = plan.payload["agents"][0]
    assert row["active_tasks"] == 1
    assert row["today_calls"] == 1
    assert row["handled_7d"] == 1
    assert row["overdue_follow_ups"] == 1
    assert row["load_score"] == 3.5


@pytest.mark.asyncio
async def test_smart_assign_preview_requires_lead_governance_page_permission(
    client,
    normal_admin_headers,
):
    resp = await client.get("/api/admin/smart-assign/preview", headers=normal_admin_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_smart_assign_preview_allows_lead_governance_page_permission(
    client,
    db,
    normal_admin_user,
    normal_admin_headers,
    agent_user,
):
    normal_admin_user.page_permissions = "lead_governance"
    db.add(_student("候选", guardian_phone="13900000001"))
    await db.commit()

    resp = await client.get("/api/admin/smart-assign/preview", headers=normal_admin_headers)

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["pool"]["eligible_total"] == 1


@pytest.mark.asyncio
async def test_smart_assign_execute_requires_student_assign_permission(
    client,
    db,
    normal_admin_user,
    normal_admin_headers,
    agent_user,
):
    normal_admin_user.page_permissions = "lead_governance"
    db.add(_student("候选", guardian_phone="13900000001"))
    await db.commit()

    resp = await client.post(
        "/api/admin/smart-assign/execute",
        headers=normal_admin_headers,
        json={"limit": 1, "per_agent_limit": 1, "confirm": True},
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_smart_assign_execute_requires_confirm(client, admin_headers):
    resp = await client.post(
        "/api/admin/smart-assign/execute",
        headers=admin_headers,
        json={"limit": 1, "per_agent_limit": 1, "confirm": False},
    )
    assert resp.status_code == 200
    assert resp.json()["code"] == 1
    assert resp.json()["msg"] == "请确认后再执行智能分配"


@pytest.mark.asyncio
async def test_smart_assign_execute_recalculates_and_writes_rollbackable_logs(
    client,
    db,
    admin_headers,
    agent_user,
):
    second_agent = _agent("second_agent", "第二坐席")
    db.add(second_agent)
    await db.flush()
    db.add_all(
        [
            _student("候选1", guardian_phone="13900000001"),
            _student("候选2", guardian_phone="13900000002"),
            _student("重复1", guardian_phone="13999990000"),
            _student("重复2", guardian_phone="13999990000"),
        ]
    )
    await db.commit()

    resp = await client.post(
        "/api/admin/smart-assign/execute",
        headers=admin_headers,
        json={"limit": 3, "per_agent_limit": 2, "confirm": True},
    )
    body = resp.json()

    assert body["code"] == 0
    assert body["data"]["assigned_count"] == 2
    assert body["data"]["skipped_count"] == 0
    assert body["data"]["batch_id"].startswith("smart-assign-")

    assigned = (
        (
            await db.execute(
                select(Student).where(Student.name.in_(["候选1", "候选2"])).order_by(Student.id)
            )
        )
        .scalars()
        .all()
    )
    assert all(student.assigned_to is not None for student in assigned)
    logs = (
        (
            await db.execute(
                select(OperationLog)
                .where(OperationLog.batch_id == body["data"]["batch_id"])
                .order_by(OperationLog.id)
            )
        )
        .scalars()
        .all()
    )
    assert [log.action for log in logs].count("智能分配") == 2
    assert logs[-1].action == "智能分配汇总"

    rollback_resp = await client.get(
        f"/api/admin/assignment-rollbacks/{body['data']['batch_id']}",
        headers=admin_headers,
    )
    rollback_body = rollback_resp.json()
    assert rollback_body["code"] == 0
    assert rollback_body["data"]["rollbackable_count"] == 2
