import secrets
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_config import SCORE_DAILY_CALL_TARGET_MAX
from app.agent_score import score_agent_work
from app.auth import (
    ADMIN_OP_USER_CREATE,
    ADMIN_OP_USER_DELETE,
    ADMIN_OP_USER_EDIT,
    ADMIN_OP_USER_OFFBOARD,
    ADMIN_OP_USER_RESET_PASSWORD,
    ADMIN_OP_USER_UNLOCK,
    ADMIN_PAGE_ACCOUNT_MANAGE,
    ADMIN_PAGE_AUDIT_LOGS,
    ADMIN_PAGE_SCORE_PREVIEW,
    hash_password,
    invalidate_user_tokens,
    normalize_operation_permissions,
    normalize_page_permissions,
    operation_permissions_to_storage,
    page_permissions_to_storage,
    require_admin,
    require_any_page_permission,
    require_operation_permission,
    require_page_permission,
    user_has_operation_permission,
)
from app.database import get_db
from app.models import (
    DialLog,
    FollowUp,
    IntentLevel,
    LeadViewLog,
    Note,
    Student,
    StudentStage,
    StudentStatus,
    User,
    UserRole,
)
from app.routers.admin import get_config_value
from app.schemas import Response
from app.status_policy import canonical_status_value, status_detail_value
from app.task_stats import ACTIVE_TASK_STATUSES, TERMINAL_STUDENT_STATUSES, build_task_stats
from app.utils import make_operation_log, today_cst_as_utc, utcnow

router = APIRouter(prefix="/api/admin", tags=["管理"])


class UserCreateReq(BaseModel):
    username: str
    password: str
    name: str
    role: Literal["admin", "agent"] = "agent"
    is_super_admin: bool = False
    service_regions: str = ""
    page_permissions: list[str] = []
    operation_permissions: list[str] = []


class UserUpdateReq(BaseModel):
    name: str | None = None
    role: Literal["admin", "agent"] | None = None
    is_active: bool | None = None
    is_super_admin: bool | None = None
    password: str | None = None
    service_regions: str | None = None
    page_permissions: list[str] | None = None
    operation_permissions: list[str] | None = None


RESERVED_USER_DISPLAY_NAMES = {"离职", "已离职", "禁用", "停用", "启用"}


def _clean_user_display_name(value: str) -> str:
    return (value or "").strip()


def _validate_user_display_name(value: str) -> str | None:
    name = _clean_user_display_name(value)
    if not name:
        return "姓名不能为空"
    if name in RESERVED_USER_DISPLAY_NAMES:
        return "姓名不能填写离职、禁用等状态词；请填写真实姓名"
    return None

async def count_active_super_admins(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count(User.id)).where(
            User.role == UserRole.admin,
            User.is_active,
            User.is_super_admin,
        )
    )
    return result.scalar() or 0


