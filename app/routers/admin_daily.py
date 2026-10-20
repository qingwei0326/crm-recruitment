from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_daily_ops import _build_daily_ops_payload
from app.auth import require_admin
from app.database import get_db
from app.models import User
from app.schemas import Response

router = APIRouter(prefix="/api/admin", tags=["管理"])


@router.get("/daily-ops")
async def daily_ops_center(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return Response.ok(await _build_daily_ops_payload(db))
