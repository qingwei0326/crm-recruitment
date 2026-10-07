from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.db_utils import rowcount_in_chunks, scalars_in_chunks
from app.domain_errors import DomainConflict
from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import (
    CampusVisitResult,
    CampusVisitStatus,
    CampusVisitTask,
    EnrollmentRecord,
    HomeVisitResult,
    HomeVisitStatus,
    HomeVisitTask,
    SettlementStatus,
    Student,
    StudentStatus,
    User,
)
from app.status_policy import canonical_student_status
from app.utils import utcnow

_HOME_VISIT_OPEN_STATUSES = {
    HomeVisitStatus.pending,
    HomeVisitStatus.confirmed,
    HomeVisitStatus.scheduled,
    HomeVisitStatus.postponed,
}
_HOME_VISIT_FOLLOW_ON_RESULTS = {
    HomeVisitResult.considering,
    HomeVisitResult.waiting_score,
    HomeVisitResult.campus_visit,
}
_CAMPUS_VISIT_OPEN_STATUSES = {
    CampusVisitStatus.pending,
    CampusVisitStatus.scheduled,
    CampusVisitStatus.rescheduled,
}
_CAMPUS_VISIT_FOLLOW_ON_STATUSES = {
    CampusVisitStatus.arrived,
    CampusVisitStatus.no_show,
}
_CAMPUS_VISIT_FOLLOW_ON_RESULTS = {
    CampusVisitResult.arrived,
    CampusVisitResult.no_show,
    CampusVisitResult.rescheduled,
    CampusVisitResult.considering,
}
_OPEN_SETTLEMENT_STATUSES = {
    SettlementStatus.unsettled,
    SettlementStatus.postponed,
    SettlementStatus.disputed,
}
_ACTIVE_WORK_STATUSES = {
    WorkItemStatus.open,
    WorkItemStatus.blocked_suspension,
    WorkItemStatus.blocked_handover,
}


def home_visit_is_open(task: HomeVisitTask) -> bool:
    if task.status in _HOME_VISIT_OPEN_STATUSES:
        return True
    if (
        task.status != HomeVisitStatus.completed
        or task.result not in _HOME_VISIT_FOLLOW_ON_RESULTS
    ):
        return False
    return bool(
        task.next_follow_up_at
        or task.next_action
        or task.result == HomeVisitResult.campus_visit
    )


def campus_visit_is_open(task: CampusVisitTask) -> bool:
    if task.status in _CAMPUS_VISIT_OPEN_STATUSES:
        return True
    if task.status not in _CAMPUS_VISIT_FOLLOW_ON_STATUSES:
        return False
    return bool(
        task.next_follow_up_at
        or task.next_action
        or task.result in _CAMPUS_VISIT_FOLLOW_ON_RESULTS
    )


def enrollment_settlement_is_open(record: EnrollmentRecord) -> bool:
    return record.settlement_status in _OPEN_SETTLEMENT_STATUSES


async def _work_status_for_owner(
    db: AsyncSession,
    owner_agent_id: int | None,
) -> WorkItemStatus:
    if owner_agent_id is None:
        raise DomainConflict("学生无当前负责人，无法创建开放工作项")
    statuses = await _work_statuses_for_owners(db, [owner_agent_id])
    return statuses[owner_agent_id]


async def _work_statuses_for_owners(
    db: AsyncSession,
    owner_agent_ids: Sequence[int],
) -> dict[int, WorkItemStatus]:
    unique_owner_ids = sorted(set(owner_agent_ids))
    if not unique_owner_ids:
        return {}
    rows = await db.execute(
        select(AgentEmployment).where(
            AgentEmployment.user_id.in_(unique_owner_ids)
        )
    )
    employment_by_user = {
        employment.user_id: employment for employment in rows.scalars().all()
    }
    missing = sorted(set(unique_owner_ids) - set(employment_by_user))
    if missing:
        raise DomainConflict(f"工作项负责人缺少员工状态: {missing}")

    status_by_employment = {
        EmploymentStatus.active: WorkItemStatus.open,
        EmploymentStatus.suspended: WorkItemStatus.blocked_suspension,
        EmploymentStatus.handover_pending: WorkItemStatus.blocked_handover,
    }
    statuses: dict[int, WorkItemStatus] = {}
    for owner_agent_id in unique_owner_ids:
        status = status_by_employment.get(
            employment_by_user[owner_agent_id].status
        )
        if status is None:
            raise DomainConflict(f"已离职员工不可负责工作项: {owner_agent_id}")
        statuses[owner_agent_id] = status
    return statuses


