from datetime import date

from fastapi import APIRouter, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import (
    user_has_operation_permission,
    user_has_page_permission,
)
from app.models import (
    AttributionMethod,
    CampusVisitResult,
    CampusVisitStatus,
    CampusVisitTask,
    EnrollmentRecord,
    EnrollmentSource,
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
from app.permissions import is_admin
from app.pushplus import (
    notify_home_visit_created_background as notify_home_visit_created_background,  # noqa: F401
)
from app.schemas import (
    EnrollmentCreate,
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


def _require_admin_module(current_user: User, permission: str) -> None:
    if is_admin(current_user) and not user_has_page_permission(current_user, permission):
        raise HTTPException(status_code=403, detail="无权访问该管理模块")


def _require_admin_operation(current_user: User, permission: str) -> None:
    if is_admin(current_user) and not user_has_operation_permission(current_user, permission):
        raise HTTPException(status_code=403, detail="无权执行该操作")


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
        "requested_visit_time": str(task.requested_visit_time)
        if task.requested_visit_time
        else None,
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
    home_visit_task = record.home_visit_task
    if home_visit_task is None and record.campus_visit_task is not None:
        home_visit_task = record.campus_visit_task.home_visit_task
    campus_visit_task = record.campus_visit_task
    attribution_recommendation = _build_attribution_recommendation(
        record,
        home_visit_task,
        campus_visit_task,
    )
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
        "attribution_reason": record.attribution_reason,
        "first_assigned_agent_id": record.first_assigned_agent_id,
        "first_assigned_agent_name": record.first_assigned_agent.name
        if record.first_assigned_agent
        else "",
        "current_assigned_agent_id": record.current_assigned_agent_id,
        "current_assigned_agent_name": record.current_assigned_agent.name
        if record.current_assigned_agent
        else "",
        "last_effective_agent_id": record.last_effective_agent_id,
        "last_effective_agent_name": record.last_effective_agent.name
        if record.last_effective_agent
        else "",
        "home_visit_task_id": home_visit_task.id if home_visit_task else record.home_visit_task_id,
        "home_visit_creator_agent_id": home_visit_task.creator_agent_id
        if home_visit_task
        else None,
        "home_visit_creator_agent_name": home_visit_task.creator_agent.name
        if home_visit_task and home_visit_task.creator_agent
        else "",
        "campus_visit_task_id": record.campus_visit_task_id,
        "campus_visit_creator_user_id": campus_visit_task.creator_user_id
        if campus_visit_task
        else None,
        "campus_visit_creator_user_name": campus_visit_task.creator_user.name
        if campus_visit_task and campus_visit_task.creator_user
        else "",
        "handover_policy": (
            "工作手机/微信属于公司资产；交接后的同一微信号只能证明沟通渠道连续，"
            "不能单独证明原话务员促成报名。"
        ),
        "attribution_recommendation": attribution_recommendation,
        "settlement_status": record.settlement_status.value,
        "settlement_notes": record.settlement_notes,
        "enrolled_program": record.enrolled_program,
        "enrolled_at": str(record.enrolled_at),
        "amount": record.amount,
        "created_at": str(record.created_at),
        "updated_at": str(record.updated_at),
    }


def _agent_name(user: User | None, fallback_id: int | None = None) -> str:
    if user is not None and user.name:
        return user.name
    return f"话务员 #{fallback_id}" if fallback_id else ""


def _build_attribution_recommendation(
    record: EnrollmentRecord,
    home_visit_task: HomeVisitTask | None,
    campus_visit_task: CampusVisitTask | None,
) -> dict:
    evidence = []
    seen_agent_ids: dict[int, str] = {}

    def add_evidence(label: str, agent_id: int | None, agent_name: str) -> None:
        evidence.append(
            {
                "label": label,
                "agent_id": agent_id,
                "agent_name": agent_name or "",
                "matches_current_attribution": (
                    agent_id is not None and agent_id == record.attributed_agent_id
                ),
            }
        )
        if agent_id is not None:
            seen_agent_ids.setdefault(agent_id, agent_name or f"话务员 #{agent_id}")

    add_evidence(
        "首次分配",
        record.first_assigned_agent_id,
        _agent_name(record.first_assigned_agent, record.first_assigned_agent_id),
    )
    add_evidence(
        "当前负责",
        record.current_assigned_agent_id,
        _agent_name(record.current_assigned_agent, record.current_assigned_agent_id),
    )
    add_evidence(
        "最后跟进",
        record.last_effective_agent_id,
        _agent_name(record.last_effective_agent, record.last_effective_agent_id),
    )
    add_evidence(
        "家访申请",
        home_visit_task.creator_agent_id if home_visit_task else None,
        _agent_name(
            home_visit_task.creator_agent if home_visit_task else None,
            home_visit_task.creator_agent_id if home_visit_task else None,
        ),
    )
    campus_creator_is_agent = (
        campus_visit_task is not None
        and campus_visit_task.creator_user is not None
        and campus_visit_task.creator_user.role == UserRole.agent
    )
    add_evidence(
        "到校预约",
        campus_visit_task.creator_user_id if campus_creator_is_agent else None,
        _agent_name(campus_visit_task.creator_user) if campus_creator_is_agent else "",
    )

    suggested_id: int | None = None
    suggested_name = ""
    reason = ""
    confidence = "low"

    if (
        campus_visit_task is not None
        and campus_visit_task.creator_user is not None
        and campus_visit_task.creator_user.role == UserRole.agent
    ):
        suggested_id = campus_visit_task.creator_user_id
        suggested_name = campus_visit_task.creator_user.name
        reason = "报名来自到校参观，优先建议归属到校预约话务员。"
        confidence = "high"
    elif home_visit_task is not None:
        suggested_id = home_visit_task.creator_agent_id
        suggested_name = _agent_name(home_visit_task.creator_agent, suggested_id)
        reason = "报名链路包含家访任务，优先建议归属家访申请话务员。"
        confidence = "high"
    elif record.current_assigned_agent_id is not None:
        suggested_id = record.current_assigned_agent_id
        suggested_name = _agent_name(record.current_assigned_agent, suggested_id)
        reason = "没有家访/到校归因证据，建议按报名时当前负责人确认。"
        confidence = "medium"
    elif record.last_effective_agent_id is not None:
        suggested_id = record.last_effective_agent_id
        suggested_name = _agent_name(record.last_effective_agent, suggested_id)
        reason = "没有家访/到校归因证据，建议按最后有效跟进人确认。"
        confidence = "medium"
    elif record.first_assigned_agent_id is not None:
        suggested_id = record.first_assigned_agent_id
        suggested_name = _agent_name(record.first_assigned_agent, suggested_id)
        reason = "没有后续归因证据，建议按首次分配话务员复核。"
        confidence = "low"

    warnings = []
    if len(seen_agent_ids) > 1:
        warnings.append("存在交接或多人推进，请管理员结合通话、家访、到校记录确认。")
    if suggested_id is not None and suggested_id != record.attributed_agent_id:
        warnings.append("当前结算归属与系统建议不一致，结算前请复核。")

    return {
        "agent_id": suggested_id,
        "agent_name": suggested_name,
        "reason": reason,
        "confidence": confidence,
        "warning": " ".join(warnings),
        "evidence": evidence,
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
            joinedload(EnrollmentRecord.first_assigned_agent),
            joinedload(EnrollmentRecord.current_assigned_agent),
            joinedload(EnrollmentRecord.last_effective_agent),
            joinedload(EnrollmentRecord.home_visit_task).joinedload(HomeVisitTask.creator_agent),
            joinedload(EnrollmentRecord.campus_visit_task).joinedload(CampusVisitTask.creator_user),
            joinedload(EnrollmentRecord.campus_visit_task)
            .joinedload(CampusVisitTask.home_visit_task)
            .joinedload(HomeVisitTask.creator_agent),
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
