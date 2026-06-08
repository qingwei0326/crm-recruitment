"""Shared API rate limiter using slowapi.

Behind Cloudflare Tunnel, ``request.client.host`` is always ``127.0.0.1`` (the
tunnel's local connection).  We read ``CF-Connecting-IP`` — written at the
Cloudflare edge and impossible for clients to forge — so that rate limits
are per-user, not per-tunnel.
"""

import os

from slowapi import Limiter
from slowapi.util import get_remote_address


def _get_real_ip(request) -> str:
    """Return the real client IP for rate-limit keying.

    When ``TRUST_PROXY_HEADERS=1`` (production behind Cloudflare Tunnel),
    prefer ``CF-Connecting-IP`` which is injected by the edge and cannot be
    spoofed.  Fall back to the raw ASGI client host otherwise.
    """
    if os.getenv("TRUST_PROXY_HEADERS") == "1":
        cf_ip = request.headers.get("CF-Connecting-IP")
        if cf_ip:
            return cf_ip.strip()
    # request.client.host may be None if the transport has no peer info
    return get_remote_address(request)


# config_filename 传空文件路径 → 跳过 .env 读取（Windows GBK 编码会导致 UnicodeDecodeError）
limiter = Limiter(key_func=_get_real_ip, default_limits=["200/minute"], config_filename="")
