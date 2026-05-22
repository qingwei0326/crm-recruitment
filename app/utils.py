"""Shared utility functions"""

from datetime import datetime, timedelta, timezone

from app.models import OperationLog

_CST = timezone(timedelta(hours=8))


def utcnow() -> datetime:
    """Return current time as naive UTC datetime (replaces deprecated datetime.utcnow())."""
    return datetime.now(timezone.utc).replace(tzinfo=None)


def today_cst_as_utc() -> datetime:
    """Return today's midnight in CST (UTC+8) as naive UTC datetime for DB range queries."""
    now_cst = datetime.now(_CST)
    midnight_cst = now_cst.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight_cst.astimezone(timezone.utc).replace(tzinfo=None)


def month_start_cst_as_utc() -> datetime:
    """Return first day of current month at midnight in CST as naive UTC datetime."""
    now_cst = datetime.now(_CST)
    month_cst = now_cst.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return month_cst.astimezone(timezone.utc).replace(tzinfo=None)


def mask_phone(phone: str) -> str:
    return phone or ""


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
