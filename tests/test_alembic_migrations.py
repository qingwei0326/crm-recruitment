import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import MetaData, Table, create_engine, func, inspect, select, text
from sqlalchemy.orm import Session

from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    LeadOutcomeReason,
    StudentAssignment,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.migration_data.domain_backfill_20260711 import audit_domain_core
from app.models import (
    EnrollmentRecord,
    FollowUp,
    Student,
    StudentStatus,
    User,
    UserRole,
)

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
        revision = session.execute(
            text("select version_num from alembic_version")
        ).scalar_one()
        assert revision == "20260711_03"
    assistant_upgrade = run_alembic(db_path, "upgrade", "head")
    assert assistant_upgrade.returncode == 0, assistant_upgrade.stderr
    inspector = inspect(engine)
    tables = set(inspector.get_table_names())
    assert ASSISTANT_TABLES <= tables
    assert PERSONAL_GROUP_TABLES <= tables
    with Session(engine) as session:
        revision = session.execute(text("select version_num from alembic_version")).scalar_one()
        assert revision == "20261026_02"
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
            revision = session.execute(
                text("select version_num from alembic_version")
            ).scalar_one()
            assert revision == "20260711_02"
    finally:
        engine.dispose()


def test_legacy_compat_revision_heals_stamped_database_missing_old_columns(tmp_path):
    db_path = tmp_path / "stamped-old.db"
    assert run_alembic(db_path, "upgrade", "20260925_01").returncode == 0
    engine = create_engine(f"sqlite:///{db_path}")
    with engine.begin() as conn:
        conn.exec_driver_sql("ALTER TABLE users DROP COLUMN token_version")
        conn.exec_driver_sql("ALTER TABLE follow_ups DROP COLUMN is_completed")
        conn.exec_driver_sql("DROP TABLE IF EXISTS message_templates")
        conn.exec_driver_sql(
            "CREATE TABLE message_templates (id INTEGER PRIMARY KEY, body TEXT)"
        )
        conn.exec_driver_sql(
            "INSERT INTO students (name, region, status, status_detail, intent_level, stage, "
            "program, guardian_name, guardian_phone, guardian2_name, guardian2_phone, "
            "school_name, school_address, need_help, created_at, updated_at) "
            "VALUES ('旧', '', '已联系', '', 'none', 'initial_contact', '', '', "
            "'+86 139-6011-8706', '', '', '', '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
        )

    with engine.begin() as conn:
        for alias in ("unassigned", "no_intent", "child_not_interested"):
            conn.exec_driver_sql(
                "INSERT INTO students (name, region, status, status_detail, intent_level, stage, "
                "program, guardian_name, guardian_phone, guardian2_name, guardian2_phone, "
                "school_name, school_address, need_help, created_at, updated_at) "
                f"VALUES ('别名-{alias}', '', '{alias}', '', 'none', 'initial_contact', '', '', "
                "'', '', '', '', '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )

    upgrade = run_alembic(db_path, "upgrade", "head")
    assert upgrade.returncode == 0, upgrade.stderr

    with engine.connect() as conn:
        statuses = dict(
            conn.exec_driver_sql("SELECT name, status FROM students WHERE name LIKE '别名-%'").all()
        )
    assert statuses == {
        "别名-unassigned": "not_contacted",
        "别名-no_intent": "not_interested",
        "别名-child_not_interested": "child_not_want_study",
    }

    inspector = inspect(engine)
    assert "token_version" in {c["name"] for c in inspector.get_columns("users")}
    assert "is_completed" in {c["name"] for c in inspector.get_columns("follow_ups")}
    assert "message_templates" not in inspector.get_table_names()
    with engine.connect() as conn:
        row = conn.exec_driver_sql(
            "SELECT guardian_phone, status FROM students WHERE name = '旧'"
        ).one()
        assert tuple(row) == ("13960118706", "contacted")
        assert conn.execute(text("select version_num from alembic_version")).scalar_one() == (
            "20261026_02"
        )
    assert run_alembic(db_path, "check").returncode == 0
    engine.dispose()


def test_visit_note_columns_upgrade_and_downgrade(tmp_path):
    db_path = tmp_path / "visit-notes.db"
    note_columns = {"visit_time_note", "exam_score_text"}

    def columns(table):
        engine = create_engine(f"sqlite:///{db_path}")
        names = {column["name"] for column in inspect(engine).get_columns(table)}
        engine.dispose()
        return names

    assert run_alembic(db_path, "upgrade", "head").returncode == 0
    for table in ("home_visit_tasks", "campus_visit_tasks"):
        assert note_columns <= columns(table)

    downgraded = run_alembic(db_path, "downgrade", "20261020_01")
    assert downgraded.returncode == 0, downgraded.stderr
    for table in ("home_visit_tasks", "campus_visit_tasks"):
        assert not note_columns & columns(table)


def test_enrollment_reports_table_upgrade_and_downgrade(tmp_path):
    db_path = tmp_path / "enrollment-reports.db"

    def tables():
        engine = create_engine(f"sqlite:///{db_path}")
        names = set(inspect(engine).get_table_names())
        engine.dispose()
        return names

    assert run_alembic(db_path, "upgrade", "head").returncode == 0
    assert "enrollment_reports" in tables()

    downgraded = run_alembic(db_path, "downgrade", "20261026_01")
    assert downgraded.returncode == 0, downgraded.stderr
    assert "enrollment_reports" not in tables()


def test_fresh_head_schema_already_has_student_search_indexes(tmp_path):
    db_path = tmp_path / "fresh.db"
    assert run_alembic(db_path, "upgrade", "head").returncode == 0
    engine = create_engine(f"sqlite:///{db_path}")
    names = {index["name"] for index in inspect(engine).get_indexes("students")}
    engine.dispose()
    assert {
        "ix_students_region",
        "ix_students_school_name",
        "ix_students_guardian_phone",
        "ix_students_guardian2_phone",
    } <= names


def _seed_legacy_visits(db_path: Path) -> dict[str, int]:
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        with Session(engine) as session:
            active = User(username="visit_active", hashed_password="x", name="在岗坐席")
            suspended = User(username="visit_suspended", hashed_password="x", name="停用坐席")
            session.add_all([active, suspended])
            session.flush()
            changed_at = datetime(2026, 7, 1, 8, 0, 0)
            session.add_all(
                [
                    AgentEmployment(user_id=active.id, status_changed_at=changed_at),
                    AgentEmployment(
                        user_id=suspended.id,
                        status=EmploymentStatus.suspended,
                        status_changed_at=changed_at,
                    ),
                ]
            )
            students = [
                Student(
                    name="待家访",
                    assigned_to=active.id,
                    guardian_phone="13900000001",
                    region="芗城",
                    school_name="一中",
                    program="护理",
                    score=420.0,
                    case_no="visit-case-1",
                ),
                Student(name="待到校", assigned_to=active.id),
                Student(name="已家访", assigned_to=active.id),
                Student(name="已无效", assigned_to=active.id, status=StudentStatus.invalid),
                Student(name="停用坐席的", assigned_to=suspended.id),
            ]
            session.add_all(students)
            session.commit()
            ids = {student.name: student.id for student in students}
            ids["active"], ids["suspended"] = active.id, suspended.id

        rows = [
            ("待家访", "active", "home", "2026-07-11 15:00:00", "pending", "家长周末在家"),
            ("待到校", "active", "campus", "2026-07-12 09:00:00", "confirmed", None),
            ("已家访", "active", "home", "2026-07-08 10:00:00", "completed", "聊得不错"),
            ("已无效", "active", "home", "2026-07-09 10:00:00", "pending", ""),
            ("停用坐席的", "suspended", "campus", "2026-07-13 09:00:00", "pending", ""),
        ]
        with engine.begin() as conn:
            for student, agent, visit_type, scheduled, status, notes in rows:
                conn.execute(
                    text(
                        "insert into visits (student_id, agent_id, visit_type, scheduled_date, "
                        "status, notes, created_at, updated_at) values (:student_id, "
                        ":agent_id, :visit_type, :scheduled, :status, :notes, "
                        "'2026-07-01 08:00:00', '2026-07-02 08:00:00')"
                    ),
                    {
                        "student_id": ids[student],
                        "agent_id": ids[agent],
                        "visit_type": visit_type,
                        "scheduled": scheduled,
                        "status": status,
                        "notes": notes,
                    },
                )
        return ids
    finally:
        engine.dispose()


def _legacy_visit_rows(engine) -> list[tuple]:
    with engine.connect() as conn:
        rows = conn.execute(
            text(
                "select id, student_id, agent_id, visit_type, scheduled_date, status, notes, "
                "created_at, updated_at from visits order by id"
            )
        ).all()
    # SQLAlchemy may write back "...:00.000000" where the seed wrote "...:00".
    return [
        tuple(str(value)[:19] if index in {4, 7, 8} else value for index, value in enumerate(row))
        for row in rows
    ]


def test_legacy_visits_fold_into_visit_tasks_and_back(tmp_path):
    db_path = tmp_path / "legacy-visits.db"
    assert run_alembic(db_path, "upgrade", "20261007_01").returncode == 0
    ids = _seed_legacy_visits(db_path)
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    before = _legacy_visit_rows(engine)
    assert len(before) == 5

    upgraded = run_alembic(db_path, "upgrade", "20261016_01")

    assert upgraded.returncode == 0, upgraded.stderr
    assert "visits" not in inspect(engine).get_table_names()
    with engine.connect() as conn:
        home = {
            row.student_id: row
            for row in conn.execute(text("select * from home_visit_tasks")).all()
        }
        campus = {
            row.student_id: row
            for row in conn.execute(text("select * from campus_visit_tasks")).all()
        }
        work = {
            (row.kind, row.source_id): row
            for row in conn.execute(text("select * from work_items")).all()
        }
        logs = conn.execute(
            text("select * from operation_logs where action = '合并旧到访'")
        ).all()

    assert set(home) == {ids["待家访"], ids["已家访"], ids["已无效"]}
    assert set(campus) == {ids["待到校"], ids["停用坐席的"]}

    open_home = home[ids["待家访"]]
    assert (open_home.status, open_home.creator_agent_id) == ("pending", ids["active"])
    assert str(open_home.requested_visit_time).startswith("2026-07-11 15:00:00")
    assert open_home.scheduled_at is None
    assert open_home.notes == "家长周末在家"
    assert open_home.student_name_snapshot == "待家访"
    assert open_home.guardian_phone_snapshot == "13900000001"
    assert (open_home.region_snapshot, open_home.school_name_snapshot) == ("芗城", "一中")
    assert (open_home.intent_program, open_home.exam_score) == ("护理", 420.0)
    assert str(open_home.created_at).startswith("2026-07-01 08:00:00")

    done_home = home[ids["已家访"]]
    assert done_home.status == "completed"
    assert str(done_home.scheduled_at).startswith("2026-07-08 10:00:00")

    open_campus = campus[ids["待到校"]]
    assert (open_campus.status, open_campus.source) == ("scheduled", "电话外呼")
    assert str(open_campus.appointment_at).startswith("2026-07-12 09:00:00")
    assert open_campus.notes == ""

    # Work items exist only for open tasks of students still in play, owned like live ones.
    suspended_campus = campus[ids["停用坐席的"]]
    assert set(work) == {
        ("home_visit", open_home.id),
        ("campus_visit", open_campus.id),
        ("campus_visit", suspended_campus.id),
    }
    assert work[("home_visit", open_home.id)].status == "open"
    assert work[("home_visit", open_home.id)].owner_agent_id == ids["active"]
    assert work[("campus_visit", suspended_campus.id)].status == "blocked_suspension"
    assert len(logs) == 5
    assert {log.batch_id for log in logs} == {"alembic-20261016_01"}

    audit = subprocess.run(
        [
            sys.executable,
            "scripts/audit_domain_consistency.py",
            "--database",
            str(db_path),
            "--expect-revision",
            "20261016_01",
        ],
        cwd=PROJECT_ROOT,
        env={**os.environ, "SECRET_KEY": "migration-test-secret"},
        text=True,
        capture_output=True,
        check=False,
    )
    report = json.loads(audit.stdout)
    # The seed skips student_assignments, so only the work-item checks apply here.
    assert report["source_work_item_projection_mismatches"] == 0, report
    assert report["duplicate_source_work_items"] == 0, report
    assert report["open_items_owned_by_inactive"] == 0, report

    downgraded = run_alembic(db_path, "downgrade", "20261007_01")

    assert downgraded.returncode == 0, downgraded.stderr
    assert _legacy_visit_rows(engine) == before
    with engine.connect() as conn:
        for table in ("home_visit_tasks", "campus_visit_tasks", "work_items"):
            assert conn.execute(text(f"select count(*) from {table}")).scalar_one() == 0
        assert conn.execute(
            text("select count(*) from operation_logs where action = '合并旧到访'")
        ).scalar_one() == 0
    engine.dispose()


def test_call_analysis_table_and_settings_are_dropped(tmp_path):
    db_path = tmp_path / "call-analysis.db"
    assert run_alembic(db_path, "upgrade", "20261016_01").returncode == 0
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "insert into users (id, username, hashed_password, role, name, is_active, "
                "is_super_admin, failed_login_attempts, must_change_password, token_version, "
                "service_regions, pushplus_token, page_permissions, operation_permissions, "
                "last_login_device, last_login_ip, created_at) values (1, 'call_agent', 'x', "
                "'agent', '坐席', 1, 0, 0, 0, 1, '', '', '', '', '', '', CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            text(
                "insert into students (id, name, region, status, status_detail, intent_level, "
                "stage, program, guardian_name, guardian_phone, guardian2_name, guardian2_phone, "
                "school_name, school_address, need_help, created_at, updated_at) values (1, "
                "'学生', '', 'contacted', '', 'none', 'initial_contact', '', '', '', '', '', "
                "'', '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            )
        )
        conn.execute(
            text(
                "insert into calls (student_id, agent_id, transcript, ai_intent, created_at) "
                "values (1, 1, '想了解学费', 'B', CURRENT_TIMESTAMP)"
            )
        )
        for key in ("ai_provider", "mimo_api_key", "deepseek_api_key", "pushplus_token"):
            conn.execute(
                text(
                    "insert into system_configs (key, value, updated_at) "
                    "values (:key, 'v', CURRENT_TIMESTAMP)"
                ),
                {"key": key},
            )

    upgraded = run_alembic(db_path, "upgrade", "head")

    assert upgraded.returncode == 0, upgraded.stderr
    assert "calls" not in inspect(engine).get_table_names()
    with engine.connect() as conn:
        keys = {row[0] for row in conn.execute(text("select key from system_configs"))}
    assert keys == {"pushplus_token"}
    check = run_alembic(db_path, "check")
    assert check.returncode == 0, check.stdout + check.stderr

    downgraded = run_alembic(db_path, "downgrade", "20261016_01")

    assert downgraded.returncode == 0, downgraded.stderr
    assert "calls" in inspect(engine).get_table_names()
    with engine.connect() as conn:
        assert conn.execute(text("select count(*) from calls")).scalar_one() == 0
    engine.dispose()


