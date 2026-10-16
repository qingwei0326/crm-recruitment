"""drop the AI call-analysis table and its provider settings

``calls`` was written only by POST /api/calls/analyze (transcript -> AI intent), which
agents were already barred from and nobody used: real dials live in ``dial_logs``. The
readers that counted ``calls`` now read ``dial_logs``. The AI provider settings
(DeepSeek / MiMo / custom) existed only for that analysis, so their system_configs rows,
including the stored API keys, go too.

The downgrade recreates an empty ``calls`` table. Removed settings are not restored;
take them from the pre-release database backup if needed.

Revision ID: 20261017_01
Revises: 20261016_01
"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20261017_01"
down_revision: str | Sequence[str] | None = "20261016_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

AI_CONFIG_KEYS = (
    "deepseek_api_key",
    "ai_provider",
    "mimo_api_key",
    "mimo_base",
    "mimo_model",
    "ai_custom_api_key",
    "ai_custom_base",
    "ai_custom_model",
)


def upgrade() -> None:
    bind = op.get_bind()
    dropped_calls = bind.execute(sa.text("SELECT COUNT(*) FROM calls")).scalar_one()
    configs = sa.table("system_configs", sa.column("key", sa.String))
    removed = bind.execute(sa.delete(configs).where(configs.c.key.in_(AI_CONFIG_KEYS)))
    logger.info(
        "call analysis removed: %d calls rows dropped, %d AI settings deleted",
        dropped_calls,
        removed.rowcount,
    )
    op.drop_table("calls")


def downgrade() -> None:
    op.create_table(
        "calls",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("agent_id", sa.Integer(), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("recording_path", sa.String(length=512), nullable=True),
        sa.Column("transcript", sa.Text(), nullable=True),
        sa.Column("ai_intent", sa.String(length=8), nullable=True),
        sa.Column("ai_reasons", sa.Text(), nullable=True),
        sa.Column("ai_summary", sa.Text(), nullable=True),
        sa.Column("ai_confidence", sa.Float(), nullable=True),
        sa.Column("analyzed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["agent_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calls_agent_id", "calls", ["agent_id"], unique=False)
    op.create_index("ix_calls_created_at", "calls", ["created_at"], unique=False)
    op.create_index("ix_calls_student_id", "calls", ["student_id"], unique=False)
