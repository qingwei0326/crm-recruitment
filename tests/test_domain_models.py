from sqlalchemy import create_engine, inspect

from app.database import Base
from app.domain_models import (
    EmploymentStatus,
    HandoverBatchStatus,
    HandoverItemStatus,
    HandoverTransferMode,
    HandoverTransferStatus,
    WorkItemKind,
    WorkItemStatus,
)

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


def test_domain_tables_are_registered_and_created():
    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine)
        inspector = inspect(engine)

        assert DOMAIN_TABLES <= set(inspector.get_table_names())
        student_columns = {column["name"]: column for column in inspector.get_columns("students")}
        assert student_columns["outcome_reason_code"]["nullable"] is True
    finally:
        engine.dispose()


def test_domain_enum_values_are_stable():
    assert [value.value for value in EmploymentStatus] == [
        "active",
        "suspended",
        "handover_pending",
        "offboarded",
    ]
    assert [value.value for value in WorkItemKind] == [
        "lead_contact",
        "scheduled_follow_up",
        "home_visit",
        "campus_visit",
        "enrollment_settlement",
        "help_request",
    ]
    assert [value.value for value in WorkItemStatus] == [
        "open",
        "blocked_suspension",
        "blocked_handover",
        "completed",
        "cancelled",
    ]
    assert [value.value for value in HandoverBatchStatus] == [
        "pending",
        "in_progress",
        "completed",
        "cancelled",
    ]
    assert [value.value for value in HandoverItemStatus] == [
        "pending",
        "transferred",
        "conflict",
        "cancelled",
    ]
    assert [value.value for value in HandoverTransferMode] == [
        "selected",
        "all_remaining",
    ]
    assert [value.value for value in HandoverTransferStatus] == [
        "running",
        "completed",
        "failed",
    ]


def test_domain_uniqueness_constraints_are_database_enforced():
    engine = create_engine("sqlite://")
    try:
        Base.metadata.create_all(engine)
        inspector = inspect(engine)

        assignment_indexes = {
            index["name"]: index for index in inspector.get_indexes("student_assignments")
        }
        active_assignment = assignment_indexes["uq_student_assignments_active_student"]
        assert active_assignment["unique"] == 1
        assert "ended_at IS NULL" in str(active_assignment["dialect_options"]["sqlite_where"])

        batch_indexes = {
            index["name"]: index for index in inspector.get_indexes("handover_batches")
        }
        active_batch = batch_indexes["uq_handover_batches_active_source"]
        assert active_batch["unique"] == 1
        assert "in_progress" in str(active_batch["dialect_options"]["sqlite_where"])

        work_item_constraints = {
            constraint["name"] for constraint in inspector.get_unique_constraints("work_items")
        }
        assert "uq_work_items_source" in work_item_constraints

        event_constraint_names = [
            constraint["name"]
            for constraint in inspector.get_check_constraints("agent_employment_events")
        ]
        assert len(event_constraint_names) == len(set(event_constraint_names))
    finally:
        engine.dispose()
