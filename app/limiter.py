"""Shared API rate limiter using slowapi."""

from slowapi import Limiter
from slowapi.util import get_remote_address

# Global limiter instance — import this everywhere
limiter = Limiter(key_func=get_remote_address, default_limits=["200/minute"])