def _priority_for(
    kind: WorkItemKind,
    due_at: datetime | None,
    now: datetime,
) -> str:
    if kind == WorkItemKind.help_request or (due_at is not None and due_at < now):
        return "high"
    return "medium"


def _help_due_at(
    item: WorkItem | None,
    should_open: bool,
    now: datetime,
) -> datetime:
    if item is None:
        return now
    if should_open and item.status in {
        WorkItemStatus.completed,
        WorkItemStatus.cancelled,
    }:
        return now
    return item.due_at or now


async def _source_item(
    db: AsyncSession,
    kind: WorkItemKind,
    source_type: str,
    source_id: int,
) -> WorkItem | None:
    row = await db.execute(
        select(WorkItem).where(
            WorkItem.kind == kind,
            WorkItem.source_type == source_type,
            WorkItem.source_id == source_id,
        )
    )
    return row.scalar_one_or_none()


def _apply_source_item(
    item: WorkItem | None,
    *,
    kind: WorkItemKind,
    source_type: str,
    source_id: int,
    student: Student,
    owner_agent_id: int | None,
    creator_user_id: int | None,
    due_at: datetime | None,
    completed: bool,
    status: WorkItemStatus,
    actor: User,
    now: datetime,
) -> WorkItem:
    if item is None:
        item = WorkItem(
            student_id=student.id,
            kind=kind,
            status=status,
            owner_agent_id=owner_agent_id,
            creator_user_id=(
                creator_user_id if creator_user_id is not None else actor.id
            ),
            priority=_priority_for(kind, due_at, now),
            due_at=due_at,
            completed_at=now if completed else None,
            source_type=source_type,
            source_id=source_id,
            version=1,
            created_at=now,
            updated_at=now,
        )
        return item

    completed_at = None
    if completed:
        completed_at = (
            item.completed_at
            if item.status == WorkItemStatus.completed
            and item.completed_at is not None
            else now
        )
    next_values = {
        "student_id": student.id,
        "status": status,
        "owner_agent_id": owner_agent_id,
        "priority": _priority_for(kind, due_at, now),
        "due_at": due_at,
        "completed_at": completed_at,
        "handover_batch_id": None if not completed else item.handover_batch_id,
    }
    changed = any(
        getattr(item, field) != value for field, value in next_values.items()
    )
    for field, value in next_values.items():
        setattr(item, field, value)
    if changed:
        item.version += 1
        item.updated_at = now
    return item


async def sync_source_work_item(
    db: AsyncSession,
    kind: WorkItemKind,
    source_type: str,
    source_id: int,
    student: Student,
    creator_user_id: int | None,
    due_at: datetime | None,
    completed: bool,
    actor: User,
    *,
    at: datetime | None = None,
) -> WorkItem:
    now = at or utcnow()
    item = await _source_item(db, kind, source_type, source_id)
    owner_agent_id = student.assigned_to
    if owner_agent_id is None:
        owner_agent_id = (
            item.owner_agent_id if item is not None else creator_user_id
        )
    if completed:
        status = WorkItemStatus.completed
    else:
        status = await _work_status_for_owner(db, owner_agent_id)

    item = _apply_source_item(
        item,
        kind=kind,
        source_type=source_type,
        source_id=source_id,
        student=student,
        owner_agent_id=owner_agent_id,
        creator_user_id=creator_user_id,
        due_at=due_at,
        completed=completed,
        status=status,
        actor=actor,
        now=now,
    )
    if item.id is None:
        db.add(item)

    await db.flush()
    return item


