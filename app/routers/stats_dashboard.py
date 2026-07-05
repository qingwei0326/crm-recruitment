import asyncio
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ADMIN_PAGE_REPORT_CENTER, require_admin, require_page_permission
from app.database import get_db
from app.models import (
    DialLog,
    IntentLevel,
    OperationLog,
    Student,
    StudentStatus,
    User,
    UserRole,
    Visit,
    VisitStatus,
)
from app.routers.stats import _stage_stats_key
from app.schemas import Response
from app.status_policy import statuses_for_canonical
from app.task_stats import ACTIVE_TASK_STATUSES
from app.utils import today_cst_as_utc

router = APIRouter(prefix="/api/stats", tags=["统计"])


@router.get("/heatmap")
async def heatmap_data(
    start_date: str = Query(None),
    end_date: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_REPORT_CENTER)),
):
    """坐席工作量热力图：坐席 × 日期 的通话次数矩阵"""
    end = date.today()
    if end_date:
        end = date.fromisoformat(end_date)
    start = end - timedelta(days=29)
    if start_date:
        start = date.fromisoformat(start_date)

    first_day = datetime(start.year, start.month, start.day)
    last_day_end = datetime(end.year, end.month, end.day) + timedelta(days=1)

    call_agent_ids_r = await db.execute(
        select(DialLog.agent_id)
        .where(DialLog.dialed_at >= first_day, DialLog.dialed_at < last_day_end)
        .group_by(DialLog.agent_id)
    )
    agent_ids_with_calls = {int(agent_id) for (agent_id,) in call_agent_ids_r.all()}

    agent_filter = User.is_active
    if agent_ids_with_calls:
        agent_filter = or_(User.is_active, User.id.in_(agent_ids_with_calls))

    # 获取活跃坐席；禁用坐席只有在日期范围内有通话时保留历史数据。
    agents_r = await db.execute(
        select(User.id, User.name)
        .where(User.role == UserRole.agent, agent_filter)
        .order_by(User.name)
    )
    agent_rows = agents_r.all()
    agents = [{"id": aid, "name": name} for aid, name in agent_rows]

    # 构建日期列表
    days = []
    curr = start
    while curr <= end:
        days.append(curr)
        curr += timedelta(days=1)

    if not agents or not days:
        return Response.ok({"agents": [], "dates": [], "data": []})

    # 查询坐席 × 日期的通话次数
    calls_r = await db.execute(
        select(
            DialLog.agent_id,
            func.date(DialLog.dialed_at),
            func.count(DialLog.id),
        )
        .where(DialLog.dialed_at >= first_day, DialLog.dialed_at < last_day_end)
        .group_by(DialLog.agent_id, func.date(DialLog.dialed_at))
    )

    # 构建矩阵
    agent_id_to_idx = {a["id"]: i for i, a in enumerate(agents)}
    date_strs = [str(d) for d in days]
    date_to_idx = {d: i for i, d in enumerate(date_strs)}

    matrix = [[0] * len(date_strs) for _ in range(len(agents))]
    for agent_id, day_val, cnt in calls_r.all():
        day_str = str(day_val)
        if agent_id in agent_id_to_idx and day_str in date_to_idx:
            matrix[agent_id_to_idx[agent_id]][date_to_idx[day_str]] = int(cnt)

    return Response.ok(
        {
            "agents": [a["name"] for a in agents],
            "dates": date_strs,
            "data": matrix,
        }
    )


@router.get("/dashboard-summary")
async def dashboard_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """仪表盘首屏统计数字，一个接口替代多个独立请求。"""
    today = today_cst_as_utc()
    tomorrow = today + timedelta(days=1)

    # 总学生数
    total_students = (await db.execute(select(func.count(Student.id)))).scalar() or 0

    # 已联系（排除未联系和无效）
    contacted = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.status.not_in([StudentStatus.not_contacted, StudentStatus.invalid])
            )
        )
    ).scalar() or 0

    # A 级意向
    a_level = (
        await db.execute(
            select(func.count(Student.id)).where(Student.intent_level == IntentLevel.A)
        )
    ).scalar() or 0

    # 今日呼出（直接统计通话记录，不拉话务员列表）
    today_calls = (
        await db.execute(select(func.count(DialLog.id)).where(DialLog.dialed_at >= today))
    ).scalar() or 0

    available_unassigned = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to.is_(None),
                Student.status.in_(ACTIVE_TASK_STATUSES),
            )
        )
    ).scalar() or 0

    today_a = (
        await db.execute(
            select(func.count(func.distinct(OperationLog.target_student_id))).where(
                OperationLog.action.in_(["AI分析", "手动评级"]),
                OperationLog.new_status == "A",
                OperationLog.old_status != "A",
                OperationLog.created_at >= today,
                OperationLog.created_at < tomorrow,
            )
        )
    ).scalar() or 0

    # 已报名汇总
    enrolled_r = await db.execute(
        select(
            func.count(Student.id),
            func.coalesce(func.sum(Student.deposit), 0),
        ).where(Student.status == StudentStatus.enrolled)
    )
    enrolled_row = enrolled_r.one()
    enrolled_total = enrolled_row[0] or 0
    enrolled_deposit = int(enrolled_row[1] or 0)

    return Response.ok(
        {
            "total_students": total_students,
            "contacted": contacted,
            "a_level": a_level,
            "today_calls": today_calls,
            "available_unassigned": available_unassigned,
            "today_a": today_a,
            "enrolled_total": enrolled_total,
            "enrolled_deposit": enrolled_deposit,
        }
    )


