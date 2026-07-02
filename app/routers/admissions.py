import asyncio
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import get_current_user
from app.database import get_db
from app.models import (
    AttributionMethod,
    CampusVisitTask,
    CampusVisitResult,
    CampusVisitStatus,
    EnrollmentRecord,
    EnrollmentSource,
    FollowUp,
    HomeVisitResult,
    HomeVisitStatus,
    HomeVisitTask,
    SettlementStatus,
    Student,
    StudentStage,
    StudentStatus,
    User,
    UserRole,
)
from app.permissions import get_accessible_student, is_admin
from app.pushplus import notify_home_visit_created_background
from app.schemas import (
    CampusVisitCreate,
    CampusVisitUpdate,
    EnrollmentCreate,
    EnrollmentUpdate,
    HomeVisitCreate,
    HomeVisitUpdate,
    Response,
)
from app.utils import make_operation_log

router = APIRouter(prefix="/api/admissions", tags=["招生推进"])

HOME_VISIT_TERMINAL_STATUSES = {
    HomeVisitStatus.completed,
    HomeVisitStatus.cancelled,
}
AGENT_HOME_VISIT_EDIT_FIELDS = {
    "requested_visit_time",
    "address",
    "priority",
    "notes",
}
ADMIN_HOME_VISIT_RESULT_FIELDS = {
    "status",
    "result",
    "assigned_admin_id",
    "scheduled_at",
    "postpone_reason",
    "guardian_attitude",
    "student_attitude",
    "concerns",
    "next_action",
    "next_follow_up_at",
    "result_notes",
}
CAMPUS_VISIT_OPEN_STATUSES = {
    CampusVisitStatus.pending,
    CampusVisitStatus.scheduled,
    CampusVisitStatus.rescheduled,
}
WORK_ITEM_QUEUES = {"all", "home_visit", "campus_visit", "follow_up", "settlement", "help"}
WORK_ITEM_QUEUE_ALIASES = {"follow": "follow_up", "visit": "campus_visit"}
WORK_ITEM_PRIORITY_WEIGHT = {"high": 3, "normal": 2, "low": 1}
SETTLEMENT_WORK_STATUSES = {
    SettlementStatus.disputed,
    SettlementStatus.postponed,
    SettlementStatus.unsettled,
}
HOME_VISIT_WORK_STATUSES = {
    HomeVisitStatus.pending,
    HomeVisitStatus.confirmed,
    HomeVisitStatus.scheduled,
    HomeVisitStatus.completed,
    HomeVisitStatus.postponed,
}
HOME_VISIT_NEXT_RESULTS = {
    HomeVisitResult.considering,
    HomeVisitResult.waiting_score,
    HomeVisitResult.campus_visit,
}
CAMPUS_VISIT_WORK_STATUSES = {
    CampusVisitStatus.pending,
    CampusVisitStatus.scheduled,
    CampusVisitStatus.rescheduled,
    CampusVisitStatus.arrived,
    CampusVisitStatus.no_show,
}
CAMPUS_VISIT_NEXT_RESULTS = {
    CampusVisitResult.arrived,
    CampusVisitResult.no_show,
    CampusVisitResult.rescheduled,
    CampusVisitResult.considering,
}
AGENT_CAMPUS_VISIT_EDIT_FIELDS = {
    "appointment_at",
    "needs_pickup",
    "visitor_count",
    "current_concerns",
    "notes",
}
ADMIN_CAMPUS_VISIT_RESULT_FIELDS = {
    "status",
    "result",
    "reception_admin_id",
    "reception_content",
    "guardian_attitude",
    "student_attitude",
    "onsite_enrolled",
    "not_enrolled_reason",
    "next_action",
    "next_follow_up_at",
    "result_notes",
}
STAGE_RANK = {
    StudentStage.initial_contact: 0,
    StudentStage.interested: 1,
    StudentStage.materials_sent: 2,
    StudentStage.home_visit_pending: 3,
    StudentStage.home_visit_scheduled: 4,
    StudentStage.home_visit_completed: 5,
    StudentStage.campus_visit_pending: 6,
    StudentStage.campus_visit_scheduled: 7,
    StudentStage.campus_visit_arrived: 8,
    StudentStage.visit_scheduled: 7,
    StudentStage.visited: 8,
    StudentStage.enrolled: 9,
}


def _advance_student_stage(student: Student, stage: StudentStage) -> None:
    if STAGE_RANK.get(stage, 0) > STAGE_RANK.get(student.stage, 0):
        student.stage = stage


def _mark_student_enrolled(student: Student, enrolled_at=None) -> None:
    student.status = StudentStatus.enrolled
    student.stage = StudentStage.enrolled
    if enrolled_at is not None:
        student.enrolled_at = enrolled_at.date()
    elif not student.enrolled_at:
        student.enrolled_at = date.today()


def _page_payload(total: int, page: int, page_size: int, rows: list[dict]) -> dict:
    return {"total": total, "page": page, "page_size": page_size, "list": rows}


