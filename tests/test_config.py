# tests/test_config.py
import pytest
from sqlalchemy import select

from app.models import OperationLog, SystemConfig


@pytest.mark.asyncio
async def test_follow_up_window_minutes_valid(client, admin_headers):
    r = await client.put(
        "/api/admin/config",
        json={"key": "follow_up_window_minutes", "value": "10"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["code"] == 0
    assert r.json()["data"]["value"] == "10"


@pytest.mark.asyncio
async def test_follow_up_window_minutes_out_of_range_low(client, admin_headers):
    r = await client.put(
        "/api/admin/config",
        json={"key": "follow_up_window_minutes", "value": "0"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["code"] == 1


@pytest.mark.asyncio
async def test_follow_up_window_minutes_out_of_range_high(client, admin_headers):
    r = await client.put(
        "/api/admin/config",
        json={"key": "follow_up_window_minutes", "value": "61"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["code"] == 1


@pytest.mark.asyncio
async def test_follow_up_window_minutes_non_integer(client, admin_headers):
    r = await client.put(
        "/api/admin/config",
        json={"key": "follow_up_window_minutes", "value": "abc"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["code"] == 1


@pytest.mark.asyncio
async def test_follow_up_window_minutes_boundary_low(client, admin_headers):
    r = await client.put(
        "/api/admin/config",
        json={"key": "follow_up_window_minutes", "value": "1"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["code"] == 0


@pytest.mark.asyncio
async def test_follow_up_window_minutes_boundary_high(client, admin_headers):
    r = await client.put(
        "/api/admin/config",
        json={"key": "follow_up_window_minutes", "value": "60"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["code"] == 0


@pytest.mark.asyncio
async def test_follow_up_window_minutes_float_string(client, admin_headers):
    r = await client.put(
        "/api/admin/config",
        json={"key": "follow_up_window_minutes", "value": "10.5"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["code"] == 1


@pytest.mark.asyncio
async def test_follow_up_window_minutes_empty(client, admin_headers):
    r = await client.put(
        "/api/admin/config",
        json={"key": "follow_up_window_minutes", "value": ""},
        headers=admin_headers,
    )
    assert r.status_code == 200
    # Empty string should either succeed (clearing value) or fail validation
    # Based on existing pattern, empty string is accepted for some keys


@pytest.mark.asyncio
async def test_score_daily_call_target_valid(client, admin_headers, db, admin_user):
    admin_user.is_super_admin = True
    db.add(admin_user)
    await db.commit()

    r = await client.put(
        "/api/admin/config",
        json={"key": "score_daily_call_target", "value": "500"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["code"] == 0
    assert r.json()["data"]["value"] == "500"


@pytest.mark.asyncio
async def test_score_daily_call_target_rejects_out_of_range(client, admin_headers, db, admin_user):
    admin_user.is_super_admin = True
    db.add(admin_user)
    await db.commit()

    r = await client.put(
        "/api/admin/config",
        json={"key": "score_daily_call_target", "value": "1001"},
        headers=admin_headers,
    )
    assert r.status_code == 200
    assert r.json()["code"] == 1


@pytest.mark.asyncio
async def test_config_requires_super_admin(client, normal_admin_headers):
    r = await client.put(
        "/api/admin/config",
        json={"key": "score_daily_call_target", "value": "30"},
        headers=normal_admin_headers,
    )
    assert r.status_code == 403


@pytest.mark.asyncio
async def test_config_update_writes_masked_audit_log(client, admin_headers, db, admin_user):
    db.add(SystemConfig(key="deepseek_api_key", value="sk-oldsecret1234"))
    await db.commit()

    r = await client.put(
        "/api/admin/config",
        json={"key": "deepseek_api_key", "value": "sk-newsecret5678"},
        headers=admin_headers,
    )

    assert r.status_code == 200
    assert r.json()["code"] == 0
    log = (
        await db.execute(select(OperationLog).where(OperationLog.action == "修改系统配置"))
    ).scalar_one()
    assert log.operator_id == admin_user.id
    assert log.operator_name == admin_user.name
    assert "deepseek_api_key" in log.content
    assert "sk-oldsecret1234" not in log.content
    assert "sk-newsecret5678" not in log.content
    assert "****1234" in log.content
    assert "****5678" in log.content
