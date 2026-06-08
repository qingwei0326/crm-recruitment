# tests/test_config.py
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_follow_up_window_minutes_valid(client, admin_headers):
    r = await client.put("/api/admin/config", json={"key": "follow_up_window_minutes", "value": "10"}, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["code"] == 0
    assert r.json()["data"]["value"] == "10"

@pytest.mark.asyncio
async def test_follow_up_window_minutes_out_of_range_low(client, admin_headers):
    r = await client.put("/api/admin/config", json={"key": "follow_up_window_minutes", "value": "0"}, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["code"] == 1

@pytest.mark.asyncio
async def test_follow_up_window_minutes_out_of_range_high(client, admin_headers):
    r = await client.put("/api/admin/config", json={"key": "follow_up_window_minutes", "value": "61"}, headers=admin_headers)
    assert r.status_code == 200
    assert r.json()["code"] == 1
