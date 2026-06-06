"""Tests for rate limiter."""

import time
from app.dial_limiter import DialLimiter as RateLimiter


class TestRateLimiter:
    def test_within_limit(self):
        rl = RateLimiter()
        assert rl.is_limited("key1", max_hits=5, window_seconds=60) is False

    def test_exceeds_limit(self):
        rl = RateLimiter()
        for _ in range(5):
            rl.is_limited("key2", max_hits=5, window_seconds=60)
        assert rl.is_limited("key2", max_hits=5, window_seconds=60) is True

    def test_different_keys(self):
        rl = RateLimiter()
        for _ in range(5):
            rl.is_limited("a", max_hits=5, window_seconds=60)
        assert rl.is_limited("b", max_hits=5, window_seconds=60) is False

    def test_window_expiry(self):
        rl = RateLimiter()
        for _ in range(3):
            rl.is_limited("k", max_hits=3, window_seconds=0)
        time.sleep(0.01)
        assert rl.is_limited("k", max_hits=3, window_seconds=0) is False
