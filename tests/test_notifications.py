from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_expired_scan_logs_failure(db):
    """When PushPlus fails, OperationLog should have a 通知失败 entry."""
    from datetime import date, timedelta

    from sqlalchemy import select

    # Create an agent
    from app.auth import hash_password
    from app.models import IntentLevel, OperationLog, Student, StudentStatus, User
    from app.scheduler import scan_expired_students

    agent = User(
        username="testagent_b1",
        hashed_password=hash_password("pass"),
        role="agent",
        name="B1 Agent",
        is_active=True,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    # Create an expired student assigned to this agent
    student = Student(
        name="过期学生B1",
        intent_level=IntentLevel.B,
        status=StudentStatus.pending_visit,
        expired_at=date.today() - timedelta(days=1),
        assigned_to=agent.id,
    )
    db.add(student)
    await db.commit()

    # Patch PushPlus to fail
    with patch("app.scheduler.send_pushplus_to_user", new_callable=AsyncMock, return_value=False):
        await scan_expired_students()

    # Check OperationLog
    logs = (
        (await db.execute(select(OperationLog).where(OperationLog.action == "通知失败")))
        .scalars()
        .all()
    )
    assert len(logs) == 1
    assert logs[0].operator_name == "scheduler"
    assert "agent_id=" in logs[0].content


@pytest.mark.asyncio
async def test_expired_scan_success_no_log(db):
    """When PushPlus succeeds, no notify_fail OperationLog should be created."""
    from datetime import date, timedelta

    from sqlalchemy import select

    from app.auth import hash_password
    from app.models import IntentLevel, OperationLog, Student, User
    from app.scheduler import scan_expired_students

    agent = User(
        username="testagent_b1_ok",
        hashed_password=hash_password("pass"),
        role="agent",
        name="B1 OK Agent",
        is_active=True,
    )
    db.add(agent)
    await db.commit()
    await db.refresh(agent)

    student = Student(
        name="过期学生B1OK",
        intent_level=IntentLevel.B,
        status="待回访",
        expired_at=date.today() - timedelta(days=1),
        assigned_to=agent.id,
    )
    db.add(student)
    await db.commit()

    with patch("app.scheduler.send_pushplus_to_user", new_callable=AsyncMock, return_value=True):
        await scan_expired_students()

    logs = (
        (await db.execute(select(OperationLog).where(OperationLog.action == "通知失败")))
        .scalars()
        .all()
    )
    assert len(logs) == 0
