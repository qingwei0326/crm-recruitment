"""Pin account-management rules that were moved into user_account_service.

Covers the "keep at least one admin / super admin" guards, non-super-admin
restrictions after the permission dependency has passed, delete semantics for
terminal vs non-terminal students, and the directory/score read models.
"""

from datetime import timedelta

import pytest

from app.auth import create_access_token
from app.domain_models import AgentEmployment
from app.models import (
    DialLog,
    FollowUp,
    IntentLevel,
    Student,
    StudentStage,
    StudentStatus,
    User,
)
from app.utils import today_cst_as_utc

ALL_USER_OPS = [
    "user_create",
    "user_edit",
    "user_delete",
    "user_offboard",
    "user_unlock",
    "user_reset_password",
]


def _headers(user):
    token = create_access_token(
        {"sub": str(user.id), "role": str(user.role), "tv": user.token_version or 0}
    )
    return {"Authorization": f"Bearer {token}"}


async def _grant_user_ops(db, user):
    user.page_permissions = "account_manage,audit_logs"
    user.operation_permissions = ",".join(ALL_USER_OPS)
    await db.commit()


@pytest.mark.asyncio
async def test_non_super_admin_cannot_manage_admins_even_with_user_permissions(
    client, db, admin_user, normal_admin_user, agent_user
):
    await _grant_user_ops(db, normal_admin_user)
    headers = _headers(normal_admin_user)

    created = await client.post(
        "/api/admin/users",
        json={"username": "newadm", "password": "Passw0rd!1", "name": "新管理", "role": "admin"},
        headers=headers,
    )
    assert (created.status_code, created.json()["detail"]) == (
        403,
        "只有超级管理员可以创建管理员或授权",
    )
    edited = await client.put(
        f"/api/admin/users/{admin_user.id}", json={"name": "改名"}, headers=headers
    )
    assert (edited.status_code, edited.json()["detail"]) == (
        403,
        "只有超级管理员可以调整管理员或权限",
    )
    deleted = await client.delete(f"/api/admin/users/{admin_user.id}", headers=headers)
    assert (deleted.status_code, deleted.json()["detail"]) == (403, "只有超级管理员可以删除管理员")
    unlocked = await client.post(f"/api/admin/users/{admin_user.id}/unlock", headers=headers)
    assert unlocked.json()["detail"] == "只有超级管理员可以解锁管理员"
    reset = await client.post(f"/api/admin/users/{admin_user.id}/reset-password", headers=headers)
    assert reset.json()["detail"] == "只有超级管理员可以重置管理员密码"
    offboarded = await client.post(f"/api/admin/users/{agent_user.id}/offboard", headers=headers)
    assert offboarded.json()["detail"] == "需要超级管理员权限"

    # A non-super admin can still create ordinary agents.
    agent = await client.post(
        "/api/admin/users",
        json={"username": "agentb1", "password": "Passw0rd!1", "name": "普管建坐席"},
        headers=headers,
    )
    assert agent.json()["code"] == 0
    assert agent.json()["data"]["role"] == "agent"


@pytest.mark.asyncio
async def test_last_admin_and_last_super_admin_are_protected(
    client, db, admin_user, normal_admin_user, admin_headers
):
    # Two active admins, one super admin: demoting the only super admin is refused.
    demote = await client.put(
        f"/api/admin/users/{admin_user.id}", json={"is_super_admin": False}, headers=admin_headers
    )
    assert demote.json()["msg"] == "系统至少需要保留一个超级管理员"

    # Remove the other admin so the caller is the last active admin.
    removed = await client.delete(f"/api/admin/users/{normal_admin_user.id}", headers=admin_headers)
    assert removed.json()["code"] == 0
    suspend = await client.put(
        f"/api/admin/users/{admin_user.id}", json={"is_active": False}, headers=admin_headers
    )
    assert suspend.json()["msg"] == "不能停用最后一个管理员"

    own = await client.delete(f"/api/admin/users/{admin_user.id}", headers=admin_headers)
    assert own.json()["msg"] == "不能删除自己"


