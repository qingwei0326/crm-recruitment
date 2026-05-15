from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import OperationLog, User
from app.permissions import get_accessible_student
from app.schemas import Response

router = APIRouter(prefix="/api/operation-logs", tags=["操作日志"])


def _parse_iso_date(value: str | None, default: date, label: str) -> date:
    if not value:
        return default
    try:
        return date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail=f"{label} 日期格式应为 YYYY-MM-DD")


def _parse_agent_ids(value: str) -> list[int]:
    ids = []
    for part in value.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ids.append(int(part))
        except ValueError:
            raise HTTPException(status_code=422, detail="agent_ids 必须是逗号分隔的数字")
    return ids


@router.get("/call-volume")
async def call_volume_query(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
    start_date: str = Query(default=None),
    end_date: str = Query(default=None),
    agent_ids: str = Query(default=""),  # comma-separated
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    """通电量查询：按日期+话务员筛选操作日志"""
    today = date.today()
    s_date = _parse_iso_date(start_date, today, "start_date")
    e_date = _parse_iso_date(end_date, today, "end_date")
    if s_date > e_date:
        raise HTTPException(status_code=422, detail="start_date 不能晚于 end_date")
    day_start = datetime(s_date.year, s_date.month, s_date.day)
    day_end = datetime(e_date.year, e_date.month, e_date.day) + timedelta(days=1)

    query = select(OperationLog).where(
        OperationLog.created_at >= day_start,
        OperationLog.created_at < day_end,
        OperationLog.action.in_(["修改状态", "写备注", "修改信息", "登录"]),
    )

    if agent_ids:
        ids = _parse_agent_ids(agent_ids)
        if ids:
            query = query.where(OperationLog.operator_id.in_(ids))

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    query = (
        query.offset((page - 1) * page_size)
        .limit(page_size)
        .order_by(OperationLog.created_at.desc())
    )
    result = await db.execute(query)
    logs = result.scalars().all()

    data = []
    for i, log in enumerate(logs):
        data.append(
            {
                "seq": (page - 1) * page_size + i + 1,
                "operator_name": log.operator_name,
                "action": log.action,
                "case_no": log.case_no,
                "content": log.content,
                "old_status": log.old_status,
                "new_status": log.new_status,
                "note_content": log.note_content,
                "created_at": str(log.created_at),
            }
        )

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "list": data,
        }
    )


@router.get("/recent")
async def recent_logs(
    student_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """某学生的最近操作记录"""
    await get_accessible_student(db, student_id, current_user)
    result = await db.execute(
        select(OperationLog)
        .where(OperationLog.target_student_id == student_id)
        .order_by(OperationLog.created_at.desc())
        .limit(30)
    )
    logs = result.scalars().all()
    return Response.ok(
        [
            {
                "id": log.id,
                "operator_name": log.operator_name,
                "action": log.action,
                "content": log.content,
                "old_status": log.old_status,
                "new_status": log.new_status,
                "note_content": log.note_content,
                "created_at": str(log.created_at),
            }
            for log in logs
        ]
    )
