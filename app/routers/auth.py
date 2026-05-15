from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    create_access_token,
    get_current_user,
    verify_password,
)
from app.config import ACCESS_TOKEN_EXPIRE_MINUTES, COOKIE_SECURE, TRUST_PROXY_HEADERS
from app.database import get_db
from app.models import User
from app.schemas import LoginReq, Response

router = APIRouter(prefix="/api/auth", tags=["认证"])
api_router = APIRouter(tags=["通用"])

MAX_LOGIN_ATTEMPTS = 3
LOCKOUT_MINUTES = 5

# Simple in-memory IP rate limiter (per-process). Under multiple workers or
# processes each instance has its own counter, so effective limits scale with
# replica count unless you move this to Redis or another shared store.
_ip_attempts: dict[str, list[datetime]] = {}


def _check_ip_rate_limit(ip: str) -> bool:
    """Returns True if the IP is rate-limited (exceeded max attempts)."""
    now = datetime.utcnow()
    window = timedelta(minutes=15)
    if ip in _ip_attempts:
        _ip_attempts[ip] = [t for t in _ip_attempts[ip] if t > now - window]
        if len(_ip_attempts[ip]) >= 20:
            return True
        _ip_attempts[ip].append(now)
    else:
        _ip_attempts[ip] = [now]
    return False


def _get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("X-Forwarded-For") if TRUST_PROXY_HEADERS else None
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


@router.post("/login")
async def login(req: LoginReq, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = _get_client_ip(request)
    if _check_ip_rate_limit(client_ip):
        return JSONResponse(
            status_code=429,
            content={"code": 1, "data": None, "msg": "登录尝试过于频繁，请15分钟后再试"},
        )

    result = await db.execute(select(User).where(User.username == req.username))
    user = result.scalar_one_or_none()

    # Check account lockout
    if user and user.locked_until and user.locked_until > datetime.utcnow():
        remaining = int((user.locked_until - datetime.utcnow()).total_seconds() // 60) + 1
        return Response.error(code=1, msg=f"账号已锁定，请{remaining}分钟后再试")

    if user is None or not verify_password(req.password, user.hashed_password):
        if user:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= MAX_LOGIN_ATTEMPTS:
                user.locked_until = datetime.utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
                user.failed_login_attempts = 0
                await db.commit()
                return Response.error(
                    code=1, msg=f"密码错误{MAX_LOGIN_ATTEMPTS}次，账号已锁定{LOCKOUT_MINUTES}分钟"
                )
            await db.commit()
        return Response.error(code=1, msg="用户名或密码错误")

    if not user.is_active:
        return Response.error(code=1, msg="账号已被禁用")

    # Reset on successful login
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()

    token = create_access_token({"sub": str(user.id), "role": user.role})
    body = Response.ok(
        {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "name": user.name,
                "role": user.role,
            },
        }
    )
    response = JSONResponse(content=body)
    response.set_cookie(
        key="access_token",
        value=token,
        path="/",
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax",
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )
    return response


@router.post("/logout")
async def logout():
    response = JSONResponse(content=Response.ok(msg="已退出"))
    response.delete_cookie(key="access_token", path="/")
    return response


@router.get("/me")
@api_router.get("/api/me")
async def me(current_user: User = Depends(get_current_user)):
    return Response.ok(
        {
            "id": current_user.id,
            "username": current_user.username,
            "name": current_user.name,
            "role": current_user.role,
            "is_active": current_user.is_active,
            "created_at": str(current_user.created_at),
        }
    )
