"""Agent task-queue queries: today / handled / yesterday / following / backlog.

No FastAPI dependencies. Routers in ``app/routers/tasks.py`` translate
``InvalidFilter`` / ``ResourceNotFound`` into the HTTP errors they always returned.
"""

from datetime import timedelta

from sqlalchemy import case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain_errors import InvalidFilter, ResourceNotFound
from app.domain_models import PersonalGroup, PersonalGroupMembership
from app.models import Call, FollowUp, IntentLevel, OperationLog, Student, StudentStatus
from app.status_policy import (
    canonical_status_value,
    canonical_student_status,
    status_detail_value,
    statuses_for_canonical,
)
from app.task_stats import (
    ACTIVE_TASK_STATUSES,
    AGENT_HANDLED_TASK_STATUSES,
    AGENT_TODAY_TASK_STATUSES,
    TERMINAL_STUDENT_STATUSES,
    build_task_stats,
)
from app.utils import is_phone_query, mask_phone, normalize_phone, today_cst_as_utc, utcnow


def _agent_task_search_predicate(q: str):
    if is_phone_query(q):
        phone_q = normalize_phone(q)
        return or_(
            Student.guardian_phone == phone_q,
            Student.guardian2_phone == phone_q,
        )

    phone_digits = normalize_phone(q)
    if phone_digits and len(phone_digits) >= 4:
        like_q = f"%{phone_digits}%"
        return or_(
            Student.name.ilike(f"%{q}%"),
            Student.guardian_phone.like(like_q),
            Student.guardian2_phone.like(like_q),
        )

    return Student.name.ilike(f"%{q}%")


def _intent_priority_expr():
    return case(
        (Student.intent_level == IntentLevel.A, 0),
        (Student.intent_level == IntentLevel.B, 1),
        (Student.intent_level == IntentLevel.C, 2),
        else_=3,
    )


def _today_status_priority_expr():
    return case(
        (Student.status == StudentStatus.new_lead, 0),
        (Student.status == StudentStatus.not_contacted, 1),
        else_=2,
    )


def _handled_status_priority_expr():
    return case(
        (Student.status.in_(statuses_for_canonical(StudentStatus.pending_visit)), 0),
        (Student.status.in_(statuses_for_canonical(StudentStatus.not_reached)), 1),
        (Student.status.in_(statuses_for_canonical(StudentStatus.contacted)), 2),
        else_=3,
    )


async def _personal_group_predicate(
    db: AsyncSession,
    owner_id: int,
    personal_group_id: int | None,
    ungrouped: bool,
):
    if personal_group_id is not None and ungrouped:
        raise InvalidFilter("分组筛选与未分组筛选不能同时使用")

    active_memberships = (
        select(PersonalGroupMembership.student_id)
        .join(PersonalGroup, PersonalGroup.id == PersonalGroupMembership.group_id)
        .where(
            PersonalGroup.owner_id == owner_id,
            PersonalGroup.archived_at.is_(None),
            PersonalGroupMembership.archived_at.is_(None),
        )
    )

    if ungrouped:
        return ~Student.id.in_(active_memberships)

    if personal_group_id is None:
        return None

    owned_group = await db.scalar(
        select(PersonalGroup.id).where(
            PersonalGroup.id == personal_group_id,
            PersonalGroup.owner_id == owner_id,
            PersonalGroup.archived_at.is_(None),
        )
    )
    if owned_group is None:
        raise ResourceNotFound("分组不存在")

    return Student.id.in_(
        active_memberships.where(PersonalGroup.id == personal_group_id)
    )


async def _personal_groups_by_student(
    db: AsyncSession,
    owner_id: int,
    student_ids: list[int],
) -> dict[int, list[dict]]:
    if not student_ids:
        return {}

    rows = await db.execute(
        select(
            PersonalGroupMembership.student_id,
            PersonalGroup.id,
            PersonalGroup.name,
            PersonalGroup.color,
        )
        .join(PersonalGroup, PersonalGroup.id == PersonalGroupMembership.group_id)
        .where(
            PersonalGroup.owner_id == owner_id,
            PersonalGroup.archived_at.is_(None),
            PersonalGroupMembership.student_id.in_(student_ids),
            PersonalGroupMembership.archived_at.is_(None),
        )
        .order_by(PersonalGroup.created_at, PersonalGroup.id)
    )
    groups_by_student: dict[int, list[dict]] = {}
    for student_id, group_id, name, color in rows.all():
        groups_by_student.setdefault(student_id, []).append(
            {"id": group_id, "name": name, "color": color}
        )
    return groups_by_student


