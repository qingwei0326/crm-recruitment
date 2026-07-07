from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.assignment_batch_review import REVIEW_WINDOW_DAYS, build_assignment_batch_review
from app.auth import ADMIN_PAGE_AUDIT_LOGS, require_page_permission
from app.database import get_db
from app.models import User
from app.schemas import Response

router = APIRouter(prefix="/api/admin", tags=["管理"])


@router.get("/assignment-batches/{batch_id}/review")
async def assignment_batch_review(
    batch_id: str,
    window_days: int = Query(default=7),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_AUDIT_LOGS)),
):
    batch_id = (batch_id or "").strip()
    if not batch_id:
        return Response.error(code=1, msg="batch_id不能为空")
    if window_days not in REVIEW_WINDOW_DAYS:
        raise HTTPException(status_code=422, detail="window_days 只支持 1、3、7、14")

    review = await build_assignment_batch_review(db, batch_id, window_days=window_days)
    if review is None:
        return Response.error(code=1, msg="未找到该分配批次")
    return Response.ok(review)
