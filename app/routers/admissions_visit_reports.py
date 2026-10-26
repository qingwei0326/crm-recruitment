import asyncio

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ADMIN_PAGE_CAMPUS_VISITS, ADMIN_PAGE_HOME_VISITS, get_current_user
from app.database import get_db
from app.models import User
from app.permissions import get_accessible_student, is_admin
from app.routers import admissions as admissions_core
from app.routers.admissions import (
    _load_campus_visit_payload,
    _load_home_visit_payload,
    _require_admin_module,
)
from app.schemas import Response, VisitReportCreate
from app.services.visit_report_service import (
    add_campus_visit_task,
    add_home_visit_task,
    has_open_campus_visit,
    parse_exam_score,
)

router = APIRouter(prefix="/api/admissions", tags=["招生推进"])


@router.post("/visit-reports")
async def create_visit_report(
    body: VisitReportCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """File the work-group visit report: a home visit, a campus visit, or both."""
    if body.wants_home_visit:
        _require_admin_module(current_user, ADMIN_PAGE_HOME_VISITS)
    if body.wants_campus_visit:
        _require_admin_module(current_user, ADMIN_PAGE_CAMPUS_VISITS)
    student = await get_accessible_student(db, body.student_id, current_user)
    if body.wants_campus_visit and await has_open_campus_visit(db, student.id):
        raise HTTPException(status_code=400, detail="该学生已有未完成的到校参观任务")

    # A report filed by an admin still belongs to the student's agent.
    creator_id = current_user.id
    if is_admin(current_user) and student.assigned_to:
        creator_id = student.assigned_to
    exam_score_text = body.exam_score_text.strip()
    exam_score = parse_exam_score(exam_score_text)
    intent_program = body.intent_program.strip() or student.program or ""

    home_task_id = campus_task_id = None
    if body.wants_home_visit:
        home_task = await add_home_visit_task(
            db,
            student,
            current_user,
            creator_agent_id=creator_id,
            priority=body.priority,
            intent_program=intent_program,
            exam_score=exam_score if exam_score is not None else student.score,
            exam_score_text=exam_score_text,
            usual_score=body.usual_score,
            parent_intent=body.parent_intent,
            student_situation=body.situation,
            is_wechat_added=body.is_wechat_added,
            is_confirmed_with_guardian=body.is_confirmed_with_guardian,
            requested_visit_time=body.home_visit_at,
            visit_time_note=body.home_visit_note.strip(),
            address=body.address,
            notes=body.notes,
        )
        home_task_id = home_task.id
    if body.wants_campus_visit:
        campus_task = await add_campus_visit_task(
            db,
            student,
            current_user,
            creator_user_id=creator_id,
            source="电话外呼",
            intent_program=intent_program,
            exam_score_text=exam_score_text,
            appointment_at=body.campus_visit_at,
            visit_time_note=body.campus_visit_note.strip(),
            needs_pickup=body.needs_pickup,
            visitor_count=body.visitor_count,
            current_concerns=body.situation,
            notes=body.notes,
        )
        campus_task_id = campus_task.id
    stage = student.stage.value
    await db.commit()

    if home_task_id is not None:
        asyncio.create_task(admissions_core.notify_home_visit_created_background(home_task_id))
    return Response.ok(
        {
            "home_visit": await _load_home_visit_payload(db, home_task_id)
            if home_task_id is not None
            else None,
            "campus_visit": await _load_campus_visit_payload(db, campus_task_id)
            if campus_task_id is not None
            else None,
            "stage": stage,
        }
    )
