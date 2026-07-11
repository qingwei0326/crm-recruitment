from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import invalidate_user_tokens
from app.domain_errors import DomainConflict
from app.domain_models import (
    AgentEmployment,
    AgentEmploymentEvent,
    EmploymentStatus,
    WorkItem,
    WorkItemStatus,
)
from app.models import User
from app.utils import utcnow


async def set_employment_status(
    db: AsyncSession,
    user: User,
    status: EmploymentStatus,
    *,
    operator: User,
    reason: str,
    expected_version: int | None = None,
    handover_batch_id: int | None = None,
    at: datetime | None = None,
) -> AgentEmployment:
    now = at or utcnow()
    row = await db.execute(
        select(AgentEmployment)
        .where(AgentEmployment.user_id == user.id)
        .with_for_update()
    )
    employment = row.scalar_one()
    if expected_version is not None and employment.version != expected_version:
        raise DomainConflict("员工状态已变化，请刷新后重试")
    if employment.status == status:
        return employment

    allowed = {
        EmploymentStatus.active: {
            EmploymentStatus.suspended,
            EmploymentStatus.handover_pending,
        },
        EmploymentStatus.suspended: {
            EmploymentStatus.active,
            EmploymentStatus.handover_pending,
        },
        EmploymentStatus.handover_pending: {EmploymentStatus.offboarded},
        EmploymentStatus.offboarded: set(),
    }
    if status not in allowed[employment.status]:
        raise DomainConflict(
            f"不允许的员工状态变化: {employment.status} -> {status}"
        )

    previous = employment.status
    employment.status = status
    employment.version += 1
    employment.status_changed_at = now
    employment.updated_by = operator.id
    if status == EmploymentStatus.handover_pending:
        employment.offboarding_started_at = now
    if status == EmploymentStatus.offboarded:
        employment.offboarded_at = now

    if previous == EmploymentStatus.active and status != EmploymentStatus.active:
        user.is_active = False
        invalidate_user_tokens(user)
    elif status == EmploymentStatus.active:
        user.is_active = True

    if status == EmploymentStatus.suspended:
        await db.execute(
            update(WorkItem)
            .where(
                WorkItem.owner_agent_id == user.id,
                WorkItem.status == WorkItemStatus.open,
            )
            .values(status=WorkItemStatus.blocked_suspension, updated_at=now)
        )
    elif previous == EmploymentStatus.suspended and status == EmploymentStatus.active:
        await db.execute(
            update(WorkItem)
            .where(
                WorkItem.owner_agent_id == user.id,
                WorkItem.status == WorkItemStatus.blocked_suspension,
            )
            .values(status=WorkItemStatus.open, updated_at=now)
        )

    db.add(
        AgentEmploymentEvent(
            user_id=user.id,
            from_status=previous,
            to_status=status,
            reason=reason,
            operator_id=operator.id,
            handover_batch_id=handover_batch_id,
            created_at=now,
        )
    )
    await db.flush()
    return employment
