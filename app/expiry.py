"""过期学生标记的共享逻辑。

被 admin 路由（手动「过期检查」）和 scheduler（每日自动）共用，
保证两条路径用同一套判定，避免行为分叉。
"""

from datetime import date, datetime

from sqlalchemy import func, select, union_all
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Call, Note, Student, StudentStatus


def build_last_activity_subquery():
    activity_events = union_all(
        select(Call.student_id.label("student_id"), Call.created_at.label("created_at")),
        select(Note.student_id.label("student_id"), Note.created_at.label("created_at")),
    ).subquery()
    return (
        select(
            activity_events.c.student_id,
            func.max(activity_events.c.created_at).label("last_activity_at"),
        )
        .group_by(activity_events.c.student_id)
        .subquery()
    )


async def mark_expired_students(db: AsyncSession) -> int:
    """把已到期且最后活动早于今日的非终态学生标记为 expired，返回标记数量。

    判定：expired_at < 今天 且 最后活动（通话/备注，退化到分配时间/创建时间）
    早于今天 00:00，且当前不在终态（已报名/已过期/拒绝/无效）。
    调用方负责 commit。
    """
    today = date.today()
    today_dt = datetime(today.year, today.month, today.day)

    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    )

    result = await db.execute(
        select(Student)
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(
            Student.expired_at.isnot(None),
            Student.expired_at < today,
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.invalid,
                ]
            ),
            latest_activity_at < today_dt,
        )
    )
    count = 0
    for student in result.scalars().all():
        student.status = StudentStatus.expired
        count += 1
    return count
