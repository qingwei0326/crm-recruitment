import os
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
