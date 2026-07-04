"""Tests for admin endpoints: user CRUD, role-based access, unlock.

Note: API uses custom Response: HTTP 200 always, code=0 success, code=1 error.
"""

from datetime import datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    DialLog,
    EnrollmentRecord,
    FollowUp,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    Note,
    OperationLog,
    SettlementStatus,
    Student,
    StudentStage,
    StudentStatus,
    SystemConfig,
    User,
)
from app.utils import today_cst_as_utc, utcnow


@pytest.mark.asyncio
class TestAdminAgents:
    async def test_list_agents(self, client, admin_headers, agent_user):
        resp = await client.get("/api/admin/agents", headers=admin_headers)
        body = resp.json()
        assert body["code"] == 0
        assert any(a["username"] == "testagent" for a in body["data"])

    async def test_list_agents_only_returns_active_agents(
        self, client, admin_headers, db, agent_user
    ):
        inactive_agent = User(
            username="inactive_agent",
            hashed_password="x",
            name="离职话务员",
            role="agent",
            is_active=False,
        )
        db.add(inactive_agent)
        await db.commit()

        resp = await client.get("/api/admin/agents", headers=admin_headers)
        body = resp.json()

        assert body["code"] == 0
        usernames = {agent["username"] for agent in body["data"]}
        assert agent_user.username in usernames
        assert inactive_agent.username not in usernames

    async def test_list_users_includes_admins_for_account_management(
        self, client, admin_headers, admin_user, agent_user
    ):
        resp = await client.get("/api/admin/users", headers=admin_headers)
        body = resp.json()

        assert body["code"] == 0
        usernames = {user["username"] for user in body["data"]}
        assert {"testadmin", "testagent"}.issubset(usernames)
        admin_row = next(user for user in body["data"] if user["username"] == "testadmin")
        agent_row = next(user for user in body["data"] if user["username"] == "testagent")
        assert admin_row["role"] == "admin"
        assert admin_row["is_super_admin"] is True
        assert admin_row["page_permissions"] == []
        assert admin_row["total_tasks"] == 0
        assert agent_row["role"] == "agent"

    async def test_list_users_requires_account_or_audit_page_permission(
        self, client, normal_admin_headers
    ):
        resp = await client.get("/api/admin/users", headers=normal_admin_headers)
        assert resp.status_code == 403

    async def test_list_users_allows_account_page_permission(
        self, client, db, normal_admin_user, normal_admin_headers
    ):
        normal_admin_user.page_permissions = "account_manage"
        await db.commit()

        resp = await client.get("/api/admin/users", headers=normal_admin_headers)

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_list_users_allows_audit_page_permission_for_filters(
        self, client, db, normal_admin_user, normal_admin_headers
    ):
        normal_admin_user.page_permissions = "audit_logs"
        await db.commit()

        resp = await client.get("/api/admin/users", headers=normal_admin_headers)

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_list_users_keeps_inactive_agent_history(
        self, client, admin_headers, db, agent_user
    ):
        inactive_agent = User(
            username="offboarded_agent",
            hashed_password="x",
            name="离职留档话务员",
            role="agent",
            is_active=False,
        )
        db.add(inactive_agent)
        await db.commit()

        resp = await client.get("/api/admin/users", headers=admin_headers)
        body = resp.json()

        assert body["code"] == 0
        user_rows = {user["username"]: user for user in body["data"]}
        assert agent_user.username in user_rows
        assert user_rows["offboarded_agent"]["is_active"] is False

    async def test_list_agents_counts_today_dial_logs(self, client, admin_headers, db, agent_user):
        student = Student(
            name="今日拨号学生",
            assigned_to=agent_user.id,
            status=StudentStatus.not_contacted,
        )
        db.add(student)
        await db.flush()
        db.add(
            DialLog(
                student_id=student.id,
                agent_id=agent_user.id,
                dialed_at=today_cst_as_utc() + timedelta(hours=1),
            )
        )
        await db.commit()

        resp = await client.get("/api/admin/agents", headers=admin_headers)
        body = resp.json()

        agent_row = next(a for a in body["data"] if a["id"] == agent_user.id)
        assert agent_row["today_calls"] == 1

    async def test_list_agents_requires_admin(self, client, agent_headers):
        resp = await client.get("/api/admin/agents", headers=agent_headers)
        assert resp.status_code == 403

    async def test_list_agents_no_auth(self, client):
        resp = await client.get("/api/admin/agents")
        assert resp.status_code == 401


