from typing import Any

from sqlalchemy import and_, case, exists, func, not_, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    HandoverBatch,
    HandoverBatchStatus,
    HandoverItem,
    HandoverItemStatus,
    HandoverTransfer,
    HandoverTransferStatus,
    LeadOutcomeReason,
    StudentAssignment,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import (
    CampusVisitResult,
    CampusVisitStatus,
    CampusVisitTask,
    EnrollmentRecord,
    FollowUp,
    HomeVisitResult,
    HomeVisitStatus,
    HomeVisitTask,
    SettlementStatus,
    Student,
    StudentStatus,
    User,
)
from app.status_policy import statuses_for_canonical

_TERMINAL_STATUSES = statuses_for_canonical(
    StudentStatus.enrolled,
    StudentStatus.invalid,
)
_INVALID_STATUSES = statuses_for_canonical(StudentStatus.invalid)
_ACTIVE_WORK_STATUSES = (
    WorkItemStatus.open,
    WorkItemStatus.blocked_suspension,
    WorkItemStatus.blocked_handover,
)


async def _count(db: AsyncSession, statement: Any) -> int:
    return int((await db.execute(statement)).scalar_one() or 0)


def _valid_work_status(employment: Any, item: Any):
    return or_(
        and_(
            employment.status == EmploymentStatus.active,
            item.status == WorkItemStatus.open,
        ),
        and_(
            employment.status == EmploymentStatus.suspended,
            item.status == WorkItemStatus.blocked_suspension,
        ),
        and_(
            employment.status == EmploymentStatus.handover_pending,
            item.status == WorkItemStatus.blocked_handover,
        ),
    )


async def _phase_one_counts(db: AsyncSession) -> dict[str, int]:
    employment = aliased(AgentEmployment)
    users_without_employment = await _count(
        db,
        select(func.count(User.id))
        .outerjoin(employment, employment.user_id == User.id)
        .where(employment.user_id.is_(None)),
    )

    duplicate_assignments = (
        select(StudentAssignment.student_id)
        .where(StudentAssignment.ended_at.is_(None))
        .group_by(StudentAssignment.student_id)
        .having(func.count(StudentAssignment.id) > 1)
        .subquery()
    )
    duplicate_active_assignments = await _count(
        db,
        select(func.count()).select_from(duplicate_assignments),
    )

    active_assignment = aliased(StudentAssignment)
    active_assignment_projection_mismatches = await _count(
        db,
        select(func.count(func.distinct(Student.id)))
        .outerjoin(
            active_assignment,
            and_(
                active_assignment.student_id == Student.id,
                active_assignment.ended_at.is_(None),
            ),
        )
        .where(
            or_(
                and_(
                    Student.assigned_to.is_(None),
                    active_assignment.id.is_not(None),
                ),
                and_(
                    Student.assigned_to.is_not(None),
                    or_(
                        active_assignment.id.is_(None),
                        active_assignment.agent_id != Student.assigned_to,
                    ),
                ),
            )
        ),
    )

    open_items_without_owner = await _count(
        db,
        select(func.count(WorkItem.id)).where(
            WorkItem.status == WorkItemStatus.open,
            WorkItem.owner_agent_id.is_(None),
        ),
    )
    owner_employment = aliased(AgentEmployment)
    open_items_owned_by_inactive = await _count(
        db,
        select(func.count(WorkItem.id))
        .outerjoin(
            owner_employment,
            owner_employment.user_id == WorkItem.owner_agent_id,
        )
        .where(
            WorkItem.status == WorkItemStatus.open,
            WorkItem.owner_agent_id.is_not(None),
            or_(
                owner_employment.user_id.is_(None),
                owner_employment.status != EmploymentStatus.active,
            ),
        ),
    )

    duplicate_work_keys = (
        select(WorkItem.kind, WorkItem.source_type, WorkItem.source_id)
        .group_by(WorkItem.kind, WorkItem.source_type, WorkItem.source_id)
        .having(func.count(WorkItem.id) > 1)
        .subquery()
    )
    duplicate_source_work_items = await _count(
        db,
        select(func.count()).select_from(duplicate_work_keys),
    )

    outcome = aliased(LeadOutcomeReason)
    invalid_reasons_without_catalog_entry = await _count(
        db,
        select(func.count(Student.id))
        .outerjoin(outcome, outcome.code == Student.outcome_reason_code)
        .where(
            Student.status.in_(_INVALID_STATUSES),
            or_(
                Student.outcome_reason_code.is_(None),
                outcome.code.is_(None),
            ),
        ),
    )

    foreign_key_violations = 0
    if db.get_bind().dialect.name == "sqlite":
        foreign_key_violations = len(
            (await db.execute(text("pragma foreign_key_check"))).all()
        )
    return {
        "users_without_employment": users_without_employment,
        "duplicate_active_assignments": duplicate_active_assignments,
        "active_assignment_projection_mismatches": (
            active_assignment_projection_mismatches
        ),
        "open_items_without_owner": open_items_without_owner,
        "open_items_owned_by_inactive": open_items_owned_by_inactive,
        "duplicate_source_work_items": duplicate_source_work_items,
        "invalid_reasons_without_catalog_entry": (
            invalid_reasons_without_catalog_entry
        ),
        "foreign_key_violations": foreign_key_violations,
    }


