import os
import re
import secrets
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import hash_password, invalidate_user_tokens, require_admin
from app.backup import BACKUP_DIR, _get_backup_extension, do_backup_async
from app.database import get_db
from app.expiry import build_last_activity_subquery, mark_expired_students
from app.models import (
    Call,
    DialLog,
    FollowUp,
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
    Visit,
)
from app.schemas import Response, StaleReassignReq
from app.utils import make_operation_log, today_cst_as_utc, utcnow

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
    "ai_provider",
    "mimo_api_key",
    "mimo_base",
    "mimo_model",
    "ai_custom_api_key",
    "ai_custom_base",
    "ai_custom_model",
    "follow_up_window_minutes",
}

_AI_PROVIDERS = {"deepseek", "mimo", "custom"}
_AI_BASE_KEYS = {"mimo_base", "ai_custom_base"}
_AI_MODEL_KEYS = {"mimo_model", "ai_custom_model"}
_AI_GENERIC_KEY_KEYS = {"mimo_api_key", "ai_custom_api_key"}

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
    if key == "follow_up_window_minutes":
        try:
            n = int(value)
        except ValueError:
            return None, "follow_up_window_minutes must be an integer between 1 and 60"
        if not 1 <= n <= 60:
            return None, "follow_up_window_minutes must be an integer between 1 and 60"
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
    if key == "ai_provider":
        if value and value not in _AI_PROVIDERS:
            return None, "ai_provider 必须是 deepseek / mimo / custom 之一"
        return (value or "deepseek"), None
    if key in _AI_BASE_KEYS:
        if value and not (value.startswith("http://") or value.startswith("https://")):
            return None, f"{key} 必须是 http(s):// 开头的接口地址"
        if len(value) > 256:
            return None, f"{key} too long"
        return value, None
    if key in _AI_MODEL_KEYS:
        if len(value) > 64:
            return None, f"{key} too long"
        return value, None
    if key in _AI_GENERIC_KEY_KEYS:
        # MiMo / 自定义 的 key 不强制 sk- 前缀，只做长度上限
        if len(value) > 256:
            return None, f"{key} too long"
        return value, None
    return value, None


def to_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


def mask_config_value(key: str, value: str) -> str:
    if (
        key in ("pushplus_token", "deepseek_api_key", "mimo_api_key", "ai_custom_api_key")
        and len(value) > 4
    ):
        return "****" + value[-4:]
    return value


async def get_config_value(db: AsyncSession, key: str, fallback: str = "") -> str:
    """Read SystemConfig, then same-name uppercase env var, then fallback."""
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
                "status": student.status.value,
                "stage": student.stage.value,
                "intent_level": student.intent_level.value,
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
                "intent_level": student.intent_level.value,
                "status": student.status.value,
                "agent_name": agent_name,
                "assigned_at": student.assigned_at.isoformat() if student.assigned_at else None,
                "last_activity_at": activity_at.isoformat() if activity_at else None,
            }
        )

    return Response.ok(data)


