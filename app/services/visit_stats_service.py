"""Home/campus visit counts shared by the dashboard funnel, the funnel report and the
agent ranking.

A visit lives only in ``home_visit_tasks`` / ``campus_visit_tasks``; Alembic 20261016_01
folded the old ``visits`` table into them.
"""

from collections.abc import Sequence

from sqlalchemy import case, func, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import CampusVisitStatus, CampusVisitTask, HomeVisitStatus, HomeVisitTask

CAMPUS_ARRIVED_STATUSES = (CampusVisitStatus.arrived, CampusVisitStatus.enrolled)


async def count_visited_students(db: AsyncSession) -> int:
    """学生「已到访」：家访已完成，或已到校（含现场报名）；同一学生只算一次。"""
    visited = union(
        select(HomeVisitTask.student_id).where(HomeVisitTask.status == HomeVisitStatus.completed),
        select(CampusVisitTask.student_id).where(
            CampusVisitTask.status.in_(CAMPUS_ARRIVED_STATUSES)
        ),
    ).subquery()
    return (await db.execute(select(func.count()).select_from(visited))).scalar() or 0


async def visit_counts_by_creator(
    db: AsyncSession, user_ids: Sequence[int]
) -> dict[int, dict[str, int]]:
    """Per user: visits they requested (家访申请 / 到校预约) and how many happened."""
    if not user_ids:
        return {}
    counts: dict[int, dict[str, int]] = {}

    def bucket(user_id: int) -> dict[str, int]:
        return counts.setdefault(
            int(user_id),
            {"total_visits": 0, "visits_done": 0, "campus_visits": 0, "home_visits": 0},
        )

    home_rows = await db.execute(
        select(
            HomeVisitTask.creator_agent_id,
            func.count(HomeVisitTask.id),
            func.sum(case((HomeVisitTask.status == HomeVisitStatus.completed, 1), else_=0)),
        )
        .where(HomeVisitTask.creator_agent_id.in_(user_ids))
        .group_by(HomeVisitTask.creator_agent_id)
    )
    for user_id, total, done in home_rows.all():
        row = bucket(user_id)
        row["home_visits"] = int(total)
        row["total_visits"] += int(total)
        row["visits_done"] += int(done or 0)

    campus_rows = await db.execute(
        select(
            CampusVisitTask.creator_user_id,
            func.count(CampusVisitTask.id),
            func.sum(
                case((CampusVisitTask.status.in_(CAMPUS_ARRIVED_STATUSES), 1), else_=0)
            ),
        )
        .where(CampusVisitTask.creator_user_id.in_(user_ids))
        .group_by(CampusVisitTask.creator_user_id)
    )
    for user_id, total, done in campus_rows.all():
        row = bucket(user_id)
        row["campus_visits"] = int(total)
        row["total_visits"] += int(total)
        row["visits_done"] += int(done or 0)
    return counts
