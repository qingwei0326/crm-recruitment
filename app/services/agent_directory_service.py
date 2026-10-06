"""Agent / user directory listings and the per-agent task detail (read-only, no FastAPI)."""

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import normalize_operation_permissions, normalize_page_permissions
from app.domain_models import AgentEmployment
from app.models import DialLog, IntentLevel, LeadViewLog, Student, StudentStatus, User, UserRole
from app.services.user_errors import UserRequestError
from app.status_policy import canonical_status_value, status_detail_value
from app.task_stats import ACTIVE_TASK_STATUSES, build_task_stats
from app.utils import today_cst_as_utc


async def lead_stats_by_agent(
    db: AsyncSession, agent_ids: list[int]
) -> tuple[dict[int, dict[StudentStatus, int]], dict[int, int]]:
    """Per-agent lead counts by status, and their totals (one grouped query)."""
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
    return status_counts_by_agent, total_leads_by_agent


async def today_calls_by_agent(db: AsyncSession, agent_ids: list[int], today) -> dict[int, int]:
    """今日呼出数：拨号动作写入 DialLog，未做 AI 分析也要计入。"""
    today_calls_r = await db.execute(
        select(DialLog.agent_id, func.count(DialLog.id))
        .where(DialLog.agent_id.in_(agent_ids), DialLog.dialed_at >= today)
        .group_by(DialLog.agent_id)
    )
    return dict(today_calls_r.all())


async def list_agents(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(User, AgentEmployment)
        .join(AgentEmployment, AgentEmployment.user_id == User.id)
        .where(User.role == UserRole.agent, User.is_active)
        .order_by(User.id)
    )
    agent_rows = result.all()
    agents = [user for user, _employment in agent_rows]
    employment_by_user_id = {
        user.id: employment for user, employment in agent_rows
    }
    if not agents:
        return []

    agent_ids = [a.id for a in agents]
    today = today_cst_as_utc()

    # 合并学生统计：总线索 + 各状态计数一次查询，任务口径由 app.task_stats 统一解释。
    status_counts_by_agent, total_leads_by_agent = await lead_stats_by_agent(db, agent_ids)
    today_calls_map = await today_calls_by_agent(db, agent_ids, today)

    data = []
    for a in agents:
        employment = employment_by_user_id[a.id]
        task_stats = build_task_stats(status_counts_by_agent.get(a.id, {}))
        data.append(
            {
                "id": a.id,
                "name": a.name,
                "username": a.username,
                "is_active": a.is_active,
                "employment_status": employment.status.value,
                "employment_version": employment.version,
                "employment_status_changed_at": str(employment.status_changed_at),
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

    return data


async def list_users(db: AsyncSession) -> list[dict]:
    result = await db.execute(
        select(User, AgentEmployment)
        .join(AgentEmployment, AgentEmployment.user_id == User.id)
        .where(User.role.in_([UserRole.admin, UserRole.agent]))
        .order_by(User.id)
    )
    user_rows = result.all()
    users = [user for user, _employment in user_rows]
    employment_by_user_id = {
        user.id: employment for user, employment in user_rows
    }
    if not users:
        return []

    agent_ids = [user.id for user in users if user.role == UserRole.agent]
    status_counts_by_agent: dict[int, dict[StudentStatus, int]] = {}
    total_leads_by_agent: dict[int, int] = {}
    today_calls_map: dict[int, int] = {}
    if agent_ids:
        status_counts_by_agent, total_leads_by_agent = await lead_stats_by_agent(db, agent_ids)
        today_calls_map = await today_calls_by_agent(db, agent_ids, today_cst_as_utc())

    data = []
    for user in users:
        employment = employment_by_user_id[user.id]
        task_stats = build_task_stats(status_counts_by_agent.get(user.id, {}))
        data.append(
            {
                "id": user.id,
                "name": user.name,
                "username": user.username,
                "role": user.role,
                "is_active": user.is_active,
                "employment_status": employment.status.value,
                "employment_version": employment.version,
                "employment_status_changed_at": str(employment.status_changed_at),
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

    return data


async def agent_tasks(db: AsyncSession, agent_id: int) -> dict:
    agent_r = await db.execute(select(User).where(User.id == agent_id))
    agent = agent_r.scalar_one_or_none()
    if not agent:
        raise UserRequestError("话务员不存在")

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

    return {
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