@router.get("/agents")
async def list_agents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(User).where(User.role == UserRole.agent, User.is_active).order_by(User.id)
    )
    agents = result.scalars().all()
    if not agents:
        return Response.ok([])

    agent_ids = [a.id for a in agents]
    today = today_cst_as_utc()

    # 合并学生统计：总线索 + 各状态计数一次查询，任务口径由 app.task_stats 统一解释。
    stats_r = await db.execute(
        select(
            Student.assigned_to,
            Student.status,
            func.count().label("count"),
        )
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to, Student.status)
    )
    status_counts_by_agent: dict[int, dict[StudentStatus, int]] = {}
    total_leads_by_agent: dict[int, int] = {}
    for row in stats_r.all():
        status_counts_by_agent.setdefault(row.assigned_to, {})[row.status] = int(row.count or 0)
        total_leads_by_agent[row.assigned_to] = total_leads_by_agent.get(row.assigned_to, 0) + int(
            row.count or 0
        )

    # 今日呼出数：拨号动作写入 DialLog，未做 AI 分析也要计入。
    today_calls_r = await db.execute(
        select(DialLog.agent_id, func.count(DialLog.id))
        .where(DialLog.agent_id.in_(agent_ids), DialLog.dialed_at >= today)
        .group_by(DialLog.agent_id)
    )
    today_calls_map = dict(today_calls_r.all())

    data = []
    for a in agents:
        task_stats = build_task_stats(status_counts_by_agent.get(a.id, {}))
        data.append(
            {
                "id": a.id,
                "name": a.name,
                "username": a.username,
                "is_active": a.is_active,
                "is_super_admin": a.is_super_admin,
                "service_regions": a.service_regions,
                "total_tasks": task_stats["total"],
                "done_tasks": task_stats["done"],
                "pending_tasks": task_stats["pending"],
                "follow_up_tasks": task_stats["follow_up"],
                "total_leads": total_leads_by_agent.get(a.id, 0),
                "today_calls": int(today_calls_map.get(a.id, 0)),
                "locked_until": str(a.locked_until) if a.locked_until else None,
                "failed_login_attempts": a.failed_login_attempts,
                "created_at": str(a.created_at),
            }
        )

    return Response.ok(data)


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_any_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE, ADMIN_PAGE_AUDIT_LOGS)
    ),
):
    result = await db.execute(
        select(User).where(User.role.in_([UserRole.admin, UserRole.agent])).order_by(User.id)
    )
    users = result.scalars().all()
    if not users:
        return Response.ok([])

    agent_ids = [user.id for user in users if user.role == UserRole.agent]
    status_counts_by_agent: dict[int, dict[StudentStatus, int]] = {}
    total_leads_by_agent: dict[int, int] = {}
    today_calls_map: dict[int, int] = {}
    if agent_ids:
        today = today_cst_as_utc()
        stats_r = await db.execute(
            select(
                Student.assigned_to,
                Student.status,
                func.count().label("count"),
            )
            .where(Student.assigned_to.in_(agent_ids))
            .group_by(Student.assigned_to, Student.status)
        )
        for row in stats_r.all():
            status_counts_by_agent.setdefault(row.assigned_to, {})[row.status] = int(row.count or 0)
            total_leads_by_agent[row.assigned_to] = total_leads_by_agent.get(
                row.assigned_to, 0
            ) + int(row.count or 0)

        today_calls_r = await db.execute(
            select(DialLog.agent_id, func.count(DialLog.id))
            .where(DialLog.agent_id.in_(agent_ids), DialLog.dialed_at >= today)
            .group_by(DialLog.agent_id)
        )
        today_calls_map = dict(today_calls_r.all())

    data = []
    for user in users:
        task_stats = build_task_stats(status_counts_by_agent.get(user.id, {}))
        data.append(
            {
                "id": user.id,
                "name": user.name,
                "username": user.username,
                "role": user.role,
                "is_active": user.is_active,
                "is_super_admin": user.is_super_admin,
                "page_permissions": normalize_page_permissions(user.page_permissions),
                "operation_permissions": normalize_operation_permissions(
                    user.operation_permissions
                ),
                "service_regions": user.service_regions,
                "total_tasks": task_stats["total"] if user.role == UserRole.agent else 0,
                "done_tasks": task_stats["done"] if user.role == UserRole.agent else 0,
                "pending_tasks": task_stats["pending"] if user.role == UserRole.agent else 0,
                "follow_up_tasks": task_stats["follow_up"] if user.role == UserRole.agent else 0,
                "total_leads": total_leads_by_agent.get(user.id, 0),
                "today_calls": int(today_calls_map.get(user.id, 0)),
                "locked_until": str(user.locked_until) if user.locked_until else None,
                "failed_login_attempts": user.failed_login_attempts,
                "created_at": str(user.created_at),
            }
        )

    return Response.ok(data)


