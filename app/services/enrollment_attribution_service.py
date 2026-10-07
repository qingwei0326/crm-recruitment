"""Rules for manually attributing an enrollment to an agent (no FastAPI dependencies)."""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain_errors import DomainError
from app.models import User, UserRole


class InvalidAttributionAgentError(DomainError):
    code = "invalid_attribution_agent"
    http_status = 422


async def require_attribution_agent(db: AsyncSession, agent_id: int) -> None:
    """Manual attribution must name an existing agent (offboarded ones are fine: history)."""
    role = (await db.execute(select(User.role).where(User.id == agent_id))).scalar_one_or_none()
    if role != UserRole.agent:
        raise InvalidAttributionAgentError("归属必须是已存在的话务员")
