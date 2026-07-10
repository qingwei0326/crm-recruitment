"""Backfill ownership and work-item domain state.

Revision ID: 20260711_03
Revises: 20260711_02
Create Date: 2026-07-11
"""

import json
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy.orm import Session

from alembic import op
from app.migration_data.domain_backfill_20260711 import (
    audit_domain_core,
    backfill_domain_core,
)

revision: str = "20260711_03"
down_revision: str | Sequence[str] | None = "20260711_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    session = Session(bind=op.get_bind())
    now = datetime.now(UTC).replace(tzinfo=None)
    backfill_domain_core(session, now=now)
    session.flush()
    audit = audit_domain_core(session)
    if not audit["ok"]:
        failures = {key: value for key, value in audit.items() if value and key != "ok"}
        raise RuntimeError(
            f"domain backfill audit failed: {json.dumps(failures, sort_keys=True)}"
        )


def downgrade() -> None:
    op.execute("UPDATE students SET outcome_reason_code = NULL")
    op.execute("DELETE FROM handover_items")
    op.execute("DELETE FROM handover_transfers")
    op.execute("DELETE FROM work_items")
    op.execute("DELETE FROM student_assignments")
    op.execute("DELETE FROM agent_employment_events")
    op.execute("DELETE FROM handover_batches")
    op.execute("DELETE FROM agent_employment")
    op.execute("DELETE FROM lead_outcome_reasons")