def _home_visit_payload(task: HomeVisitTask, enrollment_id: int | None = None) -> dict:
    return {
        "id": task.id,
        "student_id": task.student_id,
        "student_name": task.student_name_snapshot,
        "guardian_phone": task.guardian_phone_snapshot,
        "region": task.region_snapshot,
        "school_name": task.school_name_snapshot,
        "creator_agent_id": task.creator_agent_id,
        "creator_agent_name": task.creator_agent.name if task.creator_agent else "",
        "assigned_admin_id": task.assigned_admin_id,
        "assigned_admin_name": task.assigned_admin.name if task.assigned_admin else "",
        "status": task.status.value,
        "result": task.result.value if task.result else "",
        "priority": task.priority,
        "intent_program": task.intent_program,
        "exam_score": task.exam_score,
        "usual_score": task.usual_score,
        "parent_intent": task.parent_intent,
        "student_situation": task.student_situation,
        "is_wechat_added": task.is_wechat_added,
        "is_confirmed_with_guardian": task.is_confirmed_with_guardian,
        "requested_visit_time": str(task.requested_visit_time) if task.requested_visit_time else None,
        "scheduled_at": str(task.scheduled_at) if task.scheduled_at else None,
        "address": task.address,
        "postpone_reason": task.postpone_reason,
        "guardian_attitude": task.guardian_attitude,
        "student_attitude": task.student_attitude,
        "concerns": task.concerns,
        "next_action": task.next_action,
        "next_follow_up_at": str(task.next_follow_up_at) if task.next_follow_up_at else None,
        "notes": task.notes,
        "result_notes": task.result_notes,
        "enrollment_id": enrollment_id,
        "created_at": str(task.created_at),
        "updated_at": str(task.updated_at),
    }


def _campus_visit_payload(task: CampusVisitTask, enrollment_id: int | None = None) -> dict:
    return {
        "id": task.id,
        "student_id": task.student_id,
        "student_name": task.student_name_snapshot,
        "guardian_phone": task.guardian_phone_snapshot,
        "region": task.region_snapshot,
        "school_name": task.school_name_snapshot,
        "creator_user_id": task.creator_user_id,
        "creator_user_name": task.creator_user.name if task.creator_user else "",
        "reception_admin_id": task.reception_admin_id,
        "reception_admin_name": task.reception_admin.name if task.reception_admin else "",
        "home_visit_task_id": task.home_visit_task_id,
        "status": task.status.value,
        "result": task.result.value if task.result else "",
        "source": task.source,
        "intent_program": task.intent_program,
        "appointment_at": str(task.appointment_at) if task.appointment_at else None,
        "needs_pickup": task.needs_pickup,
        "visitor_count": task.visitor_count,
        "current_concerns": task.current_concerns,
        "reception_content": task.reception_content,
        "guardian_attitude": task.guardian_attitude,
        "student_attitude": task.student_attitude,
        "onsite_enrolled": task.onsite_enrolled,
        "not_enrolled_reason": task.not_enrolled_reason,
        "next_action": task.next_action,
        "next_follow_up_at": str(task.next_follow_up_at) if task.next_follow_up_at else None,
        "notes": task.notes,
        "result_notes": task.result_notes,
        "enrollment_id": enrollment_id,
        "created_at": str(task.created_at),
        "updated_at": str(task.updated_at),
    }


def _enrollment_payload(record: EnrollmentRecord) -> dict:
    return {
        "id": record.id,
        "student_id": record.student_id,
        "student_name": record.student_name_snapshot,
        "guardian_phone": record.guardian_phone_snapshot,
        "region": record.region_snapshot,
        "school_name": record.school_name_snapshot,
        "attributed_agent_id": record.attributed_agent_id,
        "attributed_agent_name": record.attributed_agent.name if record.attributed_agent else "",
        "confirmed_by_admin_id": record.confirmed_by_admin_id,
        "confirmed_by_admin_name": record.confirmed_by_admin.name
        if record.confirmed_by_admin
        else "",
        "source": record.source.value,
        "attribution_method": record.attribution_method.value,
        "settlement_status": record.settlement_status.value,
        "enrolled_program": record.enrolled_program,
        "enrolled_at": str(record.enrolled_at),
        "amount": record.amount,
        "created_at": str(record.created_at),
        "updated_at": str(record.updated_at),
    }


async def _get_home_visit_or_404(db: AsyncSession, task_id: int) -> HomeVisitTask:
    result = await db.execute(
        select(HomeVisitTask)
        .where(HomeVisitTask.id == task_id)
        .options(joinedload(HomeVisitTask.creator_agent), joinedload(HomeVisitTask.assigned_admin))
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="家访任务不存在")
    return task


async def _load_home_visit_payload(db: AsyncSession, task_id: int) -> dict:
    task = await _get_home_visit_or_404(db, task_id)
    enrollment = await _find_existing_enrollment(
        db,
        task.student_id,
        home_visit_task_id=task.id,
    )
    return _home_visit_payload(task, enrollment.id if enrollment else None)