@router.get("/stale-school-groups")
async def stale_school_groups(
    days: int = Query(3, ge=1, le=30),
    group_by: str = Query("school_name"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校或区域聚合超时未跟进的学员数量"""
    last_activity = build_last_activity_subquery()
    last_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("last_activity_at")
    cutoff = utcnow() - timedelta(days=days)

    group_col = Student.school_name if group_by == "school_name" else Student.region

    result = await db.execute(
        select(group_col, func.count())
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(
            Student.assigned_to.isnot(None),
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.invalid,
                ]
            ),
            last_activity_at < cutoff,
        )
        .group_by(group_col)
        .order_by(func.count().desc())
    )
    groups = [{"name": name or "未知", "count": cnt} for name, cnt in result.all()]
    total = sum(g["count"] for g in groups)
    return Response.ok({"groups": groups, "total": total})


class StaleReclaimByGroupReq(BaseModel):
    group_name: str
    group_by: Literal["school_name", "region"] = "school_name"
    days: int = 3


@router.post("/stale-reclaim-by-group")
async def stale_reclaim_by_group(
    body: StaleReclaimByGroupReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校或区域一键回收超时学员 → assigned_to=null"""
    last_activity = build_last_activity_subquery()
    last_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("last_activity_at")
    cutoff = utcnow() - timedelta(days=body.days)

    group_col = Student.school_name if body.group_by == "school_name" else Student.region

    result = await db.execute(
        select(Student)
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(
            group_col == body.group_name,
            Student.assigned_to.isnot(None),
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.invalid,
                ]
            ),
            last_activity_at < cutoff,
        )
    )
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg="没有可回收的超时学员")

    reclaimed_count = 0
    for s in students:
        old_agent_id = s.assigned_to
        s.assigned_to = None
        s.assigned_at = None
        db.add(
            OperationLog(
                operator_id=current_user.id,
                operator_name=current_user.name,
                target_student_id=s.id,
                case_no=s.case_no or "",
                action="线索回收",
                content=(
                    f"按{('学校' if body.group_by == 'school_name' else '区域')}"
                    f"回收「{body.group_name}」，从话务员 "
                    f"{old_agent_id or '未分配'} 回收至未分配池"
                ),
            )
        )
        reclaimed_count += 1

    await db.commit()
    return Response.ok({"reclaimed_count": reclaimed_count, "group_name": body.group_name})


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

        # 一次查询获取所有 agent 的当前负载
        load_r = await db.execute(
            select(Student.assigned_to, func.count(Student.id))
            .where(
                Student.assigned_to.in_([a.id for a in agents]),
                Student.status.not_in(
                    [
                        StudentStatus.enrolled,
                        StudentStatus.expired,
                        StudentStatus.rejected,
                        StudentStatus.invalid,
                    ]
                ),
            )
            .group_by(Student.assigned_to)
        )
        load = {aid: cnt for aid, cnt in load_r.all()}
        for agent in agents:
            load.setdefault(agent.id, 0)
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

    # 合并学生统计：total + done + pending 一次查询
    _DONE_STATUSES = [
        StudentStatus.contacted,
        StudentStatus.pending_visit,
        StudentStatus.completed,
        StudentStatus.enrolled,
        StudentStatus.very_interested,
        StudentStatus.interested_add_wechat,
        StudentStatus.high_score,
        StudentStatus.not_interested,
        StudentStatus.child_not_want_study,
    ]
    stats_r = await db.execute(
        select(
            Student.assigned_to,
            func.count().label("total"),
            func.count()
            .filter(Student.status.in_(_DONE_STATUSES))
            .label("done"),
            func.count().filter(Student.status == StudentStatus.not_contacted).label("pending"),
        )
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to)
    )
    stats_map = {row.assigned_to: row for row in stats_r.all()}

    # 今日通话数
    today_calls_r = await db.execute(
        select(Call.agent_id, func.count(Call.id))
        .where(Call.agent_id.in_(agent_ids), Call.created_at >= today)
        .group_by(Call.agent_id)
    )
    today_calls_map = dict(today_calls_r.all())

    data = []
    for a in agents:
        s = stats_map.get(a.id)
        data.append(
            {
                "id": a.id,
                "name": a.name,
                "username": a.username,
                "is_active": a.is_active,
                "service_regions": a.service_regions,
                "total_tasks": int(s.total if s else 0),
                "done_tasks": int(s.done if s else 0),
                "pending_tasks": int(s.pending if s else 0),
                "today_calls": int(today_calls_map.get(a.id, 0)),
                "locked_until": str(a.locked_until) if a.locked_until else None,
                "failed_login_attempts": a.failed_login_attempts,
                "created_at": str(a.created_at),
            }
        )

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

    # 使用 SQL 聚合查询替代 Python 内存计算
    stats_r = await db.execute(
        select(
            func.count(Student.id).label("total"),
            func.count(Student.id).filter(
                Student.status.in_([StudentStatus.completed, StudentStatus.enrolled])
            ).label("done"),
            func.count(Student.id).filter(
                Student.status == StudentStatus.not_contacted
            ).label("pending"),
            func.count(Student.id).filter(
                Student.status == StudentStatus.pending_visit
            ).label("follow_up"),
            func.count(Student.id).filter(
                Student.intent_level == IntentLevel.A
            ).label("a_level"),
        ).where(Student.assigned_to == agent_id)
    )
    stats = stats_r.one()
    total, done, pending, follow_up, a_level = (
        int(stats.total or 0),
        int(stats.done or 0),
        int(stats.pending or 0),
        int(stats.follow_up or 0),
        int(stats.a_level or 0),
    )

    # 获取学生列表（仍需用于返回）
    students_r = await db.execute(
        select(Student).where(Student.assigned_to == agent_id).order_by(Student.updated_at.desc())
    )
    students = students_r.scalars().all()

    # 批量查询 view_count
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
                    "status": s.status.value,
                    "stage": s.stage.value,
                    "intent_level": s.intent_level.value,
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
        # 新建话务员：首次登录强制本人改密；管理员账号不强制
        must_change_password=(UserRole(body.role) == UserRole.agent),
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
                admin_count = (
                    await db.execute(
                        select(func.count(User.id)).where(
                            User.role == UserRole.admin, User.is_active
                        )
                    )
                ).scalar() or 0
                if admin_count <= 1:
                    return Response.error(code=1, msg="系统至少需要保留一个管理员")
            changes.append(f"角色 {user.role}→{new_role}")
            user.role = new_role
    if body.is_active is not None and body.is_active != user.is_active:
        # 防止把唯一一个 admin 停用
        if user.role == UserRole.admin and user.is_active and not body.is_active:
            admin_count = (
                await db.execute(
                    select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
                )
            ).scalar() or 0
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
        admin_count = (
            await db.execute(
                select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
            )
        ).scalar() or 0
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
        admin_count = (
            await db.execute(
                select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
            )
        ).scalar() or 0
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
    return Response.ok(
        {
            "user_id": user.id,
            "username": user.username,
            "recycled_count": recycled_count,
            "preserved_count": preserved_count,
            "was_already_disabled": not was_active,
        }
    )


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
    # 重置后强制本人下次登录改密
    user.must_change_password = True
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
    """标记过期学生：expired_at 已到期且最后活动早于到期日，且不在终态。

    判定逻辑抽到 app.expiry.mark_expired_students，与 scheduler 自动标记共用。
    """
    count = await mark_expired_students(db)
    await db.commit()
    return Response.ok({"expired_count": count})


