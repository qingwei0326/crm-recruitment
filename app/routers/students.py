import asyncio
import logging
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_ENROLLED_INVALIDATE,
    ADMIN_OP_STUDENT_CREATE,
    ADMIN_OP_STUDENT_DELETE,
    ADMIN_OP_STUDENT_EDIT,
    ADMIN_PAGE_LEADS_MANAGE,
    get_current_user,
    require_operation_permission,
    user_has_page_permission,
)
from app.database import get_db
from app.dial_guard import require_recent_agent_dial
from app.models import (
    IntentLevel,
    Student,
    StudentStage,
    StudentStatus,
    User,
)
from app.permissions import (
    get_accessible_student,
    get_student_or_404,
    is_admin,
    require_admin_operation,
)
from app.pushplus import notify_a_level_change_background
from app.region_extractor import extract_region
from app.schemas import Response, StudentCreate, StudentUpdate
from app.services.assignment_service import AssignmentTarget, apply_assignment_changes
from app.services.lead_outcome_service import apply_outcome_reason
from app.services.work_item_service import sync_student_work_items
from app.stage_policy import normalize_stage, validate_stage_transition
from app.status_policy import (
    canonical_status_value,
    canonical_student_status,
    normalize_status_for_write,
    status_detail_for_write,
    status_detail_value,
)
from app.student_delete import delete_students_cascade
from app.utils import (
    make_batch_id,
    make_operation_log,
    mask_phone,
    normalize_phone,
    utcnow,
)

router = APIRouter(prefix="/api/students", tags=["学生"])

logger = logging.getLogger(__name__)


STAGE_ORDER = [
    "初次联系",
    "有意向",
    "已送资料",
    "待家访",
    "家访已安排",
    "家访完成",
    "待到校参观",
    "到校参观已安排",
    "已到校参观",
    "已报名",
]

def _require_admin_leads_manage(current_user: User) -> None:
    if is_admin(current_user) and not user_has_page_permission(
        current_user, ADMIN_PAGE_LEADS_MANAGE
    ):
        raise HTTPException(status_code=403, detail="无权访问该管理模块")


ADMIN_STUDENT_UPDATE_FIELDS = {
    "name",
    "status",
    "intent_level",
    "assigned_to",
    "join_reasons",
    "region",
    "stage",
    "enrolled_at",
    "program",
    "deposit",
    "score",
    "guardian_name",
    "guardian_phone",
    "guardian2_name",
    "guardian2_phone",
    "school_name",
    "school_address",
    "need_help",
}
AGENT_STUDENT_UPDATE_FIELDS = {
    "status",
    "intent_level",
    "join_reasons",
    "stage",
    "need_help",
    "score",
}
CALL_RESULT_STATUSES = {
    StudentStatus.contacted,
    StudentStatus.not_reached,
    StudentStatus.pending_visit,
    StudentStatus.invalid,
}
CALL_RESULT_STATUS_DETAILS = {
    "非常有意向",
    "意向了解加微",
    "高分段",
    "无意向",
    "孩子不想读",
    "空号",
    "其他",
}


def next_stage(current: str) -> str | None:
    try:
        idx = STAGE_ORDER.index(current)
        return STAGE_ORDER[idx + 1] if idx + 1 < len(STAGE_ORDER) else None
    except ValueError:
        return None


def _enum_or_error(enum_cls, value: str, label: str):
    try:
        return enum_cls(value)
    except ValueError:
        raise ValueError(f"无效的{label}: {value}")


def _has_any_phone(guardian_phone: str | None, guardian2_phone: str | None) -> bool:
    return bool((guardian_phone or "").strip() or (guardian2_phone or "").strip())


def _dedupe_contact_phones(
    guardian_phone: str | None, guardian2_phone: str | None
) -> tuple[str, str]:
    phone = normalize_phone(guardian_phone)
    phone2 = normalize_phone(guardian2_phone)
    if phone and phone2 and phone == phone2:
        phone2 = ""
    return phone, phone2


