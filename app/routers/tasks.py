from datetime import timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.models import Call, FollowUp, IntentLevel, OperationLog, Student, StudentStatus, User
from app.schemas import Response
from app.utils import today_cst_as_utc, utcnow

router = APIRouter(prefix="/api/tasks", tags=["任务"])

# 今日任务列表单次返回上限。stats/学校分组走 SQL 聚合，不受此上限影响，
# 即使列表被截断也始终是全量准确值。超过此数会置 truncated=True 提示前端。
TODAY_TASK_LIMIT = 1000

_ACTIVE_TASK_STATUSES = [
    StudentStatus.not_contacted,
    StudentStatus.contacted,
    StudentStatus.pending_visit,
]


@router.get("/today")
async def today_tasks(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: str = Query(None),
    school_name: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    base_where = (
        Student.assigned_to == current_user.id,
        Student.status.in_(_ACTIVE_TASK_STATUSES),
    )

    filters = list(base_where)
    if search and search.strip():
        q = search.strip()
        filters.append(
            or_(
                Student.name.ilike(f"%{q}%"),
                Student.guardian_phone.ilike(f"%{q}%"),
                Student.guardian2_phone.ilike(f"%{q}%"),
            )
        )
    if school_name and school_name.strip():
        filters.append(Student.school_name == school_name.strip())

    # 统计走 SQL 聚合：与列表是否截断无关，始终全量准确
    counts_r = await db.execute(
        select(Student.status, func.count())
        .where(*filters)
        .group_by(Student.status)
    )
    counts = {status: cnt for status, cnt in counts_r.all()}
    done = counts.get(StudentStatus.contacted, 0)
    pending = counts.get(StudentStatus.not_contacted, 0)
    follow_up = counts.get(StudentStatus.pending_visit, 0)
    total = done + pending + follow_up
    # 进度 = 已处理（已联系 + 待回访）/ 总数
    handled = done + follow_up
    progress_pct = round(handled / total * 100, 1) if total > 0 else 0

    # 学校分组走 SQL 聚合：与列表是否截断无关，前端筛选标签始终准确
    schools_r = await db.execute(
        select(Student.school_name, func.count())
        .where(*filters)
        .group_by(Student.school_name)
    )
    schools = sorted(
        ({"name": name or "未知学校", "count": cnt} for name, cnt in schools_r.all()),
        key=lambda x: x["count"],
        reverse=True,
    )

    result = await db.execute(
        select(Student)
        .where(*filters)
        .order_by(Student.updated_at.desc())
        .offset(offset)
        .limit(limit)
    )
    students = result.scalars().all()
    truncated = total > len(students) + offset

    now = utcnow()

    def _days_since(dt):
        if dt is None:
            return None
        delta = now - dt
        return max(0, delta.days)

    return Response.ok(
        {
            "total": total,
            "stats": {
                "total": total,
                "done": done,
                "pending": pending,
                "follow_up": follow_up,
                "progress_pct": progress_pct,
            },
            "schools": schools,
            "truncated": truncated,
            "list": [
                {
                    "id": s.id,
                    "name": s.name,
                    "region": s.region,
                    "score": s.score,
                    "guardian_name": s.guardian_name,
                    "guardian_phone": s.guardian_phone,
                    "guardian_phone_raw": s.guardian_phone,
                    "guardian2_name": s.guardian2_name,
                    "guardian2_phone": s.guardian2_phone,
                    "guardian2_phone_raw": s.guardian2_phone,
                    "school_name": s.school_name,
                    "school_address": s.school_address,
                    "status": s.status,
                    "stage": s.stage,
                    "intent_level": s.intent_level,
                    "need_help": s.need_help,
                    "expired_at": str(s.expired_at) if s.expired_at else None,
                    "assigned_at": str(s.assigned_at) if s.assigned_at else None,
                    "days_since_assigned": _days_since(s.assigned_at),
                    "updated_at": str(s.updated_at),
                }
                for s in students
            ],
        }
    )


@router.get("/yesterday")
async def yesterday_review(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    today = today_cst_as_utc()
    yesterday = today - timedelta(days=1)

    calls_result = await db.execute(
        select(func.count(Call.id)).where(
            Call.agent_id == current_user.id, Call.created_at >= yesterday, Call.created_at < today
        )
    )
    yesterday_calls = calls_result.scalar() or 0

    a_result = await db.execute(
        select(func.count(func.distinct(OperationLog.target_student_id)))
        .select_from(OperationLog)
        .join(Student, Student.id == OperationLog.target_student_id)
        .where(
            Student.assigned_to == current_user.id,
            OperationLog.action.in_(["AI分析", "手动评级"]),
            OperationLog.new_status == "A",
            OperationLog.old_status != "A",
            OperationLog.created_at >= yesterday,
            OperationLog.created_at < today,
        )
    )
    yesterday_a = a_result.scalar() or 0

    # 昨日范围内的转化率：昨日有过通话动作的学生数（去重） vs 昨日转 A 的学生数
    contacted_yday_r = await db.execute(
        select(func.count(func.distinct(Call.student_id))).where(
            Call.agent_id == current_user.id,
            Call.created_at >= yesterday,
            Call.created_at < today,
        )
    )
    yesterday_contacted = contacted_yday_r.scalar() or 0
    conversion = (
        round(yesterday_a / yesterday_contacted * 100, 1) if yesterday_contacted > 0 else 0
    )

    assigned_result = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == current_user.id,
            Student.assigned_at >= yesterday,
            Student.assigned_at < today,
        )
        .order_by(Student.assigned_at.desc())
        .limit(20)
    )
    assigned_list = [
        {"id": s.id, "name": s.name, "status": s.status, "assigned_at": str(s.assigned_at)}
        for s in assigned_result.scalars().all()
    ]

    tomorrow = today + timedelta(days=1)
    follow_up_result = await db.execute(
        select(FollowUp, Student)
        .join(Student, Student.id == FollowUp.student_id)
        .where(
            FollowUp.agent_id == current_user.id,
            FollowUp.follow_up_date >= today,
            FollowUp.follow_up_date < tomorrow,
            FollowUp.is_notified.is_(False),
        )
        .order_by(FollowUp.follow_up_date.asc())
    )
    follow_up_list = [
        {
            "id": fu.id,
            "follow_up_date": str(fu.follow_up_date),
            "student_id": student.id,
            "student_name": student.name,
            "student_region": student.region,
            "intent_level": student.intent_level,
            "status": student.status,
        }
        for fu, student in follow_up_result.all()
    ]

    # 昨日及更早分配但仍未联系的学员：昨日没干完的活
    stale_r = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == current_user.id,
            Student.status == StudentStatus.not_contacted,
            Student.assigned_at < today,
        )
        .order_by(Student.assigned_at.asc())
        .limit(50)
    )
    now = utcnow()
    stale_list = []
    for s in stale_r.scalars().all():
        days = (now - s.assigned_at).days if s.assigned_at else None
        stale_list.append(
            {
                "id": s.id,
                "name": s.name,
                "region": s.region,
                "school_name": s.school_name,
                "intent_level": s.intent_level,
                "assigned_at": str(s.assigned_at) if s.assigned_at else None,
                "days_since_assigned": days,
            }
        )

    return Response.ok(
        {
            "yesterday_calls": yesterday_calls,
            "yesterday_a": yesterday_a,
            "conversion_rate": conversion,
            "list": assigned_list,
            "follow_up_list": follow_up_list,
            "stale_unconcat": stale_list,
        }
    )


