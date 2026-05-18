import pytest


@pytest.mark.asyncio
async def test_manual_a_level_triggers_pushplus(client, admin_headers, sample_student, monkeypatch):
    called = {}

    async def fake_notify(db, student, operator=None, source=""):
        called["student_id"] = student.id
        called["source"] = source
        return True

    monkeypatch.setattr("app.routers.students.notify_a_level_change", fake_notify)

    resp = await client.put(
        f"/api/students/{sample_student.id}",
        json={"intent_level": "A"},
        headers=admin_headers,
    )
    assert resp.json()["code"] == 0
    assert called["student_id"] == sample_student.id
    assert called["source"] == "manual"
