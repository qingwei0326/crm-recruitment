"""Regression coverage for the real legacy SQLite shapes, not just fresh schemas."""

import importlib.util
import json
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.models import Note, OperationLog, Student, User

ROOT = Path(__file__).resolve().parents[1]


def alembic(database, *args):
    env = {**os.environ, "DATABASE_PATH": str(database), "SECRET_KEY": "schema-test-only"}
    env.pop("DATABASE_URL", None)
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def rewrite_table(connection, table, replacements):
    ddl = connection.execute("SELECT sql FROM sqlite_master WHERE name=?", (table,)).fetchone()[0]
    indexes = connection.execute(
        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL",
        (table,),
    ).fetchall()
    ddl = re.sub(rf'CREATE TABLE "?{table}"?', f'CREATE TABLE "{table}_drift"', ddl, count=1)
    for before, after in replacements:
        ddl, count = re.subn(before, after, ddl)
        assert count == 1, (table, before, ddl)
    connection.execute(ddl)
    connection.execute(f'INSERT INTO "{table}_drift" SELECT * FROM "{table}"')
    connection.execute(f'DROP TABLE "{table}"')
    connection.execute(f'ALTER TABLE "{table}_drift" RENAME TO "{table}"')
    for (sql,) in indexes:
        connection.execute(sql)


@pytest.fixture
def legacy_database(tmp_path):
    database = tmp_path / "legacy.db"
    result = alembic(database, "upgrade", "20261020_01")
    assert result.returncode == 0, result.stdout + result.stderr
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    with Session(engine) as session:
        user = User(username="schema-agent", hashed_password="x", name="agent")
        session.add(user)
        session.flush()
        student = Student(name="kept-student", assigned_to=user.id, case_no="case-1")
        session.add(student)
        session.flush()
        session.add(Note(student_id=student.id, agent_id=user.id, content="kept-note"))
        session.add(OperationLog(operator_id=user.id, operator_name="agent", action="fixture"))
        session.commit()
    engine.dispose()
    with sqlite3.connect(database) as connection:
        replacements = []
        for name in ("guardian_name", "guardian_phone", "school_name", "school_address"):
            # The historical double-quoted defaults must not break reflection/rebuild.
            replacements.append((rf"{name} VARCHAR\(\d+\) NOT NULL", f'{name} TEXT DEFAULT ""'))
        replacements += [
            (r"case_no VARCHAR\(36\)", "case_no TEXT"),
            (r",\s*UNIQUE \(case_no\)", ""),
            (r"need_help BOOLEAN NOT NULL", "need_help INTEGER DEFAULT 0"),
            (r"status VARCHAR\(21\)", "status VARCHAR(13)"),
            (r"stage VARCHAR\(22\)", "stage VARCHAR(15)"),
            (r"enrollment_substage VARCHAR\(21\)", "enrollment_substage VARCHAR(32)"),
        ]
        rewrite_table(connection, "students", replacements)
        rewrite_table(
            connection, "notes", [(r"updated_at DATETIME NOT NULL", "updated_at DATETIME")]
        )
        rewrite_table(connection, "users", [(r"locked_until DATETIME", "locked_until TIMESTAMP")])
        rewrite_table(
            connection,
            "operation_logs",
            [
                (r",\s*FOREIGN KEY\(operator_id\) REFERENCES users \(id\)", ""),
                (r"id INTEGER NOT NULL", "id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT"),
                (r",\s*PRIMARY KEY \(id\)", ""),
            ],
        )
        connection.execute("UPDATE sqlite_sequence SET seq=9000 WHERE name='operation_logs'")
        connection.execute("ALTER TABLE students ADD COLUMN agent_id INTEGER")
        connection.execute("ALTER TABLE students ADD COLUMN expired_reason VARCHAR(50)")
        connection.execute("DROP INDEX ix_students_status_school")
        connection.execute("CREATE INDEX ix_students_assigned_to ON students(assigned_to)")
        connection.execute("CREATE INDEX ix_notes_student_created ON notes(student_id,created_at)")
        connection.execute(
            "UPDATE students SET agent_id=42,expired_reason='retired-value',"
            "guardian_name=NULL,need_help=NULL"
        )
        connection.execute("UPDATE notes SET updated_at=NULL")
    return database


