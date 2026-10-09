import pytest

from app.models import LEGACY_STUDENT_STATUS_NAMES, StudentStatus
from app.status_policy import (
    _CANONICAL_STATUS_BY_NAME,
    STATUS_DETAIL_VALUES,
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
        ("等待志愿", StudentStatus.pending_visit, "等待志愿"),
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


def test_enrolled_elsewhere_is_a_supported_invalid_reason_detail():
    assert "已报名其他学校" in STATUS_DETAIL_VALUES


def test_student_status_enum_has_no_aliases_and_legacy_names_resolve():
    assert all(name == member.name for name, member in StudentStatus.__members__.items())
    assert LEGACY_STUDENT_STATUS_NAMES == {
        "unassigned": StudentStatus.not_contacted,
        "no_intent": StudentStatus.not_interested,
        "child_not_interested": StudentStatus.child_not_want_study,
    }
    for legacy, canonical in LEGACY_STUDENT_STATUS_NAMES.items():
        assert legacy in _CANONICAL_STATUS_BY_NAME
        assert student_status_from_any(legacy) is canonical


async def test_legacy_status_names_load_as_canonical_members(db):
    from sqlalchemy import select, text

    from app.models import Student

    for index, legacy in enumerate(LEGACY_STUDENT_STATUS_NAMES, start=1):
        await db.execute(
            text(
                "INSERT INTO students (name, region, status, status_detail, intent_level, stage, "
                "program, guardian_name, guardian_phone, guardian2_name, guardian2_phone, "
                "school_name, school_address, need_help, created_at, updated_at) "
                "VALUES (:name, '', :status, '', 'none', 'initial_contact', '', '', '', '', '', "
                "'', '', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)"
            ),
            {"name": f"legacy-{index}", "status": legacy},
        )
    await db.commit()
    db.expunge_all()

    rows = (await db.execute(select(Student).order_by(Student.id))).scalars().all()

    assert [row.status for row in rows] == list(LEGACY_STUDENT_STATUS_NAMES.values())


async def test_legacy_status_names_are_stored_as_canonical_names(db):
    from sqlalchemy import text

    from app.models import Student

    for index, legacy in enumerate(LEGACY_STUDENT_STATUS_NAMES, start=1):
        db.add(Student(name=f"write-{index}", status=legacy))
    await db.commit()

    stored = (await db.execute(text("SELECT status FROM students ORDER BY id"))).scalars().all()

    assert stored == [member.name for member in LEGACY_STUDENT_STATUS_NAMES.values()]