@router.get("/agent-score-preview")
async def agent_score_preview(
    daily_call_target: int | None = Query(None, ge=1, le=SCORE_DAILY_CALL_TARGET_MAX),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_SCORE_PREVIEW)),
):
    """只读评分预览：聚合现有工作记录，不写库、不改变派单或话务流程。"""
    configured_call_target = int(await get_config_value(db, "score_daily_call_target", "30") or 30)
    effective_daily_call_target = daily_call_target or configured_call_target
    agents_r = await db.execute(
        select(User).where(User.role == UserRole.agent, User.is_active).order_by(User.id)
    )
    agents = agents_r.scalars().all()
    if not agents:
        return Response.ok(
            {
                "generated_at": str(utcnow()),
                "daily_call_target": effective_daily_call_target,
                "configured_daily_call_target": configured_call_target,
                "items": [],
            }
        )

    agent_ids = [agent.id for agent in agents]
    today = today_cst_as_utc()
    tomorrow = today + timedelta(days=1)

    status_counts_r = await db.execute(
        select(
            Student.assigned_to,
            Student.status,
            func.count(Student.id).label("count"),
        )
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to, Student.status)
    )
    status_counts_by_agent: dict[int, dict[StudentStatus, int]] = {}
    total_leads_by_agent: dict[int, int] = {}
    for row in status_counts_r.all():
        status_counts_by_agent.setdefault(row.assigned_to, {})[row.status] = int(row.count or 0)
        total_leads_by_agent[row.assigned_to] = total_leads_by_agent.get(row.assigned_to, 0) + int(
            row.count or 0
        )

    student_metrics_r = await db.execute(
        select(
            Student.assigned_to,
            func.count(Student.id)
            .filter(Student.status.not_in([StudentStatus.not_contacted, StudentStatus.invalid]))
            .label("contacted_count"),
            func.count(Student.id)
            .filter(Student.intent_level == IntentLevel.A)
            .label("a_level_count"),
            func.count(Student.id)
            .filter(Student.status == StudentStatus.enrolled)
            .label("enrolled_count"),
            func.count(Student.id)
            .filter(
                Student.status.in_(ACTIVE_TASK_STATUSES),
                Student.guardian_phone == "",
                Student.guardian2_phone == "",
            )
            .label("missing_phone_tasks"),
        )
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to)
    )
    student_metrics = {
        int(row.assigned_to): {
            "contacted_count": int(row.contacted_count or 0),
            "a_level_count": int(row.a_level_count or 0),
            "enrolled_count": int(row.enrolled_count or 0),
            "missing_phone_tasks": int(row.missing_phone_tasks or 0),
        }
        for row in student_metrics_r.all()
    }

    today_calls_r = await db.execute(
        select(
            DialLog.agent_id,
            func.count(DialLog.id).label("today_calls"),
            func.count(DialLog.id)
            .filter(DialLog.duration_seconds > 0)
            .label("today_recorded_calls"),
            func.count(DialLog.id)
            .filter(or_(DialLog.duration_seconds <= 0, DialLog.duration_seconds.is_(None)))
            .label("today_unrecorded_calls"),
            func.avg(DialLog.duration_seconds)
            .filter(DialLog.duration_seconds > 0)
            .label("avg_recorded_duration_seconds"),
        )
        .where(
            DialLog.agent_id.in_(agent_ids),
            DialLog.dialed_at >= today,
            DialLog.dialed_at < tomorrow,
        )
        .group_by(DialLog.agent_id)
    )
    today_call_metrics = {
        int(row.agent_id): {
            "today_calls": int(row.today_calls or 0),
            "today_recorded_calls": int(row.today_recorded_calls or 0),
            "today_unrecorded_calls": int(row.today_unrecorded_calls or 0),
            "avg_recorded_duration_seconds": round(row.avg_recorded_duration_seconds or 0, 1),
        }
        for row in today_calls_r.all()
    }

    follow_up_r = await db.execute(
        select(
            FollowUp.agent_id,
            func.count(FollowUp.id)
            .filter(FollowUp.is_completed.is_(False))
            .label("open_follow_ups"),
            func.count(FollowUp.id)
            .filter(
                FollowUp.is_completed.is_(False),
                FollowUp.follow_up_date < utcnow(),
            )
            .label("overdue_follow_ups"),
            func.count(FollowUp.id)
            .filter(
                FollowUp.is_completed.is_(False),
                FollowUp.follow_up_date >= today,
                FollowUp.follow_up_date < tomorrow,
            )
            .label("today_follow_ups"),
        )
        .where(FollowUp.agent_id.in_(agent_ids))
        .group_by(FollowUp.agent_id)
    )
    follow_up_metrics = {
        int(row.agent_id): {
            "open_follow_ups": int(row.open_follow_ups or 0),
            "overdue_follow_ups": int(row.overdue_follow_ups or 0),
            "today_follow_ups": int(row.today_follow_ups or 0),
        }
        for row in follow_up_r.all()
    }

    notes_today_r = await db.execute(
        select(Note.agent_id, func.count(Note.id))
        .where(
            Note.agent_id.in_(agent_ids),
            Note.created_at >= today,
            Note.created_at < tomorrow,
        )
        .group_by(Note.agent_id)
    )
    notes_today_map = {int(agent_id): int(count or 0) for agent_id, count in notes_today_r.all()}

    items = []
    for agent in agents:
        task_stats = build_task_stats(status_counts_by_agent.get(agent.id, {}))
        sm = student_metrics.get(agent.id, {})
        fm = follow_up_metrics.get(agent.id, {})
        active_tasks = int(task_stats["total"])
        missing_phone_tasks = int(sm.get("missing_phone_tasks", 0))
        call_metrics = today_call_metrics.get(
            agent.id,
            {
                "today_calls": 0,
                "today_recorded_calls": 0,
                "today_unrecorded_calls": 0,
                "avg_recorded_duration_seconds": 0,
            },
        )
        metrics = {
            "total_leads": total_leads_by_agent.get(agent.id, 0),
            "active_tasks": active_tasks,
            "done_tasks": int(task_stats["done"]),
            "pending_tasks": int(task_stats["pending"]),
            "follow_up_tasks": int(task_stats["follow_up"]),
            "progress_pct": float(task_stats["progress_pct"]),
            "today_calls": call_metrics["today_calls"],
            "today_recorded_calls": call_metrics["today_recorded_calls"],
            "today_unrecorded_calls": call_metrics["today_unrecorded_calls"],
            "avg_recorded_duration_seconds": call_metrics["avg_recorded_duration_seconds"],
            "open_follow_ups": int(fm.get("open_follow_ups", 0)),
            "overdue_follow_ups": int(fm.get("overdue_follow_ups", 0)),
            "today_follow_ups": int(fm.get("today_follow_ups", 0)),
            "contacted_count": int(sm.get("contacted_count", 0)),
            "a_level_count": int(sm.get("a_level_count", 0)),
            "enrolled_count": int(sm.get("enrolled_count", 0)),
            "notes_today": notes_today_map.get(agent.id, 0),
            "missing_phone_tasks": missing_phone_tasks,
            "data_completeness_pct": round(
                (active_tasks - missing_phone_tasks) / active_tasks * 100, 1
            )
            if active_tasks > 0
            else 100.0,
        }
        score = score_agent_work(
            metrics,
            daily_call_target=effective_daily_call_target,
        )
        items.append(
            {
                "agent": {
                    "id": agent.id,
                    "name": agent.name,
                    "username": agent.username,
                    "is_active": agent.is_active,
                    "service_regions": agent.service_regions,
                },
                "metrics": metrics,
                **score,
            }
        )

    items.sort(
        key=lambda item: (
            item["score"],
            -item["metrics"]["overdue_follow_ups"],
            item["agent"]["id"],
        )
    )
    return Response.ok(
        {
            "generated_at": str(utcnow()),
            "daily_call_target": effective_daily_call_target,
            "configured_daily_call_target": configured_call_target,
            "items": items,
        }
    )


