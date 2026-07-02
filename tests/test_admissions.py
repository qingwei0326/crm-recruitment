import asyncio

import pytest
from sqlalchemy import select

from app.auth import create_access_token, hash_password
from app.models import EnrollmentRecord, IntentLevel, Student, StudentStage, StudentStatus, User


def test_admissions_models_are_importable():
    from app.models import (
        CampusVisitTask,
        EnrollmentRecord,
        HomeVisitTask,
    )

    assert HomeVisitTask.__tablename__ == "home_visit_tasks"
    assert CampusVisitTask.__tablename__ == "campus_visit_tasks"
    assert EnrollmentRecord.__tablename__ == "enrollment_records"


@pytest.mark.asyncio
async def test_admissions_empty_lists(client, admin_headers):
    for path in (
        "/api/admissions/home-visits",
        "/api/admissions/campus-visits",
        "/api/admissions/enrollments",
    ):
        resp = await client.get(path, headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["code"] == 0
        assert body["data"] == {"total": 0, "page": 1, "page_size": 100, "list": []}


async def _create_agent(db, username: str, name: str = "其他坐席") -> User:
    agent = User(
        username=username,
        hashed_password=hash_password("agent123"),
        role="agent",
        name=name,
        is_active=True,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)
    return agent


def _headers_for(user: User) -> dict:
    token = create_access_token(
        {
            "sub": str(user.id),
            "role": user.role,
            "tv": user.token_version,
        }
    )
    return {"Authorization": f"Bearer {token}"}


async def _create_assigned_student(db, agent: User, name: str = "家访学生") -> Student:
    student = Student(
        name=name,
        region="芗城区",
        guardian_phone="13800138000",
        school_name="漳州一中",
        assigned_to=agent.id,
        stage=StudentStage.initial_contact,
        status=StudentStatus.not_contacted,
        intent_level=IntentLevel.A,
        score=520,
        program="护理",
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)
    return student


@pytest.mark.asyncio
async def test_agent_can_create_home_visit_for_assigned_student(
    client, db, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user)

    resp = await client.post(
        "/api/admissions/home-visits",
        json={
            "student_id": student.id,
            "intent_program": "护理",
            "exam_score": 520,
            "usual_score": 510,
            "parent_intent": "家长愿意了解",
            "student_situation": "学生想读护理",
            "is_wechat_added": True,
            "is_confirmed_with_guardian": True,
            "requested_visit_time": "2026-07-03T10:00:00",
            "address": "芗城区测试路 1 号",
            "priority": "高",
            "notes": "电话已确认",
        },
        headers=agent_headers,
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["student_id"] == student.id
    assert body["data"]["creator_agent_id"] == agent_user.id
    assert body["data"]["status"] == "待确认"
    assert body["data"]["priority"] == "高"
    assert body["data"]["student_name"] == "家访学生"

    list_resp = await client.get("/api/admissions/home-visits", headers=agent_headers)
    assert list_resp.json()["data"]["total"] == 1
    assert list_resp.json()["data"]["list"][0]["address"] == "芗城区测试路 1 号"
    await db.refresh(student)
    assert student.stage == StudentStage.home_visit_pending


@pytest.mark.asyncio
async def test_home_visit_creation_triggers_pushplus(client, db, agent_user, agent_headers, monkeypatch):
    student = await _create_assigned_student(db, agent_user, name="推送家访学生")
    called = {}

    async def fake_notify(task_id):
        called["task_id"] = task_id
        return True

    monkeypatch.setattr("app.routers.admissions.notify_home_visit_created_background", fake_notify)

    resp = await client.post(
        "/api/admissions/home-visits",
        json={
            "student_id": student.id,
            "address": "推送测试地址",
            "notes": "到校参观时间：周六上午；情况：家长愿意",
        },
        headers=agent_headers,
    )
    await asyncio.sleep(0)

    assert resp.status_code == 200
    assert resp.json()["code"] == 0
    assert called["task_id"] == resp.json()["data"]["id"]


@pytest.mark.asyncio
async def test_home_visit_pushplus_sends_to_active_admins_and_super_admins(
    db, agent_user, monkeypatch
):
    from app.models import HomeVisitTask, SystemConfig
    from app.pushplus import notify_home_visit_created_background

    normal_admin = User(
        username="home-notify-admin",
        hashed_password=hash_password("admin123"),
        role="admin",
        name="普通管理员",
        is_active=True,
        is_super_admin=False,
        pushplus_token="normal-token",
    )
    super_admin = User(
        username="home-notify-super",
        hashed_password=hash_password("admin123"),
        role="admin",
        name="超级管理员",
        is_active=True,
        is_super_admin=True,
        pushplus_token="super-token",
    )
    inactive_admin = User(
        username="home-notify-inactive",
        hashed_password=hash_password("admin123"),
        role="admin",
        name="停用管理员",
        is_active=False,
        pushplus_token="inactive-token",
    )
    db.add_all([normal_admin, super_admin, inactive_admin, SystemConfig(key="pushplus_token", value="global-token")])
    await db.commit()

    student = await _create_assigned_student(db, agent_user, name="通知目标学生")
    task = HomeVisitTask(
        student_id=student.id,
        creator_agent_id=agent_user.id,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone,
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        address="通知地址",
        notes="通知备注",
    )
    db.add(task)
    await db.commit()
    await db.refresh(task)

    sent = []

    async def fake_send(token, title, content):
        sent.append((token, title, content))

    monkeypatch.setattr("app.pushplus._send_pushplus", fake_send)

    ok = await notify_home_visit_created_background(task.id)

    assert ok is True
    assert [item[0] for item in sent] == ["normal-token", "super-token"]
    assert all(item[1] == "新家访上报" for item in sent)
    assert all("通知目标学生" in item[2] for item in sent)


@pytest.mark.asyncio
async def test_admin_can_update_home_visit_result(client, db, admin_headers, agent_user):
    student = await _create_assigned_student(db, agent_user)
    create_resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "龙文区测试路", "priority": "中"},
        headers=_headers_for(agent_user),
    )
    task_id = create_resp.json()["data"]["id"]

    resp = await client.patch(
        f"/api/admissions/home-visits/{task_id}",
        json={
            "status": "已完成",
            "result": "安排到校参观",
            "guardian_attitude": "认可学校",
            "student_attitude": "愿意到校看看",
            "concerns": "费用",
            "next_action": "安排参观",
            "result_notes": "周末来校",
        },
        headers=admin_headers,
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["status"] == "已完成"
    assert body["data"]["result"] == "安排到校参观"
    assert body["data"]["guardian_attitude"] == "认可学校"
    await db.refresh(student)
    assert student.stage == StudentStage.campus_visit_pending


@pytest.mark.asyncio
async def test_home_visit_completion_updates_student_stage(client, db, admin_headers, agent_user):
    student = await _create_assigned_student(db, agent_user, name="家访完成学生")
    create_resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "龙文区测试路", "priority": "中"},
        headers=_headers_for(agent_user),
    )
    task_id = create_resp.json()["data"]["id"]

    resp = await client.patch(
        f"/api/admissions/home-visits/{task_id}",
        json={"status": "已完成", "result": "成功", "result_notes": "家访完成"},
        headers=admin_headers,
    )

    assert resp.status_code == 200
    await db.refresh(student)
    assert student.stage == StudentStage.home_visit_completed