def _display_stage(stage: StudentStage) -> str:
    if stage == StudentStage.visit_scheduled:
        return StudentStage.campus_visit_scheduled.value
    if stage == StudentStage.visited:
        return StudentStage.campus_visit_arrived.value
    return stage.value


def _stage_filter_values(stage: StudentStage) -> list[StudentStage]:
    if stage == StudentStage.campus_visit_scheduled:
        return [StudentStage.campus_visit_scheduled, StudentStage.visit_scheduled]
    if stage == StudentStage.campus_visit_arrived:
        return [StudentStage.campus_visit_arrived, StudentStage.visited]
    return [stage]


def _student_payload(student: Student) -> dict:
    status = canonical_status_value(student.status)
    detail = status_detail_value(student.status, getattr(student, "status_detail", ""))
    intent_level = student.intent_level.value
    stage = _display_stage(student.stage)
    payload = {
        "id": student.id,
        "name": student.name,
        "region": student.region,
        "assigned_to": student.assigned_to,
        "status": status,
        "status_detail": detail,
        "invalid_reason": detail if status == StudentStatus.invalid.value else "",
        "intent_level": intent_level,
        "stage": stage,
        "join_reasons": student.join_reasons,
        "case_no": student.case_no,
        "need_help": student.need_help,
        "score": student.score,
        "guardian_name": student.guardian_name,
        "guardian_phone": mask_phone(student.guardian_phone),
        "guardian_phone_raw": None,
        "guardian2_name": student.guardian2_name,
        "guardian2_phone": mask_phone(student.guardian2_phone),
        "guardian2_phone_raw": None,
        "school_name": student.school_name,
        "school_address": student.school_address,
        "enrolled_at": str(student.enrolled_at) if student.enrolled_at else None,
        "program": student.program,
        "deposit": student.deposit,
        "expired_at": str(student.expired_at) if student.expired_at else None,
        "enrollment_substage": student.enrollment_substage.value
        if student.enrollment_substage
        else None,
        "assigned_at": str(student.assigned_at) if student.assigned_at else None,
        "created_at": str(student.created_at),
        "updated_at": str(student.updated_at),
        # Filled by the student list/detail read models. Keep the key on all
        # student payloads so clients can consume one stable contract.
        "next_action": None,
    }
    return payload


def _is_call_result_write(status: StudentStatus, status_detail: str | None) -> bool:
    canonical_status = canonical_student_status(status)
    detail = (status_detail or "").strip()
    return canonical_status in CALL_RESULT_STATUSES or detail in CALL_RESULT_STATUS_DETAILS


def _allows_call_result_backfill_without_recent_dial(
    old_status: StudentStatus | str | None,
) -> bool:
    return canonical_student_status(old_status) == StudentStatus.contacted


def _is_enrolled_student(student: Student) -> bool:
    return (
        canonical_student_status(student.status) == StudentStatus.enrolled
        or student.stage == StudentStage.enrolled
    )