@pytest.mark.asyncio
async def test_delete_agent_recycles_open_students_and_keeps_terminal_ones(
    client, db, agent_user, admin_headers, assignment_baseline
):
    started = today_cst_as_utc() - timedelta(days=2)
    rows = {}
    for name, status, intent in [
        ("开放", StudentStatus.pending_visit, IntentLevel.A),
        ("无效", StudentStatus.invalid, IntentLevel.none),
        ("已报名", StudentStatus.enrolled, IntentLevel.A),
    ]:
        student = Student(
            name=name,
            status=status,
            intent_level=intent,
            stage=StudentStage.campus_visit_scheduled,
            guardian_phone="13800000001",
            need_help=True,
        )
        db.add(student)
        await db.flush()
        await assignment_baseline(student, agent_user, started_at=started)
        rows[name] = student
    await db.commit()

    agent_id = agent_user.id
    row_ids = {name: student.id for name, student in rows.items()}
    response = await client.delete(f"/api/admin/users/{agent_id}", headers=admin_headers)
    assert response.json() == {
        "code": 0,
        "data": None,
        "msg": "账号已停用并保留历史，该话务员的学生已回收至池",
    }

    db.expire_all()
    open_student = await db.get(Student, row_ids["开放"])
    assert open_student.assigned_to is None
    assert open_student.status == StudentStatus.not_contacted
    assert open_student.intent_level == IntentLevel.none
    assert open_student.stage == StudentStage.initial_contact
    assert open_student.need_help is False
    for name, status in [("无效", StudentStatus.invalid), ("已报名", StudentStatus.enrolled)]:
        kept = await db.get(Student, row_ids[name])
        assert kept.status == status and kept.assigned_to is None
    employment = await db.get(AgentEmployment, agent_id)
    assert employment.status.value == "offboarded"


@pytest.mark.asyncio
async def test_directory_and_score_preview_aggregate_agent_work(
    client, db, admin_user, agent_user, admin_headers, assignment_baseline
):
    today = today_cst_as_utc()
    first = Student(name="一", status=StudentStatus.not_contacted, guardian_phone="13800000001")
    second = Student(name="二", status=StudentStatus.pending_visit, guardian_phone="13800000002")
    db.add_all([first, second])
    await db.flush()
    await assignment_baseline(first, agent_user, started_at=today)
    await assignment_baseline(second, agent_user, started_at=today)
    db.add_all(
        [
            DialLog(
                student_id=first.id,
                agent_id=agent_user.id,
                dialed_at=today + timedelta(hours=1),
                recording_state="completed",
                duration_seconds=60,
            ),
            DialLog(
                student_id=second.id,
                agent_id=agent_user.id,
                dialed_at=today + timedelta(hours=2),
                recording_state="pending",
                duration_seconds=0,
            ),
            FollowUp(
                student_id=second.id,
                agent_id=agent_user.id,
                follow_up_date=today - timedelta(days=1),
            ),
        ]
    )
    await db.commit()

    agents = (await client.get("/api/admin/agents", headers=admin_headers)).json()["data"]
    row = next(item for item in agents if item["id"] == agent_user.id)
    assert (row["total_leads"], row["today_calls"]) == (2, 2)

    users = (await client.get("/api/admin/users", headers=admin_headers)).json()["data"]
    assert {item["id"] for item in users} >= {admin_user.id, agent_user.id}
    admin_row = next(item for item in users if item["id"] == admin_user.id)
    assert (admin_row["total_tasks"], admin_row["today_calls"]) == (0, 0)  # admins carry no tasks

    preview = (
        await client.get(
            "/api/admin/agent-score-preview?daily_call_target=5", headers=admin_headers
        )
    ).json()["data"]
    assert preview["daily_call_target"] == 5
    assert preview["configured_daily_call_target"] == 30
    metrics = preview["items"][0]["metrics"]
    assert metrics["total_leads"] == 2
    assert metrics["today_calls"] == 2
    assert metrics["today_recorded_calls"] == 1
    assert metrics["today_pending_dial_sessions"] == 1
    assert metrics["overdue_follow_ups"] == 1

    tasks = (
        await client.get(f"/api/admin/agents/{agent_user.id}/tasks", headers=admin_headers)
    ).json()["data"]
    assert tasks["stats"]["total_leads"] == 2
    missing = await client.get("/api/admin/agents/9999/tasks", headers=admin_headers)
    assert (missing.json()["code"], missing.json()["msg"]) == (1, "话务员不存在")


@pytest.mark.asyncio
async def test_unlock_and_reset_password_messages(client, db, agent_user, admin_headers):
    agent_id, username, name = agent_user.id, agent_user.username, agent_user.name
    agent_user.failed_login_attempts = 4
    await db.commit()

    unlocked = await client.post(f"/api/admin/users/{agent_id}/unlock", headers=admin_headers)
    assert unlocked.json()["msg"] == f"用户 {username} 已解锁"
    db.expire_all()
    assert (await db.get(User, agent_id)).failed_login_attempts == 0

    reset = await client.post(f"/api/admin/users/{agent_id}/reset-password", headers=admin_headers)
    password = reset.json()["data"]["new_password"]
    assert reset.json()["msg"] == f"用户 {name} 密码已重置为 {password}"
    db.expire_all()
    assert (await db.get(User, agent_id)).must_change_password is True
