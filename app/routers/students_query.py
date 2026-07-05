from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ADMIN_PAGE_LEADS_MANAGE, get_current_user, require_page_permission
from app.database import get_db
from app.models import (
    Call,
    CampusVisitTask,
    EnrollmentRecord,
    FollowUp,
    HomeVisitTask,
    IntentLevel,
    LeadViewLog,
    Note,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
    User,
    Visit,
)
from app.permissions import apply_student_scope, get_accessible_student, is_admin
from app.routers.students import (
    _require_admin_leads_manage,
    _stage_filter_values,
    _student_payload,
)
from app.schemas import Response
from app.status_policy import canonical_student_status, statuses_for_canonical
from app.task_stats import ACTIVE_TASK_STATUSES
from app.utils import is_phone_query, normalize_phone, today_cst_as_utc

router = APIRouter(prefix="/api/students", tags=["学生"])


@router.get("")
async def list_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str = Query(""),
    status: str = Query(""),
    status_detail: str = Query(""),
    intent_level: str = Query(""),
    assigned_to: int = Query(None),
    assignment: str = Query(""),
    region: str = Query(""),
    stage: str = Query(""),
    need_help: str = Query(""),
    school_name: str = Query(""),
    active: str = Query(""),
    today_a: str = Query(""),
    missing_phone: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_leads_manage(current_user)
    query = apply_student_scope(select(Student), current_user)
    if q:
        q = q.strip()
        if is_phone_query(q):
            phone_q = normalize_phone(q)
            query = query.where(
                or_(
                    Student.guardian_phone == phone_q,
                    Student.guardian2_phone == phone_q,
                )
            )
        else:
            query = query.where(
                or_(
                    Student.name.contains(q),
                    Student.region.contains(q),
                    Student.school_name.contains(q),
                    Student.guardian_name.contains(q),
                )
            )
    if status:
        # SAEnum 列存的是 enum.name（英文），前端传的是 value（中文）。
        # 转成 enum 实例后 SQLAlchemy 才会正确映射为 name 进 SQL。
        try:
            status_enum = canonical_student_status(StudentStatus(status))
        except ValueError:
            return Response.ok({"total": 0, "page": page, "page_size": page_size, "list": []})
        query = query.where(Student.status.in_(statuses_for_canonical(status_enum)))
    else:
        query = query.where(Student.status.not_in(statuses_for_canonical(StudentStatus.invalid)))
    if status_detail:
        query = query.where(Student.status_detail == status_detail)
    if intent_level:
        try:
            intent_enum = IntentLevel(intent_level)
        except ValueError:
            return Response.ok({"total": 0, "page": page, "page_size": page_size, "list": []})
        query = query.where(Student.intent_level == intent_enum)
    if assignment == "unassigned" or assigned_to == 0:
        if not is_admin(current_user):
            raise HTTPException(status_code=403, detail="无权查看未分配学生")
        query = query.where(Student.assigned_to.is_(None))
    elif assigned_to is not None:
        if not is_admin(current_user) and assigned_to != current_user.id:
            raise HTTPException(status_code=403, detail="无权查看其他坐席的学生")
        query = query.where(Student.assigned_to == assigned_to)
    if region:
        query = query.where(Student.region == region)
    if school_name:
        query = query.where(Student.school_name == school_name)
    if stage:
        try:
            stage_enum = StudentStage(stage)
        except ValueError:
            return Response.ok({"total": 0, "page": page, "page_size": page_size, "list": []})
        query = query.where(Student.stage.in_(_stage_filter_values(stage_enum)))
    if need_help == "1":
        query = query.where(Student.need_help)
    if active == "1":
        query = query.where(Student.status.in_(ACTIVE_TASK_STATUSES))
    if missing_phone == "1":
        query = query.where(
            or_(
                Student.guardian_phone == "",
                Student.guardian_phone.is_(None),
            ),
            or_(
                Student.guardian2_phone == "",
                Student.guardian2_phone.is_(None),
            ),
        )
    if today_a == "1":
        today = today_cst_as_utc()
        tomorrow = today + timedelta(days=1)
        today_a_student_ids = (
            select(OperationLog.target_student_id)
            .where(
                OperationLog.action.in_(["AI分析", "手动评级"]),
                OperationLog.new_status == "A",
                OperationLog.old_status != "A",
                OperationLog.created_at >= today,
                OperationLog.created_at < tomorrow,
                OperationLog.target_student_id.is_not(None),
            )
            .distinct()
        )
        query = query.where(Student.id.in_(today_a_student_ids))

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    query = (
        query.offset((page - 1) * page_size).limit(page_size).order_by(Student.created_at.desc())
    )
    result = await db.execute(query)
    students = result.scalars().all()

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "list": [_student_payload(s) for s in students],
        }
    )


