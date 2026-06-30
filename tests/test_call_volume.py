from datetime import datetime, timedelta

import pytest

from app.models import DialLog, OperationLog, Student, StudentStatus


@pytest.mark.asyncio
async def test_call_volume_counts_dial_logs_not_operation_logs(
    client, db, admin_headers, agent_user
):
    dialed_at = datetime(2026, 6, 26, 18, 0, 0)
    student = Student(
        name="通电量学生",
        status=StudentStatus.not_contacted,
        assigned_to=agent_user.id,
        case_no="case-call-volume",
    )
    db.add(student)
    await db.flush()
    db.add(DialLog(student_id=student.id, agent_id=agent_user.id, dialed_at=dialed_at))
    for i in range(3):
        db.add(
            OperationLog(
                operator_id=agent_user.id,
                operator_name=agent_user.name,
                target_student_id=student.id,
                case_no=student.case_no,
                action="修改状态",
                content=f"操作日志 {i}",
                created_at=dialed_at + timedelta(hours=1, minutes=i),
            )
        )
    await db.commit()

    resp = await client.get(
        "/api/operation-logs/call-volume",
        params={
            "agent_ids": str(agent_user.id),
            "start_date": "2026-06-27",
            "end_date": "2026-06-27",
        },
        headers=admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["total"] == 1
    row = body["data"]["list"][0]
    assert row["agent_name"] == agent_user.name
    assert row["operator_name"] == agent_user.name
    assert row["student_name"] == "通电量学生"
    assert row["student_id"] == student.id
    assert row["duration_seconds"] == 0
    assert row["dialed_at"].startswith("2026-06-26 18:00:00")
    assert body["data"]["summary"] == {
        "total_calls": 1,
        "recorded_calls": 0,
        "unrecorded_calls": 1,
        "total_recorded_duration_seconds": 0,
        "avg_recorded_duration_seconds": 0,
    }


@pytest.mark.asyncio
async def test_call_volume_summary_counts_only_positive_duration_as_recorded(
    client, db, admin_headers, agent_user
):
    student = Student(
        name="汇总学生",
        status=StudentStatus.not_contacted,
        assigned_to=agent_user.id,
        case_no="case-call-volume-summary",
    )
    db.add(student)
    await db.flush()
    db.add_all(
        [
            DialLog(
                student_id=student.id,
                agent_id=agent_user.id,
                dialed_at=datetime(2026, 6, 27, 1, 0, 0),
                duration_seconds=0,
            ),
            DialLog(
                student_id=student.id,
                agent_id=agent_user.id,
                dialed_at=datetime(2026, 6, 27, 1, 5, 0),
                duration_seconds=30,
            ),
            DialLog(
                student_id=student.id,
                agent_id=agent_user.id,
                dialed_at=datetime(2026, 6, 27, 1, 10, 0),
                duration_seconds=90,
            ),
        ]
    )
    await db.commit()

    resp = await client.get(
        "/api/operation-logs/call-volume",
        params={
            "agent_ids": str(agent_user.id),
            "start_date": "2026-06-27",
            "end_date": "2026-06-27",
        },
        headers=admin_headers,
    )
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["total"] == 3
    assert body["data"]["summary"] == {
        "total_calls": 3,
        "recorded_calls": 2,
        "unrecorded_calls": 1,
        "total_recorded_duration_seconds": 120,
        "avg_recorded_duration_seconds": 60,
    }


@pytest.mark.asyncio
async def test_call_volume_requires_admin(client, agent_headers):
    resp = await client.get("/api/operation-logs/call-volume", headers=agent_headers)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_agent_stats_average_duration_ignores_unrecorded_zero_durations(
    client, db, admin_headers, agent_user
):
    student = Student(
        name="平均时长学生",
        status=StudentStatus.not_contacted,
        assigned_to=agent_user.id,
    )
    db.add(student)
    await db.flush()
    db.add_all(
        [
            DialLog(student_id=student.id, agent_id=agent_user.id, duration_seconds=0),
            DialLog(student_id=student.id, agent_id=agent_user.id, duration_seconds=30),
            DialLog(student_id=student.id, agent_id=agent_user.id, duration_seconds=90),
        ]
    )
    await db.commit()

    resp = await client.get(f"/api/stats/agent/{agent_user.id}", headers=admin_headers)
    body = resp.json()

    assert resp.status_code == 200
    assert body["code"] == 0
    assert body["data"]["month_calls"] == 3
    assert body["data"]["month_recorded_calls"] == 2
    assert body["data"]["month_unrecorded_calls"] == 1
    assert body["data"]["recorded_calls"] == 2
    assert body["data"]["unrecorded_calls"] == 1
    assert body["data"]["avg_duration_seconds"] == 60
