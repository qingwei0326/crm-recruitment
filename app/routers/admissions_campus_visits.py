from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import ADMIN_PAGE_CAMPUS_VISITS, get_current_user
from app.database import get_db
from app.models import (
    CampusVisitResult,
    CampusVisitStatus,
    CampusVisitTask,
    EnrollmentRecord,
    EnrollmentSource,
    Student,
    StudentStage,
    User,
)
from app.permissions import get_accessible_student, is_admin
from app.routers.admissions import (
    ADMIN_CAMPUS_VISIT_RESULT_FIELDS,
    AGENT_CAMPUS_VISIT_EDIT_FIELDS,
    CAMPUS_VISIT_OPEN_STATUSES,
    _advance_student_stage,
    _campus_visit_payload,
    _create_enrollment_record,
    _get_campus_visit_or_404,
    _get_home_visit_or_404,
    _load_campus_visit_payload,
    _page_payload,
    _require_admin_module,
)
from app.schemas import CampusVisitCreate, CampusVisitUpdate, EnrollmentCreate, Response
from app.utils import make_operation_log

router = APIRouter(prefix="/api/admissions", tags=["招生推进"])


@router.get("/campus-visits")
async def list_campus_visits(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_module(current_user, ADMIN_PAGE_CAMPUS_VISITS)
    conditions = []
    if not is_admin(current_user):
        conditions.append(Student.assigned_to == current_user.id)

    count_stmt = select(func.count(CampusVisitTask.id)).join(Student)
    query = (
        select(CampusVisitTask)
        .join(Student)
        .options(
            joinedload(CampusVisitTask.creator_user),
            joinedload(CampusVisitTask.reception_admin),
        )
        .order_by(CampusVisitTask.created_at.desc())
    )
    if conditions:
        count_stmt = count_stmt.where(*conditions)
        query = query.where(*conditions)

    total = (await db.execute(count_stmt)).scalar() or 0
    result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    tasks = result.scalars().unique().all()
    enrollment_by_campus_visit: dict[int, int] = {}
    if tasks:
        enrollment_rows = await db.execute(
            select(EnrollmentRecord.campus_visit_task_id, EnrollmentRecord.id).where(
                EnrollmentRecord.campus_visit_task_id.in_([task.id for task in tasks])
            )
        )
        enrollment_by_campus_visit = {
            int(campus_visit_id): int(enrollment_id)
            for campus_visit_id, enrollment_id in enrollment_rows.all()
            if campus_visit_id is not None
        }
    rows = [_campus_visit_payload(task, enrollment_by_campus_visit.get(task.id)) for task in tasks]
    return Response.ok(_page_payload(total, page, page_size, rows))


@router.post("/campus-visits")
async def create_campus_visit(
    body: CampusVisitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if is_admin(current_user):
        _require_admin_module(current_user, ADMIN_PAGE_CAMPUS_VISITS)
    student = await get_accessible_student(db, body.student_id, current_user)
    open_result = await db.execute(
        select(CampusVisitTask.id).where(
            CampusVisitTask.student_id == student.id,
            CampusVisitTask.status.in_(CAMPUS_VISIT_OPEN_STATUSES),
        )
    )
    if open_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="该学生已有未完成的到校参观任务")

    home_visit = None
    if body.home_visit_task_id is not None:
        home_visit = await _get_home_visit_or_404(db, body.home_visit_task_id)
        if home_visit.student_id != student.id:
            raise HTTPException(status_code=400, detail="家访任务不属于该学生")
    creator_user_id = (
        home_visit.creator_agent_id
        if is_admin(current_user) and home_visit is not None
        else current_user.id
    )

    status = CampusVisitStatus.scheduled if body.appointment_at else CampusVisitStatus.pending
    task = CampusVisitTask(
        student_id=student.id,
        creator_user_id=creator_user_id,
        reception_admin_id=body.reception_admin_id,
        home_visit_task_id=body.home_visit_task_id,
        status=status,
        source=body.source,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone or student.guardian2_phone or "",
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program=body.intent_program or student.program or "",
        appointment_at=body.appointment_at,
        needs_pickup=body.needs_pickup,
        visitor_count=body.visitor_count,
        current_concerns=body.current_concerns,
        notes=body.notes,
    )
    next_stage = (
        StudentStage.campus_visit_scheduled
        if body.appointment_at
        else StudentStage.campus_visit_pending
    )
    _advance_student_stage(student, next_stage)
    db.add(task)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "预约到校",
            content=f"到校参观预约：{student.name}；时间：{body.appointment_at or '待定'}",
        )
    )
    await db.commit()
    await db.refresh(task)
    return Response.ok(await _load_campus_visit_payload(db, task.id))


