import os
import sqlite3
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine, func, inspect, select, text
from sqlalchemy.orm import Session

from app.domain_models import AgentEmployment, LeadOutcomeReason, StudentAssignment
from app.migration_data.domain_backfill_20260711 import audit_domain_core
from app.models import Student, StudentStatus, User, UserRole

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
DOMAIN_TABLES = {
    "agent_employment",
    "agent_employment_events",
    "student_assignments",
    "work_items",
    "handover_batches",
    "handover_items",
    "handover_transfers",
    "lead_outcome_reasons",
}
ASSISTANT_TABLES = {
    "assistant_configs",
    "assistant_sessions",
    "assistant_runs",
    "assistant_messages",
    "assistant_tool_calls",
}
PERSONAL_GROUP_TABLES = {
    "personal_groups",
    "personal_group_memberships",
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


def test_empty_database_upgrades_to_domain_schema_without_dropping_legacy(tmp_path):
    db_path = tmp_path / "domain.db"

    result = run_alembic(db_path, "upgrade", "20260711_02")

    assert result.returncode == 0, result.stderr
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        assert LEGACY_TABLES <= tables
        assert DOMAIN_TABLES <= tables
        student_columns = {column["name"]: column for column in inspector.get_columns("students")}
        assert student_columns["outcome_reason_code"]["nullable"] is True
    finally:
        engine.dispose()


def test_domain_schema_downgrade_removes_only_domain_delta(tmp_path):
    db_path = tmp_path / "domain-downgrade.db"
    upgraded = run_alembic(db_path, "upgrade", "20260711_02")
    assert upgraded.returncode == 0, upgraded.stderr

    downgraded = run_alembic(db_path, "downgrade", "20260711_01")

    assert downgraded.returncode == 0, downgraded.stderr
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        assert LEGACY_TABLES <= tables
        assert DOMAIN_TABLES.isdisjoint(tables)
        student_columns = {column["name"] for column in inspector.get_columns("students")}
        assert "outcome_reason_code" not in student_columns
    finally:
        engine.dispose()


def test_existing_domain_schema_upgrades_and_backfills_legacy_rows(tmp_path):
    db_path = tmp_path / "domain-backfill.db"
    schema_result = run_alembic(db_path, "upgrade", "20260711_02")
    assert schema_result.returncode == 0, schema_result.stderr

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    with Session(engine) as session:
        user = User(
            username="migration_agent",
            hashed_password="test",
            role=UserRole.agent,
            name="迁移员工",
            is_active=True,
        )
        session.add(user)
        session.flush()
        student = Student(
            name="迁移学生",
            region="测试区",
            assigned_to=user.id,
            status=StudentStatus.invalid,
            status_detail="报好了",
        )
        session.add(student)
        session.commit()
        user_id = user.id
        student_id = student.id

    migrated = run_alembic(db_path, "upgrade", "20260711_03")

    assert migrated.returncode == 0, migrated.stderr
    with Session(engine) as session:
        student = session.get(Student, student_id)
        assert student.status == StudentStatus.invalid
        assert student.status_detail == "报好了"
        assert student.assigned_to == user_id
        assert student.outcome_reason_code == "enrolled_elsewhere"
        assert session.get(AgentEmployment, user_id) is not None
        assignment = session.scalars(
            select(StudentAssignment).where(
                StudentAssignment.student_id == student_id,
                StudentAssignment.ended_at.is_(None),
            )
        ).one()
        assert assignment.agent_id == user_id
        reason = session.get(LeadOutcomeReason, "enrolled_elsewhere")
        assert reason.reclaimable is False
        assert audit_domain_core(session)["ok"] is True
        revision = session.execute(text("select version_num from alembic_version")).scalar_one()
        assert revision == "20260711_03"
    assistant_upgrade = run_alembic(db_path, "upgrade", "head")
    assert assistant_upgrade.returncode == 0, assistant_upgrade.stderr
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert ASSISTANT_TABLES <= tables
    assert PERSONAL_GROUP_TABLES <= tables
    with Session(engine) as session:
        revision = session.execute(text("select version_num from alembic_version")).scalar_one()
        assert revision == "20260925_01"
    check = run_alembic(db_path, "check")
    assert check.returncode == 0, check.stdout + check.stderr
    engine.dispose()


def test_domain_backfill_downgrade_clears_only_new_domain_data(tmp_path):
    db_path = tmp_path / "backfill-downgrade.db"
    upgraded = run_alembic(db_path, "upgrade", "20260711_03")
    assert upgraded.returncode == 0, upgraded.stderr

    downgraded = run_alembic(db_path, "downgrade", "20260711_02")

    assert downgraded.returncode == 0, downgraded.stderr
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        inspector = inspect(engine)
        assert DOMAIN_TABLES <= set(inspector.get_table_names())
        with Session(engine) as session:
            assert session.scalar(select(func.count(AgentEmployment.user_id))) == 0
            assert session.scalar(select(func.count(LeadOutcomeReason.code))) == 0
            revision = session.execute(text("select version_num from alembic_version")).scalar_one()
            assert revision == "20260711_02"
    finally:
        engine.dispose()
