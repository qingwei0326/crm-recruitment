import asyncio

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import ADMIN_PAGE_HOME_VISITS, get_current_user
from app.database import get_db
from app.models import (
    EnrollmentRecord,
    EnrollmentSource,
    HomeVisitResult,
    HomeVisitStatus,
    HomeVisitTask,
    Student,
    StudentStage,
    User,
)
from app.permissions import get_accessible_student, is_admin
from app.routers import admissions as admissions_core
from app.routers.admissions import (
    ADMIN_HOME_VISIT_RESULT_FIELDS,
    AGENT_HOME_VISIT_EDIT_FIELDS,
    HOME_VISIT_TERMINAL_STATUSES,
    _advance_student_stage,
    _create_enrollment_record,
    _get_home_visit_or_404,
    _home_visit_payload,
    _load_home_visit_payload,
    _page_payload,
    _require_admin_module,
)
from app.schemas import EnrollmentCreate, HomeVisitCreate, HomeVisitUpdate, Response
from app.utils import make_operation_log

router = APIRouter(prefix="/api/admissions", tags=["招生推进"])


@router.get("/home-visits")
async def list_home_visits(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_module(current_user, ADMIN_PAGE_HOME_VISITS)
    conditions = []
    if not is_admin(current_user):
        conditions.append(Student.assigned_to == current_user.id)

    count_stmt = select(func.count(HomeVisitTask.id)).join(Student)
    query = (
        select(HomeVisitTask)
        .join(Student)
        .options(joinedload(HomeVisitTask.creator_agent), joinedload(HomeVisitTask.assigned_admin))
        .order_by(HomeVisitTask.created_at.desc())
    )
    if conditions:
        count_stmt = count_stmt.where(*conditions)
        query = query.where(*conditions)

    total = (await db.execute(count_stmt)).scalar() or 0
    result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    tasks = result.scalars().unique().all()
    enrollment_by_home_visit: dict[int, int] = {}
    if tasks:
        enrollment_rows = await db.execute(
            select(EnrollmentRecord.home_visit_task_id, EnrollmentRecord.id).where(
                EnrollmentRecord.home_visit_task_id.in_([task.id for task in tasks])
            )
        )
        enrollment_by_home_visit = {
            int(home_visit_id): int(enrollment_id)
            for home_visit_id, enrollment_id in enrollment_rows.all()
            if home_visit_id is not None
        }
    rows = [_home_visit_payload(task, enrollment_by_home_visit.get(task.id)) for task in tasks]
    return Response.ok(_page_payload(total, page, page_size, rows))


@router.post("/home-visits")
async def create_home_visit(
    body: HomeVisitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_module(current_user, ADMIN_PAGE_HOME_VISITS)
    student = await get_accessible_student(db, body.student_id, current_user)
    creator_agent_id = current_user.id
    if is_admin(current_user) and student.assigned_to:
        creator_agent_id = student.assigned_to

    task = HomeVisitTask(
        student_id=student.id,
        creator_agent_id=creator_agent_id,
        status=HomeVisitStatus.pending,
        priority=body.priority,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone or student.guardian2_phone or "",
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program=body.intent_program or student.program or "",
        exam_score=body.exam_score if body.exam_score is not None else student.score,
        usual_score=body.usual_score,
        parent_intent=body.parent_intent,
        student_situation=body.student_situation,
        is_wechat_added=body.is_wechat_added,
        is_confirmed_with_guardian=body.is_confirmed_with_guardian,
        requested_visit_time=body.requested_visit_time,
        address=body.address,
        notes=body.notes,
    )
    _advance_student_stage(student, StudentStage.home_visit_pending)
    db.add(task)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "申请家访",
            content=f"家访申请：{student.name}；地址：{body.address or '未填写'}",
        )
    )
    await db.commit()
    await db.refresh(task)
    asyncio.create_task(admissions_core.notify_home_visit_created_background(task.id))
    return Response.ok(await _load_home_visit_payload(db, task.id))


@router.patch("/home-visits/{task_id}")
async def update_home_visit(
    task_id: int,
    body: HomeVisitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _get_home_visit_or_404(db, task_id)
    student = await get_accessible_student(db, task.student_id, current_user)
    changed_fields = body.model_fields_set
    if is_admin(current_user):
        _require_admin_module(current_user, ADMIN_PAGE_HOME_VISITS)

    if not is_admin(current_user):
        if task.creator_agent_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权修改他人的家访任务")
        if task.status in HOME_VISIT_TERMINAL_STATUSES:
            raise HTTPException(status_code=403, detail="已结束的家访任务不能由话务员修改")
        disallowed = changed_fields - AGENT_HOME_VISIT_EDIT_FIELDS
        if disallowed:
            raise HTTPException(status_code=403, detail="家访结果只能由管理员填写")
    else:
        disallowed = changed_fields - (
            AGENT_HOME_VISIT_EDIT_FIELDS | ADMIN_HOME_VISIT_RESULT_FIELDS
        )
        if disallowed:
            raise HTTPException(
                status_code=422, detail=f"不支持的字段: {', '.join(sorted(disallowed))}"
            )

    old_status = task.status
    old_result = task.result

    for field in AGENT_HOME_VISIT_EDIT_FIELDS:
        value = getattr(body, field)
        if field in changed_fields and value is not None:
            setattr(task, field, value)

    if is_admin(current_user):
        if "status" in changed_fields and body.status is not None:
            task.status = HomeVisitStatus(body.status)
        if "result" in changed_fields and body.result is not None:
            task.result = HomeVisitResult(body.result)
        for field in (
            "assigned_admin_id",
            "scheduled_at",
            "postpone_reason",
            "guardian_attitude",
            "student_attitude",
            "concerns",
            "next_action",
            "next_follow_up_at",
            "result_notes",
        ):
            value = getattr(body, field)
            if field in changed_fields and value is not None:
                setattr(task, field, value)
        if task.result == HomeVisitResult.enrolled:
            await _create_enrollment_record(
                db,
                EnrollmentCreate(
                    student_id=student.id,
                    source=EnrollmentSource.home_visit.value,
                    home_visit_task_id=task.id,
                    enrolled_program=student.program or task.intent_program or "",
                ),
                student,
                current_user,
                allow_existing=True,
            )
        elif task.result == HomeVisitResult.campus_visit:
            _advance_student_stage(student, StudentStage.campus_visit_pending)
        elif task.status == HomeVisitStatus.completed:
            _advance_student_stage(student, StudentStage.home_visit_completed)
        elif task.status in {HomeVisitStatus.confirmed, HomeVisitStatus.scheduled}:
            _advance_student_stage(student, StudentStage.home_visit_scheduled)

    if old_status != task.status or old_result != task.result:
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "处理家访",
                content=f"家访 #{task.id}",
                old_status=old_status.value if old_status else "",
                new_status=task.status.value if task.status else "",
                note_content=task.result.value if task.result else "",
            )
        )

    await db.commit()
    return Response.ok(await _load_home_visit_payload(db, task.id))
