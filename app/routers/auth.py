from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from pydantic import BaseModel, Field

from app.auth import (
    create_access_token,
    get_current_user,
    verify_password,
)
from app.utils import utcnow
from app.config import ACCESS_TOKEN_EXPIRE_MINUTES, COOKIE_SECURE, TRUST_PROXY_HEADERS
from app.database import get_db
from app.models import LoginAttempt, OperationLog, User
from app.schemas import LoginReq, Response

router = APIRouter(prefix="/api/auth", tags=["认证"])
api_router = APIRouter(tags=["通用"])

MAX_LOGIN_ATTEMPTS = 3
LOCKOUT_MINUTES = 5
IP_RATE_WINDOW_MIN = 15
IP_RATE_MAX = 20


async def _check_ip_rate_limit(db: AsyncSession, ip: str) -> bool:
    """跨进程共享的 IP 限流：用 login_attempts 表计数。返回 True 表示已超限。"""
    now = utcnow()
    window_start = now - timedelta(minutes=IP_RATE_WINDOW_MIN)
    # 顺手清理远早于窗口的旧记录（额外保留 1 小时缓冲，避免每次都全表清扫）
    await db.execute(
        delete(LoginAttempt).where(LoginAttempt.attempted_at < window_start - timedelta(hours=1))
    )
    count_r = await db.execute(
        select(func.count(LoginAttempt.id)).where(
            LoginAttempt.ip == ip,
            LoginAttempt.attempted_at > window_start,
        )
    )
    count = count_r.scalar() or 0
    if count >= IP_RATE_MAX:
        await db.commit()
        return True
    db.add(LoginAttempt(ip=ip, attempted_at=now))
    await db.commit()
    return False


def _get_client_ip(request: Request) -> str:
    # 仅信任 Cloudflare 注入的 CF-Connecting-IP；客户端不能伪造（cloudflared 隧道层会覆写）。
    # X-Forwarded-For 不能信：客户端能任意构造让 IP 限流计数器分散。
    if TRUST_PROXY_HEADERS:
        cf_ip = request.headers.get("CF-Connecting-IP")
        if cf_ip:
            return cf_ip.strip()
    return request.client.host if request.client else "unknown"


@router.post("/login")
async def login(req: LoginReq, request: Request, db: AsyncSession = Depends(get_db)):
    client_ip = _get_client_ip(request)
    if await _check_ip_rate_limit(db, client_ip):
        return JSONResponse(
            status_code=429,
            content={"code": 1, "data": None, "msg": "登录尝试过于频繁，请15分钟后再试"},
        )

    result = await db.execute(select(User).where(User.username == req.username))
    user = result.scalar_one_or_none()

    # Check account lockout
    if user and user.locked_until and user.locked_until > utcnow():
        remaining = int((user.locked_until - utcnow()).total_seconds() // 60) + 1
        return Response.error(code=1, msg=f"账号已锁定，请{remaining}分钟后再试")

    if user is None or not verify_password(req.password, user.hashed_password):
        if user:
            user.failed_login_attempts += 1
            if user.failed_login_attempts >= MAX_LOGIN_ATTEMPTS:
                user.locked_until = utcnow() + timedelta(minutes=LOCKOUT_MINUTES)
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
    db.add(
        OperationLog(
            operator_id=user.id,
            operator_name=user.name,
            action="登录",
            content=f"IP {client_ip}",
        )
    )
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
        samesite="strict",
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
            "pushplus_token": current_user.pushplus_token,
            "created_at": str(current_user.created_at),
        }
    )


class PushplusTokenUpdate(BaseModel):
    pushplus_token: str = Field(default="", max_length=64)


@router.put("/me/pushplus-token")
async def update_my_pushplus_token(
    body: PushplusTokenUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.pushplus_token = body.pushplus_token.strip()
    db.add(current_user)
    await db.commit()
    return Response.ok({"pushplus_token": current_user.pushplus_token})
