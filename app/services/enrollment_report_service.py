"""Agents' 已报名 reports and how an admin settles them.

Only admins create enrollment records. An agent who hears that a student enrolled
files a report here, and an admin confirms it into a record or rejects it, so the
pending reports are the queue of enrollments still to be registered.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.domain_errors import DomainConflict, ResourceNotFound
from app.models import (
    EnrollmentRecord,
    EnrollmentReport,
    EnrollmentReportStatus,
    Student,
    StudentStatus,
    User,
)
from app.status_policy import canonical_student_status
from app.utils import make_operation_log, utcnow


async def _pending_reports(db: AsyncSession, student_id: int) -> list[EnrollmentReport]:
    result = await db.execute(
        select(EnrollmentReport).where(
            EnrollmentReport.student_id == student_id,
            EnrollmentReport.status == EnrollmentReportStatus.pending,
        )
    )
    return list(result.scalars().all())


async def create_enrollment_report(
    db: AsyncSession,
    student: Student,
    reporter: User,
    *,
    enrolled_program: str,
    region: str,
    notes: str,
) -> EnrollmentReport:
    has_record = (
        await db.execute(
            select(EnrollmentRecord.id).where(EnrollmentRecord.student_id == student.id)
        )
    ).first() is not None
    if has_record or canonical_student_status(student.status) == StudentStatus.enrolled:
        raise DomainConflict("该学生已经登记报名")
    if await _pending_reports(db, student.id):
        raise DomainConflict("已经上报过，等管理员确认")

    program = enrolled_program.strip()
    report = EnrollmentReport(
        student_id=student.id,
        reporter_id=reporter.id,
        status=EnrollmentReportStatus.pending,
        enrolled_program=program,
        region=region.strip() or student.region or "",
        notes=notes.strip(),
    )
    db.add(report)
    db.add(
        make_operation_log(
            reporter,
            student.id,
            student.case_no or "",
            "上报报名",
            content=f"报读专业：{program or '未填写'}，等管理员确认",
        )
    )
    await db.flush()
    return report


async def list_enrollment_reports(
    db: AsyncSession,
    status: EnrollmentReportStatus,
) -> list[EnrollmentReport]:
    result = await db.execute(
        _with_people(select(EnrollmentReport))
        .where(EnrollmentReport.status == status)
        .order_by(EnrollmentReport.created_at.asc(), EnrollmentReport.id.asc())
    )
    return list(result.scalars().unique().all())


def _with_people(statement):
    return statement.options(
        joinedload(EnrollmentReport.student).joinedload(Student.assigned_agent),
        joinedload(EnrollmentReport.reporter),
        joinedload(EnrollmentReport.reviewed_by),
    )


async def get_report(db: AsyncSession, report_id: int) -> EnrollmentReport:
    report = (
        await db.execute(
            _with_people(select(EnrollmentReport)).where(EnrollmentReport.id == report_id)
        )
    ).scalar_one_or_none()
    if report is None:
        raise ResourceNotFound("报名上报不存在")
    return report


async def get_pending_report(db: AsyncSession, report_id: int) -> EnrollmentReport:
    report = await get_report(db, report_id)
    if report.status != EnrollmentReportStatus.pending:
        raise DomainConflict(f"这条上报已经{report.status.value}")
    return report


async def resolve_reports_with_record(
    db: AsyncSession,
    student: Student,
    record: EnrollmentRecord,
    admin: User,
) -> None:
    """Close a student's pending reports once an enrollment record exists, by any path."""
    for report in await _pending_reports(db, student.id):
        report.status = EnrollmentReportStatus.confirmed
        report.enrollment_record_id = record.id
        report.reviewed_by_id = admin.id
        report.reviewed_at = utcnow()


def reject_report(
    db: AsyncSession,
    report: EnrollmentReport,
    student: Student,
    admin: User,
    reason: str,
) -> None:
    report.status = EnrollmentReportStatus.rejected
    report.reject_reason = reason.strip()
    report.reviewed_by_id = admin.id
    report.reviewed_at = utcnow()
    db.add(
        make_operation_log(
            admin,
            student.id,
            student.case_no or "",
            "驳回报名上报",
            content=f"上报 #{report.id}：{report.reject_reason or '未写原因'}",
        )
    )


def report_payload(report: EnrollmentReport) -> dict:
    student = report.student
    return {
        "id": report.id,
        "student_id": report.student_id,
        "student_name": student.name if student else "",
        "school_name": student.school_name if student else "",
        "region": report.region,
        "assigned_to": student.assigned_to if student else None,
        "assigned_agent_name": student.assigned_agent.name
        if student and student.assigned_agent
        else "",
        "reporter_id": report.reporter_id,
        "reporter_name": report.reporter.name if report.reporter else "",
        "status": report.status.value,
        "enrolled_program": report.enrolled_program,
        "notes": report.notes,
        "reject_reason": report.reject_reason,
        "reviewed_by_name": report.reviewed_by.name if report.reviewed_by else "",
        "reviewed_at": str(report.reviewed_at) if report.reviewed_at else None,
        "enrollment_record_id": report.enrollment_record_id,
        "created_at": str(report.created_at) if report.created_at else None,
    }
