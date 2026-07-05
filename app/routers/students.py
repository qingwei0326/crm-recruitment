import asyncio
import logging
import uuid
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_STUDENT_CREATE,
    ADMIN_OP_STUDENT_DELETE,
    ADMIN_OP_STUDENT_EDIT,
    ADMIN_PAGE_LEADS_MANAGE,
    get_current_user,
    require_agent,
    require_operation_permission,
    user_has_operation_permission,
    user_has_page_permission,
)
from app.database import get_db
from app.dial_guard import require_recent_agent_dial
from app.models import (
    Call,
    DialLog,
    FollowUp,
    IntentLevel,
    LeadViewLog,
    Note,
    Student,
    StudentStage,
    StudentStatus,
    User,
    Visit,
)
from app.permissions import (
    get_accessible_student,
    get_student_or_404,
    is_admin,
)
from app.pushplus import notify_a_level_change_background
from app.region_extractor import extract_region
from app.routers.students_phone import (
    _is_within_dial_window as _is_within_dial_window,  # noqa: F401
)
from app.schemas import Response, StudentCreate, StudentUpdate
from app.status_policy import (
    canonical_status_value,
    canonical_student_status,
    normalize_status_for_write,
    status_detail_for_write,
    status_detail_value,
)
from app.utils import (
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


def _require_admin_operation(current_user: User, permission: str) -> None:
    if is_admin(current_user) and not user_has_operation_permission(current_user, permission):
        raise HTTPException(status_code=403, detail="无权执行该操作")


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
    _require_admin_operation(current_user, ADMIN_OP_STUDENT_CREATE)
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
                status_detail = status_detail_for_write(status, implicit_detail)
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
        assigned_to=assigned_to,
        assigned_at=utcnow() if assigned_to else None,
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

    db.add(student)
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
    _require_admin_operation(current_user, ADMIN_OP_STUDENT_EDIT)
    student = await get_accessible_student(db, student_id, current_user)
    raw = body.model_dump(exclude_unset=True)
    # invalid_reason is persisted as status_detail for 无效 so admins can filter by reason.
    invalid_reason = (raw.pop("invalid_reason", None) or "").strip()
    if not raw:
        return Response.ok(_student_payload(student))

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

    intent_changed = "intent_level" in raw and old_intent != student.intent_level
    status_changed = old_status != student.status
    status_detail_changed = old_status_detail != (student.status_detail or "")
    stage_changed = old_stage != student.stage
    assigned_changed = "assigned_to" in raw and old_assigned != student.assigned_to

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

    if status_changed or status_detail_changed or stage_changed or assigned_changed:
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
        if assigned_changed:
            parts.append(f"分配 {old_assigned} → {student.assigned_to}")
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
    await db.commit()
    return Response.ok({"need_help": student.need_help})


@router.delete("/{student_id}")
async def delete_student(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_DELETE)),
):
    student = await get_student_or_404(db, student_id)
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "删除线索",
            content=f"删除学生 {student.name}（含通话/备注/回访/到访/查看日志）",
        )
    )
    for model in (Call, Note, FollowUp, LeadViewLog, Visit, DialLog):
        await db.execute(delete(model).where(model.student_id == student_id))
    await db.delete(student)
    await db.commit()
    return Response.ok(msg="删除成功")


@router.get("/agent/settings")
async def agent_settings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_agent),
):
    """返回话务员端需要的非敏感系统配置。"""
    from app.routers.admin import get_config_value

    dial_max_str = await get_config_value(db, "dial_max_per_24h", "3")
    try:
        dial_max = max(1, int(dial_max_str))
    except (ValueError, TypeError):
        dial_max = 3
    return Response.ok({"dial_max_per_24h": dial_max})
