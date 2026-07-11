from collections.abc import Sequence

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain_errors import DomainConflict, DomainError
from app.domain_models import LeadOutcomeReason
from app.models import Student

_LEGACY_CODE_BY_VALUE = {
    "报好了": "enrolled_elsewhere",
    "phone_invalid": "phone_invalid",
    "high_score": "high_score",
    "not_interested": "no_intent",
    "no_intent": "no_intent",
    "child_not_want_study": "child_declined",
    "child_not_interested": "child_declined",
}


async def resolve_outcome_reason(
    db: AsyncSession,
    value: str,
) -> LeadOutcomeReason:
    normalized = (value or "").strip()
    lookup_value = normalized or "legacy_unspecified"
    lookup_value = _LEGACY_CODE_BY_VALUE.get(lookup_value, lookup_value)
    result = await db.execute(
        select(LeadOutcomeReason)
        .where(
            LeadOutcomeReason.active.is_(True),
            or_(
                LeadOutcomeReason.code == lookup_value,
                LeadOutcomeReason.label == lookup_value,
            ),
        )
        .order_by(LeadOutcomeReason.sort_order, LeadOutcomeReason.code)
    )
    outcome = result.scalars().first()
    if outcome is not None:
        return outcome

    other = await db.get(LeadOutcomeReason, "other")
    if other is None or not other.active:
        raise DomainError("结果原因目录未初始化，请先执行数据库迁移")
    return other


async def apply_outcome_reason(
    db: AsyncSession,
    student: Student,
    value: str,
) -> LeadOutcomeReason:
    normalized = (value or "").strip()
    outcome = await resolve_outcome_reason(db, normalized)
    known_value = normalized in {
        outcome.code,
        outcome.label,
    } or _LEGACY_CODE_BY_VALUE.get(normalized) == outcome.code
    student.outcome_reason_code = outcome.code
    student.status_detail = (
        outcome.label
        if known_value or not normalized
        else normalized[:64]
    )
    return outcome


async def require_reclaimable_reasons(
    db: AsyncSession,
    students: Sequence[Student],
) -> None:
    if not students:
        return
    rows = await db.execute(select(LeadOutcomeReason))
    outcomes = rows.scalars().all()
    by_code = {outcome.code: outcome for outcome in outcomes}
    by_label = {
        outcome.label: outcome for outcome in outcomes if outcome.active
    }
    other = by_code.get("other")
    if other is None:
        raise DomainError("结果原因目录未初始化，请先执行数据库迁移")

    blocked_ids: list[int] = []
    for student in students:
        outcome = None
        if student.outcome_reason_code:
            outcome = by_code.get(student.outcome_reason_code)
            if outcome is None:
                raise DomainError(
                    f"学生 {student.id} 的结果原因目录引用无效"
                )
        if outcome is None:
            value = (student.status_detail or "").strip()
            code = _LEGACY_CODE_BY_VALUE.get(value, value)
            outcome = by_code.get(code) or by_label.get(value) or other
        if not outcome.reclaimable:
            blocked_ids.append(student.id)

    if blocked_ids:
        visible_ids = ", ".join(str(student_id) for student_id in blocked_ids[:3])
        raise DomainConflict(f"以下学生的无效原因不可回收: {visible_ids}")


async def require_reclaimable_reason(
    db: AsyncSession,
    student: Student,
) -> None:
    await require_reclaimable_reasons(db, [student])
