"""keep the visit time and exam score as the agent wrote them

Agents report visits with times like "晚上有空，具体哪天明天确认" and scores like
"200-300分". The exact datetime and numeric score columns stay as they are; these
text columns keep what was written when it cannot be parsed.
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261026_01"
down_revision: str | Sequence[str] | None = "20261020_01"
branch_labels: str | Sequence[str] | None = None
depends_on: str | None = None


NOTE_COLUMNS = (
    ("visit_time_note", 128),
    ("exam_score_text", 32),
)
TABLES = ("home_visit_tasks", "campus_visit_tasks")


def upgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            for name, length in NOTE_COLUMNS:
                batch_op.add_column(
                    sa.Column(
                        name,
                        sa.String(length),
                        nullable=False,
                        server_default=sa.text("''"),
                    )
                )
        with op.batch_alter_table(table, schema=None) as batch_op:
            for name, _length in NOTE_COLUMNS:
                batch_op.alter_column(name, server_default=None)


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table, schema=None) as batch_op:
            for name, _length in reversed(NOTE_COLUMNS):
                batch_op.drop_column(name)
