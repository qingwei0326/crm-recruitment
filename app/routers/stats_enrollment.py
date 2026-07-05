from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ADMIN_PAGE_REPORT_CENTER, require_admin, require_page_permission
from app.database import get_db
from app.models import (
    AttributionMethod,
    CampusVisitStatus,
    CampusVisitTask,
    DialLog,
    EnrollmentRecord,
    EnrollmentSource,
    EnrollmentSubStage,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    SettlementStatus,
    Student,
    StudentStatus,
    User,
    UserRole,
    Visit,
    VisitStatus,
)
from app.routers.stats import _enum_value, _percent, _region_label
from app.schemas import Response
from app.status_policy import statuses_for_canonical
from app.utils import utcnow

router = APIRouter(prefix="/api/stats", tags=["统计"])


@router.get("/enrollment-conversion")
async def enrollment_conversion(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_REPORT_CENTER)),
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
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_REPORT_CENTER)),
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
            func.date(DialLog.dialed_at),
            DialLog.agent_id,
            func.count(DialLog.id),
        )
        .where(DialLog.dialed_at >= first_day, DialLog.dialed_at < last_day_end)
        .group_by(func.date(DialLog.dialed_at), DialLog.agent_id)
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
            func.date(DialLog.dialed_at),
            func.count(DialLog.id),
        )
        .where(DialLog.dialed_at >= first_day, DialLog.dialed_at < last_day_end)
        .group_by(func.date(DialLog.dialed_at))
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
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_REPORT_CENTER)),
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


