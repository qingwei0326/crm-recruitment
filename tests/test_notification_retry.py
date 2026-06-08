"""Tests for notification retry mechanism."""
import pytest
from unittest.mock import patch, AsyncMock
from datetime import timedelta

from app.models import OperationLog
from app.utils import utcnow


@pytest.mark.asyncio
async def test_retry_sends_and_deletes_log(db):
    """Successful retry should delete the failure log."""
    from app.scheduler import retry_failed_notifications

    # Create a failure log with parseable content
    log = OperationLog(
        operator_id=None,
        operator_name="scheduler",
        action="通知失败",
        content="CRM 测试标题|||agent_id=999|||test content here",
        created_at=utcnow(),
    )
    db.add(log)
    await db.commit()
    log_id = log.id

    # Mock send_pushplus_to_user to succeed
    with patch("app.scheduler.send_pushplus_to_user", new_callable=AsyncMock, return_value=True):
        await retry_failed_notifications()

    # Log should be deleted
    from sqlalchemy import select
    remaining = (await db.execute(
        select(OperationLog).where(OperationLog.id == log_id)
    )).scalars().all()
    assert len(remaining) == 0


@pytest.mark.asyncio
async def test_retry_keeps_log_on_failure(db):
    """Failed retry should keep the failure log."""
    from app.scheduler import retry_failed_notifications

    log = OperationLog(
        operator_id=None,
        operator_name="scheduler",
        action="通知失败",
        content="CRM 测试标题|||agent_id=999|||test content here",
        created_at=utcnow(),
    )
    db.add(log)
    await db.commit()
    log_id = log.id

    # Mock send_pushplus_to_user to fail
    with patch("app.scheduler.send_pushplus_to_user", new_callable=AsyncMock, return_value=False):
        await retry_failed_notifications()

    # Log should still exist
    from sqlalchemy import select
    remaining = (await db.execute(
        select(OperationLog).where(OperationLog.id == log_id)
    )).scalars().all()
    assert len(remaining) == 1


@pytest.mark.asyncio
async def test_retry_skips_old_logs(db):
    """Logs older than 24h should not be retried."""
    from app.scheduler import retry_failed_notifications

    log = OperationLog(
        operator_id=None,
        operator_name="scheduler",
        action="通知失败",
        content="CRM 旧标题|||agent_id=999|||old content",
        created_at=utcnow() - timedelta(hours=25),
    )
    db.add(log)
    await db.commit()
    log_id = log.id

    with patch("app.scheduler.send_pushplus_to_user", new_callable=AsyncMock, return_value=True):
        await retry_failed_notifications()

    # Old log should NOT be touched (not within 24h window)
    from sqlalchemy import select
    remaining = (await db.execute(
        select(OperationLog).where(OperationLog.id == log_id)
    )).scalars().all()
    assert len(remaining) == 1