@pytest.mark.asyncio
async def test_home_visit_enrolled_result_updates_student_status_and_stage(
    client, db, admin_headers, agent_user
):
    student = await _create_assigned_student(db, agent_user, name="家访已报名学生")
    create_resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "龙文区测试路", "priority": "中"},
        headers=_headers_for(agent_user),
    )
    task_id = create_resp.json()["data"]["id"]

    resp = await client.patch(
        f"/api/admissions/home-visits/{task_id}",
        json={"status": "已完成", "result": "已报名", "result_notes": "家访现场确认报名"},
        headers=admin_headers,
    )

    assert resp.status_code == 200
    await db.refresh(student)
    assert student.status == StudentStatus.enrolled
    assert student.stage == StudentStage.enrolled
    enrollment = (
        await db.execute(
            select(EnrollmentRecord).where(EnrollmentRecord.home_visit_task_id == task_id)
        )
    ).scalar_one_or_none()
    assert enrollment is not None
    assert enrollment.student_id == student.id
    assert enrollment.attributed_agent_id == agent_user.id
    assert enrollment.source.value == "家访后"


@pytest.mark.asyncio
async def test_agent_cannot_create_home_visit_for_other_agent_student(
    client, db, agent_headers
):
    other_agent = await _create_agent(db, "other-agent")
    student = await _create_assigned_student(db, other_agent, name="其他学生")

    resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "不能访问"},
        headers=agent_headers,
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_agent_cannot_fill_home_visit_final_result(client, db, agent_user, agent_headers):
    student = await _create_assigned_student(db, agent_user)
    create_resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "芗城区测试路"},
        headers=agent_headers,
    )
    task_id = create_resp.json()["data"]["id"]

    resp = await client.patch(
        f"/api/admissions/home-visits/{task_id}",
        json={"status": "已完成", "result": "成功", "result_notes": "管理员才可填"},
        headers=agent_headers,
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_agent_can_create_campus_visit_for_assigned_student(
    client, db, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user, name="到校学生")

    resp = await client.post(
        "/api/admissions/campus-visits",
        json={
            "student_id": student.id,
            "source": "电话外呼",
            "intent_program": "新能源汽修",
            "appointment_at": "2026-07-04T09:30:00",
            "needs_pickup": True,
            "visitor_count": 3,
            "current_concerns": "想看实训室",
            "notes": "家长周六有空",
        },
        headers=agent_headers,
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["student_id"] == student.id
    assert body["data"]["creator_user_id"] == agent_user.id
    assert body["data"]["status"] == "已预约"
    assert body["data"]["needs_pickup"] is True
    assert body["data"]["visitor_count"] == 3
    await db.refresh(student)
    assert student.stage == StudentStage.campus_visit_scheduled


@pytest.mark.asyncio
async def test_duplicate_open_campus_visit_is_rejected(client, db, agent_user, agent_headers):
    student = await _create_assigned_student(db, agent_user, name="重复到校学生")

    first = await client.post(
        "/api/admissions/campus-visits",
        json={"student_id": student.id, "appointment_at": "2026-07-04T09:30:00"},
        headers=agent_headers,
    )
    assert first.status_code == 200

    second = await client.post(
        "/api/admissions/campus-visits",
        json={"student_id": student.id, "appointment_at": "2026-07-05T09:30:00"},
        headers=agent_headers,
    )

    assert second.status_code == 400
    assert "未完成" in second.json()["detail"]


@pytest.mark.asyncio
async def test_agent_cannot_fill_campus_visit_result(client, db, agent_user, agent_headers):
    student = await _create_assigned_student(db, agent_user, name="结果权限学生")
    create_resp = await client.post(
        "/api/admissions/campus-visits",
        json={"student_id": student.id, "appointment_at": "2026-07-04T09:30:00"},
        headers=agent_headers,
    )
    task_id = create_resp.json()["data"]["id"]

    resp = await client.patch(
        f"/api/admissions/campus-visits/{task_id}",
        json={
            "status": "已到校",
            "result": "已到校",
            "reception_content": "参观校园",
            "guardian_attitude": "满意",
        },
        headers=agent_headers,
    )

    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_admin_can_mark_campus_visit_arrived(
    client, db, admin_headers, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user, name="管理员结果学生")
    create_resp = await client.post(
        "/api/admissions/campus-visits",
        json={"student_id": student.id, "appointment_at": "2026-07-04T09:30:00"},
        headers=agent_headers,
    )
    task_id = create_resp.json()["data"]["id"]

    resp = await client.patch(
        f"/api/admissions/campus-visits/{task_id}",
        json={
            "status": "已到校",
            "result": "已到校",
            "reception_content": "参观校园/宿舍/专业",
            "guardian_attitude": "比较满意",
            "student_attitude": "想报名",
            "next_action": "确认报名",
            "result_notes": "等待家长确认定金",
        },
        headers=admin_headers,
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["status"] == "已到校"
    assert body["data"]["result"] == "已到校"
    assert body["data"]["reception_content"] == "参观校园/宿舍/专业"
    await db.refresh(student)
    assert student.stage == StudentStage.campus_visit_arrived


@pytest.mark.asyncio
async def test_campus_visit_enrolled_result_updates_student_status_and_stage(
    client, db, admin_headers, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user, name="到校现场报名学生")
    create_resp = await client.post(
        "/api/admissions/campus-visits",
        json={"student_id": student.id, "appointment_at": "2026-07-04T09:30:00"},
        headers=agent_headers,
    )
    task_id = create_resp.json()["data"]["id"]

    resp = await client.patch(
        f"/api/admissions/campus-visits/{task_id}",
        json={"status": "已到校", "result": "现场报名", "onsite_enrolled": True},
        headers=admin_headers,
    )

    assert resp.status_code == 200
    await db.refresh(student)
    assert student.status == StudentStatus.enrolled
    assert student.stage == StudentStage.enrolled
    enrollment = (
        await db.execute(
            select(EnrollmentRecord).where(EnrollmentRecord.campus_visit_task_id == task_id)
        )
    ).scalar_one_or_none()
    assert enrollment is not None
    assert enrollment.student_id == student.id
    assert enrollment.attributed_agent_id == agent_user.id
    assert enrollment.source.value == "到校参观后"


@pytest.mark.asyncio
async def test_admin_scheduled_campus_visit_from_home_visit_attributes_to_home_creator(
    client, db, admin_headers, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user, name="管理员安排到校归属")
    home_resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "家访后安排到校"},
        headers=agent_headers,
    )
    home_id = home_resp.json()["data"]["id"]

    campus_resp = await client.post(
        "/api/admissions/campus-visits",
        json={
            "student_id": student.id,
            "home_visit_task_id": home_id,
            "source": "家访后",
            "appointment_at": "2026-07-04T09:30:00",
        },
        headers=admin_headers,
    )

    assert campus_resp.status_code == 200
    campus_id = campus_resp.json()["data"]["id"]
    assert campus_resp.json()["data"]["creator_user_id"] == agent_user.id

    enroll_resp = await client.post(
        "/api/admissions/enrollments",
        json={
            "student_id": student.id,
            "source": "到校参观后",
            "campus_visit_task_id": campus_id,
        },
        headers=admin_headers,
    )

    assert enroll_resp.status_code == 200
    assert enroll_resp.json()["data"]["attributed_agent_id"] == agent_user.id
    assert enroll_resp.json()["data"]["attribution_method"] == "自动到校预约人"


@pytest.mark.asyncio
async def test_enrollment_from_campus_visit_attributes_to_appointment_creator(
    client, db, admin_headers, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user, name="到校报名学生")
    campus_resp = await client.post(
        "/api/admissions/campus-visits",
        json={"student_id": student.id, "appointment_at": "2026-07-04T09:30:00"},
        headers=agent_headers,
    )
    campus_id = campus_resp.json()["data"]["id"]

    resp = await client.post(
        "/api/admissions/enrollments",
        json={
            "student_id": student.id,
            "source": "到校参观后",
            "campus_visit_task_id": campus_id,
            "enrolled_program": "护理",
            "amount": 600,
        },
        headers=admin_headers,
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["attributed_agent_id"] == agent_user.id
    assert body["data"]["attribution_method"] == "自动到校预约人"
    assert body["data"]["settlement_status"] == "未结算"
    assert body["data"]["source"] == "到校参观后"
    await db.refresh(student)
    assert student.status == StudentStatus.enrolled
    assert student.stage == StudentStage.enrolled


@pytest.mark.asyncio
async def test_enrollment_from_home_visit_attributes_to_home_visit_creator(
    client, db, admin_headers, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user, name="家访报名学生")
    home_resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "家访地址"},
        headers=agent_headers,
    )
    home_id = home_resp.json()["data"]["id"]

    resp = await client.post(
        "/api/admissions/enrollments",
        json={
            "student_id": student.id,
            "source": "家访后",
            "home_visit_task_id": home_id,
            "enrolled_program": "汽修",
        },
        headers=admin_headers,
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["attributed_agent_id"] == agent_user.id
    assert body["data"]["attribution_method"] == "自动家访申请人"


@pytest.mark.asyncio
async def test_duplicate_student_enrollment_is_rejected(
    client, db, admin_headers, agent_user
):
    student = await _create_assigned_student(db, agent_user, name="重复报名学生")

    first = await client.post(
        "/api/admissions/enrollments",
        json={"student_id": student.id, "source": "管理员补录", "enrolled_program": "护理"},
        headers=admin_headers,
    )
    assert first.status_code == 200

    second = await client.post(
        "/api/admissions/enrollments",
        json={"student_id": student.id, "source": "管理员补录", "enrolled_program": "汽修"},
        headers=admin_headers,
    )

    assert second.status_code == 400
    assert "已有报名记录" in second.json()["detail"]


@pytest.mark.asyncio
async def test_direct_admin_enrollment_attributes_to_current_assigned_agent(
    client, db, admin_headers, agent_user
):
    student = await _create_assigned_student(db, agent_user, name="直接报名学生")

    resp = await client.post(
        "/api/admissions/enrollments",
        json={"student_id": student.id, "source": "管理员补录", "enrolled_program": "幼教"},
        headers=admin_headers,
    )

    assert resp.status_code == 200
    body = resp.json()
    assert body["data"]["attributed_agent_id"] == agent_user.id
    assert body["data"]["attribution_method"] == "自动当前负责人"


@pytest.mark.asyncio
async def test_reassigning_student_does_not_change_enrollment_attribution(
    client, db, admin_headers, agent_user
):
    student = await _create_assigned_student(db, agent_user, name="重分配后报名归属")
    enrollment_resp = await client.post(
        "/api/admissions/enrollments",
        json={"student_id": student.id, "source": "管理员补录"},
        headers=admin_headers,
    )
    enrollment_id = enrollment_resp.json()["data"]["id"]
    other_agent = await _create_agent(db, "after-enroll-agent", name="后续坐席")
    student.assigned_to = other_agent.id
    db.add(student)
    await db.commit()

    list_resp = await client.get("/api/admissions/enrollments", headers=admin_headers)
    row = next(item for item in list_resp.json()["data"]["list"] if item["id"] == enrollment_id)
    assert row["attributed_agent_id"] == agent_user.id


@pytest.mark.asyncio
async def test_manual_attribution_change_requires_reason(
    client, db, admin_headers, agent_user
):
    student = await _create_assigned_student(db, agent_user, name="手动归属学生")
    enrollment_resp = await client.post(
        "/api/admissions/enrollments",
        json={"student_id": student.id, "source": "管理员补录"},
        headers=admin_headers,
    )
    enrollment_id = enrollment_resp.json()["data"]["id"]
    other_agent = await _create_agent(db, "manual-attribution-agent", name="手动归属坐席")

    no_reason = await client.patch(
        f"/api/admissions/enrollments/{enrollment_id}",
        json={"attributed_agent_id": other_agent.id},
        headers=admin_headers,
    )
    assert no_reason.status_code == 400

    with_reason = await client.patch(
        f"/api/admissions/enrollments/{enrollment_id}",
        json={"attributed_agent_id": other_agent.id, "attribution_reason": "管理员确认归属"},
        headers=admin_headers,
    )
    assert with_reason.status_code == 200
    assert with_reason.json()["data"]["attributed_agent_id"] == other_agent.id
    assert with_reason.json()["data"]["attribution_method"] == "手动指定"


@pytest.mark.asyncio
async def test_enrollment_summary_groups_by_attributed_agent(
    client, db, admin_headers, agent_user
):
    student1 = await _create_assigned_student(db, agent_user, name="汇总学生1")
    student2 = await _create_assigned_student(db, agent_user, name="汇总学生2")
    for student in (student1, student2):
        resp = await client.post(
            "/api/admissions/enrollments",
            json={"student_id": student.id, "source": "管理员补录"},
            headers=admin_headers,
        )
        assert resp.status_code == 200

    summary = await client.get("/api/admissions/enrollments/summary", headers=admin_headers)
    assert summary.status_code == 200
    row = summary.json()["data"]["list"][0]
    assert row["attributed_agent_id"] == agent_user.id
    assert row["total"] == 2
    assert row["unsettled"] == 2


@pytest.mark.asyncio
async def test_enrollment_payload_includes_attribution_evidence(
    client, db, admin_headers, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user, name="证据学生")
    home_resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "证据家访地址"},
        headers=agent_headers,
    )
    home_id = home_resp.json()["data"]["id"]
    campus_resp = await client.post(
        "/api/admissions/campus-visits",
        json={
            "student_id": student.id,
            "home_visit_task_id": home_id,
            "source": "家访后",
            "appointment_at": "2026-07-04T09:30:00",
        },
        headers=admin_headers,
    )
    campus_id = campus_resp.json()["data"]["id"]
    enrollment_resp = await client.post(
        "/api/admissions/enrollments",
        json={
            "student_id": student.id,
            "source": "到校参观后",
            "campus_visit_task_id": campus_id,
        },
        headers=admin_headers,
    )
    enrollment_id = enrollment_resp.json()["data"]["id"]

    list_resp = await client.get("/api/admissions/enrollments", headers=admin_headers)

    row = next(item for item in list_resp.json()["data"]["list"] if item["id"] == enrollment_id)
    assert row["first_assigned_agent_name"] == agent_user.name
    assert row["current_assigned_agent_name"] == agent_user.name
    assert row["last_effective_agent_name"] == agent_user.name
    assert row["home_visit_creator_agent_name"] == agent_user.name
    assert row["campus_visit_creator_user_name"] == agent_user.name
    assert "工作手机/微信属于公司资产" in row["handover_policy"]


