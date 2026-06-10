from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import Date, case, cast, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai_analyzer import predict_conversion
from app.auth import get_current_user, require_admin
from app.database import get_db
from app.models import (
    Call,
    EnrollmentSubStage,
    FollowUp,
    IntentLevel,
    Note,
    OperationLog,
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
        .where(
            Student.assigned_to.is_not(None),
            Student.status != StudentStatus.invalid,
        )
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

    # 合并 Call 统计：today_calls + month_calls + avg_duration 一次查询
    calls_r = await db.execute(
        select(
            func.count()
            .filter(Call.created_at >= today, Call.created_at < tomorrow)
            .label("today_calls"),
            func.count().label("month_calls"),
            func.avg(Call.duration_seconds).label("avg_duration"),
        ).where(Call.agent_id == agent_id, Call.created_at >= month_start)
    )
    row = calls_r.one()
    today_calls = row.today_calls or 0
    month_calls = row.month_calls or 0
    avg_duration = round(row.avg_duration or 0, 1)

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
                "total_visits": v.get("total_visits", 0),
                "visits_done": v.get("visits_done", 0),
                "campus_visits": v.get("campus_visits", 0),
                "home_visits": v.get("home_visits", 0),
                "today_calls": int(today_calls_map.get(a.id, 0)),
                "month_calls": int(month_calls_map.get(a.id, 0)),
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

    data = []
    for aid, total, contacted, a_count, enrolled in student_stats_r.all():
        total = int(total)
        enrolled = int(enrolled)
        a_count = int(a_count)
        enroll_rate = round(enrolled / total * 100, 1) if total > 0 else 0
        a_to_enroll = round(enrolled / a_count * 100, 1) if a_count > 0 else 0
        data.append(
            {
                "name": agent_name_map.get(aid, ""),
                "total": total,
                "contacted": int(contacted),
                "a_count": a_count,
                "enrolled": enrolled,
                "enroll_rate": enroll_rate,
                "a_to_enroll_rate": a_to_enroll,
            }
        )

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
            cast(Call.created_at, Date),
            Call.agent_id,
            func.count(Call.id),
        )
        .where(Call.created_at >= first_day, Call.created_at < last_day_end)
        .group_by(cast(Call.created_at, Date), Call.agent_id)
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
            cast(Call.created_at, Date),
            func.count(Call.id),
        )
        .where(Call.created_at >= first_day, Call.created_at < last_day_end)
        .group_by(cast(Call.created_at, Date))
    )
    for day_str, cnt in calls_raw_total.all():
        calls_total_by_date[day_str] = int(cnt)

    daily = []
    for d in days:
        day_str = str(d)
        day_agents = calls_by_date_agent.get(day_str, {})
        agent_calls = {name: day_agents.get(name, 0) for name in agent_name_of.values()}
        daily.append(
            {
                "date": day_str,
                "calls": calls_total_by_date.get(day_str, 0),
                "enrolled": enrolled_by_date.get(day_str, 0),
                "agent_calls": agent_calls,
            }
        )

    return Response.ok({"daily": daily, "start": str(start), "end": str(end)})


