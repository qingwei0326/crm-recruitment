from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import Student, User, Visit, VisitStatus, VisitType
from app.permissions import get_accessible_student, is_admin
from app.schemas import Response, VisitCreate, VisitUpdate
from app.utils import mask_phone

router = APIRouter(prefix="/api/visits", tags=["到访"])


def _visit_filters(student_id: int | None, agent_id: int | None, status: str):
    parts = []
    if student_id is not None:
        parts.append(Visit.student_id == student_id)
    if agent_id is not None:
        parts.append(Visit.agent_id == agent_id)
    if status:
        parts.append(Visit.status == status)
    return parts


@router.post("")
async def create_visit(
    body: VisitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    await get_accessible_student(db, body.student_id, current_user)

    visit = Visit(
        student_id=body.student_id,
        agent_id=current_user.id,
        visit_type=VisitType(body.visit_type),
        scheduled_date=body.scheduled_date,
        notes=body.notes,
    )
    db.add(visit)
    await db.commit()
    await db.refresh(visit)
    return Response.ok(
        {
            "id": visit.id,
            "student_id": visit.student_id,
            "visit_type": visit.visit_type,
            "scheduled_date": str(visit.scheduled_date),
            "status": visit.status,
            "notes": visit.notes,
        }
    )


@router.get("")
async def list_visits(
    student_id: int = Query(None),
    agent_id: int = Query(None),
    status: str = Query(""),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        if agent_id is not None and agent_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权查询其他坐席的到访记录")
        if student_id is None:
            agent_id = current_user.id

    conditions = _visit_filters(student_id, agent_id, status)
    if student_id is not None:
        await get_accessible_student(db, student_id, current_user)

    count_stmt = select(func.count(Visit.id))
    if conditions:
        count_stmt = count_stmt.where(*conditions)
    total = (await db.execute(count_stmt)).scalar()

    query = select(Visit).options(joinedload(Visit.student), joinedload(Visit.agent))
    if conditions:
        query = query.where(*conditions)
    query = (
        query.offset((page - 1) * page_size).limit(page_size).order_by(Visit.scheduled_date.desc())
    )
    result = await db.execute(query)
    visits = result.scalars().unique().all()

    data = []
    for v in visits:
        st = v.student
        ag = v.agent
        data.append(
            {
                "id": v.id,
                "student_id": v.student_id,
                "student_name": st.name if st else "",
                "student_phone": mask_phone(st.phone) if st else "",
                "student_region": st.region if st else "",
                "agent_name": ag.name if ag else "",
                "visit_type": v.visit_type,
                "scheduled_date": str(v.scheduled_date),
                "status": v.status,
                "notes": v.notes,
                "created_at": str(v.created_at),
            }
        )

    return Response.ok({"total": total, "page": page, "page_size": page_size, "list": data})


@router.get("/summary")
async def visits_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="无权查看到访汇总")

    type_result = await db.execute(
        select(Visit.visit_type, func.count(Visit.id)).group_by(Visit.visit_type)
    )
    by_type = {row[0]: row[1] for row in type_result.all()}

    status_result = await db.execute(
        select(Visit.status, func.count(Visit.id)).group_by(Visit.status)
    )
    by_status = {row[0]: row[1] for row in status_result.all()}

    region_result = await db.execute(
        select(Student.region, func.count(Visit.id))
        .join(Visit, Visit.student_id == Student.id)
        .group_by(Student.region)
    )
    by_region = {row[0] or "未知": row[1] for row in region_result.all()}

    upcoming_result = await db.execute(
        select(Visit)
        .where(Visit.scheduled_date >= datetime.utcnow(), Visit.status != VisitStatus.cancelled)
        .options(joinedload(Visit.student))
        .order_by(Visit.scheduled_date.asc())
        .limit(50)
    )
    upcoming = []
    for v in upcoming_result.scalars().unique().all():
        student = v.student
        upcoming.append(
            {
                "id": v.id,
                "student_name": student.name if student else "",
                "student_phone": mask_phone(student.phone) if student else "",
                "student_region": student.region if student else "",
                "visit_type": v.visit_type,
                "scheduled_date": str(v.scheduled_date),
                "status": v.status,
            }
        )

    return Response.ok(
        {"by_type": by_type, "by_status": by_status, "by_region": by_region, "upcoming": upcoming}
    )


@router.put("/{visit_id}")
async def update_visit(
    visit_id: int,
    body: VisitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Visit).where(Visit.id == visit_id))
    visit = result.scalar_one_or_none()
    if not visit:
        raise HTTPException(status_code=404, detail="到访记录不存在")
    await get_accessible_student(db, visit.student_id, current_user)
    if body.visit_type is not None:
        visit.visit_type = VisitType(body.visit_type)
    if body.scheduled_date is not None:
        visit.scheduled_date = body.scheduled_date
    if body.status is not None:
        visit.status = VisitStatus(body.status)
    if body.notes is not None:
        visit.notes = body.notes
    await db.commit()
    await db.refresh(visit)
    return Response.ok({"id": visit.id, "status": visit.status, "updated_at": str(visit.updated_at)})