async def _get_campus_visit_or_404(db: AsyncSession, task_id: int) -> CampusVisitTask:
    result = await db.execute(
        select(CampusVisitTask)
        .where(CampusVisitTask.id == task_id)
        .options(
            joinedload(CampusVisitTask.creator_user),
            joinedload(CampusVisitTask.reception_admin),
        )
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise HTTPException(status_code=404, detail="到校参观任务不存在")
    return task


async def _load_campus_visit_payload(db: AsyncSession, task_id: int) -> dict:
    task = await _get_campus_visit_or_404(db, task_id)
    enrollment = await _find_existing_enrollment(
        db,
        task.student_id,
        campus_visit_task_id=task.id,
    )
    return _campus_visit_payload(task, enrollment.id if enrollment else None)


async def _get_enrollment_or_404(db: AsyncSession, record_id: int) -> EnrollmentRecord:
    result = await db.execute(
        select(EnrollmentRecord)
        .where(EnrollmentRecord.id == record_id)
        .options(
            joinedload(EnrollmentRecord.attributed_agent),
            joinedload(EnrollmentRecord.confirmed_by_admin),
        )
    )
    record = result.scalar_one_or_none()
    if record is None:
        raise HTTPException(status_code=404, detail="报名记录不存在")
    return record


async def _load_enrollment_payload(db: AsyncSession, record_id: int) -> dict:
    return _enrollment_payload(await _get_enrollment_or_404(db, record_id))


async def _find_existing_enrollment(
    db: AsyncSession,
    student_id: int,
    home_visit_task_id: int | None = None,
    campus_visit_task_id: int | None = None,
) -> EnrollmentRecord | None:
    exact_conditions = []
    if home_visit_task_id is not None:
        exact_conditions.append(EnrollmentRecord.home_visit_task_id == home_visit_task_id)
    if campus_visit_task_id is not None:
        exact_conditions.append(EnrollmentRecord.campus_visit_task_id == campus_visit_task_id)
    if exact_conditions:
        exact = await db.execute(select(EnrollmentRecord).where(*exact_conditions))
        record = exact.scalar_one_or_none()
        if record is not None:
            return record

    result = await db.execute(
        select(EnrollmentRecord)
        .where(EnrollmentRecord.student_id == student_id)
        .order_by(EnrollmentRecord.created_at.asc(), EnrollmentRecord.id.asc())
    )
    return result.scalars().first()


async def _resolve_enrollment_attribution(
    db: AsyncSession,
    body: EnrollmentCreate,
    student: Student,
) -> tuple[int, AttributionMethod]:
    if body.attributed_agent_id is not None:
        return body.attributed_agent_id, AttributionMethod.manual

    if body.campus_visit_task_id is not None:
        campus_visit = await _get_campus_visit_or_404(db, body.campus_visit_task_id)
        if campus_visit.student_id != student.id:
            raise HTTPException(status_code=400, detail="到校参观任务不属于该学生")
        if campus_visit.creator_user and campus_visit.creator_user.role == UserRole.agent:
            return campus_visit.creator_user_id, AttributionMethod.campus_visit_creator
        if student.assigned_to is not None:
            return student.assigned_to, AttributionMethod.current_agent
        raise HTTPException(status_code=400, detail="到校预约人不是话务员，请手动选择报名归属")

    if body.home_visit_task_id is not None:
        home_visit = await _get_home_visit_or_404(db, body.home_visit_task_id)
        if home_visit.student_id != student.id:
            raise HTTPException(status_code=400, detail="家访任务不属于该学生")
        return home_visit.creator_agent_id, AttributionMethod.home_visit_creator

    if student.assigned_to is not None:
        return student.assigned_to, AttributionMethod.current_agent

    raise HTTPException(status_code=400, detail="当前学生没有负责话务员，请手动选择报名归属")


async def _create_enrollment_record(
    db: AsyncSession,
    body: EnrollmentCreate,
    student: Student,
    current_user: User,
    *,
    allow_existing: bool = False,
) -> EnrollmentRecord:
    existing = await _find_existing_enrollment(
        db,
        student.id,
        home_visit_task_id=body.home_visit_task_id,
        campus_visit_task_id=body.campus_visit_task_id,
    )
    if existing is not None:
        if allow_existing:
            _mark_student_enrolled(student, body.enrolled_at)
            return existing
        raise HTTPException(status_code=400, detail="该学生已有报名记录，不能重复登记")

    attributed_agent_id, attribution_method = await _resolve_enrollment_attribution(
        db, body, student
    )
    if attribution_method == AttributionMethod.manual and not body.attribution_reason.strip():
        raise HTTPException(status_code=400, detail="手动指定报名归属必须填写原因")

    enrolled_at = body.enrolled_at or func.now()
    record = EnrollmentRecord(
        student_id=student.id,
        attributed_agent_id=attributed_agent_id,
        confirmed_by_admin_id=current_user.id,
        first_assigned_agent_id=student.assigned_to,
        current_assigned_agent_id=student.assigned_to,
        last_effective_agent_id=student.assigned_to,
        home_visit_task_id=body.home_visit_task_id,
        campus_visit_task_id=body.campus_visit_task_id,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone or student.guardian2_phone or "",
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program=student.program or "",
        enrolled_program=body.enrolled_program or student.program or "",
        enrolled_at=enrolled_at,
        source=EnrollmentSource(body.source),
        attribution_method=attribution_method,
        attribution_reason=body.attribution_reason.strip(),
        amount=body.amount,
        settlement_status=SettlementStatus.unsettled,
        settlement_notes=body.settlement_notes,
    )
    _mark_student_enrolled(student, body.enrolled_at)
    student.program = record.enrolled_program
    student.deposit = body.amount if body.amount is not None else student.deposit
    db.add(record)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "报名登记",
            content=(
                f"报名归属话务员 {attributed_agent_id}；"
                f"来源：{body.source}；专业：{record.enrolled_program}"
            ),
        )
    )
    return record


def _as_dt(value) -> datetime | None:
    return value if isinstance(value, datetime) else None


def _is_overdue(value: datetime | None, now: datetime) -> bool:
    return bool(value and value < now)


