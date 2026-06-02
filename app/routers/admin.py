import os
import re
import secrets
from datetime import date, datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select, union_all, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password, invalidate_user_tokens, require_admin
from app.backup import BACKUP_DIR, do_backup_async, _get_backup_extension
from app.utils import make_operation_log, today_cst_as_utc, utcnow
from app.database import get_db
from app.models import (
    Call,
    IntentLevel,
    LeadViewLog,
    Note,
    OperationLog,
    Student,
    StudentStage,
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


ALLOWED_CONFIG_KEYS = {
    "pushplus_token",
    "stale_days",
    "dial_window_start",
    "dial_window_end",
    "dial_max_per_24h",
    "deepseek_api_key",
}

_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _validate_config_value(key: str, value: str) -> tuple[str | None, str | None]:
    """Returns (normalized_value, error_msg). 任一字段在前端都能改，必须独立校验。"""
    if key == "stale_days":
        try:
            n = int(value)
        except ValueError:
            return None, "stale_days must be an integer between 1 and 30"
        if not 1 <= n <= 30:
            return None, "stale_days must be an integer between 1 and 30"
        return str(n), None
    if key == "dial_max_per_24h":
        try:
            n = int(value)
        except ValueError:
            return None, "dial_max_per_24h must be an integer between 1 and 20"
        if not 1 <= n <= 20:
            return None, "dial_max_per_24h must be an integer between 1 and 20"
        return str(n), None
    if key in ("dial_window_start", "dial_window_end"):
        if not _HHMM_RE.match(value):
            return None, f"{key} must be HH:MM (24h)"
        return value, None
    if key == "pushplus_token":
        if len(value) > 64:
            return None, "pushplus_token too long"
        return value, None
    if key == "deepseek_api_key":
        if value and len(value) > 128:
            return None, "deepseek_api_key too long"
        # 接受空串（用于清除）；非空必须形如 sk-xxx 避免误填
        if value and not value.startswith("sk-"):
            return None, "deepseek_api_key 必须以 sk- 开头"
        return value, None
    return value, None


def to_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


def mask_config_value(key: str, value: str) -> str:
    if key in ("pushplus_token", "deepseek_api_key") and len(value) > 4:
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

    normalized, err = _validate_config_value(key, value)
    if err:
        return Response.error(code=1, msg=err)
    value = normalized

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
    cutoff = utcnow() - timedelta(days=days)

    result = await db.execute(
        select(Student, User.name.label("agent_name"), latest_activity_at)
        .outerjoin(User, User.id == Student.assigned_to)
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(
            Student.intent_level == IntentLevel.A,
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.rejected,
                    StudentStatus.expired,
                    StudentStatus.invalid,
                ]
            ),
            latest_activity_at < cutoff,
        )
        .order_by(latest_activity_at.asc(), Student.id.asc())
    )

    now = utcnow()
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
    cutoff = utcnow() - timedelta(days=days)
    stale_filters = [
        Student.status.not_in(
            [
                StudentStatus.enrolled,
                StudentStatus.expired,
                StudentStatus.rejected,
                StudentStatus.invalid,
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

    now = utcnow()
    distribution: dict[str, int] = {}

    if body.mode == "recycle":
        for student in students:
            student.assigned_to = None
            student.assigned_at = None
        distribution["总名单"] = len(students)
    elif body.mode == "manual":
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
                select(func.count(Student.id)).where(
                    Student.assigned_to == agent.id,
                    Student.status.not_in(
                        [
                            StudentStatus.enrolled,
                            StudentStatus.expired,
                            StudentStatus.rejected,
                            StudentStatus.invalid,
                        ]
                    ),
                )
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

    log_content = "回收到总名单" if body.mode == "recycle" else "超时未跟进，重新分配"
    for student in students:
        db.add(
            OperationLog(
                operator_id=current_user.id,
                operator_name=current_user.name,
                target_student_id=student.id,
                case_no=student.case_no or "",
                action="线索回收",
                content=log_content,
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
    today = today_cst_as_utc()

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
    await db.flush()
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="创建用户",
            content=f"创建{body.role} {user.username}({user.name})",
        )
    )
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

    changes = []
    if body.name is not None and body.name != user.name:
        changes.append(f"姓名 {user.name}→{body.name}")
        user.name = body.name
    if body.role is not None:
        new_role = UserRole(body.role)
        if new_role != user.role:
            # 防止把唯一一个 admin 降级
            if user.role == UserRole.admin and new_role != UserRole.admin:
                admin_count = (await db.execute(
                    select(func.count(User.id)).where(
                        User.role == UserRole.admin, User.is_active
                    )
                )).scalar() or 0
                if admin_count <= 1:
                    return Response.error(code=1, msg="系统至少需要保留一个管理员")
            changes.append(f"角色 {user.role}→{new_role}")
            user.role = new_role
    if body.is_active is not None and body.is_active != user.is_active:
        # 防止把唯一一个 admin 停用
        if user.role == UserRole.admin and user.is_active and not body.is_active:
            admin_count = (await db.execute(
                select(func.count(User.id)).where(
                    User.role == UserRole.admin, User.is_active
                )
            )).scalar() or 0
            if admin_count <= 1:
                return Response.error(code=1, msg="不能停用最后一个管理员")
        changes.append("启用" if body.is_active else "停用")
        user.is_active = body.is_active
        # 禁用时立即撤销现有 token，防止账号被禁用后旧会话仍能访问
        if not body.is_active:
            invalidate_user_tokens(user)
    if body.service_regions is not None and body.service_regions != user.service_regions:
        changes.append("修改服务区域")
        user.service_regions = body.service_regions
    if body.password is not None:
        changes.append("重置密码")
        user.hashed_password = hash_password(body.password)
        invalidate_user_tokens(user)

    if changes:
        db.add(
            make_operation_log(
                current_user,
                target_student_id=None,
                case_no="",
                action="修改用户",
                content=f"{user.username}: {'; '.join(changes)}",
            )
        )
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
    # 防止删除最后一个 admin
    if user.role == UserRole.admin:
        admin_count = (await db.execute(
            select(func.count(User.id)).where(
                User.role == UserRole.admin, User.is_active
            )
        )).scalar() or 0
        if admin_count <= 1:
            return Response.error(code=1, msg="不能删除最后一个管理员")
    # 1) 先处理终态学员：只解绑话务员，保留状态作为历史归档
    await db.execute(
        update(Student)
        .where(
            Student.assigned_to == user_id,
            Student.status.in_(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.invalid,
                ]
            ),
        )
        .values(assigned_to=None, assigned_at=None)
    )
    # 2) 再回收非终态学员：清除分配、状态、意向、阶段，避免新话务员误以为旧记录是自己跟出来的
    await db.execute(
        update(Student)
        .where(Student.assigned_to == user_id)
        .values(
            assigned_to=None,
            assigned_at=None,
            status=StudentStatus.not_contacted,
            intent_level=IntentLevel.none,
            stage=StudentStage.initial_contact,
            need_help=False,
        )
    )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="删除用户",
            content=f"删除{user.role} {user.username}({user.name})，非终态学生已重置并回收至池",
        )
    )
    await db.delete(user)
    await db.commit()
    return Response.ok(msg="已删除，该话务员的学生已回收至池")


