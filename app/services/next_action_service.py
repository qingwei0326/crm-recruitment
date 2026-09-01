"""Derive one operator-facing next action for each student.

The admissions workflow already stores the source of truth in follow-ups,
visit tasks, enrollment records, and work items.  This service only projects
those records into a small, stable read model; it deliberately does not add a
second mutable ``Student.next_action`` field.
"""

from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain_models import WorkItem, WorkItemKind, WorkItemStatus
from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    EnrollmentRecord,
    FollowUp,
    HomeVisitStatus,
    HomeVisitTask,
    SettlementStatus,
    Student,
    StudentStatus,
    User,
)
from app.services.work_item_service import (
    campus_visit_is_open,
    enrollment_settlement_is_open,
    home_visit_is_open,
)
from app.status_policy import canonical_student_status
from app.task_stats import TERMINAL_STUDENT_STATUSES
from app.utils import utcnow

ACTIVE_WORK_ITEM_STATUSES = {
    WorkItemStatus.open,
    WorkItemStatus.blocked_suspension,
    WorkItemStatus.blocked_handover,
}
ACTIONABLE_WORK_ITEM_KINDS = {
    WorkItemKind.lead_contact,
    WorkItemKind.scheduled_follow_up,
    WorkItemKind.home_visit,
    WorkItemKind.campus_visit,
    WorkItemKind.enrollment_settlement,
    WorkItemKind.help_request,
}

KIND_ORDER = {
    "enrollment_settlement": 10,
    "help_request": 20,
    "scheduled_follow_up": 30,
    "home_visit": 40,
    "campus_visit": 50,
    "lead_contact": 60,
    "missing_next_action": 70,
    "assignment": 80,
}


@dataclass(frozen=True)
class NextActionCandidate:
    """Internal candidate used to select the primary action."""

    kind: str
    label: str
    owner_id: int | None
    due_at: datetime | None
    priority: str
    target_url: str
    source_id: int | None
    reason: str
    created_at: datetime | None = None


def _as_naive_datetime(value) -> datetime | None:
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value
    return value.astimezone(UTC).replace(tzinfo=None)


def _is_overdue(value, now: datetime) -> bool:
    due_at = _as_naive_datetime(value)
    return bool(due_at and due_at < now)


def _priority(value, *, urgent: bool = False) -> str:
    raw = getattr(value, "value", value)
    if urgent or raw in {"高", "high"}:
        return "high"
    if raw in {"低", "low"}:
        return "low"
    return "normal"


def _owner_id(item: WorkItem | None, *fallbacks: int | None) -> int | None:
    if item is not None and item.owner_agent_id is not None:
        return item.owner_agent_id
    return next((value for value in fallbacks if value is not None), None)


def _work_item_by_source(
    work_items: Iterable[WorkItem],
) -> dict[tuple[WorkItemKind, str, int], WorkItem]:
    return {
        (item.kind, item.source_type, item.source_id): item
        for item in work_items
    }


def _public_action(
    candidate: NextActionCandidate,
    owner_names: dict[int, str],
) -> dict:
    return {
        "kind": candidate.kind,
        "label": candidate.label,
        "owner_id": candidate.owner_id,
        "owner_name": owner_names.get(candidate.owner_id, "")
        if candidate.owner_id is not None
        else "",
        "due_at": str(candidate.due_at) if candidate.due_at else None,
        "priority": candidate.priority,
        "target_url": candidate.target_url,
        "source_id": candidate.source_id,
        "reason": candidate.reason,
    }


def _selection_score(candidate: NextActionCandidate, now: datetime) -> tuple:
    overdue = _is_overdue(candidate.due_at, now)
    if candidate.kind == "help_request":
        urgency = 0
    elif candidate.kind == "enrollment_settlement" and candidate.priority == "high":
        urgency = 1
    elif overdue:
        urgency = 2
    elif candidate.priority == "high":
        urgency = 3
    else:
        urgency = 4
    due_at = _as_naive_datetime(candidate.due_at) or datetime.max
    created_at = _as_naive_datetime(candidate.created_at) or datetime.max
    return (
        urgency,
        due_at,
        KIND_ORDER.get(candidate.kind, 999),
        created_at,
        candidate.source_id if candidate.source_id is not None else 0,
    )


def select_primary_next_action(
    candidates: Iterable[NextActionCandidate],
    *,
    now: datetime | None = None,
    owner_names: dict[int, str] | None = None,
) -> dict | None:
    """Return the most urgent candidate in the stable API shape."""

    candidate_list = list(candidates)
    if not candidate_list:
        return None
    selected = min(candidate_list, key=lambda item: _selection_score(item, now or utcnow()))
    return _public_action(selected, owner_names or {})


