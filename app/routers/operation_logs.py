from datetime import UTC, date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import DialLog, OperationLog, Student, User
from app.permissions import get_accessible_student
from app.schemas import Response

router = APIRouter(prefix="/api/operation-logs", tags=["操作日志"])
_CST = timezone(timedelta(hours=8))


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


def _date_start_cst_as_utc(value: str) -> datetime:
    try:
        day = date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=422, detail="日期格式应为 YYYY-MM-DD")
    return datetime(day.year, day.month, day.day, tzinfo=_CST).astimezone(UTC).replace(tzinfo=None)


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
    """通电量查询：按北京时间日期+话务员筛选真实拨号记录。"""
    conditions = []

    if start_date:
        conditions.append(DialLog.dialed_at >= _date_start_cst_as_utc(start_date))
    if end_date:
        conditions.append(DialLog.dialed_at < _date_start_cst_as_utc(end_date) + timedelta(days=1))

    query = select(DialLog, User.name.label("agent_name"), Student.name.label("student_name")).join(
        User, User.id == DialLog.agent_id
    ).join(Student, Student.id == DialLog.student_id)
    if conditions:
        query = query.where(*conditions)

    if agent_ids:
        ids = _parse_agent_ids(agent_ids)
        if ids:
            query = query.where(DialLog.agent_id.in_(ids))

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    summary_query = select(
        func.count(DialLog.id).label("total_calls"),
        func.count(DialLog.id)
        .filter(DialLog.duration_seconds > 0)
        .label("recorded_calls"),
        func.coalesce(
            func.sum(
                case(
                    (DialLog.duration_seconds > 0, DialLog.duration_seconds),
                    else_=0,
                )
            ),
            0,
        ).label("total_recorded_duration_seconds"),
    ).join(User, User.id == DialLog.agent_id).join(Student, Student.id == DialLog.student_id)
    if conditions:
        summary_query = summary_query.where(*conditions)
    if agent_ids:
        ids = _parse_agent_ids(agent_ids)
        if ids:
            summary_query = summary_query.where(DialLog.agent_id.in_(ids))

    summary_row = (await db.execute(summary_query)).one()
    total_calls = int(summary_row.total_calls or 0)
    recorded_calls = int(summary_row.recorded_calls or 0)
    total_recorded_duration = int(summary_row.total_recorded_duration_seconds or 0)
    avg_recorded_duration = (
        round(total_recorded_duration / recorded_calls, 1) if recorded_calls else 0
    )

    query = (
        query.offset((page - 1) * page_size)
        .limit(page_size)
        .order_by(DialLog.dialed_at.desc(), DialLog.id.desc())
    )
    result = await db.execute(query)
    rows = result.all()

    data = []
    for i, (dial, agent_name, student_name) in enumerate(rows):
        data.append(
            {
                "seq": (page - 1) * page_size + i + 1,
                "id": dial.id,
                "agent_id": dial.agent_id,
                "agent_name": agent_name,
                "operator_name": agent_name,
                "student_id": dial.student_id,
                "student_name": student_name,
                "duration_seconds": dial.duration_seconds,
                "dialed_at": str(dial.dialed_at),
                "created_at": str(dial.dialed_at),
            }
        )

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "summary": {
                "total_calls": total_calls,
                "recorded_calls": recorded_calls,
                "unrecorded_calls": total_calls - recorded_calls,
                "total_recorded_duration_seconds": total_recorded_duration,
                "avg_recorded_duration_seconds": avg_recorded_duration,
            },
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