async def today_tasks(
    db: AsyncSession,
    agent_id: int,
    *,
    limit: int,
    offset: int,
    search: str | None,
    school_name: str | None,
    intent_level: str | None,
    overdue: bool,
    personal_group_id: int | None,
    ungrouped: bool,
) -> dict:
    # 统计范围与列表一致：话务员端主任务只展示未联系学生。
    # 无电话数据在导入入口直接拒绝，不在任务层重复维护一套过滤口径。
    stats_where = (
        Student.assigned_to == agent_id,
        Student.status.in_(AGENT_TODAY_TASK_STATUSES),
    )
    # The dial list only contains uncontacted students, but the progress card
    # needs the complete active workflow pool so completed work is not lost
    # when a student leaves the dial queue.
    progress_where = (
        Student.assigned_to == agent_id,
        Student.status.in_(ACTIVE_TASK_STATUSES),
    )
    # 列表范围：同上
    base_where = (
        Student.assigned_to == agent_id,
        Student.status.in_(AGENT_TODAY_TASK_STATUSES),
    )

    group_filter = await _personal_group_predicate(db, agent_id, personal_group_id, ungrouped)
    if group_filter is not None:
        stats_where = (*stats_where, group_filter)
        progress_where = (*progress_where, group_filter)
        base_where = (*base_where, group_filter)

    intent_filter = None
    if intent_level and intent_level.strip():
        try:
            intent_filter = Student.intent_level == IntentLevel(intent_level.strip())
        except ValueError:
            raise InvalidFilter("意向等级无效")

    filtered_stats_where = list(stats_where)
    if intent_filter is not None:
        filtered_stats_where.append(intent_filter)

    filters = list(base_where)
    if intent_filter is not None:
        filters.append(intent_filter)
    # search 条件单独留存，便于学校分组聚合复用（学校分组必须排除 school_name 过滤，
    # 否则一旦选中某学校，分组结果只剩该校，前端学校切换条就塌缩成单个，无法切换）。
    search_pred = None
    if search and search.strip():
        search_pred = _agent_task_search_predicate(search.strip())
        filters.append(search_pred)
    if school_name and school_name.strip():
        filters.append(Student.school_name == school_name.strip())

    # 逾期定义为：分配时间早于北京时间今天零点，且仍在未联系任务池中。
    # overdue_count 始终按当前搜索/学校/意向筛选计算，方便前端展示准确的队列数量。
    pending_filters = list(filters)
    today_start = today_cst_as_utc()
    overdue_predicates = [
        Student.assigned_at.is_not(None),
        Student.assigned_at < today_start,
    ]
    overdue_filters = [*filters, *overdue_predicates]
    overdue_count = (
        await db.execute(select(func.count(Student.id)).where(*overdue_filters))
    ).scalar_one() or 0
    if overdue:
        filters.extend(overdue_predicates)

    # 统计走 SQL 聚合：基于 stats_where（该话务员全部学生），与列表截断无关
    counts_r = await db.execute(
        select(Student.status, func.count())
        .where(*filtered_stats_where)
        .group_by(Student.status)
    )
    counts = {status: cnt for status, cnt in counts_r.all()}
    stats = build_task_stats(counts, total_statuses=AGENT_TODAY_TASK_STATUSES)

    progress_counts_r = await db.execute(
        select(Student.status, func.count()).where(*progress_where).group_by(Student.status)
    )
    progress_counts = {status: cnt for status, cnt in progress_counts_r.all()}
    task_progress = build_task_stats(progress_counts)

    help_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                *progress_where,
                Student.need_help.is_(True),
            )
        )
    ).scalar_one() or 0
    today_completed_count = (
        await db.execute(
            select(func.count(func.distinct(Call.student_id))).where(
                Call.agent_id == agent_id,
                Call.created_at >= today_start,
            )
        )
    ).scalar_one() or 0

    intent_counts_r = await db.execute(
        select(Student.intent_level, func.count())
        .where(*stats_where)
        .group_by(Student.intent_level)
    )
    intent_counts = {"A": 0, "B": 0, "C": 0, "无": 0}
    for level, count in intent_counts_r.all():
        key = level.value if hasattr(level, "value") else str(level)
        intent_counts[key] = int(count or 0)

    # 学校分组走 SQL 聚合：基于 stats_where（全部学生），排除 school_name 过滤，
    # 保证前端学校切换标签始终是全部学校（不受当前选中学校影响）。
    school_group_filters = list(filtered_stats_where)
    if search_pred is not None:
        school_group_filters.append(search_pred)
    if overdue:
        school_group_filters.extend(overdue_predicates)
    schools_r = await db.execute(
        select(Student.school_name, func.count())
        .where(*school_group_filters)
        .group_by(Student.school_name)
    )
    schools = sorted(
        ({"name": name or "未知学校", "count": cnt} for name, cnt in schools_r.all()),
        key=lambda x: x["count"],
        reverse=True,
    )

    list_total = (
        await db.execute(select(func.count(Student.id)).where(*filters))
    ).scalar_one() or 0
    pending_count = list_total
    if overdue:
        pending_count = (
            await db.execute(select(func.count(Student.id)).where(*pending_filters))
        ).scalar_one() or 0

    order_by_clauses = (
        [
            Student.assigned_at.asc(),
            Student.updated_at.asc(),
            Student.id.asc(),
        ]
        if overdue
        else [
            _intent_priority_expr(),
            _today_status_priority_expr(),
            Student.assigned_at.is_(None),
            Student.assigned_at.asc(),
            Student.updated_at.asc(),
            Student.id.asc(),
        ]
    )
    result = await db.execute(
        select(Student)
        .where(*filters)
        .order_by(*order_by_clauses)
        .offset(offset)
        .limit(limit)
    )
    students = result.scalars().all()
    groups_by_student = await _personal_groups_by_student(
        db, agent_id, [student.id for student in students]
    )
    truncated = list_total > len(students) + offset

    now = utcnow()

    def _days_since(dt):
        if dt is None:
            return None
        delta = now - dt
        return max(0, delta.days)

    return {
        "total": stats["total"],
        "stats": stats,
        "task_progress": task_progress,
        "intent_counts": intent_counts,
        "schools": schools,
        "list_total": int(list_total),
        "pending_count": int(pending_count),
        "overdue_count": int(overdue_count),
        "help_count": int(help_count),
        "today_completed_count": int(today_completed_count),
        "overdue": overdue,
        "truncated": truncated,
        "list": [
            {
                "id": s.id,
                "name": s.name,
                "region": s.region,
                "score": s.score,
                "guardian_name": s.guardian_name,
                "guardian_phone": mask_phone(s.guardian_phone),
                "guardian_phone_raw": None,
                "guardian2_name": s.guardian2_name,
                "guardian2_phone": mask_phone(s.guardian2_phone),
                "guardian2_phone_raw": None,
                "school_name": s.school_name,
                "school_address": s.school_address,
                "status": canonical_status_value(s.status),
                "status_detail": status_detail_value(s.status, s.status_detail),
                "stage": s.stage,
                "intent_level": s.intent_level,
                "need_help": s.need_help,
                "expired_at": str(s.expired_at) if s.expired_at else None,
                "assigned_at": str(s.assigned_at) if s.assigned_at else None,
                "days_since_assigned": _days_since(s.assigned_at),
                "is_overdue": bool(s.assigned_at and s.assigned_at < today_start),
                "updated_at": str(s.updated_at),
                "personal_groups": groups_by_student.get(s.id, []),
            }
            for s in students
        ],
    }


