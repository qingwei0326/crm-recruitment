import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path
from typing import Any

from alembic.config import Config
from sqlalchemy import create_engine

from alembic import command

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

BASELINE = "20260711_01"
REQUIRED_TABLES = {
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
REQUIRED_COLUMNS = {
    "users": {
        "id",
        "is_active",
        "token_version",
        "last_login_device",
        "last_login_ip",
        "must_change_password",
        "is_super_admin",
        "page_permissions",
        "operation_permissions",
    },
    "students": {
        "id",
        "assigned_to",
        "assigned_at",
        "status",
        "status_detail",
        "stage",
        "intent_level",
        "created_at",
        "need_help",
    },
    "dial_logs": {"id", "student_id", "agent_id", "recording_state"},
    "operation_logs": {"id", "operator_id", "action", "batch_id"},
    "follow_ups": {
        "id",
        "student_id",
        "agent_id",
        "follow_up_type",
        "notes",
        "is_completed",
    },
    "home_visit_tasks": {"id", "student_id", "creator_agent_id", "status"},
    "campus_visit_tasks": {"id", "student_id", "creator_user_id", "status"},
    "enrollment_records": {
        "id",
        "student_id",
        "attributed_agent_id",
        "settlement_status",
    },
}
REQUIRED_INDEXES = {
    "students": {
        "ix_students_region",
        "ix_students_school_name",
        "ix_students_guardian_phone",
        "ix_students_guardian2_phone",
    },
    "operation_logs": {"ix_operation_logs_batch_id"},
    "dial_logs": {"ix_dial_logs_recording_state"},
}


def _read_only_uri(path: Path) -> str:
    return f"{path.resolve().as_uri()}?mode=ro"


def inspect_schema(path: Path) -> dict[str, Any]:
    with sqlite3.connect(_read_only_uri(path), uri=True) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "select name from sqlite_master where type = 'table'"
            )
        }
        missing_tables = sorted(REQUIRED_TABLES - tables)
        missing_columns: dict[str, list[str]] = {}
        missing_indexes: dict[str, list[str]] = {}

        for table, required in REQUIRED_COLUMNS.items():
            if table not in tables:
                continue
            actual = {
                row[1]
                for row in connection.execute(
                    f'pragma table_info("{table}")'  # noqa: S608 - static table names
                )
            }
            missing = sorted(required - actual)
            if missing:
                missing_columns[table] = missing

        for table, required in REQUIRED_INDEXES.items():
            if table not in tables:
                continue
            actual = {
                row[1]
                for row in connection.execute(
                    f'pragma index_list("{table}")'  # noqa: S608 - static table names
                )
            }
            missing = sorted(required - actual)
            if missing:
                missing_indexes[table] = missing

        compatibility_issues: list[str] = []
        if "students" in tables:
            student_columns = {
                row[1] for row in connection.execute("pragma table_info(students)")
            }
            if "phone" in student_columns:
                compatibility_issues.append("legacy_students_phone_column")
        if "message_templates" in tables:
            compatibility_issues.append("legacy_message_templates_table")
        if "operation_logs" in tables:
            operator_column = next(
                (
                    row
                    for row in connection.execute("pragma table_info(operation_logs)")
                    if row[1] == "operator_id"
                ),
                None,
            )
            if operator_column is not None and operator_column[3]:
                compatibility_issues.append("operation_logs_operator_id_not_nullable")

        revisions = []
        if "alembic_version" in tables:
            revisions = sorted(
                row[0]
                for row in connection.execute(
                    "select version_num from alembic_version order by version_num"
                )
            )

        return {
            "quick_check": connection.execute("pragma quick_check").fetchone()[0],
            "foreign_key_violations": len(
                connection.execute("pragma foreign_key_check").fetchall()
            ),
            "missing_tables": missing_tables,
            "missing_columns": missing_columns,
            "missing_indexes": missing_indexes,
            "compatibility_issues": compatibility_issues,
            "current_revisions": revisions,
        }


def _select_target_database(path: Path) -> None:
    os.environ.pop("DATABASE_URL", None)
    os.environ["DATABASE_PATH"] = str(path.resolve())
    os.environ.setdefault("SECRET_KEY", "baseline-preflight-only")
    os.environ.setdefault("APP_ENV", "development")


def apply_compatibility(path: Path) -> None:
    _select_target_database(path)
    from app.legacy_schema_compat import run_legacy_schema_compatibility

    engine = create_engine(f"sqlite:///{path.resolve().as_posix()}")
    try:
        with engine.begin() as connection:
            run_legacy_schema_compatibility(connection)
    finally:
        engine.dispose()


def stamp(path: Path) -> None:
    _select_target_database(path)
    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    command.stamp(config, BASELINE)


def _is_valid(report: dict[str, Any]) -> bool:
    return bool(
        report["quick_check"] == "ok"
        and report["foreign_key_violations"] == 0
        and not report["missing_tables"]
        and not report["missing_columns"]
        and not report["missing_indexes"]
        and not report["compatibility_issues"]
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    database = args.database.expanduser().resolve()

    if not database.is_file():
        print(json.dumps({"error": "database_not_found"}, sort_keys=True))
        return 2

    report = inspect_schema(database)
    revisions = report["current_revisions"]
    if revisions and revisions != [BASELINE]:
        report["error"] = "unexpected_alembic_revision"
        print(json.dumps(report, ensure_ascii=False, sort_keys=True))
        return 2

    if args.apply and not report["missing_tables"]:
        apply_compatibility(database)
        report = inspect_schema(database)
        if _is_valid(report):
            if report["current_revisions"] != [BASELINE]:
                stamp(database)
                report = inspect_schema(database)
            report["stamped_revision"] = BASELINE

    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if _is_valid(report) else 2


if __name__ == "__main__":
    raise SystemExit(main())