@router.post("/users/{user_id}/offboard")
async def offboard_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """软离职：禁用账号 + 撤销 token + 回收线索 + 留存历史。

    相比 delete_user 的优势：
      1) 保留 Call/Note/FollowUp 等历史归属，报表口径不丢
      2) 绕开 FK 约束（hard delete 在话务员有工作记录时会报错）
      3) 一个原子操作完成所有离职动作，避免 admin 分多步做漏环节
    """
    if user_id == current_user.id:
        return Response.error(code=1, msg="不能离职自己")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")

    # 防止把最后一个 admin 离职
    if user.role == UserRole.admin and user.is_active:
        admin_count = (await db.execute(
            select(func.count(User.id)).where(
                User.role == UserRole.admin, User.is_active
            )
        )).scalar() or 0
        if admin_count <= 1:
            return Response.error(code=1, msg="不能离职最后一个管理员")

    # 1) 终态学员（已报名/已过期/拒绝/无效）：只解绑，状态保留作为历史
    terminal_statuses = [
        StudentStatus.enrolled,
        StudentStatus.expired,
        StudentStatus.rejected,
        StudentStatus.invalid,
    ]
    preserved_q = await db.execute(
        select(func.count(Student.id)).where(
            Student.assigned_to == user_id,
            Student.status.in_(terminal_statuses),
        )
    )
    preserved_count = preserved_q.scalar() or 0
    await db.execute(
        update(Student)
        .where(
            Student.assigned_to == user_id,
            Student.status.in_(terminal_statuses),
        )
        .values(assigned_to=None, assigned_at=None)
    )

    # 2) 非终态学员：全部回收到池，清除阶段/意向，避免新话务员误以为是自己跟出来的
    recycled_q = await db.execute(
        select(func.count(Student.id)).where(Student.assigned_to == user_id)
    )
    recycled_count = recycled_q.scalar() or 0
    await db.execute(
        update(Student)
        .where(Student.assigned_to == user_id)
        .values(
            assigned_to=None,
            assigned_at=None,
            status=StudentStatus.not_contacted,
            intent_level=IntentLevel.none,
            stage=StudentStage.initial_contact,
            need_help=False,
        )
    )

    # 3) 禁用账号 + 撤销现有 token
    was_active = user.is_active
    user.is_active = False
    user.failed_login_attempts = 0
    user.locked_until = None
    invalidate_user_tokens(user)

    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="离职用户",
            content=(
                f"离职 {user.role} {user.username}({user.name})："
                f"回收非终态 {recycled_count} 条、保留终态 {preserved_count} 条"
                + ("" if was_active else "（账号原本已禁用）")
            ),
        )
    )
    await db.commit()
    return Response.ok({
        "user_id": user.id,
        "username": user.username,
        "recycled_count": recycled_count,
        "preserved_count": preserved_count,
        "was_already_disabled": not was_active,
    })


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
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="解锁用户",
            content=f"解锁 {user.username}",
        )
    )
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
    invalidate_user_tokens(user)
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="重置密码",
            content=f"重置 {user.username} 的密码",
        )
    )
    await db.commit()
    return Response.ok(
        {"new_password": new_password, "msg": f"用户 {user.name} 密码已重置为 {new_password}"}
    )