@router.get("/enrolled")
async def enrolled_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """已报名学生列表（含报名信息）"""
    query = (
        select(Student)
        .where(Student.status == StudentStatus.enrolled)
        .order_by(Student.enrolled_at.desc().nullslast())
    )
    query = apply_student_scope(query, current_user)
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()
    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    students = result.scalars().all()

    # Batch load agent names
    agent_ids = list({s.assigned_to for s in students if s.assigned_to})
    agent_map = {}
    if agent_ids:
        agent_r = await db.execute(select(User.id, User.name).where(User.id.in_(agent_ids)))
        agent_map = dict(agent_r.all())

    data = [
        {
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "program": s.program,
            "deposit": s.deposit,
            "enrolled_at": str(s.enrolled_at) if s.enrolled_at else None,
            "agent_name": agent_map.get(s.assigned_to, ""),
        }
        for s in students
    ]

    deposit_query = apply_student_scope(
        select(func.sum(Student.deposit)).where(Student.status == StudentStatus.enrolled),
        current_user,
    )
    deposit_total = await db.execute(deposit_query)
    total_deposit = deposit_total.scalar() or 0

    return Response.ok(
        {
            "total": total,
            "total_deposit": total_deposit,
            "page": page,
            "page_size": page_size,
            "list": data,
        }
    )


@router.get("/dispatch-regions")
async def list_dispatch_regions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEADS_MANAGE)),
):
    """获取「未分配且有学校名」学生的区县列表及其未分配人数。"""
    result = await db.execute(
        select(Student.region, func.count(Student.id))
        .where(
            Student.school_name != "",
            Student.region != "",
            Student.assigned_to.is_(None),
        )
        .group_by(Student.region)
        .order_by(func.count(Student.id).desc())
    )
    regions = [{"name": row[0], "count": row[1]} for row in result.all()]
    return Response.ok(regions)


@router.get("/schools")
async def list_schools(
    regions: list[str] = Query(default=[]),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEADS_MANAGE)),
):
    """获取有未分配学生的学校列表及其未分配数量。

    可选 regions：仅统计属于这些区县的未分配学生。
    """
    cleaned_regions = [r.strip() for r in regions if r and r.strip()]
    conditions = [Student.school_name != "", Student.assigned_to.is_(None)]
    if cleaned_regions:
        conditions.append(Student.region.in_(cleaned_regions))
    result = await db.execute(
        select(Student.school_name, func.count(Student.id))
        .where(*conditions)
        .group_by(Student.school_name)
        .order_by(func.count(Student.id).desc())
    )
    schools = [{"name": row[0], "count": row[1]} for row in result.all()]
    return Response.ok(schools)


