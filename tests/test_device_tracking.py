"""测试设备追踪和无效线索回收功能"""

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import IntentLevel, OperationLog, Student, StudentStage, StudentStatus, User
from app.utils import utcnow


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
async def test_global_search_finds_invalid_student_by_guardian2_phone(
    client: AsyncClient, db, agent_user, admin_headers
):
    """全局搜索能按第二监护人手机号找到默认列表隐藏的无效线索。"""
    student = Student(
        name="黄丹妮",
        region="芗城区",
        school_name="芗城中学玉兰分校",
        status=StudentStatus.invalid,
        status_detail="无意向",
        assigned_to=agent_user.id,
        guardian_name="黄绍彬",
        guardian_phone="13605086844",
        guardian2_name="林英",
        guardian2_phone="13960043037",
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)
    db.add(
        OperationLog(
            operator_id=agent_user.id,
            operator_name=agent_user.name,
            target_student_id=student.id,
            action="修改状态",
            content="状态 未联系 → 无效; 结果/原因：无意向",
            old_status="未联系",
            new_status="无效",
            note_content="无意向",
        )
    )
    await db.commit()

    response = await client.get(
        "/api/admin/global-search?q=13960043037",
        headers=admin_headers,
    )

    assert response.status_code == 200
    data = response.json()
    assert data["code"] == 0
    students = data["data"]["students"]
    assert students[0]["name"] == "黄丹妮"
    assert students[0]["guardian2_phone"] == "13960043037"
    assert students[0]["agent_name"] == agent_user.name
    assert students[0]["is_invalid"] is True
    assert students[0]["latest_log"]["action"] == "修改状态"
    assert data["data"]["operation_logs"][0]["student"]["name"] == "黄丹妮"


@pytest.mark.asyncio
async def test_invalid_students_search_matches_guardian2_phone_tail_and_returns_invalid_log(
    client: AsyncClient, db, agent_user, admin_headers
):
    """无效线索回收页支持按副号码尾号搜索，并返回标无效操作人。"""
    target = Student(
        name="副号码尾号命中",
        school_name="目标学校",
        status=StudentStatus.invalid,
        status_detail="无意向",
        assigned_to=agent_user.id,
        guardian_phone="13605086844",
        guardian2_name="林英",
        guardian2_phone="13960043037",
    )
    other = Student(
        name="副号码尾号未命中",
        school_name="其他学校",
        status=StudentStatus.invalid,
        status_detail="无意向",
        assigned_to=agent_user.id,
        guardian_phone="13605086845",
        guardian2_phone="13960049999",
    )
    db.add_all([target, other])
    await db.commit()
    await db.refresh(target)
    db.add(
        OperationLog(
            operator_id=agent_user.id,
            operator_name=agent_user.name,
            target_student_id=target.id,
            action="修改状态",
            content="状态 未联系 → 无效; 结果/原因：无意向",
            old_status="未联系",
            new_status="无效",
            note_content="无意向",
        )
    )
    await db.commit()

    response = await client.get("/api/admin/invalid-students?q=3037", headers=admin_headers)

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 0
    names = [item["name"] for item in body["data"]["list"]]
    assert names == ["副号码尾号命中"]
    item = body["data"]["list"][0]
    assert item["guardian2_phone"] == "13960043037"
    assert item["invalid_operator_name"] == agent_user.name

    groups_response = await client.get(
        "/api/admin/invalid-school-groups?q=3037",
        headers=admin_headers,
    )
    groups = groups_response.json()["data"]["groups"]
    assert groups == [{"name": "目标学校", "count": 1}]


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
async def test_stage_stats_match_stage_filter_counts(
    client: AsyncClient, db, agent_user, admin_headers
):
    enrolled_unassigned = Student(
        name="未分配已报名",
        status=StudentStatus.enrolled,
        stage=StudentStage.enrolled,
        guardian_phone="13800138101",
    )
    enrolled_assigned = Student(
        name="已分配已报名",
        assigned_to=agent_user.id,
        status=StudentStatus.enrolled,
        stage=StudentStage.enrolled,
        guardian_phone="13800138102",
    )
    invalid_enrolled_stage = Student(
        name="无效但阶段已报名",
        assigned_to=agent_user.id,
        status=StudentStatus.invalid,
        stage=StudentStage.enrolled,
        guardian_phone="13800138103",
    )
    db.add_all([enrolled_unassigned, enrolled_assigned, invalid_enrolled_stage])
    await db.commit()

    stats_resp = await client.get("/api/stats/stages", headers=admin_headers)
    list_resp = await client.get(
        "/api/students?stage=已报名&page_size=100",
        headers=admin_headers,
    )

    assert stats_resp.status_code == 200
    assert list_resp.status_code == 200
    stats_count = stats_resp.json()["data"]["已报名"]
    list_count = list_resp.json()["data"]["total"]
    assert stats_count == list_count == 2


