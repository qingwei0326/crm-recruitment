from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_STUDENT_ASSIGN,
    ADMIN_PAGE_ACCOUNT_MANAGE,
    require_admin,
    require_page_permission,
    user_has_operation_permission,
)
from app.database import get_db
from app.expiry import build_last_activity_subquery
from app.models import IntentLevel, Student, User, UserRole
from app.schemas import Response, StaleReassignReq
from app.services.assignment_service import AssignmentTarget, apply_assignment_changes
from app.status_policy import canonical_status_value, status_detail_value
from app.task_stats import TERMINAL_STUDENT_STATUSES
from app.utils import make_batch_id, make_operation_log, utcnow

router = APIRouter(prefix="/api/admin", tags=["管理"])


def to_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


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
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
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
                "status": canonical_status_value(student.status),
                "status_detail": status_detail_value(student.status, student.status_detail),
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
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE)),
):
    last_activity = build_last_activity_subquery()
    last_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("last_activity_at")
    cutoff = utcnow() - timedelta(days=days)
    stale_filters = [Student.status.not_in(TERMINAL_STUDENT_STATUSES)]

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
                "status": canonical_status_value(student.status),
                "status_detail": status_detail_value(student.status, student.status_detail),
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
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
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
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            last_activity_at < cutoff,
        )
    )
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg="没有可回收的超时学员")

    now = utcnow()
    batch_id = make_batch_id("stale-recycle")
    await apply_assignment_changes(
        db,
        [AssignmentTarget(student_id=student.id, agent_id=None) for student in students],
        operator=current_user,
        reason="stale_recycle",
        batch_id=batch_id,
        at=now,
    )
    reclaimed_count = len(students)
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="超时线索回收汇总",
            content=(
                f"按{('学校' if body.group_by == 'school_name' else '区域')}"
                f"回收「{body.group_name}」共 {reclaimed_count} 人至未分配池"
            ),
            batch_id=batch_id,
        )
    )

    await db.commit()
    return Response.ok({"reclaimed_count": reclaimed_count, "group_name": body.group_name})


@router.post("/stale-reassign")
async def stale_reassign(
    body: StaleReassignReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE)),
):
    if not user_has_operation_permission(current_user, ADMIN_OP_STUDENT_ASSIGN):
        raise HTTPException(status_code=403, detail="无权分配学生")
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")
    student_ids = list(dict.fromkeys(body.student_ids))

    students_result = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="没有可回收的线索")

    now = utcnow()
    batch_id = make_batch_id("stale-reassign")
    distribution: dict[str, int] = {}
    target_by_student_id: dict[int, int | None] = {}

    if body.mode == "recycle":
        for student in students:
            target_by_student_id[student.id] = None
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
            target_by_student_id[student.id] = agent.id
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
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
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
            target_by_student_id[student.id] = agent_id
            load[agent_id] += 1
            distribution[agent.name] += 1

    log_content = "回收到总名单" if body.mode == "recycle" else "超时未跟进，重新分配"
    await apply_assignment_changes(
        db,
        [
            AssignmentTarget(
                student_id=student.id,
                agent_id=target_by_student_id[student.id],
            )
            for student in students
        ],
        operator=current_user,
        reason="stale_recycle" if body.mode == "recycle" else "stale_reassign",
        batch_id=batch_id,
        at=now,
    )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="超时线索处理汇总",
            content=f"{log_content}，共 {len(students)} 人",
            batch_id=batch_id,
        )
    )

    await db.commit()
    return Response.ok({"reassigned_count": len(students), "distribution": distribution})
