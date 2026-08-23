import pytest

from app.models import Call, DialLog, Note
from app.utils import utcnow

AI_CALL_FIELDS = {
    "transcript",
    "ai_intent",
    "ai_reasons",
    "ai_summary",
    "ai_confidence",
    "analyzed_at",
}


async def _seed_analyzed_call(db, student, agent):
    call = Call(
        student_id=student.id,
        agent_id=agent.id,
        duration_seconds=120,
        transcript="家长明确表示希望了解报名流程",
        ai_intent="A",
        ai_reasons="明确询问报名流程",
        ai_summary="家长有明确报名意向",
        ai_confidence=0.93,
        analyzed_at=utcnow(),
    )
    db.add(call)
    db.add(
        Note(
            student_id=student.id,
            agent_id=agent.id,
            content="【AI 通话摘要】家长有明确报名意向",
            source="ai",
        )
    )
    await db.commit()
    await db.refresh(call)
    return call


@pytest.mark.asyncio
async def test_agent_analyze_is_forbidden_before_analyzer_runs(
    client, agent_headers, sample_student, monkeypatch
):
    async def fail_if_called(*_args, **_kwargs):
        raise AssertionError("agent request must not call analyze_transcript")

    monkeypatch.setattr("app.routers.calls.analyze_transcript", fail_if_called)

    response = await client.post(
        "/api/calls/analyze",
        headers=agent_headers,
        json={
            "student_id": sample_student.id,
            "duration_seconds": 30,
            "transcript": "请介绍报名流程",
        },
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "话务员不可使用AI通话分析"


@pytest.mark.asyncio
async def test_agent_student_detail_hides_ai_call_data(
    client, db, agent_headers, agent_user, sample_student, assignment_baseline
):
    await assignment_baseline(sample_student, agent_user)
    call = await _seed_analyzed_call(db, sample_student, agent_user)

    response = await client.get(
        f"/api/students/{sample_student.id}/detail",
        headers=agent_headers,
    )

    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 0
    call_payload = body["data"]["calls"][0]
    assert AI_CALL_FIELDS.isdisjoint(call_payload)
    assert call_payload["id"] == call.id
    assert call_payload["duration_seconds"] == 120
    assert body["data"]["intent_timeline"] == []
    assert all(note["source"] != "ai" for note in body["data"]["notes"])


@pytest.mark.asyncio
async def test_agent_call_list_hides_ai_data(client, db, agent_headers, agent_user, sample_student):
    call = await _seed_analyzed_call(db, sample_student, agent_user)

    response = await client.get(
        "/api/calls",
        headers=agent_headers,
        params={"student_id": sample_student.id},
    )

    assert response.status_code == 200
    call_payload = response.json()["data"]["list"][0]
    assert AI_CALL_FIELDS.isdisjoint(call_payload)
    assert call_payload["id"] == call.id
    assert call_payload["duration_seconds"] == 120


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
async def test_admin_call_list_keeps_existing_analysis_fields(
    client, db, admin_headers, admin_user, sample_student
):
    call = await _seed_analyzed_call(db, sample_student, admin_user)

    response = await client.get(
        "/api/calls",
        headers=admin_headers,
        params={"student_id": sample_student.id},
    )

    assert response.status_code == 200
    call_payload = response.json()["data"]["list"][0]
    assert call_payload["id"] == call.id
    assert call_payload["ai_intent"] == "A"
    assert call_payload["ai_reasons"] == "明确询问报名流程"
    assert call_payload["ai_summary"] == "家长有明确报名意向"
    assert call_payload["ai_confidence"] == 0.93
    assert call_payload["analyzed_at"]


@pytest.mark.asyncio
async def test_admin_assistant_config_keeps_super_admin_boundary(
    client, admin_headers, agent_headers
):
    admin_response = await client.get("/api/admin/assistant/config", headers=admin_headers)
    agent_response = await client.get("/api/admin/assistant/config", headers=agent_headers)

    assert admin_response.status_code == 200
    assert admin_response.json()["code"] == 0
    assert agent_response.status_code == 403