@pytest.mark.asyncio
async def test_dashboard_summary_returns_actionable_admin_metrics(
    client: AsyncClient, db, agent_user, admin_user, admin_headers
):
    """仪表盘摘要返回可处理的未分配线索和今日新增 A。"""
    now = utcnow()
    active_unassigned = Student(
        name="可分配有效线索",
        status=StudentStatus.not_contacted,
        guardian_phone="13800138020",
    )
    invalid_unassigned = Student(
        name="不可分配无效线索",
        status=StudentStatus.invalid,
        guardian_phone="13800138021",
    )
    a_student = Student(
        name="今日新增A",
        status=StudentStatus.contacted,
        intent_level=IntentLevel.A,
        assigned_to=agent_user.id,
        guardian_phone="13800138022",
    )
    db.add_all([active_unassigned, invalid_unassigned, a_student])
    await db.flush()
    db.add(
        OperationLog(
            operator_id=admin_user.id,
            operator_name=admin_user.name,
            target_student_id=a_student.id,
            action="手动评级",
            old_status="B",
            new_status="A",
            created_at=now,
        )
    )
    await db.commit()

    response = await client.get("/api/stats/dashboard-summary", headers=admin_headers)

    assert response.status_code == 200
    data = response.json()["data"]
    assert data["available_unassigned"] >= 1
    assert data["today_a"] >= 1


@pytest.mark.asyncio
async def test_students_filters_match_actionable_dashboard_metrics(
    client: AsyncClient, db, admin_user, agent_user, admin_headers
):
    now = utcnow()
    active_unassigned = Student(
        name="列表可分配线索",
        status=StudentStatus.not_contacted,
        guardian_phone="13800138023",
    )
    invalid_unassigned = Student(
        name="列表无效未分配",
        status=StudentStatus.invalid,
        guardian_phone="13800138024",
    )
    today_a = Student(
        name="列表今日新增A",
        status=StudentStatus.contacted,
        intent_level=IntentLevel.A,
        assigned_to=agent_user.id,
        guardian_phone="13800138025",
    )
    existing_a = Student(
        name="列表历史A",
        status=StudentStatus.contacted,
        intent_level=IntentLevel.A,
        assigned_to=agent_user.id,
        guardian_phone="13800138026",
    )
    missing_phone = Student(
        name="列表无电话数据",
        status=StudentStatus.not_contacted,
        guardian_phone="",
        guardian2_phone="",
    )
    has_phone = Student(
        name="列表已有手机号",
        status=StudentStatus.not_contacted,
        guardian_phone="13800138027",
        guardian2_phone="",
    )
    db.add_all(
        [active_unassigned, invalid_unassigned, today_a, existing_a, missing_phone, has_phone]
    )
    await db.flush()
    db.add(
        OperationLog(
            operator_id=admin_user.id,
            operator_name=admin_user.name,
            target_student_id=today_a.id,
            action="手动评级",
            old_status="B",
            new_status="A",
            created_at=now,
        )
    )
    await db.commit()

    active_response = await client.get(
        "/api/students?assignment=unassigned&active=1&page_size=100",
        headers=admin_headers,
    )
    assert active_response.status_code == 200
    active_names = {item["name"] for item in active_response.json()["data"]["list"]}
    assert "列表可分配线索" in active_names
    assert "列表无效未分配" not in active_names

    today_a_response = await client.get(
        "/api/students?intent_level=A&today_a=1&page_size=100",
        headers=admin_headers,
    )
    assert today_a_response.status_code == 200
    today_a_names = {item["name"] for item in today_a_response.json()["data"]["list"]}
    assert "列表今日新增A" in today_a_names
    assert "列表历史A" not in today_a_names

    missing_phone_response = await client.get(
        "/api/students?active=1&missing_phone=1&page_size=100",
        headers=admin_headers,
    )
    assert missing_phone_response.status_code == 200
    missing_phone_names = {item["name"] for item in missing_phone_response.json()["data"]["list"]}
    assert "列表无电话数据" in missing_phone_names
    assert "列表已有手机号" not in missing_phone_names


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