def _cancel_item(item: WorkItem, at: datetime) -> WorkItem:
    changed = (
        item.status != WorkItemStatus.cancelled
        or item.owner_agent_id is not None
        or item.completed_at is not None
    )
    item.status = WorkItemStatus.cancelled
    item.owner_agent_id = None
    item.completed_at = None
    item.handover_batch_id = None
    if changed:
        item.version += 1
        item.updated_at = at
    return item


async def cancel_source_work_item(
    db: AsyncSession,
    kind: WorkItemKind,
    source_type: str,
    source_id: int,
    *,
    at: datetime | None = None,
) -> WorkItem | None:
    item = await _source_item(db, kind, source_type, source_id)
    if item is None:
        return None
    _cancel_item(item, at or utcnow())
    await db.flush()
    return item


async def sync_student_work_items(
    db: AsyncSession,
    student: Student,
    actor: User,
    at: datetime | None = None,
) -> tuple[WorkItem, ...]:
    return await sync_students_work_items(db, [student], actor, at=at)


async def sync_students_work_items(
    db: AsyncSession,
    students: Sequence[Student],
    actor: User,
    *,
    at: datetime | None = None,
) -> tuple[WorkItem, ...]:
    now = at or utcnow()
    students_by_id: dict[int, Student] = {}
    for student in students:
        if student.id is None:
            raise DomainConflict("学生尚未保存，无法同步工作项")
        students_by_id[student.id] = student
    if not students_by_id:
        return ()

    student_ids = sorted(students_by_id)
    existing_rows = await scalars_in_chunks(
        db,
        lambda ids: select(WorkItem).where(
            WorkItem.source_id.in_(ids),
            or_(
                and_(
                    WorkItem.kind == WorkItemKind.lead_contact,
                    WorkItem.source_type == "student",
                ),
                and_(
                    WorkItem.kind == WorkItemKind.help_request,
                    WorkItem.source_type == "help",
                ),
            ),
        ),
        student_ids,
    )
    existing_by_key = {
        (item.kind, item.source_type, item.source_id): item for item in existing_rows
    }

    terminal_by_student: dict[int, bool] = {}
    open_owner_ids: set[int] = set()
    for student_id, student in students_by_id.items():
        canonical_status = canonical_student_status(student.status)
        terminal = canonical_status in {
            StudentStatus.enrolled,
            StudentStatus.invalid,
        }
        terminal_by_student[student_id] = terminal
        if student.assigned_to is not None and not terminal:
            open_owner_ids.add(student.assigned_to)

    work_status_by_owner = await _work_statuses_for_owners(
        db,
        sorted(open_owner_ids),
    )
    items: list[WorkItem] = []

    for student_id in student_ids:
        student = students_by_id[student_id]
        terminal = terminal_by_student[student_id]
        lead = existing_by_key.get(
            (WorkItemKind.lead_contact, "student", student_id)
        )
        if lead is not None or (student.assigned_to is not None and not terminal):
            if student.assigned_to is None and not terminal:
                if lead is not None:
                    items.append(_cancel_item(lead, now))
            else:
                owner_agent_id = (
                    student.assigned_to
                    if student.assigned_to is not None
                    else lead.owner_agent_id
                )
                status = (
                    WorkItemStatus.completed
                    if terminal
                    else work_status_by_owner[owner_agent_id]
                )
                lead = _apply_source_item(
                    lead,
                    kind=WorkItemKind.lead_contact,
                    source_type="student",
                    source_id=student_id,
                    student=student,
                    owner_agent_id=owner_agent_id,
                    creator_user_id=student.assigned_to,
                    due_at=None,
                    completed=terminal,
                    status=status,
                    actor=actor,
                    now=now,
                )
                if lead.id is None:
                    db.add(lead)
                items.append(lead)

        help_item = existing_by_key.get(
            (WorkItemKind.help_request, "help", student_id)
        )
        should_open_help = bool(student.need_help) and not terminal
        if help_item is not None or (
            should_open_help and student.assigned_to is not None
        ):
            if should_open_help and student.assigned_to is None:
                if help_item is not None:
                    items.append(_cancel_item(help_item, now))
                continue

            owner_agent_id = student.assigned_to
            if owner_agent_id is None and help_item is not None:
                owner_agent_id = help_item.owner_agent_id
            status = (
                work_status_by_owner[owner_agent_id]
                if should_open_help
                else WorkItemStatus.completed
            )
            help_item = _apply_source_item(
                help_item,
                kind=WorkItemKind.help_request,
                source_type="help",
                source_id=student_id,
                student=student,
                owner_agent_id=owner_agent_id,
                creator_user_id=student.assigned_to,
                due_at=_help_due_at(help_item, should_open_help, now),
                completed=not should_open_help,
                status=status,
                actor=actor,
                now=now,
            )
            if help_item.id is None:
                db.add(help_item)
            items.append(help_item)

    await db.flush()
    return tuple(items)


