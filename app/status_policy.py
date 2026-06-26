"""Canonical student status policy.

The database still contains several legacy statuses. Keep them readable, but
surface and write the smaller workflow status set everywhere new code touches.
"""

from app.models import StudentStatus

CANONICAL_STUDENT_STATUSES = (
    StudentStatus.not_contacted,
    StudentStatus.contacted,
    StudentStatus.not_reached,
    StudentStatus.pending_visit,
    StudentStatus.enrolled,
    StudentStatus.invalid,
)

INVALID_REASON_STATUSES = (
    StudentStatus.high_score,
    StudentStatus.not_interested,
    StudentStatus.child_not_want_study,
)

STATUS_DETAIL_VALUES = {
    "非常有意向",
    "意向了解加微",
    "高分段",
    "无意向",
    "孩子不想读",
    "空号",
    "其他",
}

_CANONICAL_STATUS_BY_NAME = {
    "new_lead": StudentStatus.not_contacted,
    "not_contacted": StudentStatus.not_contacted,
    "unassigned": StudentStatus.not_contacted,
    "contacted": StudentStatus.contacted,
    "very_interested": StudentStatus.contacted,
    "not_reached": StudentStatus.not_reached,
    "rejected": StudentStatus.not_reached,
    "pending_visit": StudentStatus.pending_visit,
    "interested_add_wechat": StudentStatus.pending_visit,
    "enrolled": StudentStatus.enrolled,
    "invalid": StudentStatus.invalid,
    "completed": StudentStatus.invalid,
    "expired": StudentStatus.invalid,
    "high_score": StudentStatus.invalid,
    "not_interested": StudentStatus.invalid,
    "no_intent": StudentStatus.invalid,
    "child_not_want_study": StudentStatus.invalid,
    "child_not_interested": StudentStatus.invalid,
}


def canonical_student_status(status: StudentStatus | str | None) -> StudentStatus | None:
    """Return the canonical workflow status for a stored or incoming status."""
    if status is None:
        return None
    status_name, status_enum = student_status_name_and_enum(status)
    return _CANONICAL_STATUS_BY_NAME.get(status_name, status_enum)


def canonical_status_value(status: StudentStatus | str | None) -> str | None:
    """Return the canonical status value used in API payloads."""
    canonical = canonical_student_status(status)
    return canonical.value if canonical is not None else None


def statuses_for_canonical(*canonical_statuses: StudentStatus) -> tuple[StudentStatus | str, ...]:
    """Return stored statuses that should be treated as one of the canonical statuses."""
    targets = set(canonical_statuses)
    result: list[StudentStatus | str] = []
    seen: set[StudentStatus | str] = set()
    for name, status in StudentStatus.__members__.items():
        canonical = _CANONICAL_STATUS_BY_NAME.get(name, status)
        if canonical not in targets:
            continue
        for value in (status, name):
            if value not in seen:
                result.append(value)
                seen.add(value)
    return tuple(result)


def normalize_status_for_write(status: StudentStatus | str) -> tuple[StudentStatus, str]:
    """Normalize incoming status and return an implicit invalid reason if any."""
    if isinstance(status, str):
        raw = status.strip()
        if raw == "空号":
            return StudentStatus.invalid, "空号"
        if raw == "其他":
            return StudentStatus.invalid, "其他"
    status_enum = student_status_from_any(status)
    canonical = canonical_student_status(status_enum)
    detail = ""
    if status_enum in (
        StudentStatus.very_interested,
        StudentStatus.interested_add_wechat,
        *INVALID_REASON_STATUSES,
    ):
        detail = status_enum.value
    return canonical, detail


def status_detail_for_write(
    canonical: StudentStatus,
    detail: str | None = "",
    explicit_invalid_reason: str | None = "",
) -> str:
    """Return the detail/reason to persist beside the canonical status."""
    reason = (explicit_invalid_reason or "").strip()
    if canonical == StudentStatus.invalid and reason:
        return reason[:64]
    value = (detail or "").strip()
    return value[:64]


def status_detail_value(status: StudentStatus | str | None, stored_detail: str | None = "") -> str:
    """Return the operator-facing result/reason for API payloads."""
    detail = (stored_detail or "").strip()
    if detail:
        return detail
    try:
        status_enum = student_status_from_any(status)
    except ValueError:
        return ""
    if status_enum in (
        StudentStatus.very_interested,
        StudentStatus.interested_add_wechat,
        *INVALID_REASON_STATUSES,
    ):
        return status_enum.value
    return ""


def student_status_from_any(status: StudentStatus | str) -> StudentStatus:
    """Parse enum members, DB enum names, and Chinese display values."""
    if isinstance(status, StudentStatus):
        return status
    try:
        return StudentStatus(status)
    except ValueError:
        pass
    try:
        return StudentStatus[str(status)]
    except KeyError as exc:
        raise ValueError(status) from exc


def student_status_name_and_enum(status: StudentStatus | str) -> tuple[str, StudentStatus]:
    """Return the declared enum name and member, preserving aliases when possible."""
    if isinstance(status, StudentStatus):
        return status.name, status
    try:
        return str(status), StudentStatus[str(status)]
    except KeyError:
        pass
    try:
        status_enum = StudentStatus(status)
        return status_enum.name, status_enum
    except ValueError as exc:
        raise ValueError(status) from exc
