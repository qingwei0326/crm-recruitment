"""Shared utility functions"""

from app.models import OperationLog


def mask_phone(phone: str) -> str:
    if not phone or len(phone) < 7:
        return phone
    return phone[:3] + "****" + phone[-4:]


def make_operation_log(
    operator,
    target_student_id: int,
    case_no: str,
    action: str,
    content: str = "",
    old_status: str = "",
    new_status: str = "",
    note_content: str = "",
) -> OperationLog:
    """Create (but do not add/commit) an OperationLog row."""
    return OperationLog(
        operator_id=operator.id,
        operator_name=operator.name,
        target_student_id=target_student_id,
        case_no=case_no or "",
        action=action,
        content=content,
        old_status=old_status,
        new_status=new_status,
        note_content=note_content,
    )
