from datetime import timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import DialLog, User, UserRole
from app.utils import utcnow

RECENT_AGENT_DIAL_WINDOW_HOURS = 24
RECENT_AGENT_DIAL_REQUIRED_DETAIL = "请先通过系统拨号按钮拨打该学生，再继续记录联系结果"


async def require_recent_agent_dial(
    db: AsyncSession,
    student_id: int,
    current_user: User,
) -> None:
    """Require agents to have dialed this student through the system recently."""
    if current_user.role != UserRole.agent:
        return

    since = utcnow() - timedelta(hours=RECENT_AGENT_DIAL_WINDOW_HOURS)
    result = await db.execute(
        select(DialLog.id)
        .where(
            DialLog.student_id == student_id,
            DialLog.agent_id == current_user.id,
            DialLog.dialed_at >= since,
        )
        .limit(1)
    )
    if result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=403,
            detail=RECENT_AGENT_DIAL_REQUIRED_DETAIL,
        )
