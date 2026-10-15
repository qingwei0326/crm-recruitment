"""fold the legacy visits table into home/campus visit tasks

The old /api/visits records (a type, a date and a note) were superseded by the home and
campus visit task workflow but kept being read by the dashboard funnel and the agent
ranking. Every legacy row moves into the task tables here and ``visits`` is dropped, so
there is one record of a home visit or campus visit. The downgrade recreates the table
and moves the rows back from the operation logs this upgrade writes.

Revision ID: 20261016_01
Revises: 20261007_01
"""

import json
import logging
from collections.abc import Sequence
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op
from app.migration_data.legacy_visits_20261016 import (
    fold_legacy_visits,
    restore_legacy_visits,
)

revision: str = "20261016_01"
down_revision: str | Sequence[str] | None = "20261007_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")


def upgrade() -> None:
    bind = op.get_bind()
    report = fold_legacy_visits(bind, now=datetime.now(UTC).replace(tzinfo=None))
    logger.info("legacy visits folded: %s", json.dumps(report, sort_keys=True))
    op.drop_table("visits")
    if bind.dialect.name == "postgresql":
        sa.Enum(name="visittype").drop(bind, checkfirst=True)
        sa.Enum(name="visitstatus").drop(bind, checkfirst=True)


def downgrade() -> None:
    op.create_table(
        "visits",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("visit_type", sa.Enum("campus", "home", name="visittype"), nullable=False),
        sa.Column("scheduled_date", sa.DateTime(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "confirmed", "completed", "cancelled", name="visitstatus"),
            nullable=False,
        ),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["agent_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_visits_agent_id", "visits", ["agent_id"], unique=False)
    op.create_index("ix_visits_student_id", "visits", ["student_id"], unique=False)
    restored = restore_legacy_visits(op.get_bind())
    logger.info("legacy visits restored: %d", restored)