async def handled_students(
    db: AsyncSession,
    agent_id: int,
    *,
    status: str | None,
    status_detail: str | None,
    intent_level: str | None,
    search: str | None,
    region: str | None,
    personal_group_id: int | None,
    ungrouped: bool,
    limit: int,
    offset: int,
) -> dict:
    """待办学生列表：已联系、未接、待回访，需要话务员继续处理。"""
    base_where = (
        Student.assigned_to == agent_id,
        Student.status.in_(AGENT_HANDLED_TASK_STATUSES),
    )
    shared_filters = []
    status_filter = None
    filters = list(base_where)

    if intent_level:
        try:
            intent_enum = IntentLevel(intent_level)
        except ValueError:
            return {
                "total": 0,
                "list_total": 0,
                "counts": {"已联系": 0, "未接": 0, "待回访": 0},
                "list": [],
            }
        shared_filters.append(Student.intent_level == intent_enum)

    if status:
        try:
            status_enum = canonical_student_status(StudentStatus(status))
            status_filter = Student.status.in_(statuses_for_canonical(status_enum))
            filters.append(status_filter)
        except ValueError:
            pass

    if status_detail and status_detail.strip():
        shared_filters.append(Student.status_detail == status_detail.strip())

    if search and search.strip():
        shared_filters.append(_agent_task_search_predicate(search.strip()))

    region_filter = None
    if region and region.strip():
        region_filter = Student.region == region.strip()
        filters.append(region_filter)

    group_filter = await _personal_group_predicate(db, agent_id, personal_group_id, ungrouped)
    if group_filter is not None:
        shared_filters.append(group_filter)

    filters.extend(shared_filters)
    count_filters = list(base_where) + shared_filters
    if region_filter is not None:
        count_filters.append(region_filter)
    region_group_filters = list(base_where) + shared_filters
    if status_filter is not None:
        region_group_filters.append(status_filter)

    # 统计各状态数量：受搜索和意向筛选影响，但不受当前状态标签影响。
    counts_r = await db.execute(
        select(Student.status, func.count()).where(*count_filters).group_by(Student.status)
    )
    counts = {status: cnt for status, cnt in counts_r.all()}
    stats = build_task_stats(counts, total_statuses=AGENT_HANDLED_TASK_STATUSES)
    total = stats["done"] + stats["follow_up"]
    count_payload = {
        "已联系": stats["done"],
        "未接": sum(
            int(counts.get(status, 0) or 0)
            for status in statuses_for_canonical(StudentStatus.not_reached)
        ),
        "待回访": sum(
            int(counts.get(status, 0) or 0)
            for status in statuses_for_canonical(StudentStatus.pending_visit)
        ),
    }
    list_total = (
        await db.execute(select(func.count(Student.id)).where(*filters))
    ).scalar_one() or 0

    regions_r = await db.execute(
        select(Student.region, func.count()).where(*region_group_filters).group_by(Student.region)
    )
    regions = sorted(
        ({"name": name or "未知区域", "count": cnt} for name, cnt in regions_r.all()),
        key=lambda x: (-x["count"], x["name"]),
    )

    next_follow_up = (
        select(
            FollowUp.student_id,
            func.min(FollowUp.follow_up_date).label("next_follow_up_at"),
        )
        .where(
            FollowUp.agent_id == agent_id,
            FollowUp.is_completed.is_(False),
        )
        .group_by(FollowUp.student_id)
        .subquery()
    )

    result = await db.execute(
        select(Student)
        .outerjoin(next_follow_up, next_follow_up.c.student_id == Student.id)
        .where(*filters)
        .order_by(
            next_follow_up.c.next_follow_up_at.is_(None),
            next_follow_up.c.next_follow_up_at.asc(),
            _handled_status_priority_expr(),
            _intent_priority_expr(),
            Student.updated_at.asc(),
            Student.id.asc(),
        )
        .offset(offset)
        .limit(limit)
    )
    students = result.scalars().all()
    groups_by_student = await _personal_groups_by_student(
        db, agent_id, [student.id for student in students]
    )

    return {
        "total": total,
        "list_total": list_total,
        "counts": count_payload,
        "regions": regions,
        "list": [
            {
                "id": s.id,
                "name": s.name,
                "region": s.region,
                "score": s.score,
                "guardian_name": s.guardian_name,
                "guardian_phone": mask_phone(s.guardian_phone),
                "school_name": s.school_name,
                "status": canonical_status_value(s.status),
                "status_detail": status_detail_value(s.status, s.status_detail),
                "stage": s.stage,
                "intent_level": s.intent_level,
                "personal_groups": groups_by_student.get(s.id, []),
            }
            for s in students
        ],
    }


