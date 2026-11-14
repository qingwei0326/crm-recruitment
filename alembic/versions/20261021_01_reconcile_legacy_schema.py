"""Reconcile the historical SQLite schema with the declared application schema.

Useful historical indexes become explicit model indexes. Retired student fields
and original nulls are archived before changing any row. Duplicate case numbers,
orphan operators, custom triggers, and invalid values abort before DDL. No schema
comparison exclusions are added. PostgreSQL only needs the archive and indexes;
the column drift repaired here originated in SQLite's old startup migrations.

Downgrade requires the verified pre-release SQLite backup. Reintroducing removed
columns alone cannot restore their original constraints or nullability reliably.
"""

import json
import re
from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "20261021_01"
down_revision: str | Sequence[str] | None = "20261020_01"
branch_labels = None
depends_on = None

RETIRED_COLUMNS = (
    "agent_id",
    "priority",
    "last_contact_at",
    "next_follow_up",
    "follow_up_count",
    "attempt_count",
    "is_expired",
    "expired_reason",
)
STUDENT_TYPES = {
    "status": sa.String(21),
    "stage": sa.String(22),
    "guardian_name": sa.String(64),
    "guardian_phone": sa.String(20),
    "school_name": sa.String(128),
    "school_address": sa.String(256),
    "case_no": sa.String(36),
    "need_help": sa.Boolean(),
    "enrollment_substage": sa.String(21),
}
REQUIRED_STUDENT_FIELDS = (
    "guardian_name",
    "guardian_phone",
    "school_name",
    "school_address",
    "need_help",
)
INDEXES = {
    "students": {"ix_students_status_school": ("status", "school_name")},
    "follow_ups": {
        "ix_follow_ups_agent_date": ("agent_id", "follow_up_date"),
        "ix_follow_ups_completed_date": ("is_completed", "follow_up_date"),
    },
    "notes": {
        "ix_notes_agent_id": ("agent_id",),
        "ix_notes_student_created": ("student_id", "created_at"),
    },
    "lead_view_logs": {"ix_lead_view_logs_viewer_id": ("viewer_id",)},
    "operation_logs": {
        "ix_operation_logs_created_at": ("created_at",),
        "ix_operation_logs_action_status": ("action", "new_status", "target_student_id"),
    },
}


def _assert_empty(bind, sql, reason):
    if bind.execute(sa.text(sql)).first() is not None:
        raise RuntimeError(f"Schema cleanup preflight failed: {reason}; restore/fix a clone first")


def _preflight(bind):
    if bind.exec_driver_sql("PRAGMA foreign_keys").scalar():
        raise RuntimeError(
            "Schema cleanup requires an offline migration connection with foreign_keys=OFF"
        )
    if bind.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
        raise RuntimeError("Schema cleanup preflight failed: existing foreign-key violations")
    _assert_empty(
        bind,
        "SELECT case_no FROM students WHERE case_no IS NOT NULL "
        "GROUP BY case_no HAVING COUNT(*) > 1 LIMIT 1",
        "duplicate case_no",
    )
    _assert_empty(
        bind,
        "SELECT o.id FROM operation_logs o LEFT JOIN users u ON u.id=o.operator_id "
        "WHERE o.operator_id IS NOT NULL AND u.id IS NULL LIMIT 1",
        "orphan operator_id",
    )
    _assert_empty(
        bind,
        "SELECT id FROM students WHERE need_help IS NOT NULL AND need_help NOT IN (0,1) LIMIT 1",
        "invalid need_help",
    )
    for name, type_ in STUDENT_TYPES.items():
        if isinstance(type_, sa.String):
            _assert_empty(
                bind,
                f'SELECT id FROM students WHERE length("{name}") > {type_.length} LIMIT 1',
                f"overlong students.{name}",
            )
    # Batch recreation must not silently discard custom triggers.
    _assert_empty(
        bind,
        "SELECT name FROM sqlite_master WHERE type='trigger' "
        "AND tbl_name IN ('students','notes','users','operation_logs') LIMIT 1",
        "custom triggers require manual review",
    )
    for table in ("students", "notes", "users", "operation_logs"):
        inspector = sa.inspect(bind)
        if inspector.get_check_constraints(table):
            raise RuntimeError(
                f"Schema cleanup preflight failed: custom CHECK constraints on {table}"
            )
    for view in bind.execute(sa.text("SELECT sql FROM sqlite_master WHERE type='view'")):
        if re.search(r"\b(students|notes|users|operation_logs)\b", view[0], re.I):
            raise RuntimeError(
                "Schema cleanup preflight failed: dependent views require manual review"
            )
    for index in sa.inspect(bind).get_indexes("students"):
        if set(index["column_names"]) & set(RETIRED_COLUMNS):
            raise RuntimeError(
                "Schema cleanup preflight failed: index depends on retired student fields"
            )
    for table, indexes in INDEXES.items():
        existing = {i["name"]: i for i in sa.inspect(bind).get_indexes(table)}
        for name, columns in indexes.items():
            if name in existing and (
                tuple(existing[name]["column_names"]) != columns or existing[name]["unique"]
            ):
                raise RuntimeError(f"Schema cleanup preflight failed: unexpected index {name}")