@router.get("/{student_id}/intent-timeline")
async def get_intent_timeline(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)

    result = await db.execute(
        select(Call.id, Call.ai_intent, Call.ai_confidence, Call.agent_id, Call.created_at)
        .where(Call.student_id == student.id, Call.ai_intent != "", Call.ai_intent != "无")
        .order_by(Call.created_at.asc())
    )
    timeline = [
        {
            "call_id": call_id,
            "intent": ai_intent,
            "confidence": ai_confidence,
            "agent_id": agent_id,
            "at": str(created_at),
        }
        for call_id, ai_intent, ai_confidence, agent_id, created_at in result.all()
    ]

    return Response.ok(
        {
            "student_id": student.id,
            "current_intent": str(student.intent_level),
            "created_at": str(student.created_at),
            "timeline": timeline,
        }
    )


@router.get("/{student_id}/detail")
async def get_student_detail(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """聚合学生所有维度信息：基本资料 + 通话 + 备注 + 回访 + 到访 + 意向轨迹。"""
    _require_admin_leads_manage(current_user)
    student = await get_accessible_student(db, student_id, current_user)

    log = LeadViewLog(student_id=student.id, viewer_id=current_user.id)
    db.add(log)

    # 学生基本信息
    payload = _student_payload(student)
    payload["enrollment_substage"] = (
        str(student.enrollment_substage) if student.enrollment_substage else None
    )

    # 通话（最近 50）
    calls_r = await db.execute(
        select(Call, User.name)
        .outerjoin(User, Call.agent_id == User.id)
        .where(Call.student_id == student.id)
        .order_by(Call.created_at.desc())
        .limit(50)
    )
    calls = [
        {
            "id": c.id,
            "agent_id": c.agent_id,
            "agent_name": agent_name or "",
            "duration_seconds": c.duration_seconds,
            "ai_intent": c.ai_intent,
            "ai_confidence": c.ai_confidence,
            "ai_summary": c.ai_summary,
            "ai_reasons": c.ai_reasons,
            "created_at": str(c.created_at),
        }
        for c, agent_name in calls_r.all()
    ]

    # 备注（最近 50）
    notes_r = await db.execute(
        select(Note, User.name)
        .outerjoin(User, Note.agent_id == User.id)
        .where(Note.student_id == student.id)
        .order_by(Note.created_at.desc())
        .limit(50)
    )
    notes = [
        {
            "id": n.id,
            "content": n.content,
            "source": n.source,
            "agent_id": n.agent_id,
            "agent_name": agent_name or "",
            "created_at": str(n.created_at),
            "updated_at": str(n.updated_at),
        }
        for n, agent_name in notes_r.all()
    ]

    # 回访（全部）
    fu_r = await db.execute(
        select(FollowUp, User.name)
        .outerjoin(User, FollowUp.agent_id == User.id)
        .where(FollowUp.student_id == student.id)
        .order_by(FollowUp.follow_up_date.desc())
    )
    follow_ups = [
        {
            "id": f.id,
            "agent_id": f.agent_id,
            "agent_name": agent_name or "",
            "follow_up_date": str(f.follow_up_date),
            "follow_up_type": f.follow_up_type or "",
            "notes": f.notes or "",
            "is_completed": f.is_completed,
            "is_notified": f.is_notified,
            "created_at": str(f.created_at),
        }
        for f, agent_name in fu_r.all()
    ]

    # 到访（全部）
    visits_r = await db.execute(
        select(Visit, User.name)
        .outerjoin(User, Visit.agent_id == User.id)
        .where(Visit.student_id == student.id)
        .order_by(Visit.scheduled_date.desc())
    )
    visits = [
        {
            "id": v.id,
            "agent_id": v.agent_id,
            "agent_name": agent_name or "",
            "visit_type": str(v.visit_type),
            "scheduled_date": str(v.scheduled_date),
            "status": str(v.status),
            "notes": v.notes or "",
            "created_at": str(v.created_at),
        }
        for v, agent_name in visits_r.all()
    ]

    home_visits_r = await db.execute(
        select(HomeVisitTask, User.name)
        .outerjoin(User, HomeVisitTask.creator_agent_id == User.id)
        .where(HomeVisitTask.student_id == student.id)
        .order_by(HomeVisitTask.created_at.desc())
    )
    home_visit_events = [
        {
            "type": "home_visit",
            "id": task.id,
            "title": "申请家访",
            "status": task.status.value,
            "result": task.result.value if task.result else "",
            "operator_name": agent_name or "",
            "occurred_at": str(task.created_at),
            "scheduled_at": str(task.scheduled_at) if task.scheduled_at else None,
            "summary": task.address or task.notes or "",
        }
        for task, agent_name in home_visits_r.all()
    ]

    campus_visits_r = await db.execute(
        select(CampusVisitTask, User.name)
        .outerjoin(User, CampusVisitTask.creator_user_id == User.id)
        .where(CampusVisitTask.student_id == student.id)
        .order_by(CampusVisitTask.created_at.desc())
    )
    campus_visit_events = [
        {
            "type": "campus_visit",
            "id": task.id,
            "title": "预约到校",
            "status": task.status.value,
            "result": task.result.value if task.result else "",
            "operator_name": user_name or "",
            "occurred_at": str(task.created_at),
            "scheduled_at": str(task.appointment_at) if task.appointment_at else None,
            "summary": task.current_concerns or task.notes or "",
        }
        for task, user_name in campus_visits_r.all()
    ]

    enrollments_r = await db.execute(
        select(EnrollmentRecord, User.name)
        .outerjoin(User, EnrollmentRecord.attributed_agent_id == User.id)
        .where(EnrollmentRecord.student_id == student.id)
        .order_by(EnrollmentRecord.enrolled_at.desc())
    )
    enrollment_events = [
        {
            "type": "enrollment",
            "id": record.id,
            "title": "报名登记",
            "status": record.settlement_status.value,
            "result": record.source.value,
            "operator_name": agent_name or "",
            "occurred_at": str(record.enrolled_at),
            "scheduled_at": None,
            "summary": record.enrolled_program or record.intent_program or "",
        }
        for record, agent_name in enrollments_r.all()
    ]

    admissions_timeline = sorted(
        home_visit_events + campus_visit_events + enrollment_events,
        key=lambda item: item.get("occurred_at") or "",
        reverse=True,
    )

    # 意向轨迹：合并 AI 分析（Call）和手动评级（OperationLog）
    intent_r = await db.execute(
        select(Call.id, Call.ai_intent, Call.ai_confidence, Call.agent_id, Call.created_at)
        .where(Call.student_id == student.id, Call.ai_intent != "", Call.ai_intent != "无")
        .order_by(Call.created_at.asc())
    )
    ai_events = [
        {
            "source": "ai",
            "intent_level": ai_intent,
            "confidence": ai_conf,
            "agent_id": aid,
            "created_at": str(created_at),
        }
        for cid, ai_intent, ai_conf, aid, created_at in intent_r.all()
    ]

    manual_r = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.target_student_id == student.id,
            OperationLog.action == "手动评级",
        )
        .order_by(OperationLog.created_at.asc())
    )
    manual_events = [
        {
            "source": "manual",
            "intent_level": log.new_status or "无",
            "old_intent": log.old_status or "",
            "operator_name": log.operator_name or "",
            "created_at": str(log.created_at),
        }
        for log in manual_r.scalars().all()
    ]

    # 合并并按时间排序
    intent_timeline = sorted(
        ai_events + manual_events,
        key=lambda x: x.get("created_at", ""),
    )

    await db.commit()

    return Response.ok(
        {
            "student": payload,
            "calls": calls,
            "notes": notes,
            "follow_ups": follow_ups,
            "visits": visits,
            "admissions_timeline": admissions_timeline,
            "intent_timeline": intent_timeline,
        }
    )


@router.get("/{student_id}")
async def get_student(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_leads_manage(current_user)
    student = await get_accessible_student(db, student_id, current_user)

    log = LeadViewLog(student_id=student.id, viewer_id=current_user.id)
    db.add(log)
    await db.commit()

    return Response.ok(_student_payload(student))
