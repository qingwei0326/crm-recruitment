from datetime import timedelta

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    invalidate_user_tokens,
    verify_password,
)
from app.config import ACCESS_TOKEN_EXPIRE_MINUTES, COOKIE_SECURE, TRUST_PROXY_HEADERS
from app.database import get_db
from app.models import LoginAttempt, OperationLog, User
from app.pushplus import send_pushplus_to_user_background
from app.schemas import LoginReq, Response
from app.utils import utcnow

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


def _get_device_fingerprint(request: Request) -> str:
    """生成设备指纹：User-Agent 的前 512 字符"""
    user_agent = request.headers.get("User-Agent", "")
    return user_agent[:512]


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

    # 检测设备变化
    current_device = _get_device_fingerprint(request)
    device_changed = False
    if user.last_login_device and user.last_login_device != current_device:
        device_changed = True

    # Reset on successful login
    user.failed_login_attempts = 0
    user.locked_until = None

    # 更新设备信息
    old_device = user.last_login_device or "首次登录"
    old_ip = user.last_login_ip or "未知"
    user.last_login_device = current_device
    user.last_login_ip = client_ip

    db.add(
        OperationLog(
            operator_id=user.id,
            operator_name=user.name,
            action="登录",
            content=f"IP {client_ip}",
        )
    )
    await db.commit()

    # 如果检测到设备变化，发送推送通知
    if device_changed:
        device_info = current_device[:100] if current_device else "未知设备"
        content = f"""## 新设备登录提醒

- **用户**: {user.name}
- **新设备**: {device_info}
- **新IP**: {client_ip}
- **旧设备**: {old_device[:100] if old_device != "首次登录" else old_device}
- **旧IP**: {old_ip}
- **时间**: {utcnow().strftime("%Y-%m-%d %H:%M:%S")}

如非本人操作，请立即联系管理员修改密码。"""

        # 异步发送推送，不阻塞登录流程
        import asyncio

        asyncio.create_task(
            send_pushplus_to_user_background(user.id, "新设备登录提醒", content)
        )

    token = create_access_token(
        {
            "sub": str(user.id),
            "role": user.role,
            "tv": user.token_version,
        }
    )
    response = Response.ok(
        {
            "access_token": token,
            "token_type": "bearer",
            "user": {
                "id": user.id,
                "name": user.name,
                "role": user.role,
                "is_super_admin": user.is_super_admin,
                "must_change_password": user.must_change_password,
            },
        }
    )
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
    response = Response.ok(msg="已退出")
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
            "is_super_admin": current_user.is_super_admin,
            "is_active": current_user.is_active,
            "pushplus_token": current_user.pushplus_token,
            "must_change_password": current_user.must_change_password,
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


class ChangePasswordReq(BaseModel):
    old_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=6, max_length=128)


@router.post("/change-password")
async def change_password(
    body: ChangePasswordReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """用户自助修改密码：校验旧密码 → 设新密码 → 清除「需改密」标记。

    主要用于话务员首次登录 / 管理员重置密码后强制本人设置新密码。
    """
    if not verify_password(body.old_password, current_user.hashed_password):
        return Response.error(code=1, msg="当前密码不正确")
    if verify_password(body.new_password, current_user.hashed_password):
        return Response.error(code=1, msg="新密码不能与当前密码相同")

    current_user.hashed_password = hash_password(body.new_password)
    current_user.must_change_password = False
    current_user.failed_login_attempts = 0
    current_user.locked_until = None
    # 改密后让其它会话失效，并为当前会话签发新 token（避免本次请求后被登出）
    invalidate_user_tokens(current_user)
    db.add(
        OperationLog(
            operator_id=current_user.id,
            operator_name=current_user.name,
            action="修改密码",
            content="用户自助修改密码",
        )
    )
    await db.commit()
    await db.refresh(current_user)

    token = create_access_token(
        {
            "sub": str(current_user.id),
            "role": current_user.role,
            "tv": current_user.token_version,
        }
    )
    response = Response.ok({"msg": "密码已修改"})
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