def _archive(bind, table, fields, where="1=1", null_only=()):
    if not fields:
        return
    archive = sa.table(
        "schema_cleanup_archive",
        sa.column("revision"),
        sa.column("table_name"),
        sa.column("row_id"),
        sa.column("payload"),
    )
    columns = ", ".join(f'"{name}"' for name in fields)
    rows = bind.execute(sa.text(f'SELECT id, {columns} FROM "{table}" WHERE {where}')).mappings()
    for chunk in rows.partitions(500):
        bind.execute(
            archive.insert(),
            [
                {
                    "revision": revision,
                    "table_name": table,
                    "row_id": row["id"],
                    "payload": json.dumps(
                        {
                            name: row[name]
                            for name in fields
                            if name not in null_only or row[name] is None
                        },
                        ensure_ascii=False,
                        default=str,
                    ),
                }
                for row in chunk
            ],
        )


def _rebuild(bind, table, changes, drop=(), add_operator_fk=False, add_case_unique=False):
    if not (changes or drop or add_operator_fk or add_case_unique):
        return
    ddl = bind.execute(
        sa.text("SELECT sql FROM sqlite_master WHERE name=:name"), {"name": table}
    ).scalar_one()
    autoincrement = bool(re.search(r"\bAUTOINCREMENT\b", ddl, re.I))
    sequence = None
    if autoincrement:
        sequence = bind.execute(
            sa.text("SELECT seq FROM sqlite_sequence WHERE name=:name"), {"name": table}
        ).scalar()
    with op.batch_alter_table(
        table, recreate="always", table_kwargs={"sqlite_autoincrement": autoincrement}
    ) as batch:
        for name, kwargs in changes.items():
            batch.alter_column(name, **kwargs)
        for name in drop:
            batch.drop_column(name)
        if add_operator_fk:
            batch.create_foreign_key(
                "fk_operation_logs_operator_id_users", "users", ["operator_id"], ["id"]
            )
        if add_case_unique:
            batch.create_unique_constraint("uq_students_case_no", ["case_no"])
    if sequence is not None:
        bind.execute(
            sa.text("UPDATE sqlite_sequence SET seq=MAX(seq,:seq) WHERE name=:name"),
            {"seq": sequence, "name": table},
        )


