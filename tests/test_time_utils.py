from datetime import date, datetime

from app.utils import cst_date_start_as_utc, today_cst_date


def test_cst_date_start_as_utc_converts_midnight_to_previous_utc_day():
    assert cst_date_start_as_utc(date(2026, 7, 10)) == datetime(2026, 7, 9, 16, 0)


def test_today_cst_date_returns_a_date():
    assert isinstance(today_cst_date(), date)