@router.get("/invalid-students")
async def list_invalid_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    school_name: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """列出所有标记为无效的线索，用于回收和重新分配"""
    where = [Student.status == StudentStatus.invalid]
    if school_name:
        where.append(Student.school_name == school_name)

    query = (
        select(Student, User.name.label("agent_name"))
        .outerjoin(User, User.id == Student.assigned_to)
        .where(*where)
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
            select(
                OperationLog.target_student_id, OperationLog.note_content, OperationLog.created_at
            )
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
            "guardian_phone": s.guardian_phone or "",
            "assigned_to": s.assigned_to,
            "agent_name": agent_name or "未分配",
            "invalid_reason": invalid_reasons.get(s.id, ""),
            "updated_at": str(s.updated_at),
            "case_no": s.case_no,
        }
        for s, agent_name in rows
    ]

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "list": data,
        }
    )


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
    students_result = await db.execute(select(Student).where(Student.id.in_(body.student_ids)))
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
        # 与 delete_user/offboard 的回收契约保持一致：重置意向/阶段/求助，
        # 否则新话务员会看到旧的意向 A、阶段「已来访」，误以为是自己跟出来的，
        # 同时污染漏斗/转化统计。
        student.intent_level = IntentLevel.none
        student.stage = StudentStage.initial_contact
        student.need_help = False
        student.assigned_to = body.agent_id
        student.assigned_at = now

        # 记录操作日志
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "回收无效线索",
                content=(
                    f"从话务员 {old_agent_id or '未分配'} 回收，"
                    f"重新分配给 {agent.name}（ID:{body.agent_id}）"
                ),
                old_status="无效",
                new_status="未联系",
            )
        )
        reclaimed_count += 1

    await db.commit()

    return Response.ok(
        {
            "reclaimed_count": reclaimed_count,
            "agent_id": body.agent_id,
            "agent_name": agent.name,
        }
    )