async def yesterday_review(db: AsyncSession, agent_id: int) -> dict:
    today = today_cst_as_utc()
    yesterday = today - timedelta(days=1)

    calls_result = await db.execute(
        select(func.count(Call.id)).where(
            Call.agent_id == agent_id, Call.created_at >= yesterday, Call.created_at < today
        )
    )
    yesterday_calls = calls_result.scalar() or 0

    a_result = await db.execute(
        select(func.count(func.distinct(OperationLog.target_student_id)))
        .select_from(OperationLog)
        .join(Student, Student.id == OperationLog.target_student_id)
        .where(
            Student.assigned_to == agent_id,
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
            Call.agent_id == agent_id,
            Call.created_at >= yesterday,
            Call.created_at < today,
        )
    )
    yesterday_contacted = contacted_yday_r.scalar() or 0
    conversion = round(yesterday_a / yesterday_contacted * 100, 1) if yesterday_contacted > 0 else 0

    assigned_result = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == agent_id,
            Student.assigned_at >= yesterday,
            Student.assigned_at < today,
        )
        .order_by(Student.assigned_at.desc())
        .limit(20)
    )
    assigned_list = [
        {
            "id": s.id,
            "name": s.name,
            "status": canonical_status_value(s.status),
            "status_detail": status_detail_value(s.status, s.status_detail),
            "assigned_at": str(s.assigned_at),
        }
        for s in assigned_result.scalars().all()
    ]

    tomorrow = today + timedelta(days=1)
    follow_up_result = await db.execute(
        select(FollowUp, Student)
        .join(Student, Student.id == FollowUp.student_id)
        .where(
            FollowUp.agent_id == agent_id,
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
            "status": canonical_status_value(student.status),
            "status_detail": status_detail_value(student.status, student.status_detail),
        }
        for fu, student in follow_up_result.all()
    ]

    # 昨日及更早分配但仍未联系的学员：昨日没干完的活
    stale_r = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == agent_id,
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

    return {
        "yesterday_calls": yesterday_calls,
        "yesterday_a": yesterday_a,
        "conversion_rate": conversion,
        "list": assigned_list,
        "follow_up_list": follow_up_list,
        "stale_unconcat": stale_list,
    }