@router.get("/backups")
async def list_backups(
    current_user: User = Depends(require_admin),
):
    """列出已有备份文件。"""
    if not os.path.isdir(BACKUP_DIR):
        return Response.ok([])
    items = []
    ext = _get_backup_extension()
    for fname in os.listdir(BACKUP_DIR):
        if not (fname.startswith("crm_") and fname.endswith(ext)):
            continue
        fpath = os.path.join(BACKUP_DIR, fname)
        try:
            st = os.stat(fpath)
        except OSError:
            continue
        items.append(
            {
                "name": fname,
                "size": st.st_size,
                "modified_at": datetime.fromtimestamp(st.st_mtime).isoformat(),
            }
        )
    items.sort(key=lambda x: x["modified_at"], reverse=True)
    return Response.ok(items)


@router.post("/backups")
async def trigger_backup(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """手动触发一次数据库备份。"""
    await do_backup_async()
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="手动备份",
            content="管理员手动触发数据库备份",
        )
    )
    await db.commit()
    return Response.ok({"msg": "备份完成"})


@router.get("/backups/{name}")
async def download_backup(
    name: str,
    current_user: User = Depends(require_admin),
):
    """下载指定备份文件。"""
    # 双重防穿越：1) 文件名白名单 2) realpath 必须仍在 BACKUP_DIR 下
    ext = _get_backup_extension()
    if (
        not name.startswith("crm_")
        or not name.endswith(ext)
        or "/" in name
        or "\\" in name
        or ".." in name
    ):
        raise HTTPException(status_code=400, detail="非法的备份文件名")
    backup_root = os.path.realpath(BACKUP_DIR)
    fpath = os.path.realpath(os.path.join(BACKUP_DIR, name))
    if not fpath.startswith(backup_root + os.sep):
        raise HTTPException(status_code=400, detail="非法的备份路径")
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="备份文件不存在")
    return FileResponse(fpath, media_type="application/octet-stream", filename=name)


