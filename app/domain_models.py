import enum

from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy import Enum as SAEnum

from app.database import Base


class EmploymentStatus(enum.StrEnum):
    active = "active"
    suspended = "suspended"
    handover_pending = "handover_pending"
    offboarded = "offboarded"


class WorkItemKind(enum.StrEnum):
    lead_contact = "lead_contact"
    scheduled_follow_up = "scheduled_follow_up"
    home_visit = "home_visit"
    campus_visit = "campus_visit"
    enrollment_settlement = "enrollment_settlement"
    help_request = "help_request"


class WorkItemStatus(enum.StrEnum):
    open = "open"
    blocked_suspension = "blocked_suspension"
    blocked_handover = "blocked_handover"
    completed = "completed"
    cancelled = "cancelled"


class HandoverBatchStatus(enum.StrEnum):
    pending = "pending"
    in_progress = "in_progress"
    completed = "completed"
    cancelled = "cancelled"


class HandoverItemStatus(enum.StrEnum):
    pending = "pending"
    transferred = "transferred"
    conflict = "conflict"
    cancelled = "cancelled"


class HandoverTransferMode(enum.StrEnum):
    selected = "selected"
    all_remaining = "all_remaining"


class HandoverTransferStatus(enum.StrEnum):
    running = "running"
    completed = "completed"
    failed = "failed"


def _stored_enum(enum_type: type[enum.StrEnum], name: str) -> SAEnum:
    return SAEnum(
        enum_type,
        name=name,
        native_enum=False,
        create_constraint=True,
        validate_strings=True,
        values_callable=lambda values: [value.value for value in values],
    )


class AgentEmployment(Base):
    __tablename__ = "agent_employment"

    user_id = Column(Integer, ForeignKey("users.id"), primary_key=True)
    status = Column(
        _stored_enum(EmploymentStatus, "agent_employment_status"),
        nullable=False,
        default=EmploymentStatus.active,
    )
    version = Column(Integer, nullable=False, default=1)
    status_changed_at = Column(DateTime, nullable=False, default=func.now())
    offboarding_started_at = Column(DateTime, nullable=True)
    offboarded_at = Column(DateTime, nullable=True)
    updated_by = Column(Integer, ForeignKey("users.id"), nullable=True)