@pytest.mark.asyncio
class TestAgentScorePreview:
    async def test_agent_score_preview_requires_admin(self, client, agent_headers):
        resp = await client.get("/api/admin/agent-score-preview", headers=agent_headers)
        assert resp.status_code == 403

    async def test_agent_score_preview_requires_page_permission(self, client, normal_admin_headers):
        resp = await client.get("/api/admin/agent-score-preview", headers=normal_admin_headers)
        assert resp.status_code == 403

    async def test_agent_score_preview_allows_normal_admin_with_page_permission(
        self, client, db, normal_admin_user, normal_admin_headers
    ):
        normal_admin_user.page_permissions = "score_preview"
        await db.commit()

        resp = await client.get("/api/admin/agent-score-preview", headers=normal_admin_headers)

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_agent_score_preview_returns_workflow_score(
        self, client, admin_headers, db, agent_user
    ):
        now = utcnow()
        today = today_cst_as_utc()
        students = [
            Student(
                name="逾期未联系",
                assigned_to=agent_user.id,
                status=StudentStatus.not_contacted,
                intent_level=IntentLevel.none,
                assigned_at=now - timedelta(days=5),
            ),
            Student(
                name="已推进A",
                assigned_to=agent_user.id,
                status=StudentStatus.very_interested,
                intent_level=IntentLevel.A,
                guardian_phone="13800138000",
                assigned_at=now,
            ),
            Student(
                name="待加微",
                assigned_to=agent_user.id,
                status=StudentStatus.interested_add_wechat,
                intent_level=IntentLevel.B,
                guardian_phone="13800138001",
                assigned_at=now,
            ),
            Student(
                name="已报名A",
                assigned_to=agent_user.id,
                status=StudentStatus.enrolled,
                intent_level=IntentLevel.A,
                guardian_phone="13800138002",
                assigned_at=now - timedelta(days=2),
            ),
        ]
        db.add_all(students)
        await db.flush()
        db.add_all(
            [
                DialLog(
                    student_id=students[0].id,
                    agent_id=agent_user.id,
                    dialed_at=today + timedelta(hours=1),
                    duration_seconds=0,
                ),
                DialLog(
                    student_id=students[1].id,
                    agent_id=agent_user.id,
                    dialed_at=today + timedelta(hours=2),
                    duration_seconds=30,
                ),
                DialLog(
                    student_id=students[2].id,
                    agent_id=agent_user.id,
                    dialed_at=today + timedelta(hours=3),
                    duration_seconds=90,
                ),
                FollowUp(
                    student_id=students[2].id,
                    agent_id=agent_user.id,
                    follow_up_date=now - timedelta(hours=1),
                    is_completed=False,
                ),
                Note(
                    student_id=students[1].id,
                    agent_id=agent_user.id,
                    content="家长有意向，等待二次沟通",
                    created_at=today + timedelta(hours=4),
                ),
            ]
        )
        await db.commit()

        resp = await client.get(
            "/api/admin/agent-score-preview",
            params={"daily_call_target": 10},
            headers=admin_headers,
        )
        body = resp.json()

        assert body["code"] == 0
        assert body["data"]["daily_call_target"] == 10
        item = body["data"]["items"][0]
        assert item["agent"]["id"] == agent_user.id
        assert item["metrics"]["active_tasks"] == 3
        assert item["metrics"]["pending_tasks"] == 1
        assert item["metrics"]["done_tasks"] == 1
        assert item["metrics"]["follow_up_tasks"] == 1
        assert item["metrics"]["today_calls"] == 3
        assert item["metrics"]["today_recorded_calls"] == 2
        assert item["metrics"]["today_unrecorded_calls"] == 1
        assert item["metrics"]["avg_recorded_duration_seconds"] == 60
        assert item["metrics"]["open_follow_ups"] == 1
        assert item["metrics"]["overdue_follow_ups"] == 1
        assert item["metrics"]["missing_phone_tasks"] == 1
        assert item["metrics"]["a_level_count"] == 2
        assert item["metrics"]["enrolled_count"] == 1
        assert item["metrics"]["notes_today"] == 1
        assert item["score"] < 55
        assert item["level"] == "risk"
        assert item["components"]["task_progress"]["max"] == 30.0
        assert item["components"]["task_progress"]["detail"] == "推进率 66.7%，待联系 1/3"
        assert item["components"]["task_progress"]["parts"] == [
            {"label": "推进覆盖", "score": 13.3, "max": 20.0},
            {"label": "待联系清理", "score": 6.7, "max": 10.0},
        ]
        assert item["components"]["call_activity"]["detail"] == "3/10 通"
        signal_keys = {signal["key"] for signal in item["signals"]}
        assert "overdue_follow_ups" in signal_keys
        assert "missing_phone_tasks" in signal_keys
        assert "unrecorded_call_duration" in signal_keys
        assert item["recommended_action"] == "先处理逾期回访，防止高意向线索流失"

    async def test_agent_score_preview_excludes_disabled_agents(
        self, client, admin_headers, db, agent_user
    ):
        disabled = User(
            username="disabled-agent",
            hashed_password="x",
            role="agent",
            name="已禁用话务员",
            is_active=False,
        )
        db.add(disabled)
        await db.commit()

        resp = await client.get("/api/admin/agent-score-preview", headers=admin_headers)
        body = resp.json()

        assert body["code"] == 0
        agent_ids = {item["agent"]["id"] for item in body["data"]["items"]}
        assert agent_user.id in agent_ids
        assert disabled.id not in agent_ids

    async def test_agent_score_preview_uses_configured_call_target_by_default(
        self, client, admin_headers, db
    ):
        db.add(SystemConfig(key="score_daily_call_target", value="45"))
        await db.commit()

        resp = await client.get("/api/admin/agent-score-preview", headers=admin_headers)
        body = resp.json()

        assert body["code"] == 0
        assert body["data"]["configured_daily_call_target"] == 45
        assert body["data"]["daily_call_target"] == 45

    async def test_agent_score_preview_query_target_overrides_config(
        self, client, admin_headers, db
    ):
        db.add(SystemConfig(key="score_daily_call_target", value="45"))
        await db.commit()

        resp = await client.get(
            "/api/admin/agent-score-preview",
            params={"daily_call_target": 12},
            headers=admin_headers,
        )
        body = resp.json()

        assert body["code"] == 0
        assert body["data"]["configured_daily_call_target"] == 45
        assert body["data"]["daily_call_target"] == 12


@pytest.mark.asyncio
class TestAdminCreateUser:
    async def test_create_agent(self, client, admin_headers):
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "newagent",
                "password": "newpass123",
                "name": "新坐席",
                "role": "agent",
            },
            headers=admin_headers,
        )
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["username"] == "newagent"

    async def test_create_admin(self, client, admin_headers):
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "newadmin",
                "password": "adminpass",
                "name": "新管理员",
                "role": "admin",
                "page_permissions": ["score_preview", "bad_key", "report_center"],
                "operation_permissions": ["student_assign", "bad_key", "audit_export"],
            },
            headers=admin_headers,
        )
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["is_super_admin"] is False
        assert body["data"]["page_permissions"] == ["score_preview", "report_center"]
        assert body["data"]["operation_permissions"] == ["student_assign", "audit_export"]

    async def test_create_super_admin(self, client, admin_headers):
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "newsuper",
                "password": "adminpass",
                "name": "新超管",
                "role": "admin",
                "is_super_admin": True,
            },
            headers=admin_headers,
        )
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["is_super_admin"] is True
        assert body["data"]["page_permissions"] == []
        assert body["data"]["operation_permissions"] == []

    async def test_create_agent_ignores_super_admin_flag(self, client, admin_headers):
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "flaggedagent",
                "password": "newpass123",
                "name": "误传超管坐席",
                "role": "agent",
                "is_super_admin": True,
            },
            headers=admin_headers,
        )
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["is_super_admin"] is False
        assert body["data"]["page_permissions"] == []
        assert body["data"]["operation_permissions"] == []

    async def test_create_duplicate_username(self, client, admin_headers, admin_user):
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "testadmin",
                "password": "x",
                "name": "duplicate",
            },
            headers=admin_headers,
        )
        body = resp.json()
        assert body["code"] == 1  # conflict, code=1 not HTTP 400

    async def test_create_invalid_role_returns_422(self, client, admin_headers):
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "badrole",
                "password": "x",
                "name": "bad",
                "role": "manager",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 422

    async def test_create_empty_username(self, client, admin_headers):
        """Pydantic accepts empty string; server should not crash."""
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "",
                "password": "x",
                "name": "x",
            },
            headers=admin_headers,
        )
        assert resp.status_code in (200, 422)
        if resp.status_code == 200:
            assert resp.json()["code"] == 0  # empty string is a valid (though odd) username

    async def test_create_requires_admin(self, client, agent_headers):
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "shouldfail",
                "password": "x",
                "name": "fail",
            },
            headers=agent_headers,
        )
        assert resp.status_code == 403

    async def test_create_requires_super_admin(self, client, normal_admin_headers):
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "shouldfail",
                "password": "x",
                "name": "fail",
            },
            headers=normal_admin_headers,
        )
        assert resp.status_code == 403