def _work_priority(value: str | None, *, urgent: bool = False) -> str:
    if urgent:
        return "high"
    if value == "高":
        return "high"
    if value == "低":
        return "low"
    return "normal"


def _work_item(
    *,
    kind: str,
    source_id: int,
    queue: str,
    priority: str,
    title: str,
    student_id: int,
    student_name: str,
    region: str,
    school_name: str,
    agent_id: int | None,
    agent_name: str,
    due_at,
    status: str,
    reason: str,
    target_url: str,
    action_label: str,
    created_at,
) -> dict:
    return {
        "id": f"{kind}:{source_id}",
        "kind": kind,
        "queue": queue,
        "priority": priority,
        "title": title,
        "student_id": student_id,
        "student_name": student_name,
        "region": region,
        "school_name": school_name,
        "agent_id": agent_id,
        "agent_name": agent_name,
        "due_at": str(due_at) if due_at else None,
        "status": status,
        "reason": reason,
        "target_url": target_url,
        "action_label": action_label,
        "source_id": source_id,
        "created_at": str(created_at) if created_at else None,
    }


async def _build_home_visit_work_items(
    db: AsyncSession,
    current_user: User,
    now: datetime,
) -> list[dict]:
    conditions = [HomeVisitTask.status.in_(HOME_VISIT_WORK_STATUSES)]
    if not is_admin(current_user):
        conditions.append(HomeVisitTask.creator_agent_id == current_user.id)

    result = await db.execute(
        select(HomeVisitTask)
        .options(joinedload(HomeVisitTask.creator_agent))
        .where(*conditions)
        .order_by(HomeVisitTask.created_at.desc())
    )
    rows = []
    for task in result.scalars().unique().all():
        if task.status == HomeVisitStatus.completed and task.result not in HOME_VISIT_NEXT_RESULTS:
            continue
        if task.status == HomeVisitStatus.completed and not (
            task.next_follow_up_at
            or task.next_action
            or task.result == HomeVisitResult.campus_visit
        ):
            continue

        due_at = task.next_follow_up_at or task.scheduled_at or task.requested_visit_time
        overdue = _is_overdue(_as_dt(due_at), now)
        if task.status == HomeVisitStatus.pending:
            reason = "家访待确认"
            action_label = "处理家访"
        elif task.status == HomeVisitStatus.confirmed and not task.scheduled_at:
            reason = "家访待安排"
            action_label = "安排家访"
        elif task.status == HomeVisitStatus.completed:
            reason = "家访后待下一步"
            action_label = "继续推进"
        elif overdue:
            reason = "家访已超期"
            action_label = "处理超期家访"
        else:
            reason = "家访待处理"
            action_label = "处理家访"

        rows.append(
            _work_item(
                kind="home_visit",
                source_id=task.id,
                queue="home_visit",
                priority=_work_priority(task.priority, urgent=overdue),
                title=f"{task.student_name_snapshot or '学生'} 家访",
                student_id=task.student_id,
                student_name=task.student_name_snapshot,
                region=task.region_snapshot,
                school_name=task.school_name_snapshot,
                agent_id=task.creator_agent_id,
                agent_name=task.creator_agent.name if task.creator_agent else "",
                due_at=due_at,
                status=task.status.value,
                reason=reason,
                target_url="/admin/home-visits",
                action_label=action_label,
                created_at=task.created_at,
            )
        )
    return rows


async def _build_campus_visit_work_items(
    db: AsyncSession,
    current_user: User,
    now: datetime,
) -> list[dict]:
    conditions = [CampusVisitTask.status.in_(CAMPUS_VISIT_WORK_STATUSES)]
    if not is_admin(current_user):
        conditions.append(CampusVisitTask.creator_user_id == current_user.id)

    result = await db.execute(
        select(CampusVisitTask)
        .options(joinedload(CampusVisitTask.creator_user))
        .where(*conditions)
        .order_by(CampusVisitTask.created_at.desc())
    )
    rows = []
    for task in result.scalars().unique().all():
        if task.status in {CampusVisitStatus.arrived, CampusVisitStatus.no_show} and not (
            task.next_follow_up_at
            or task.next_action
            or task.result in CAMPUS_VISIT_NEXT_RESULTS
        ):
            continue

        due_at = task.next_follow_up_at or task.appointment_at
        overdue = _is_overdue(_as_dt(due_at), now)
        if task.status == CampusVisitStatus.pending:
            reason = "到校待预约"
            action_label = "预约到校"
        elif task.status in {CampusVisitStatus.arrived, CampusVisitStatus.no_show}:
            reason = "到校后待跟进"
            action_label = "继续跟进"
        elif overdue:
            reason = "到校已超期"
            action_label = "处理到校"
        else:
            reason = "到校待处理"
            action_label = "处理到校"

        rows.append(
            _work_item(
                kind="campus_visit",
                source_id=task.id,
                queue="campus_visit",
                priority=_work_priority(None, urgent=overdue),
                title=f"{task.student_name_snapshot or '学生'} 到校参观",
                student_id=task.student_id,
                student_name=task.student_name_snapshot,
                region=task.region_snapshot,
                school_name=task.school_name_snapshot,
                agent_id=task.creator_user_id,
                agent_name=task.creator_user.name if task.creator_user else "",
                due_at=due_at,
                status=task.status.value,
                reason=reason,
                target_url="/admin/campus-visits",
                action_label=action_label,
                created_at=task.created_at,
            )
        )
    return rows


