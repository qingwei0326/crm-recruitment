from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import FollowUp, User
from app.permissions import get_accessible_student
from app.schemas import FollowUpCreate, Response

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
    )
    db.add(fu)
    await db.commit()
    await db.refresh(fu)
    return Response.ok({"id": fu.id, "follow_up_date": str(fu.follow_up_date)})


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
    return Response.ok(
        [
            {
                "id": f.id,
                "follow_up_date": str(f.follow_up_date),
                "is_notified": f.is_notified,
                "created_at": str(f.created_at),
            }
            for f in fus
        ]
    )