@router.get("/agents/{agent_id}/tasks")
async def agent_tasks(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE)),
):
    agent_r = await db.execute(select(User).where(User.id == agent_id))
    agent = agent_r.scalar_one_or_none()
    if not agent:
        return Response.error(code=1, msg="话务员不存在")

    # 使用统一任务口径统计，避免管理员和话务员工作台数字漂移。
    stats_r = await db.execute(
        select(
            Student.status,
            func.count(Student.id).label("count"),
        )
        .where(Student.assigned_to == agent_id)
        .group_by(Student.status)
    )
    counts = {row.status: int(row.count or 0) for row in stats_r.all()}
    task_stats = build_task_stats(counts)
    total_leads = (
        await db.execute(select(func.count(Student.id)).where(Student.assigned_to == agent_id))
    ).scalar() or 0

    extra_stats_r = await db.execute(
        select(
            func.count(Student.id).filter(Student.intent_level == IntentLevel.A).label("a_level"),
        ).where(Student.assigned_to == agent_id)
    )
    extra_stats = extra_stats_r.one()
    a_level = int(extra_stats.a_level or 0)

    # 获取学生列表（仍需用于返回）
    students_r = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == agent_id,
            Student.status.in_(ACTIVE_TASK_STATUSES),
        )
        .order_by(Student.updated_at.desc())
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
                **task_stats,
                "a_level": a_level,
                "view_count": view_count,
                "total_leads": total_leads,
            },
            "list": [
                {
                    "id": s.id,
                    "name": s.name,
                    "region": s.region,
                    "status": canonical_status_value(s.status),
                    "status_detail": status_detail_value(s.status, s.status_detail),
                    "invalid_reason": status_detail_value(s.status, s.status_detail)
                    if canonical_status_value(s.status) == StudentStatus.invalid.value
                    else "",
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
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_CREATE)),
):
    if not current_user.is_super_admin and (
        body.role == "admin"
        or body.is_super_admin
        or body.page_permissions
        or body.operation_permissions
    ):
        raise HTTPException(status_code=403, detail="只有超级管理员可以创建管理员或授权")
    display_name_error = _validate_user_display_name(body.name)
    if display_name_error:
        return Response.error(code=1, msg=display_name_error)
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        return Response.error(code=1, msg=f"用户名 {body.username} 已存在")
    display_name = _clean_user_display_name(body.name)
    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        name=display_name,
        role=UserRole(body.role),
        service_regions=body.service_regions,
        is_active=True,
        is_super_admin=body.role == "admin" and body.is_super_admin,
        page_permissions=(
            ""
            if body.role != "admin" or body.is_super_admin
            else page_permissions_to_storage(body.page_permissions)
        ),
        operation_permissions=(
            ""
            if body.role != "admin" or body.is_super_admin
            else operation_permissions_to_storage(body.operation_permissions)
        ),
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
        {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "is_super_admin": user.is_super_admin,
            "page_permissions": normalize_page_permissions(user.page_permissions),
            "operation_permissions": normalize_operation_permissions(user.operation_permissions),
        }
    )


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_EDIT)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if not current_user.is_super_admin and (
        user.role == UserRole.admin
        or body.role == "admin"
        or body.is_super_admin is not None
        or body.page_permissions is not None
        or body.operation_permissions is not None
    ):
        raise HTTPException(status_code=403, detail="只有超级管理员可以调整管理员或权限")

    changes = []
    if body.name is not None:
        display_name_error = _validate_user_display_name(body.name)
        if display_name_error:
            return Response.error(code=1, msg=display_name_error)
        display_name = _clean_user_display_name(body.name)
        if display_name != user.name:
            changes.append(f"姓名 {user.name}→{display_name}")
            user.name = display_name
    if body.role is not None:
        new_role = UserRole(body.role)
        if new_role != user.role:
            # 防止把唯一一个 admin / super admin 降级
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
                if (
                    user.is_super_admin
                    and user.is_active
                    and await count_active_super_admins(db) <= 1
                ):
                    return Response.error(code=1, msg="系统至少需要保留一个超级管理员")
            changes.append(f"角色 {user.role}→{new_role}")
            user.role = new_role
            if new_role != UserRole.admin and user.is_super_admin:
                user.is_super_admin = False
                changes.append("取消超级管理员")
            if new_role != UserRole.admin and user.page_permissions:
                user.page_permissions = ""
                changes.append("清空页面权限")
            if new_role != UserRole.admin and user.operation_permissions:
                user.operation_permissions = ""
                changes.append("清空操作权限")
    if body.is_super_admin is not None and body.is_super_admin != user.is_super_admin:
        if body.is_super_admin and user.role != UserRole.admin:
            return Response.error(code=1, msg="只有管理员账号可以设为超级管理员")
        if not body.is_super_admin and user.is_super_admin and user.is_active:
            if await count_active_super_admins(db) <= 1:
                return Response.error(code=1, msg="系统至少需要保留一个超级管理员")
        user.is_super_admin = body.is_super_admin
        changes.append("设为超级管理员" if body.is_super_admin else "取消超级管理员")
    if body.page_permissions is not None:
        next_permissions = (
            ""
            if user.role != UserRole.admin or user.is_super_admin
            else page_permissions_to_storage(body.page_permissions)
        )
        if next_permissions != user.page_permissions:
            user.page_permissions = next_permissions
            changes.append("修改页面权限")
    if body.operation_permissions is not None:
        next_permissions = (
            ""
            if user.role != UserRole.admin or user.is_super_admin
            else operation_permissions_to_storage(body.operation_permissions)
        )
        if next_permissions != user.operation_permissions:
            user.operation_permissions = next_permissions
            changes.append("修改操作权限")
    if body.is_active is not None and body.is_active != user.is_active:
        # 防止把唯一一个 admin / super admin 停用
        if user.role == UserRole.admin and user.is_active and not body.is_active:
            admin_count = (
                await db.execute(
                    select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
                )
            ).scalar() or 0
            if admin_count <= 1:
                return Response.error(code=1, msg="不能停用最后一个管理员")
            if user.is_super_admin and await count_active_super_admins(db) <= 1:
                return Response.error(code=1, msg="不能停用最后一个超级管理员")
        changes.append("启用" if body.is_active else "停用")
        user.is_active = body.is_active
        # 禁用时立即撤销现有 token，防止账号被禁用后旧会话仍能访问
        if not body.is_active:
            invalidate_user_tokens(user)
    if body.service_regions is not None and body.service_regions != user.service_regions:
        changes.append("修改服务区域")
        user.service_regions = body.service_regions
    if body.password is not None:
        if not user_has_operation_permission(current_user, ADMIN_OP_USER_RESET_PASSWORD):
            raise HTTPException(status_code=403, detail="无权重置账号密码")
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
        {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "is_active": user.is_active,
            "is_super_admin": user.is_super_admin,
            "page_permissions": normalize_page_permissions(user.page_permissions),
            "operation_permissions": normalize_operation_permissions(user.operation_permissions),
        }
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_DELETE)),
):
    if user_id == current_user.id:
        return Response.error(code=1, msg="不能删除自己")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以删除管理员")
    # 防止删除最后一个 admin
    if user.role == UserRole.admin:
        admin_count = (
            await db.execute(
                select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
            )
        ).scalar() or 0
        if admin_count <= 1:
            return Response.error(code=1, msg="不能删除最后一个管理员")
        if user.is_super_admin and user.is_active and await count_active_super_admins(db) <= 1:
            return Response.error(code=1, msg="不能删除最后一个超级管理员")
    terminal_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to == user_id,
                Student.status.in_(TERMINAL_STUDENT_STATUSES),
            )
        )
    ).scalar() or 0
    non_terminal_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to == user_id,
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            )
        )
    ).scalar() or 0

    # 1) 先处理终态学员：只解绑话务员，保留状态作为历史归档
    await db.execute(
        update(Student)
        .where(
            Student.assigned_to == user_id,
            Student.status.in_(TERMINAL_STUDENT_STATUSES),
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
            status_detail="",
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
            content=(
                f"删除{user.role} {user.username}({user.name})："
                f"回收非终态 {non_terminal_count} 条、保留终态 {terminal_count} 条"
            ),
        )
    )
    await db.delete(user)
    await db.commit()
    return Response.ok(msg="已删除，该话务员的学生已回收至池")


@router.post("/users/{user_id}/offboard")
async def offboard_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_OFFBOARD)),
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
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以为管理员办理离职")

    # 防止把最后一个 admin 离职
    if user.role == UserRole.admin and user.is_active:
        admin_count = (
            await db.execute(
                select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
            )
        ).scalar() or 0
        if admin_count <= 1:
            return Response.error(code=1, msg="不能离职最后一个管理员")
        if user.is_super_admin and await count_active_super_admins(db) <= 1:
            return Response.error(code=1, msg="不能离职最后一个超级管理员")

    # 1) 终态学员（已报名/无效及旧无效类状态）：只解绑，状态保留作为历史
    terminal_statuses = TERMINAL_STUDENT_STATUSES
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
            status_detail="",
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
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_UNLOCK)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以解锁管理员")
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
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_RESET_PASSWORD)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以重置管理员密码")
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

