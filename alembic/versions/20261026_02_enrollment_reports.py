"""add enrollment reports: an agent's 已报名 report waiting for an admin to confirm

Only admins create enrollment records, so an agent who hears a student has enrolled
files a report; the admin confirms it into an EnrollmentRecord or rejects it.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261026_02"
down_revision: str | Sequence[str] | None = "20261026_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


def upgrade() -> None:
    op.create_table(
        "enrollment_reports",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("student_id", sa.Integer(), nullable=False),
        sa.Column("reporter_id", sa.Integer(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("pending", "confirmed", "rejected", name="enrollmentreportstatus"),
            nullable=False,
        ),
        sa.Column("enrolled_program", sa.String(length=128), nullable=False),
        sa.Column("region", sa.String(length=64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=False),
        sa.Column("reviewed_by_id", sa.Integer(), nullable=True),
        sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        sa.Column("reject_reason", sa.Text(), nullable=False),
        sa.Column("enrollment_record_id", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["student_id"], ["students.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["reporter_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["reviewed_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["enrollment_record_id"], ["enrollment_records.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_enrollment_reports_student_id", "enrollment_reports", ["student_id"])
    op.create_index("ix_enrollment_reports_status", "enrollment_reports", ["status"])


def downgrade() -> None:
    op.drop_index("ix_enrollment_reports_status", table_name="enrollment_reports")
    op.drop_index("ix_enrollment_reports_student_id", table_name="enrollment_reports")
    op.drop_table("enrollment_reports")
