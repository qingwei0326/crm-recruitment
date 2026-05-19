import os
import secrets
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select, union_all, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password, require_admin
from app.database import get_db
from app.models import (
    Call,
    IntentLevel,
    LeadViewLog,
    Note,
    OperationLog,
    Student,
    StudentStatus,
    SystemConfig,
    User,
    UserRole,
)
from app.schemas import Response, StaleReassignReq

router = APIRouter(prefix="/api/admin", tags=["管理"])


class UserCreateReq(BaseModel):
    username: str
    password: str
    name: str
    role: Literal["admin", "agent"] = "agent"
    service_regions: str = ""


class UserUpdateReq(BaseModel):
    name: str | None = None
    role: Literal["admin", "agent"] | None = None
    is_active: bool | None = None
    password: str | None = None
    service_regions: str | None = None


class ConfigUpdateReq(BaseModel):
    key: str
    value: str


ALLOWED_CONFIG_KEYS = {"pushplus_token", "stale_days"}


def to_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


def mask_config_value(key: str, value: str) -> str:
    if key == "pushplus_token" and len(value) > 4:
        return "****" + value[-4:]
    return value


def build_last_activity_subquery():
    activity_events = union_all(
        select(Call.student_id.label("student_id"), Call.created_at.label("created_at")),
        select(Note.student_id.label("student_id"), Note.created_at.label("created_at")),
    ).subquery()
    return (
        select(
            activity_events.c.student_id,
            func.max(activity_events.c.created_at).label("last_activity_at"),
        )
        .group_by(activity_events.c.student_id)
        .subquery()
    )


async def get_config_value(db: AsyncSession, key: str, fallback: str = "") -> str:
    """Read a single SystemConfig value, fall back to env var of same name uppercased, then to fallback."""
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    item = result.scalar_one_or_none()
    if item and item.value:
        return item.value
    return os.getenv(key.upper(), fallback)


@router.get("/config")
async def get_system_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(select(SystemConfig).order_by(SystemConfig.key))
    data = {item.key: mask_config_value(item.key, item.value) for item in result.scalars().all()}
    return Response.ok(data)


