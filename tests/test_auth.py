"""Tests for authentication: login, JWT, rate limiting, role-based access.

Note: API uses custom Response wrapper: HTTP 200 always, code=0 success, code=1 error.
"""

import pytest
from jose import jwt

from app.auth import create_access_token, hash_password, verify_password
from app.config import ALGORITHM, SECRET_KEY


class TestPasswordHashing:
    def test_hash_and_verify(self):
        hashed = hash_password("test123")
        assert verify_password("test123", hashed)
        assert not verify_password("wrong", hashed)
        assert not verify_password("", hashed)

    def test_different_hashes_same_password(self):
        h1 = hash_password("hello")
        h2 = hash_password("hello")
        assert h1 != h2

    def test_empty_password(self):
        hashed = hash_password("")
        assert verify_password("", hashed)
        assert not verify_password("x", hashed)

    def test_unicode_password(self):
        pwd = "密码123!@#"
        hashed = hash_password(pwd)
        assert verify_password(pwd, hashed)


class TestJWTToken:
    def test_create_and_decode(self):
        token = create_access_token({"sub": "1", "role": "admin"})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["sub"] == "1"
        assert payload["role"] == "admin"
        assert "exp" in payload

    def test_token_with_extra_claims(self):
        token = create_access_token({"sub": "5", "role": "agent", "name": "test"})
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["name"] == "test"


@pytest.mark.asyncio
class TestLoginEndpoint:
    async def test_login_success(self, client, admin_user):
        resp = await client.post("/api/auth/login", json={
            "username": "testadmin",
            "password": "admin123",
        })
        body = resp.json()
        assert body["code"] == 0
        assert "access_token" in body["data"]
        assert body["data"]["token_type"] == "bearer"
        assert body["data"]["user"]["role"] == "admin"

    async def test_login_cookie_authenticates_business_routes(self, client, admin_user):
        resp = await client.post("/api/auth/login", json={
            "username": "testadmin",
            "password": "admin123",
        })
        assert resp.json()["code"] == 0
        assert resp.cookies.get("access_token")

        students_resp = await client.get("/api/students")
        assert students_resp.status_code == 200
        assert students_resp.json()["code"] == 0

    async def test_logout_clears_auth_cookie(self, client, admin_user):
        login_resp = await client.post("/api/auth/login", json={
            "username": "testadmin",
            "password": "admin123",
        })
        assert login_resp.cookies.get("access_token")

        logout_resp = await client.post("/api/auth/logout")
        assert logout_resp.json()["code"] == 0
        assert logout_resp.cookies.get("access_token") is None

        me_resp = await client.get("/api/auth/me")
        assert me_resp.status_code == 401

    async def test_login_wrong_password(self, client, admin_user):
        resp = await client.post("/api/auth/login", json={
            "username": "testadmin",
            "password": "wrongpass",
        })
        body = resp.json()
        assert body["code"] == 1
        assert "错误" in body["msg"]

    async def test_login_nonexistent_user(self, client):
        resp = await client.post("/api/auth/login", json={
            "username": "nobody",
            "password": "x",
        })
        body = resp.json()
        assert body["code"] == 1

    async def test_login_empty_body(self, client):
        resp = await client.post("/api/auth/login", json={})
        assert resp.status_code == 422

    async def test_login_empty_strings(self, client):
        resp = await client.post("/api/auth/login", json={"username": "", "password": ""})
        assert resp.status_code == 422

    async def test_login_invalid_json(self, client):
        resp = await client.post(
            "/api/auth/login",
            data=b"not-json",
            headers={"content-type": "application/json"},
        )
        assert resp.status_code == 422

    async def test_login_rate_limiting(self, client, admin_user):
        """3 failed attempts lock the account."""
        for _ in range(3):
            resp = await client.post("/api/auth/login", json={
                "username": "testadmin", "password": "wrong",
            })
            assert resp.json()["code"] == 1

        # 4th attempt - account should be locked
        resp = await client.post("/api/auth/login", json={
            "username": "testadmin", "password": "admin123",
        })
        body = resp.json()
        assert body["code"] == 1
        assert "锁定" in body["msg"]

    async def test_login_case_sensitive_username(self, client, admin_user):
        resp = await client.post("/api/auth/login", json={
            "username": "TESTADMIN", "password": "admin123",
        })
        assert resp.json()["code"] == 1  # case-sensitive


@pytest.mark.asyncio
class TestCurrentUserEndpoint:
    async def test_me_valid_token(self, client, admin_headers, admin_user):
        resp = await client.get("/api/auth/me", headers=admin_headers)
        body = resp.json()
        assert body["code"] == 0
        assert body["data"]["username"] == "testadmin"
        assert body["data"]["role"] == "admin"

    async def test_me_no_token(self, client):
        resp = await client.get("/api/auth/me")
        assert resp.status_code == 401

    async def test_me_invalid_token(self, client):
        resp = await client.get("/api/auth/me", headers={
            "Authorization": "Bearer invalidtoken"
        })
        assert resp.status_code == 401

    async def test_me_expired_token(self, client):
        token = create_access_token({"sub": "1", "role": "admin", "exp": 0})
        resp = await client.get("/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert resp.status_code == 401

    async def test_me_disabled_user(self, client, db, admin_headers, admin_user):
        admin_user.is_active = False
        await db.commit()
        resp = await client.get("/api/auth/me", headers=admin_headers)
        assert resp.status_code == 401

    async def test_me_wrong_token_sub(self, client):
        """Historical bug: non-integer sub now returns 401."""
        token = create_access_token({"sub": "not-a-number", "role": "admin"})
        resp = await client.get("/api/auth/me", headers={
            "Authorization": f"Bearer {token}"
        })
        assert resp.status_code == 401
