from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_admin
from app.database import get_db
from app.domain_errors import DomainError
from app.models import User
from app.schemas import Response
from app.services.team_progress_service import GROUP_BY_AGENT, team_progress

router = APIRouter(prefix="/api/admin", tags=["管理"])


@router.get("/team-progress")
async def team_progress_board(
    group_by: str = Query(GROUP_BY_AGENT),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按话务员或片区看还剩多少要做：待拨打、未接待重打、A/B 意向、待处理报备、报名。"""
    try:
        data = await team_progress(db, group_by)
    except DomainError as exc:
        raise HTTPException(status_code=exc.http_status, detail=exc.message) from exc
    return Response.ok(data)
