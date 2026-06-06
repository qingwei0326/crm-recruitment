"""Tests for scheduler helpers."""

import pytest
from app.scheduler import scan_expired_students, scan_follow_up_reminders


class TestScheduler:
    """Basic smoke tests — ensure schedulers don't crash on empty DB."""

    @pytest.mark.asyncio
    async def test_scan_follow_up_reminders_empty_db(self):
        await scan_follow_up_reminders()

    @pytest.mark.asyncio
    async def test_scan_expired_students_empty_db(self):
        await scan_expired_students()
