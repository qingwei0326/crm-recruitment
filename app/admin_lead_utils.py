from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import OperationLog, Student, StudentStatus
from app.status_policy import canonical_status_value, status_detail_value, statuses_for_canonical
from app.utils import mask_phone, normalize_phone

INVALID_REASON_LABELS = {
    "高分段",
    "无意向",
    "孩子不想读",
    "空号",
    "其他",
}


ALLOWED_CONFIG_KEYS = {
    "pushplus_token",
    "stale_days",
    "dial_window_start",
    "dial_window_end",
    "dial_max_per_24h",
    "deepseek_api_key",
    "ai_provider",
    "mimo_api_key",
    "mimo_base",
    "mimo_model",
    "ai_custom_api_key",
    "ai_custom_base",
    "ai_custom_model",
    "follow_up_window_minutes",
    "score_daily_call_target",
}


def invalid_reason_predicate(reason: str):
    reason = (reason or "").strip()
    if not reason:
        return None
    if reason not in INVALID_REASON_LABELS:
        return None
    stored_statuses = [
        status
        for status in statuses_for_canonical(StudentStatus.invalid)
        if status_detail_value(status, "") == reason
    ]
    clauses = [Student.status_detail == reason]
    if stored_statuses:
        clauses.append(Student.status.in_(stored_statuses))
    return clauses[0] if len(clauses) == 1 else clauses[0] | clauses[1]


def _student_search_predicate(q: str):
    keyword = (q or "").strip()
    if not keyword:
        return None
    like_q = f"%{keyword}%"
    clauses = [
        Student.name.contains(keyword),
        Student.region.contains(keyword),
        Student.school_name.contains(keyword),
        Student.guardian_name.contains(keyword),
        Student.guardian2_name.contains(keyword),
        Student.status_detail.contains(keyword),
        Student.case_no.contains(keyword),
    ]
    phone_q = normalize_phone(keyword)
    if len(phone_q) >= 4:
        clauses.extend(
            [
                Student.guardian_phone.contains(phone_q),
                Student.guardian2_phone.contains(phone_q),
            ]
        )
    log_student_ids = (
        select(OperationLog.target_student_id)
        .where(
            OperationLog.target_student_id.is_not(None),
            or_(
                OperationLog.operator_name.like(like_q),
                OperationLog.action.like(like_q),
                OperationLog.content.like(like_q),
                OperationLog.note_content.like(like_q),
                OperationLog.old_status.like(like_q),
                OperationLog.new_status.like(like_q),
                OperationLog.case_no.like(like_q),
                OperationLog.batch_id.like(like_q),
            ),
        )
        .distinct()
    )
    clauses.append(Student.id.in_(log_student_ids))
    return or_(*clauses)


def _operation_log_search_predicate(q: str):
    keyword = (q or "").strip()
    if not keyword:
        return None
    like_q = f"%{keyword}%"
    clauses = [
        OperationLog.operator_name.like(like_q),
        OperationLog.action.like(like_q),
        OperationLog.content.like(like_q),
        OperationLog.note_content.like(like_q),
        OperationLog.old_status.like(like_q),
        OperationLog.new_status.like(like_q),
        OperationLog.case_no.like(like_q),
        OperationLog.batch_id.like(like_q),
        Student.name.contains(keyword),
        Student.region.contains(keyword),
        Student.school_name.contains(keyword),
        Student.guardian_name.contains(keyword),
        Student.guardian2_name.contains(keyword),
        Student.status_detail.contains(keyword),
    ]
    phone_q = normalize_phone(keyword)
    if len(phone_q) >= 4:
        clauses.extend(
            [
                Student.guardian_phone.contains(phone_q),
                Student.guardian2_phone.contains(phone_q),
            ]
        )
    return or_(*clauses)


def _latest_log_payload(log: OperationLog | None) -> dict | None:
    if log is None:
        return None
    return {
        "id": log.id,
        "operator_name": log.operator_name,
        "action": log.action,
        "content": log.content or "",
        "note_content": log.note_content or "",
        "old_status": log.old_status or "",
        "new_status": log.new_status or "",
        "created_at": str(log.created_at),
    }


