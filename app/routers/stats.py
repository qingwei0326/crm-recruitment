from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_analyzer import predict_conversion
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import (
    Call,
    FollowUp,
    IntentLevel,
    Note,
    Student,
    StudentStatus,
    User,
    UserRole,
    Visit,
    VisitStatus,
    VisitType,
)
from app.permissions import get_accessible_student
from app.schemas import Response
from app.utils import month_start_cst_as_utc, today_cst_as_utc, utcnow

router = APIRouter(prefix="/api/stats", tags=["统计"])


@router.get("/sources")
async def source_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    rows = await db.execute(
        select(
            Student.region,
            func.count(Student.id),
            func.sum(case((Student.status != StudentStatus.not_contacted, 1), else_=0)),
            func.sum(case((Student.intent_level == IntentLevel.A, 1), else_=0)),
        )
        .where(Student.region != "")
        .group_by(Student.region)
    )
    data = [
        {
            "source": region,
            "total": total,
            "contacted": int(contacted),
            "a_count": int(a_count),
            "conversion_rate": round(int(a_count) / total * 100, 1) if total > 0 else 0,
        }
        for region, total, contacted, a_count in rows.all()
    ]
    return Response.ok(data)


@router.get("/stages")
async def stage_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Student.stage, func.count(Student.id))
        .where(Student.assigned_to.is_not(None))
        .group_by(Student.stage)
    )
    by_stage = {row[0]: row[1] for row in result.all()}
    unassigned = (
        await db.execute(select(func.count(Student.id)).where(Student.assigned_to.is_(None)))
    ).scalar() or 0
    by_stage["未分配"] = unassigned
    return Response.ok(by_stage)


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

    today_calls_r = await db.execute(
        select(func.count(Call.id)).where(
            Call.agent_id == agent_id, Call.created_at >= today, Call.created_at < tomorrow
        )
    )
    today_calls = today_calls_r.scalar() or 0

    month_calls_r = await db.execute(
        select(func.count(Call.id)).where(Call.agent_id == agent_id, Call.created_at >= month_start)
    )
    month_calls = month_calls_r.scalar() or 0

    today_a_r = await db.execute(
        select(func.count(Student.id)).where(
            Student.assigned_to == agent_id,
            Student.intent_level == IntentLevel.A,
            Student.updated_at >= today,
        )
    )
    today_a = today_a_r.scalar() or 0

    month_a_r = await db.execute(
        select(func.count(Student.id)).where(
            Student.assigned_to == agent_id,
            Student.intent_level == IntentLevel.A,
            Student.updated_at >= month_start,
        )
    )
    month_a = month_a_r.scalar() or 0

    total_contacted_r = await db.execute(
        select(func.count(Student.id)).where(
            Student.assigned_to == agent_id, Student.status != StudentStatus.not_contacted
        )
    )
    total_contacted = total_contacted_r.scalar() or 0

    all_a_r = await db.execute(
        select(func.count(Student.id)).where(
            Student.assigned_to == agent_id, Student.intent_level == IntentLevel.A
        )
    )
    all_a = all_a_r.scalar() or 0
    conversion_rate = round(all_a / total_contacted * 100, 1) if total_contacted > 0 else 0

    avg_dur_r = await db.execute(
        select(func.avg(Call.duration_seconds)).where(Call.agent_id == agent_id)
    )
    avg_duration = round(avg_dur_r.scalar() or 0, 1)

    return Response.ok(
        {
            "agent_id": agent_id,
            "today_calls": today_calls,
            "month_calls": month_calls,
            "today_a_count": today_a,
            "month_a_count": month_a,
            "conversion_rate": conversion_rate,
            "avg_duration_seconds": avg_duration,
        }
    )