async def _build_follow_up_work_items(
    db: AsyncSession,
    current_user: User,
    now: datetime,
) -> list[dict]:
    conditions = [FollowUp.is_completed.is_(False)]
    if not is_admin(current_user):
        conditions.append(FollowUp.agent_id == current_user.id)

    result = await db.execute(
        select(FollowUp, Student, User)
        .join(Student, Student.id == FollowUp.student_id)
        .join(User, User.id == FollowUp.agent_id)
        .where(*conditions)
        .order_by(FollowUp.follow_up_date.asc())
    )
    rows = []
    for follow, student, agent in result.all():
        overdue = _is_overdue(follow.follow_up_date, now)
        rows.append(
            _work_item(
                kind="follow_up",
                source_id=follow.id,
                queue="follow_up",
                priority="high" if overdue else "normal",
                title=f"{student.name} 回访",
                student_id=student.id,
                student_name=student.name,
                region=student.region,
                school_name=student.school_name,
                agent_id=agent.id,
                agent_name=agent.name,
                due_at=follow.follow_up_date,
                status="待回访",
                reason="逾期回访" if overdue else "待回访",
                target_url=f"/admin/leads/{student.id}",
                action_label="完成回访",
                created_at=follow.created_at,
            )
        )
    return rows


async def _build_settlement_work_items(db: AsyncSession, current_user: User) -> list[dict]:
    conditions = [EnrollmentRecord.settlement_status.in_(SETTLEMENT_WORK_STATUSES)]
    if not is_admin(current_user):
        conditions.append(EnrollmentRecord.attributed_agent_id == current_user.id)

    result = await db.execute(
        select(EnrollmentRecord)
        .options(joinedload(EnrollmentRecord.attributed_agent))
        .where(*conditions)
        .order_by(EnrollmentRecord.enrolled_at.desc())
    )
    rows = []
    for record in result.scalars().unique().all():
        urgent = record.settlement_status == SettlementStatus.disputed
        rows.append(
            _work_item(
                kind="settlement",
                source_id=record.id,
                queue="settlement",
                priority="high" if urgent else "normal",
                title=f"{record.student_name_snapshot or '学生'} 报名结算",
                student_id=record.student_id,
                student_name=record.student_name_snapshot,
                region=record.region_snapshot,
                school_name=record.school_name_snapshot,
                agent_id=record.attributed_agent_id,
                agent_name=record.attributed_agent.name if record.attributed_agent else "",
                due_at=record.enrolled_at,
                status=record.settlement_status.value,
                reason=f"结算{record.settlement_status.value}",
                target_url="/admin/enrollment-settlement",
                action_label="处理结算",
                created_at=record.created_at,
            )
        )
    return rows


async def _build_help_work_items(db: AsyncSession, current_user: User) -> list[dict]:
    conditions = [Student.need_help.is_(True)]
    if not is_admin(current_user):
        conditions.append(Student.assigned_to == current_user.id)

    result = await db.execute(
        select(Student, User)
        .outerjoin(User, User.id == Student.assigned_to)
        .where(*conditions)
        .order_by(Student.updated_at.desc())
    )
    rows = []
    for student, agent in result.all():
        rows.append(
            _work_item(
                kind="help",
                source_id=student.id,
                queue="help",
                priority="high",
                title=f"{student.name} 求助",
                student_id=student.id,
                student_name=student.name,
                region=student.region,
                school_name=student.school_name,
                agent_id=student.assigned_to,
                agent_name=agent.name if agent else "",
                due_at=student.updated_at,
                status=student.status.value,
                reason="话务员请求主管介入",
                target_url=f"/admin/leads/{student.id}",
                action_label="处理求助",
                created_at=student.created_at,
            )
        )
    return rows