@pytest.mark.asyncio
class TestAdminUpdateUser:
    async def test_update_user(self, client, admin_headers, agent_user):
        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={
                "name": "更新的名字",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0
        assert resp.json()["data"]["name"] == "更新的名字"

    async def test_update_admin_page_permissions(
        self, client, db, admin_headers, normal_admin_user
    ):
        resp = await client.put(
            f"/api/admin/users/{normal_admin_user.id}",
            json={
                "page_permissions": ["account_manage", "audit_logs", "invalid_key"],
            },
            headers=admin_headers,
        )
        body = resp.json()

        assert body["code"] == 0
        assert body["data"]["page_permissions"] == ["account_manage", "audit_logs"]
        await db.refresh(normal_admin_user)
        assert normal_admin_user.page_permissions == "account_manage,audit_logs"

    async def test_update_admin_operation_permissions(
        self, client, db, admin_headers, normal_admin_user
    ):
        resp = await client.put(
            f"/api/admin/users/{normal_admin_user.id}",
            json={
                "operation_permissions": ["user_unlock", "student_assign", "invalid_key"],
            },
            headers=admin_headers,
        )
        body = resp.json()

        assert body["code"] == 0
        assert body["data"]["operation_permissions"] == ["user_unlock", "student_assign"]
        await db.refresh(normal_admin_user)
        assert normal_admin_user.operation_permissions == "user_unlock,student_assign"

    async def test_update_user_rejects_status_word_as_display_name(
        self, client, db, admin_headers, agent_user
    ):
        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={"name": "离职"},
            headers=admin_headers,
        )
        body = resp.json()

        assert resp.status_code == 200
        assert body["code"] == 1
        assert "状态词" in body["msg"]
        await db.refresh(agent_user)
        assert agent_user.name != "离职"

    async def test_create_user_rejects_status_word_as_display_name(self, client, admin_headers):
        resp = await client.post(
            "/api/admin/users",
            json={
                "username": "bad-display-name",
                "password": "newpass123",
                "name": "离职",
                "role": "agent",
            },
            headers=admin_headers,
        )
        body = resp.json()

        assert resp.status_code == 200
        assert body["code"] == 1
        assert "状态词" in body["msg"]

    async def test_disable_user(self, client, admin_headers, agent_user):
        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={
                "is_active": False,
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_update_invalid_role_returns_422(self, client, admin_headers, agent_user):
        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={
                "role": "manager",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 422

    async def test_update_not_found(self, client, admin_headers):
        resp = await client.put("/api/admin/users/99999", json={"name": "x"}, headers=admin_headers)
        assert resp.json()["code"] == 1

    async def test_update_requires_super_admin(self, client, normal_admin_headers, agent_user):
        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={"name": "普通管理员不应能改"},
            headers=normal_admin_headers,
        )
        assert resp.status_code == 403

    async def test_normal_admin_with_user_edit_can_update_agent_name(
        self, client, db, normal_admin_user, normal_admin_headers, agent_user
    ):
        normal_admin_user.operation_permissions = "user_edit"
        await db.commit()

        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={"name": "普通管理员改名"},
            headers=normal_admin_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["code"] == 0
        await db.refresh(agent_user)
        assert agent_user.name == "普通管理员改名"

    async def test_user_edit_alone_cannot_update_password(
        self, client, db, normal_admin_user, normal_admin_headers, agent_user
    ):
        normal_admin_user.operation_permissions = "user_edit"
        await db.commit()

        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={"password": "new-password"},
            headers=normal_admin_headers,
        )

        assert resp.status_code == 403

    async def test_normal_admin_cannot_update_admin_even_with_user_edit(
        self, client, db, normal_admin_user, normal_admin_headers, admin_user
    ):
        normal_admin_user.operation_permissions = "user_edit"
        await db.commit()

        resp = await client.put(
            f"/api/admin/users/{admin_user.id}",
            json={"name": "越权改超管"},
            headers=normal_admin_headers,
        )

        assert resp.status_code == 403

    async def test_cannot_remove_last_super_admin(self, client, admin_headers, admin_user):
        resp = await client.put(
            f"/api/admin/users/{admin_user.id}",
            json={"is_super_admin": False},
            headers=admin_headers,
        )
        body = resp.json()
        assert body["code"] == 1
        assert "超级管理员" in body["msg"]

    async def test_cannot_disable_last_super_admin(
        self, client, admin_headers, admin_user, normal_admin_user, db
    ):
        resp = await client.put(
            f"/api/admin/users/{admin_user.id}",
            json={"is_active": False},
            headers=admin_headers,
        )
        body = resp.json()

        assert body["code"] == 1
        assert "超级管理员" in body["msg"]
        await db.refresh(admin_user)
        assert admin_user.is_active is True


@pytest.mark.asyncio
class TestAdminDeleteUser:
    async def test_delete_user(self, client, admin_headers, agent_user):
        resp = await client.delete(f"/api/admin/users/{agent_user.id}", headers=admin_headers)
        assert resp.json()["code"] == 0

    async def test_delete_user_writes_impact_counts_to_operation_log(
        self, client, db, admin_headers, agent_user
    ):
        active_student = Student(
            name="删除用户回收",
            assigned_to=agent_user.id,
            status=StudentStatus.not_contacted,
        )
        enrolled_student = Student(
            name="删除用户保留",
            assigned_to=agent_user.id,
            status=StudentStatus.enrolled,
        )
        db.add_all([active_student, enrolled_student])
        await db.commit()

        resp = await client.delete(f"/api/admin/users/{agent_user.id}", headers=admin_headers)

        assert resp.json()["code"] == 0
        log = (
            await db.execute(
                select(OperationLog).where(
                    OperationLog.action == "删除用户",
                    OperationLog.target_student_id.is_(None),
                )
            )
        ).scalar_one()
        assert "回收非终态 1 条" in log.content
        assert "保留终态 1 条" in log.content

    async def test_delete_self(self, client, admin_headers, admin_user):
        resp = await client.delete(f"/api/admin/users/{admin_user.id}", headers=admin_headers)
        assert resp.json()["code"] == 1  # cannot delete self

    async def test_delete_not_found(self, client, admin_headers):
        resp = await client.delete("/api/admin/users/99999", headers=admin_headers)
        assert resp.json()["code"] == 1

    async def test_delete_requires_super_admin(self, client, normal_admin_headers, agent_user):
        resp = await client.delete(
            f"/api/admin/users/{agent_user.id}", headers=normal_admin_headers
        )
        assert resp.status_code == 403

    async def test_normal_admin_with_user_delete_can_delete_agent(
        self, client, db, normal_admin_user, normal_admin_headers, agent_user
    ):
        normal_admin_user.operation_permissions = "user_delete"
        await db.commit()

        resp = await client.delete(
            f"/api/admin/users/{agent_user.id}", headers=normal_admin_headers
        )

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_normal_admin_cannot_delete_admin_even_with_user_delete(
        self, client, db, normal_admin_user, normal_admin_headers, admin_user
    ):
        normal_admin_user.operation_permissions = "user_delete"
        await db.commit()

        resp = await client.delete(
            f"/api/admin/users/{admin_user.id}", headers=normal_admin_headers
        )

        assert resp.status_code == 403


@pytest.mark.asyncio
class TestAdminSystemAndDeletePermissions:
    async def test_config_requires_super_admin(self, client, normal_admin_headers):
        get_resp = await client.get("/api/admin/config", headers=normal_admin_headers)
        put_resp = await client.put(
            "/api/admin/config",
            json={"key": "score_daily_call_target", "value": "30"},
            headers=normal_admin_headers,
        )

        assert get_resp.status_code == 403
        assert put_resp.status_code == 403

    async def test_delete_invalid_students_requires_super_admin(self, client, normal_admin_headers):
        resp = await client.post(
            "/api/admin/invalid-students/delete",
            json={"student_ids": [1]},
            headers=normal_admin_headers,
        )

        assert resp.status_code == 403

    async def test_delete_by_school_requires_super_admin(self, client, normal_admin_headers):
        resp = await client.post(
            "/api/admin/delete-by-school",
            json={"school_name": "测试学校"},
            headers=normal_admin_headers,
        )

        assert resp.status_code == 403

    async def test_duplicate_phone_cleanup_requires_super_admin(self, client, normal_admin_headers):
        resp = await client.post(
            "/api/admin/lead-duplicates/cleanup",
            json={"confirm": True},
            headers=normal_admin_headers,
        )

        assert resp.status_code == 403


