import pytest

from app.dial_recording import DIAL_RECORDING_COMPLETED
from app.models import DialLog, Note
from app.utils import utcnow


@pytest.mark.asyncio
async def test_call_analysis_endpoints_are_gone(client, admin_headers, sample_student):
    analyze = await client.post(
        "/api/calls/analyze",
        headers=admin_headers,
        json={"student_id": sample_student.id, "transcript": "请介绍报名流程"},
    )
    listed = await client.get("/api/calls", headers=admin_headers)

    assert analyze.status_code in {404, 405}
    assert listed.status_code in {404, 405}


@pytest.mark.asyncio
async def test_student_detail_lists_dial_records_and_hides_ai_notes_from_agents(
    client, db, agent_headers, agent_user, sample_student, assignment_baseline
):
    await assignment_baseline(sample_student, agent_user)
    dial = DialLog(
        student_id=sample_student.id,
        agent_id=agent_user.id,
        dialed_at=utcnow(),
        duration_seconds=120,
        recording_state=DIAL_RECORDING_COMPLETED,
    )
    db.add(dial)
    db.add(
        Note(
            student_id=sample_student.id,
            agent_id=agent_user.id,
            content="【AI 通话摘要】家长有明确报名意向",
            source="ai",
        )
    )
    await db.commit()
    await db.refresh(dial)

    response = await client.get(
        f"/api/students/{sample_student.id}/detail",
        headers=agent_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 0
    assert body["data"]["calls"] == [
        {
            "id": dial.id,
            "agent_id": agent_user.id,
            "agent_name": agent_user.name,
            "duration_seconds": 120,
            "recording_state": DIAL_RECORDING_COMPLETED,
            "created_at": str(dial.dialed_at),
        }
    ]
    assert body["data"]["intent_timeline"] == []
    assert all(note["source"] != "ai" for note in body["data"]["notes"])


@pytest.mark.asyncio
async def test_agent_note_list_hides_ai_notes_but_keeps_human_notes(
    client,
    db,
    agent_headers,
    admin_headers,
    agent_user,
    sample_student,
    assignment_baseline,
):
    await assignment_baseline(sample_student, agent_user)
    human_note = Note(
        student_id=sample_student.id,
        agent_id=agent_user.id,
        content="家长愿意继续了解",
        source="human",
    )
    ai_note = Note(
        student_id=sample_student.id,
        agent_id=agent_user.id,
        content="【AI 通话摘要】家长有明确报名意向",
        source="ai",
    )
    db.add_all([human_note, ai_note])
    await db.commit()
    await db.refresh(human_note)
    await db.refresh(ai_note)

    agent_response = await client.get(
        "/api/notes",
        params={"student_id": sample_student.id},
        headers=agent_headers,
    )
    assert agent_response.status_code == 200
    agent_notes = agent_response.json()["data"]
    agent_note_ids = {note["id"] for note in agent_notes}
    assert human_note.id in agent_note_ids
    assert ai_note.id not in agent_note_ids
    assert all(note["source"] != "ai" for note in agent_notes)

    admin_response = await client.get(
        "/api/notes",
        params={"student_id": sample_student.id},
        headers=admin_headers,
    )
    assert admin_response.status_code == 200
    admin_note_ids = {note["id"] for note in admin_response.json()["data"]}
    assert {human_note.id, ai_note.id}.issubset(admin_note_ids)


@pytest.mark.asyncio
async def test_agent_cannot_update_or_delete_ai_note(
    client, db, agent_headers, agent_user, sample_student
):
    ai_note = Note(
        student_id=sample_student.id,
        agent_id=agent_user.id,
        content="原始 AI 备注",
        source="ai",
    )
    db.add(ai_note)
    await db.commit()
    await db.refresh(ai_note)

    update_response = await client.put(
        f"/api/notes/{ai_note.id}",
        headers=agent_headers,
        json={"content": "坐席尝试修改"},
    )
    assert update_response.status_code == 403
    assert update_response.json()["detail"] == "话务员不可修改或删除AI备注"

    delete_response = await client.delete(
        f"/api/notes/{ai_note.id}",
        headers=agent_headers,
    )
    assert delete_response.status_code == 403
    assert delete_response.json()["detail"] == "话务员不可修改或删除AI备注"

    await db.refresh(ai_note)
    assert ai_note.content == "原始 AI 备注"


@pytest.mark.asyncio
async def test_admin_can_update_and_delete_ai_note(
    client, db, admin_headers, admin_user, sample_student
):
    ai_note = Note(
        student_id=sample_student.id,
        agent_id=admin_user.id,
        content="原始 AI 备注",
        source="ai",
    )
    db.add(ai_note)
    await db.commit()
    await db.refresh(ai_note)

    update_response = await client.put(
        f"/api/notes/{ai_note.id}",
        headers=admin_headers,
        json={"content": "管理员修正 AI 备注"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["data"]["content"] == "管理员修正 AI 备注"

    delete_response = await client.delete(
        f"/api/notes/{ai_note.id}",
        headers=admin_headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["data"]["deleted"] == ai_note.id


@pytest.mark.asyncio
async def test_agent_can_update_and_delete_human_note(
    client, db, agent_headers, agent_user, sample_student
):
    human_note = Note(
        student_id=sample_student.id,
        agent_id=agent_user.id,
        content="原始人工备注",
        source="human",
    )
    db.add(human_note)
    await db.flush()
    db.add(DialLog(student_id=sample_student.id, agent_id=agent_user.id))
    await db.commit()
    await db.refresh(human_note)

    update_response = await client.put(
        f"/api/notes/{human_note.id}",
        headers=agent_headers,
        json={"content": "坐席更新人工备注"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["data"]["content"] == "坐席更新人工备注"

    delete_response = await client.delete(
        f"/api/notes/{human_note.id}",
        headers=agent_headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["data"]["deleted"] == human_note.id


@pytest.mark.asyncio
async def test_admin_assistant_config_keeps_super_admin_boundary(
    client, admin_headers, agent_headers
):
    admin_response = await client.get("/api/admin/assistant/config", headers=admin_headers)
    agent_response = await client.get("/api/admin/assistant/config", headers=agent_headers)

    assert admin_response.status_code == 200
    assert admin_response.json()["code"] == 0
    assert agent_response.status_code == 403
