import sqlite3

import pytest

from scripts import sqlite_online_backup
from scripts.sqlite_online_backup import (
    create_backup,
    inspect_database,
    read_revision_from_path,
    resolve_sqlite_source,
)


def create_versioned_database(path, revision="20260711_03"):
    with sqlite3.connect(path) as connection:
        connection.execute("create table alembic_version (version_num text not null)")
        connection.execute("insert into alembic_version values (?)", (revision,))
        connection.execute("create table students (id integer primary key, name text not null)")
        connection.execute("insert into students (name) values ('test student')")


def test_create_backup_copies_and_validates_database(tmp_path):
    source = tmp_path / "source.db"
    destination = tmp_path / "backup.db"
    create_versioned_database(source)

    result = create_backup(source, destination, "20260711_03")

    assert result["integrity_check"] == "ok"
    assert result["alembic_revision"] == "20260711_03"
    assert result["bytes"] > 0
    with sqlite3.connect(destination) as connection:
        assert connection.execute("select name from students").fetchall() == [("test student",)]


def test_create_backup_rejects_unexpected_revision_without_leaving_output(tmp_path):
    source = tmp_path / "source.db"
    destination = tmp_path / "backup.db"
    create_versioned_database(source, "old_revision")

    with pytest.raises(ValueError, match="database revision mismatch"):
        create_backup(source, destination, "20260711_03")

    assert not destination.exists()


def test_create_backup_never_overwrites_an_existing_file(tmp_path):
    source = tmp_path / "source.db"
    destination = tmp_path / "backup.db"
    create_versioned_database(source)
    destination.write_text("keep me", encoding="utf-8")

    with pytest.raises(ValueError, match="already exists"):
        create_backup(source, destination, "20260711_03")

    assert destination.read_text(encoding="utf-8") == "keep me"


def test_inspect_database_reports_revision_and_integrity(tmp_path):
    source = tmp_path / "source.db"
    create_versioned_database(source, "20260714_01")

    result = inspect_database(source, "20260714_01")

    assert result["alembic_revision"] == "20260714_01"
    assert result["quick_check"] == "ok"
    assert result["foreign_key_violations"] == 0
    assert read_revision_from_path(source) == "20260714_01"


def test_inspect_database_rejects_foreign_key_violations(tmp_path):
    source = tmp_path / "broken.db"
    with sqlite3.connect(source) as connection:
        connection.execute("create table parent (id integer primary key)")
        connection.execute(
            "create table child (parent_id integer references parent(id))"
        )
        connection.execute("insert into child (parent_id) values (99)")

    with pytest.raises(ValueError, match="foreign key check failed"):
        inspect_database(source)


@pytest.mark.parametrize(
    ("environment", "expected"),
    [
        ({}, "crm.db"),
        ({"DATABASE_PATH": "data/production.db"}, "data/production.db"),
        (
            {"DATABASE_URL": "sqlite+aiosqlite:////srv/crm/production.db"},
            "/srv/crm/production.db",
        ),
    ],
)
def test_resolve_sqlite_source_uses_running_service_configuration(
    tmp_path,
    environment,
    expected,
):
    resolved = resolve_sqlite_source(environment, tmp_path)

    if expected.startswith("/"):
        assert resolved.as_posix().endswith(expected)
        assert not resolved.is_relative_to(tmp_path)
    else:
        assert resolved == (tmp_path / expected).resolve()


def test_resolve_sqlite_source_rejects_postgresql(tmp_path):
    with pytest.raises(ValueError, match="not configured for a file-backed SQLite"):
        resolve_sqlite_source(
            {"DATABASE_URL": "postgresql+asyncpg://db.example/crm"},
            tmp_path,
        )


def test_resolve_process_sqlite_source_uses_proc_cwd(monkeypatch, tmp_path):
    monkeypatch.setattr(
        sqlite_online_backup,
        "read_process_working_directory",
        lambda process_id: tmp_path,
    )
    monkeypatch.setattr(
        sqlite_online_backup,
        "read_process_environment",
        lambda process_id: {"DATABASE_PATH": "runtime/crm.db"},
    )

    source = sqlite_online_backup.resolve_process_sqlite_source(123, tmp_path)

    assert source == (tmp_path / "runtime" / "crm.db").resolve()


def test_resolve_process_sqlite_source_rejects_unexpected_cwd(monkeypatch, tmp_path):
    actual_cwd = tmp_path / "actual"
    monkeypatch.setattr(
        sqlite_online_backup,
        "read_process_working_directory",
        lambda process_id: actual_cwd,
    )

    with pytest.raises(ValueError, match="working directory mismatch"):
        sqlite_online_backup.resolve_process_sqlite_source(123, tmp_path / "expected")
