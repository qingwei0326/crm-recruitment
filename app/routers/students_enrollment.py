from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_ENROLLMENT_SETTLEMENT,
    ADMIN_PAGE_ENROLLMENT_SETTLEMENT,
    ADMIN_PAGE_LEADS_MANAGE,
    get_current_user,
    require_admin,
    user_has_page_permission,
)
from app.database import get_db
from app.models import (
    EnrollmentRecord,
    EnrollmentSubStage,
    Student,
    StudentStage,
    StudentStatus,
    User,
)
from app.permissions import (
    get_accessible_student,
    get_student_or_404,
    is_admin,
    require_admin_operation,
)
from app.schemas import EnrollInfo, EnrollmentCreate, Response, StageUpdate
from app.services.work_item_service import sync_student_work_items
from app.stage_policy import normalize_stage, validate_stage_transition
from app.status_policy import canonical_status_value, canonical_student_status
from app.utils import make_operation_log

router = APIRouter(prefix="/api/students", tags=["学生"])


def _require_admin_leads_manage(current_user: User) -> None:
    if is_admin(current_user) and not user_has_page_permission(
        current_user, ADMIN_PAGE_LEADS_MANAGE
    ):
        raise HTTPException(status_code=403, detail="无权访问该管理模块")


def _enum_or_error(enum_cls, value: str, label: str):
    try:
        return enum_cls(value)
    except ValueError:
        raise ValueError(f"无效的{label}: {value}")


def _display_stage(stage: StudentStage) -> str:
    if stage == StudentStage.visit_scheduled:
        return StudentStage.campus_visit_scheduled.value
    if stage == StudentStage.visited:
        return StudentStage.campus_visit_arrived.value
    return stage.value


def _is_enrolled_student(student: Student) -> bool:
    return (
        canonical_student_status(student.status) == StudentStatus.enrolled
        or student.stage == StudentStage.enrolled
    )


class EnrollmentSubStageBody(BaseModel):
    enrollment_substage: str | None = None


@router.put("/{student_id}/enrollment-substage")
async def update_enrollment_substage(
    student_id: int,
    body: EnrollmentSubStageBody,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="无权修改报名后状态")
    if not user_has_page_permission(current_user, ADMIN_PAGE_ENROLLMENT_SETTLEMENT):
        raise HTTPException(status_code=403, detail="无权访问该管理模块")
    student = await get_student_or_404(db, student_id)

    old_value = str(student.enrollment_substage) if student.enrollment_substage else ""
    if body.enrollment_substage is None or body.enrollment_substage == "":
        student.enrollment_substage = None
        new_value = ""
    else:
        try:
            student.enrollment_substage = EnrollmentSubStage(body.enrollment_substage)
        except ValueError:
            valid = [e.value for e in EnrollmentSubStage]
            raise HTTPException(
                status_code=400,
                detail=f"无效的报名后状态，合法值：{valid}",
            )
        new_value = body.enrollment_substage

    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "修改报名后状态",
            content=f"{old_value} → {new_value}",
            old_status=old_value,
            new_status=new_value,
        )
    )
    await sync_student_work_items(db, student, current_user)
    await db.commit()
    await db.refresh(student)
    return Response.ok(
        {
            "enrollment_substage": str(student.enrollment_substage)
            if student.enrollment_substage
            else None,
        }
    )


@router.put("/{student_id}/stage")
async def update_stage(
    student_id: int,
    body: StageUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_leads_manage(current_user)
    student = await get_accessible_student(db, student_id, current_user)
    old_stage = student.stage
    old_status = student.status

    try:
        requested_stage = normalize_stage(body.stage)
        if not is_admin(current_user) and requested_stage == StudentStage.initial_contact:
            return Response.error(
                code=1,
                msg="话务员不能重置为新线索，请联系管理员回收并重新分配",
            )
        new_stage = await validate_stage_transition(
            db,
            student,
            requested_stage,
        )
    except ValueError as e:
        return Response.error(msg=str(e))
    if _is_enrolled_student(student) and new_stage != StudentStage.enrolled:
        return Response.error(code=1, msg="已报名学生不能通过普通编辑改回非报名状态")
    student.stage = new_stage

    stage_changed = old_stage != student.stage
    status_changed = old_status != student.status
    if stage_changed or status_changed:
        parts = []
        if stage_changed:
            parts.append(f"阶段 {old_stage} → {student.stage}")
        if status_changed:
            parts.append(
                f"状态 {canonical_status_value(old_status)} → "
                f"{canonical_status_value(student.status)}"
            )
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "修改状态" if status_changed else "修改信息",
                content="; ".join(parts),
                old_status=canonical_status_value(old_status) if status_changed else "",
                new_status=canonical_status_value(student.status) if status_changed else "",
            )
        )

    await sync_student_work_items(db, student, current_user)
    await db.commit()
    await db.refresh(student)
    return Response.ok(
        {"stage": _display_stage(student.stage), "status": canonical_status_value(student.status)}
    )


@router.put("/{student_id}/enroll")
async def set_enroll_info(
    student_id: int,
    body: EnrollInfo,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="无权设置报名信息")
    if not user_has_page_permission(current_user, ADMIN_PAGE_ENROLLMENT_SETTLEMENT):
        raise HTTPException(status_code=403, detail="无权访问该管理模块")
    require_admin_operation(current_user, ADMIN_OP_ENROLLMENT_SETTLEMENT)
    student = await get_student_or_404(db, student_id)
    existing = (
        await db.execute(
            select(EnrollmentRecord)
            .where(EnrollmentRecord.student_id == student.id)
            .order_by(EnrollmentRecord.created_at.asc(), EnrollmentRecord.id.asc())
        )
    ).scalars().first()
    enrolled_at = datetime.combine(body.enrolled_at or date.today(), time.min)

    # Keep the legacy admin form, but route it through the formal enrollment
    # record flow so it cannot create an enrolled student without settlement data.
    from app.routers.admissions import (
        _create_enrollment_record,
        _sync_enrollment_work_item,
    )

    record = await _create_enrollment_record(
        db,
        EnrollmentCreate(
            student_id=student.id,
            source="管理员补录",
            enrolled_program=body.program,
            enrolled_at=enrolled_at,
            amount=body.deposit,
        ),
        student,
        current_user,
        allow_existing=True,
    )
    if existing is not None:
        record.enrolled_at = enrolled_at
        record.enrolled_program = body.program
        record.amount = body.deposit
        student.enrolled_at = body.enrolled_at or date.today()
        student.program = body.program
        student.deposit = body.deposit
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "修改报名登记",
                content=f"报名记录 #{record.id}：更新报名日期、专业和定金",
            )
        )
        await _sync_enrollment_work_item(db, record, student, current_user)

    await db.commit()
    await db.refresh(student)
    return Response.ok(
        {
            "record_id": record.id,
            "enrolled_at": str(student.enrolled_at),
            "program": student.program,
            "deposit": student.deposit,
            "enrollment_substage": str(student.enrollment_substage)
            if student.enrollment_substage
            else None,
        }
    )


@router.put("/{student_id}/extend")
async def extend_expiry(
    student_id: int,
    days: int = Query(15, ge=1, le=90),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """过期逻辑已暂时停用，保留接口以兼容旧前端/脚本调用。"""
    return Response.ok({"expired_at": None, "disabled": True})
