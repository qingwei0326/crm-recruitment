"""Tests for edge cases, error handling, and historical bug patterns."""

from datetime import datetime, timedelta

import pytest

from app.auth import create_access_token
from app.models import DialLog
from app.utils import utcnow


@pytest.mark.asyncio
class TestEnumSerialization:
    """Historical bug: enum serialization returning names instead of values."""

    async def test_student_stage_is_string(self, client, admin_headers, sample_student):
        resp = await client.get(f"/api/students/{sample_student.id}", headers=admin_headers)
        body = resp.json()
        stage = body["data"]["stage"]
        assert isinstance(stage, str)
        assert stage == "初次联系"
        assert "StudentStage" not in str(stage)

    async def test_intent_level_is_string(self, client, admin_headers, sample_student):
        resp = await client.get(f"/api/students/{sample_student.id}", headers=admin_headers)
        body = resp.json()
        intent = body["data"]["intent_level"]
        assert isinstance(intent, str)
        assert intent == "无"
        assert "IntentLevel" not in str(intent)

    async def test_status_is_string(self, client, admin_headers, sample_student):
        resp = await client.get(f"/api/students/{sample_student.id}", headers=admin_headers)
        body = resp.json()
        status = body["data"]["status"]
        assert isinstance(status, str)
        assert status == "未联系"
        assert "StudentStatus" not in str(status)

    async def test_list_returns_proper_enums(self, client, admin_headers, db, sample_student):
        from app.models import IntentLevel, StudentStage

        sample_student.intent_level = IntentLevel.A
        sample_student.stage = StudentStage.enrolled
        await db.commit()

        resp = await client.get("/api/students", headers=admin_headers)
        body = resp.json()
        student = body["data"]["list"][0]
        assert student["intent_level"] == "A"
        assert "IntentLevel" not in str(student["intent_level"])
        assert student["stage"] == "已报名"
        assert "StudentStage" not in str(student["stage"])

    async def test_enums_in_list_response(self, client, admin_headers, sample_student):
        resp = await client.get("/api/students", headers=admin_headers)
        body = resp.json()
        for item in body["data"]["list"]:
            assert isinstance(item["stage"], str)
            assert isinstance(item["status"], str)
            assert isinstance(item["intent_level"], str)


