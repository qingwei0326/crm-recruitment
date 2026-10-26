from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_ENROLLMENT_CREATE,
    ADMIN_PAGE_ENROLLMENT_SETTLEMENT,
    get_current_user,
)
from app.database import get_db
from app.models import EnrollmentReportStatus, EnrollmentSource, User
from app.permissions import get_accessible_student, is_admin, require_admin_operation
from app.routers.admissions import _create_enrollment_record, _require_admin_module
from app.schemas import (
    EnrollmentCreate,
    EnrollmentReportConfirm,
    EnrollmentReportCreate,
    EnrollmentReportReject,
    Response,
)
from app.services.enrollment_report_service import (
    create_enrollment_report,
    get_pending_report,
    get_report,
    list_enrollment_reports,
    reject_report,
    report_payload,
)

router = APIRouter(prefix="/api/admissions", tags=["招生推进"])


def _require_settlement_admin(current_user: User, message: str) -> None:
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail=message)
    _require_admin_module(current_user, ADMIN_PAGE_ENROLLMENT_SETTLEMENT)


@router.post("/enrollment-reports")
async def create_report(
    body: EnrollmentReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """An agent reports that a student enrolled; an admin confirms it later."""
    student = await get_accessible_student(db, body.student_id, current_user)
    report = await create_enrollment_report(
        db,
        student,
        current_user,
        enrolled_program=body.enrolled_program,
        region=body.region,
        notes=body.notes,
    )
    report_id = report.id
    await db.commit()
    return Response.ok(report_payload(await get_report(db, report_id)))


@router.get("/enrollment-reports")
async def list_reports(
    status: Literal["待确认", "已确认", "已驳回"] = Query("待确认"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_settlement_admin(current_user, "只有管理员可以查看报名上报")
    reports = await list_enrollment_reports(db, EnrollmentReportStatus(status))
    return Response.ok({"list": [report_payload(report) for report in reports]})


@router.post("/enrollment-reports/{report_id}/confirm")
async def confirm_report(
    report_id: int,
    body: EnrollmentReportConfirm,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Register the reported enrollment; this closes the report too."""
    _require_settlement_admin(current_user, "只有管理员可以确认报名")
    require_admin_operation(current_user, ADMIN_OP_ENROLLMENT_CREATE)
    report = await get_pending_report(db, report_id)
    student = await get_accessible_student(db, report.student_id, current_user)
    values = body.model_dump()
    values["enrolled_program"] = values["enrolled_program"].strip() or report.enrolled_program
    record = await _create_enrollment_record(
        db,
        EnrollmentCreate(
            student_id=student.id,
            source=EnrollmentSource.phone_call.value,
            **values,
        ),
        student,
        current_user,
    )
    record_id = record.id
    await db.commit()
    return Response.ok(
        {"report": report_payload(await get_report(db, report_id)), "enrollment_id": record_id}
    )


@router.post("/enrollment-reports/{report_id}/reject")
async def reject(
    report_id: int,
    body: EnrollmentReportReject,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_settlement_admin(current_user, "只有管理员可以处理报名上报")
    report = await get_pending_report(db, report_id)
    student = await get_accessible_student(db, report.student_id, current_user)
    reject_report(db, report, student, current_user, body.reason)
    await db.commit()
    return Response.ok(report_payload(await get_report(db, report_id)))