@router.get("/following")
async def following_students(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """跟进中：有意向但尚未报名/无效的学员"""
    result = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == current_user.id,
            Student.intent_level != IntentLevel.none,
            Student.status.not_in([
                StudentStatus.enrolled,
                StudentStatus.expired,
                StudentStatus.rejected,
                StudentStatus.invalid,
            ]),
        )
        .order_by(Student.updated_at.desc())
    )
    students = result.scalars().all()

    now = utcnow()
    items = []
    for s in students:
        days = (now - s.assigned_at).days if s.assigned_at else None
        items.append({
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "school_name": s.school_name,
            "stage": s.stage,
            "intent_level": s.intent_level,
            "status": s.status,
            "guardian_name": s.guardian_name,
            "guardian_phone": s.guardian_phone,
            "days_since_assigned": days,
        })

    # 按意向等级统计
    intent_counts = {}
    for s in students:
        level = s.intent_level.value if hasattr(s.intent_level, 'value') else str(s.intent_level)
        intent_counts[level] = intent_counts.get(level, 0) + 1

    return Response.ok({
        "total": len(items),
        "intent_counts": intent_counts,
        "list": items,
    })


@router.get("/backlog")
async def my_backlog(
    days_threshold: int = Query(3, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """当前话务员积压情况：分配超过 N 天且仍未到终态的学员数量与最久天数。"""
    now = utcnow()
    cutoff = now - timedelta(days=days_threshold)

    result = await db.execute(
        select(
            func.count(Student.id),
            func.min(Student.assigned_at),
        ).where(
            Student.assigned_to == current_user.id,
            Student.status.not_in(
                [
                    StudentStatus.enrolled,
                    StudentStatus.expired,
                    StudentStatus.rejected,
                    StudentStatus.completed,
                    StudentStatus.invalid,
                ]
            ),
            Student.assigned_at.isnot(None),
            Student.assigned_at < cutoff,
        )
    )
    row = result.one()
    count = int(row[0] or 0)
    oldest_at = row[1]
    oldest_days = (now - oldest_at).days if oldest_at else 0

    return Response.ok(
        {
            "count": count,
            "oldest_days": oldest_days,
            "threshold_days": days_threshold,
        }
    )
