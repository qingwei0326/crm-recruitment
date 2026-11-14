import pytest
from pydantic import ValidationError

from app.schemas import EnrollmentReportConfirm, EnrollmentReportCreate, VisitReportCreate


def visit_report(**overrides):
    values = {"student_id": 1, "campus_visit_at": "2026-11-20T10:00:00"}
    values.update(overrides)
    return VisitReportCreate(**values)


@pytest.mark.parametrize(
    ("field", "limit"),
    [("situation", 1000), ("parent_intent", 500), ("notes", 1000)],
)
def test_visit_report_text_is_capped(field, limit):
    assert visit_report(**{field: "字" * limit})
    with pytest.raises(ValidationError):
        visit_report(**{field: "字" * (limit + 1)})


def test_enrollment_report_notes_are_capped():
    assert EnrollmentReportCreate(student_id=1, notes="字" * 1000)
    with pytest.raises(ValidationError):
        EnrollmentReportCreate(student_id=1, notes="字" * 1001)


def test_enrollment_confirm_settlement_notes_are_capped():
    with pytest.raises(ValidationError):
        EnrollmentReportConfirm(settlement_notes="字" * 1001)