@router.get("/dashboard-all")
async def dashboard_all(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """聚合仪表盘全部数据，单次请求替代多个独立接口。"""
    today = today_cst_as_utc()

    # ---- 定义各子查询协程 ----

    async def _summary():
        total_students = (await db.execute(select(func.count(Student.id)))).scalar() or 0
        contacted = (
            await db.execute(
                select(func.count(Student.id)).where(
                    Student.status.not_in([StudentStatus.not_contacted, StudentStatus.invalid])
                )
            )
        ).scalar() or 0
        a_level = (
            await db.execute(
                select(func.count(Student.id)).where(Student.intent_level == IntentLevel.A)
            )
        ).scalar() or 0
        today_calls = (
            await db.execute(select(func.count(DialLog.id)).where(DialLog.dialed_at >= today))
        ).scalar() or 0
        enrolled_r = await db.execute(
            select(
                func.count(Student.id),
                func.coalesce(func.sum(Student.deposit), 0),
            ).where(Student.status == StudentStatus.enrolled)
        )
        enrolled_row = enrolled_r.one()
        return {
            "total_students": total_students,
            "contacted": contacted,
            "a_level": a_level,
            "today_calls": today_calls,
            "enrolled_total": enrolled_row[0] or 0,
            "enrolled_deposit": int(enrolled_row[1] or 0),
        }

    async def _sources():
        rows = await db.execute(
            select(
                Student.region,
                func.count(Student.id),
                func.sum(
                    case(
                        (
                            Student.status.not_in(
                                [StudentStatus.not_contacted, StudentStatus.invalid]
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ),
                func.sum(case((Student.intent_level == IntentLevel.A, 1), else_=0)),
            )
            .where(Student.region != "")
            .group_by(Student.region)
        )
        return [
            {
                "source": region,
                "total": total,
                "contacted": int(contacted),
                "a_count": int(a_count),
                "conversion_rate": round(int(a_count) / total * 100, 1) if total > 0 else 0,
            }
            for region, total, contacted, a_count in rows.all()
        ]

    async def _stages():
        result = await db.execute(
            select(Student.stage, func.count(Student.id))
            .where(Student.status.not_in(statuses_for_canonical(StudentStatus.invalid)))
            .group_by(Student.stage)
        )
        by_stage = {}
        for stage, count in result.all():
            key = _stage_stats_key(stage)
            by_stage[key] = by_stage.get(key, 0) + count
        unassigned = (
            await db.execute(
                select(func.count(Student.id)).where(
                    Student.assigned_to.is_(None),
                    Student.status.not_in(statuses_for_canonical(StudentStatus.invalid)),
                )
            )
        ).scalar() or 0
        by_stage["未分配"] = unassigned
        return by_stage

    async def _funnel():
        total = (await db.execute(select(func.count(Student.id)))).scalar() or 0
        assigned = (
            await db.execute(select(func.count(Student.id)).where(Student.assigned_to.is_not(None)))
        ).scalar() or 0
        contacted = (
            await db.execute(
                select(func.count(Student.id)).where(
                    Student.status.not_in([StudentStatus.not_contacted, StudentStatus.invalid])
                )
            )
        ).scalar() or 0
        a_level = (
            await db.execute(
                select(func.count(Student.id)).where(Student.intent_level == IntentLevel.A)
            )
        ).scalar() or 0
        visited = (
            await db.execute(
                select(func.count(func.distinct(Visit.student_id))).where(
                    Visit.status == VisitStatus.completed
                )
            )
        ).scalar() or 0
        enrolled = (
            await db.execute(
                select(func.count(Student.id)).where(Student.status == StudentStatus.enrolled)
            )
        ).scalar() or 0
        invalid = (
            await db.execute(
                select(func.count(Student.id)).where(
                    Student.status.in_(statuses_for_canonical(StudentStatus.invalid))
                )
            )
        ).scalar() or 0
        return [
            {"name": "总线索", "value": total},
            {"name": "已分配", "value": assigned},
            {"name": "已联系", "value": contacted},
            {"name": "A 级意向", "value": a_level},
            {"name": "已到访", "value": visited},
            {"name": "已报名", "value": enrolled},
            {"name": "无效线索", "value": invalid},
        ]

    async def _notify_fails():
        result = await db.execute(
            select(func.count(OperationLog.id)).where(OperationLog.action == "通知失败")
        )
        return result.scalar() or 0

    async def _visits_summary():
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

        return {"by_type": by_type, "by_status": by_status, "by_region": by_region}

    # ---- 并发执行所有查询 ----
    summary, sources, stages, funnel, notify_fails, visits = await asyncio.gather(
        _summary(), _sources(), _stages(), _funnel(), _notify_fails(), _visits_summary()
    )

    return Response.ok(
        {
            "summary": summary,
            "sources": sources,
            "stages": stages,
            "funnel": funnel,
            "notify_fails": notify_fails,
            "visits": visits,
        }
    )
