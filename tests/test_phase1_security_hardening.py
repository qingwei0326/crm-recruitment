"""Phase 1 后端安全加固回归测试。

钉死 8 项安全语义：
1-1 代理头默认按环境推断
1-2 AI Key 加密入库 + 历史明文兼容
1-3 备份加密改用 Fernet
1-4 must_change_password 服务端拦截
1-5 创建账号的密码/用户名约束
1-6 health 不泄漏异常原文
1-7 按校删除二次确认 + 批量上限
1-8 HTTPException 统一信封
"""

import hashlib
import importlib
import sys

import pytest
from sqlalchemy import select

from app.models import Student, StudentStatus, SystemConfig, User
from app.routers.admin_invalid import MAX_DELETE_BY_SCHOOL_STUDENTS, _check_delete_batch_limit

# ── 1-1 代理头默认值 ──────────────────────────────────────


@pytest.fixture
def reload_config(monkeypatch):
    """按给定环境变量重新加载 app.config，用完还原，避免污染同会话其它用例。"""
    original = sys.modules.get("app.config")

    def _reload(**env):
        monkeypatch.setenv("SECRET_KEY", "test-secret-key-not-for-production")
        monkeypatch.delenv("TRUST_PROXY_HEADERS", raising=False)
        for key, value in env.items():
            monkeypatch.setenv(key, value)
        sys.modules.pop("app.config", None)
        return importlib.import_module("app.config")

    yield _reload
    if original is not None:
        sys.modules["app.config"] = original


def test_trust_proxy_defaults_to_true_in_production(reload_config):
    config = reload_config(APP_ENV="production", CORS_ORIGINS="https://crm.example.com")
    assert config.TRUST_PROXY_HEADERS is True


def test_trust_proxy_defaults_to_false_outside_production(reload_config):
    config = reload_config(APP_ENV="development")
    assert config.TRUST_PROXY_HEADERS is False


def test_trust_proxy_env_override_still_wins(reload_config):
    """直连部署必须能显式关掉，不能因为环境是 production 就强制信任。"""
    config = reload_config(
        APP_ENV="production",
        CORS_ORIGINS="https://crm.example.com",
        TRUST_PROXY_HEADERS="0",
    )
    assert config.TRUST_PROXY_HEADERS is False


# ── 1-2 AI Key 加密入库 ────────────────────────────────────


