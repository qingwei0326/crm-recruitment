"""测试设备追踪和无效线索回收功能"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import IntentLevel, Student, StudentStatus, User


@pytest.mark.asyncio
async def test_device_tracking_on_login(client: AsyncClient, db, agent_user):
    """测试登录时的设备追踪"""
    # 第一次登录
    response = await client.post(
        "/api/auth/login",
        json={"username": "testagent", "password": "agent123"},
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0"},
    )
    assert response.status_code == 200

    # 重新查询用户以获取最新数据
    result = await db.execute(select(User).where(User.username == "testagent"))
    user = result.scalar_one()
    await db.refresh(user)

    assert user.last_login_device != ""
    assert user.last_login_ip != ""
    first_device = user.last_login_device

    # 第二次登录，使用不同的 User-Agent（模拟换设备）
    response = await client.post(
        "/api/auth/login",
        json={"username": "testagent", "password": "agent123"},
        headers={
            "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) Safari/604.1"
        },
    )
    assert response.status_code == 200

    # 重新查询以获取更新后的设备信息
    result = await db.execute(select(User).where(User.username == "testagent"))
    user = result.scalar_one()
    await db.refresh(user)

    assert user.last_login_device != first_device
    assert "iPhone" in user.last_login_device or "Safari" in user.last_login_device
    # 注意：推送通知会在后台异步发送，这里只验证设备信息更新


@pytest.mark.asyncio
async def test_list_invalid_students(
    client: AsyncClient, db, admin_user, agent_user, admin_headers
):
    """测试列出无效线索"""
    # 创建一些无效线索
    student1 = Student(
        name="测试学生1",
        status=StudentStatus.invalid,
        assigned_to=agent_user.id,
        guardian_phone="13800138001",
    )
    student2 = Student(
        name="测试学生2",
        status=StudentStatus.invalid,
        assigned_to=agent_user.id,
        guardian_phone="13800138002",
    )
    db.add_all([student1, student2])
    await db.commit()

    # 获取无效线索列表
    response = await client.get("/api/admin/invalid-students", headers=admin_headers)
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["total"] >= 2


@pytest.mark.asyncio
async def test_list_invalid_students_filters_by_reason(
    client: AsyncClient, db, agent_user, admin_headers
):
    """无效线索列表支持按持久化原因筛选。"""
    high_score = Student(
        name="高分段学生",
        status=StudentStatus.invalid,
        status_detail="高分段",
        assigned_to=agent_user.id,
        guardian_phone="13800138011",
    )
    child_not_want = Student(
        name="孩子不想读学生",
        status=StudentStatus.invalid,
        status_detail="孩子不想读",
        assigned_to=agent_user.id,
        guardian_phone="13800138012",
    )
    db.add_all([high_score, child_not_want])
    await db.commit()

    response = await client.get(
        "/api/admin/invalid-students?invalid_reason=高分段",
        headers=admin_headers,
    )

    assert response.status_code == 200
    data = response.json()
    names = {item["name"] for item in data["data"]["list"]}
    assert "高分段学生" in names
    assert "孩子不想读学生" not in names


@pytest.mark.asyncio
async def test_funnel_includes_invalid_count(client: AsyncClient, db, agent_user, admin_headers):
    """线索流转漏斗包含无效线索统计。"""
    invalid_student = Student(
        name="漏斗无效学生",
        status=StudentStatus.invalid,
        status_detail="高分段",
        assigned_to=agent_user.id,
        guardian_phone="13800138015",
    )
    db.add(invalid_student)
    await db.commit()

    response = await client.get("/api/stats/funnel", headers=admin_headers)

    assert response.status_code == 200
    data = response.json()
    stages = {item["name"]: item["value"] for item in data["data"]["stages"]}
    assert stages["无效线索"] >= 1


@pytest.mark.asyncio
async def test_reclaim_invalid_students(
    client: AsyncClient, db, admin_user, agent_user, admin_headers
):
    """测试回收无效线索"""
    # 创建无效线索
    student = Student(
        name="待回收学生",
        status=StudentStatus.invalid,
        assigned_to=agent_user.id,
        guardian_phone="13800138003",
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)

    # 回收并重新分配
    response = await client.post(
        "/api/admin/reclaim-students",
        json={
            "student_ids": [student.id],
            "agent_id": admin_user.id,
        },
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["reclaimed_count"] == 1

    # 验证状态已重置
    await db.refresh(student)
    assert student.status == StudentStatus.not_contacted
    assert student.assigned_to == admin_user.id


@pytest.mark.asyncio
async def test_reclaim_invalid_students_to_unassigned_pool(
    client: AsyncClient, db, agent_user, admin_headers
):
    """选中的无效线索可以回收到未分配池。"""
    student = Student(
        name="回收到池学生",
        status=StudentStatus.invalid,
        status_detail="高分段",
        assigned_to=agent_user.id,
        guardian_phone="13800138013",
        intent_level=IntentLevel.A,
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)

    response = await client.post(
        "/api/admin/invalid-students/reclaim",
        json={"student_ids": [student.id]},
        headers=admin_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["reclaimed_count"] == 1

    await db.refresh(student)
    assert student.status == StudentStatus.not_contacted
    assert student.status_detail == ""
    assert student.assigned_to is None


@pytest.mark.asyncio
async def test_delete_invalid_students_selected(client: AsyncClient, db, agent_user, admin_headers):
    """选中的无效线索可以批量删除。"""
    student = Student(
        name="待删除无效学生",
        status=StudentStatus.invalid,
        status_detail="孩子不想读",
        assigned_to=agent_user.id,
        guardian_phone="13800138014",
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)
    student_id = student.id

    response = await client.post(
        "/api/admin/invalid-students/delete",
        json={"student_ids": [student_id]},
        headers=admin_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    assert data["data"]["deleted_count"] == 1

    db.expire_all()
    deleted = await db.get(Student, student_id)
    assert deleted is None


@pytest.mark.asyncio
async def test_reclaim_non_invalid_students_fails(
    client: AsyncClient, db, admin_user, admin_headers
):
    """测试回收非无效状态的线索应该失败"""
    # 创建正常状态的线索
    student = Student(
        name="正常学生",
        status=StudentStatus.contacted,
        guardian_phone="13800138004",
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)

    # 尝试回收非无效状态的线索
    response = await client.post(
        "/api/admin/reclaim-students",
        json={
            "student_ids": [student.id],
            "agent_id": admin_user.id,
        },
        headers=admin_headers,
    )
    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 1  # 应该失败
    assert "不是无效状态" in data["msg"]