@router.get("/work-items")
async def list_work_items(
    queue: str = Query("all"),
    priority: str = Query(""),
    region: str = Query(""),
    agent_id: int | None = Query(None),
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    normalized_queue = WORK_ITEM_QUEUE_ALIASES.get(queue, queue)
    if normalized_queue not in WORK_ITEM_QUEUES:
        raise HTTPException(status_code=422, detail="不支持的待办队列")

    now = datetime.now()
    rows: list[dict] = []
    if normalized_queue in {"all", "home_visit"}:
        rows.extend(await _build_home_visit_work_items(db, current_user, now))
    if normalized_queue in {"all", "campus_visit"}:
        rows.extend(await _build_campus_visit_work_items(db, current_user, now))
    if normalized_queue in {"all", "follow_up"}:
        rows.extend(await _build_follow_up_work_items(db, current_user, now))
    if normalized_queue in {"all", "settlement"}:
        rows.extend(await _build_settlement_work_items(db, current_user))
    if normalized_queue in {"all", "help"}:
        rows.extend(await _build_help_work_items(db, current_user))

    if priority:
        rows = [row for row in rows if row["priority"] == priority]
    if region:
        rows = [row for row in rows if region in (row["region"] or "")]
    if agent_id is not None:
        rows = [row for row in rows if row["agent_id"] == agent_id]

    rows.sort(
        key=lambda row: (
            -WORK_ITEM_PRIORITY_WEIGHT.get(row["priority"], 0),
            row["due_at"] or "9999-12-31 23:59:59",
            row["created_at"] or "",
        )
    )
    total = len(rows)
    start = (page - 1) * page_size
    return Response.ok(_page_payload(total, page, page_size, rows[start : start + page_size]))


@router.get("/home-visits")
async def list_home_visits(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conditions = []
    if not is_admin(current_user):
        conditions.append(Student.assigned_to == current_user.id)

    count_stmt = select(func.count(HomeVisitTask.id)).join(Student)
    query = (
        select(HomeVisitTask)
        .join(Student)
        .options(joinedload(HomeVisitTask.creator_agent), joinedload(HomeVisitTask.assigned_admin))
        .order_by(HomeVisitTask.created_at.desc())
    )
    if conditions:
        count_stmt = count_stmt.where(*conditions)
        query = query.where(*conditions)

    total = (await db.execute(count_stmt)).scalar() or 0
    result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    tasks = result.scalars().unique().all()
    enrollment_by_home_visit: dict[int, int] = {}
    if tasks:
        enrollment_rows = await db.execute(
            select(EnrollmentRecord.home_visit_task_id, EnrollmentRecord.id).where(
                EnrollmentRecord.home_visit_task_id.in_([task.id for task in tasks])
            )
        )
        enrollment_by_home_visit = {
            int(home_visit_id): int(enrollment_id)
            for home_visit_id, enrollment_id in enrollment_rows.all()
            if home_visit_id is not None
        }
    rows = [
        _home_visit_payload(task, enrollment_by_home_visit.get(task.id))
        for task in tasks
    ]
    return Response.ok(_page_payload(total, page, page_size, rows))


@router.post("/home-visits")
async def create_home_visit(
    body: HomeVisitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, body.student_id, current_user)
    creator_agent_id = current_user.id
    if is_admin(current_user) and student.assigned_to:
        creator_agent_id = student.assigned_to

    task = HomeVisitTask(
        student_id=student.id,
        creator_agent_id=creator_agent_id,
        status=HomeVisitStatus.pending,
        priority=body.priority,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone or student.guardian2_phone or "",
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program=body.intent_program or student.program or "",
        exam_score=body.exam_score if body.exam_score is not None else student.score,
        usual_score=body.usual_score,
        parent_intent=body.parent_intent,
        student_situation=body.student_situation,
        is_wechat_added=body.is_wechat_added,
        is_confirmed_with_guardian=body.is_confirmed_with_guardian,
        requested_visit_time=body.requested_visit_time,
        address=body.address,
        notes=body.notes,
    )
    _advance_student_stage(student, StudentStage.home_visit_pending)
    db.add(task)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "申请家访",
            content=f"家访申请：{student.name}；地址：{body.address or '未填写'}",
        )
    )
    await db.commit()
    await db.refresh(task)
    asyncio.create_task(notify_home_visit_created_background(task.id))
    return Response.ok(await _load_home_visit_payload(db, task.id))


@router.patch("/home-visits/{task_id}")
async def update_home_visit(
    task_id: int,
    body: HomeVisitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _get_home_visit_or_404(db, task_id)
    student = await get_accessible_student(db, task.student_id, current_user)
    changed_fields = body.model_fields_set

    if not is_admin(current_user):
        if task.creator_agent_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权修改他人的家访任务")
        if task.status in HOME_VISIT_TERMINAL_STATUSES:
            raise HTTPException(status_code=403, detail="已结束的家访任务不能由话务员修改")
        disallowed = changed_fields - AGENT_HOME_VISIT_EDIT_FIELDS
        if disallowed:
            raise HTTPException(status_code=403, detail="家访结果只能由管理员填写")
    else:
        disallowed = changed_fields - (AGENT_HOME_VISIT_EDIT_FIELDS | ADMIN_HOME_VISIT_RESULT_FIELDS)
        if disallowed:
            raise HTTPException(status_code=422, detail=f"不支持的字段: {', '.join(sorted(disallowed))}")

    old_status = task.status
    old_result = task.result

    for field in AGENT_HOME_VISIT_EDIT_FIELDS:
        value = getattr(body, field)
        if field in changed_fields and value is not None:
            setattr(task, field, value)

    if is_admin(current_user):
        if "status" in changed_fields and body.status is not None:
            task.status = HomeVisitStatus(body.status)
        if "result" in changed_fields and body.result is not None:
            task.result = HomeVisitResult(body.result)
        for field in (
            "assigned_admin_id",
            "scheduled_at",
            "postpone_reason",
            "guardian_attitude",
            "student_attitude",
            "concerns",
            "next_action",
            "next_follow_up_at",
            "result_notes",
        ):
            value = getattr(body, field)
            if field in changed_fields and value is not None:
                setattr(task, field, value)
        if task.result == HomeVisitResult.enrolled:
            await _create_enrollment_record(
                db,
                EnrollmentCreate(
                    student_id=student.id,
                    source=EnrollmentSource.home_visit.value,
                    home_visit_task_id=task.id,
                    enrolled_program=student.program or task.intent_program or "",
                ),
                student,
                current_user,
                allow_existing=True,
            )
        elif task.result == HomeVisitResult.campus_visit:
            _advance_student_stage(student, StudentStage.campus_visit_pending)
        elif task.status == HomeVisitStatus.completed:
            _advance_student_stage(student, StudentStage.home_visit_completed)
        elif task.status in {HomeVisitStatus.confirmed, HomeVisitStatus.scheduled}:
            _advance_student_stage(student, StudentStage.home_visit_scheduled)

    if old_status != task.status or old_result != task.result:
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "处理家访",
                content=f"家访 #{task.id}",
                old_status=old_status.value if old_status else "",
                new_status=task.status.value if task.status else "",
                note_content=task.result.value if task.result else "",
            )
        )

    await db.commit()
    return Response.ok(await _load_home_visit_payload(db, task.id))


