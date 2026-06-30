"""Tests for admin endpoints: user CRUD, role-based access, unlock.

Note: API uses custom Response: HTTP 200 always, code=0 success, code=1 error.
"""

from datetime import datetime, timedelta

import pytest

from app.models import (
    DialLog,
    FollowUp,
    IntentLevel,
    Note,
    OperationLog,
    Student,
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
        assert admin_row["total_tasks"] == 0
        assert agent_row["role"] == "agent"

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

    async def test_list_agents_counts_today_dial_logs(
        self, client, admin_headers, db, agent_user
    ):
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
            },
            headers=admin_headers,
        )
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["is_super_admin"] is False

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

    async def test_delete_self(self, client, admin_headers, admin_user):
        resp = await client.delete(f"/api/admin/users/{admin_user.id}", headers=admin_headers)
        assert resp.json()["code"] == 1  # cannot delete self

    async def test_delete_not_found(self, client, admin_headers):
        resp = await client.delete("/api/admin/users/99999", headers=admin_headers)
        assert resp.json()["code"] == 1

    async def test_delete_requires_super_admin(self, client, normal_admin_headers, agent_user):
        resp = await client.delete(f"/api/admin/users/{agent_user.id}", headers=normal_admin_headers)
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

    async def test_delete_invalid_students_requires_super_admin(
        self, client, normal_admin_headers
    ):
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

    async def test_error_report_records_authenticated_user(self, client, db, admin_user, admin_headers):
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
            await db.execute(
                select(OperationLog).where(OperationLog.action == "前端错误")
            )
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
            name="缺电话任务",
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