@router.post("/expire-check")
async def check_expired(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """标记过期学生：expired_at 已到期且最后活动早于到期日，且不在终态。"""
    today = date.today()
    today_dt = datetime(today.year, today.month, today.day)

    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    )

    result = await db.execute(
        select(Student, latest_activity_at.label("activity_at"))
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(
            Student.expired_at.isnot(None),
            Student.expired_at < today,
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.invalid,
                ]
            ),
            # 距离最后活动也已超出 expired_at；纯日期与 datetime 混比，
            # 用 today_dt 作为活动上限（即活动早于今天 00:00 视为不活跃）。
            latest_activity_at < today_dt,
        )
    )
    rows = result.all()
    count = 0
    for student, _activity_at in rows:
        student.status = StudentStatus.expired
        count += 1
    await db.commit()
    return Response.ok({"expired_count": count})


@router.get("/invalid-students")
async def list_invalid_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """列出所有标记为无效的线索，用于回收和重新分配"""
    query = (
        select(Student, User.name.label("agent_name"))
        .outerjoin(User, User.id == Student.assigned_to)
        .where(Student.status == StudentStatus.invalid)
        .order_by(Student.updated_at.desc())
    )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    rows = result.all()

    # 获取无效原因（从操作日志中提取）
    student_ids = [s.id for s, _ in rows]
    invalid_reasons = {}
    if student_ids:
        # 查询最近一次标记为无效的操作日志
        logs_result = await db.execute(
            select(OperationLog.target_student_id, OperationLog.note_content, OperationLog.created_at)
            .where(
                OperationLog.target_student_id.in_(student_ids),
                OperationLog.action == "修改状态",
                OperationLog.new_status == "无效",
            )
            .order_by(OperationLog.created_at.desc())
        )
        for sid, reason, _ in logs_result.all():
            if sid not in invalid_reasons and reason:
                invalid_reasons[sid] = reason

    data = [
        {
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "school_name": s.school_name,
            "guardian_phone": s.guardian_phone[-4:] if s.guardian_phone else "",
            "assigned_to": s.assigned_to,
            "agent_name": agent_name or "未分配",
            "invalid_reason": invalid_reasons.get(s.id, ""),
            "updated_at": str(s.updated_at),
            "case_no": s.case_no,
        }
        for s, agent_name in rows
    ]

    return Response.ok({
        "total": total,
        "page": page,
        "page_size": page_size,
        "list": data,
    })


class ReclaimStudentsReq(BaseModel):
    student_ids: list[int]
    agent_id: int


@router.post("/reclaim-students")
async def reclaim_invalid_students(
    body: ReclaimStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """回收无效线索并重新分配给话务员验证"""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    # 验证话务员存在且激活
    agent_result = await db.execute(select(User).where(User.id == body.agent_id, User.is_active))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        return Response.error(code=1, msg="话务员不存在或已禁用")

    # 查询要回收的学生，确保都是无效状态
    students_result = await db.execute(
        select(Student).where(Student.id.in_(body.student_ids))
    )
    students = students_result.scalars().all()

    if not students:
        return Response.error(code=1, msg="未找到指定的学生")

    # 检查是否都是无效状态
    non_invalid = [s for s in students if s.status != StudentStatus.invalid]
    if non_invalid:
        names = ", ".join([s.name for s in non_invalid[:3]])
        return Response.error(code=1, msg=f"部分学生不是无效状态，无法回收: {names}")

    # 回收：重置状态为未联系，重新分配
    now = utcnow()
    reclaimed_count = 0
    for student in students:
        old_agent_id = student.assigned_to
        student.status = StudentStatus.not_contacted
        student.assigned_to = body.agent_id
        student.assigned_at = now

        # 记录操作日志
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "回收无效线索",
                content=f"从话务员 {old_agent_id or '未分配'} 回收，重新分配给 {agent.name}（ID:{body.agent_id}）",
                old_status="无效",
                new_status="未联系",
            )
        )
        reclaimed_count += 1

    await db.commit()

    return Response.ok({
        "reclaimed_count": reclaimed_count,
        "agent_id": body.agent_id,
        "agent_name": agent.name,
    })
