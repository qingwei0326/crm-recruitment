from datetime import timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Call, FollowUp, IntentLevel, Student, StudentStatus, User
from app.schemas import Response
from app.utils import mask_phone, today_cst_as_utc

router = APIRouter(prefix="/api/tasks", tags=["任务"])


@router.get("/today")
async def today_tasks(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == current_user.id,
            Student.status.in_(
                [StudentStatus.not_contacted, StudentStatus.contacted, StudentStatus.pending_visit]
            ),
            Student.status != StudentStatus.expired,
        )
        .order_by(Student.updated_at.desc())
    )
    students = result.scalars().all()

    total = len(students)
    done = sum(
        1
        for s in students
        if s.status
        in (
            StudentStatus.contacted,
            StudentStatus.completed,
            StudentStatus.enrolled,
            StudentStatus.pending_visit,
        )
    )
    pending = sum(1 for s in students if s.status == StudentStatus.not_contacted)
    follow_up = sum(1 for s in students if s.status == StudentStatus.pending_visit)
    progress_pct = round(done / total * 100, 1) if total > 0 else 0

    return Response.ok(
        {
            "stats": {
                "total": total,
                "done": done,
                "pending": pending,
                "follow_up": follow_up,
                "progress_pct": progress_pct,
            },
            "list": [
                {
                    "id": s.id,
                    "name": s.name,
                    "region": s.region,
                    "guardian_name": s.guardian_name,
                    "guardian_phone": mask_phone(s.guardian_phone),
                    "guardian2_name": s.guardian2_name,
                    "guardian2_phone": mask_phone(s.guardian2_phone),
                    "school_name": s.school_name,
                    "school_address": s.school_address,
                    "status": s.status,
                    "stage": s.stage,
                    "intent_level": s.intent_level,
                    "expired_at": str(s.expired_at) if s.expired_at else None,
                    "updated_at": str(s.updated_at),
                }
                for s in students
            ],
        }
    )


@router.get("/yesterday")
async def yesterday_review(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = today_cst_as_utc()
    yesterday = today - timedelta(days=1)

    calls_result = await db.execute(
        select(func.count(Call.id)).where(
            Call.agent_id == current_user.id, Call.created_at >= yesterday, Call.created_at < today
        )
    )
    yesterday_calls = calls_result.scalar() or 0

    a_result = await db.execute(
        select(func.count(Student.id)).where(
            Student.assigned_to == current_user.id,
            Student.intent_level == IntentLevel.A,
            Student.updated_at >= yesterday,
            Student.updated_at < today,
        )
    )
    yesterday_a = a_result.scalar() or 0

    contacted_result = await db.execute(
        select(func.count(Student.id)).where(
            Student.assigned_to == current_user.id,
            Student.status != StudentStatus.not_contacted,
        )
    )
    all_contacted = contacted_result.scalar() or 0
    all_a_result = await db.execute(
        select(func.count(Student.id)).where(
            Student.assigned_to == current_user.id, Student.intent_level == IntentLevel.A
        )
    )
    all_a = all_a_result.scalar() or 0
    conversion = round(all_a / all_contacted * 100, 1) if all_contacted > 0 else 0

    assigned_result = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == current_user.id,
            Student.assigned_at >= yesterday,
            Student.assigned_at < today,
        )
        .order_by(Student.assigned_at.desc())
        .limit(20)
    )
    assigned_list = [
        {"id": s.id, "name": s.name, "status": s.status, "assigned_at": str(s.assigned_at)}
        for s in assigned_result.scalars().all()
    ]

    tomorrow = today + timedelta(days=1)
    follow_up_result = await db.execute(
        select(FollowUp, Student)
        .join(Student, Student.id == FollowUp.student_id)
        .where(
            FollowUp.agent_id == current_user.id,
            FollowUp.follow_up_date >= today,
            FollowUp.follow_up_date < tomorrow,
            FollowUp.is_notified.is_(False),
        )
        .order_by(FollowUp.follow_up_date.asc())
    )
    follow_up_list = [
        {
            "id": fu.id,
            "follow_up_date": str(fu.follow_up_date),
            "student_id": student.id,
            "student_name": student.name,
            "student_region": student.region,
            "intent_level": student.intent_level,
            "status": student.status,
        }
        for fu, student in follow_up_result.all()
    ]

    return Response.ok(
        {
            "yesterday_calls": yesterday_calls,
            "yesterday_a": yesterday_a,
            "conversion_rate": conversion,
            "list": assigned_list,
            "follow_up_list": follow_up_list,
        }
    )