@router.get("/enrollment-substage-distribution")
async def enrollment_substage_distribution(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """报名后子阶段分布 + 流失率。"""
    result = await db.execute(
        select(Student.enrollment_substage, func.count(Student.id))
        .where(Student.status == StudentStatus.enrolled)
        .group_by(Student.enrollment_substage)
    )
    rows = result.all()

    distribution: dict[str, int] = {e.value: 0 for e in EnrollmentSubStage}
    distribution["未设置"] = 0
    total = 0
    for substage, count in rows:
        total += count
        if substage is None:
            distribution["未设置"] += count
        else:
            distribution[str(substage)] = count

    churned = distribution.get(EnrollmentSubStage.churned.value, 0)
    churn_rate = round(churned / total * 100, 2) if total else 0.0

    return Response.ok(
        {
            "total_enrolled": total,
            "distribution": distribution,
            "churned": churned,
            "churn_rate": churn_rate,
        }
    )


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


@router.get("/funnel")
async def funnel_data(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """转化漏斗：总线索 → 已分配 → 已联系 → A意向 → 已到访 → 已报名"""
    total_r = await db.execute(select(func.count(Student.id)))
    total = total_r.scalar() or 0

    assigned_r = await db.execute(
        select(func.count(Student.id)).where(Student.assigned_to.is_not(None))
    )
    assigned = assigned_r.scalar() or 0

    contacted_r = await db.execute(
        select(func.count(Student.id)).where(
            Student.status.not_in([StudentStatus.not_contacted, StudentStatus.invalid])
        )
    )
    contacted = contacted_r.scalar() or 0

    a_level_r = await db.execute(
        select(func.count(Student.id)).where(Student.intent_level == IntentLevel.A)
    )
    a_level = a_level_r.scalar() or 0

    visited_r = await db.execute(
        select(func.count(func.distinct(Visit.student_id))).where(
            Visit.status == VisitStatus.completed
        )
    )
    visited = visited_r.scalar() or 0

    enrolled_r = await db.execute(
        select(func.count(Student.id)).where(Student.status == StudentStatus.enrolled)
    )
    enrolled = enrolled_r.scalar() or 0

    return Response.ok(
        {
            "stages": [
                {"name": "总线索", "value": total},
                {"name": "已分配", "value": assigned},
                {"name": "已联系", "value": contacted},
                {"name": "A意向", "value": a_level},
                {"name": "已到访", "value": visited},
                {"name": "已报名", "value": enrolled},
            ]
        }
    )


@router.get("/heatmap")
async def heatmap_data(
    start_date: str = Query(None),
    end_date: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
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

    # 获取所有坐席
    agents_r = await db.execute(
        select(User.id, User.name).where(User.role == UserRole.agent).order_by(User.name)
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
            Call.agent_id,
            cast(Call.created_at, Date),
            func.count(Call.id),
        )
        .where(Call.created_at >= first_day, Call.created_at < last_day_end)
        .group_by(Call.agent_id, cast(Call.created_at, Date))
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


@router.get("/predictions")
async def prediction_distribution(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """活跃学生的转化概率分布统计 — 批量查询避免 N+1"""
    # 1) 所有活跃学生 (一次查询)
    result = await db.execute(
        select(Student).where(
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.invalid,
                ]
            )
        )
    )
    students = result.scalars().all()
    if not students:
        return Response.ok(
            {
                "total": 0,
                "high": 0,
                "medium": 0,
                "low": 0,
                "avg_probability": 0,
                "distribution": [
                    {"name": "高概率 (>70%)", "value": 0, "color": "#22c55e"},
                    {"name": "中概率 (30-70%)", "value": 0, "color": "#eab308"},
                    {"name": "低概率 (<30%)", "value": 0, "color": "#ef4444"},
                ],
            }
        )

    # 子查询：活跃学生 ID 集合（避免 IN 列表超 SQLite 变量限制）
    active_ids = (
        select(Student.id)
        .where(
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.invalid,
                ]
            )
        )
        .scalar_subquery()
    )

    # 2) 批量查 notes 数
    notes_r = await db.execute(
        select(Note.student_id, func.count(Note.id).label("cnt"))
        .where(Note.student_id.in_(active_ids))
        .group_by(Note.student_id)
    )
    notes_map = {row.student_id: row.cnt for row in notes_r.all()}

    # 3) 批量查 follow_up
    fu_r = await db.execute(
        select(func.distinct(FollowUp.student_id)).where(FollowUp.student_id.in_(active_ids))
    )
    fu_set = {row[0] for row in fu_r.all()}

    # 4) 批量查 completed visit
    visit_r = await db.execute(
        select(func.distinct(Visit.student_id)).where(
            Visit.student_id.in_(active_ids),
            Visit.status == VisitStatus.completed,
        )
    )
    visit_set = {row[0] for row in visit_r.all()}

    # 5) 计算每个学生的概率
    now = utcnow()
    high = medium = low = 0
    total_prob = 0.0

    for s in students:
        total_notes = notes_map.get(s.id, 0)
        has_follow_up = s.id in fu_set
        has_visit = s.id in visit_set

        days_since = 30
        if s.assigned_at:
            days_since = max(1, (now - s.assigned_at).days)

        intent_val = s.intent_level.value if s.intent_level else "无"
        stage_val = s.stage.value if s.stage else "初次联系"

        prob = predict_conversion(
            intent_level=intent_val,
            stage=stage_val,
            total_notes=total_notes,
            has_follow_up=has_follow_up,
            has_visit=has_visit,
            days_since_assign=days_since,
        )
        total_prob += prob
        if prob > 0.7:
            high += 1
        elif prob >= 0.3:
            medium += 1
        else:
            low += 1

    total = len(students)
    avg_prob = round(total_prob / total, 4) if total else 0

    return Response.ok(
        {
            "total": total,
            "high": high,
            "medium": medium,
            "low": low,
            "avg_probability": avg_prob,
            "distribution": [
                {"name": "高概率 (>70%)", "value": high, "color": "#22c55e"},
                {"name": "中概率 (30-70%)", "value": medium, "color": "#eab308"},
                {"name": "低概率 (<30%)", "value": low, "color": "#ef4444"},
            ],
        }
    )