class HandoverBatch(Base):
    __tablename__ = "handover_batches"
    __table_args__ = (
        Index(
            "uq_handover_batches_active_source",
            "source_agent_id",
            unique=True,
            sqlite_where=text("status IN ('pending', 'in_progress')"),
            postgresql_where=text("status IN ('pending', 'in_progress')"),
        ),
        Index("ix_handover_batches_status_initiated", "status", "initiated_at"),
        UniqueConstraint(
            "idempotency_key",
            name="uq_handover_batches_idempotency",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    source_agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    status = Column(
        _stored_enum(HandoverBatchStatus, "handover_batch_status"),
        nullable=False,
        default=HandoverBatchStatus.pending,
    )
    version = Column(Integer, nullable=False, default=1)
    total_items = Column(Integer, nullable=False, default=0)
    remaining_items = Column(Integer, nullable=False, default=0)
    transferred_items = Column(Integer, nullable=False, default=0)
    initiated_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    initiated_at = Column(DateTime, nullable=False, default=func.now())
    completed_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    completed_at = Column(DateTime, nullable=True)
    idempotency_key = Column(String(128), nullable=False)


class AgentEmploymentEvent(Base):
    __tablename__ = "agent_employment_events"
    __table_args__ = (
        Index("ix_agent_employment_events_user_created", "user_id", "created_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    from_status = Column(
        _stored_enum(EmploymentStatus, "agent_employment_event_from_status"),
        nullable=False,
    )
    to_status = Column(
        _stored_enum(EmploymentStatus, "agent_employment_event_to_status"),
        nullable=False,
    )
    reason = Column(String(128), nullable=False)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    handover_batch_id = Column(
        Integer,
        ForeignKey("handover_batches.id"),
        nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=func.now())


class StudentAssignment(Base):
    __tablename__ = "student_assignments"
    __table_args__ = (
        Index(
            "uq_student_assignments_active_student",
            "student_id",
            unique=True,
            sqlite_where=text("ended_at IS NULL"),
            postgresql_where=text("ended_at IS NULL"),
        ),
        Index(
            "ix_student_assignments_student_started",
            "student_id",
            "started_at",
        ),
        Index("ix_student_assignments_agent_ended", "agent_id", "ended_at"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    started_at = Column(DateTime, nullable=False)
    ended_at = Column(DateTime, nullable=True)
    start_reason = Column(String(64), nullable=False)
    end_reason = Column(String(64), nullable=True)
    started_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    ended_by = Column(Integer, ForeignKey("users.id"), nullable=True)
    handover_batch_id = Column(
        Integer,
        ForeignKey("handover_batches.id"),
        nullable=True,
    )
    previous_assignment_id = Column(
        Integer,
        ForeignKey("student_assignments.id"),
        nullable=True,
    )
    created_at = Column(DateTime, nullable=False, default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        default=func.now(),
        onupdate=func.now(),
    )


class PersonalGroup(Base):
    __tablename__ = "personal_groups"
    __table_args__ = (
        Index("ix_personal_groups_owner_archived", "owner_id", "archived_at"),
        Index(
            "uq_personal_groups_owner_name_active",
            "owner_id",
            "name",
            unique=True,
            sqlite_where=text("archived_at IS NULL"),
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    owner_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(20), nullable=False)
    color = Column(String(16), nullable=False, default="cyan")
    archived_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        default=func.now(),
        onupdate=func.now(),
    )


class PersonalGroupMembership(Base):
    __tablename__ = "personal_group_memberships"
    __table_args__ = (
        Index(
            "uq_personal_group_memberships_active",
            "group_id",
            "student_id",
            unique=True,
            sqlite_where=text("archived_at IS NULL"),
            postgresql_where=text("archived_at IS NULL"),
        ),
        Index(
            "ix_personal_group_memberships_group_archived",
            "group_id",
            "archived_at",
        ),
        Index(
            "ix_personal_group_memberships_student_archived",
            "student_id",
            "archived_at",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    group_id = Column(
        Integer,
        ForeignKey("personal_groups.id", ondelete="CASCADE"),
        nullable=False,
    )
    student_id = Column(
        Integer,
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
    )
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)
    archived_at = Column(DateTime, nullable=True)
    archived_by = Column(
        Integer,
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    archive_reason = Column(String(64), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        default=func.now(),
        onupdate=func.now(),
    )


class WorkItem(Base):
    __tablename__ = "work_items"
    __table_args__ = (
        UniqueConstraint(
            "kind",
            "source_type",
            "source_id",
            name="uq_work_items_source",
        ),
        Index("ix_work_items_owner_status_due", "owner_agent_id", "status", "due_at"),
        Index("ix_work_items_student_status", "student_id", "status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    student_id = Column(Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    kind = Column(
        _stored_enum(WorkItemKind, "work_item_kind"),
        nullable=False,
    )
    status = Column(
        _stored_enum(WorkItemStatus, "work_item_status"),
        nullable=False,
        default=WorkItemStatus.open,
    )
    owner_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    creator_user_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    priority = Column(String(16), nullable=False, default="medium")
    due_at = Column(DateTime, nullable=True)
    completed_at = Column(DateTime, nullable=True)
    source_type = Column(String(32), nullable=False)
    source_id = Column(Integer, nullable=False)
    handover_batch_id = Column(
        Integer,
        ForeignKey("handover_batches.id"),
        nullable=True,
    )
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime, nullable=False, default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        default=func.now(),
        onupdate=func.now(),
    )


class HandoverTransfer(Base):
    __tablename__ = "handover_transfers"
    __table_args__ = (
        UniqueConstraint(
            "idempotency_key",
            name="uq_handover_transfers_idempotency",
        ),
        Index(
            "ix_handover_transfers_batch_created",
            "handover_batch_id",
            "created_at",
        ),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    handover_batch_id = Column(
        Integer,
        ForeignKey("handover_batches.id"),
        nullable=False,
    )
    target_agent_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    mode = Column(
        _stored_enum(HandoverTransferMode, "handover_transfer_mode"),
        nullable=False,
    )
    status = Column(
        _stored_enum(HandoverTransferStatus, "handover_transfer_status"),
        nullable=False,
        default=HandoverTransferStatus.running,
    )
    requested_count = Column(Integer, nullable=False, default=0)
    transferred_count = Column(Integer, nullable=False, default=0)
    conflict_count = Column(Integer, nullable=False, default=0)
    operator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    expected_batch_version = Column(Integer, nullable=False)
    idempotency_key = Column(String(128), nullable=False)
    created_at = Column(DateTime, nullable=False, default=func.now())
    completed_at = Column(DateTime, nullable=True)


class HandoverItem(Base):
    __tablename__ = "handover_items"
    __table_args__ = (
        UniqueConstraint(
            "handover_batch_id",
            "student_id",
            name="uq_handover_items_student",
        ),
        Index("ix_handover_items_batch_status", "handover_batch_id", "status"),
    )

    id = Column(Integer, primary_key=True, autoincrement=True)
    handover_batch_id = Column(
        Integer,
        ForeignKey("handover_batches.id"),
        nullable=False,
    )
    student_id = Column(Integer, ForeignKey("students.id", ondelete="CASCADE"), nullable=False)
    source_assignment_id = Column(
        Integer,
        ForeignKey("student_assignments.id"),
        nullable=False,
    )
    status = Column(
        _stored_enum(HandoverItemStatus, "handover_item_status"),
        nullable=False,
        default=HandoverItemStatus.pending,
    )
    target_agent_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    transfer_id = Column(Integer, ForeignKey("handover_transfers.id"), nullable=True)
    transferred_at = Column(DateTime, nullable=True)
    conflict_code = Column(String(64), nullable=False, default="")
    conflict_message = Column(String(256), nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=func.now())
    updated_at = Column(
        DateTime,
        nullable=False,
        default=func.now(),
        onupdate=func.now(),
    )


class LeadOutcomeReason(Base):
    __tablename__ = "lead_outcome_reasons"

    code = Column(String(64), primary_key=True)
    label = Column(String(64), nullable=False)
    terminal = Column(Boolean, nullable=False, default=False)
    reclaimable = Column(Boolean, nullable=False, default=True)
    active = Column(Boolean, nullable=False, default=True)
    sort_order = Column(Integer, nullable=False, default=0)