def test_tasks_left_open_on_terminal_students_are_closed(tmp_path):
    db_path = tmp_path / "terminal-tasks.db"
    assert run_alembic(db_path, "upgrade", "20261017_01").returncode == 0
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    when = datetime(2026, 7, 20, 9, 0, 0)
    with Session(engine) as session:
        agent = User(
            username="terminal_agent", hashed_password="x", role=UserRole.agent, name="坐席"
        )
        session.add(agent)
        session.flush()
        invalid = Student(name="已无效", status="child_not_want_study", assigned_to=agent.id)
        enrolled = Student(name="已报名", status=StudentStatus.enrolled, assigned_to=agent.id)
        active = Student(name="在跟进", status=StudentStatus.pending_visit, assigned_to=agent.id)
        session.add_all([invalid, enrolled, active])
        session.flush()

        def snapshot(student):
            return {
                "student_name_snapshot": student.name,
                "region_snapshot": "",
                "school_name_snapshot": "",
            }

        def add_visit(table_name, student, **values):
            # Today's visit models have columns added after 20261017_01, so insert
            # through the schema as it is at this revision; NOT NULL gaps get blanks.
            table = Table(table_name, MetaData(), autoload_with=session.connection())
            row = {
                column.name: when if column.name.endswith("_at") else ""
                for column in table.columns
                if not (column.nullable or column.primary_key)
            }
            for flag in ("is_wechat_added", "is_confirmed_with_guardian", "needs_pickup",
                         "onsite_enrolled"):
                if flag in row:
                    row[flag] = False
            if "visitor_count" in row:
                row["visitor_count"] = 1
            row.update(student_id=student.id, **snapshot(student), **values)
            return session.execute(table.insert().values(**row)).inserted_primary_key[0]

        open_follow_up = FollowUp(
            student_id=invalid.id, agent_id=agent.id, follow_up_date=when, is_completed=False
        )
        kept_follow_up = FollowUp(
            student_id=active.id, agent_id=agent.id, follow_up_date=when, is_completed=False
        )
        session.add_all([open_follow_up, kept_follow_up])
        session.flush()
        home = add_visit(
            "home_visit_tasks", invalid, creator_agent_id=agent.id, status="pending", priority="中"
        )
        spare_campus, enrolling_campus = (
            add_visit(
                "campus_visit_tasks",
                enrolled,
                creator_user_id=agent.id,
                status="scheduled",
                appointment_at=when,
            )
            for _ in range(2)
        )
        onsite_campus = add_visit(
            "campus_visit_tasks",
            enrolled,
            creator_user_id=agent.id,
            status="scheduled",
            result="enrolled",
            appointment_at=when,
        )
        session.add(
            EnrollmentRecord(
                student_id=enrolled.id,
                attributed_agent_id=agent.id,
                confirmed_by_admin_id=agent.id,
                campus_visit_task_id=enrolling_campus,
                **snapshot(enrolled),
            )
        )
        items = {
            name: WorkItem(
                student_id=student.id,
                kind=kind,
                status=WorkItemStatus.open,
                owner_agent_id=agent.id,
                source_type=source_type,
                source_id=source if isinstance(source, int) else source.id,
            )
            for name, student, kind, source_type, source in (
                ("follow_up", invalid, WorkItemKind.scheduled_follow_up, "follow_up", open_follow_up),  # noqa: E501
                ("kept", active, WorkItemKind.scheduled_follow_up, "follow_up", kept_follow_up),
                ("home", invalid, WorkItemKind.home_visit, "home_visit", home),
                ("campus", enrolled, WorkItemKind.campus_visit, "campus_visit", spare_campus),
            )
        }
        session.add_all(items.values())
        session.commit()
        ids = {
            "follow_up": open_follow_up.id,
            "kept_follow_up": kept_follow_up.id,
            "home": home,
            "spare_campus": spare_campus,
            "enrolling_campus": enrolling_campus,
            "onsite_campus": onsite_campus,
            **{f"item_{name}": item.id for name, item in items.items()},
        }

    def state():
        with engine.connect() as conn:
            def one(sql, row_id):
                return conn.execute(text(sql), {"id": row_id}).scalar_one()

            return {
                **{
                    name: one("select is_completed from follow_ups where id=:id", ids[name])
                    for name in ("follow_up", "kept_follow_up")
                },
                "home": one("select status from home_visit_tasks where id=:id", ids["home"]),
                **{
                    name: one("select status from campus_visit_tasks where id=:id", ids[name])
                    for name in ("spare_campus", "enrolling_campus", "onsite_campus")
                },
                **{
                    name: one("select status from work_items where id=:id", ids[name])
                    for name in ("item_follow_up", "item_kept", "item_home", "item_campus")
                },
                "logs": conn.execute(
                    text(
                        "select content from operation_logs where action='自动关闭待办' "
                        "and batch_id='alembic-20261020_01' order by target_student_id"
                    )
                ).scalars().all(),
            }

    before = state()
    upgraded = run_alembic(db_path, "upgrade", "head")

    assert upgraded.returncode == 0, upgraded.stderr
    assert state() == {
        "follow_up": 1,
        "kept_follow_up": 0,
        "home": "cancelled",
        "spare_campus": "cancelled",
        "enrolling_campus": "scheduled",
        "onsite_campus": "scheduled",
        "item_follow_up": "cancelled",
        "item_kept": "open",
        "item_home": "cancelled",
        "item_campus": "cancelled",
        "logs": ["学生无效，关闭回访 1 条、家访 1 条", "学生已报名，关闭到校 1 条"],
    }
    check = run_alembic(db_path, "check")
    assert check.returncode == 0, check.stdout + check.stderr

    downgraded = run_alembic(db_path, "downgrade", "20261017_01")

    assert downgraded.returncode == 0, downgraded.stderr
    assert state() == before
    engine.dispose()
