"""run the legacy schema/data healing steps once, under Alembic

These idempotent check-then-alter steps used to run on every application start
(app.database.init_db). Databases prepared with scripts/prepare_alembic_baseline.py
already had them applied, so for those this is a no-op; any older stamped database
is healed here exactly once. Startup no longer runs them.

Revision ID: 20261007_01
Revises: 20260925_01
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20261007_01"
down_revision: str | Sequence[str] | None = "20260925_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    from app.legacy_schema_compat import run_legacy_schema_compatibility

    run_legacy_schema_compatibility(op.get_bind())


def downgrade() -> None:
    """The healing steps are forward-only and idempotent; nothing to undo."""
