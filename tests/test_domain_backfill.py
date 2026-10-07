import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime
from pathlib import Path

import pytest
from sqlalchemy import create_engine, event, select, update
from sqlalchemy.orm import Session

from app.database import Base
from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    LeadOutcomeReason,
    StudentAssignment,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.migration_data.domain_backfill_20260711 import (
    audit_domain_core,
    backfill_domain_core,
)
from app.models import (
    CampusVisitTask,
    EnrollmentRecord,
    FollowUp,
    HomeVisitStatus,
    HomeVisitTask,
    OperationLog,
    Student,
    StudentStatus,
    User,
    UserRole,
)

NOW = datetime(2026, 7, 11, 0, 0, 0)
PROJECT_ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def sync_session():
    engine = create_engine("sqlite://")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record):
        dbapi_connection.execute("pragma foreign_keys=on")

    Base.metadata.create_all(engine)
    with Session(engine) as session:
        yield session
    engine.dispose()


def seed_legacy_domain_scenario(session: Session) -> dict[str, object]:
    active = User(
        username="active_agent",
        hashed_password="test",
        role=UserRole.agent,
        name="在职员工",
        is_active=True,
    )
    audited_inactive = User(
        username="audited_inactive",
        hashed_password="test",
        role=UserRole.agent,
        name="已办理离职",
        is_active=False,
    )
    suspended_inactive = User(
        username="suspended_inactive",
        hashed_password="test",
        role=UserRole.agent,
        name="暂停员工",
        is_active=False,
    )
    session.add_all([active, audited_inactive, suspended_inactive])
    session.flush()

    active_student = Student(
        name="在职非终态",
        region="测试区",
        assigned_to=active.id,
        assigned_at=datetime(2026, 7, 1, 8, 0, 0),
        status=StudentStatus.contacted,
    )
    terminal_student = Student(
        name="历史终态",
        region="测试区",
        assigned_to=audited_inactive.id,
        status=StudentStatus.invalid,
        status_detail="报好了",
    )
    suspended_student = Student(
        name="暂停非终态",
        region="测试区",
        assigned_to=suspended_inactive.id,
        status=StudentStatus.pending_visit,
    )
    blank_invalid = Student(
        name="空白无效原因",
        region="测试区",
        status=StudentStatus.invalid,
        status_detail="",
    )
    session.add_all([active_student, terminal_student, suspended_student, blank_invalid])
    session.flush()

    pending_follow_up = FollowUp(
        student_id=active_student.id,
        agent_id=active.id,
        follow_up_date=datetime(2026, 7, 12, 9, 0, 0),
        is_completed=False,
    )
    completed_follow_up = FollowUp(
        student_id=active_student.id,
        agent_id=active.id,
        follow_up_date=datetime(2026, 7, 10, 9, 0, 0),
        is_completed=True,
    )
    pending_home_visit = HomeVisitTask(
        student_id=active_student.id,
        creator_agent_id=active.id,
        status=HomeVisitStatus.pending,
    )
    completed_home_visit = HomeVisitTask(
        student_id=active_student.id,
        creator_agent_id=active.id,
        status=HomeVisitStatus.completed,
    )
    session.add_all(
        [
            pending_follow_up,
            completed_follow_up,
            pending_home_visit,
            completed_home_visit,
        ]
    )
    session.add(
        OperationLog(
            operator_id=active.id,
            operator_name=active.name,
            action="离职用户",
            content=(
                f"离职 {audited_inactive.role.value} "
                f"{audited_inactive.username}({audited_inactive.name})："
                "回收非终态 0 条、保留终态 1 条"
            ),
        )
    )
    session.flush()
    return {
        "active": active,
        "audited_inactive": audited_inactive,
        "suspended_inactive": suspended_inactive,
        "active_student": active_student,
        "terminal_student": terminal_student,
        "suspended_student": suspended_student,
        "blank_invalid": blank_invalid,
        "pending_follow_up": pending_follow_up,
        "completed_follow_up": completed_follow_up,
        "pending_home_visit": pending_home_visit,
        "completed_home_visit": completed_home_visit,
    }


def test_backfill_domain_core_is_idempotent_and_preserves_legacy_state(sync_session):
    seeded = seed_legacy_domain_scenario(sync_session)
    terminal_student = seeded["terminal_student"]
    before_terminal_state = (
        terminal_student.status,
        terminal_student.status_detail,
        terminal_student.assigned_to,
    )

    report = backfill_domain_core(sync_session, now=NOW)
    sync_session.flush()

    assert report == {
        "employment_created": 3,
        "employment_events_created": 3,
        "assignments_created": 3,
        "lead_work_items_created": 2,
        "source_work_items_created": 2,
        "source_work_items_skipped_no_owner": 0,
        "outcome_reasons_created": 7,
        "outcomes_mapped": 2,
    }
    assert (
        terminal_student.status,
        terminal_student.status_detail,
        terminal_student.assigned_to,
    ) == before_terminal_state

    employment_by_user = {
        row.user_id: row.status for row in sync_session.scalars(select(AgentEmployment)).all()
    }
    assert employment_by_user[seeded["active"].id] == EmploymentStatus.active
    assert employment_by_user[seeded["audited_inactive"].id] == EmploymentStatus.offboarded
    assert employment_by_user[seeded["suspended_inactive"].id] == EmploymentStatus.suspended

    assignments = sync_session.scalars(select(StudentAssignment)).all()
    assert len(assignments) == 3
    active_assignment = next(
        row for row in assignments if row.student_id == seeded["active_student"].id
    )
    assert active_assignment.started_at == datetime(2026, 7, 1, 8, 0, 0)

    work_items = sync_session.scalars(select(WorkItem)).all()
    assert len(work_items) == 4
    suspended_lead = next(
        row
        for row in work_items
        if row.kind == WorkItemKind.lead_contact
        and row.student_id == seeded["suspended_student"].id
    )
    assert suspended_lead.status == WorkItemStatus.blocked_suspension
    assert not any(
        row.source_type == "follow_up" and row.source_id == seeded["completed_follow_up"].id
        for row in work_items
    )
    assert not any(
        row.source_type == "home_visit" and row.source_id == seeded["completed_home_visit"].id
        for row in work_items
    )

    sync_session.expire(terminal_student, ["outcome_reason_code"])
    sync_session.expire(seeded["blank_invalid"], ["outcome_reason_code"])
    assert terminal_student.outcome_reason_code == "enrolled_elsewhere"
    assert seeded["blank_invalid"].outcome_reason_code == "legacy_unspecified"
    enrolled_elsewhere = sync_session.get(LeadOutcomeReason, "enrolled_elsewhere")
    assert enrolled_elsewhere.label == "已报名其他学校"
    assert enrolled_elsewhere.terminal is True
    assert enrolled_elsewhere.reclaimable is False

    audit = audit_domain_core(sync_session)
    assert audit["ok"] is True
    assert all(value == 0 for key, value in audit.items() if key != "ok")

    second = backfill_domain_core(sync_session, now=NOW.replace(second=1))
    assert all(value == 0 for key, value in second.items() if key.endswith("_created"))
    assert second["outcomes_mapped"] == 0
    assert audit_domain_core(sync_session)["ok"] is True


