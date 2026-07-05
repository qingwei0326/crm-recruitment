from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_STUDENT_PHONE,
    ADMIN_PAGE_LEADS_MANAGE,
    get_current_user,
    require_page_permission,
    user_has_operation_permission,
)
from app.database import get_db
from app.models import DialLog, SystemConfig, User
from app.permissions import get_accessible_student, get_student_or_404, is_admin
from app.schemas import Response
from app.utils import make_operation_log, utcnow

router = APIRouter(prefix="/api/students", tags=["学生"])


def _require_admin_operation(current_user: User, permission: str) -> None:
    if is_admin(current_user) and not user_has_operation_permission(current_user, permission):
        raise HTTPException(status_code=403, detail="无权执行该操作")


_CST = timezone(timedelta(hours=8))
DIAL_LOG_DEDUP_SECONDS = 3


async def _get_system_config(db: AsyncSession, key: str, default: str = "") -> str:
    result = await db.execute(select(SystemConfig.value).where(SystemConfig.key == key))
    value = result.scalar_one_or_none()
    return (value or "").strip() or default


def _parse_hhmm(value: str) -> tuple[int, int]:
    try:
        hh, mm = value.split(":")
        return int(hh), int(mm)
    except (ValueError, AttributeError):
        return 0, 0


def _minutes_since_midnight(value: str) -> int:
    hh, mm = _parse_hhmm(value)
    return max(0, min(23, hh)) * 60 + max(0, min(59, mm))


def _is_within_dial_window(current_minutes: int, window_start: str, window_end: str) -> bool:
    start_minutes = _minutes_since_midnight(window_start)
    end_minutes = _minutes_since_midnight(window_end)
    if start_minutes <= end_minutes:
        return start_minutes <= current_minutes <= end_minutes
    return current_minutes >= start_minutes or current_minutes <= end_minutes


@router.get("/phone/{student_id}")
async def get_student_phone(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)
    _require_admin_operation(current_user, ADMIN_OP_STUDENT_PHONE)

    # 1. 拨号窗口校验
    window_start = await _get_system_config(db, "dial_window_start", "08:00")
    window_end = await _get_system_config(db, "dial_window_end", "21:00")
    max_per_24h_str = await _get_system_config(db, "dial_max_per_24h", "3")
    try:
        max_per_24h = int(max_per_24h_str)
    except ValueError:
        max_per_24h = 3

    now_cst = datetime.now(_CST)
    cur_minutes = now_cst.hour * 60 + now_cst.minute
    if not _is_within_dial_window(cur_minutes, window_start, window_end):
        raise HTTPException(
            status_code=403,
            detail=f"当前为禁拨时段（拨号窗口 {window_start}-{window_end}）",
        )

    # 2. 短时间重复点击同一个拨号按钮时复用本次取号，不重复写 DialLog。
    duplicate_since = utcnow() - timedelta(seconds=DIAL_LOG_DEDUP_SECONDS)
    duplicate_r = await db.execute(
        select(DialLog)
        .where(
            DialLog.student_id == student.id,
            DialLog.agent_id == current_user.id,
            DialLog.dialed_at >= duplicate_since,
        )
        .order_by(DialLog.dialed_at.desc(), DialLog.id.desc())
        .limit(1)
    )
    recent_duplicate = duplicate_r.scalar_one_or_none()
    if recent_duplicate is not None:
        return Response.ok(
            {
                "guardian_phone": student.guardian_phone,
                "guardian2_phone": student.guardian2_phone,
            }
        )

    # 3. 24h 防撞号校验（全局，任何坐席）
    since = utcnow() - timedelta(hours=24)
    count_r = await db.execute(
        select(func.count(DialLog.id)).where(
            DialLog.student_id == student.id,
            DialLog.dialed_at >= since,
        )
    )
    count_24h = count_r.scalar() or 0
    if count_24h >= max_per_24h:
        raise HTTPException(
            status_code=403,
            detail=f"该学生 24h 内已被拨打 {count_24h} 次，达到上限 {max_per_24h}",
        )

    # 4. 通过校验，写 DialLog 并记录操作日志
    db.add(DialLog(student_id=student.id, agent_id=current_user.id))
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "查看电话",
            content="查看明文电话号码",
        )
    )
    await db.commit()
    return Response.ok(
        {
            "guardian_phone": student.guardian_phone,
            "guardian2_phone": student.guardian2_phone,
        }
    )


@router.put("/dial-duration")
async def update_dial_duration(
    student_id: int = Query(...),
    duration_seconds: int = Query(..., ge=0, le=24 * 60 * 60),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_accessible_student(db, student_id, current_user)

    result = await db.execute(
        select(DialLog)
        .where(DialLog.student_id == student_id, DialLog.agent_id == current_user.id)
        .order_by(DialLog.dialed_at.desc(), DialLog.id.desc())
        .limit(1)
    )
    dial_log = result.scalar_one_or_none()
    if dial_log is None:
        return Response.error(code=1, msg="未找到本次拨号记录")

    dial_log.duration_seconds = duration_seconds
    await db.commit()
    return Response.ok(
        {
            "id": dial_log.id,
            "student_id": dial_log.student_id,
            "duration_seconds": dial_log.duration_seconds,
        }
    )


@router.get("/{student_id}/phone-plain")
async def reveal_student_phone_plain(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEADS_MANAGE)),
):
    _require_admin_operation(current_user, ADMIN_OP_STUDENT_PHONE)
    student = await get_student_or_404(db, student_id)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "查看明文电话",
            content="管理员查看明文电话号码",
        )
    )
    await db.commit()
    return Response.ok(
        {
            "guardian_phone": student.guardian_phone,
            "guardian2_phone": student.guardian2_phone,
        }
    )
