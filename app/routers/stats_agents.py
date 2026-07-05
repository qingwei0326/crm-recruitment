from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ADMIN_PAGE_REPORT_CENTER, get_current_user, require_page_permission
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
    VisitType,
)
from app.schemas import Response
from app.utils import month_start_cst_as_utc, today_cst_as_utc, utcnow

router = APIRouter(prefix="/api/stats", tags=["统计"])


@router.get("/me")
async def my_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """坐席查看自己的业绩统计"""
    return await _get_agent_stats(current_user.id, db)


@router.get("/agent/{agent_id}")
async def agent_stats(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == UserRole.agent and agent_id != current_user.id:
        raise HTTPException(status_code=403, detail="无权查看其他坐席的统计")
    return await _get_agent_stats(agent_id, db)


async def _get_agent_stats(agent_id: int, db: AsyncSession):
    today = today_cst_as_utc()
    tomorrow = today + timedelta(days=1)
    month_start = month_start_cst_as_utc()

    # DialLog 统计：拨号次数统计全部记录，平均时长只统计已补写的正数时长。
    dial_r = await db.execute(
        select(
            func.count(DialLog.id)
            .filter(DialLog.dialed_at >= today, DialLog.dialed_at < tomorrow)
            .label("today_calls"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= today,
                DialLog.dialed_at < tomorrow,
                DialLog.duration_seconds > 0,
            )
            .label("today_recorded_calls"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= today,
                DialLog.dialed_at < tomorrow,
                or_(DialLog.duration_seconds <= 0, DialLog.duration_seconds.is_(None)),
            )
            .label("today_unrecorded_calls"),
            func.count(DialLog.id).label("month_calls"),
            func.count(DialLog.id)
            .filter(DialLog.duration_seconds > 0)
            .label("month_recorded_calls"),
            func.count(DialLog.id)
            .filter(or_(DialLog.duration_seconds <= 0, DialLog.duration_seconds.is_(None)))
            .label("month_unrecorded_calls"),
            func.avg(DialLog.duration_seconds)
            .filter(DialLog.duration_seconds > 0)
            .label("avg_duration"),
        ).where(
            DialLog.agent_id == agent_id,
            DialLog.dialed_at >= month_start,
        )
    )
    dial_row = dial_r.one()
    today_calls = int(dial_row.today_calls or 0)
    today_recorded_calls = int(dial_row.today_recorded_calls or 0)
    today_unrecorded_calls = int(dial_row.today_unrecorded_calls or 0)
    month_calls = int(dial_row.month_calls or 0)
    month_recorded_calls = int(dial_row.month_recorded_calls or 0)
    month_unrecorded_calls = int(dial_row.month_unrecorded_calls or 0)
    avg_duration = round(dial_row.avg_duration or 0, 1)

    # 合并意向统计：total_contacted + all_a 一次查询
    student_r = await db.execute(
        select(
            func.count()
            .filter(Student.status.not_in([StudentStatus.not_contacted, StudentStatus.invalid]))
            .label("total_contacted"),
            func.count().filter(Student.intent_level == IntentLevel.A).label("all_a"),
        ).where(Student.assigned_to == agent_id)
    )
    srow = student_r.one()
    total_contacted = srow.total_contacted or 0
    all_a = srow.all_a or 0
    conversion_rate = round(all_a / total_contacted * 100, 1) if total_contacted > 0 else 0

    # 合并"今日/本月新转 A"：基于 OperationLog 中意向变化记录
    a_log_r = await db.execute(
        select(
            func.count(func.distinct(OperationLog.target_student_id))
            .filter(OperationLog.created_at >= today, OperationLog.created_at < tomorrow)
            .label("today_a"),
            func.count(func.distinct(OperationLog.target_student_id)).label("month_a"),
        )
        .select_from(OperationLog)
        .join(Student, Student.id == OperationLog.target_student_id)
        .where(
            Student.assigned_to == agent_id,
            OperationLog.action.in_(["AI分析", "手动评级"]),
            OperationLog.new_status == "A",
            OperationLog.old_status != "A",
            OperationLog.created_at >= month_start,
        )
    )
    arow = a_log_r.one()
    today_a = arow.today_a or 0
    month_a = arow.month_a or 0

    return Response.ok(
        {
            "agent_id": agent_id,
            "today_calls": today_calls,
            "today_recorded_calls": today_recorded_calls,
            "today_unrecorded_calls": today_unrecorded_calls,
            "month_calls": month_calls,
            "month_recorded_calls": month_recorded_calls,
            "month_unrecorded_calls": month_unrecorded_calls,
            "recorded_calls": month_recorded_calls,
            "unrecorded_calls": month_unrecorded_calls,
            "today_a_count": today_a,
            "month_a_count": month_a,
            "conversion_rate": conversion_rate,
            "avg_duration_seconds": avg_duration,
        }
    )


@router.get("/agent-ranking")
async def agent_ranking(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_REPORT_CENTER)),
):
    today = today_cst_as_utc()
    month_start = month_start_cst_as_utc()

    agents_r = await db.execute(select(User).where(User.role == UserRole.agent))
    agents = agents_r.scalars().all()
    if not agents:
        return Response.ok({"ranking": [], "generated_at": str(utcnow())})
    agent_ids = [a.id for a in agents]

    # Student stats per agent (total, contacted, A, enrolled)
    student_stats_r = await db.execute(
        select(
            Student.assigned_to,
            func.count(Student.id),
            func.sum(
                case(
                    (
                        Student.status.not_in([StudentStatus.not_contacted, StudentStatus.invalid]),
                        1,
                    ),
                    else_=0,
                )
            ),
            func.sum(case((Student.intent_level == IntentLevel.A, 1), else_=0)),
            func.sum(case((Student.status == StudentStatus.enrolled, 1), else_=0)),
        )
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to)
    )
    s_map = {}
    for aid, total, contacted, a_cnt, enrolled in student_stats_r.all():
        s_map[aid] = {
            "total_leads": int(total),
            "contacted": int(contacted),
            "a_count": int(a_cnt),
            "enrolled": int(enrolled),
        }

    # Visit stats per agent (total, completed, campus, home)
    visit_stats_r = await db.execute(
        select(
            Visit.agent_id,
            func.count(Visit.id),
            func.sum(case((Visit.status == VisitStatus.completed, 1), else_=0)),
            func.sum(case((Visit.visit_type == VisitType.campus, 1), else_=0)),
            func.sum(case((Visit.visit_type == VisitType.home, 1), else_=0)),
        )
        .where(Visit.agent_id.in_(agent_ids))
        .group_by(Visit.agent_id)
    )
    v_map = {}
    for aid, total, done, campus, home in visit_stats_r.all():
        v_map[aid] = {
            "total_visits": int(total),
            "visits_done": int(done),
            "campus_visits": int(campus),
            "home_visits": int(home),
        }

    # Call stats per agent (today, month)
    today_calls_r = await db.execute(
        select(DialLog.agent_id, func.count(DialLog.id))
        .where(DialLog.agent_id.in_(agent_ids), DialLog.dialed_at >= today)
        .group_by(DialLog.agent_id)
    )
    today_calls_map = dict(today_calls_r.all())

    month_calls_r = await db.execute(
        select(DialLog.agent_id, func.count(DialLog.id))
        .where(DialLog.agent_id.in_(agent_ids), DialLog.dialed_at >= month_start)
        .group_by(DialLog.agent_id)
    )
    month_calls_map = dict(month_calls_r.all())

    ranking = []
    for a in agents:
        s = s_map.get(a.id, {})
        v = v_map.get(a.id, {})
        total_leads = s.get("total_leads", 0)
        contacted = s.get("contacted", 0)
        a_count = s.get("a_count", 0)
        enrolled = s.get("enrolled", 0)
        total_visits = v.get("total_visits", 0)
        visits_done = v.get("visits_done", 0)
        campus_visits = v.get("campus_visits", 0)
        home_visits = v.get("home_visits", 0)
        today_calls = int(today_calls_map.get(a.id, 0))
        month_calls = int(month_calls_map.get(a.id, 0))
        has_data = any(
            [
                total_leads,
                contacted,
                a_count,
                enrolled,
                total_visits,
                visits_done,
                today_calls,
                month_calls,
            ]
        )
        if not a.is_active and not has_data:
            continue
        conversion = round(a_count / contacted * 100, 1) if contacted > 0 else 0
        enroll_rate = round(enrolled / contacted * 100, 1) if contacted > 0 else 0
        a_to_enroll = round(enrolled / a_count * 100, 1) if a_count > 0 else 0
        ranking.append(
            {
                "id": a.id,
                "name": a.name,
                "is_active": a.is_active,
                "total_leads": total_leads,
                "contacted": contacted,
                "a_count": a_count,
                "enrolled": enrolled,
                "total_visits": total_visits,
                "visits_done": visits_done,
                "campus_visits": campus_visits,
                "home_visits": home_visits,
                "today_calls": today_calls,
                "month_calls": month_calls,
                "conversion_rate": conversion,
                "enroll_rate": enroll_rate,
                "a_to_enroll": a_to_enroll,
            }
        )

    ranking.sort(
        key=lambda x: x["a_count"] * 2 + x["enrolled"] * 5 + x["visits_done"] * 3 + x["contacted"],
        reverse=True,
    )
    return Response.ok({"ranking": ranking, "generated_at": str(utcnow())})
