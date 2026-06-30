from datetime import timedelta

import pytest

from app.models import DialLog, Student, StudentStatus, User
from app.utils import today_cst_as_utc


@pytest.mark.asyncio
async def test_agent_ranking_excludes_disabled_agents_with_no_data(
    client, admin_headers, db, agent_user
):
    disabled_empty = User(
        username="disabled-empty",
        hashed_password="x",
        role="agent",
        name="禁用无数据",
        is_active=False,
    )
    disabled_with_data = User(
        username="disabled-data",
        hashed_password="x",
        role="agent",
        name="禁用有数据",
        is_active=False,
    )
    db.add_all([disabled_empty, disabled_with_data])
    await db.flush()
    db.add(
        Student(
            name="历史线索",
            assigned_to=disabled_with_data.id,
            status=StudentStatus.contacted,
        )
    )
    await db.commit()

    resp = await client.get("/api/stats/agent-ranking", headers=admin_headers)
    body = resp.json()

    assert resp.status_code == 200
    names = [item["name"] for item in body["data"]["ranking"]]
    assert agent_user.name in names
    assert "禁用有数据" in names
    assert "禁用无数据" not in names


@pytest.mark.asyncio
async def test_heatmap_excludes_disabled_agents_with_no_calls(
    client, admin_headers, db, agent_user
):
    disabled_empty = User(
        username="disabled-heat-empty",
        hashed_password="x",
        role="agent",
        name="禁用热力无数据",
        is_active=False,
    )
    disabled_with_call = User(
        username="disabled-heat-data",
        hashed_password="x",
        role="agent",
        name="禁用热力有数据",
        is_active=False,
    )
    db.add_all([disabled_empty, disabled_with_call])
    await db.flush()
    student = Student(name="热力线索", assigned_to=disabled_with_call.id)
    db.add(student)
    await db.flush()
    today = today_cst_as_utc()
    db.add(
        DialLog(
            student_id=student.id,
            agent_id=disabled_with_call.id,
            dialed_at=today + timedelta(hours=1),
        )
    )
    await db.commit()

    resp = await client.get("/api/stats/heatmap", headers=admin_headers)
    body = resp.json()

    assert resp.status_code == 200
    agents = body["data"]["agents"]
    assert agent_user.name in agents
    assert "禁用热力有数据" in agents
    assert "禁用热力无数据" not in agents
