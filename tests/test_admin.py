"""Tests for admin endpoints: user CRUD, role-based access, unlock.

Note: API uses custom Response: HTTP 200 always, code=0 success, code=1 error.
"""

from datetime import datetime, timedelta

import pytest

from app.models import DialLog, FollowUp, IntentLevel, Note, Student, StudentStatus
from app.utils import today_cst_as_utc, utcnow


@pytest.mark.asyncio
class TestAdminAgents:
    async def test_list_agents(self, client, admin_headers, agent_user):
        resp = await client.get("/api/admin/agents", headers=admin_headers)
        body = resp.json()
        assert body["code"] == 0
        assert any(a["username"] == "testagent" for a in body["data"])

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
                    created_at=today + timedelta(hours=2),
                ),
            ]
        )
        await db.commit()

        resp = await client.get(
            "/api/admin/agent-score-preview",
            params={"daily_call_target": 4},
            headers=admin_headers,
        )
        body = resp.json()

        assert body["code"] == 0
        assert body["data"]["daily_call_target"] == 4
        item = body["data"]["items"][0]
        assert item["agent"]["id"] == agent_user.id
        assert item["metrics"]["active_tasks"] == 3
        assert item["metrics"]["pending_tasks"] == 1
        assert item["metrics"]["done_tasks"] == 1
        assert item["metrics"]["follow_up_tasks"] == 1
        assert item["metrics"]["today_calls"] == 1
        assert item["metrics"]["open_follow_ups"] == 1
        assert item["metrics"]["overdue_follow_ups"] == 1
        assert item["metrics"]["missing_phone_tasks"] == 1
        assert item["metrics"]["a_level_count"] == 2
        assert item["metrics"]["enrolled_count"] == 1
        assert item["metrics"]["notes_today"] == 1
        assert item["score"] < 55
        assert item["level"] == "risk"
        assert item["components"]["task_progress"]["max"] == 30.0
        signal_keys = {signal["key"] for signal in item["signals"]}
        assert "overdue_follow_ups" in signal_keys
        assert "missing_phone_tasks" in signal_keys
        assert item["recommended_action"] == "先处理逾期回访，防止高意向线索流失"


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
        assert resp.json()["code"] == 0

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


@pytest.mark.asyncio
class TestHealthEndpoint:
    async def test_health(self, client):
        resp = await client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["code"] == 0
        assert resp.json()["msg"] == "ok"