@router.get("/campus-visits")
async def list_campus_visits(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conditions = []
    if not is_admin(current_user):
        conditions.append(Student.assigned_to == current_user.id)

    count_stmt = select(func.count(CampusVisitTask.id)).join(Student)
    query = (
        select(CampusVisitTask)
        .join(Student)
        .options(
            joinedload(CampusVisitTask.creator_user),
            joinedload(CampusVisitTask.reception_admin),
        )
        .order_by(CampusVisitTask.created_at.desc())
    )
    if conditions:
        count_stmt = count_stmt.where(*conditions)
        query = query.where(*conditions)

    total = (await db.execute(count_stmt)).scalar() or 0
    result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    tasks = result.scalars().unique().all()
    enrollment_by_campus_visit: dict[int, int] = {}
    if tasks:
        enrollment_rows = await db.execute(
            select(EnrollmentRecord.campus_visit_task_id, EnrollmentRecord.id).where(
                EnrollmentRecord.campus_visit_task_id.in_([task.id for task in tasks])
            )
        )
        enrollment_by_campus_visit = {
            int(campus_visit_id): int(enrollment_id)
            for campus_visit_id, enrollment_id in enrollment_rows.all()
            if campus_visit_id is not None
        }
    rows = [
        _campus_visit_payload(task, enrollment_by_campus_visit.get(task.id))
        for task in tasks
    ]
    return Response.ok(_page_payload(total, page, page_size, rows))


@router.post("/campus-visits")
async def create_campus_visit(
    body: CampusVisitCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, body.student_id, current_user)
    open_result = await db.execute(
        select(CampusVisitTask.id).where(
            CampusVisitTask.student_id == student.id,
            CampusVisitTask.status.in_(CAMPUS_VISIT_OPEN_STATUSES),
        )
    )
    if open_result.scalar_one_or_none() is not None:
        raise HTTPException(status_code=400, detail="该学生已有未完成的到校参观任务")

    home_visit = None
    if body.home_visit_task_id is not None:
        home_visit = await _get_home_visit_or_404(db, body.home_visit_task_id)
        if home_visit.student_id != student.id:
            raise HTTPException(status_code=400, detail="家访任务不属于该学生")
    creator_user_id = (
        home_visit.creator_agent_id
        if is_admin(current_user) and home_visit is not None
        else current_user.id
    )

    status = CampusVisitStatus.scheduled if body.appointment_at else CampusVisitStatus.pending
    task = CampusVisitTask(
        student_id=student.id,
        creator_user_id=creator_user_id,
        reception_admin_id=body.reception_admin_id,
        home_visit_task_id=body.home_visit_task_id,
        status=status,
        source=body.source,
        student_name_snapshot=student.name,
        guardian_phone_snapshot=student.guardian_phone or student.guardian2_phone or "",
        region_snapshot=student.region,
        school_name_snapshot=student.school_name,
        intent_program=body.intent_program or student.program or "",
        appointment_at=body.appointment_at,
        needs_pickup=body.needs_pickup,
        visitor_count=body.visitor_count,
        current_concerns=body.current_concerns,
        notes=body.notes,
    )
    next_stage = (
        StudentStage.campus_visit_scheduled
        if body.appointment_at
        else StudentStage.campus_visit_pending
    )
    _advance_student_stage(student, next_stage)
    db.add(task)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "预约到校",
            content=f"到校参观预约：{student.name}；时间：{body.appointment_at or '待定'}",
        )
    )
    await db.commit()
    await db.refresh(task)
    return Response.ok(await _load_campus_visit_payload(db, task.id))


@router.patch("/campus-visits/{task_id}")
async def update_campus_visit(
    task_id: int,
    body: CampusVisitUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    task = await _get_campus_visit_or_404(db, task_id)
    student = await get_accessible_student(db, task.student_id, current_user)
    changed_fields = body.model_fields_set

    if not is_admin(current_user):
        if task.creator_user_id != current_user.id:
            raise HTTPException(status_code=403, detail="无权修改他人的到校参观任务")
        if task.status not in CAMPUS_VISIT_OPEN_STATUSES:
            raise HTTPException(status_code=403, detail="已结束的到校参观任务不能由话务员修改")
        disallowed = changed_fields - AGENT_CAMPUS_VISIT_EDIT_FIELDS
        if disallowed:
            raise HTTPException(status_code=403, detail="到校参观结果只能由管理员填写")
    else:
        disallowed = changed_fields - (
            AGENT_CAMPUS_VISIT_EDIT_FIELDS | ADMIN_CAMPUS_VISIT_RESULT_FIELDS
        )
        if disallowed:
            raise HTTPException(status_code=422, detail=f"不支持的字段: {', '.join(sorted(disallowed))}")

    old_status = task.status
    old_result = task.result

    for field in AGENT_CAMPUS_VISIT_EDIT_FIELDS:
        value = getattr(body, field)
        if field in changed_fields and value is not None:
            setattr(task, field, value)

    if is_admin(current_user):
        if "status" in changed_fields and body.status is not None:
            task.status = CampusVisitStatus(body.status)
        if "result" in changed_fields and body.result is not None:
            task.result = CampusVisitResult(body.result)
        for field in (
            "reception_admin_id",
            "reception_content",
            "guardian_attitude",
            "student_attitude",
            "onsite_enrolled",
            "not_enrolled_reason",
            "next_action",
            "next_follow_up_at",
            "result_notes",
        ):
            value = getattr(body, field)
            if field in changed_fields and value is not None:
                setattr(task, field, value)
        if task.result == CampusVisitResult.enrolled or task.status == CampusVisitStatus.enrolled:
            await _create_enrollment_record(
                db,
                EnrollmentCreate(
                    student_id=student.id,
                    source=EnrollmentSource.campus_visit.value,
                    home_visit_task_id=task.home_visit_task_id,
                    campus_visit_task_id=task.id,
                    enrolled_program=student.program or task.intent_program or "",
                ),
                student,
                current_user,
                allow_existing=True,
            )
        elif task.status == CampusVisitStatus.arrived:
            _advance_student_stage(student, StudentStage.campus_visit_arrived)
        elif task.status in {CampusVisitStatus.scheduled, CampusVisitStatus.rescheduled}:
            _advance_student_stage(student, StudentStage.campus_visit_scheduled)

    if old_status != task.status or old_result != task.result:
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "处理到校",
                content=f"到校参观 #{task.id}",
                old_status=old_status.value if old_status else "",
                new_status=task.status.value if task.status else "",
                note_content=task.result.value if task.result else "",
            )
        )

    await db.commit()
    return Response.ok(await _load_campus_visit_payload(db, task.id))