@router.get("/agent-ranking")
async def agent_ranking(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
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
            func.sum(case((Student.status != StudentStatus.not_contacted, 1), else_=0)),
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
        select(Call.agent_id, func.count(Call.id))
        .where(Call.agent_id.in_(agent_ids), Call.created_at >= today)
        .group_by(Call.agent_id)
    )
    today_calls_map = dict(today_calls_r.all())

    month_calls_r = await db.execute(
        select(Call.agent_id, func.count(Call.id))
        .where(Call.agent_id.in_(agent_ids), Call.created_at >= month_start)
        .group_by(Call.agent_id)
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
        conversion = round(a_count / contacted * 100, 1) if contacted > 0 else 0
        ranking.append({
            "id": a.id,
            "name": a.name,
            "is_active": a.is_active,
            "total_leads": total_leads,
            "contacted": contacted,
            "a_count": a_count,
            "enrolled": enrolled,
            "total_visits": v.get("total_visits", 0),
            "visits_done": v.get("visits_done", 0),
            "campus_visits": v.get("campus_visits", 0),
            "home_visits": v.get("home_visits", 0),
            "today_calls": int(today_calls_map.get(a.id, 0)),
            "month_calls": int(month_calls_map.get(a.id, 0)),
            "conversion_rate": conversion,
        })

    ranking.sort(
        key=lambda x: x["a_count"] * 2 + x["enrolled"] * 5 + x["visits_done"] * 3 + x["contacted"],
        reverse=True,
    )
    return Response.ok({"ranking": ranking, "generated_at": str(utcnow())})


@router.get("/enrollment-conversion")
async def enrollment_conversion(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    agents_r = await db.execute(select(User).where(User.role == UserRole.agent))
    agents = agents_r.scalars().all()
    if not agents:
        return Response.ok([])
    agent_ids = [a.id for a in agents]
    agent_name_map = {a.id: a.name for a in agents}

    student_stats_r = await db.execute(
        select(
            Student.assigned_to,
            func.count(Student.id),
            func.sum(case((Student.status != StudentStatus.not_contacted, 1), else_=0)),
            func.sum(case((Student.intent_level == IntentLevel.A, 1), else_=0)),
            func.sum(case((Student.status == StudentStatus.enrolled, 1), else_=0)),
        )
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to)
    )

    data = []
    for aid, total, contacted, a_count, enrolled in student_stats_r.all():
        total = int(total)
        enrolled = int(enrolled)
        a_count = int(a_count)
        enroll_rate = round(enrolled / total * 100, 1) if total > 0 else 0
        a_to_enroll = round(enrolled / a_count * 100, 1) if a_count > 0 else 0
        data.append({
            "name": agent_name_map.get(aid, ""),
            "total": total,
            "contacted": int(contacted),
            "a_count": a_count,
            "enrolled": enrolled,
            "enroll_rate": enroll_rate,
            "a_to_enroll_rate": a_to_enroll,
        })

    data.sort(key=lambda x: x["enrolled"], reverse=True)
    return Response.ok(data)


@router.get("/trend")
async def trend_data(
    start_date: str = Query(None),
    end_date: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    end = date.today()
    if end_date:
        end = date.fromisoformat(end_date)
    start = end - timedelta(days=30)
    if start_date:
        start = date.fromisoformat(start_date)

    # Build day list
    days = []
    curr = start
    while curr <= end:
        days.append(curr)
        curr += timedelta(days=1)

    first_day = datetime(days[0].year, days[0].month, days[0].day)
    last_day_end = datetime(days[-1].year, days[-1].month, days[-1].day) + timedelta(days=1)

    # Batch: all calls in date range grouped by date+agent
    calls_by_date_agent = {}
    agents_r = await db.execute(select(User.id, User.name).where(User.role == UserRole.agent))
    agent_rows = agents_r.all()
    agent_name_of = dict(agent_rows)

    calls_raw = await db.execute(
        select(
            func.date(Call.created_at),
            Call.agent_id,
            func.count(Call.id),
        )
        .where(Call.created_at >= first_day, Call.created_at < last_day_end)
        .group_by(func.date(Call.created_at), Call.agent_id)
    )
    for day_str, agent_id, cnt in calls_raw.all():
        calls_by_date_agent.setdefault(day_str, {})[agent_name_of.get(agent_id, "")] = int(cnt)

    # Batch: daily enrolled count
    enrolled_by_date = {}
    enrolled_raw = await db.execute(
        select(
            Student.enrolled_at,
            func.count(Student.id),
        )
        .where(
            Student.enrolled_at >= start,
            Student.enrolled_at <= end,
            Student.status == StudentStatus.enrolled,
        )
        .group_by(Student.enrolled_at)
    )
    for enrolled_date, cnt in enrolled_raw.all():
        enrolled_by_date[str(enrolled_date)] = int(cnt)

    # Batch: daily total calls
    calls_total_by_date = {}
    calls_raw_total = await db.execute(
        select(
            func.date(Call.created_at),
            func.count(Call.id),
        )
        .where(Call.created_at >= first_day, Call.created_at < last_day_end)
        .group_by(func.date(Call.created_at))
    )
    for day_str, cnt in calls_raw_total.all():
        calls_total_by_date[day_str] = int(cnt)

    daily = []
    for d in days:
        day_str = str(d)
        day_agents = calls_by_date_agent.get(day_str, {})
        agent_calls = {name: day_agents.get(name, 0) for name in agent_name_of.values()}
        daily.append({
            "date": day_str,
            "calls": calls_total_by_date.get(day_str, 0),
            "enrolled": enrolled_by_date.get(day_str, 0),
            "agent_calls": agent_calls,
        })

    return Response.ok({"daily": daily, "start": str(start), "end": str(end)})


@router.get("/predict-conversion/{student_id}")
async def predict_student_conversion(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)

    notes_r = await db.execute(select(func.count(Note.id)).where(Note.student_id == student_id))
    total_notes = notes_r.scalar() or 0

    fu_r = await db.execute(select(FollowUp).where(FollowUp.student_id == student_id).limit(1))
    has_follow_up = fu_r.scalar_one_or_none() is not None

    visit_r = await db.execute(
        select(Visit)
        .where(Visit.student_id == student_id, Visit.status == VisitStatus.completed)
        .limit(1)
    )
    has_visit = visit_r.scalar_one_or_none() is not None

    days_since = 30
    if student.assigned_at:
        delta = utcnow() - student.assigned_at
        days_since = max(1, delta.days)

    intent_val = student.intent_level.value if student.intent_level else "无"
    stage_val = student.stage.value if student.stage else "初次联系"

    prob = predict_conversion(
        intent_level=intent_val,
        stage=stage_val,
        total_notes=total_notes,
        has_follow_up=has_follow_up,
        has_visit=has_visit,
        days_since_assign=days_since,
    )

    return Response.ok(
        {
            "student_id": student_id,
            "conversion_probability": prob,
            "factors": {
                "intent_level": intent_val,
                "stage": stage_val,
                "total_notes": total_notes,
                "has_follow_up": has_follow_up,
                "has_visit": has_visit,
                "days_since_assign": days_since,
            },
        }
    )
