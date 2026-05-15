import secrets
from datetime import date, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password, require_admin
from app.database import get_db
from app.models import Call, LeadViewLog, Student, StudentStatus, User, UserRole
from app.schemas import Response

router = APIRouter(prefix="/api/admin", tags=["管理"])


class UserCreateReq(BaseModel):
    username: str
    password: str
    name: str
    role: str = "agent"
    service_regions: str = ""


class UserUpdateReq(BaseModel):
    name: str | None = None
    role: str | None = None
    is_active: bool | None = None
    password: str | None = None
    service_regions: str | None = None


@router.get("/agents")
async def list_agents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.role == UserRole.agent).order_by(User.id))
    agents = result.scalars().all()
    if not agents:
        return Response.ok([])

    agent_ids = [a.id for a in agents]
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)

    # Batch: total students per agent
    total_r = await db.execute(
        select(Student.assigned_to, func.count(Student.id))
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to)
    )
    total_map = dict(total_r.all())

    # Batch: done (completed/enrolled) per agent
    done_r = await db.execute(
        select(Student.assigned_to, func.count(Student.id))
        .where(
            Student.assigned_to.in_(agent_ids),
            Student.status.in_([StudentStatus.completed, StudentStatus.enrolled]),
        )
        .group_by(Student.assigned_to)
    )
    done_map = dict(done_r.all())

    # Batch: pending (not_contacted) per agent
    pending_r = await db.execute(
        select(Student.assigned_to, func.count(Student.id))
        .where(
            Student.assigned_to.in_(agent_ids),
            Student.status == StudentStatus.not_contacted,
        )
        .group_by(Student.assigned_to)
    )
    pending_map = dict(pending_r.all())

    # Batch: today calls per agent
    today_calls_r = await db.execute(
        select(Call.agent_id, func.count(Call.id))
        .where(Call.agent_id.in_(agent_ids), Call.created_at >= today)
        .group_by(Call.agent_id)
    )
    today_calls_map = dict(today_calls_r.all())

    data = [
        {
            "id": a.id,
            "name": a.name,
            "username": a.username,
            "is_active": a.is_active,
            "service_regions": a.service_regions,
            "total_tasks": total_map.get(a.id, 0),
            "done_tasks": done_map.get(a.id, 0),
            "pending_tasks": pending_map.get(a.id, 0),
            "today_calls": today_calls_map.get(a.id, 0),
            "created_at": str(a.created_at),
        }
        for a in agents
    ]

    return Response.ok(data)


@router.get("/agents/{agent_id}/tasks")
async def agent_tasks(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    agent_r = await db.execute(select(User).where(User.id == agent_id))
    agent = agent_r.scalar_one_or_none()
    if not agent:
        return Response.error(code=1, msg="话务员不存在")

    students_r = await db.execute(
        select(Student).where(Student.assigned_to == agent_id).order_by(Student.updated_at.desc())
    )
    students = students_r.scalars().all()

    total = len(students)
    done = sum(1 for s in students if s.status in (StudentStatus.completed, StudentStatus.enrolled))
    pending = sum(1 for s in students if s.status == StudentStatus.not_contacted)
    follow_up = sum(1 for s in students if s.status == StudentStatus.pending_visit)
    a_level = sum(1 for s in students if s.intent_level == "A")

    student_ids = [s.id for s in students]
    view_count = 0
    if student_ids:
        v_r = await db.execute(
            select(func.count(LeadViewLog.id)).where(LeadViewLog.student_id.in_(student_ids))
        )
        view_count = v_r.scalar() or 0

    return Response.ok(
        {
            "agent": {"id": agent.id, "name": agent.name, "username": agent.username},
            "stats": {
                "total": total,
                "done": done,
                "pending": pending,
                "follow_up": follow_up,
                "a_level": a_level,
                "view_count": view_count,
                "progress_pct": round(done / total * 100, 1) if total > 0 else 0,
            },
            "list": [
                {
                    "id": s.id,
                    "name": s.name,
                    "phone": s.phone[:3] + "****" + s.phone[-4:]
                    if s.phone and len(s.phone) > 7
                    else s.phone,
                    "region": s.region,
                    "status": s.status,
                    "stage": s.stage,
                    "intent_level": s.intent_level,
                    "join_reasons": s.join_reasons,
                    "assigned_at": str(s.assigned_at) if s.assigned_at else None,
                    "updated_at": str(s.updated_at),
                }
                for s in students
            ],
        }
    )


@router.post("/users")
async def create_user(
    body: UserCreateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        return Response.error(code=1, msg=f"用户名 {body.username} 已存在")
    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        name=body.name,
        role=UserRole(body.role),
        service_regions=body.service_regions,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return Response.ok(
        {"id": user.id, "username": user.username, "name": user.name, "role": user.role}
    )


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if body.name is not None:
        user.name = body.name
    if body.role is not None:
        user.role = UserRole(body.role)
    if body.is_active is not None:
        user.is_active = body.is_active
    if body.service_regions is not None:
        user.service_regions = body.service_regions
    if body.password is not None:
        user.hashed_password = hash_password(body.password)
    await db.commit()
    return Response.ok(
        {"id": user.id, "username": user.username, "name": user.name, "is_active": user.is_active}
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if user_id == current_user.id:
        return Response.error(code=1, msg="不能删除自己")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    await db.execute(
        update(Student)
        .where(Student.assigned_to == user_id)
        .values(assigned_to=None, assigned_at=None)
    )
    await db.delete(user)
    await db.commit()
    return Response.ok(msg="已删除，该话务员的学生已回收至池")


@router.post("/users/{user_id}/unlock")
async def unlock_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()
    return Response.ok(msg=f"用户 {user.username} 已解锁")


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    new_password = secrets.token_urlsafe(8)
    user.hashed_password = hash_password(new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()
    return Response.ok(
        {"new_password": new_password, "msg": f"用户 {user.name} 密码已重置为 {new_password}"}
    )


@router.post("/expire-check")
async def check_expired(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """标记过期学生"""
    today = date.today()
    result = await db.execute(
        select(Student).where(
            Student.expired_at.isnot(None),
            Student.expired_at < today,
            Student.status == StudentStatus.not_contacted,
        )
    )
    expired = result.scalars().all()
    count = 0
    for s in expired:
        s.status = StudentStatus.expired
        count += 1
    await db.commit()
    return Response.ok({"expired_count": count})