async def following_students(db: AsyncSession, agent_id: int) -> dict:
    """跟进中：有意向但尚未报名/无效的学员"""
    result = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == agent_id,
            Student.intent_level != IntentLevel.none,
            Student.status.in_(statuses_for_canonical(StudentStatus.pending_visit)),
        )
        .order_by(Student.updated_at.desc())
    )
    students = result.scalars().all()

    now = utcnow()
    items = []
    for s in students:
        days = (now - s.assigned_at).days if s.assigned_at else None
        items.append(
            {
                "id": s.id,
                "name": s.name,
                "region": s.region,
                "school_name": s.school_name,
                "stage": s.stage.value,
                "intent_level": s.intent_level.value,
                "status": canonical_status_value(s.status),
                "status_detail": status_detail_value(s.status, s.status_detail),
                "guardian_name": s.guardian_name,
                "guardian_phone": mask_phone(s.guardian_phone),
                "days_since_assigned": days,
            }
        )

    # 按意向等级统计
    intent_counts = {}
    for s in students:
        level = s.intent_level.value if hasattr(s.intent_level, "value") else str(s.intent_level)
        intent_counts[level] = intent_counts.get(level, 0) + 1

    return {"total": len(items), "intent_counts": intent_counts, "list": items}


async def backlog(db: AsyncSession, agent_id: int, days_threshold: int) -> dict:
    """当前话务员积压情况：分配超过 N 天且仍未到终态的学员数量与最久天数。"""
    now = utcnow()
    cutoff = now - timedelta(days=days_threshold)

    result = await db.execute(
        select(
            func.count(Student.id),
            func.min(Student.assigned_at),
        ).where(
            Student.assigned_to == agent_id,
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            Student.assigned_at.isnot(None),
            Student.assigned_at < cutoff,
        )
    )
    row = result.one()
    count = int(row[0] or 0)
    oldest_at = row[1]
    oldest_days = (now - oldest_at).days if oldest_at else 0

    return {"count": count, "oldest_days": oldest_days, "threshold_days": days_threshold}
