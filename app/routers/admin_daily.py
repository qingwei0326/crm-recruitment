import re

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_daily_ops import (
    DAILY_OPS_REVIEW_STATUSES,
    _build_daily_ops_payload,
    _daily_ops_batch_id,
    _today_cst_date_key,
)
from app.auth import ADMIN_OP_GOVERNANCE_REVIEW, require_admin, require_operation_permission
from app.database import get_db
from app.models import User
from app.schemas import Response
from app.utils import make_operation_log

router = APIRouter(prefix="/api/admin", tags=["管理"])


class DailyOpsReviewReq(BaseModel):
    key: str
    status: str = "已处理"
    note: str = ""
    count: int = 0


@router.get("/daily-ops")
async def daily_ops_center(
    date_key: str | None = Query(None, alias="date"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    date_key = (date_key or _today_cst_date_key()).strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_key):
        raise HTTPException(status_code=422, detail="date 必须是 YYYY-MM-DD")
    return Response.ok(await _build_daily_ops_payload(db, date_key))


@router.post("/daily-ops/reviews")
async def acknowledge_daily_ops_item(
    body: DailyOpsReviewReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_GOVERNANCE_REVIEW)),
):
    key = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", body.key.strip())[:40]
    if not key:
        return Response.error(code=1, msg="缺少待办项")
    status = (body.status or "已处理").strip()
    if status not in DAILY_OPS_REVIEW_STATUSES:
        return Response.error(
            code=1,
            msg="状态必须是处理中、已处理、已忽略、暂缓、明日继续跟进、无需处理之一",
        )
    date_key = _today_cst_date_key()
    count = max(int(body.count or 0), 0)
    note = (body.note or "").strip()
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="每日运营闭环",
            content=f"{date_key} {key} 标记为{status}",
            old_status=str(count),
            new_status=status,
            note_content=note,
            batch_id=_daily_ops_batch_id(date_key, key),
        )
    )
    await db.commit()
    return Response.ok({"reviewed": True, "key": key, "status": status, "date": date_key})
