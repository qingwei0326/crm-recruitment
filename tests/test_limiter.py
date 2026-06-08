# tests/test_limiter.py
"""Tests for the custom rate limiter key function."""
import os
import pytest
from unittest.mock import MagicMock, patch


def _make_request(cf_ip=None, client_host="127.0.0.1", headers=None):
    """Helper: build a mock Request with optional CF-Connecting-IP header."""
    req = MagicMock()
    req.client = MagicMock()
    req.client.host = client_host
    h = dict(headers or {})
    if cf_ip:
        h["CF-Connecting-IP"] = cf_ip
    req.headers = h
    return req


class TestGetRealIp:
    """Tests for the _get_real_ip key function."""

    def test_with_cf_ip_when_trust_enabled(self):
        """CF-Connecting-IP should be returned when TRUST_PROXY_HEADERS=1."""
        os.environ["TRUST_PROXY_HEADERS"] = "1"
        try:
            from app.limiter import _get_real_ip
            req = _make_request(cf_ip="203.0.113.50")
            assert _get_real_ip(req) == "203.0.113.50"
        finally:
            del os.environ["TRUST_PROXY_HEADERS"]

    def test_fallback_to_client_host_when_no_cf_header(self):
        """Without CF-Connecting-IP, should fall back to request.client.host."""
        os.environ["TRUST_PROXY_HEADERS"] = "1"
        try:
            from app.limiter import _get_real_ip
            req = _make_request(client_host="10.0.0.1")
            assert _get_real_ip(req) == "10.0.0.1"
        finally:
            del os.environ["TRUST_PROXY_HEADERS"]

    def test_fallback_when_trust_disabled(self):
        """TRUST_PROXY_HEADERS=0 should always use request.client.host."""
        os.environ["TRUST_PROXY_HEADERS"] = "0"
        try:
            from app.limiter import _get_real_ip
            req = _make_request(cf_ip="203.0.113.50", client_host="10.0.0.1")
            assert _get_real_ip(req) == "10.0.0.1"
        finally:
            del os.environ["TRUST_PROXY_HEADERS"]

    def test_fallback_when_trust_not_set(self):
        """No TRUST_PROXY_HEADERS env var should use request.client.host."""
        os.environ.pop("TRUST_PROXY_HEADERS", None)
        try:
            from app.limiter import _get_real_ip
            req = _make_request(cf_ip="203.0.113.50", client_host="10.0.0.1")
            assert _get_real_ip(req) == "10.0.0.1"
        finally:
            os.environ.pop("TRUST_PROXY_HEADERS", None)

    def test_cf_ip_with_whitespace(self):
        """CF-Connecting-IP should be stripped of whitespace."""
        os.environ["TRUST_PROXY_HEADERS"] = "1"
        try:
            from app.limiter import _get_real_ip
            req = _make_request(cf_ip="  203.0.113.50  ")
            assert _get_real_ip(req) == "203.0.113.50"
        finally:
            del os.environ["TRUST_PROXY_HEADERS"]

    def test_no_client_attribute(self):
        """request.client is None should return 'unknown'."""
        os.environ["TRUST_PROXY_HEADERS"] = "0"
        try:
            from app.limiter import _get_real_ip
            req = MagicMock()
            req.client = None
            req.headers = {}
            with patch("app.limiter.get_remote_address", return_value="unknown"):
                assert _get_real_ip(req) == "unknown"
        finally:
            del os.environ["TRUST_PROXY_HEADERS"]
