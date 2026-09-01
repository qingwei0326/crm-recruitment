"""add per-enrollment financial snapshots"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op


revision: str = "20260823_01"
down_revision: str | Sequence[str] | None = "20260726_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


FINANCE_COLUMNS = (
    "tuition_list_amount",
    "student_subsidy_amount",
    "student_due_amount",
    "student_paid_amount",
    "external_subsidy_amount",
    "school_received_amount",
    "commission_base_amount",
    "commission_subsidy_amount",
    "commission_adjustment_amount",
    "commission_due_amount",
    "commission_paid_amount",
)


def upgrade() -> None:
    bind = op.get_bind()
    duplicates = bind.execute(
        sa.text(
            "SELECT student_id FROM enrollment_records "
            "GROUP BY student_id HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicates is not None:
        raise RuntimeError(
            "enrollment_records contains duplicate student_id; "
            "resolve duplicates before applying 20260823_01"
        )

    with op.batch_alter_table("enrollment_records", schema=None) as batch_op:
        for name in FINANCE_COLUMNS:
            batch_op.add_column(
                sa.Column(
                    name,
                    sa.Numeric(12, 2),
                    nullable=False,
                    server_default=sa.text("0"),
                )
            )
        batch_op.create_unique_constraint(
            "uq_enrollment_records_student",
            ["student_id"],
        )

    op.execute(
        sa.text(
            "UPDATE enrollment_records "
            "SET student_paid_amount = COALESCE(amount, 0), "
            "school_received_amount = COALESCE(amount, 0)"
        )
    )

    with op.batch_alter_table("enrollment_records", schema=None) as batch_op:
        for name in FINANCE_COLUMNS:
            batch_op.alter_column(name, server_default=None)


def downgrade() -> None:
    with op.batch_alter_table("enrollment_records", schema=None) as batch_op:
        batch_op.drop_constraint("uq_enrollment_records_student", type_="unique")
        for name in reversed(FINANCE_COLUMNS):
            batch_op.drop_column(name)