@router.post("")
async def create_student(
    body: StudentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_leads_manage(current_user)
    require_admin_operation(current_user, ADMIN_OP_STUDENT_CREATE)
    raw = body.model_dump(exclude_unset=True)
    if not is_admin(current_user):
        agent_create_fields = {
            "name",
            "region",
            "score",
            "guardian_name",
            "guardian_phone",
            "guardian2_name",
            "guardian2_phone",
            "school_name",
            "school_address",
            "join_reasons",
        }
        forbidden = sorted(set(raw) - agent_create_fields)
        if forbidden:
            raise HTTPException(status_code=403, detail=f"无权设置字段: {', '.join(forbidden)}")

    status = StudentStatus.not_contacted
    status_detail = ""
    intent_level = IntentLevel.none
    stage = StudentStage.initial_contact
    if is_admin(current_user):
        if body.status:
            try:
                status, implicit_detail = normalize_status_for_write(body.status)
                status_detail = status_detail_for_write(
                    status,
                    implicit_detail,
                    body.status_detail,
                )
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
        if body.intent_level:
            try:
                intent_level = _enum_or_error(IntentLevel, body.intent_level, "意向等级")
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
    if body.stage:
        try:
            stage = _enum_or_error(StudentStage, body.stage, "阶段")
        except ValueError as e:
            return Response.error(code=1, msg=str(e))

        if stage == StudentStage.enrolled:
            return Response.error(code=1, msg="已报名必须通过正式报名确认流程登记")

    if canonical_student_status(status) == StudentStatus.enrolled:
        return Response.error(code=1, msg="已报名必须通过正式报名确认流程登记")

    assigned_to = body.assigned_to if is_admin(current_user) else current_user.id
    if assigned_to:
        agent_result = await db.execute(
            select(User.id).where(User.id == assigned_to, User.is_active)
        )
        if not agent_result.scalar_one_or_none():
            return Response.error(code=1, msg="话务员不存在或已禁用")

    region_value = body.region
    if not region_value and body.school_name:
        region_value = extract_region(body.school_name)

    guardian_phone, guardian2_phone = _dedupe_contact_phones(
        body.guardian_phone,
        body.guardian2_phone,
    )
    if not _has_any_phone(guardian_phone, guardian2_phone):
        return Response.error(code=1, msg="至少需要一个可拨电话")

    student = Student(
        name=body.name,
        region=region_value,
        status=status,
        status_detail=status_detail,
        intent_level=intent_level,
        stage=stage,
        join_reasons=body.join_reasons or "",
        enrolled_at=body.enrolled_at,
        program=body.program or "",
        deposit=body.deposit,
        score=body.score,
        guardian_name=body.guardian_name or "",
        guardian_phone=guardian_phone,
        guardian2_name=body.guardian2_name or "",
        guardian2_phone=guardian2_phone,
        school_name=body.school_name or "",
        school_address=body.school_address or "",
        need_help=body.need_help or False,
        case_no=str(uuid.uuid4()),
    )
    if student.stage == StudentStage.enrolled:
        student.status = StudentStatus.enrolled
        student.status_detail = ""
        if not student.enrolled_at:
            student.enrolled_at = date.today()

    if canonical_student_status(student.status) == StudentStatus.invalid:
        await apply_outcome_reason(db, student, student.status_detail)
    else:
        student.outcome_reason_code = None

    db.add(student)
    await db.flush()
    sync_at = utcnow()
    if assigned_to is not None:
        await apply_assignment_changes(
            db,
            [AssignmentTarget(student_id=student.id, agent_id=assigned_to)],
            operator=current_user,
            reason="student_create",
            batch_id=make_batch_id("student-create-assignment"),
            at=sync_at,
        )
    await sync_student_work_items(db, student, current_user, at=sync_at)
    await db.commit()
    await db.refresh(student)
    if student.intent_level == IntentLevel.A:
        asyncio.create_task(
            notify_a_level_change_background(student.id, current_user.name, "create")
        )
    return Response.ok(_student_payload(student))


@router.put("/{student_id}")
async def update_student(
    student_id: int,
    body: StudentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_leads_manage(current_user)
    require_admin_operation(current_user, ADMIN_OP_STUDENT_EDIT)
    student = await get_accessible_student(db, student_id, current_user)
    raw = body.model_dump(exclude_unset=True)
    # invalid_reason is persisted as status_detail for 无效 so admins can filter by reason.
    invalid_reason = (raw.pop("invalid_reason", None) or "").strip()
    if not raw:
        return Response.ok(_student_payload(student))

    if "status" in raw and raw["status"] is not None:
        try:
            if (
                not is_admin(current_user)
                and canonical_student_status(raw["status"]) == StudentStatus.not_contacted
            ):
                return Response.error(
                    code=1,
                    msg="话务员不能重置为新线索，请联系管理员回收并重新分配",
                )
            if canonical_student_status(raw["status"]) == StudentStatus.enrolled:
                return Response.error(
                    code=1,
                    msg="已报名必须通过正式报名确认流程登记",
                )
        except ValueError as e:
            return Response.error(code=1, msg=str(e))

    if "stage" in raw and raw["stage"] is not None:
        try:
            requested_stage = normalize_stage(raw["stage"])
            if not is_admin(current_user) and requested_stage == StudentStage.initial_contact:
                return Response.error(
                    code=1,
                    msg="话务员不能重置为新线索，请联系管理员回收并重新分配",
                )
            raw["stage"] = await validate_stage_transition(
                db,
                student,
                requested_stage,
            )
        except ValueError as e:
            return Response.error(code=1, msg=str(e))

    allowed_fields = (
        ADMIN_STUDENT_UPDATE_FIELDS if is_admin(current_user) else AGENT_STUDENT_UPDATE_FIELDS
    )
    forbidden = sorted(set(raw) - allowed_fields)
    if forbidden:
        raise HTTPException(status_code=403, detail=f"无权修改字段: {', '.join(forbidden)}")

    old_intent = student.intent_level
    old_status = student.status
    old_status_detail = student.status_detail or ""
    old_stage = student.stage
    old_assigned = student.assigned_to
    assignment_requested = "assigned_to" in raw
    target_assigned_to = raw.pop("assigned_to", old_assigned)
    next_guardian_phone = student.guardian_phone
    next_guardian2_phone = student.guardian2_phone
    was_enrolled = _is_enrolled_student(student)
    for k, v in raw.items():
        if k == "status" and v is not None:
            try:
                v, implicit_status_detail = normalize_status_for_write(v)
                if was_enrolled and canonical_student_status(v) != StudentStatus.enrolled:
                    return Response.error(code=1, msg="已报名学生不能通过普通编辑改回非报名状态")
                student.status_detail = status_detail_for_write(
                    v,
                    implicit_status_detail,
                    invalid_reason,
                )
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
        elif k == "stage" and v is not None:
            try:
                v = _enum_or_error(StudentStage, v, "阶段")
                if was_enrolled and v != StudentStage.enrolled:
                    return Response.error(code=1, msg="已报名学生不能通过普通编辑改回非报名状态")
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
        elif k == "intent_level" and v is not None:
            try:
                v = _enum_or_error(IntentLevel, v, "意向等级")
            except ValueError as e:
                return Response.error(code=1, msg=str(e))
        elif k in {"guardian_phone", "guardian2_phone"} and v is not None:
            v = normalize_phone(v)
            if k == "guardian_phone":
                next_guardian_phone = v
            else:
                next_guardian2_phone = v
        setattr(student, k, v)

    if was_enrolled and not _is_enrolled_student(student):
        return Response.error(code=1, msg="已报名学生不能通过普通编辑改回非报名状态")

    if {"guardian_phone", "guardian2_phone"} & set(raw):
        next_guardian_phone, next_guardian2_phone = _dedupe_contact_phones(
            next_guardian_phone,
            next_guardian2_phone,
        )
        if not _has_any_phone(next_guardian_phone, next_guardian2_phone):
            return Response.error(code=1, msg="至少需要一个可拨电话")
        student.guardian_phone = next_guardian_phone
        student.guardian2_phone = next_guardian2_phone

    if student.stage == StudentStage.enrolled:
        student.status = StudentStatus.enrolled
        student.status_detail = ""
        if not student.enrolled_at:
            student.enrolled_at = date.today()
    elif student.status == StudentStatus.enrolled:
        student.stage = StudentStage.enrolled
        student.status_detail = ""
        if not student.enrolled_at:
            student.enrolled_at = date.today()

    if canonical_student_status(student.status) == StudentStatus.invalid:
        reason_was_written = "status" in raw or bool(invalid_reason)
        outcome_value = (
            invalid_reason or student.status_detail
            if reason_was_written or not student.outcome_reason_code
            else student.outcome_reason_code
        )
        await apply_outcome_reason(db, student, outcome_value)
    else:
        student.outcome_reason_code = None

    intent_changed = "intent_level" in raw and old_intent != student.intent_level
    status_changed = old_status != student.status
    status_detail_changed = old_status_detail != (student.status_detail or "")
    stage_changed = old_stage != student.stage

    if status_changed or status_detail_changed:
        if _is_call_result_write(
            student.status, student.status_detail
        ) and not _allows_call_result_backfill_without_recent_dial(old_status):
            await require_recent_agent_dial(db, student.id, current_user)

    if intent_changed:
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "手动评级",
                content=f"意向 {old_intent} → {student.intent_level}",
                old_status=str(old_intent),
                new_status=str(student.intent_level),
                note_content="",
            )
        )

    if status_changed or status_detail_changed or stage_changed:
        parts = []
        if status_changed:
            parts.append(
                f"状态 {canonical_status_value(old_status)} → "
                f"{canonical_status_value(student.status)}"
            )
        if status_detail_changed and student.status_detail:
            parts.append(f"结果/原因：{student.status_detail}")
        if student.status == StudentStatus.invalid and student.status_detail:
            parts.append(f"无效原因：{student.status_detail}")
        if stage_changed:
            parts.append(f"阶段 {old_stage} → {student.stage}")
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "修改状态" if status_changed else "修改信息",
                content="; ".join(parts),
                old_status=canonical_status_value(old_status) if status_changed else "",
                new_status=canonical_status_value(student.status) if status_changed else "",
                note_content=student.status_detail
                if (student.status == StudentStatus.invalid and student.status_detail)
                else "",
            )
        )

    sync_at = utcnow()
    if assignment_requested:
        await apply_assignment_changes(
            db,
            [AssignmentTarget(student_id=student.id, agent_id=target_assigned_to)],
            operator=current_user,
            reason="student_edit",
            batch_id=make_batch_id("student-edit-assignment"),
            at=sync_at,
        )
    await sync_student_work_items(db, student, current_user, at=sync_at)

    await db.commit()
    await db.refresh(student)
    if intent_changed and student.intent_level == IntentLevel.A:
        asyncio.create_task(
            notify_a_level_change_background(student.id, current_user.name, "manual")
        )
    return Response.ok(_student_payload(student))