# ── 分学校回收 ──────────────────────────────────────────────


class ReclaimBySchoolReq(BaseModel):
    school_name: str


@router.post("/reclaim-by-school")
async def reclaim_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校一键回收无效线索 → assigned_to=null（未分配池）"""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")

    # 查出该校所有无效学员
    result = await db.execute(
        select(Student).where(
            Student.school_name == body.school_name,
            Student.status == StudentStatus.invalid,
        )
    )
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可回收的无效线索")

    reclaimed_count = 0
    for s in students:
        old_agent_id = s.assigned_to
        s.status = StudentStatus.not_contacted
        # 与回收契约一致：进池前清除意向/阶段/求助
        s.intent_level = IntentLevel.none
        s.stage = StudentStage.initial_contact
        s.need_help = False
        s.assigned_to = None
        s.assigned_at = None

        db.add(
            make_operation_log(
                current_user,
                s.id,
                s.case_no or "",
                "分学校回收",
                content=f"从话务员 {old_agent_id or '未分配'} 回收，进入未分配池",
                old_status="无效",
                new_status="未联系",
            )
        )
        reclaimed_count += 1

    await db.commit()

    return Response.ok(
        {
            "reclaimed_count": reclaimed_count,
            "school_name": body.school_name,
        }
    )


@router.post("/delete-by-school")
async def delete_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校批量删除无效线索（含关联的通话/备注/回访/到访/日志）"""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")

    result = await db.execute(
        select(Student).where(
            Student.school_name == body.school_name,
            Student.status == StudentStatus.invalid,
        )
    )
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可删除的无效线索")

    deleted_count = 0
    for s in students:
        db.add(
            make_operation_log(
                current_user,
                s.id,
                s.case_no or "",
                "批量删除无效线索",
                content=f"删除学生 {s.name}（含通话/备注/回访/到访/日志）",
            )
        )
        for model in (Call, Note, FollowUp, LeadViewLog, Visit, DialLog):
            await db.execute(delete(model).where(model.student_id == s.id))
        await db.delete(s)
        deleted_count += 1

    await db.commit()

    return Response.ok(
        {
            "deleted_count": deleted_count,
            "school_name": body.school_name,
        }
    )


@router.get("/invalid-school-groups")
async def invalid_school_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校聚合无效线索数量"""
    result = await db.execute(
        select(Student.school_name, func.count())
        .where(Student.status == StudentStatus.invalid)
        .group_by(Student.school_name)
        .order_by(func.count().desc())
    )
    groups = [{"name": name or "未知学校", "count": cnt} for name, cnt in result.all()]
    return Response.ok({"groups": groups})


# ── 多学校分发 ──────────────────────────────────────────────


@router.get("/unassigned-school-groups")
async def unassigned_school_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校聚合未分配（assigned_to=null）且未完成的学员数量"""
    result = await db.execute(
        select(Student.school_name, func.count())
        .where(
            Student.assigned_to.is_(None),
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.invalid,
                ]
            ),
        )
        .group_by(Student.school_name)
        .order_by(func.count().desc())
    )
    groups = [{"name": name or "未知学校", "count": cnt} for name, cnt in result.all()]
    total = sum(g["count"] for g in groups)
    return Response.ok({"groups": groups, "total": total})


class DistributeBySchoolsReq(BaseModel):
    school_names: list[str]
    mode: Literal["auto", "manual"] = "auto"
    agent_id: int | None = None