@router.patch("/campus-visits/{task_id}")
async def update_campus_visit(
    task_id: int,
    body: CampusVisitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _get_campus_visit_or_404(db, task_id)
    student = await get_accessible_student(db, task.student_id, current_user)
    changed_fields = body.model_fields_set
    if is_admin(current_user):
        _require_admin_module(current_user, ADMIN_PAGE_CAMPUS_VISITS)

    if not is_admin(current_user):
        if task.creator_user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权修改他人的到校参观任务")
        if task.status not in CAMPUS_VISIT_OPEN_STATUSES:
            raise HTTPException(status_code=403, detail="已结束的到校参观任务不能由话务员修改")
        disallowed = changed_fields - AGENT_CAMPUS_VISIT_EDIT_FIELDS
        if disallowed:
            raise HTTPException(status_code=403, detail="到校参观结果只能由管理员填写")
    else:
        disallowed = changed_fields - (
            AGENT_CAMPUS_VISIT_EDIT_FIELDS | ADMIN_CAMPUS_VISIT_RESULT_FIELDS
        )
        if disallowed:
            raise HTTPException(
                status_code=422, detail=f"不支持的字段: {', '.join(sorted(disallowed))}"
            )

    old_status = task.status
    old_result = task.result

    for field in AGENT_CAMPUS_VISIT_EDIT_FIELDS:
        value = getattr(body, field)
        if field in changed_fields and value is not None:
            setattr(task, field, value)

    if is_admin(current_user):
        if "status" in changed_fields and body.status is not None:
            task.status = CampusVisitStatus(body.status)
        if "result" in changed_fields and body.result is not None:
            task.result = CampusVisitResult(body.result)
        for field in (
            "reception_admin_id",
            "reception_content",
            "guardian_attitude",
            "student_attitude",
            "onsite_enrolled",
            "not_enrolled_reason",
            "next_action",
            "next_follow_up_at",
            "result_notes",
        ):
            value = getattr(body, field)
            if field in changed_fields and value is not None:
                setattr(task, field, value)
        if task.result == CampusVisitResult.enrolled or task.status == CampusVisitStatus.enrolled:
            await _create_enrollment_record(
                db,
                EnrollmentCreate(
                    student_id=student.id,
                    source=EnrollmentSource.campus_visit.value,
                    home_visit_task_id=task.home_visit_task_id,
                    campus_visit_task_id=task.id,
                    enrolled_program=student.program or task.intent_program or "",
                ),
                student,
                current_user,
                allow_existing=True,
            )
        elif task.status == CampusVisitStatus.arrived:
            _advance_student_stage(student, StudentStage.campus_visit_arrived)
        elif task.status in {CampusVisitStatus.scheduled, CampusVisitStatus.rescheduled}:
            _advance_student_stage(student, StudentStage.campus_visit_scheduled)

    if old_status != task.status or old_result != task.result:
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "处理到校",
                content=f"到校参观 #{task.id}",
                old_status=old_status.value if old_status else "",
                new_status=task.status.value if task.status else "",
                note_content=task.result.value if task.result else "",
            )
        )

    await db.commit()
    return Response.ok(await _load_campus_visit_payload(db, task.id))