@router.post("/{student_id}/need-help")
async def toggle_need_help(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    student = await get_accessible_student(db, student_id, current_user)
    student.need_help = not student.need_help
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no,
            "标记协助" if student.need_help else "取消协助",
            content="需要协助" if student.need_help else "取消协助标记",
        )
    )
    await sync_student_work_items(db, student, current_user)
    await db.commit()
    return Response.ok({"need_help": student.need_help})


@router.post("/{student_id}/invalidate-enrollment")
async def invalidate_enrollment(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_ENROLLED_INVALIDATE)),
):
    """取消正式报名状态，保留学生档案和历史记录并转为无效。"""
    student = await get_student_or_404(db, student_id)
    if canonical_student_status(student.status) != StudentStatus.enrolled:
        return Response.error(code=1, msg="只有已报名学生可以取消报名")

    old_stage = student.stage
    old_assigned_to = student.assigned_to
    student.status = StudentStatus.invalid
    student.stage = StudentStage.initial_contact
    student.enrollment_substage = None
    await apply_outcome_reason(db, student, "其他")

    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "取消报名",
            content=(
                f"取消学生 {student.name} 的正式报名状态，转为无效；"
                f"阶段 {old_stage} → {student.stage}；"
                f"原话务员 {old_assigned_to or '未分配'}"
            ),
            old_status=canonical_status_value(StudentStatus.enrolled) or "已报名",
            new_status=canonical_status_value(StudentStatus.invalid) or "无效",
            note_content="其他",
        )
    )
    await sync_student_work_items(db, student, current_user)
    await db.commit()
    await db.refresh(student)
    return Response.ok(
        {
            "id": student.id,
            "status": canonical_status_value(student.status),
            "status_detail": student.status_detail,
            "assigned_to": student.assigned_to,
        },
        msg="已取消报名并转为无效",
    )


@router.delete("/{student_id}")
async def delete_student(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_DELETE)),
):
    student = await get_student_or_404(db, student_id)
    deleted = await delete_students_cascade(db, [student], current_user, action="删除线索")
    await db.commit()
    if deleted == 0:
        return Response.error(msg="学生不存在或已删除", code=404)
    return Response.ok(msg="删除成功")