@pytest.mark.asyncio
class TestAdminUnlockUser:
    async def test_unlock_locked_user(self, client, admin_headers, db, agent_user):
        agent_user.locked_until = datetime.utcnow() + timedelta(minutes=5)
        agent_user.failed_login_attempts = 3
        await db.commit()

        resp = await client.post(f"/api/admin/users/{agent_user.id}/unlock", headers=admin_headers)
        assert resp.json()["code"] == 0

        await db.refresh(agent_user)
        assert agent_user.failed_login_attempts == 0
        assert agent_user.locked_until is None

    async def test_unlock_not_locked(self, client, admin_headers, agent_user):
        resp = await client.post(f"/api/admin/users/{agent_user.id}/unlock", headers=admin_headers)
        assert resp.json()["code"] == 0

    async def test_unlock_requires_admin(self, client, agent_headers, agent_user):
        resp = await client.post(f"/api/admin/users/{agent_user.id}/unlock", headers=agent_headers)
        assert resp.status_code == 403

    async def test_unlock_requires_super_admin(self, client, normal_admin_headers, agent_user):
        resp = await client.post(
            f"/api/admin/users/{agent_user.id}/unlock", headers=normal_admin_headers
        )
        assert resp.status_code == 403

    async def test_normal_admin_with_unlock_permission_can_unlock_agent(
        self, client, db, normal_admin_user, normal_admin_headers, agent_user
    ):
        normal_admin_user.operation_permissions = "user_unlock"
        agent_user.locked_until = datetime.utcnow() + timedelta(minutes=5)
        agent_user.failed_login_attempts = 3
        await db.commit()

        resp = await client.post(
            f"/api/admin/users/{agent_user.id}/unlock", headers=normal_admin_headers
        )

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_normal_admin_cannot_unlock_admin_even_with_permission(
        self, client, db, normal_admin_user, normal_admin_headers, admin_user
    ):
        normal_admin_user.operation_permissions = "user_unlock"
        admin_user.locked_until = datetime.utcnow() + timedelta(minutes=5)
        await db.commit()

        resp = await client.post(
            f"/api/admin/users/{admin_user.id}/unlock", headers=normal_admin_headers
        )

        assert resp.status_code == 403


