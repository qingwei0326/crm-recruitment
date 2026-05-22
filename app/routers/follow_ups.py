from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import FollowUp, Student, User, UserRole
from app.permissions import get_accessible_student
from app.schemas import FollowUpCreate, FollowUpUpdate, Response
from app.utils import utcnow

router = APIRouter(prefix="/api/follow-ups", tags=["回访"])


@router.post("")
async def create_follow_up(
    body: FollowUpCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_accessible_student(db, body.student_id, current_user)
    fu = FollowUp(
        student_id=body.student_id,
        agent_id=current_user.id,
        follow_up_date=body.follow_up_date,
        follow_up_type=body.follow_up_type,
        notes=body.notes,
    )
    db.add(fu)
    await db.commit()
    await db.refresh(fu)
    return Response.ok(_fu_payload(fu))


@router.get("")
async def list_follow_ups(
    student_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_accessible_student(db, student_id, current_user)
    result = await db.execute(
        select(FollowUp)
        .where(FollowUp.student_id == student_id)
        .order_by(FollowUp.follow_up_date.desc())
    )
    fus = result.scalars().all()
    return Response.ok([_fu_payload(f) for f in fus])


@router.get("/my-pending")
async def my_pending_follow_ups(
    days_ahead: int = Query(7, ge=1, le=60),
    include_overdue: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """当前话务员的待办回访（默认未来 7 天 + 逾期未完成）。"""
    now = utcnow()
    horizon = now + timedelta(days=days_ahead)

    conditions = [
        FollowUp.agent_id == current_user.id,
        FollowUp.is_completed.is_(False),
        FollowUp.follow_up_date <= horizon,
    ]
    if not include_overdue:
        conditions.append(FollowUp.follow_up_date >= now - timedelta(hours=1))

    result = await db.execute(
        select(FollowUp, Student)
        .join(Student, Student.id == FollowUp.student_id)
        .where(*conditions)
        .order_by(FollowUp.follow_up_date.asc())
    )
    data = []
    for fu, student in result.all():
        data.append(
            {
                **_fu_payload(fu),
                "student_id": student.id,
                "student_name": student.name,
                "student_region": student.region,
                "intent_level": student.intent_level,
                "status": student.status,
                "overdue": fu.follow_up_date < now,
            }
        )
    return Response.ok(data)


def _fu_payload(f: FollowUp) -> dict:
    return {
        "id": f.id,
        "follow_up_date": str(f.follow_up_date),
        "follow_up_type": f.follow_up_type or "电话",
        "notes": f.notes or "",
        "is_notified": f.is_notified,
        "is_completed": f.is_completed,
        "created_at": str(f.created_at),
    }


async def _get_follow_up_or_none(db: AsyncSession, fu_id: int):
    result = await db.execute(select(FollowUp).where(FollowUp.id == fu_id))
    return result.scalar_one_or_none()


def _can_manage_follow_up(current_user: User, follow_up: FollowUp) -> bool:
    return current_user.role == UserRole.admin or follow_up.agent_id == current_user.id


@router.put("/{fu_id}")
async def update_follow_up(
    fu_id: int,
    body: FollowUpUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    follow_up = await _get_follow_up_or_none(db, fu_id)
    if not follow_up:
        return Response.error(code=1, msg="follow_up not found")
    if not _can_manage_follow_up(current_user, follow_up):
        return Response.error(code=1, msg="无权操作此回访")

    if body.follow_up_date is not None:
        follow_up.follow_up_date = body.follow_up_date
    if body.is_notified is not None:
        follow_up.is_notified = body.is_notified
    if body.is_completed is not None:
        follow_up.is_completed = body.is_completed
    if body.follow_up_type is not None:
        follow_up.follow_up_type = body.follow_up_type
    if body.notes is not None:
        follow_up.notes = body.notes

    await db.commit()
    await db.refresh(follow_up)
    return Response.ok(
        {
            **_fu_payload(follow_up),
            "student_id": follow_up.student_id,
            "agent_id": follow_up.agent_id,
        }
    )


@router.delete("/{fu_id}")
async def delete_follow_up(
    fu_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    follow_up = await _get_follow_up_or_none(db, fu_id)
    if not follow_up:
        return Response.error(code=1, msg="follow_up not found")
    if not _can_manage_follow_up(current_user, follow_up):
        return Response.error(code=1, msg="无权操作此回访")

    await db.delete(follow_up)
    await db.commit()
    return Response.ok({"deleted": fu_id})