@pytest.mark.asyncio
class TestAiKeyEncryptionAtRest:
    async def test_saved_key_is_not_stored_in_plaintext(self, client, db, admin_headers):
        resp = await client.put(
            "/api/admin/config",
            json={"key": "mimo_api_key", "value": "tp-abcdefgh1234"},
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

        await db.commit()
        row = (
            await db.execute(select(SystemConfig).where(SystemConfig.key == "mimo_api_key"))
        ).scalar_one_or_none()

        assert row is not None
        assert row.value != "tp-abcdefgh1234"
        assert "tp-abcdefgh1234" not in row.value
        assert row.value.startswith("v1:")

    async def test_saved_key_round_trips_to_plaintext(self, client, db, admin_headers):
        from app.admin_config import decrypt_secret_config_value
        from app.routers.calls import _resolve_ai_engine

        await client.put(
            "/api/admin/config",
            json={"key": "ai_provider", "value": "mimo"},
            headers=admin_headers,
        )
        await client.put(
            "/api/admin/config",
            json={"key": "mimo_api_key", "value": "tp-abcdefgh1234"},
            headers=admin_headers,
        )
        await db.commit()

        row = (
            await db.execute(select(SystemConfig).where(SystemConfig.key == "mimo_api_key"))
        ).scalar_one_or_none()
        assert decrypt_secret_config_value("mimo_api_key", row.value) == "tp-abcdefgh1234"

        _base, _model, key = await _resolve_ai_engine(db)
        assert key == "tp-abcdefgh1234"

    async def test_legacy_plaintext_key_is_still_usable(self, client, db, admin_headers):
        """历史明文值不能被解密失败打挂，必须按明文继续使用。"""
        from app.routers.calls import _resolve_ai_engine

        db.add(SystemConfig(key="ai_provider", value="mimo"))
        db.add(SystemConfig(key="mimo_api_key", value="tp-legacy4321"))
        await db.commit()

        _base, _model, key = await _resolve_ai_engine(db)
        assert key == "tp-legacy4321"

        listed = await client.get("/api/admin/config", headers=admin_headers)
        assert listed.json()["data"]["mimo_api_key"] == "****4321"

    async def test_config_api_never_returns_full_key(self, client, admin_headers):
        await client.put(
            "/api/admin/config",
            json={"key": "deepseek_api_key", "value": "sk-supersecret9999"},
            headers=admin_headers,
        )
        listed = await client.get("/api/admin/config", headers=admin_headers)
        payload = str(listed.json())

        assert "sk-supersecret9999" not in payload
        assert listed.json()["data"]["deepseek_api_key"] == "****9999"


# ── 1-3 备份加密 ──────────────────────────────────────────


def _legacy_xor_bytes(payload: bytes, key: str) -> bytes:
    key_bytes = hashlib.sha256(key.encode()).digest()
    return bytes(b ^ key_bytes[i % len(key_bytes)] for i, b in enumerate(payload))


class TestBackupEncryption:
    def test_encrypt_then_decrypt_round_trips(self, tmp_path):
        from app.backup import _encrypt_file, decrypt_backup_file

        src = tmp_path / "crm.db"
        dst = tmp_path / "crm.db.enc"
        back = tmp_path / "restored.db"
        src.write_bytes(b"SQLite format 3\x00" + b"\x01" * 512)

        _encrypt_file(str(src), str(dst), "backup-key")
        assert dst.read_bytes() != src.read_bytes()
        assert b"SQLite format 3" not in dst.read_bytes()

        decrypt_backup_file(str(dst), str(back), "backup-key")
        assert back.read_bytes() == src.read_bytes()

    def test_legacy_xor_backup_reports_clear_error(self, tmp_path):
        """旧 XOR 备份无法解密属预期，必须给明确提示而不是抛栈崩溃。"""
        from app.backup import LEGACY_XOR_BACKUP_HINT, decrypt_backup_file

        src = tmp_path / "old.db"
        src.write_bytes(b"SQLite format 3\x00 legacy")
        enc = tmp_path / "old.db.enc"
        enc.write_bytes(_legacy_xor_bytes(src.read_bytes(), "backup-key"))

        with pytest.raises(ValueError, match="XOR"):
            decrypt_backup_file(str(enc), str(tmp_path / "out.db"), "backup-key")
        assert LEGACY_XOR_BACKUP_HINT

    def test_missing_key_warns_instead_of_failing_silently(self, tmp_path, caplog):
        from app.backup import _warn_plaintext_backup

        with caplog.at_level("WARNING"):
            _warn_plaintext_backup(str(tmp_path / "crm_20250101.db"))
        assert "明文" in caplog.text


# ── 1-4 强制改密服务端拦截 ─────────────────────────────────


@pytest.mark.asyncio
class TestMustChangePasswordServerEnforcement:
    async def _force_change(self, db, user):
        user.must_change_password = True
        db.add(user)
        await db.commit()
        await db.refresh(user)
        from app.auth import create_access_token

        return create_access_token(
            {"sub": str(user.id), "role": user.role, "tv": user.token_version}
        )

    async def test_login_is_not_blocked(self, client, db, admin_user):
        await self._force_change(db, admin_user)
        resp = await client.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": "admin123"},
        )
        assert resp.status_code == 200
        assert resp.json()["code"] == 0
        assert resp.json()["data"]["user"]["must_change_password"] is True

    async def test_me_is_not_blocked(self, client, db, admin_user):
        token = await self._force_change(db, admin_user)
        resp = await client.get("/api/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        assert resp.json()["data"]["must_change_password"] is True

    async def test_logout_is_not_blocked(self, client, db, admin_user):
        token = await self._force_change(db, admin_user)
        resp = await client.post(
            "/api/auth/logout", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_business_endpoint_is_blocked(self, client, db, admin_user):
        token = await self._force_change(db, admin_user)
        resp = await client.get(
            "/api/admin/users", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 403
        assert "修改密码" in resp.json()["msg"]

    async def test_change_password_is_allowed_and_clears_the_flag(
        self, client, db, admin_user
    ):
        token = await self._force_change(db, admin_user)
        resp = await client.post(
            "/api/auth/change-password",
            json={"old_password": "admin123", "new_password": "resetpass456"},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200
        assert resp.json()["code"] == 0

        relogin = await client.post(
            "/api/auth/login",
            json={"username": admin_user.username, "password": "resetpass456"},
        )
        assert relogin.json()["code"] == 0
        fresh = relogin.json()["data"]["access_token"]

        unlocked = await client.get(
            "/api/admin/users", headers={"Authorization": f"Bearer {fresh}"}
        )
        assert unlocked.status_code == 200
        assert unlocked.json()["code"] == 0


# ── 1-5 创建账号的输入约束 ─────────────────────────────────


@pytest.mark.asyncio
class TestUserCreateInputConstraints:
    async def _create(self, client, admin_headers, **payload):
        return await client.post(
            "/api/admin/users",
            json={"username": "newagent", "password": "goodpass123", "name": "新坐席", **payload},
            headers=admin_headers,
        )

    async def test_rejects_short_password(self, client, admin_headers):
        resp = await self._create(client, admin_headers, password="ab1")
        assert resp.status_code == 422

    async def test_rejects_single_digit_password(self, client, admin_headers):
        """「1」这种密码不能再建出管理员账号。"""
        resp = await self._create(client, admin_headers, password="1")
        assert resp.status_code == 422

    async def test_rejects_password_without_digits(self, client, admin_headers):
        resp = await self._create(client, admin_headers, password="adminpass")
        assert resp.status_code == 422

    async def test_rejects_password_without_letters(self, client, admin_headers):
        resp = await self._create(client, admin_headers, password="12345678")
        assert resp.status_code == 422

    async def test_rejects_username_with_whitespace(self, client, admin_headers):
        resp = await self._create(client, admin_headers, username="bad name")
        assert resp.status_code == 422

    async def test_rejects_too_short_username(self, client, admin_headers):
        resp = await self._create(client, admin_headers, username="ab")
        assert resp.status_code == 422

    async def test_created_admin_must_change_password(self, client, db, admin_headers):
        resp = await self._create(
            client,
            admin_headers,
            username="newadmin",
            password="adminpass123",
            name="新管理员",
            role="admin",
        )
        assert resp.status_code == 200
        assert resp.json()["code"] == 0

        await db.commit()
        created = (
            await db.execute(select(User).where(User.username == "newadmin"))
        ).scalar_one_or_none()
        assert created is not None
        assert created.must_change_password is True

    async def test_reset_password_path_is_not_blocked_by_create_rules(
        self, client, admin_headers, agent_user
    ):
        """创建路径收紧后，管理员运维用的重置密码不能被一起卡死。"""
        resp = await client.post(
            f"/api/admin/users/{agent_user.id}/reset-password",
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["code"] == 0


# ── 1-6 health 不泄漏异常原文 ──────────────────────────────


@pytest.mark.asyncio
async def test_health_hides_database_error_detail(client, monkeypatch):
    from app import main as main_module

    class _BrokenSession:
        async def __aenter__(self):
            raise RuntimeError(
                "could not connect to postgresql://crm:superpassword@10.0.0.5:5432/crm"
            )

        async def __aexit__(self, *args):
            return False

    monkeypatch.setattr(main_module, "async_session", lambda: _BrokenSession())

    resp = await client.get("/api/health")
    body = resp.json()

    assert body["code"] == 1
    assert body["db"] == "error"
    assert "superpassword" not in str(body)
    assert "10.0.0.5" not in str(body)
    assert body["msg"] == "database error"


# ── 1-7 按校删除二次确认 ───────────────────────────────────


def _make_invalid_students(school_name: str, count: int) -> list[Student]:
    return [
        Student(
            name=f"无效学生{index}",
            school_name=school_name,
            status=StudentStatus.invalid,
            status_detail="无意向",
            outcome_reason_code="no_intent",
        )
        for index in range(count)
    ]


def test_delete_batch_limit_rejects_oversized_batches():
    students = _make_invalid_students("大连某校", MAX_DELETE_BY_SCHOOL_STUDENTS + 1)
    message = _check_delete_batch_limit(students)
    assert message and "上限" in message
    assert _check_delete_batch_limit(students[: MAX_DELETE_BY_SCHOOL_STUDENTS]) is None


@pytest.mark.asyncio
class TestDeleteBySchoolRequiresPreviewToken:
    async def _seed(self, db, school_name="待删学校"):
        students = _make_invalid_students(school_name, 2)
        db.add_all(students)
        await db.commit()
        return students

    async def test_missing_preview_token_is_rejected(self, client, db, admin_headers):
        students = await self._seed(db)
        resp = await client.post(
            "/api/admin/delete-by-school",
            json={"school_name": "待删学校"},
            headers=admin_headers,
        )
        assert resp.status_code == 409
        assert "预览" in resp.json()["msg"]

        await db.commit()
        remaining = (await db.execute(select(Student))).scalars().all()
        assert len(remaining) == len(students)

    async def test_stale_preview_token_is_rejected(self, client, db, admin_headers):
        students = await self._seed(db)
        preview = await client.post(
            "/api/admin/delete-by-school-preview",
            json={"school_name": "待删学校"},
            headers=admin_headers,
        )
        assert preview.json()["code"] == 0
        token = preview.json()["data"]["preview_token"]
        assert preview.json()["data"]["student_count"] == 2

        students[0].status_detail = "高分段"
        students[0].outcome_reason_code = "high_score"
        await db.commit()

        stale = await client.post(
            "/api/admin/delete-by-school",
            json={"school_name": "待删学校", "preview_token": token},
            headers=admin_headers,
        )
        assert stale.status_code == 409
        await db.commit()
        assert len((await db.execute(select(Student))).scalars().all()) == 2

    async def test_forged_preview_token_is_rejected(self, client, db, admin_headers):
        await self._seed(db)
        resp = await client.post(
            "/api/admin/delete-by-school",
            json={"school_name": "待删学校", "preview_token": "deadbeef"},
            headers=admin_headers,
        )
        assert resp.status_code == 409

    async def test_valid_preview_token_deletes(self, client, db, admin_headers):
        await self._seed(db)
        preview = await client.post(
            "/api/admin/delete-by-school-preview",
            json={"school_name": "待删学校"},
            headers=admin_headers,
        )
        token = preview.json()["data"]["preview_token"]

        resp = await client.post(
            "/api/admin/delete-by-school",
            json={"school_name": "待删学校", "preview_token": token},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["code"] == 0
        assert resp.json()["data"]["deleted_count"] == 2

    async def test_oversized_batch_is_rejected_before_deleting(
        self, client, db, admin_headers, monkeypatch
    ):
        from app.routers import admin_invalid as admin_invalid_module

        await self._seed(db)
        monkeypatch.setattr(admin_invalid_module, "MAX_DELETE_BY_SCHOOL_STUDENTS", 1)

        preview = await client.post(
            "/api/admin/delete-by-school-preview",
            json={"school_name": "待删学校"},
            headers=admin_headers,
        )
        assert preview.json()["code"] == 1
        assert "上限" in preview.json()["msg"]
        await db.commit()
        assert len((await db.execute(select(Student))).scalars().all()) == 2


# ── 1-8 HTTPException 统一信封 ─────────────────────────────


@pytest.mark.asyncio
class TestHttpExceptionEnvelope:
    async def test_permission_denied_returns_project_envelope(self, client, agent_headers):
        resp = await client.post(
            "/api/admin/users",
            json={"username": "shouldfail", "password": "goodpass123", "name": "fail"},
            headers=agent_headers,
        )
        body = resp.json()
        assert resp.status_code == 403
        assert body["code"] == 403
        assert body["data"] is None
        assert body["msg"] == "权限不足"
        # detail 保留做兼容，前端 utils.getApiErrorMessage 仍在读它
        assert body["detail"] == body["msg"]

    async def test_not_found_returns_project_envelope(self, client, admin_headers):
        resp = await client.get("/api/students/99999999", headers=admin_headers)
        body = resp.json()
        assert resp.status_code == 404
        assert body["code"] == 404
        assert body["data"] is None
        assert body["msg"] == "学生不存在"
