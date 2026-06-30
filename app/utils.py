"""Shared utility functions"""

import re
from datetime import UTC, datetime, timedelta, timezone

from app.models import OperationLog

_CST = timezone(timedelta(hours=8))
_PHONE_QUERY_RE = re.compile(r"^[\d\s()+\-./（）]+$")


def utcnow() -> datetime:
    """Return current time as naive UTC datetime (replaces deprecated datetime.utcnow())."""
    return datetime.now(UTC).replace(tzinfo=None)


def today_cst_as_utc() -> datetime:
    """Return today's midnight in CST (UTC+8) as naive UTC datetime for DB range queries."""
    now_cst = datetime.now(_CST)
    midnight_cst = now_cst.replace(hour=0, minute=0, second=0, microsecond=0)
    return midnight_cst.astimezone(UTC).replace(tzinfo=None)


def month_start_cst_as_utc() -> datetime:
    """Return first day of current month at midnight in CST as naive UTC datetime."""
    now_cst = datetime.now(_CST)
    month_cst = now_cst.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    return month_cst.astimezone(UTC).replace(tzinfo=None)


def mask_phone(phone: str) -> str:
    """Return phone numbers without display masking."""
    if not phone:
        return ""
    return str(phone).strip()


def normalize_phone(phone) -> str:
    """Store phone numbers in a searchable digit-only form."""
    if phone is None:
        return ""
    digits = re.sub(r"\D+", "", str(phone).strip())
    if len(digits) == 13 and digits.startswith("86") and digits[2:3] == "1":
        return digits[2:]
    if len(digits) == 15 and digits.startswith("0086") and digits[4:5] == "1":
        return digits[4:]
    return digits


def is_phone_query(value) -> bool:
    """Return True when a search string is intended as a full phone lookup."""
    text = str(value or "").strip()
    return bool(_PHONE_QUERY_RE.fullmatch(text)) and len(normalize_phone(text)) >= 7


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