async def _employment_projection_mismatches(db: AsyncSession) -> int:
    return await _count(
        db,
        select(func.count(AgentEmployment.user_id))
        .join(User, User.id == AgentEmployment.user_id)
        .where(
            or_(
                and_(
                    AgentEmployment.status == EmploymentStatus.active,
                    User.is_active.is_(False),
                ),
                and_(
                    AgentEmployment.status != EmploymentStatus.active,
                    User.is_active.is_(True),
                ),
            )
        ),
    )


async def _lead_projection_mismatches(db: AsyncSession) -> int:
    item = aliased(WorkItem)
    employment = aliased(AgentEmployment)
    expected = and_(
        Student.assigned_to.is_not(None),
        Student.status.not_in(_TERMINAL_STATUSES),
    )
    not_expected = or_(
        Student.assigned_to.is_(None),
        Student.status.in_(_TERMINAL_STATUSES),
    )
    return await _count(
        db,
        select(func.count(func.distinct(Student.id)))
        .outerjoin(
            item,
            and_(
                item.kind == WorkItemKind.lead_contact,
                item.source_type == "student",
                item.source_id == Student.id,
            ),
        )
        .outerjoin(employment, employment.user_id == Student.assigned_to)
        .where(
            or_(
                and_(
                    expected,
                    or_(
                        item.id.is_(None),
                        item.student_id != Student.id,
                        item.owner_agent_id != Student.assigned_to,
                        employment.user_id.is_(None),
                        not_(_valid_work_status(employment, item)),
                    ),
                ),
                and_(
                    not_expected,
                    item.id.is_not(None),
                    item.status.in_(_ACTIVE_WORK_STATUSES),
                ),
            )
        ),
    )


async def _source_projection_count(
    db: AsyncSession,
    *,
    source_model: Any,
    source_student_id: Any,
    source_owner_id: Any,
    source_open: Any,
    kind: WorkItemKind,
    source_type: str,
) -> int:
    source_open = and_(
        source_open,
        Student.status.not_in(_TERMINAL_STATUSES),
    )
    item = aliased(WorkItem)
    employment = aliased(AgentEmployment)
    owner_id = func.coalesce(
        Student.assigned_to,
        item.owner_agent_id,
        source_owner_id,
    )
    source_mismatches = await _count(
        db,
        select(func.count(func.distinct(source_model.id)))
        .join(Student, Student.id == source_student_id)
        .outerjoin(
            item,
            and_(
                item.kind == kind,
                item.source_type == source_type,
                item.source_id == source_model.id,
            ),
        )
        .outerjoin(employment, employment.user_id == owner_id)
        .where(
            or_(
                and_(
                    source_open,
                    or_(
                        owner_id.is_(None),
                        item.id.is_(None),
                        item.student_id != source_student_id,
                        item.owner_agent_id != owner_id,
                        employment.user_id.is_(None),
                        not_(_valid_work_status(employment, item)),
                    ),
                ),
                and_(
                    not_(source_open),
                    item.id.is_not(None),
                    item.status.in_(_ACTIVE_WORK_STATUSES),
                ),
            )
        ),
    )
    orphan_item = aliased(WorkItem)
    orphan_active_items = await _count(
        db,
        select(func.count(orphan_item.id)).where(
            orphan_item.kind == kind,
            orphan_item.source_type == source_type,
            orphan_item.status.in_(_ACTIVE_WORK_STATUSES),
            not_(
                exists(
                    select(source_model.id).where(
                        source_model.id == orphan_item.source_id
                    )
                )
            ),
        ),
    )
    return source_mismatches + orphan_active_items


