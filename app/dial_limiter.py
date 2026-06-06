"""Simple in-memory per-key rate limiter with sliding window."""

import time
from collections import defaultdict


class DialLimiter:
    """Sliding window rate limiter. Not distributed — fine for single-process CRM."""

    def __init__(self):
        self._hits: dict[str, list[float]] = defaultdict(list)

    def is_limited(self, key: str, max_hits: int, window_seconds: int) -> bool:
        """Return True if key has exceeded max_hits within window_seconds."""
        now = time.monotonic()
        cutoff = now - window_seconds
        hits = self._hits[key]
        self._hits[key] = hits = [t for t in hits if t > cutoff]
        if len(hits) >= max_hits:
            return True
        hits.append(now)
        return False
