from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_STUDENT_PHONE,
    ADMIN_PAGE_LEADS_MANAGE,
    get_current_user,
    require_page_permission,
    user_has_operation_permission,
)
from app.database import get_db
from app.dial_recording import DIAL_RECORDING_COMPLETED, DIAL_RECORDING_PENDING
from app.models import DialLog, User
from app.permissions import get_accessible_student, get_student_or_404, is_admin
from app.schemas import Response
from app.utils import make_operation_log, utcnow

router = APIRouter(prefix="/api/students", tags=["学生"])


def _require_admin_operation(current_user: User, permission: str) -> None:
    if is_admin(current_user) and not user_has_operation_permission(current_user, permission):
        raise HTTPException(status_code=403, detail="无权执行该操作")


DIAL_PENDING_REUSE_SECONDS = 2 * 60


@router.get("/phone/{student_id}")
async def get_student_phone(
    student_id: int,
    dial_log_id: int | None = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)
    _require_admin_operation(current_user, ADMIN_OP_STUDENT_PHONE)

    # 新客户端传回精确会话 ID；旧客户端在两分钟内复用 pending 会话。
    if dial_log_id is not None:
        reusable_r = await db.execute(
            select(DialLog).where(
                DialLog.id == dial_log_id,
                DialLog.student_id == student.id,
                DialLog.agent_id == current_user.id,
                DialLog.recording_state == DIAL_RECORDING_PENDING,
            )
        )
        reusable = reusable_r.scalar_one_or_none()
        if reusable is None:
            raise HTTPException(status_code=400, detail="拨号会话无效或已完成")
    else:
        reuse_since = utcnow() - timedelta(seconds=DIAL_PENDING_REUSE_SECONDS)
        reusable_r = await db.execute(
            select(DialLog)
            .where(
                DialLog.student_id == student.id,
                DialLog.agent_id == current_user.id,
                DialLog.recording_state == DIAL_RECORDING_PENDING,
                DialLog.dialed_at >= reuse_since,
            )
            .order_by(DialLog.dialed_at.desc(), DialLog.id.desc())
            .limit(1)
        )
        reusable = reusable_r.scalar_one_or_none()

    if reusable is not None:
        return Response.ok(
            {
                "guardian_phone": student.guardian_phone,
                "guardian2_phone": student.guardian2_phone,
                "dial_log_id": reusable.id,
            }
        )

    # 写 DialLog 并记录操作日志
    dial_log = DialLog(
        student_id=student.id,
        agent_id=current_user.id,
        recording_state=DIAL_RECORDING_PENDING,
    )
    db.add(dial_log)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "查看电话",
            content="查看明文电话号码",
        )
    )
    await db.flush()
    dial_log_id = dial_log.id
    await db.commit()
    return Response.ok(
        {
            "guardian_phone": student.guardian_phone,
            "guardian2_phone": student.guardian2_phone,
            "dial_log_id": dial_log_id,
        }
    )


@router.put("/dial-duration")
async def update_dial_duration(
    student_id: int = Query(...),
    duration_seconds: int = Query(..., ge=0, le=24 * 60 * 60),
    dial_log_id: int | None = Query(None, ge=1),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_accessible_student(db, student_id, current_user)

    if dial_log_id is not None:
        query = select(DialLog).where(
            DialLog.id == dial_log_id,
            DialLog.student_id == student_id,
            DialLog.agent_id == current_user.id,
        )
    else:
        query = (
            select(DialLog)
            .where(DialLog.student_id == student_id, DialLog.agent_id == current_user.id)
            .order_by(DialLog.dialed_at.desc(), DialLog.id.desc())
            .limit(1)
        )
    result = await db.execute(query)
    dial_log = result.scalar_one_or_none()
    if dial_log is None:
        return Response.error(code=1, msg="未找到本次拨号记录")

    dial_log.duration_seconds = duration_seconds
    dial_log.recording_state = DIAL_RECORDING_COMPLETED
    await db.commit()
    return Response.ok(
        {
            "id": dial_log.id,
            "student_id": dial_log.student_id,
            "duration_seconds": dial_log.duration_seconds,
            "recording_state": dial_log.recording_state,
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