def test_audit_cli_is_read_only_and_emits_aggregate_json(tmp_path):
    db_path = tmp_path / "audit.db"
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        seed_legacy_domain_scenario(session)
        backfill_domain_core(session, now=NOW)
        session.commit()
    engine.dispose()
    before_hash = hashlib.sha256(db_path.read_bytes()).hexdigest()

    env = os.environ.copy()
    env.setdefault("SECRET_KEY", "migration-test-secret")
    result = subprocess.run(
        [
            sys.executable,
            "scripts/audit_domain_backfill.py",
            "--database",
            str(db_path),
        ],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["ok"] is True
    assert all(value == 0 for key, value in report.items() if key != "ok")
    assert hashlib.sha256(db_path.read_bytes()).hexdigest() == before_hash
    assert "在职员工" not in result.stdout
    assert "测试区" not in result.stdout


def test_source_work_items_keep_creator_and_use_current_owner(sync_session):
    creator = User(
        username="source_creator",
        hashed_password="test",
        role=UserRole.agent,
        name="原创建人",
        is_active=True,
    )
    current_owner = User(
        username="current_owner",
        hashed_password="test",
        role=UserRole.agent,
        name="现负责人",
        is_active=True,
    )
    sync_session.add_all([creator, current_owner])
    sync_session.flush()
    active_student = Student(
        name="现负责人学生",
        region="测试区",
        assigned_to=current_owner.id,
        status=StudentStatus.contacted,
        need_help=True,
    )
    enrolled_student = Student(
        name="结算学生",
        region="测试区",
        assigned_to=current_owner.id,
        status=StudentStatus.enrolled,
    )
    sync_session.add_all([active_student, enrolled_student])
    sync_session.flush()
    sync_session.add_all(
        [
            FollowUp(
                student_id=active_student.id,
                agent_id=creator.id,
                follow_up_date=datetime(2026, 7, 12, 9, 0, 0),
                is_completed=False,
            ),
            HomeVisitTask(
                student_id=active_student.id,
                creator_agent_id=creator.id,
            ),
            CampusVisitTask(
                student_id=active_student.id,
                creator_user_id=creator.id,
            ),
            EnrollmentRecord(
                student_id=enrolled_student.id,
                attributed_agent_id=creator.id,
                confirmed_by_admin_id=creator.id,
            ),
        ]
    )
    sync_session.flush()

    report = backfill_domain_core(sync_session, now=NOW)

    assert report["lead_work_items_created"] == 1
    assert report["source_work_items_created"] == 5
    items = sync_session.scalars(select(WorkItem)).all()
    by_kind = {item.kind: item for item in items}
    assert set(by_kind) == {
        WorkItemKind.lead_contact,
        WorkItemKind.scheduled_follow_up,
        WorkItemKind.home_visit,
        WorkItemKind.campus_visit,
        WorkItemKind.enrollment_settlement,
        WorkItemKind.help_request,
    }
    assert all(item.owner_agent_id == current_owner.id for item in items)
    for kind in {
        WorkItemKind.scheduled_follow_up,
        WorkItemKind.home_visit,
        WorkItemKind.campus_visit,
        WorkItemKind.enrollment_settlement,
    }:
        assert by_kind[kind].creator_user_id == creator.id
    assert by_kind[WorkItemKind.lead_contact].creator_user_id == current_owner.id
    assert by_kind[WorkItemKind.help_request].creator_user_id == current_owner.id
    assert audit_domain_core(sync_session)["ok"] is True

    sync_session.execute(
        update(Student).where(Student.id == active_student.id).values(assigned_to=None)
    )
    broken_audit = audit_domain_core(sync_session)
    assert broken_audit["ok"] is False
    assert broken_audit["active_assignment_projection_mismatches"] == 1


def test_audit_cli_returns_structured_error_for_incomplete_schema(tmp_path):
    db_path = tmp_path / "incomplete.db"
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    with engine.begin() as connection:
        connection.exec_driver_sql("create table users (id integer primary key)")
    engine.dispose()

    result = subprocess.run(
        [
            sys.executable,
            "scripts/audit_domain_backfill.py",
            "--database",
            str(db_path),
        ],
        cwd=PROJECT_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 2
    assert json.loads(result.stdout)["error"] == "domain_audit_failed"
    assert result.stderr == ""
