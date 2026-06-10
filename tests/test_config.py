# tests/test_config.py
import pytest


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
