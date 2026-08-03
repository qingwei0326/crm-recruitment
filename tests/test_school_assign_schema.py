import pytest
from sqlalchemy import select

from app.models import OperationLog, Student, StudentStatus, UserRole
from app.utils import parse_assignment_rollback_note


@pytest.mark.asyncio
async def test_school_assign_rejects_blank_school_name(client, admin_headers):
    resp = await client.post(
        "/api/students/school-assign",
        json={"school_name": "   ", "agent_ids": [1]},
        headers=admin_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_school_assign_rejects_non_list_agent_ids(client, admin_headers):
    resp = await client.post(
        "/api/students/school-assign",
        json={"school_name": "测试学校", "agent_ids": "1"},
        headers=admin_headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_school_assign_valid_payload_trims_and_assigns(client, db, admin_headers, agent_user):
    student = Student(name="待分配", school_name="测试学校")
    db.add(student)
    await db.commit()

    resp = await client.post(
        "/api/students/school-assign",
        json={"school_name": " 测试学校 ", "agent_ids": [agent_user.id], "regions": [" "]},
        headers=admin_headers,
    )

    body = resp.json()
    assert body["code"] == 0
    assert body["data"]["total_assigned"] == 1
    assert body["data"]["batch_id"].startswith("school-assign-")
    await db.refresh(student)
    assert student.assigned_to == agent_user.id
    assert agent_user.role == UserRole.agent

    log = (
        await db.execute(
            select(OperationLog).where(
                OperationLog.target_student_id == student.id,
                OperationLog.action == "修改归属",
            )
        )
    ).scalar_one()
    assert log.content == f"未分配 -> {agent_user.id}"
    assert log.batch_id == body["data"]["batch_id"]
    assert log.old_status == "unassigned"
    assert log.new_status == f"agent:{agent_user.id}"
    rollback_payload = parse_assignment_rollback_note(log.note_content)
    assert rollback_payload["old_assigned_to"] is None
    assert rollback_payload["new_assigned_to"] == agent_user.id

    summary = (
        await db.execute(
            select(OperationLog).where(
                OperationLog.target_student_id.is_(None),
                OperationLog.action == "学校分配汇总",
            )
        )
    ).scalar_one()
    assert "学校「测试学校」分发，共 1 名" in summary.content
    assert f"话务员：{agent_user.id}" in summary.content
    assert "样例：待分配" in summary.content
    assert summary.batch_id == body["data"]["batch_id"]


@pytest.mark.asyncio
async def test_school_dispatch_options_exclude_unassigned_terminal_students(
    client, db, admin_headers
):
    invalid_only_school = "福建漳州蓝田经济开发区实验小学"
    db.add_all(
        [
            Student(
                name="无效学生",
                school_name=invalid_only_school,
                region="龙文区",
                status=StudentStatus.invalid,
            ),
            Student(
                name="可分配学生",
                school_name="龙文区可分配学校",
                region="龙文区",
                status=StudentStatus.not_contacted,
            ),
            Student(
                name="已报名学生",
                school_name="龙文区可分配学校",
                region="龙文区",
                status=StudentStatus.enrolled,
            ),
        ]
    )
    await db.commit()

    regions_resp = await client.get("/api/students/dispatch-regions", headers=admin_headers)
    schools_resp = await client.get(
        "/api/students/schools",
        params={"regions": "龙文区"},
        headers=admin_headers,
    )
    students_resp = await client.get(
        "/api/students",
        params={
            "assignment": "unassigned",
            "assignable": "1",
            "school_name": "龙文区可分配学校",
        },
        headers=admin_headers,
    )

    assert regions_resp.status_code == 200
    assert regions_resp.json()["data"] == [{"name": "龙文区", "count": 1}]
    assert schools_resp.status_code == 200
    assert schools_resp.json()["data"] == [{"name": "龙文区可分配学校", "count": 1}]
    assert students_resp.status_code == 200
    assert [item["name"] for item in students_resp.json()["data"]["list"]] == ["可分配学生"]
