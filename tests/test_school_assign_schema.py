import pytest

from app.models import Student, UserRole


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
async def test_school_assign_valid_payload_trims_and_assigns(
    client, db, admin_headers, agent_user
):
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
    await db.refresh(student)
    assert student.assigned_to == agent_user.id
    assert agent_user.role == UserRole.agent