def _admin_student_search_payload(
    student: Student, agent_name: str | None, latest_log: OperationLog | None
) -> dict:
    status = canonical_status_value(student.status)
    return {
        "id": student.id,
        "name": student.name,
        "region": student.region or "",
        "school_name": student.school_name or "",
        "guardian_name": student.guardian_name or "",
        "guardian_phone": mask_phone(student.guardian_phone or ""),
        "guardian2_name": student.guardian2_name or "",
        "guardian2_phone": mask_phone(student.guardian2_phone or ""),
        "assigned_to": student.assigned_to,
        "agent_name": agent_name or "未分配",
        "status": status,
        "status_detail": status_detail_value(student.status, student.status_detail),
        "stage": student.stage,
        "intent_level": student.intent_level,
        "is_invalid": status == StudentStatus.invalid.value,
        "updated_at": str(student.updated_at),
        "created_at": str(student.created_at),
        "latest_log": _latest_log_payload(latest_log),
    }


def _student_governance_payload(student: Student) -> dict:
    return {
        "id": student.id,
        "name": student.name,
        "school_name": student.school_name or "",
        "region": student.region or "",
        "status": canonical_status_value(student.status),
        "stage": student.stage,
        "intent_level": student.intent_level,
        "assigned_to": student.assigned_to,
        "guardian_phone": mask_phone(student.guardian_phone or ""),
        "guardian2_phone": mask_phone(student.guardian2_phone or ""),
        "created_at": str(student.created_at),
    }


def _student_phone_values(student: Student) -> set[str]:
    return {
        phone.strip()
        for phone in (student.guardian_phone or "", student.guardian2_phone or "")
        if phone.strip()
    }


def _duplicate_phone_cleanup_row(student: Student, duplicate_phones: set[str]) -> dict:
    old_phone_1 = (student.guardian_phone or "").strip()
    old_phone_2 = (student.guardian2_phone or "").strip()
    new_phone_1 = "" if old_phone_1 in duplicate_phones else old_phone_1
    new_phone_2 = "" if old_phone_2 in duplicate_phones else old_phone_2
    removed_phones = []
    for phone in (old_phone_1, old_phone_2):
        if phone in duplicate_phones and phone not in removed_phones:
            removed_phones.append(phone)
    return {
        "student_id": student.id,
        "name": student.name,
        "school_name": student.school_name or "",
        "status": canonical_status_value(student.status),
        "assigned_to": student.assigned_to,
        "case_no": student.case_no or "",
        "old_guardian_phone": old_phone_1,
        "old_guardian2_phone": old_phone_2,
        "new_guardian_phone": new_phone_1,
        "new_guardian2_phone": new_phone_2,
        "removed_phones": removed_phones,
        "will_delete": not (new_phone_1 or new_phone_2),
    }


def _duplicate_phone_cleanup_summary(rows: list[dict], duplicate_phones: set[str]) -> dict:
    will_delete = [row for row in rows if row["will_delete"]]
    will_clear = [row for row in rows if not row["will_delete"]]
    return {
        "duplicate_phone_count": len(duplicate_phones),
        "affected_student_count": len(rows),
        "will_clear_count": len(will_clear),
        "will_delete_count": len(will_delete),
        "duplicate_phones": sorted(duplicate_phones),
        "preview_delete_students": will_delete[:20],
        "preview_clear_students": will_clear[:20],
    }


async def _build_duplicate_phone_cleanup_plan(db: AsyncSession) -> tuple[set[str], list[dict]]:
    result = await db.execute(select(Student).order_by(Student.created_at.desc()).limit(5000))
    latest_students = result.scalars().all()
    phone_groups: dict[str, list[Student]] = {}
    for student in latest_students:
        for phone in _student_phone_values(student):
            phone_groups.setdefault(phone, []).append(student)
    duplicate_phones = {
        phone
        for phone, students in phone_groups.items()
        if len({student.id for student in students}) >= 2
    }
    if not duplicate_phones:
        return set(), []

    duplicate_phone_list = sorted(duplicate_phones)
    affected_result = await db.execute(
        select(Student)
        .where(
            or_(
                Student.guardian_phone.in_(duplicate_phone_list),
                Student.guardian2_phone.in_(duplicate_phone_list),
            )
        )
        .order_by(Student.id.asc())
    )
    affected_students = affected_result.scalars().all()
    rows = [
        _duplicate_phone_cleanup_row(student, duplicate_phones)
        for student in affected_students
        if _student_phone_values(student) & duplicate_phones
    ]
    return duplicate_phones, rows


