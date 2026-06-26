"""Helpers for keeping FollowUp rows and Student.status in sync."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import FollowUp, Student, StudentStatus
from app.task_stats import is_terminal_status


async def sync_student_status_for_open_follow_up(db: AsyncSession, student: Student) -> None:
    """Move non-terminal students into 待回访 when an open follow-up exists."""
    if is_terminal_status(student.status):
        return
    student.status = StudentStatus.pending_visit


async def sync_student_status_after_follow_up_change(db: AsyncSession, student_id: int) -> None:
    """Update student status after a follow-up is completed/deleted/changed."""
    student = await db.get(Student, student_id)
    if student is None or is_terminal_status(student.status):
        return

    open_count = (
        await db.execute(
            select(func.count(FollowUp.id)).where(
                FollowUp.student_id == student_id,
                FollowUp.is_completed.is_(False),
            )
        )
    ).scalar() or 0

    student.status = StudentStatus.pending_visit if open_count else StudentStatus.contacted