@pytest.mark.asyncio
async def test_dispute_resolution_change_writes_operation_log(
    client, db, admin_headers, agent_user
):
    from app.models import OperationLog

    student = await _create_assigned_student(db, agent_user, name="争议处理学生")
    enrollment_resp = await client.post(
        "/api/admissions/enrollments",
        json={"student_id": student.id, "source": "管理员补录"},
        headers=admin_headers,
    )
    enrollment_id = enrollment_resp.json()["data"]["id"]
    other_agent = await _create_agent(db, "resolved-dispute-agent", name="新接手话务员")

    resp = await client.patch(
        f"/api/admissions/enrollments/{enrollment_id}",
        json={
            "attributed_agent_id": other_agent.id,
            "attribution_reason": "工作手机微信已交接，新话务员继续推进后报名",
            "settlement_status": "未结算",
            "settlement_notes": "争议已处理",
        },
        headers=admin_headers,
    )

    assert resp.status_code == 200
    logs = (
        await db.execute(
            select(OperationLog).where(
                OperationLog.target_student_id == student.id,
                OperationLog.action == "修改报名结算",
            )
        )
    ).scalars().all()
    assert logs
    assert "工作手机微信已交接" in logs[-1].note_content


@pytest.mark.asyncio
async def test_student_detail_includes_admissions_timeline(
    client, db, admin_headers, agent_user, agent_headers
):
    student = await _create_assigned_student(db, agent_user, name="时间线学生")
    home_resp = await client.post(
        "/api/admissions/home-visits",
        json={"student_id": student.id, "address": "时间线家访地址"},
        headers=agent_headers,
    )
    campus_resp = await client.post(
        "/api/admissions/campus-visits",
        json={"student_id": student.id, "appointment_at": "2026-07-04T09:30:00"},
        headers=agent_headers,
    )
    enrollment_resp = await client.post(
        "/api/admissions/enrollments",
        json={
            "student_id": student.id,
            "source": "到校参观后",
            "campus_visit_task_id": campus_resp.json()["data"]["id"],
        },
        headers=admin_headers,
    )
    assert home_resp.status_code == 200
    assert campus_resp.status_code == 200
    assert enrollment_resp.status_code == 200

    detail = await client.get(f"/api/students/{student.id}/detail", headers=admin_headers)
    assert detail.status_code == 200
    timeline = detail.json()["data"]["admissions_timeline"]
    event_types = [event["type"] for event in timeline]
    assert "home_visit" in event_types
    assert "campus_visit" in event_types
    assert "enrollment" in event_types
    assert any(event["title"] == "申请家访" for event in timeline)
    assert any(event["title"] == "预约到校" for event in timeline)
    assert any(event["title"] == "报名登记" for event in timeline)