@pytest.mark.asyncio
class TestAdminResetPassword:
    async def test_reset_password(self, client, admin_headers, agent_user):
        resp = await client.post(
            f"/api/admin/users/{agent_user.id}/reset-password",
            json={},
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0
        assert "new_password" in resp.json()["data"]

    async def test_reset_not_found(self, client, admin_headers):
        resp = await client.post(
            "/api/admin/users/99999/reset-password",
            json={},
            headers=admin_headers,
        )
        assert resp.json()["code"] == 1

    async def test_reset_requires_admin(self, client, agent_headers, agent_user):
        resp = await client.post(
            f"/api/admin/users/{agent_user.id}/reset-password",
            json={},
            headers=agent_headers,
        )
        assert resp.status_code == 403

    async def test_reset_requires_super_admin(self, client, normal_admin_headers, agent_user):
        resp = await client.post(
            f"/api/admin/users/{agent_user.id}/reset-password",
            json={},
            headers=normal_admin_headers,
        )
        assert resp.status_code == 403

    async def test_normal_admin_with_reset_permission_can_reset_agent(
        self, client, db, normal_admin_user, normal_admin_headers, agent_user
    ):
        normal_admin_user.operation_permissions = "user_reset_password"
        await db.commit()

        resp = await client.post(
            f"/api/admin/users/{agent_user.id}/reset-password",
            json={},
            headers=normal_admin_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_normal_admin_cannot_reset_admin_even_with_permission(
        self, client, db, normal_admin_user, normal_admin_headers, admin_user
    ):
        normal_admin_user.operation_permissions = "user_reset_password"
        await db.commit()

        resp = await client.post(
            f"/api/admin/users/{admin_user.id}/reset-password",
            json={},
            headers=normal_admin_headers,
        )

        assert resp.status_code == 403


@pytest.mark.asyncio
class TestAdminStaleReassignPermissions:
    async def test_stale_reassign_requires_student_assign_operation(
        self, client, db, normal_admin_user, normal_admin_headers, agent_user
    ):
        student = Student(
            name="残留改派学生",
            assigned_to=agent_user.id,
            status=StudentStatus.not_contacted,
        )
        normal_admin_user.page_permissions = "account_manage"
        db.add(student)
        await db.commit()
        await db.refresh(student)

        resp = await client.post(
            "/api/admin/stale-reassign",
            json={"student_ids": [student.id], "mode": "recycle"},
            headers=normal_admin_headers,
        )
        assert resp.status_code == 403

        normal_admin_user.operation_permissions = "student_assign"
        await db.commit()

        resp = await client.post(
            "/api/admin/stale-reassign",
            json={"student_ids": [student.id], "mode": "recycle"},
            headers=normal_admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["code"] == 0


@pytest.mark.asyncio
class TestHealthEndpoint:
    async def test_health(self, client):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["code"] == 0
        assert resp.json()["msg"] == "ok"


@pytest.mark.asyncio
class TestAdminOpsHealth:
    async def test_ops_health_returns_dashboard_summary(
        self, client, admin_headers, db, agent_user, tmp_path, monkeypatch
    ):
        from app.routers import admin as admin_router

        backup_dir = tmp_path / "backups"
        backup_dir.mkdir()
        backup_file = backup_dir / "crm_20260627_101010.db"
        backup_file.write_bytes(b"backup")
        monkeypatch.setattr(admin_router, "BACKUP_DIR", str(backup_dir))

        now = utcnow()
        db.add_all(
            [
                Student(name="未分配线索", status=StudentStatus.not_contacted),
                Student(
                    name="已分配线索",
                    assigned_to=agent_user.id,
                    status=StudentStatus.not_contacted,
                ),
                FollowUp(
                    student_id=1,
                    agent_id=agent_user.id,
                    follow_up_date=now - timedelta(hours=1),
                    is_completed=False,
                ),
                OperationLog(
                    operator_id=agent_user.id,
                    operator_name=agent_user.name,
                    action="通知失败",
                    content="测试通知失败",
                    created_at=now - timedelta(days=1),
                ),
                OperationLog(
                    operator_id=None,
                    operator_name="前端",
                    action="前端错误",
                    content="测试前端错误",
                    created_at=now - timedelta(hours=1),
                ),
            ]
        )
        await db.commit()

        resp = await client.get("/api/admin/ops-health", headers=admin_headers)
        body = resp.json()

        assert resp.status_code == 200
        assert body["code"] == 0
        data = body["data"]
        assert data["database"]["status"] == "ok"
        assert data["backups"]["count"] == 1
        assert data["backups"]["latest"]["name"] == "crm_20260627_101010.db"
        assert data["business"]["total_students"] == 2
        assert data["business"]["active_agents"] == 1
        assert data["business"]["unassigned_active"] == 1
        assert data["business"]["open_follow_ups"] == 1
        assert data["business"]["overdue_follow_ups"] == 1
        assert data["business"]["notification_failures_7d"] == 1
        assert data["business"]["frontend_errors_24h"] == 1

    async def test_ops_health_handles_missing_backup_dir(
        self, client, admin_headers, tmp_path, monkeypatch
    ):
        from app.routers import admin as admin_router

        monkeypatch.setattr(admin_router, "BACKUP_DIR", str(tmp_path / "missing"))

        resp = await client.get("/api/admin/ops-health", headers=admin_headers)
        body = resp.json()

        assert resp.status_code == 200
        assert body["code"] == 0
        backups = body["data"]["backups"]
        assert backups["status"] == "warning"
        assert backups["exists"] is False
        assert backups["count"] == 0
        assert backups["latest"] is None

    async def test_ops_health_requires_admin(self, client, agent_headers):
        resp = await client.get("/api/admin/ops-health", headers=agent_headers)
        assert resp.status_code == 403

    async def test_error_report_requires_login(self, client):
        resp = await client.post(
            "/api/admin/error-report",
            json={"type": "runtime", "message": "未登录错误"},
        )

        assert resp.status_code == 401

    async def test_error_report_records_authenticated_user(
        self, client, db, admin_user, admin_headers
    ):
        from sqlalchemy import select

        from app.models import OperationLog

        resp = await client.post(
            "/api/admin/error-report",
            json={"type": "runtime", "message": "已登录错误"},
            headers=admin_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["code"] == 0
        log = (
            await db.execute(select(OperationLog).where(OperationLog.action == "前端错误"))
        ).scalar_one()
        assert log.operator_id == admin_user.id
        assert log.operator_name == admin_user.name
        assert "已登录错误" in log.content


@pytest.mark.asyncio
class TestAdminDataQuality:
    async def test_data_quality_returns_call_and_student_quality_summary(
        self, client, admin_headers, db, agent_user
    ):
        now = utcnow()
        today = today_cst_as_utc()
        missing_phone = Student(
            name="无电话数据",
            assigned_to=agent_user.id,
            status=StudentStatus.not_contacted,
            guardian_phone="",
            guardian2_phone="",
        )
        invalid_student = Student(
            name="无效原因学生",
            assigned_to=agent_user.id,
            status=StudentStatus.invalid,
            status_detail="空号",
        )
        unassigned = Student(name="未分配任务", status=StudentStatus.not_contacted)
        db.add_all([missing_phone, invalid_student, unassigned])
        await db.flush()
        db.add_all(
            [
                DialLog(
                    student_id=missing_phone.id,
                    agent_id=agent_user.id,
                    dialed_at=today + timedelta(hours=1),
                    duration_seconds=0,
                ),
                DialLog(
                    student_id=invalid_student.id,
                    agent_id=agent_user.id,
                    dialed_at=today + timedelta(hours=2),
                    duration_seconds=80,
                ),
                FollowUp(
                    student_id=missing_phone.id,
                    agent_id=agent_user.id,
                    follow_up_date=now - timedelta(hours=1),
                    is_completed=False,
                ),
            ]
        )
        await db.commit()

        resp = await client.get("/api/admin/data-quality", headers=admin_headers)
        body = resp.json()

        assert resp.status_code == 200
        assert body["code"] == 0
        data = body["data"]
        assert data["status"] == "warning"
        assert data["calls"]["today"]["total_calls"] == 2
        assert data["calls"]["today"]["recorded_calls"] == 1
        assert data["calls"]["today"]["unrecorded_calls"] == 1
        assert data["calls"]["month"]["unrecorded_ratio"] == 50
        assert data["calls"]["agents"][0]["agent_name"] == agent_user.name
        assert data["calls"]["agents"][0]["unrecorded_calls"] == 1
        assert data["students"]["missing_phone_tasks"] >= 1
        assert data["students"]["unassigned_active"] >= 1
        assert {"reason": "空号", "count": 1} in data["students"]["invalid_reasons"]
        assert data["follow_ups"]["overdue_follow_ups"] == 1

    async def test_data_quality_requires_admin(self, client, agent_headers):
        resp = await client.get("/api/admin/data-quality", headers=agent_headers)
        assert resp.status_code == 403


@pytest.mark.asyncio
class TestLeadGovernanceRisk:
    async def test_data_health_center_returns_seven_reviewable_signals(
        self, client, db, admin_headers, admin_user, agent_user
    ):
        now = utcnow()
        stale_assigned_at = now - timedelta(days=5)
        recent_assigned_at = now - timedelta(hours=2)
        db.add_all(
            [
                Student(
                    name="重复手机号甲",
                    school_name="长泰二中",
                    guardian_phone="13800139001",
                    status=StudentStatus.not_contacted,
                ),
                Student(
                    name="重复手机号乙",
                    school_name="长泰一中",
                    guardian_phone="13800139001",
                    status=StudentStatus.not_contacted,
                ),
                Student(
                    name="同名同校学生",
                    school_name="长泰二中",
                    guardian_phone="13800139002",
                    status=StudentStatus.not_contacted,
                ),
                Student(
                    name="同名同校学生",
                    school_name="长泰二中",
                    guardian2_phone="13800139002",
                    status=StudentStatus.not_contacted,
                ),
                Student(
                    name="无手机号健康项",
                    assigned_to=agent_user.id,
                    status=StudentStatus.not_contacted,
                    guardian_phone="",
                    guardian2_phone="",
                ),
                Student(
                    name="长期未跟进A",
                    assigned_to=agent_user.id,
                    assigned_at=stale_assigned_at,
                    status=StudentStatus.not_contacted,
                    intent_level=IntentLevel.A,
                ),
                Student(
                    name="分配后无通话",
                    assigned_to=agent_user.id,
                    assigned_at=recent_assigned_at,
                    status=StudentStatus.not_contacted,
                ),
            ]
        )
        await db.flush()
        db.add_all(
            [
                OperationLog(
                    operator_id=admin_user.id,
                    operator_name=admin_user.name,
                    action="修改状态",
                    old_status="未联系",
                    new_status="已报名",
                    content="状态 未联系 → 已报名",
                    created_at=now,
                ),
                OperationLog(
                    operator_id=admin_user.id,
                    operator_name=admin_user.name,
                    action="修改状态",
                    old_status="未联系",
                    new_status="已联系",
                    content="状态 未联系 → 已联系",
                    created_at=now.replace(hour=3, minute=20, second=0, microsecond=0),
                ),
            ]
        )
        await db.commit()

        resp = await client.get("/api/admin/data-health", headers=admin_headers)
        body = resp.json()
        data = body["data"]
        signals = {item["key"]: item for item in data["signals"]}

        assert resp.status_code == 200
        assert body["code"] == 0
        assert data["status"] == "warning"
        assert data["total_issue_count"] >= 8
        assert set(signals) == {
            "duplicate_phone",
            "same_name_school_phone",
            "missing_phone",
            "enrolled_status_change",
            "stale_a",
            "assigned_no_call",
            "off_hours_status_change",
        }
        assert signals["duplicate_phone"]["count"] >= 2
        assert signals["duplicate_phone"]["to"] == "/admin/governance?section=duplicates"
        assert signals["same_name_school_phone"]["count"] >= 1
        assert signals["missing_phone"]["to"] == "/admin/leads?active=1&missing_phone=1"
        assert signals["enrolled_status_change"]["to"] == (
            "/admin/audit-logs?action=%E4%BF%AE%E6%94%B9%E7%8A%B6%E6%80%81&q=%E5%B7%B2%E6%8A%A5%E5%90%8D"
        )
        assert signals["stale_a"]["count"] >= 1
        assert signals["assigned_no_call"]["count"] >= 1
        assert signals["off_hours_status_change"]["count"] >= 1
        assert signals["off_hours_status_change"]["severity"] == "high"

    async def test_lead_duplicates_ignores_same_name_school_with_different_phones(
        self, client, db, admin_headers
    ):
        students = [
            Student(
                name="重复学生甲",
                school_name="长泰二中",
                guardian_phone="13800138000",
                status=StudentStatus.not_contacted,
            ),
            Student(
                name="重复学生乙",
                school_name="长泰一中",
                guardian_phone="13800138000",
                status=StudentStatus.not_contacted,
            ),
            Student(
                name="同名学生",
                school_name="长泰二中",
                guardian_phone="13800138001",
                status=StudentStatus.not_contacted,
            ),
            Student(
                name="同名学生",
                school_name="长泰二中",
                guardian_phone="13800138002",
                status=StudentStatus.not_contacted,
            ),
        ]
        db.add_all(students)
        await db.commit()

        resp = await client.get("/api/admin/lead-duplicates", headers=admin_headers)
        body = resp.json()
        data = body["data"]

        assert resp.status_code == 200
        assert body["code"] == 0
        assert data["total_groups"] == 1
        groups = {(group["type"], group["key"]): group for group in data["groups"]}
        assert ("手机号重复", "13800138000") in groups
        assert groups[("手机号重复", "13800138000")]["count"] == 2
        assert groups[("手机号重复", "13800138000")]["search_q"] == "13800138000"
        assert groups[("手机号重复", "13800138000")]["students"][0]["id"]

    async def test_lead_duplicates_groups_same_name_school_only_when_phone_matches(
        self, client, db, admin_headers
    ):
        students = [
            Student(
                name="同号同名学生",
                school_name="长泰二中",
                guardian_phone="13800138003",
                status=StudentStatus.not_contacted,
            ),
            Student(
                name="同号同名学生",
                school_name="长泰二中",
                guardian2_phone="13800138003",
                status=StudentStatus.not_contacted,
            ),
        ]
        db.add_all(students)
        await db.commit()

        resp = await client.get("/api/admin/lead-duplicates", headers=admin_headers)
        body = resp.json()
        data = body["data"]
        groups = {(group["type"], group["key"]): group for group in data["groups"]}

        assert resp.status_code == 200
        assert body["code"] == 0
        key = "同号同名学生｜长泰二中｜13800138003"
        assert ("手机号重复", "13800138003") in groups
        assert ("同名同校同手机号", key) in groups
        assert groups[("同名同校同手机号", key)]["count"] == 2
        assert groups[("同名同校同手机号", key)]["search_q"] == "13800138003"

    async def test_duplicate_phone_cleanup_preview_does_not_modify_data(
        self, client, db, admin_headers
    ):
        students = [
            Student(
                name="预览清号保留",
                school_name="长泰二中",
                guardian_phone="13800138004",
                guardian2_phone="13900139004",
                status=StudentStatus.not_contacted,
            ),
            Student(
                name="预览清完删除",
                school_name="长泰一中",
                guardian_phone="13800138004",
                status=StudentStatus.not_contacted,
            ),
        ]
        db.add_all(students)
        await db.commit()

        resp = await client.get("/api/admin/lead-duplicates/cleanup-preview", headers=admin_headers)
        body = resp.json()
        data = body["data"]

        assert resp.status_code == 200
        assert body["code"] == 0
        assert data["duplicate_phone_count"] == 1
        assert data["affected_student_count"] == 2
        assert data["will_clear_count"] == 1
        assert data["will_delete_count"] == 1
        assert data["preview_clear_students"][0]["name"] == "预览清号保留"
        assert data["preview_delete_students"][0]["name"] == "预览清完删除"
        refreshed = (
            await db.execute(select(Student).where(Student.name == "预览清完删除"))
        ).scalar_one()
        assert refreshed.guardian_phone == "13800138004"

    async def test_duplicate_phone_cleanup_executes_with_batch_logs(
        self, client, db, admin_headers
    ):
        keep_student = Student(
            name="批次清号保留",
            school_name="长泰二中",
            guardian_phone="13800138005",
            guardian2_phone="13900139005",
            status=StudentStatus.not_contacted,
        )
        delete_student = Student(
            name="批次清完删除",
            school_name="长泰一中",
            guardian_phone="13800138005",
            status=StudentStatus.not_contacted,
        )
        db.add_all([keep_student, delete_student])
        await db.commit()
        keep_id = keep_student.id
        delete_id = delete_student.id

        resp = await client.post(
            "/api/admin/lead-duplicates/cleanup",
            json={"confirm": True},
            headers=admin_headers,
        )
        body = resp.json()
        data = body["data"]

        assert resp.status_code == 200
        assert body["code"] == 0
        assert data["changed"] is True
        assert data["cleared_count"] == 1
        assert data["deleted_count"] == 1
        assert data["batch_id"].startswith("phone-dedupe-")

        kept = (
            await db.execute(
                select(Student)
                .where(Student.id == keep_id)
                .execution_options(populate_existing=True)
            )
        ).scalar_one()
        deleted = (
            await db.execute(select(Student).where(Student.id == delete_id))
        ).scalar_one_or_none()
        assert kept.guardian_phone == ""
        assert kept.guardian2_phone == "13900139005"
        assert deleted is None

        logs = (
            (
                await db.execute(
                    select(OperationLog)
                    .where(OperationLog.batch_id == data["batch_id"])
                    .order_by(OperationLog.id.asc())
                )
            )
            .scalars()
            .all()
        )
        assert len(logs) == 3
        assert [log.action for log in logs].count("数据清理") == 2
        assert logs[-1].action == "数据清理汇总"
        assert "清理重复手机号 1 个" in logs[-1].content

        verify_resp = await client.get("/api/admin/lead-duplicates", headers=admin_headers)
        assert verify_resp.json()["data"]["total_groups"] == 0

    async def test_duplicate_phone_cleanup_requires_confirmation(self, client, admin_headers):
        resp = await client.post(
            "/api/admin/lead-duplicates/cleanup",
            json={"confirm": False},
            headers=admin_headers,
        )
        body = resp.json()
        assert resp.status_code == 200
        assert body["code"] == 1

    async def test_governance_review_writes_audit_log_and_suppresses_reviewed_signal(
        self, client, db, admin_headers, admin_user
    ):
        db.add_all(
            [
                Student(
                    name="复核重复甲",
                    school_name="长泰二中",
                    guardian_phone="13800139101",
                    status=StudentStatus.not_contacted,
                ),
                Student(
                    name="复核重复乙",
                    school_name="长泰一中",
                    guardian_phone="13800139101",
                    status=StudentStatus.not_contacted,
                ),
            ]
        )
        await db.commit()

        review_resp = await client.post(
            "/api/admin/governance-reviews",
            json={
                "key": "duplicate_phone",
                "title": "重复手机号",
                "detail": "已人工确认本批重复手机号",
                "count": 2,
            },
            headers=admin_headers,
        )
        review_body = review_resp.json()

        assert review_resp.status_code == 200
        assert review_body["code"] == 0
        log = (
            await db.execute(
                select(OperationLog).where(
                    OperationLog.action == "治理复核",
                    OperationLog.batch_id == "governance-review:duplicate_phone",
                )
            )
        ).scalar_one()
        assert log.operator_id == admin_user.id
        assert log.old_status == "2"
        assert log.new_status == "已复核"
        assert "重复手机号" in log.content

        health_resp = await client.get("/api/admin/data-health", headers=admin_headers)
        signals = {item["key"]: item for item in health_resp.json()["data"]["signals"]}
        assert signals["duplicate_phone"]["reviewed"] is True
        assert signals["duplicate_phone"]["count"] == 0

    async def test_risk_alerts_returns_recent_high_risk_operations(
        self, client, db, admin_headers, admin_user
    ):
        now = utcnow()
        db.add_all(
            [
                OperationLog(
                    operator_id=admin_user.id,
                    operator_name=admin_user.name,
                    action="删除线索",
                    content="删除学生 张三",
                    created_at=now,
                ),
                OperationLog(
                    operator_id=admin_user.id,
                    operator_name=admin_user.name,
                    action="多学校分发汇总",
                    content="多学校分发，共 12 名",
                    created_at=now,
                ),
                OperationLog(
                    operator_id=admin_user.id,
                    operator_name=admin_user.name,
                    action="修改状态",
                    content="状态 已报名 → 未联系",
                    old_status="已报名",
                    new_status="未联系",
                    created_at=now,
                ),
            ]
        )
        await db.commit()

        resp = await client.get("/api/admin/risk-alerts", headers=admin_headers)
        body = resp.json()
        alerts = body["data"]["alerts"]

        assert resp.status_code == 200
        assert body["code"] == 0
        alert_types = {alert["type"]: alert for alert in alerts}
        assert alert_types["delete_leads"]["severity"] == "high"
        assert alert_types["batch_distribution"]["count"] == 1
        assert alert_types["enrolled_status_change"]["severity"] == "high"
        assert alert_types["enrolled_status_change"]["q"] == "已报名"

    async def test_risk_alerts_include_admissions_workflow_exceptions(
        self, client, db, admin_headers, admin_user, agent_user
    ):
        now = utcnow()
        stale_student = Student(
            name="超时 A 级",
            region="芗城",
            school_name="漳州一中",
            assigned_to=agent_user.id,
            assigned_at=now - timedelta(days=4),
            created_at=now - timedelta(days=5),
            status=StudentStatus.not_contacted,
            intent_level=IntentLevel.A,
            stage=StudentStage.interested,
        )
        home_student = Student(
            name="待家访",
            region="龙海",
            school_name="龙海一中",
            assigned_to=agent_user.id,
            status=StudentStatus.pending_visit,
            intent_level=IntentLevel.A,
            stage=StudentStage.home_visit_pending,
        )
        campus_student = Student(
            name="待到校",
            region="漳浦",
            school_name="漳浦一中",
            assigned_to=agent_user.id,
            status=StudentStatus.pending_visit,
            intent_level=IntentLevel.A,
            stage=StudentStage.campus_visit_scheduled,
        )
        enrolled_student = Student(
            name="未结算报名",
            region="长泰",
            school_name="长泰二中",
            assigned_to=agent_user.id,
            status=StudentStatus.enrolled,
            intent_level=IntentLevel.A,
            stage=StudentStage.enrolled,
        )
        db.add_all([stale_student, home_student, campus_student, enrolled_student])
        await db.flush()
        db.add_all(
            [
                HomeVisitTask(
                    student_id=home_student.id,
                    creator_agent_id=agent_user.id,
                    status=HomeVisitStatus.pending,
                    student_name_snapshot=home_student.name,
                    region_snapshot=home_student.region,
                    school_name_snapshot=home_student.school_name,
                ),
                CampusVisitTask(
                    student_id=campus_student.id,
                    creator_user_id=agent_user.id,
                    status=CampusVisitStatus.scheduled,
                    appointment_at=now - timedelta(hours=2),
                    student_name_snapshot=campus_student.name,
                    region_snapshot=campus_student.region,
                    school_name_snapshot=campus_student.school_name,
                ),
                EnrollmentRecord(
                    student_id=enrolled_student.id,
                    attributed_agent_id=agent_user.id,
                    confirmed_by_admin_id=admin_user.id,
                    student_name_snapshot=enrolled_student.name,
                    region_snapshot=enrolled_student.region,
                    school_name_snapshot=enrolled_student.school_name,
                    settlement_status=SettlementStatus.unsettled,
                ),
            ]
        )
        await db.commit()

        resp = await client.get("/api/admin/risk-alerts", headers=admin_headers)
        alert_types = {alert["type"]: alert for alert in resp.json()["data"]["alerts"]}

        assert alert_types["stale_a_students"]["to"] == "/admin/work-center?queue=stale-a"
        assert alert_types["home_visit_pending"]["to"] == "/admin/work-center?queue=home_visit"
        assert alert_types["campus_visit_pending"]["to"] == "/admin/work-center?queue=campus_visit"
        assert alert_types["unsettled_enrollments"]["to"] == "/admin/enrollment-settlement"

    async def test_governance_review_suppresses_risk_alerts_until_count_increases(
        self, client, db, admin_headers, admin_user
    ):
        now = utcnow()
        db.add_all(
            [
                OperationLog(
                    operator_id=admin_user.id,
                    operator_name=admin_user.name,
                    action="删除线索",
                    content="删除学生 张三",
                    created_at=now,
                ),
                OperationLog(
                    operator_id=admin_user.id,
                    operator_name=admin_user.name,
                    action="治理复核",
                    content="确认复核 近期存在删除操作",
                    old_status="1",
                    new_status="已复核",
                    batch_id="governance-review:delete_leads",
                    created_at=now,
                ),
            ]
        )
        await db.commit()

        resp = await client.get("/api/admin/risk-alerts", headers=admin_headers)
        alert_types = {alert["type"] for alert in resp.json()["data"]["alerts"]}
        assert "delete_leads" not in alert_types


@pytest.mark.asyncio
class TestDailyOps:
    async def test_daily_ops_summarizes_and_records_review(
        self, client, db, admin_headers, admin_user, agent_user
    ):
        now = utcnow()
        student = Student(
            name="闭环家访学生",
            region="芗城",
            school_name="漳州一中",
            assigned_to=agent_user.id,
            assigned_at=now - timedelta(days=4),
            created_at=now - timedelta(days=5),
            status=StudentStatus.not_contacted,
            intent_level=IntentLevel.A,
            stage=StudentStage.home_visit_pending,
            need_help=True,
        )
        campus_student = Student(
            name="闭环到校学生",
            region="龙海",
            school_name="龙海一中",
            assigned_to=agent_user.id,
            status=StudentStatus.pending_visit,
            intent_level=IntentLevel.B,
            stage=StudentStage.campus_visit_scheduled,
        )
        enrolled_student = Student(
            name="闭环报名学生",
            region="长泰",
            school_name="长泰二中",
            assigned_to=agent_user.id,
            status=StudentStatus.enrolled,
            intent_level=IntentLevel.A,
            stage=StudentStage.enrolled,
        )
        db.add_all([student, campus_student, enrolled_student])
        await db.flush()
        db.add_all(
            [
                HomeVisitTask(
                    student_id=student.id,
                    creator_agent_id=agent_user.id,
                    status=HomeVisitStatus.pending,
                    requested_visit_time=now - timedelta(hours=1),
                    student_name_snapshot=student.name,
                    region_snapshot=student.region,
                    school_name_snapshot=student.school_name,
                ),
                CampusVisitTask(
                    student_id=campus_student.id,
                    creator_user_id=agent_user.id,
                    status=CampusVisitStatus.scheduled,
                    appointment_at=now - timedelta(hours=2),
                    student_name_snapshot=campus_student.name,
                    region_snapshot=campus_student.region,
                    school_name_snapshot=campus_student.school_name,
                ),
                EnrollmentRecord(
                    student_id=enrolled_student.id,
                    attributed_agent_id=agent_user.id,
                    confirmed_by_admin_id=admin_user.id,
                    student_name_snapshot=enrolled_student.name,
                    region_snapshot=enrolled_student.region,
                    school_name_snapshot=enrolled_student.school_name,
                    settlement_status=SettlementStatus.unsettled,
                ),
            ]
        )
        await db.commit()

        resp = await client.get("/api/admin/daily-ops", headers=admin_headers)
        data = resp.json()["data"]
        items = {item["key"]: item for item in data["items"]}

        assert resp.status_code == 200
        assert data["summary"]["pending_items"] >= 4
        assert items["stale_a"]["count"] >= 1
        assert items["home_visit_due"]["count"] >= 1
        assert items["home_visit_due"]["owners"][0]["agent_name"] == agent_user.name
        assert items["home_visit_due"]["owners"][0]["count"] >= 1
        assert items["home_visit_due"]["owners"][0]["max_age_days"] >= 0
        assert items["campus_visit_due"]["count"] >= 1
        assert items["unsettled_enrollments"]["count"] >= 1
        assert items["help_requests"]["count"] >= 1

        review_resp = await client.post(
            "/api/admin/daily-ops/reviews",
            json={
                "key": "home_visit_due",
                "status": "已处理",
                "count": items["home_visit_due"]["count"],
            },
            headers=admin_headers,
        )
        assert review_resp.status_code == 200
        assert review_resp.json()["data"]["status"] == "已处理"

        follow_resp = await client.get("/api/admin/daily-ops", headers=admin_headers)
        follow_items = {item["key"]: item for item in follow_resp.json()["data"]["items"]}
        assert follow_items["home_visit_due"]["status"] == "已处理"
        assert follow_items["home_visit_due"]["is_closed"] is True

        log = (
            await db.execute(
                select(OperationLog).where(
                    OperationLog.action == "每日运营闭环",
                    OperationLog.batch_id.like("daily-ops:%:home_visit_due"),
                )
            )
        ).scalar_one()
        assert log.operator_id == admin_user.id
        assert log.new_status == "已处理"

    async def test_daily_ops_rejects_invalid_review_status(self, client, admin_headers):
        resp = await client.post(
            "/api/admin/daily-ops/reviews",
            json={"key": "stale_a", "status": "未知状态", "count": 1},
            headers=admin_headers,
        )
        body = resp.json()
        assert resp.status_code == 200
        assert body["code"] == 1


@pytest.mark.asyncio
class TestUnassignedSchoolGroups:
    async def test_unassigned_school_groups_include_region(
        self, client, admin_headers, db, admin_user
    ):
        db.add_all(
            [
                Student(
                    name="龙海未分配",
                    region="龙海区",
                    school_name="龙海一中",
                    status=StudentStatus.not_contacted,
                    assigned_to=None,
                ),
                Student(
                    name="漳浦未分配",
                    region="漳浦县",
                    school_name="漳浦一中",
                    status=StudentStatus.not_contacted,
                    assigned_to=None,
                ),
                Student(
                    name="已分配不统计",
                    region="龙海区",
                    school_name="龙海一中",
                    status=StudentStatus.not_contacted,
                    assigned_to=admin_user.id,
                ),
            ]
        )
        await db.commit()

        resp = await client.get("/api/admin/unassigned-school-groups", headers=admin_headers)
        body = resp.json()

        assert resp.status_code == 200
        assert body["code"] == 0
        groups = body["data"]["groups"]
        assert {"name": "龙海一中", "region": "龙海区", "count": 1} in groups
        assert {"name": "漳浦一中", "region": "漳浦县", "count": 1} in groups
        assert body["data"]["total"] == 2


@pytest.mark.asyncio
class TestAssignmentRollback:
    async def test_super_admin_can_preview_and_rollback_school_assignment_batch(
        self, client, db, admin_headers, agent_user
    ):
        student = Student(name="可回滚分配", school_name="回滚学校")
        db.add(student)
        await db.commit()

        assign_resp = await client.post(
            "/api/students/school-assign",
            json={"school_name": "回滚学校", "agent_ids": [agent_user.id]},
            headers=admin_headers,
        )
        assign_data = assign_resp.json()["data"]
        batch_id = assign_data["batch_id"]

        await db.refresh(student)
        assert student.assigned_to == agent_user.id

        preview_resp = await client.get(
            f"/api/admin/assignment-rollbacks/{batch_id}",
            headers=admin_headers,
        )
        preview = preview_resp.json()["data"]
        assert preview["batch_id"] == batch_id
        assert preview["rollbackable_count"] == 1
        assert preview["skipped_count"] == 0
        assert preview["items"][0]["student_name"] == "可回滚分配"
        assert preview["items"][0]["old_assigned_to"] is None
        assert preview["items"][0]["new_assigned_to"] == agent_user.id

        rollback_resp = await client.post(
            f"/api/admin/assignment-rollbacks/{batch_id}",
            json={"confirm": True},
            headers=admin_headers,
        )
        rollback_data = rollback_resp.json()["data"]
        assert rollback_data["rolled_back_count"] == 1
        assert rollback_data["skipped_count"] == 0

        await db.refresh(student)
        assert student.assigned_to is None
        assert student.assigned_at is None

        summary = (
            await db.execute(
                select(OperationLog).where(
                    OperationLog.batch_id == batch_id,
                    OperationLog.action == "分配回滚汇总",
                )
            )
        ).scalar_one()
        assert "成功 1 条" in summary.content

    async def test_assignment_rollback_requires_super_admin(
        self, client, db, normal_admin_headers, agent_user
    ):
        resp = await client.get(
            "/api/admin/assignment-rollbacks/school-assign-test",
            headers=normal_admin_headers,
        )
        assert resp.status_code == 403

    async def test_assignment_rollback_skips_students_reassigned_after_batch(
        self, client, db, admin_headers, agent_user
    ):
        second_agent = User(
            username="second_agent",
            hashed_password="x",
            name="第二坐席",
            role="agent",
            is_active=True,
        )
        student = Student(name="已再次分配", school_name="跳过学校")
        db.add_all([second_agent, student])
        await db.commit()
        await db.refresh(second_agent)

        assign_resp = await client.post(
            "/api/students/school-assign",
            json={"school_name": "跳过学校", "agent_ids": [agent_user.id]},
            headers=admin_headers,
        )
        batch_id = assign_resp.json()["data"]["batch_id"]

        student.assigned_to = second_agent.id
        await db.commit()

        rollback_resp = await client.post(
            f"/api/admin/assignment-rollbacks/{batch_id}",
            json={"confirm": True},
            headers=admin_headers,
        )
        rollback_data = rollback_resp.json()["data"]
        assert rollback_data["rolled_back_count"] == 0
        assert rollback_data["skipped_count"] == 1

        await db.refresh(student)
        assert student.assigned_to == second_agent.id