async def sync_assignment_source_work_items(
    db: AsyncSession,
    students: Sequence[Student],
    *,
    at: datetime | None = None,
) -> tuple[WorkItem, ...]:
    """Move active source-backed work items with an ordinary assignment change."""
    now = at or utcnow()
    students_by_id: dict[int, Student] = {}
    for student in students:
        if student.id is None:
            raise DomainConflict("学生尚未保存，无法同步工作项")
        students_by_id[student.id] = student
    if not students_by_id:
        return ()

    items = await scalars_in_chunks(
        db,
        lambda ids: select(WorkItem).where(
            WorkItem.student_id.in_(ids),
            WorkItem.status.in_(_ACTIVE_WORK_STATUSES),
            ~or_(
                and_(
                    WorkItem.kind == WorkItemKind.lead_contact,
                    WorkItem.source_type == "student",
                ),
                and_(
                    WorkItem.kind == WorkItemKind.help_request,
                    WorkItem.source_type == "help",
                ),
            ),
        ),
        sorted(students_by_id),
    )
    desired_owners: dict[int, int] = {}
    for item in items:
        student = students_by_id[item.student_id]
        owner_agent_id = (
            student.assigned_to
            or item.owner_agent_id
            or item.creator_user_id
        )
        if owner_agent_id is None:
            raise DomainConflict(f"工作项 {item.id} 无可用负责人")
        desired_owners[item.id] = owner_agent_id

    work_status_by_owner = await _work_statuses_for_owners(
        db,
        sorted(set(desired_owners.values())),
    )
    changed_items: list[WorkItem] = []
    for item in items:
        owner_agent_id = desired_owners[item.id]
        status = work_status_by_owner[owner_agent_id]
        changed = (
            item.owner_agent_id != owner_agent_id
            or item.status != status
            or item.handover_batch_id is not None
        )
        if not changed:
            continue
        item.owner_agent_id = owner_agent_id
        item.status = status
        item.handover_batch_id = None
        item.version += 1
        item.updated_at = now
        changed_items.append(item)

    await db.flush()
    return tuple(changed_items)


async def transfer_open_work_items(
    db: AsyncSession,
    student_ids: Sequence[int],
    target_agent_id: int | None,
    from_status: WorkItemStatus,
    to_status: WorkItemStatus,
    handover_batch_id: int | None = None,
    *,
    at: datetime | None = None,
) -> int:
    unique_student_ids = sorted(set(student_ids))
    if not unique_student_ids:
        return 0
    if to_status == WorkItemStatus.open:
        status = await _work_status_for_owner(db, target_agent_id)
        if status != WorkItemStatus.open:
            raise DomainConflict("目标员工不可接收开放工作项")
    if target_agent_id is None and to_status == WorkItemStatus.open:
        raise DomainConflict("开放工作项必须有负责人")

    now = at or utcnow()
    moved = await rowcount_in_chunks(
        db,
        lambda ids: update(WorkItem)
        .where(WorkItem.student_id.in_(ids), WorkItem.status == from_status)
        .values(
            owner_agent_id=target_agent_id,
            status=to_status,
            handover_batch_id=handover_batch_id,
            version=WorkItem.version + 1,
            updated_at=now,
        ),
        unique_student_ids,
    )
    await db.flush()
    return moved