async def _help_projection_mismatches(db: AsyncSession) -> int:
    item = aliased(WorkItem)
    employment = aliased(AgentEmployment)
    expected = and_(
        Student.need_help.is_(True),
        Student.status.not_in(_TERMINAL_STATUSES),
        Student.assigned_to.is_not(None),
    )
    return await _count(
        db,
        select(func.count(func.distinct(Student.id)))
        .outerjoin(
            item,
            and_(
                item.kind == WorkItemKind.help_request,
                item.source_type == "help",
                item.source_id == Student.id,
            ),
        )
        .outerjoin(employment, employment.user_id == Student.assigned_to)
        .where(
            or_(
                and_(
                    expected,
                    or_(
                        item.id.is_(None),
                        item.student_id != Student.id,
                        item.owner_agent_id != Student.assigned_to,
                        employment.user_id.is_(None),
                        not_(_valid_work_status(employment, item)),
                    ),
                ),
                and_(
                    not_(expected),
                    item.id.is_not(None),
                    item.status.in_(_ACTIVE_WORK_STATUSES),
                ),
            )
        ),
    )


async def _source_projection_mismatches(db: AsyncSession) -> int:
    home_open = or_(
        HomeVisitTask.status.in_(
            {
                HomeVisitStatus.pending,
                HomeVisitStatus.confirmed,
                HomeVisitStatus.scheduled,
                HomeVisitStatus.postponed,
            }
        ),
        and_(
            HomeVisitTask.status == HomeVisitStatus.completed,
            HomeVisitTask.result.in_(
                {
                    HomeVisitResult.considering,
                    HomeVisitResult.waiting_score,
                    HomeVisitResult.campus_visit,
                }
            ),
            or_(
                HomeVisitTask.next_follow_up_at.is_not(None),
                func.length(func.trim(HomeVisitTask.next_action)) > 0,
                HomeVisitTask.result == HomeVisitResult.campus_visit,
            ),
        ),
    )
    campus_open = or_(
        CampusVisitTask.status.in_(
            {
                CampusVisitStatus.pending,
                CampusVisitStatus.scheduled,
                CampusVisitStatus.rescheduled,
            }
        ),
        and_(
            CampusVisitTask.status.in_(
                {CampusVisitStatus.arrived, CampusVisitStatus.no_show}
            ),
            or_(
                CampusVisitTask.next_follow_up_at.is_not(None),
                func.length(func.trim(CampusVisitTask.next_action)) > 0,
                CampusVisitTask.result.in_(
                    {
                        CampusVisitResult.arrived,
                        CampusVisitResult.no_show,
                        CampusVisitResult.rescheduled,
                        CampusVisitResult.considering,
                    }
                ),
            ),
        ),
    )
    counts = [
        await _source_projection_count(
            db,
            source_model=FollowUp,
            source_student_id=FollowUp.student_id,
            source_owner_id=FollowUp.agent_id,
            source_open=FollowUp.is_completed.is_(False),
            kind=WorkItemKind.scheduled_follow_up,
            source_type="follow_up",
        ),
        await _source_projection_count(
            db,
            source_model=HomeVisitTask,
            source_student_id=HomeVisitTask.student_id,
            source_owner_id=HomeVisitTask.creator_agent_id,
            source_open=home_open,
            kind=WorkItemKind.home_visit,
            source_type="home_visit",
        ),
        await _source_projection_count(
            db,
            source_model=CampusVisitTask,
            source_student_id=CampusVisitTask.student_id,
            source_owner_id=CampusVisitTask.creator_user_id,
            source_open=campus_open,
            kind=WorkItemKind.campus_visit,
            source_type="campus_visit",
        ),
        await _source_projection_count(
            db,
            source_model=EnrollmentRecord,
            source_student_id=EnrollmentRecord.student_id,
            source_owner_id=EnrollmentRecord.attributed_agent_id,
            source_open=EnrollmentRecord.settlement_status.in_(
                {
                    SettlementStatus.unsettled,
                    SettlementStatus.postponed,
                    SettlementStatus.disputed,
                }
            ),
            kind=WorkItemKind.enrollment_settlement,
            source_type="enrollment",
        ),
        await _help_projection_mismatches(db),
    ]
    return sum(counts)