def upgrade():
    bind = op.get_bind()
    sqlite = bind.dialect.name == "sqlite"
    if sqlite:
        # sqlite3 legacy transaction mode does not BEGIN for DDL. Explicitly start
        # a write transaction so archive, rebuilds and version stamp roll back together.
        if not bind.connection.driver_connection.in_transaction:
            bind.exec_driver_sql("BEGIN IMMEDIATE")
        _preflight(bind)
    op.create_table(
        "schema_cleanup_archive",
        sa.Column("revision", sa.String(32), primary_key=True),
        sa.Column("table_name", sa.String(64), primary_key=True),
        sa.Column("row_id", sa.Integer(), primary_key=True),
        sa.Column("payload", sa.Text(), nullable=False),
        sa.Column(
            "archived_at",
            sa.DateTime(),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        ),
    )
    if sqlite:
        columns = {c["name"]: c for c in sa.inspect(bind).get_columns("students")}
        retired = [name for name in RETIRED_COLUMNS if name in columns]
        # One archive row holds all fields that could be changed or removed.
        archived = list(dict.fromkeys([*retired, *REQUIRED_STUDENT_FIELDS]))
        null_filter = " OR ".join(f'"{name}" IS NULL' for name in REQUIRED_STUDENT_FIELDS)
        _archive(
            bind,
            "students",
            archived,
            "1=1" if retired else null_filter,
            null_only=REQUIRED_STUDENT_FIELDS,
        )
        _archive(bind, "notes", ["updated_at"], "updated_at IS NULL")
        for name in REQUIRED_STUDENT_FIELDS:
            default = "0" if name == "need_help" else "''"
            bind.execute(sa.text(f'UPDATE students SET "{name}"={default} WHERE "{name}" IS NULL'))
        bind.execute(sa.text("UPDATE notes SET updated_at=created_at WHERE updated_at IS NULL"))
        changes = {}
        dialect = bind.dialect
        for name, desired in STUDENT_TYPES.items():
            existing = columns[name]
            kwargs = {"existing_type": existing["type"]}
            # Old ALTER TABLE statements used double-quoted empty defaults.
            # Reflection wraps these as (""), which SQLite rejects on recreation.
            # These fields use application defaults in the canonical schema.
            if existing["default"] is not None:
                kwargs["server_default"] = None
            if existing["type"].compile(dialect=dialect) != desired.compile(dialect=dialect):
                kwargs["type_"] = desired
            if name in REQUIRED_STUDENT_FIELDS and existing["nullable"]:
                kwargs["nullable"] = False
            if len(kwargs) > 1:
                changes[name] = kwargs
        unique_case = any(
            tuple(u["column_names"]) == ("case_no",)
            for u in sa.inspect(bind).get_unique_constraints("students")
        )
        unique_case |= any(
            i["unique"] and tuple(i["column_names"]) == ("case_no",)
            for i in sa.inspect(bind).get_indexes("students")
        )
        _rebuild(bind, "students", changes, retired, add_case_unique=not unique_case)
        note = next(c for c in sa.inspect(bind).get_columns("notes") if c["name"] == "updated_at")
        _rebuild(
            bind,
            "notes",
            {"updated_at": {"nullable": False, "existing_type": note["type"]}}
            if note["nullable"]
            else {},
        )
        locked = next(
            c for c in sa.inspect(bind).get_columns("users") if c["name"] == "locked_until"
        )
        _rebuild(
            bind,
            "users",
            {"locked_until": {"type_": sa.DateTime(), "existing_type": locked["type"]}}
            if str(locked["type"]) != "DATETIME"
            else {},
        )
        has_fk = any(
            f["constrained_columns"] == ["operator_id"]
            and f["referred_table"] == "users"
            and f["referred_columns"] == ["id"]
            for f in sa.inspect(bind).get_foreign_keys("operation_logs")
        )
        _rebuild(bind, "operation_logs", {}, add_operator_fk=not has_fk)
        indexes = {i["name"] for i in sa.inspect(bind).get_indexes("students")}
        if "ix_students_assigned_to" in indexes:
            op.drop_index("ix_students_assigned_to", table_name="students")
    for table, definitions in INDEXES.items():
        present = {i["name"] for i in sa.inspect(bind).get_indexes(table)}
        for name, columns in definitions.items():
            if name not in present:
                op.create_index(name, table, columns)
    if sqlite and bind.exec_driver_sql("PRAGMA foreign_key_check").first() is not None:
        raise RuntimeError(
            "Schema cleanup produced foreign-key violations; restore pre-release backup"
        )


def downgrade():
    raise RuntimeError(
        "20261021_01 is forward-only; restore the verified pre-release database backup to roll back"
    )
