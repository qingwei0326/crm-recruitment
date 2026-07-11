"""Seed and audit a disposable SQLite database for the handover E2E test."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import secrets
import sqlite3
import sys
from datetime import timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))
FORBIDDEN_DATABASE = (PROJECT_ROOT / "crm.db").resolve()
FORBIDDEN_SNAPSHOT_ROOT = (PROJECT_ROOT / "backups" / "server-audit").resolve()

ADMIN_USERNAME = "e2e_admin"
SOURCE_USERNAME = "e2e_source"
TARGET_USERNAME = "e2e_target"


class SeedError(RuntimeError):
    pass


def _is_within(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
    except ValueError:
        return False
    return True


def _read_usernames(database: Path) -> list[str]:
    uri = database.as_uri().replace("file://", "file:") + "?mode=ro"
    try:
        connection = sqlite3.connect(uri, uri=True)
    except sqlite3.Error as exc:
        raise SeedError(f"Cannot open SQLite database: {exc}") from exc
    try:
        users_table = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'users'"
        ).fetchone()
        if users_table is None:
            raise SeedError("Database is not migrated: users table is missing")
        return [str(row[0]) for row in connection.execute("SELECT username FROM users")]
    finally:
        connection.close()


def validate_database(database_arg: str, *, allow_seeded: bool) -> Path:
    database = Path(database_arg).expanduser().resolve(strict=True)
    if not database.is_file():
        raise SeedError("Database path must be a file")
    if database == FORBIDDEN_DATABASE:
        raise SeedError("Refusing to use the project crm.db")
    if _is_within(database, FORBIDDEN_SNAPSHOT_ROOT):
        raise SeedError("Refusing to use a server-audit database")

    usernames = _read_usernames(database)
    unsafe_username = next(
        (username for username in usernames if not username.startswith("e2e_")),
        None,
    )
    if unsafe_username is not None:
        raise SeedError("Refusing a database that contains non-e2e users")
    if usernames and not allow_seeded:
        raise SeedError("Disposable database is already seeded")
    return database


async def seed_database(database: Path) -> dict[str, str]:
    os.environ.pop("DATABASE_URL", None)
    os.environ["DATABASE_PATH"] = str(database)
    os.environ["SECRET_KEY"] = "e2e-seed-only-secret-key"
    os.environ["BCRYPT_ROUNDS"] = "4"

    from app.auth import hash_password
    from app.database import async_session
    from app.domain_models import AgentEmployment, EmploymentStatus, StudentAssignment, WorkItemKind
    from app.models import (
        CampusVisitStatus,
        CampusVisitTask,
        FollowUp,
        HomeVisitStatus,
        HomeVisitTask,
        IntentLevel,
        Student,
        StudentStage,
        StudentStatus,
        User,
        UserRole,
    )
    from app.services.work_item_service import (
        campus_visit_is_open,
        home_visit_is_open,
        sync_source_work_item,
        sync_students_work_items,
    )
    from app.utils import utcnow

    admin_password = secrets.token_urlsafe(18)
    source_password = secrets.token_urlsafe(18)
    target_password = secrets.token_urlsafe(18)
    now = utcnow()

    async with async_session() as database_session:
        async with database_session.begin():
            admin = User(
                username=ADMIN_USERNAME,
                hashed_password=hash_password(admin_password),
                role=UserRole.admin,
                name="E2E Admin",
                is_active=True,
                is_super_admin=True,
                must_change_password=False,
                token_version=1,
            )
            source = User(
                username=SOURCE_USERNAME,
                hashed_password=hash_password(source_password),
                role=UserRole.agent,
                name="E2E Source Agent",
                is_active=True,
                must_change_password=False,
                token_version=1,
            )
            target = User(
                username=TARGET_USERNAME,
                hashed_password=hash_password(target_password),
                role=UserRole.agent,
                name="E2E Target Agent",
                is_active=True,
                must_change_password=False,
                token_version=1,
            )
            database_session.add_all([admin, source, target])
            await database_session.flush()

            database_session.add_all(
                [
                    AgentEmployment(
                        user_id=admin.id,
                        status=EmploymentStatus.active,
                        version=1,
                        status_changed_at=now,
                        updated_by=admin.id,
                    ),
                    AgentEmployment(
                        user_id=source.id,
                        status=EmploymentStatus.active,
                        version=1,
                        status_changed_at=now,
                        updated_by=admin.id,
                    ),
                    AgentEmployment(
                        user_id=target.id,
                        status=EmploymentStatus.active,
                        version=1,
                        status_changed_at=now,
                        updated_by=admin.id,
                    ),
                ]
            )

            students = [
                Student(
                    name="E2E Student Alpha",
                    region="E2E Region",
                    assigned_to=source.id,
                    assigned_at=now - timedelta(days=14),
                    status=StudentStatus.contacted,
                    status_detail="E2E overdue follow-up",
                    intent_level=IntentLevel.A,
                    stage=StudentStage.home_visit_scheduled,
                    guardian_name="E2E Guardian Alpha",
                    guardian_phone="13000000001",
                    school_name="E2E School",
                    case_no="E2E-HANDOVER-ALPHA",
                ),
                Student(
                    name="E2E Student Beta",
                    region="E2E Region",
                    assigned_to=source.id,
                    assigned_at=now - timedelta(days=10),
                    status=StudentStatus.pending_visit,
                    status_detail="E2E campus appointment",
                    intent_level=IntentLevel.B,
                    stage=StudentStage.campus_visit_scheduled,
                    guardian_name="E2E Guardian Beta",
                    guardian_phone="13000000002",
                    school_name="E2E School",
                    case_no="E2E-HANDOVER-BETA",
                ),
            ]
            database_session.add_all(students)
            await database_session.flush()

            for student in students:
                database_session.add(
                    StudentAssignment(
                        student_id=student.id,
                        agent_id=source.id,
                        started_at=student.assigned_at,
                        start_reason="e2e_seed",
                        started_by=admin.id,
                        created_at=student.assigned_at,
                        updated_at=student.assigned_at,
                    )
                )

            follow_ups = [
                FollowUp(
                    student_id=students[0].id,
                    agent_id=source.id,
                    follow_up_date=now - timedelta(hours=2),
                    follow_up_type="phone",
                    notes="E2E overdue history",
                    is_notified=False,
                    is_completed=False,
                    created_at=now - timedelta(days=2),
                ),
                FollowUp(
                    student_id=students[1].id,
                    agent_id=source.id,
                    follow_up_date=now + timedelta(days=1),
                    follow_up_type="phone",
                    notes="E2E future history",
                    is_notified=False,
                    is_completed=False,
                    created_at=now - timedelta(days=1),
                ),
            ]
            database_session.add_all(follow_ups)

            home_visit = HomeVisitTask(
                student_id=students[0].id,
                creator_agent_id=source.id,
                assigned_admin_id=admin.id,
                status=HomeVisitStatus.scheduled,
                priority="high",
                student_name_snapshot=students[0].name,
                guardian_phone_snapshot=students[0].guardian_phone,
                region_snapshot=students[0].region,
                school_name_snapshot=students[0].school_name,
                requested_visit_time=now + timedelta(hours=6),
                scheduled_at=now + timedelta(hours=8),
                address="E2E Address",
                notes="E2E home visit history",
                created_at=now - timedelta(days=1),
                updated_at=now - timedelta(days=1),
            )
            campus_visit = CampusVisitTask(
                student_id=students[1].id,
                creator_user_id=source.id,
                reception_admin_id=admin.id,
                status=CampusVisitStatus.scheduled,
                source="e2e_seed",
                student_name_snapshot=students[1].name,
                guardian_phone_snapshot=students[1].guardian_phone,
                region_snapshot=students[1].region,
                school_name_snapshot=students[1].school_name,
                appointment_at=now + timedelta(days=2),
                notes="E2E campus visit history",
                created_at=now - timedelta(hours=12),
                updated_at=now - timedelta(hours=12),
            )
            database_session.add_all([home_visit, campus_visit])
            await database_session.flush()

            for follow_up, student in zip(follow_ups, students, strict=True):
                await sync_source_work_item(
                    database_session,
                    WorkItemKind.scheduled_follow_up,
                    "follow_up",
                    follow_up.id,
                    student,
                    follow_up.agent_id,
                    follow_up.follow_up_date,
                    follow_up.is_completed,
                    admin,
                    at=now,
                )
            await sync_source_work_item(
                database_session,
                WorkItemKind.home_visit,
                "home_visit",
                home_visit.id,
                students[0],
                home_visit.creator_agent_id,
                home_visit.scheduled_at,
                not home_visit_is_open(home_visit),
                admin,
                at=now,
            )
            await sync_source_work_item(
                database_session,
                WorkItemKind.campus_visit,
                "campus_visit",
                campus_visit.id,
                students[1],
                campus_visit.creator_user_id,
                campus_visit.appointment_at,
                not campus_visit_is_open(campus_visit),
                admin,
                at=now,
            )
            await sync_students_work_items(database_session, students, admin, at=now)

    return {"username": ADMIN_USERNAME, "password": admin_password}


def _scalar(connection: sqlite3.Connection, query: str, parameters: tuple = ()):
    row = connection.execute(query, parameters).fetchone()
    return row[0] if row else None


def audit_completed_handover(database: Path) -> None:
    connection = sqlite3.connect(database)
    try:
        source_id = _scalar(
            connection,
            "SELECT id FROM users WHERE username = ?",
            (SOURCE_USERNAME,),
        )
        target_id = _scalar(
            connection,
            "SELECT id FROM users WHERE username = ?",
            (TARGET_USERNAME,),
        )
        if source_id is None or target_id is None:
            raise SeedError("Synthetic source or target user is missing")

        checks = {
            "source employment is offboarded": _scalar(
                connection,
                "SELECT status = 'offboarded' FROM agent_employment WHERE user_id = ?",
                (source_id,),
            ),
            "source login is disabled": _scalar(
                connection,
                "SELECT is_active = 0 FROM users WHERE id = ?",
                (source_id,),
            ),
            "both students moved to target": _scalar(
                connection,
                "SELECT COUNT(*) = 2 FROM students WHERE assigned_to = ?",
                (target_id,),
            ),
            "target owns both active assignments": _scalar(
                connection,
                "SELECT COUNT(*) = 2 FROM student_assignments "
                "WHERE agent_id = ? AND ended_at IS NULL",
                (target_id,),
            ),
            "source assignments remain as history": _scalar(
                connection,
                "SELECT COUNT(*) = 2 FROM student_assignments "
                "WHERE agent_id = ? AND ended_at IS NOT NULL",
                (source_id,),
            ),
            "follow-up creators are unchanged": _scalar(
                connection,
                "SELECT COUNT(*) = 2 FROM follow_ups WHERE agent_id = ?",
                (source_id,),
            ),
            "home-visit creator is unchanged": _scalar(
                connection,
                "SELECT COUNT(*) = 1 FROM home_visit_tasks WHERE creator_agent_id = ?",
                (source_id,),
            ),
            "campus-visit creator is unchanged": _scalar(
                connection,
                "SELECT COUNT(*) = 1 FROM campus_visit_tasks WHERE creator_user_id = ?",
                (source_id,),
            ),
            "all six work items remain open": _scalar(
                connection,
                "SELECT COUNT(*) = 6 FROM work_items WHERE status = 'open'",
            ),
            "target owns every open work item": _scalar(
                connection,
                "SELECT COUNT(*) = 0 FROM work_items "
                "WHERE status = 'open' AND owner_agent_id != ?",
                (target_id,),
            ),
            "work-item creators are unchanged": _scalar(
                connection,
                "SELECT COUNT(*) = 6 FROM work_items WHERE creator_user_id = ?",
                (source_id,),
            ),
            "handover batch completed": _scalar(
                connection,
                "SELECT COUNT(*) = 1 FROM handover_batches "
                "WHERE status = 'completed' AND remaining_items = 0 AND transferred_items = 2",
            ),
        }
        failed = [label for label, passed in checks.items() if not passed]
        if failed:
            raise SeedError("Handover audit failed: " + "; ".join(failed))
    finally:
        connection.close()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, help="Disposable migrated SQLite database")
    parser.add_argument(
        "--verify-complete",
        action="store_true",
        help="Silently verify the completed handover instead of seeding",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        database = validate_database(args.database, allow_seeded=args.verify_complete)
        if args.verify_complete:
            audit_completed_handover(database)
            return 0
        credentials = asyncio.run(seed_database(database))
        print(json.dumps(credentials, separators=(",", ":")))
        return 0
    except (OSError, sqlite3.Error, SeedError) as exc:
        print(f"seed_handover_e2e: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
