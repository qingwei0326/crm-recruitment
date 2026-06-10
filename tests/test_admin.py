"""Tests for admin endpoints: user CRUD, role-based access, unlock.

Note: API uses custom Response: HTTP 200 always, code=0 success, code=1 error.
"""

from datetime import datetime, timedelta

import pytest


@pytest.mark.asyncio
class TestAdminAgents:
    async def test_list_agents(self, client, admin_headers, agent_user):
        resp = await client.get("/api/admin/agents", headers=admin_headers)
        body = resp.json()
        assert body["code"] == 0
        assert any(a["username"] == "testagent" for a in body["data"])

    async def test_list_agents_requires_admin(self, client, agent_headers):
        resp = await client.get("/api/admin/agents", headers=agent_headers)
        assert resp.status_code == 403

    async def test_list_agents_no_auth(self, client):
        resp = await client.get("/api/admin/agents")
        assert resp.status_code == 401


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
