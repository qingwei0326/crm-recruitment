"""权限边界测试：守住话务员之间的数据隔离。

5 个话务员同时在用，任何一次代码改动都可能不小心打开越权口子。
这些用例是"红线"——任何一条挂了就是 P0。
"""

import pytest
import pytest_asyncio

from app.auth import create_access_token, hash_password
from app.models import IntentLevel, Student, StudentStage, StudentStatus, User


@pytest_asyncio.fixture
async def agent_a(db):
    user = User(
        username="agent_a",
        hashed_password=hash_password("pwd"),
        role="agent",
        name="话务员A",
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def agent_b(db):
    user = User(
        username="agent_b",
        hashed_password=hash_password("pwd"),
        role="agent",
        name="话务员B",
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def agent_a_headers(agent_a):
    token = create_access_token(
        {
            "sub": str(agent_a.id),
            "role": agent_a.role,
            "tv": agent_a.token_version,
        }
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def agent_b_headers(agent_b):
    token = create_access_token(
        {
            "sub": str(agent_b.id),
            "role": agent_b.role,
            "tv": agent_b.token_version,
        }
    )
    return {"Authorization": f"Bearer {token}"}


@pytest_asyncio.fixture
async def student_of_b(db, agent_b):
    """归属 agent_b 的学生。"""
    student = Student(
        name="王小明",
        region="思明区",
        assigned_to=agent_b.id,
        stage=StudentStage.initial_contact,
        status=StudentStatus.not_contacted,
        intent_level=IntentLevel.none,
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)
    return student


@pytest.mark.asyncio
class TestAgentIsolation:
    """话务员 A 不能碰话务员 B 的学生。"""

    async def test_agent_cannot_get_others_student(self, client, agent_a_headers, student_of_b):
        resp = await client.get(f"/api/students/{student_of_b.id}", headers=agent_a_headers)
        # get_accessible_student 越权时返回 403
        assert resp.status_code == 403, f"越权读取未被拦截: {resp.text}"

    async def test_agent_cannot_update_others_student(self, client, agent_a_headers, student_of_b):
        resp = await client.put(
            f"/api/students/{student_of_b.id}",
            json={"name": "被改名了"},
            headers=agent_a_headers,
        )
        assert resp.status_code == 403, f"越权修改未被拦截: {resp.text}"

    async def test_agent_cannot_get_phone_of_others_student(
        self, client, agent_a_headers, student_of_b
    ):
        """获取明文电话是高危操作——撞号 + 隐私 → 必须严格隔离。"""
        resp = await client.get(f"/api/students/phone/{student_of_b.id}", headers=agent_a_headers)
        assert resp.status_code == 403, f"越权拿明文电话未被拦截: {resp.text}"

    async def test_agent_list_excludes_others_students(self, client, agent_a_headers, student_of_b):
        """话务员列表接口必须自动过滤掉别人的学生。"""
        resp = await client.get("/api/students", headers=agent_a_headers)
        assert resp.status_code == 200
        body = resp.json()
        ids = [s["id"] for s in body["data"]["list"]]
        assert student_of_b.id not in ids, "话务员看到了别人的学生"

    async def test_admin_can_access_any_student(self, client, admin_headers, student_of_b):
        """对照组：admin 不受隔离限制。"""
        resp = await client.get(f"/api/students/{student_of_b.id}", headers=admin_headers)
        assert resp.status_code == 200


class TestRequireAdminOperation:
    """require_admin_operation 是 5 个路由文件原本各自定义的同一份检查，收敛后语义必须不变。"""

    @staticmethod
    def _user(role, permissions="", super_admin=False):
        return User(
            username=f"{role}_op",
            hashed_password="x",
            role=role,
            name="操作权限测试",
            is_active=True,
            is_super_admin=super_admin,
            operation_permissions=permissions,
        )

    def test_admin_without_operation_permission_is_rejected(self):
        from fastapi import HTTPException

        from app.auth import ADMIN_OP_STUDENT_IMPORT
        from app.permissions import require_admin_operation

        with pytest.raises(HTTPException) as exc:
            require_admin_operation(self._user("admin"), ADMIN_OP_STUDENT_IMPORT)
        assert exc.value.status_code == 403

    def test_admin_with_operation_permission_passes(self):
        from app.auth import ADMIN_OP_STUDENT_IMPORT
        from app.permissions import require_admin_operation

        require_admin_operation(
            self._user("admin", permissions=ADMIN_OP_STUDENT_IMPORT),
            ADMIN_OP_STUDENT_IMPORT,
        )

    def test_super_admin_passes_without_explicit_permission(self):
        from app.auth import ADMIN_OP_STUDENT_IMPORT
        from app.permissions import require_admin_operation

        require_admin_operation(self._user("admin", super_admin=True), ADMIN_OP_STUDENT_IMPORT)

    def test_agent_is_not_gated_here(self):
        """话务员由各自路由依赖限制访问，这里不拦截（与收敛前 4 处定义一致）。"""
        from app.auth import ADMIN_OP_STUDENT_PHONE
        from app.permissions import require_admin_operation

        require_admin_operation(self._user("agent"), ADMIN_OP_STUDENT_PHONE)