def _home_visit_candidate(
    task: HomeVisitTask,
    item: WorkItem | None,
    student: Student,
    now: datetime,
) -> NextActionCandidate:
    due_at = (
        item.due_at
        if item is not None and item.due_at is not None
        else task.next_follow_up_at or task.scheduled_at or task.requested_visit_time
    )
    overdue = _is_overdue(due_at, now)
    if task.status == HomeVisitStatus.pending:
        reason, label = "家访待确认", "处理家访"
    elif task.status == HomeVisitStatus.confirmed and not task.scheduled_at:
        reason, label = "家访待安排", "安排家访"
    elif task.status == HomeVisitStatus.completed:
        reason, label = "家访后待下一步", "继续推进"
    elif overdue:
        reason, label = "家访已超期", "处理超期家访"
    else:
        reason, label = "家访待处理", "处理家访"
    return NextActionCandidate(
        kind=WorkItemKind.home_visit.value,
        label=label,
        owner_id=_owner_id(
            item,
            student.assigned_to,
            task.assigned_admin_id,
            task.creator_agent_id,
        ),
        due_at=due_at,
        priority=_priority(item.priority if item is not None else None, urgent=overdue),
        target_url="/admin/home-visits",
        source_id=task.id,
        reason=reason,
        created_at=task.created_at,
    )


def _campus_visit_candidate(
    task: CampusVisitTask,
    item: WorkItem | None,
    student: Student,
    now: datetime,
) -> NextActionCandidate:
    due_at = (
        item.due_at
        if item is not None and item.due_at is not None
        else task.next_follow_up_at or task.appointment_at
    )
    overdue = _is_overdue(due_at, now)
    if task.status == CampusVisitStatus.pending:
        reason, label = "到校待预约", "预约到校"
    elif task.status in {CampusVisitStatus.arrived, CampusVisitStatus.no_show}:
        reason, label = "到校后待跟进", "继续跟进"
    elif overdue:
        reason, label = "到校已超期", "处理到校"
    else:
        reason, label = "到校待处理", "处理到校"
    return NextActionCandidate(
        kind=WorkItemKind.campus_visit.value,
        label=label,
        owner_id=_owner_id(
            item,
            student.assigned_to,
            task.reception_admin_id,
            task.creator_user_id,
        ),
        due_at=due_at,
        priority=_priority(item.priority if item is not None else None, urgent=overdue),
        target_url="/admin/campus-visits",
        source_id=task.id,
        reason=reason,
        created_at=task.created_at,
    )