@router.get("/funnel")
async def funnel_data(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """线索流转漏斗：总线索 → 已分配 → 已联系 → A 级意向 → 已到访 → 已报名 → 无效线索"""
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

    invalid_r = await db.execute(
        select(func.count(Student.id)).where(
            Student.status.in_(statuses_for_canonical(StudentStatus.invalid))
        )
    )
    invalid = invalid_r.scalar() or 0

    return Response.ok(
        {
            "stages": [
                {"name": "总线索", "value": total},
                {"name": "已分配", "value": assigned},
                {"name": "已联系", "value": contacted},
                {"name": "A 级意向", "value": a_level},
                {"name": "已到访", "value": visited},
                {"name": "已报名", "value": enrolled},
                {"name": "无效线索", "value": invalid},
            ]
        }
    )


@router.get("/admissions-report")
async def admissions_report(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_REPORT_CENTER)),
):
    """招生经营报表：漏斗、区域、话务员、家访到校、结算归属。"""
    now = utcnow()

    total_leads = (await db.execute(select(func.count(Student.id)))).scalar() or 0
    a_intent = (
        await db.execute(
            select(func.count(Student.id)).where(Student.intent_level == IntentLevel.A)
        )
    ).scalar() or 0
    home_visit_reported = (
        await db.execute(select(func.count(func.distinct(HomeVisitTask.student_id))))
    ).scalar() or 0
    home_visit_completed = (
        await db.execute(
            select(func.count(func.distinct(HomeVisitTask.student_id))).where(
                HomeVisitTask.status == HomeVisitStatus.completed
            )
        )
    ).scalar() or 0
    campus_visit_scheduled = (
        await db.execute(select(func.count(func.distinct(CampusVisitTask.student_id))))
    ).scalar() or 0
    campus_visit_arrived = (
        await db.execute(
            select(func.count(func.distinct(CampusVisitTask.student_id))).where(
                CampusVisitTask.status.in_([CampusVisitStatus.arrived, CampusVisitStatus.enrolled])
            )
        )
    ).scalar() or 0
    enrolled = (
        await db.execute(
            select(func.count(Student.id)).where(Student.status == StudentStatus.enrolled)
        )
    ).scalar() or 0

    funnel = [
        {
            "key": "leads",
            "label": "线索",
            "value": int(total_leads),
            "rate": 100.0 if total_leads else 0.0,
        },
        {
            "key": "a_intent",
            "label": "A意向",
            "value": int(a_intent),
            "rate": _percent(a_intent, total_leads),
        },
        {
            "key": "home_visit_reported",
            "label": "已上报家访",
            "value": int(home_visit_reported),
            "rate": _percent(home_visit_reported, total_leads),
        },
        {
            "key": "home_visit_completed",
            "label": "家访完成",
            "value": int(home_visit_completed),
            "rate": _percent(home_visit_completed, total_leads),
        },
        {
            "key": "campus_visit_scheduled",
            "label": "已安排到校",
            "value": int(campus_visit_scheduled),
            "rate": _percent(campus_visit_scheduled, total_leads),
        },
        {
            "key": "campus_visit_arrived",
            "label": "已到校",
            "value": int(campus_visit_arrived),
            "rate": _percent(campus_visit_arrived, total_leads),
        },
        {
            "key": "enrolled",
            "label": "已报名",
            "value": int(enrolled),
            "rate": _percent(enrolled, total_leads),
        },
    ]

    regions: dict[str, dict] = {}

    def ensure_region(region: str | None) -> dict:
        label = _region_label(region)
        if label not in regions:
            regions[label] = {
                "region": label,
                "total_leads": 0,
                "a_count": 0,
                "home_visits": 0,
                "campus_visits": 0,
                "enrollments": 0,
                "a_rate": 0.0,
                "enrollment_rate": 0.0,
            }
        return regions[label]

    region_students = await db.execute(
        select(
            Student.region,
            func.count(Student.id),
            func.sum(case((Student.intent_level == IntentLevel.A, 1), else_=0)),
            func.sum(case((Student.status == StudentStatus.enrolled, 1), else_=0)),
        ).group_by(Student.region)
    )
    for region, total, a_count, enrolled_count in region_students.all():
        item = ensure_region(region)
        item["total_leads"] = int(total or 0)
        item["a_count"] = int(a_count or 0)
        item["enrollments"] = int(enrolled_count or 0)

    region_home_visits = await db.execute(
        select(HomeVisitTask.region_snapshot, func.count(HomeVisitTask.id)).group_by(
            HomeVisitTask.region_snapshot
        )
    )
    for region, count in region_home_visits.all():
        ensure_region(region)["home_visits"] = int(count or 0)

    region_campus_visits = await db.execute(
        select(CampusVisitTask.region_snapshot, func.count(CampusVisitTask.id)).group_by(
            CampusVisitTask.region_snapshot
        )
    )
    for region, count in region_campus_visits.all():
        ensure_region(region)["campus_visits"] = int(count or 0)

    for item in regions.values():
        item["a_rate"] = _percent(item["a_count"], item["total_leads"])
        item["enrollment_rate"] = _percent(item["enrollments"], item["total_leads"])
    region_rows = sorted(
        regions.values(),
        key=lambda row: (
            row["enrollments"],
            row["campus_visits"],
            row["home_visits"],
            row["a_count"],
            row["total_leads"],
        ),
        reverse=True,
    )

    agents_result = await db.execute(
        select(User.id, User.name, User.is_active)
        .where(User.role == UserRole.agent)
        .order_by(User.is_active.desc(), User.name.asc())
    )
    agents = {
        agent_id: {
            "agent_id": agent_id,
            "agent_name": name,
            "is_active": is_active,
            "calls": 0,
            "total_leads": 0,
            "a_count": 0,
            "home_visit_reports": 0,
            "campus_visit_appointments": 0,
            "enrollments": 0,
            "unsettled": 0,
            "settlement_pending": 0,
            "a_rate": 0.0,
            "enrollment_rate": 0.0,
        }
        for agent_id, name, is_active in agents_result.all()
    }

    def ensure_agent(agent_id: int | None, name: str = "未知话务员") -> dict | None:
        if agent_id is None:
            return None
        if agent_id not in agents:
            agents[agent_id] = {
                "agent_id": agent_id,
                "agent_name": name,
                "is_active": False,
                "calls": 0,
                "total_leads": 0,
                "a_count": 0,
                "home_visit_reports": 0,
                "campus_visit_appointments": 0,
                "enrollments": 0,
                "unsettled": 0,
                "settlement_pending": 0,
                "a_rate": 0.0,
                "enrollment_rate": 0.0,
            }
        return agents[agent_id]

    agent_calls = await db.execute(
        select(DialLog.agent_id, func.count(DialLog.id)).group_by(DialLog.agent_id)
    )
    for agent_id, count in agent_calls.all():
        item = ensure_agent(agent_id)
        if item:
            item["calls"] = int(count or 0)

    agent_students = await db.execute(
        select(
            Student.assigned_to,
            func.count(Student.id),
            func.sum(case((Student.intent_level == IntentLevel.A, 1), else_=0)),
        )
        .where(Student.assigned_to.is_not(None))
        .group_by(Student.assigned_to)
    )
    for agent_id, total, a_count in agent_students.all():
        item = ensure_agent(agent_id)
        if item:
            item["total_leads"] = int(total or 0)
            item["a_count"] = int(a_count or 0)

    agent_home_visits = await db.execute(
        select(HomeVisitTask.creator_agent_id, func.count(HomeVisitTask.id)).group_by(
            HomeVisitTask.creator_agent_id
        )
    )
    for agent_id, count in agent_home_visits.all():
        item = ensure_agent(agent_id)
        if item:
            item["home_visit_reports"] = int(count or 0)

    agent_campus_visits = await db.execute(
        select(CampusVisitTask.creator_user_id, func.count(CampusVisitTask.id)).group_by(
            CampusVisitTask.creator_user_id
        )
    )
    for agent_id, count in agent_campus_visits.all():
        item = ensure_agent(agent_id)
        if item:
            item["campus_visit_appointments"] = int(count or 0)

    agent_enrollments = await db.execute(
        select(
            EnrollmentRecord.attributed_agent_id,
            func.count(EnrollmentRecord.id),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status == SettlementStatus.unsettled, 1),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status != SettlementStatus.settled, 1),
                    else_=0,
                )
            ),
        ).group_by(EnrollmentRecord.attributed_agent_id)
    )
    for agent_id, total, unsettled_count, pending_count in agent_enrollments.all():
        item = ensure_agent(agent_id)
        if item:
            item["enrollments"] = int(total or 0)
            item["unsettled"] = int(unsettled_count or 0)
            item["settlement_pending"] = int(pending_count or 0)

    agent_rows = []
    for item in agents.values():
        item["a_rate"] = _percent(item["a_count"], item["total_leads"])
        item["enrollment_rate"] = _percent(item["enrollments"], item["total_leads"])
        has_data = any(
            [
                item["calls"],
                item["total_leads"],
                item["a_count"],
                item["home_visit_reports"],
                item["campus_visit_appointments"],
                item["enrollments"],
            ]
        )
        if item["is_active"] or has_data:
            agent_rows.append(item)
    agent_rows.sort(
        key=lambda row: (
            row["enrollments"],
            row["settlement_pending"],
            row["campus_visit_appointments"],
            row["home_visit_reports"],
            row["a_count"],
            row["calls"],
        ),
        reverse=True,
    )

    home_status_counts = {
        status.value: 0
        for status in (
            HomeVisitStatus.pending,
            HomeVisitStatus.confirmed,
            HomeVisitStatus.scheduled,
            HomeVisitStatus.completed,
            HomeVisitStatus.cancelled,
            HomeVisitStatus.postponed,
        )
    }
    home_status_result = await db.execute(
        select(HomeVisitTask.status, func.count(HomeVisitTask.id)).group_by(HomeVisitTask.status)
    )
    for status, count in home_status_result.all():
        home_status_counts[_enum_value(status)] = int(count or 0)
    home_overdue = (
        await db.execute(
            select(func.count(HomeVisitTask.id)).where(
                HomeVisitTask.status.not_in([HomeVisitStatus.completed, HomeVisitStatus.cancelled]),
                or_(
                    HomeVisitTask.requested_visit_time < now,
                    HomeVisitTask.scheduled_at < now,
                ),
            )
        )
    ).scalar() or 0

    campus_status_counts = {
        status.value: 0
        for status in (
            CampusVisitStatus.pending,
            CampusVisitStatus.scheduled,
            CampusVisitStatus.arrived,
            CampusVisitStatus.no_show,
            CampusVisitStatus.rescheduled,
            CampusVisitStatus.cancelled,
            CampusVisitStatus.enrolled,
        )
    }
    campus_status_result = await db.execute(
        select(CampusVisitTask.status, func.count(CampusVisitTask.id)).group_by(
            CampusVisitTask.status
        )
    )
    for status, count in campus_status_result.all():
        campus_status_counts[_enum_value(status)] = int(count or 0)
    campus_overdue = (
        await db.execute(
            select(func.count(CampusVisitTask.id)).where(
                CampusVisitTask.status.in_(
                    [
                        CampusVisitStatus.pending,
                        CampusVisitStatus.scheduled,
                        CampusVisitStatus.rescheduled,
                    ]
                ),
                CampusVisitTask.appointment_at < now,
            )
        )
    ).scalar() or 0

    visits = {
        "home": {
            "total": sum(home_status_counts.values()),
            "pending": home_status_counts.get(HomeVisitStatus.pending.value, 0),
            "scheduled": home_status_counts.get(HomeVisitStatus.confirmed.value, 0)
            + home_status_counts.get(HomeVisitStatus.scheduled.value, 0),
            "completed": home_status_counts.get(HomeVisitStatus.completed.value, 0),
            "cancelled": home_status_counts.get(HomeVisitStatus.cancelled.value, 0),
            "postponed": home_status_counts.get(HomeVisitStatus.postponed.value, 0),
            "overdue": int(home_overdue),
            "by_status": home_status_counts,
        },
        "campus": {
            "total": sum(campus_status_counts.values()),
            "pending": campus_status_counts.get(CampusVisitStatus.pending.value, 0),
            "scheduled": campus_status_counts.get(CampusVisitStatus.scheduled.value, 0)
            + campus_status_counts.get(CampusVisitStatus.rescheduled.value, 0),
            "arrived": campus_status_counts.get(CampusVisitStatus.arrived.value, 0)
            + campus_status_counts.get(CampusVisitStatus.enrolled.value, 0),
            "no_show": campus_status_counts.get(CampusVisitStatus.no_show.value, 0),
            "cancelled": campus_status_counts.get(CampusVisitStatus.cancelled.value, 0),
            "overdue": int(campus_overdue),
            "by_status": campus_status_counts,
        },
    }

    settlement_status_counts = {status.value: 0 for status in SettlementStatus}
    settlement_result = await db.execute(
        select(EnrollmentRecord.settlement_status, func.count(EnrollmentRecord.id)).group_by(
            EnrollmentRecord.settlement_status
        )
    )
    for status, count in settlement_result.all():
        settlement_status_counts[_enum_value(status)] = int(count or 0)

    source_counts = {source.value: 0 for source in EnrollmentSource}
    source_result = await db.execute(
        select(EnrollmentRecord.source, func.count(EnrollmentRecord.id)).group_by(
            EnrollmentRecord.source
        )
    )
    for source, count in source_result.all():
        source_counts[_enum_value(source)] = int(count or 0)

    method_counts = {method.value: 0 for method in AttributionMethod}
    method_result = await db.execute(
        select(EnrollmentRecord.attribution_method, func.count(EnrollmentRecord.id)).group_by(
            EnrollmentRecord.attribution_method
        )
    )
    for method, count in method_result.all():
        method_counts[_enum_value(method)] = int(count or 0)

    settlement = {
        "total": sum(settlement_status_counts.values()),
        "unsettled": settlement_status_counts.get(SettlementStatus.unsettled.value, 0),
        "settled": settlement_status_counts.get(SettlementStatus.settled.value, 0),
        "postponed": settlement_status_counts.get(SettlementStatus.postponed.value, 0),
        "disputed": settlement_status_counts.get(SettlementStatus.disputed.value, 0),
        "manual_attribution": method_counts.get(AttributionMethod.manual.value, 0),
        "by_source": source_counts,
        "by_method": method_counts,
    }

    return Response.ok(
        {
            "funnel": funnel,
            "regions": region_rows,
            "agents": agent_rows,
            "visits": visits,
            "settlement": settlement,
            "generated_at": str(now),
        }
    )
