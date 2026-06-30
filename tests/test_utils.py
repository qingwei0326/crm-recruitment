"""Tests for phone display utility."""

from app.utils import mask_phone


class TestMaskPhone:
    def test_empty(self):
        assert mask_phone("") == ""

    def test_none(self):
        assert mask_phone(None) == ""

    def test_11_digit_mobile(self):
        assert mask_phone("13800138000") == "13800138000"

    def test_11_digit_mobile_2(self):
        assert mask_phone("13912345678") == "13912345678"

    def test_12_digit_landline(self):
        assert mask_phone("059187654321") == "059187654321"

    def test_7_digit_local(self):
        assert mask_phone("1234567") == "1234567"

    def test_short_number(self):
        assert mask_phone("12345") == "12345"

    def test_very_short(self):
        assert mask_phone("12") == "12"

    def test_single_digit(self):
        assert mask_phone("1") == "1"
