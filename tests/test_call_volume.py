from datetime import datetime, timedelta

import pytest

from app.models import DialLog, OperationLog, Student, StudentStatus


@pytest.mark.asyncio
async def test_call_volume_counts_dial_logs_not_operation_logs(
    client, db, admin_headers, agent_user
):
    dialed_at = datetime(2026, 6, 26, 18, 0, 0)
    student = Student(
        name="通电量学生",
        status=StudentStatus.not_contacted,
        assigned_to=agent_user.id,
        case_no="case-call-volume",
    )
    db.add(student)
    await db.flush()
    db.add(DialLog(student_id=student.id, agent_id=agent_user.id, dialed_at=dialed_at))
    for i in range(3):
        db.add(
            OperationLog(
                operator_id=agent_user.id,
                operator_name=agent_user.name,
                target_student_id=student.id,
                case_no=student.case_no,
                action="修改状态",
                content=f"操作日志 {i}",
                created_at=dialed_at + timedelta(hours=1, minutes=i),
            )
        )
    await db.commit()

    resp = await client.get(
        "/api/operation-logs/call-volume",
        params={
            "agent_ids": str(agent_user.id),
            "start_date": "2026-06-27",
            "end_date": "2026-06-27",
        },
        headers=admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["total"] == 1
    row = body["data"]["list"][0]
    assert row["agent_name"] == agent_user.name
    assert row["operator_name"] == agent_user.name
    assert row["student_name"] == "通电量学生"
    assert row["student_id"] == student.id
    assert row["duration_seconds"] == 0
    assert row["dialed_at"].startswith("2026-06-26 18:00:00")
    assert body["data"]["summary"] == {
        "total_calls": 1,
        "recorded_calls": 0,
        "unrecorded_calls": 1,
        "total_recorded_duration_seconds": 0,
        "avg_recorded_duration_seconds": 0,
    }


@pytest.mark.asyncio
async def test_call_volume_summary_counts_only_positive_duration_as_recorded(
    client, db, admin_headers, agent_user
):
    student = Student(
        name="汇总学生",
        status=StudentStatus.not_contacted,
        assigned_to=agent_user.id,
        case_no="case-call-volume-summary",
    )
    db.add(student)
    await db.flush()
    db.add_all(
        [
            DialLog(
                student_id=student.id,
                agent_id=agent_user.id,
                dialed_at=datetime(2026, 6, 27, 1, 0, 0),
                duration_seconds=0,
            ),
            DialLog(
                student_id=student.id,
                agent_id=agent_user.id,
                dialed_at=datetime(2026, 6, 27, 1, 5, 0),
                duration_seconds=30,
            ),
            DialLog(
                student_id=student.id,
                agent_id=agent_user.id,
                dialed_at=datetime(2026, 6, 27, 1, 10, 0),
                duration_seconds=90,
            ),
        ]
    )
    await db.commit()

    resp = await client.get(
        "/api/operation-logs/call-volume",
        params={
            "agent_ids": str(agent_user.id),
            "start_date": "2026-06-27",
            "end_date": "2026-06-27",
        },
        headers=admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["total"] == 3
    assert body["data"]["summary"] == {
        "total_calls": 3,
        "recorded_calls": 2,
        "unrecorded_calls": 1,
        "total_recorded_duration_seconds": 120,
        "avg_recorded_duration_seconds": 60,
    }


@pytest.mark.asyncio
async def test_call_volume_requires_admin(client, agent_headers):
    resp = await client.get("/api/operation-logs/call-volume", headers=agent_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_call_volume_requires_report_page_permission(client, normal_admin_headers):
    resp = await client.get("/api/operation-logs/call-volume", headers=normal_admin_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_call_volume_allows_report_page_permission(
    client, db, normal_admin_user, normal_admin_headers
):
    normal_admin_user.page_permissions = "report_center"
    await db.commit()

    resp = await client.get("/api/operation-logs/call-volume", headers=normal_admin_headers)

    assert resp.status_code == 200
    assert resp.json()["code"] == 0


@pytest.mark.asyncio
async def test_operation_log_list_returns_admin_audit_rows(client, db, admin_headers, admin_user):
    student = Student(
        name="审计学生",
        school_name="长泰二中",
        status=StudentStatus.not_contacted,
        case_no="audit-case-1",
    )
    db.add(student)
    await db.flush()
    db.add_all(
        [
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="登录",
                content="IP 127.0.0.1",
                created_at=datetime(2026, 6, 29, 23, 50, 0),
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                target_student_id=student.id,
                case_no=student.case_no,
                action="删除线索",
                content="删除学生 审计学生",
                created_at=datetime(2026, 6, 30, 1, 30, 0),
            ),
        ]
    )
    await db.commit()

    resp = await client.get(
        "/api/operation-logs",
        params={"start_date": "2026-06-30", "end_date": "2026-06-30"},
        headers=admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["total"] == 2
    assert [row["action"] for row in body["data"]["list"]] == ["删除线索", "登录"]
    delete_row = body["data"]["list"][0]
    assert delete_row["operator_name"] == admin_user.name
    assert delete_row["student_name"] == "审计学生"
    assert delete_row["student_school_name"] == "长泰二中"
    assert delete_row["case_no"] == "audit-case-1"
    assert delete_row["content"] == "删除学生 审计学生"
    assert {"action": "登录", "count": 1} in body["data"]["actions"]
    assert {"action": "删除线索", "count": 1} in body["data"]["actions"]
    assert delete_row["category"] == "删除"
    assert {"category": "登录安全", "count": 1} in body["data"]["categories"]
    assert {"category": "删除", "count": 1} in body["data"]["categories"]


@pytest.mark.asyncio
async def test_operation_log_list_filters_action_operator_and_keyword(
    client, db, admin_headers, admin_user, agent_user
):
    student = Student(
        name="关键字学生",
        school_name="长泰二中",
        status=StudentStatus.not_contacted,
        case_no="audit-case-2",
    )
    db.add(student)
    await db.flush()
    db.add_all(
        [
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                target_student_id=student.id,
                case_no=student.case_no,
                action="学校分配",
                content="学校「长泰二中」分配给话务员",
                created_at=datetime(2026, 6, 30, 2, 0, 0),
            ),
            OperationLog(
                operator_id=agent_user.id,
                operator_name=agent_user.name,
                action="登录",
                content="IP 127.0.0.2",
                created_at=datetime(2026, 6, 30, 2, 5, 0),
            ),
        ]
    )
    await db.commit()

    resp = await client.get(
        "/api/operation-logs",
        params={
            "action": "学校分配",
            "operator_id": str(admin_user.id),
            "q": "长泰二中",
        },
        headers=admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["total"] == 1
    row = body["data"]["list"][0]
    assert row["action"] == "学校分配"
    assert row["operator_id"] == admin_user.id
    assert row["student_name"] == "关键字学生"
    assert row["category"] == "分配"


@pytest.mark.asyncio
async def test_operation_logs_filter_by_category(client, db, admin_headers, admin_user):
    db.add_all(
        [
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="学校分配汇总",
                content="共 2 名",
                batch_id="school-assign-summary-test",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="登录",
                content="登录成功",
            ),
        ]
    )
    await db.commit()

    resp = await client.get(
        "/api/operation-logs",
        params={"category": "分配"},
        headers=admin_headers,
    )
    body = resp.json()
    data = body["data"]

    assert resp.status_code == 200
    assert body["code"] == 0
    assert data["total"] == 1
    assert data["list"][0]["action"] == "学校分配汇总"
    assert data["list"][0]["category"] == "分配"
    assert data["list"][0]["can_rollback_assignment"] is True
    assert {"category": "分配", "count": 1} in data["categories"]


@pytest.mark.asyncio
async def test_operation_logs_only_show_assignment_rollback_on_summary_rows(
    client, db, admin_headers, admin_user
):
    student = Student(name="明细分配", school_name="回滚学校")
    db.add(student)
    await db.flush()
    db.add_all(
        [
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                target_student_id=student.id,
                action="学校分配",
                content="学校「回滚学校」分配给话务员",
                batch_id="school-assign-test",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="学校分配汇总",
                content="学校「回滚学校」分发，共 1 名",
                batch_id="school-assign-test",
            ),
        ]
    )
    await db.commit()

    resp = await client.get("/api/operation-logs", headers=admin_headers)
    body = resp.json()
    rows_by_action = {row["action"]: row for row in body["data"]["list"]}

    assert resp.status_code == 200
    assert body["code"] == 0
    assert rows_by_action["学校分配"]["can_rollback_assignment"] is False
    assert rows_by_action["学校分配汇总"]["can_rollback_assignment"] is True


@pytest.mark.asyncio
async def test_operation_logs_filter_other_category_returns_unmapped_actions(
    client, db, admin_headers, admin_user
):
    db.add_all(
        [
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="未知历史动作",
                content="旧版本留下的未归类动作",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="登录",
                content="登录成功",
            ),
        ]
    )
    await db.commit()

    resp = await client.get(
        "/api/operation-logs",
        params={"category": "其他"},
        headers=admin_headers,
    )
    body = resp.json()
    data = body["data"]

    assert resp.status_code == 200
    assert body["code"] == 0
    assert data["total"] == 1
    assert data["list"][0]["action"] == "未知历史动作"
    assert data["list"][0]["category"] == "其他"
    assert {"category": "其他", "count": 1} in data["categories"]


@pytest.mark.asyncio
async def test_operation_logs_maps_common_legacy_actions_to_clear_categories(
    client, db, admin_headers, admin_user
):
    db.add_all(
        [
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="线索回收",
                content="回收未跟进线索",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="写备注",
                content="补充沟通记录",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="数据修复",
                content="修复历史状态",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="前端错误",
                content="页面异常",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="分配回滚汇总",
                content="回滚分配批次 school-assign-test，成功 1 条，跳过 0 条",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="修改报名后状态",
                content="定金待收 → 已缴费",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="手动备份",
                content="创建备份",
            ),
        ]
    )
    await db.commit()

    resp = await client.get("/api/operation-logs", headers=admin_headers)
    body = resp.json()
    data = body["data"]
    categories_by_action = {row["action"]: row["category"] for row in data["list"]}

    assert resp.status_code == 200
    assert body["code"] == 0
    assert categories_by_action["线索回收"] == "线索治理"
    assert categories_by_action["写备注"] == "跟进记录"
    assert categories_by_action["数据修复"] == "数据维护"
    assert categories_by_action["前端错误"] == "系统异常"
    assert categories_by_action["分配回滚汇总"] == "分配"
    assert categories_by_action["修改报名后状态"] == "状态变更"
    assert categories_by_action["手动备份"] == "数据维护"
    assert {"category": "线索治理", "count": 1} in data["categories"]
    assert {"category": "跟进记录", "count": 1} in data["categories"]
    assert {"category": "数据维护", "count": 2} in data["categories"]
    assert {"category": "系统异常", "count": 1} in data["categories"]
    assert {"category": "分配", "count": 1} in data["categories"]
    assert {"category": "状态变更", "count": 1} in data["categories"]


