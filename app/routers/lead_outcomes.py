from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.domain_models import LeadOutcomeReason
from app.models import User
from app.schemas import Response

router = APIRouter(prefix="/api/lead-outcome-reasons", tags=["线索结果"])


@router.get("")
async def list_lead_outcome_reasons(
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(LeadOutcomeReason)
        .where(LeadOutcomeReason.active.is_(True))
        .order_by(LeadOutcomeReason.sort_order, LeadOutcomeReason.code)
    )
    return Response.ok(
        [
            {
                "code": outcome.code,
                "label": outcome.label,
                "terminal": outcome.terminal,
                "reclaimable": outcome.reclaimable,
            }
            for outcome in result.scalars().all()
        ]
    )
