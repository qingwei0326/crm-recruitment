"""agent private work groups

Revision ID: 20260726_01
Revises: 20260714_01
Create Date: 2026-07-26
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20260726_01"
down_revision: str | Sequence[str] | None = "20260714_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "personal_groups",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("owner_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=20), nullable=False),
        sa.Column("color", sa.String(length=16), nullable=False),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_personal_groups_owner_archived",
        "personal_groups",
        ["owner_id", "archived_at"],
    )
    op.create_index(
        "uq_personal_groups_owner_name_active",
        "personal_groups",
        ["owner_id", "name"],
        unique=True,
        sqlite_where=sa.text("archived_at IS NULL"),
    )
    op.create_table(
        "personal_group_memberships",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("group_id", sa.Integer(), nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("created_by", sa.Integer(), nullable=False),
        sa.Column("archived_at", sa.DateTime(), nullable=True),
        sa.Column("archived_by", sa.Integer(), nullable=True),
        sa.Column("archive_reason", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["archived_by"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
        sa.ForeignKeyConstraint(["group_id"], ["personal_groups.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_personal_group_memberships_active",
        "personal_group_memberships",
        ["group_id", "student_id"],
        unique=True,
        sqlite_where=sa.text("archived_at IS NULL"),
        postgresql_where=sa.text("archived_at IS NULL"),
    )
    op.create_index(
        "ix_personal_group_memberships_group_archived",
        "personal_group_memberships",
        ["group_id", "archived_at"],
    )
    op.create_index(
        "ix_personal_group_memberships_student_archived",
        "personal_group_memberships",
        ["student_id", "archived_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_personal_group_memberships_student_archived",
        table_name="personal_group_memberships",
    )
    op.drop_index(
        "ix_personal_group_memberships_group_archived",
        table_name="personal_group_memberships",
    )
    op.drop_index(
        "uq_personal_group_memberships_active",
        table_name="personal_group_memberships",
    )
    op.drop_table("personal_group_memberships")
    op.drop_index("uq_personal_groups_owner_name_active", table_name="personal_groups")
    op.drop_index("ix_personal_groups_owner_archived", table_name="personal_groups")
    op.drop_table("personal_groups")
