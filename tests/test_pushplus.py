import asyncio

import pytest


@pytest.mark.asyncio
async def test_manual_a_level_triggers_pushplus(client, admin_headers, sample_student, monkeypatch):
    called = {}

    async def fake_notify(student_id, operator_name="system", source=""):
        called["student_id"] = student_id
        called["operator_name"] = operator_name
        called["source"] = source
        return True

    monkeypatch.setattr("app.routers.students.notify_a_level_change_background", fake_notify)

    resp = await client.put(
        f"/api/students/{sample_student.id}",
        json={"intent_level": "A"},
        headers=admin_headers,
    )
    await asyncio.sleep(0)

    assert resp.json()["code"] == 0
    assert called["student_id"] == sample_student.id
    assert called["operator_name"] == "测试管理员"
    assert called["source"] == "manual"
