"""close follow-ups and visits left open on students who are 无效 or 已报名

Marking a student 无效 or 已报名 used to close only the contact and help work items, so
their open follow-ups and unvisited home/campus visits stayed open and kept counting as
逾期回访 and in agent scores. The app now closes them on every status change; this
revision does the same for the rows already left open. See
``app/migration_data/terminal_tasks_20261020.py``.

The downgrade reopens the rows from the operation logs this upgrade writes.

Revision ID: 20261020_01
Revises: 20261017_01
"""

import logging
from collections.abc import Sequence
from datetime import UTC, datetime

from alembic import op
from app.migration_data.terminal_tasks_20261020 import (
    close_terminal_students_tasks,
    reopen_terminal_students_tasks,
)

revision: str = "20261020_01"
down_revision: str | Sequence[str] | None = "20261017_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    report = close_terminal_students_tasks(
        op.get_bind(), datetime.now(UTC).replace(tzinfo=None)
    )
    logger.info("Closed tasks of terminal students: %s", report)


def downgrade() -> None:
    reopened = reopen_terminal_students_tasks(op.get_bind())
    logger.info("Reopened tasks of %s terminal students", reopened)
