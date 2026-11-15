"""drop the super-admin AI assistant tables

The assistant (chat panel, tool calls and its OpenAI-format provider settings) was removed
from the app. Its five tables held only assistant data: the encrypted provider API key,
chat sessions, runs, messages and tool-call records. Nothing else references them.

The downgrade recreates the empty tables. Dropped rows, including the stored API key,
are not restored; take them from the pre-release database backup if needed.

Revision ID: 20261115_01
Revises: 20261026_02
"""

import logging
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261115_01"
down_revision: str | Sequence[str] | None = "20261026_02"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

logger = logging.getLogger("alembic.runtime.migration")

# Children first, so foreign keys never point at a dropped table.
ASSISTANT_TABLES = (
    "assistant_tool_calls",
    "assistant_messages",
    "assistant_runs",
    "assistant_sessions",
    "assistant_configs",
)


def upgrade() -> None:
    bind = op.get_bind()
    counts = {
        table: bind.execute(sa.text(f"SELECT COUNT(*) FROM {table}")).scalar_one()
        for table in ASSISTANT_TABLES
    }
    logger.info(
        "assistant removed: dropping %s",
        ", ".join(f"{table} ({count} rows)" for table, count in counts.items()),
    )
    op.drop_index("ix_assistant_tool_calls_status_expires", table_name="assistant_tool_calls")
    op.drop_index("ix_assistant_tool_calls_session_created", table_name="assistant_tool_calls")
    op.drop_table("assistant_tool_calls")
    op.drop_index("ix_assistant_messages_session_created", table_name="assistant_messages")
    op.drop_table("assistant_messages")
    op.drop_index("ix_assistant_runs_session_created", table_name="assistant_runs")
    op.drop_table("assistant_runs")
    op.drop_index("ix_assistant_sessions_owner_updated", table_name="assistant_sessions")
    op.drop_table("assistant_sessions")
    op.drop_table("assistant_configs")


def downgrade() -> None:
    op.create_table(
        "assistant_configs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("base_url", sa.String(length=512), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("api_key_ciphertext", sa.Text(), nullable=False),
        sa.Column("api_key_last4", sa.String(length=8), nullable=False),
        sa.Column("updated_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["updated_by"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_table(
        "assistant_sessions",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_assistant_sessions_owner_updated",
        "assistant_sessions",
        ["owner_id", "updated_at"],
    )
    op.create_table(
        "assistant_runs",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("operator_id", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("model", sa.String(length=128), nullable=False),
        sa.Column("provider_request_id", sa.String(length=128), nullable=False),
        sa.Column("prompt_tokens", sa.Integer(), nullable=False),
        sa.Column("completion_tokens", sa.Integer(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["operator_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["session_id"], ["assistant_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_assistant_runs_session_created",
        "assistant_runs",
        ["session_id", "created_at"],
    )
    op.create_table(
        "assistant_messages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["assistant_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["session_id"], ["assistant_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_assistant_messages_session_created",
        "assistant_messages",
        ["session_id", "created_at", "id"],
    )
    op.create_table(
        "assistant_tool_calls",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=False),
        sa.Column("session_id", sa.String(length=36), nullable=False),
        sa.Column("operator_id", sa.Integer(), nullable=False),
        sa.Column("tool_name", sa.String(length=64), nullable=False),
        sa.Column("risk_level", sa.String(length=24), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("arguments_json", sa.Text(), nullable=False),
        sa.Column("preview_json", sa.Text(), nullable=False),
        sa.Column("preview_hash", sa.String(length=64), nullable=False),
        sa.Column("confirmation_phrase", sa.String(length=128), nullable=False),
        sa.Column("result_json", sa.Text(), nullable=False),
        sa.Column("error_message", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("approved_at", sa.DateTime(), nullable=True),
        sa.Column("executed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["operator_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["run_id"], ["assistant_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["session_id"], ["assistant_sessions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_assistant_tool_calls_session_created",
        "assistant_tool_calls",
        ["session_id", "created_at"],
    )
    op.create_index(
        "ix_assistant_tool_calls_status_expires",
        "assistant_tool_calls",
        ["status", "expires_at"],
    )
