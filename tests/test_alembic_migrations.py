import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect

PROJECT_ROOT = Path(__file__).resolve().parents[1]
LEGACY_TABLES = {
    "agents",
    "calls",
    "campus_visit_tasks",
    "dial_logs",
    "enrollment_records",
    "follow_up_assignments",
    "follow_ups",
    "home_visit_tasks",
    "lead_view_logs",
    "login_attempts",
    "notes",
    "operation_logs",
    "students",
    "system_configs",
    "tasks",
    "today_tasks",
    "users",
    "visits",
}


def run_alembic(db_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("DATABASE_URL", None)
    env.update(
        DATABASE_PATH=str(db_path),
        SECRET_KEY="migration-test-secret",
        APP_ENV="development",
    )
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def run_prepare_baseline(
    db_path: Path,
    *args: str,
    inherited_database_path: Path | None = None,
) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("DATABASE_URL", None)
    env["DATABASE_PATH"] = str(inherited_database_path or db_path)
    env["SECRET_KEY"] = "migration-test-secret"
    return subprocess.run(
        [
            sys.executable,
            "scripts/prepare_alembic_baseline.py",
            "--database",
            str(db_path),
            *args,
        ],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def create_unstamped_baseline(db_path: Path) -> None:
    result = run_alembic(db_path, "upgrade", "20260711_01")
    assert result.returncode == 0, result.stderr
    with sqlite3.connect(db_path) as connection:
        connection.execute("drop table alembic_version")


def test_empty_database_upgrades_to_current_schema_baseline(tmp_path):
    db_path = tmp_path / "empty.db"

    result = run_alembic(db_path, "upgrade", "20260711_01")

    assert result.returncode == 0, result.stderr
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        inspector = inspect(engine)
        assert LEGACY_TABLES <= set(inspector.get_table_names())
        assert "recording_state" in {
            column["name"] for column in inspector.get_columns("dial_logs")
        }
        assert "status_detail" in {column["name"] for column in inspector.get_columns("students")}
    finally:
        engine.dispose()


def test_prepare_baseline_stamps_only_requested_existing_schema(tmp_path):
    db_path = tmp_path / "existing.db"
    decoy_path = tmp_path / "must-not-be-opened.db"
    create_unstamped_baseline(db_path)

    result = run_prepare_baseline(
        db_path,
        "--apply",
        inherited_database_path=decoy_path,
    )

    assert result.returncode == 0, result.stderr
    with sqlite3.connect(db_path) as connection:
        assert connection.execute("pragma quick_check").fetchone()[0] == "ok"
        assert (
            connection.execute("select version_num from alembic_version").fetchone()[0]
            == "20260711_01"
        )
    assert not decoy_path.exists()


def test_prepare_baseline_repairs_legacy_columns_before_stamp(tmp_path):
    db_path = tmp_path / "legacy.db"
    create_unstamped_baseline(db_path)
    with sqlite3.connect(db_path) as connection:
        connection.execute("drop index ix_dial_logs_recording_state")
        connection.execute("alter table dial_logs drop column recording_state")

    dry_run = run_prepare_baseline(db_path)
    applied = run_prepare_baseline(db_path, "--apply")

    assert dry_run.returncode == 2
    assert '"recording_state"' in dry_run.stdout
    assert applied.returncode == 0, applied.stderr
    with sqlite3.connect(db_path) as connection:
        columns = {row[1] for row in connection.execute("pragma table_info(dial_logs)")}
        assert "recording_state" in columns


def test_prepare_baseline_rejects_missing_required_table(tmp_path):
    db_path = tmp_path / "broken.db"
    with sqlite3.connect(db_path) as connection:
        connection.execute("create table users (id integer primary key)")

    result = run_prepare_baseline(db_path)

    assert result.returncode == 2
    assert '"missing_tables"' in result.stdout
    assert '"students"' in result.stdout


def test_prepare_baseline_never_overwrites_an_unknown_revision(tmp_path):
    db_path = tmp_path / "already-versioned.db"
    result = run_alembic(db_path, "upgrade", "20260711_01")
    assert result.returncode == 0, result.stderr
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "update alembic_version set version_num = ?",
            ("unexpected_revision",),
        )

    prepared = run_prepare_baseline(db_path, "--apply")

    assert prepared.returncode == 2
    assert '"error": "unexpected_alembic_revision"' in prepared.stdout
    with sqlite3.connect(db_path) as connection:
        assert (
            connection.execute("select version_num from alembic_version").fetchone()[0]
            == "unexpected_revision"
        )
