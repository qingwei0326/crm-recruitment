import pytest

from app.models import StudentStatus
from app.status_policy import (
    canonical_status_value,
    normalize_status_for_write,
    statuses_for_canonical,
    student_status_from_any,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("invalid", StudentStatus.invalid),
        ("无效", StudentStatus.invalid),
        ("新线索", StudentStatus.new_lead),
        ("not_contacted", StudentStatus.not_contacted),
        ("未联系", StudentStatus.not_contacted),
    ],
)
def test_student_status_from_any_accepts_db_names_and_display_values(raw, expected):
    assert student_status_from_any(raw) == expected


def test_canonical_status_value_accepts_db_enum_name():
    assert canonical_status_value("invalid") == "无效"


def test_normalize_status_for_write_accepts_legacy_invalid_reason_status_name():
    status, reason = normalize_status_for_write("not_interested")

    assert status == StudentStatus.invalid
    assert reason == "无意向"


def test_normalize_status_for_write_maps_new_lead_button_to_default_status():
    status, reason = normalize_status_for_write("新线索")

    assert status == StudentStatus.not_contacted
    assert reason == ""


@pytest.mark.parametrize(
    ("raw", "expected_status", "expected_detail"),
    [
        ("非常有意向", StudentStatus.contacted, "非常有意向"),
        ("意向了解加微", StudentStatus.pending_visit, "意向了解加微"),
        ("高分段", StudentStatus.invalid, "高分段"),
        ("孩子不想读", StudentStatus.invalid, "孩子不想读"),
        ("空号", StudentStatus.invalid, "空号"),
    ],
)
def test_normalize_status_for_write_preserves_operator_detail(
    raw, expected_status, expected_detail
):
    status, detail = normalize_status_for_write(raw)

    assert status == expected_status
    assert detail == expected_detail


def test_statuses_for_canonical_includes_legacy_database_names():
    statuses = statuses_for_canonical(StudentStatus.invalid)

    assert StudentStatus.not_interested in statuses
    assert "no_intent" in statuses
    assert "child_not_interested" in statuses