@router.put("/config")
async def update_system_config(
    body: ConfigUpdateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    key = body.key.strip()
    value = body.value.strip()
    if key not in ALLOWED_CONFIG_KEYS:
        return Response.error(code=1, msg="Unsupported config key")

    if key == "stale_days":
        try:
            stale_days = int(value)
        except ValueError:
            return Response.error(code=1, msg="stale_days must be an integer between 1 and 30")
        if stale_days < 1 or stale_days > 30:
            return Response.error(code=1, msg="stale_days must be an integer between 1 and 30")
        value = str(stale_days)

    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    item = result.scalar_one_or_none()
    if item:
        item.value = value
    else:
        item = SystemConfig(key=key, value=value)
        db.add(item)
    await db.commit()

    return Response.ok({"key": key, "value": mask_config_value(key, value)})


@router.get("/stale-a")
async def stale_a_students(
    days: int = Query(3, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    last_activity = build_last_activity_subquery()

    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("latest_activity_at")
    cutoff = datetime.utcnow() - timedelta(days=days)

    result = await db.execute(
        select(Student, User.name.label("agent_name"), latest_activity_at)
        .outerjoin(User, User.id == Student.assigned_to)
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(
            Student.intent_level == IntentLevel.A,
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.invalid,
                    StudentStatus.rejected,
                    StudentStatus.expired,
                ]
            ),
            latest_activity_at < cutoff,
        )
        .order_by(latest_activity_at.asc(), Student.id.asc())
    )

    now = datetime.utcnow()
    data = []
    for student, agent_name, raw_last_activity_at in result.all():
        last_activity_at = to_datetime(raw_last_activity_at)
        data.append(
            {
                "id": student.id,
                "name": student.name,
                "region": student.region,
                "status": student.status,
                "stage": student.stage,
                "intent_level": student.intent_level,
                "assigned_to": student.assigned_to,
                "agent_name": agent_name,
                "last_activity_at": last_activity_at.isoformat() if last_activity_at else None,
                "days_since": (now - last_activity_at).days if last_activity_at else 0,
            }
        )

    return Response.ok(data)


@router.get("/stale-students")
async def stale_students(
    days: int = Query(3, ge=1, le=30),
    agent_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    last_activity = build_last_activity_subquery()
    last_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("last_activity_at")
    cutoff = datetime.utcnow() - timedelta(days=days)
    stale_filters = [
        Student.status.not_in(
            [
                StudentStatus.enrolled,
                StudentStatus.invalid,
                StudentStatus.expired,
                StudentStatus.rejected,
            ]
        )
    ]

    if agent_id is None:
        stale_filters.extend(
            [
                Student.assigned_to.isnot(None),
                last_activity_at < cutoff,
            ]
        )
    else:
        stale_filters.append(Student.assigned_to == agent_id)

    result = await db.execute(
        select(Student, User.name.label("agent_name"), last_activity_at)
        .outerjoin(User, User.id == Student.assigned_to)
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(*stale_filters)
        .order_by(last_activity_at.asc(), Student.id.asc())
    )

    data = []
    for student, agent_name, raw_last_activity_at in result.all():
        activity_at = to_datetime(raw_last_activity_at)
        data.append(
            {
                "student_id": student.id,
                "name": student.name,
                "region": student.region,
                "intent_level": student.intent_level,
                "status": student.status,
                "agent_name": agent_name,
                "assigned_at": student.assigned_at.isoformat() if student.assigned_at else None,
                "last_activity_at": activity_at.isoformat() if activity_at else None,
            }
        )

    return Response.ok(data)


@router.post("/stale-reassign")
async def stale_reassign(
    body: StaleReassignReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")
    student_ids = list(dict.fromkeys(body.student_ids))

    students_result = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="没有可回收的线索")

    now = datetime.utcnow()
    distribution: dict[str, int] = {}

    if body.mode == "manual":
        if body.agent_id is None:
            return Response.error(code=1, msg="manual mode requires agent_id")
        agent_result = await db.execute(
            select(User).where(
                User.id == body.agent_id,
                User.is_active,
                User.role == UserRole.agent,
            )
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            return Response.error(code=1, msg="话务员不存在或已禁用")
        for student in students:
            student.assigned_to = agent.id
            student.assigned_at = now
            distribution[agent.name] = distribution.get(agent.name, 0) + 1
    else:
        agent_result = await db.execute(
            select(User).where(User.is_active, User.role == UserRole.agent).order_by(User.id)
        )
        agents = agent_result.scalars().all()
        if not agents:
            return Response.error(code=1, msg="没有可用的话务员")

        load = {}
        for agent in agents:
            count_result = await db.execute(
                select(func.count(Student.id)).where(Student.assigned_to == agent.id)
            )
            load[agent.id] = count_result.scalar() or 0
            distribution[agent.name] = 0
        agent_map = {agent.id: agent for agent in agents}

        for student in sorted(students, key=lambda item: item.id):
            agent_id = min(load, key=load.get)
            agent = agent_map[agent_id]
            student.assigned_to = agent_id
            student.assigned_at = now
            load[agent_id] += 1
            distribution[agent.name] += 1

    for student in students:
        db.add(
            OperationLog(
                operator_id=current_user.id,
                operator_name=current_user.name,
                target_student_id=student.id,
                case_no=student.case_no or "",
                action="线索回收",
                content="超时未跟进，重新分配",
            )
        )

    await db.commit()
    return Response.ok({"reassigned_count": len(students), "distribution": distribution})


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

    for item in data:
        item["total_tasks"] = int(item["total_tasks"] or 0)
        item["done_tasks"] = int(item["done_tasks"] or 0)
        item["pending_tasks"] = int(item["pending_tasks"] or 0)
        item["today_calls"] = int(item["today_calls"] or 0)

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
    a_level = sum(1 for s in students if s.intent_level == IntentLevel.A)

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