@router.get("/enrollments")
async def list_enrollments(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    conditions = []
    if not is_admin(current_user):
        conditions.append(EnrollmentRecord.attributed_agent_id == current_user.id)

    count_stmt = select(func.count(EnrollmentRecord.id))
    query = (
        select(EnrollmentRecord)
        .options(
            joinedload(EnrollmentRecord.attributed_agent),
            joinedload(EnrollmentRecord.confirmed_by_admin),
        )
        .order_by(EnrollmentRecord.enrolled_at.desc())
    )
    if conditions:
        count_stmt = count_stmt.where(*conditions)
        query = query.where(*conditions)

    total = (await db.execute(count_stmt)).scalar() or 0
    result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    rows = [_enrollment_payload(record) for record in result.scalars().unique().all()]
    return Response.ok(_page_payload(total, page, page_size, rows))


@router.get("/enrollments/summary")
async def enrollment_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="无权查看报名结算汇总")

    result = await db.execute(
        select(
            EnrollmentRecord.attributed_agent_id,
            User.name,
            func.count(EnrollmentRecord.id),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status == SettlementStatus.unsettled, 1),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status == SettlementStatus.settled, 1),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status == SettlementStatus.postponed, 1),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status == SettlementStatus.disputed, 1),
                    else_=0,
                )
            ),
        )
        .join(User, User.id == EnrollmentRecord.attributed_agent_id)
        .group_by(EnrollmentRecord.attributed_agent_id, User.name)
        .order_by(func.count(EnrollmentRecord.id).desc(), User.name.asc())
    )
    rows = []
    for (
        agent_id,
        agent_name,
        total,
        unsettled,
        settled,
        postponed,
        disputed,
    ) in result.all():
        rows.append(
            {
                "attributed_agent_id": agent_id,
                "attributed_agent_name": agent_name,
                "total": total or 0,
                "unsettled": unsettled or 0,
                "settled": settled or 0,
                "postponed": postponed or 0,
                "disputed": disputed or 0,
            }
        )
    return Response.ok({"list": rows})


@router.post("/enrollments")
async def create_enrollment(
    body: EnrollmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="只有管理员可以确认报名")

    student = await get_accessible_student(db, body.student_id, current_user)
    record = await _create_enrollment_record(db, body, student, current_user)
    await db.commit()
    await db.refresh(record)
    return Response.ok(await _load_enrollment_payload(db, record.id))


@router.patch("/enrollments/{record_id}")
async def update_enrollment(
    record_id: int,
    body: EnrollmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="只有管理员可以修改报名结算")

    record = await _get_enrollment_or_404(db, record_id)
    changed_fields = body.model_fields_set
    old_agent_id = record.attributed_agent_id
    old_settlement = record.settlement_status

    if "attributed_agent_id" in changed_fields and body.attributed_agent_id is not None:
        reason = (body.attribution_reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="修改报名归属必须填写原因")
        record.attributed_agent_id = body.attributed_agent_id
        record.attribution_method = AttributionMethod.manual
        record.attribution_reason = reason

    if "settlement_status" in changed_fields and body.settlement_status is not None:
        record.settlement_status = SettlementStatus(body.settlement_status)
    if "settlement_notes" in changed_fields and body.settlement_notes is not None:
        record.settlement_notes = body.settlement_notes

    if old_agent_id != record.attributed_agent_id or old_settlement != record.settlement_status:
        db.add(
            make_operation_log(
                current_user,
                record.student_id,
                "",
                "修改报名结算",
                content=(
                    f"报名 #{record.id}: 归属 {old_agent_id}→{record.attributed_agent_id}; "
                    f"结算 {old_settlement.value if old_settlement else ''}"
                    f"→{record.settlement_status.value if record.settlement_status else ''}"
                ),
                note_content=record.attribution_reason,
            )
        )

    await db.commit()
    return Response.ok(await _load_enrollment_payload(db, record.id))