@router.post("/distribute-by-schools")
async def distribute_by_schools(
    body: DistributeBySchoolsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校批量分发未分配学员给话务员"""
    if not body.school_names:
        return Response.error(code=1, msg="school_names不能为空")

    # 查出所有目标学校的未分配学员
    where = [
        Student.school_name.in_(body.school_names),
        Student.assigned_to.is_(None),
        Student.status.not_in(
            [
                StudentStatus.enrolled,
                StudentStatus.expired,
                StudentStatus.rejected,
                StudentStatus.invalid,
            ]
        ),
    ]
    result = await db.execute(select(Student).where(*where))
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg="所选学校没有可分配的学员")

    now = utcnow()
    distribution: dict[str, int] = {}

    if body.mode == "manual":
        if body.agent_id is None:
            return Response.error(code=1, msg="manual模式需要agent_id")
        agent_result = await db.execute(
            select(User).where(
                User.id == body.agent_id, User.is_active, User.role == UserRole.agent
            )
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            return Response.error(code=1, msg="话务员不存在或已禁用")
        for s in students:
            s.assigned_to = agent.id
            s.assigned_at = now
        distribution[agent.name] = len(students)
    else:
        # auto: 按当前负载均匀分配
        agent_result = await db.execute(
            select(User).where(User.is_active, User.role == UserRole.agent).order_by(User.id)
        )
        agents = agent_result.scalars().all()
        if not agents:
            return Response.error(code=1, msg="没有可用的话务员")

        load_r = await db.execute(
            select(Student.assigned_to, func.count(Student.id))
            .where(
                Student.assigned_to.in_([a.id for a in agents]),
                Student.status.not_in(
                    [
                        StudentStatus.enrolled,
                        StudentStatus.expired,
                        StudentStatus.rejected,
                        StudentStatus.invalid,
                    ]
                ),
            )
            .group_by(Student.assigned_to)
        )
        load = {aid: cnt for aid, cnt in load_r.all()}
        for agent in agents:
            load.setdefault(agent.id, 0)
            distribution[agent.name] = 0
        agent_map = {agent.id: agent for agent in agents}

        for s in sorted(students, key=lambda item: item.id):
            agent_id = min(load, key=load.get)
            s.assigned_to = agent_id
            s.assigned_at = now
            load[agent_id] += 1
            distribution[agent_map[agent_id].name] += 1

    for s in students:
        db.add(
            OperationLog(
                operator_id=current_user.id,
                operator_name=current_user.name,
                target_student_id=s.id,
                case_no=s.case_no or "",
                action="多学校分发",
                content=f"从学校「{s.school_name}」分发给话务员",
            )
        )

    await db.commit()
    return Response.ok(
        {
            "distributed_count": len(students),
            "distribution": distribution,
            "schools": body.school_names,
        }
    )


@router.get("/operation-logs")
async def count_operation_logs(
    action: str | None = None,
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """统计近 N 天 OperationLog 数量（按 action 过滤）。"""
    cutoff = utcnow() - timedelta(days=days)
    q = select(func.count()).select_from(OperationLog).where(OperationLog.created_at >= cutoff)
    if action:
        q = q.where(OperationLog.action == action)
    total = (await db.execute(q)).scalar_one()
    return Response.ok({"total": total})


class ErrorReport(BaseModel):
    type: str
    message: str
    stack: str = ""
    url: str = ""
    user_agent: str = ""


@router.post("/error-report")
async def report_frontend_error(
    body: ErrorReport,
    db: AsyncSession = Depends(get_db),
):
    """接收前端错误报告，记录到 OperationLog。"""
    content = f"[{body.type}] {body.message}"
    if body.stack:
        content += f"\n{body.stack[:500]}"
    if body.url:
        content += f"\nURL: {body.url}"

    db.add(
        OperationLog(
            operator_id=None,
            operator_name="前端",
            action="前端错误",
            content=content[:1000],
        )
    )
    await db.commit()
    return Response.ok({"msg": "已记录"})
