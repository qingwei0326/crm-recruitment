from __future__ import annotations

from typing import Any

from app.models import EnrollmentRecord

FINANCE_FIELDS = (
    "tuition_list_amount",
    "student_subsidy_amount",
    "student_paid_amount",
    "external_subsidy_amount",
    "commission_base_amount",
    "commission_subsidy_amount",
    "commission_adjustment_amount",
    "commission_paid_amount",
)


def _money(value: float | int | None) -> float:
    return round(float(value or 0), 2)


def validate_finance_values(values: dict[str, float]) -> dict[str, float]:
    normalized = {field: _money(values.get(field)) for field in FINANCE_FIELDS}
    if normalized["tuition_list_amount"] < normalized["student_subsidy_amount"]:
        raise ValueError("学费补贴不能高于标准学费")

    student_due_amount = (
        normalized["tuition_list_amount"] - normalized["student_subsidy_amount"]
    )
    commission_due_amount = (
        normalized["commission_base_amount"]
        + normalized["commission_subsidy_amount"]
        + normalized["commission_adjustment_amount"]
    )
    if commission_due_amount < 0:
        raise ValueError("佣金调整后应结金额不能小于 0")

    return {
        **normalized,
        "student_due_amount": _money(student_due_amount),
        "school_received_amount": _money(
            normalized["student_paid_amount"]
            + normalized["external_subsidy_amount"]
        ),
        "commission_due_amount": _money(commission_due_amount),
    }


def create_finance_values(body: Any) -> dict[str, float]:
    values = {
        field: getattr(body, field, None)
        for field in FINANCE_FIELDS
        if field != "commission_paid_amount"
    }
    if values.get("student_paid_amount") is None:
        values["student_paid_amount"] = getattr(body, "amount", None)
    values["commission_paid_amount"] = 0
    return validate_finance_values(values)


def merge_finance_values(record: EnrollmentRecord, body: Any) -> dict[str, float]:
    values = {field: getattr(record, field) for field in FINANCE_FIELDS}
    for field in FINANCE_FIELDS:
        if field in body.model_fields_set and getattr(body, field) is not None:
            values[field] = getattr(body, field)
    return validate_finance_values(values)


def apply_finance_values(
    record: EnrollmentRecord,
    values: dict[str, float],
    *,
    legacy_amount: float | None = None,
) -> None:
    for field in FINANCE_FIELDS:
        setattr(record, field, values[field])
    record.student_due_amount = values["student_due_amount"]
    record.school_received_amount = values["school_received_amount"]
    record.commission_due_amount = values["commission_due_amount"]
    if legacy_amount is not None:
        record.amount = legacy_amount
    elif record.amount is None:
        record.amount = values["student_paid_amount"]


def finance_payload(record: EnrollmentRecord) -> dict[str, float]:
    return {
        field: float(getattr(record, field) or 0)
        for field in FINANCE_FIELDS
    } | {
        "student_due_amount": float(record.student_due_amount or 0),
        "school_received_amount": float(record.school_received_amount or 0),
        "commission_due_amount": float(record.commission_due_amount or 0),
    }
