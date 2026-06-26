from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_expired_scan_logs_failure(db):
    """Expired scan is disabled and should not send or log notifications."""
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

    expired_at = date.today() - timedelta(days=1)
    student = Student(
        name="过期学生B1",
        intent_level=IntentLevel.B,
        status=StudentStatus.pending_visit,
        expired_at=expired_at,
        assigned_to=agent.id,
    )
    db.add(student)
    await db.commit()
    await db.refresh(student)

    with patch("app.scheduler.send_pushplus_to_user", new_callable=AsyncMock) as send_mock:
        await scan_expired_students()
        send_mock.assert_not_awaited()

    logs = (
        (await db.execute(select(OperationLog).where(OperationLog.action == "通知失败")))
        .scalars()
        .all()
    )
    assert len(logs) == 0
    await db.refresh(student)
    assert student.assigned_to == agent.id
    assert student.status == StudentStatus.pending_visit
    assert student.expired_at == expired_at


@pytest.mark.asyncio
async def test_expired_scan_success_no_log(db):
    """Expired scan remains inert even when an expired lead exists."""
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

    with patch("app.scheduler.send_pushplus_to_user", new_callable=AsyncMock) as send_mock:
        await scan_expired_students()
        send_mock.assert_not_awaited()

    logs = (
        (await db.execute(select(OperationLog).where(OperationLog.action == "通知失败")))
        .scalars()
        .all()
    )
    assert len(logs) == 0