def test_repairs_legacy_schema_without_losing_rows_or_retired_values(legacy_database):
    database = legacy_database
    result = alembic(database, "upgrade", "head")
    assert result.returncode == 0, result.stdout + result.stderr
    check = alembic(database, "check")
    assert check.returncode == 0, check.stdout + check.stderr
    with sqlite3.connect(database) as connection:
        assert connection.execute("PRAGMA integrity_check").fetchall() == [("ok",)]
        assert connection.execute("PRAGMA foreign_key_check").fetchall() == []
        assert connection.execute(
            "SELECT name,guardian_name,need_help,case_no FROM students"
        ).fetchall() == [("kept-student", "", 0, "case-1")]
        assert (
            connection.execute("SELECT COUNT(*) FROM notes WHERE updated_at=created_at").fetchone()[
                0
            ]
            == 1
        )
        payload = json.loads(
            connection.execute(
                "SELECT payload FROM schema_cleanup_archive WHERE table_name='students'"
            ).fetchone()[0]
        )
        assert payload["agent_id"] == 42
        assert payload["expired_reason"] == "retired-value"
        assert payload["guardian_name"] is None and payload["need_help"] is None
        assert json.loads(
            connection.execute(
                "SELECT payload FROM schema_cleanup_archive WHERE table_name='notes'"
            ).fetchone()[0]
        ) == {"updated_at": None}
        assert (
            connection.execute(
                "SELECT seq FROM sqlite_sequence WHERE name='operation_logs'"
            ).fetchone()[0]
            == 9000
        )
        connection.execute("PRAGMA foreign_keys=ON")
        with pytest.raises(sqlite3.IntegrityError):
            connection.execute("UPDATE operation_logs SET operator_id=999999")
    again = alembic(database, "upgrade", "head")
    assert again.returncode == 0, again.stdout + again.stderr
    downgrade = alembic(database, "downgrade", "20261020_01")
    assert downgrade.returncode != 0 and "verified pre-release database backup" in downgrade.stderr
    # Later revisions roll back on the way down; restore them before comparing schemas.
    assert alembic(database, "upgrade", "head").returncode == 0
    assert alembic(database, "check").returncode == 0


@pytest.mark.parametrize(
    "invalid_sql",
    [
        "UPDATE operation_logs SET operator_id=999999",
        "UPDATE students SET need_help=2",
        "UPDATE students SET guardian_phone='123456789012345678901'",
        "CREATE TRIGGER custom_students AFTER UPDATE ON students BEGIN SELECT 1; END",
        "CREATE VIEW custom_students AS SELECT id FROM students",
    ],
)
def test_preflight_rejects_unsafe_data_without_mutating_database(legacy_database, invalid_sql):
    with sqlite3.connect(legacy_database) as connection:
        connection.execute(invalid_sql)
    before = legacy_database.read_bytes()
    result = alembic(legacy_database, "upgrade", "head")
    assert result.returncode != 0
    assert "preflight failed" in result.stderr
    assert legacy_database.read_bytes() == before


def test_duplicate_case_number_is_not_silently_deduplicated(legacy_database):
    engine = create_engine(f"sqlite:///{legacy_database.as_posix()}")
    with Session(engine) as session:
        session.add(Student(name="duplicate-kept", case_no="case-1"))
        session.commit()
    engine.dispose()
    before = legacy_database.read_bytes()
    result = alembic(legacy_database, "upgrade", "head")
    assert result.returncode != 0 and "duplicate case_no" in result.stderr
    assert legacy_database.read_bytes() == before


def test_failure_after_parent_rebuild_rolls_back_archive_ddl_and_all_data(legacy_database):
    path = ROOT / "alembic/versions/20261021_01_reconcile_legacy_schema.py"
    spec = importlib.util.spec_from_file_location("cleanup_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    rebuild = migration._rebuild

    def fail_after_rebuild(*args, **kwargs):
        rebuild(*args, **kwargs)
        raise RuntimeError("injected migration failure")

    migration._rebuild = fail_after_rebuild
    before = legacy_database.read_bytes()
    engine = create_engine(f"sqlite:///{legacy_database.as_posix()}")
    with engine.connect() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            with pytest.raises(RuntimeError, match="injected migration failure"):
                migration.upgrade()
        connection.rollback()
    engine.dispose()
    assert legacy_database.read_bytes() == before
