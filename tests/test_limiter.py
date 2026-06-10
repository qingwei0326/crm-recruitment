"""Tests for the custom rate limiter key function."""

from unittest.mock import MagicMock, patch


def _make_request(cf_ip=None, client_host="127.0.0.1"):
    """Helper: build a mock Request with optional CF-Connecting-IP header."""
    req = MagicMock()
    req.client = MagicMock()
    req.client.host = client_host
    headers = {}
    if cf_ip:
        headers["CF-Connecting-IP"] = cf_ip
    req.headers = headers
    return req


class TestGetRealIp:
    @patch("app.limiter.TRUST_PROXY_HEADERS", True)
    def test_with_cf_ip_when_trust_enabled(self):
        from app.limiter import _get_real_ip

        req = _make_request(cf_ip="203.0.113.50")
        assert _get_real_ip(req) == "203.0.113.50"

    @patch("app.limiter.TRUST_PROXY_HEADERS", True)
    def test_fallback_to_client_host_when_no_cf_header(self):
        from app.limiter import _get_real_ip

        req = _make_request(client_host="10.0.0.1")
        assert _get_real_ip(req) == "10.0.0.1"

    @patch("app.limiter.TRUST_PROXY_HEADERS", False)
    def test_fallback_when_trust_disabled(self):
        from app.limiter import _get_real_ip

        req = _make_request(cf_ip="203.0.113.50", client_host="10.0.0.1")
        assert _get_real_ip(req) == "10.0.0.1"

    @patch("app.limiter.TRUST_PROXY_HEADERS", True)
    def test_cf_ip_with_whitespace(self):
        from app.limiter import _get_real_ip

        req = _make_request(cf_ip="  203.0.113.50  ")
        assert _get_real_ip(req) == "203.0.113.50"

    @patch("app.limiter.TRUST_PROXY_HEADERS", False)
    @patch("app.limiter.get_remote_address", return_value="unknown")
    def test_no_client_attribute(self, mock_gra):
        from app.limiter import _get_real_ip

        req = MagicMock()
        req.client = None
        req.headers = {}
        assert _get_real_ip(req) == "unknown"