@pytest.mark.asyncio
class TestEncodingEdgeCases:
    """Historical bug: encoding mismatches."""

    async def test_chinese_chars(self, client, admin_headers):
        resp = await client.post(
            "/api/students",
            json={
                "name": "中文测试姓名",
                "region": "中文区域",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0
        assert resp.json()["data"]["name"] == "中文测试姓名"

    async def test_special_chars_in_region(self, client, admin_headers):
        resp = await client.post(
            "/api/students",
            json={
                "name": "Special",
                "region": "区/县-街道·村#号&室",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_emoji_in_name(self, client, admin_headers):
        resp = await client.post(
            "/api/students",
            json={
                "name": "测试🌟✨",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_chinese_name_without_phone(self, client, admin_headers):
        resp = await client.post(
            "/api/students",
            json={
                "name": "Phone测试",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0


@pytest.mark.asyncio
class TestAuthEdgeCases:
    async def test_malformed_bearer(self, client):
        resp = await client.get("/api/auth/me", headers={"Authorization": "Bearer"})
        assert resp.status_code in (401, 403)

    async def test_empty_authorization(self, client):
        resp = await client.get("/api/auth/me", headers={"Authorization": ""})
        assert resp.status_code == 401

    async def test_wrong_auth_scheme(self, client):
        resp = await client.get(
            "/api/auth/me",
            headers={
                "Authorization": "Basic dGVzdDp0ZXN0",
            },
        )
        assert resp.status_code == 401

    async def test_lowercase_bearer(self, client):
        resp = await client.get(
            "/api/auth/me",
            headers={
                "Authorization": "bearer invalid",
            },
        )
        assert resp.status_code in (401, 403)

    async def test_bearer_with_extra_spaces(self, client):
        resp = await client.get(
            "/api/auth/me",
            headers={
                "Authorization": "Bearer  xyz",
            },
        )
        assert resp.status_code in (401, 403)

    async def test_wrong_token_type(self, client):
        resp = await client.get(
            "/api/auth/me",
            headers={
                "Authorization": "Bearer " + "x" * 500,
            },
        )
        assert resp.status_code == 401

    async def test_non_integer_sub_returns_401(self, client):
        """Historical bug: non-integer sub now returns 401 instead of 500."""
        token = create_access_token({"sub": "not-a-number", "role": "admin"})
        resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 401


@pytest.mark.asyncio
class TestCallEndpoints:
    async def test_create_call(self, client, admin_headers, sample_student):
        resp = await client.post(
            "/api/calls/analyze",
            json={
                "student_id": sample_student.id,
                "duration_seconds": 120,
                "transcript": "我想了解一下学校的学费和升学率",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_create_call_empty_transcript(self, client, admin_headers, sample_student):
        resp = await client.post(
            "/api/calls/analyze",
            json={
                "student_id": sample_student.id,
                "duration_seconds": 10,
                "transcript": "",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_create_call_nonexistent_student(self, client, admin_headers):
        resp = await client.post(
            "/api/calls/analyze",
            json={
                "student_id": 99999,
                "duration_seconds": 30,
                "transcript": "test",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 404
        assert resp.json()["detail"] == "学生不存在"

    async def test_check_today_call(self, client, db, admin_headers, admin_user, sample_student):
        db.add(
            DialLog(
                student_id=sample_student.id,
                agent_id=admin_user.id,
                dialed_at=utcnow() - timedelta(minutes=5),
            )
        )
        await db.commit()

        resp = await client.get(
            f"/api/calls/check?student_id={sample_student.id}",
            headers=admin_headers,
        )
        body = resp.json()

        assert body["code"] == 0
        assert body["data"]["count"] == 1
        assert body["data"]["already_called"] is True

    async def test_update_dial_duration_updates_latest_user_dial_log(
        self, client, db, admin_headers, admin_user, sample_student
    ):
        older = DialLog(
            student_id=sample_student.id,
            agent_id=admin_user.id,
            dialed_at=utcnow() - timedelta(minutes=20),
            duration_seconds=5,
        )
        latest = DialLog(
            student_id=sample_student.id,
            agent_id=admin_user.id,
            dialed_at=utcnow() - timedelta(minutes=2),
            duration_seconds=0,
        )
        db.add_all([older, latest])
        await db.commit()
        await db.refresh(older)
        await db.refresh(latest)

        resp = await client.put(
            "/api/students/dial-duration",
            params={"student_id": sample_student.id, "duration_seconds": 73},
            headers=admin_headers,
        )
        body = resp.json()

        assert body["code"] == 0
        assert body["data"]["id"] == latest.id
        assert body["data"]["duration_seconds"] == 73
        await db.refresh(older)
        await db.refresh(latest)
        assert older.duration_seconds == 5
        assert latest.duration_seconds == 73

    async def test_update_dial_duration_without_dial_log_returns_error(
        self, client, admin_headers, sample_student
    ):
        resp = await client.put(
            "/api/students/dial-duration",
            params={"student_id": sample_student.id, "duration_seconds": 30},
            headers=admin_headers,
        )

        assert resp.json()["code"] == 1

    async def test_check_today_call_unknown_student(self, client, admin_headers):
        resp = await client.get("/api/calls/check?student_id=99999", headers=admin_headers)
        assert resp.status_code == 404

    async def test_agent_analyze_unassigned_student_forbidden(
        self, client, agent_headers, sample_student
    ):
        assert sample_student.assigned_to is None
        resp = await client.post(
            "/api/calls/analyze",
            json={
                "student_id": sample_student.id,
                "duration_seconds": 30,
                "transcript": "想了解一下学费",
            },
            headers=agent_headers,
        )
        assert resp.status_code == 403

    async def test_agent_analyze_assigned_to_other_forbidden(
        self,
        client,
        agent_headers,
        admin_user,
        db,
    ):
        from app.models import IntentLevel, Student, StudentStage, StudentStatus

        s = Student(
            name="独占学员",
            region="r",
            assigned_to=admin_user.id,
            stage=StudentStage.initial_contact,
            status=StudentStatus.not_contacted,
            intent_level=IntentLevel.none,
        )
        db.add(s)
        await db.commit()
        await db.refresh(s)
        resp = await client.post(
            "/api/calls/analyze",
            json={
                "student_id": s.id,
                "duration_seconds": 10,
                "transcript": "test",
            },
            headers=agent_headers,
        )
        assert resp.status_code == 403

    async def test_agent_list_calls_scoped(self, client, agent_headers, agent_user):
        resp = await client.get(f"/api/calls?agent_id={agent_user.id + 999}", headers=agent_headers)
        assert resp.status_code == 403

    async def test_check_today_call_missing_param(self, client, admin_headers):
        resp = await client.get("/api/calls/check", headers=admin_headers)
        assert resp.status_code == 422


@pytest.mark.asyncio
class TestNoteEndpoints:
    async def test_create_note(self, client, admin_headers, sample_student):
        resp = await client.post(
            "/api/notes",
            json={
                "student_id": sample_student.id,
                "content": "这是一条测试备注",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_agent_cannot_create_note_without_recent_dial_log(
        self, client, db, agent_user, agent_headers
    ):
        from app.models import Student, StudentStatus

        student = Student(
            name="未拨号写备注",
            assigned_to=agent_user.id,
            status=StudentStatus.not_contacted,
        )
        db.add(student)
        await db.commit()
        await db.refresh(student)

        resp = await client.post(
            "/api/notes",
            json={
                "student_id": student.id,
                "content": "家长说不考虑",
            },
            headers=agent_headers,
        )

        assert resp.status_code == 403
        assert "请先通过系统拨号按钮拨打" in resp.json()["detail"]

    async def test_agent_can_create_note_after_recent_dial_log(
        self, client, db, agent_user, agent_headers
    ):
        from app.models import DialLog, Student, StudentStatus

        student = Student(
            name="已拨号写备注",
            assigned_to=agent_user.id,
            status=StudentStatus.not_contacted,
        )
        db.add(student)
        await db.flush()
        db.add(DialLog(student_id=student.id, agent_id=agent_user.id))
        await db.commit()
        await db.refresh(student)

        resp = await client.post(
            "/api/notes",
            json={
                "student_id": student.id,
                "content": "家长愿意继续了解",
            },
            headers=agent_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_admin_can_create_note_without_dial_log(
        self, client, admin_headers, sample_student
    ):
        resp = await client.post(
            "/api/notes",
            json={
                "student_id": sample_student.id,
                "content": "管理员备注",
            },
            headers=admin_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_agent_cannot_update_note_without_recent_dial_log(
        self, client, db, agent_user, agent_headers
    ):
        from app.models import Note, Student, StudentStatus

        student = Student(
            name="未拨号改备注",
            assigned_to=agent_user.id,
            status=StudentStatus.not_contacted,
        )
        db.add(student)
        await db.flush()
        note = Note(student_id=student.id, agent_id=agent_user.id, content="原备注")
        db.add(note)
        await db.commit()
        await db.refresh(note)

        resp = await client.put(
            f"/api/notes/{note.id}",
            json={"content": "改成联系结果"},
            headers=agent_headers,
        )

        assert resp.status_code == 403
        assert "请先通过系统拨号按钮拨打" in resp.json()["detail"]

    async def test_agent_can_update_note_after_recent_dial_log(
        self, client, db, agent_user, agent_headers
    ):
        from app.models import DialLog, Note, Student, StudentStatus

        student = Student(
            name="已拨号改备注",
            assigned_to=agent_user.id,
            status=StudentStatus.not_contacted,
        )
        db.add(student)
        await db.flush()
        note = Note(student_id=student.id, agent_id=agent_user.id, content="原备注")
        db.add(note)
        db.add(DialLog(student_id=student.id, agent_id=agent_user.id))
        await db.commit()
        await db.refresh(note)

        resp = await client.put(
            f"/api/notes/{note.id}",
            json={"content": "改成联系结果"},
            headers=agent_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_admin_can_update_note_without_dial_log(
        self, client, db, admin_headers, agent_user, sample_student
    ):
        from app.models import Note

        note = Note(student_id=sample_student.id, agent_id=agent_user.id, content="原备注")
        db.add(note)
        await db.commit()
        await db.refresh(note)

        resp = await client.put(
            f"/api/notes/{note.id}",
            json={"content": "管理员修正备注"},
            headers=admin_headers,
        )

        assert resp.status_code == 200
        assert resp.json()["code"] == 0

    async def test_create_note_empty_content(self, client, admin_headers, sample_student):
        resp = await client.post(
            "/api/notes",
            json={
                "student_id": sample_student.id,
                "content": "",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 422

    async def test_list_notes(self, client, admin_headers, sample_student):
        resp = await client.get(f"/api/notes?student_id={sample_student.id}", headers=admin_headers)
        assert resp.json()["code"] == 0


@pytest.mark.asyncio
class TestVisitEndpoints:
    async def test_create_visit(self, client, admin_headers, sample_student):
        resp = await client.post(
            "/api/visits",
            json={
                "student_id": sample_student.id,
                "visit_type": "来校参观",
                "scheduled_date": "2026-06-01T10:00:00",
                "notes": "预约参观",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_create_visit_invalid_type(self, client, admin_headers, sample_student):
        resp = await client.post(
            "/api/visits",
            json={
                "student_id": sample_student.id,
                "visit_type": "无效类型",
                "scheduled_date": "2026-06-01T10:00:00",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 422

    async def test_visits_summary(self, client, admin_headers, db, admin_user):
        from app.models import Student, Visit, VisitStatus, VisitType

        s = Student(name="vtest", region="r")
        db.add(s)
        await db.commit()
        db.add(
            Visit(
                student_id=s.id,
                agent_id=admin_user.id,
                visit_type=VisitType.campus,
                scheduled_date=datetime(2026, 6, 1),
                status=VisitStatus.pending,
            )
        )
        await db.commit()
        resp = await client.get("/api/visits/summary", headers=admin_headers)
        assert resp.json()["code"] == 0

    async def test_update_visit_invalid_type_returns_422(
        self, client, admin_headers, sample_student
    ):
        create_resp = await client.post(
            "/api/visits",
            json={
                "student_id": sample_student.id,
                "visit_type": "来校参观",
                "scheduled_date": "2026-06-01T10:00:00",
            },
            headers=admin_headers,
        )
        visit_id = create_resp.json()["data"]["id"]

        resp = await client.put(
            f"/api/visits/{visit_id}",
            json={
                "visit_type": "无效类型",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 422

    async def test_update_visit_invalid_status_returns_422(
        self, client, admin_headers, sample_student
    ):
        create_resp = await client.post(
            "/api/visits",
            json={
                "student_id": sample_student.id,
                "visit_type": "来校参观",
                "scheduled_date": "2026-06-01T10:00:00",
            },
            headers=admin_headers,
        )
        visit_id = create_resp.json()["data"]["id"]

        resp = await client.put(
            f"/api/visits/{visit_id}",
            json={
                "status": "未知状态",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 422


@pytest.mark.asyncio
class TestFollowUpEndpoints:
    async def test_create_follow_up(self, client, admin_headers, sample_student):
        resp = await client.post(
            "/api/follow-ups",
            json={
                "student_id": sample_student.id,
                "follow_up_date": "2026-06-01T10:00:00",
            },
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_list_follow_ups(self, client, admin_headers, sample_student):
        resp = await client.get(
            f"/api/follow-ups?student_id={sample_student.id}",
            headers=admin_headers,
        )
        assert resp.json()["code"] == 0

    async def test_admin_list_follow_ups_without_student_id_returns_page(
        self, client, admin_headers, sample_student
    ):
        create_resp = await client.post(
            "/api/follow-ups",
            json={
                "student_id": sample_student.id,
                "follow_up_date": "2026-06-01T10:00:00",
            },
            headers=admin_headers,
        )
        assert create_resp.json()["code"] == 0

        resp = await client.get(
            "/api/follow-ups?is_completed=false&page_size=100",
            headers=admin_headers,
        )

        body = resp.json()
        assert body["code"] == 0
        page = body["data"]
        assert page["total"] == 1
        assert page["page"] == 1
        assert page["page_size"] == 100
        assert len(page["list"]) == 1
        item = page["list"][0]
        assert item["student_id"] == sample_student.id
        assert item["student_name"] == sample_student.name
        assert item["student_region"] == sample_student.region
        assert item["student_status"] == "待回访"
        assert item["agent_name"]