async def build_next_action_map(
    db: AsyncSession,
    students: Sequence[Student],
    *,
    now: datetime | None = None,
) -> dict[int, dict | None]:
    """Build a primary next-action projection for a page of students.

    The function performs a fixed number of bulk queries regardless of page
    size, so adding the projection to the student list does not introduce an
    N+1 query pattern.
    """

    student_by_id = {
        student.id: student for student in students if student.id is not None
    }
    if not student_by_id:
        return {}

    student_ids = sorted(student_by_id)
    follow_ups = (
        await db.execute(
            select(FollowUp).where(FollowUp.student_id.in_(student_ids))
        )
    ).scalars().all()
    home_visits = (
        await db.execute(
            select(HomeVisitTask).where(HomeVisitTask.student_id.in_(student_ids))
        )
    ).scalars().all()
    campus_visits = (
        await db.execute(
            select(CampusVisitTask).where(
                CampusVisitTask.student_id.in_(student_ids)
            )
        )
    ).scalars().all()
    enrollment_records = (
        await db.execute(
            select(EnrollmentRecord).where(
                EnrollmentRecord.student_id.in_(student_ids)
            )
        )
    ).scalars().all()
    work_items = (
        await db.execute(
            select(WorkItem).where(
                WorkItem.student_id.in_(student_ids),
                WorkItem.kind.in_(tuple(ACTIONABLE_WORK_ITEM_KINDS)),
                WorkItem.status.in_(tuple(ACTIVE_WORK_ITEM_STATUSES)),
            )
        )
    ).scalars().all()

    work_item_map = _work_item_by_source(work_items)
    candidates_by_student: dict[int, list[NextActionCandidate]] = {
        student_id: [] for student_id in student_ids
    }
    now = _as_naive_datetime(now) or utcnow()

    for follow in follow_ups:
        if follow.is_completed:
            continue
        student = student_by_id.get(follow.student_id)
        if student is None or canonical_student_status(student.status) in TERMINAL_STUDENT_STATUSES:
            continue
        item = work_item_map.get(
            (WorkItemKind.scheduled_follow_up, "follow_up", follow.id)
        )
        due_at = item.due_at if item is not None and item.due_at else follow.follow_up_date
        overdue = _is_overdue(due_at, now)
        candidates_by_student[student.id].append(
            NextActionCandidate(
                kind=WorkItemKind.scheduled_follow_up.value,
                label="完成回访",
                owner_id=_owner_id(item, student.assigned_to, follow.agent_id),
                due_at=due_at,
                priority=_priority(
                    item.priority if item is not None else None,
                    urgent=overdue,
                ),
                target_url=f"/admin/leads/{student.id}",
                source_id=follow.id,
                reason="回访已超期" if overdue else "待回访",
                created_at=follow.created_at,
            )
        )

    for task in home_visits:
        student = student_by_id.get(task.student_id)
        if student is None or canonical_student_status(student.status) in TERMINAL_STUDENT_STATUSES:
            continue
        if not home_visit_is_open(task):
            continue
        item = work_item_map.get((WorkItemKind.home_visit, "home_visit", task.id))
        candidates_by_student[student.id].append(
            _home_visit_candidate(task, item, student, now)
        )

    for task in campus_visits:
        student = student_by_id.get(task.student_id)
        if student is None or canonical_student_status(student.status) in TERMINAL_STUDENT_STATUSES:
            continue
        if not campus_visit_is_open(task):
            continue
        item = work_item_map.get(
            (WorkItemKind.campus_visit, "campus_visit", task.id)
        )
        candidates_by_student[student.id].append(
            _campus_visit_candidate(task, item, student, now)
        )

    for record in enrollment_records:
        student = student_by_id.get(record.student_id)
        if student is None or not enrollment_settlement_is_open(record):
            continue
        item = work_item_map.get(
            (WorkItemKind.enrollment_settlement, "enrollment", record.id)
        )
        disputed = record.settlement_status == SettlementStatus.disputed
        candidates_by_student[student.id].append(
            NextActionCandidate(
                kind=WorkItemKind.enrollment_settlement.value,
                label="处理结算",
                owner_id=_owner_id(
                    item,
                    student.assigned_to,
                    record.current_assigned_agent_id,
                    record.last_effective_agent_id,
                    record.attributed_agent_id,
                ),
                due_at=(
                    item.due_at
                    if item is not None and item.due_at is not None
                    else record.enrolled_at
                ),
                priority=_priority(
                    item.priority if item is not None else None,
                    urgent=disputed,
                ),
                target_url="/admin/enrollment-settlement",
                source_id=record.id,
                reason=f"结算{record.settlement_status.value}",
                created_at=record.created_at,
            )
        )

    for student in student_by_id.values():
        if canonical_student_status(student.status) in TERMINAL_STUDENT_STATUSES:
            continue
        if student.need_help:
            item = work_item_map.get(
                (WorkItemKind.help_request, "help", student.id)
            )
            candidates_by_student[student.id].append(
                NextActionCandidate(
                    kind=WorkItemKind.help_request.value,
                    label="处理求助",
                    owner_id=_owner_id(item, student.assigned_to),
                    due_at=(
                        item.due_at
                        if item is not None and item.due_at is not None
                        else student.updated_at
                    ),
                    priority="high",
                    target_url=f"/admin/leads/{student.id}",
                    source_id=student.id,
                    reason="话务员请求主管介入",
                    created_at=student.updated_at,
                )
            )

        if (
            canonical_student_status(student.status) == StudentStatus.not_contacted
            and student.assigned_to is not None
        ):
            item = work_item_map.get(
                (WorkItemKind.lead_contact, "student", student.id)
            )
            candidates_by_student[student.id].append(
                NextActionCandidate(
                    kind=WorkItemKind.lead_contact.value,
                    label="开始首呼",
                    owner_id=student.assigned_to,
                    due_at=item.due_at if item is not None else None,
                    priority=_priority(item.priority if item is not None else None),
                    target_url=f"/admin/leads/{student.id}",
                    source_id=student.id,
                    reason="待首次联系",
                    created_at=student.assigned_at or student.created_at,
                )
            )

    owner_ids = {
        candidate.owner_id
        for candidates in candidates_by_student.values()
        for candidate in candidates
        if candidate.owner_id is not None
    }
    owner_names: dict[int, str] = {}
    if owner_ids:
        owners = await db.execute(select(User.id, User.name).where(User.id.in_(owner_ids)))
        owner_names = {user_id: name or "" for user_id, name in owners.all()}

    result: dict[int, dict | None] = {}
    for student_id, student in student_by_id.items():
        canonical_status = canonical_student_status(student.status)
        if canonical_status == StudentStatus.invalid:
            result[student_id] = None
            continue
        if student.assigned_to is None and canonical_status not in TERMINAL_STUDENT_STATUSES:
            result[student_id] = _public_action(
                NextActionCandidate(
                    kind="assignment",
                    label="先分配坐席",
                    owner_id=None,
                    due_at=None,
                    priority="high",
                    target_url="/admin/leads?assignment=unassigned",
                    source_id=student.id,
                    reason="学生尚未分配负责人",
                    created_at=student.created_at,
                ),
                owner_names,
            )
            continue
        selected = select_primary_next_action(
            candidates_by_student[student_id],
            now=now,
            owner_names=owner_names,
        )
        if selected is None and canonical_status not in TERMINAL_STUDENT_STATUSES:
            selected = _public_action(
                NextActionCandidate(
                    kind="missing_next_action",
                    label="补充下一步",
                    owner_id=student.assigned_to,
                    due_at=None,
                    priority="normal",
                    target_url=f"/admin/leads/{student.id}",
                    source_id=None,
                    reason="当前没有开放的回访、家访或到校任务",
                    created_at=student.updated_at,
                ),
                owner_names,
            )
        result[student_id] = selected
    return result
