"""super-admin assistant core schema

Revision ID: 20260714_01
Revises: 20260711_03
Create Date: 2026-07-14
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260714_01"
down_revision: str | Sequence[str] | None = "20260711_03"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
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


def downgrade() -> None:
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