@pytest.mark.asyncio
async def test_operation_logs_filter_by_batch_id(client, db, admin_headers, admin_user):
    db.add_all(
        [
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="数据清理",
                content="批次 phone-dedupe-test：清理重复手机号",
                batch_id="phone-dedupe-test",
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                action="登录",
                content="登录成功",
                batch_id="",
            ),
        ]
    )
    await db.commit()

    resp = await client.get(
        "/api/operation-logs",
        params={"batch_id": "phone-dedupe-test"},
        headers=admin_headers,
    )
    body = resp.json()
    data = body["data"]

    assert resp.status_code == 200
    assert body["code"] == 0
    assert data["total"] == 1
    assert data["list"][0]["action"] == "数据清理"
    assert data["list"][0]["batch_id"] == "phone-dedupe-test"
    assert data["categories"] == [{"category": "删除", "count": 1}]


@pytest.mark.asyncio
async def test_operation_log_list_requires_admin(client, agent_headers):
    resp = await client.get("/api/operation-logs", headers=agent_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_operation_log_list_requires_audit_page_permission(client, normal_admin_headers):
    resp = await client.get("/api/operation-logs", headers=normal_admin_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_operation_log_list_allows_audit_page_permission(
    client, db, normal_admin_user, normal_admin_headers
):
    normal_admin_user.page_permissions = "audit_logs"
    await db.commit()

    resp = await client.get("/api/operation-logs", headers=normal_admin_headers)

    assert resp.status_code == 200
    assert resp.json()["code"] == 0


@pytest.mark.asyncio
async def test_agent_stats_average_duration_ignores_unrecorded_zero_durations(
    client, db, admin_headers, agent_user
):
    student = Student(
        name="平均时长学生",
        status=StudentStatus.not_contacted,
        assigned_to=agent_user.id,
    )
    db.add(student)
    await db.flush()
    db.add_all(
        [
            DialLog(student_id=student.id, agent_id=agent_user.id, duration_seconds=0),
            DialLog(student_id=student.id, agent_id=agent_user.id, duration_seconds=30),
            DialLog(student_id=student.id, agent_id=agent_user.id, duration_seconds=90),
        ]
    )
    await db.commit()

    resp = await client.get(f"/api/stats/agent/{agent_user.id}", headers=admin_headers)
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["month_calls"] == 3
    assert body["data"]["month_recorded_calls"] == 2
    assert body["data"]["month_unrecorded_calls"] == 1
    assert body["data"]["recorded_calls"] == 2
    assert body["data"]["unrecorded_calls"] == 1
    assert body["data"]["avg_duration_seconds"] == 60
