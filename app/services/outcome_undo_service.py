"""Let an agent take back the first outcome they just marked on a lead.

Agents may not reset a lead to 未联系 through the normal edit (that would let them
recycle leads), but a mis-tap on the very first mark should not need an admin. The
undo is deliberately narrow: only the agent's own latest status change, only while it
is fresh, only when it moved the lead out of 未联系, and only if nothing else has
touched the status since. Any other wrong mark is fixed by marking again.
"""

from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain_errors import DomainError
from app.domain_models import WorkItemKind
from app.models import FollowUp, OperationLog, Student, StudentStatus, User
from app.services.work_item_service import cancel_source_work_item, sync_student_work_items
from app.status_policy import canonical_status_value, canonical_student_status
from app.utils import make_operation_log, utcnow

UNDO_WINDOW_MINUTES = 30
UNDO_LOG_ACTION = "撤销标记"
STATUS_CHANGE_LOG_ACTION = "修改状态"


class OutcomeUndoNotAllowed(DomainError):  # noqa: N818 - stable domain API name
    code = "outcome_undo_not_allowed"
    http_status = 409


def is_undoable_first_outcome(old_status, new_status) -> bool:
    """True when a status change moved a lead out of 未联系 (the only undoable mark)."""
    old = canonical_student_status(old_status)
    new = canonical_student_status(new_status)
    return old == StudentStatus.not_contacted and new not in (None, StudentStatus.not_contacted)


async def _latest_status_change(db: AsyncSession, student_id: int) -> OperationLog | None:
    result = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.target_student_id == student_id,
            OperationLog.action == STATUS_CHANGE_LOG_ACTION,
        )
        .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()


async def _follow_ups_since(
    db: AsyncSession, student_id: int, operator: User, since
) -> list[FollowUp]:
    """Open reminders the operator set after the mark (e.g. the redial after 未接)."""
    result = await db.execute(
        select(FollowUp).where(
            FollowUp.student_id == student_id,
            FollowUp.agent_id == operator.id,
            FollowUp.is_completed.is_(False),
            FollowUp.created_at >= since,
        )
    )
    return list(result.scalars().all())


async def undo_first_outcome(
    db: AsyncSession,
    student: Student,
    operator: User,
) -> Student:
    """Put a lead back in 待拨打 if its first mark was made by ``operator`` just now."""
    log = await _latest_status_change(db, student.id)
    if log is None or log.operator_id != operator.id:
        raise OutcomeUndoNotAllowed("没有可以撤销的标记")

    now = utcnow()
    if log.created_at is None or now - log.created_at > timedelta(minutes=UNDO_WINDOW_MINUTES):
        raise OutcomeUndoNotAllowed(f"只能撤销 {UNDO_WINDOW_MINUTES} 分钟内的标记")

    if not is_undoable_first_outcome(log.old_status, log.new_status):
        raise OutcomeUndoNotAllowed("只能撤销第一次标记，其他结果请直接重新标记")

    # Setting a reminder right after the mark moves the lead to 待回访 by itself, so that
    # is not "someone else changed it" as long as the reminder is the operator's own.
    # Server-side timestamps have whole-second precision, so allow a second of slack.
    reminders = await _follow_ups_since(
        db, student.id, operator, log.created_at - timedelta(seconds=1)
    )
    current = canonical_student_status(student.status)
    status_untouched = current == canonical_student_status(log.new_status) or (
        current == StudentStatus.pending_visit and bool(reminders)
    )
    if not status_untouched:
        raise OutcomeUndoNotAllowed("这个学生的状态之后又变过，不能撤销")

    for reminder in reminders:
        await cancel_source_work_item(
            db, WorkItemKind.scheduled_follow_up, "follow_up", reminder.id, at=now
        )
        await db.delete(reminder)
    await db.flush()

    student.status = StudentStatus.not_contacted
    student.status_detail = ""
    student.outcome_reason_code = None
    db.add(
        make_operation_log(
            operator,
            student.id,
            student.case_no or "",
            UNDO_LOG_ACTION,
            content=(
                f"撤销标记：状态 {canonical_status_value(current)} → "
                f"{canonical_status_value(StudentStatus.not_contacted)}"
            ),
            old_status=canonical_status_value(current) or "",
            new_status=canonical_status_value(StudentStatus.not_contacted) or "",
        )
    )
    await sync_student_work_items(db, student, operator, at=now)
    await db.commit()
    await db.refresh(student)
    return student