async def _handover_count_mismatches(db: AsyncSession) -> int:
    item_counts = (
        select(
            HandoverBatch.id.label("batch_id"),
            HandoverBatch.status.label("batch_status"),
            HandoverBatch.total_items,
            HandoverBatch.remaining_items,
            HandoverBatch.transferred_items,
            func.count(HandoverItem.id).label("actual_total"),
            func.coalesce(
                func.sum(
                    case((HandoverItem.status == HandoverItemStatus.pending, 1), else_=0)
                ),
                0,
            ).label("actual_remaining"),
            func.coalesce(
                func.sum(
                    case(
                        (HandoverItem.status == HandoverItemStatus.transferred, 1),
                        else_=0,
                    )
                ),
                0,
            ).label("actual_transferred"),
        )
        .outerjoin(
            HandoverItem,
            HandoverItem.handover_batch_id == HandoverBatch.id,
        )
        .group_by(
            HandoverBatch.id,
            HandoverBatch.status,
            HandoverBatch.total_items,
            HandoverBatch.remaining_items,
            HandoverBatch.transferred_items,
        )
        .subquery()
    )
    batch_mismatches = await _count(
        db,
        select(func.count()).select_from(item_counts).where(
            or_(
                item_counts.c.total_items != item_counts.c.actual_total,
                item_counts.c.remaining_items != item_counts.c.actual_remaining,
                item_counts.c.transferred_items != item_counts.c.actual_transferred,
                and_(
                    item_counts.c.batch_status == HandoverBatchStatus.completed,
                    item_counts.c.actual_remaining != 0,
                ),
                and_(
                    item_counts.c.batch_status.in_(
                        {HandoverBatchStatus.pending, HandoverBatchStatus.in_progress}
                    ),
                    item_counts.c.actual_remaining == 0,
                ),
            )
        ),
    )

    transfer_counts = (
        select(
            HandoverTransfer.id.label("transfer_id"),
            HandoverTransfer.status,
            HandoverTransfer.requested_count,
            HandoverTransfer.transferred_count,
            HandoverTransfer.conflict_count,
            func.count(HandoverItem.id).label("actual_transferred"),
        )
        .outerjoin(HandoverItem, HandoverItem.transfer_id == HandoverTransfer.id)
        .group_by(
            HandoverTransfer.id,
            HandoverTransfer.status,
            HandoverTransfer.requested_count,
            HandoverTransfer.transferred_count,
            HandoverTransfer.conflict_count,
        )
        .subquery()
    )
    transfer_mismatches = await _count(
        db,
        select(func.count()).select_from(transfer_counts).where(
            or_(
                transfer_counts.c.requested_count
                != transfer_counts.c.transferred_count
                + transfer_counts.c.conflict_count,
                transfer_counts.c.transferred_count
                != transfer_counts.c.actual_transferred,
                and_(
                    transfer_counts.c.status == HandoverTransferStatus.completed,
                    transfer_counts.c.transferred_count == 0,
                ),
            )
        ),
    )
    return batch_mismatches + transfer_mismatches


def _expected_outcome_code():
    detail = func.trim(func.coalesce(Student.status_detail, ""))
    return case(
        (detail.in_({"空号", "phone_invalid"}), "phone_invalid"),
        (detail.in_({"高分段", "high_score"}), "high_score"),
        (
            detail.in_({"无意向", "not_interested", "no_intent"}),
            "no_intent",
        ),
        (
            detail.in_(
                {
                    "孩子不想读",
                    "child_not_want_study",
                    "child_not_interested",
                }
            ),
            "child_declined",
        ),
        (
            detail.in_({"报好了", "已报名其他学校", "enrolled_elsewhere"}),
            "enrolled_elsewhere",
        ),
        (detail.in_({"历史未注明", "legacy_unspecified"}), "legacy_unspecified"),
        (detail.in_({"其他", "other"}), "other"),
        (detail != "", "other"),
        (Student.status == StudentStatus.high_score, "high_score"),
        (
            Student.status.in_({StudentStatus.not_interested, StudentStatus.no_intent}),
            "no_intent",
        ),
        (
            Student.status.in_(
                {
                    StudentStatus.child_not_want_study,
                    StudentStatus.child_not_interested,
                }
            ),
            "child_declined",
        ),
        else_="legacy_unspecified",
    )


async def _outcome_projection_mismatches(db: AsyncSession) -> int:
    expected_code = _expected_outcome_code()
    return await _count(
        db,
        select(func.count(Student.id)).where(
            or_(
                and_(
                    Student.status.in_(_INVALID_STATUSES),
                    or_(
                        Student.outcome_reason_code.is_(None),
                        Student.outcome_reason_code != expected_code,
                    ),
                ),
                and_(
                    Student.status.not_in(_INVALID_STATUSES),
                    Student.outcome_reason_code.is_not(None),
                ),
            )
        ),
    )


async def audit_domain_consistency(
    db: AsyncSession,
) -> dict[str, int | bool]:
    report = await _phase_one_counts(db)
    report.update(
        {
            "employment_projection_mismatches": (
                await _employment_projection_mismatches(db)
            ),
            "lead_work_item_projection_mismatches": (
                await _lead_projection_mismatches(db)
            ),
            "source_work_item_projection_mismatches": (
                await _source_projection_mismatches(db)
            ),
            "handover_count_mismatches": await _handover_count_mismatches(db),
            "outcome_projection_mismatches": (
                await _outcome_projection_mismatches(db)
            ),
        }
    )
    return {"ok": all(value == 0 for value in report.values()), **report}
