import hashlib
import json
import os
import sqlite3
import subprocess
import sys
from datetime import datetime, timedelta
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    StudentAssignment,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import FollowUp, Student, StudentStatus, User, UserRole

PROJECT_ROOT = Path(__file__).resolve().parents[1]
NOW = datetime(2026, 7, 14, 1, 0, 0)


def _database(tmp_path: Path, revision: str = "20260726_01") -> tuple[Path, int, int]:
    database = tmp_path / "work-item-owner-repair.db"
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        source = User(
            username="repair-source",
            hashed_password="test",
            role=UserRole.agent,
            name="Repair Source",
        )
        target = User(
            username="repair-target",
            hashed_password="test",
            role=UserRole.agent,
            name="Repair Target",
        )
        session.add_all([source, target])
        session.flush()
        session.add_all(
            [
                AgentEmployment(user_id=source.id, status=EmploymentStatus.active),
                AgentEmployment(user_id=target.id, status=EmploymentStatus.active),
            ]
        )
        student = Student(
            name="Repair Student",
            assigned_to=target.id,
            assigned_at=NOW,
            status=StudentStatus.not_contacted,
        )
        session.add(student)
        session.flush()
        session.add(
            StudentAssignment(
                student_id=student.id,
                agent_id=target.id,
                started_at=NOW,
                start_reason="test_seed",
                started_by=target.id,
            )
        )
        follow_up = FollowUp(
            student_id=student.id,
            agent_id=source.id,
            follow_up_date=NOW + timedelta(days=1),
        )
        session.add(follow_up)
        session.flush()
        session.add_all(
            [
                WorkItem(
                    student_id=student.id,
                    kind=WorkItemKind.lead_contact,
                    status=WorkItemStatus.open,
                    owner_agent_id=target.id,
                    creator_user_id=source.id,
                    source_type="student",
                    source_id=student.id,
                ),
                WorkItem(
                    student_id=student.id,
                    kind=WorkItemKind.scheduled_follow_up,
                    status=WorkItemStatus.open,
                    owner_agent_id=source.id,
                    creator_user_id=source.id,
                    source_type="follow_up",
                    source_id=follow_up.id,
                ),
            ]
        )
        session.commit()
        student_id = student.id
        target_id = target.id
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "create table alembic_version (version_num varchar(32) not null)"
        )
        connection.exec_driver_sql(
            "insert into alembic_version (version_num) values (?)",
            (revision,),
        )
    engine.dispose()
    return database, student_id, target_id


def _run_cli(database: Path, *, apply: bool = False):
    command = [
        sys.executable,
        "scripts/repair_work_item_owners.py",
        "--database",
        str(database),
        "--expect-revision",
        "20260726_01",
    ]
    if apply:
        command.append("--apply")
    env = os.environ.copy()
    env.setdefault("SECRET_KEY", "work-item-owner-repair-cli-test")
    return subprocess.run(
        command,
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_dry_run_is_read_only_and_reports_aggregate_plan(tmp_path):
    database, _student_id, _target_id = _database(tmp_path)
    before_hash = hashlib.sha256(database.read_bytes()).hexdigest()

    result = _run_cli(database)

    assert result.returncode == 1, result.stderr
    report = json.loads(result.stdout)
    assert report["applied"] is False
    assert report["planned_changes"] == 1
    assert report["planned_by_source_type"] == {"follow_up": 1}
    assert report["before"]["source_work_item_projection_mismatches"] == 1
    assert hashlib.sha256(database.read_bytes()).hexdigest() == before_hash
    assert "Repair Student" not in result.stdout
    assert result.stderr == ""


def test_apply_repairs_owner_and_is_idempotent(tmp_path):
    database, student_id, target_id = _database(tmp_path)

    first = _run_cli(database, apply=True)
    second = _run_cli(database, apply=True)

    assert first.returncode == 0, first.stderr
    first_report = json.loads(first.stdout)
    assert first_report["changed"] == 1
    assert first_report["after"]["ok"] is True
    assert second.returncode == 0, second.stderr
    second_report = json.loads(second.stdout)
    assert second_report["changed"] == 0
    assert second_report["planned_changes"] == 0
    with sqlite3.connect(database) as connection:
        row = connection.execute(
            """
            select owner_agent_id, status, version
            from work_items
            where student_id = ? and source_type = 'follow_up'
            """,
            (student_id,),
        ).fetchone()
    assert row == (target_id, "open", 2)


def test_cli_rejects_unexpected_revision_without_writing(tmp_path):
    database, _student_id, _target_id = _database(tmp_path, revision="20260711_02")
    before_hash = hashlib.sha256(database.read_bytes()).hexdigest()

    result = _run_cli(database, apply=True)

    assert result.returncode == 2
    assert json.loads(result.stdout) == {
        "actual_revision": "20260711_02",
        "error": "unexpected_revision",
        "expected_revision": "20260726_01",
    }
    assert hashlib.sha256(database.read_bytes()).hexdigest() == before_hash
