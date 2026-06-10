"""Token 撤销机制测试：守住 token_version 红线。

机制原理：JWT 携带 tv 字段，user.token_version 递增时所有旧 token 立即失效。
触发场景：admin 重置密码、admin 禁用账号。

这里专门测"撤销动作 → 旧 token 立即 401"这条链路。
"""

import pytest


@pytest.mark.asyncio
class TestTokenRevocation:
    async def test_token_works_before_revocation(self, client, agent_headers):
        """对照组：撤销前 token 能正常用。"""
        resp = await client.get("/api/me", headers=agent_headers)
        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_admin_disable_invalidates_token(
        self, client, admin_headers, agent_headers, agent_user
    ):
        """admin 禁用话务员后，话务员的旧 token 立即 401。"""
        # 禁用
        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={"is_active": False},
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

        # 旧 token 应该立即失效
        resp = await client.get("/api/me", headers=agent_headers)
        assert resp.status_code == 401, "禁用后旧 token 仍可用"

    async def test_admin_reset_password_invalidates_token(
        self, client, admin_headers, agent_headers, agent_user
    ):
        """admin 通过 /reset-password 端点重置密码后，旧 token 立即失效。"""
        resp = await client.post(
            f"/api/admin/users/{agent_user.id}/reset-password",
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

        resp = await client.get("/api/me", headers=agent_headers)
        assert resp.status_code == 401, "重置密码后旧 token 仍可用"

    async def test_admin_update_password_invalidates_token(
        self, client, admin_headers, agent_headers, agent_user
    ):
        """admin 通过 PUT /users/{id} 改密码也要让旧 token 失效。"""
        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={"password": "brandnewpwd123"},
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

        resp = await client.get("/api/me", headers=agent_headers)
        assert resp.status_code == 401, "改密码后旧 token 仍可用"

    async def test_legacy_token_without_tv_is_rejected(self, client, agent_user):
        """没有 tv 字段的老 token（迁移前签发的）必须被拒绝。"""
        from app.auth import create_access_token

        legacy_token = create_access_token(
            {
                "sub": str(agent_user.id),
                "role": agent_user.role,
                # 故意不带 tv
            }
        )
        headers = {"Authorization": f"Bearer {legacy_token}"}
        resp = await client.get("/api/me", headers=headers)
        assert resp.status_code == 401, "缺少 tv 的旧 token 未被拒绝"

    async def test_wrong_tv_value_is_rejected(self, client, agent_user):
        """伪造的 tv 值必须被拒绝。"""
        from app.auth import create_access_token

        bad_token = create_access_token(
            {
                "sub": str(agent_user.id),
                "role": agent_user.role,
                "tv": 9999,  # 数据库里实际是 1
            }
        )
        headers = {"Authorization": f"Bearer {bad_token}"}
        resp = await client.get("/api/me", headers=headers)
        assert resp.status_code == 401, "tv 不匹配的 token 未被拒绝"

    async def test_re_login_after_revocation_works(self, client, admin_headers, agent_user):
        """撤销后重新登录，新 token 应该正常工作。"""
        # 改密码触发撤销
        new_pwd = "freshpass123"
        resp = await client.put(
            f"/api/admin/users/{agent_user.id}",
            json={"password": new_pwd},
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

        # 用新密码登录拿新 token
        resp = await client.post(
            "/api/auth/login",
            json={"username": agent_user.username, "password": new_pwd},
        )
        assert resp.json()["code"] == 0
        new_token = resp.json()["data"]["access_token"]

        # 新 token 应该能用
        resp = await client.get("/api/me", headers={"Authorization": f"Bearer {new_token}"})
        assert resp.status_code == 200
