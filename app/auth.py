import secrets
from datetime import UTC, datetime, timedelta

from fastapi import Cookie, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import ACCESS_TOKEN_EXPIRE_MINUTES, ALGORITHM, BCRYPT_ROUNDS, SECRET_KEY
from app.database import get_db
from app.models import User, UserRole

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=BCRYPT_ROUNDS)
security = HTTPBearer(auto_error=False)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict) -> str:
    to_encode = data.copy()
    now = datetime.now(UTC)
    expire = now + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update(
        {
            "exp": expire,
            "iat": now,
            "jti": secrets.token_hex(16),
        }
    )
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def invalidate_user_tokens(user: User) -> None:
    """递增 token_version：调用后该用户所有已发放 JWT 立即失效。
    用于改密码、禁用用户等场景。调用方负责 commit。"""
    user.token_version = (user.token_version or 1) + 1


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
    access_token: str | None = Cookie(default=None),
    db: AsyncSession = Depends(get_db),
) -> User:
    token = credentials.credentials if credentials else access_token
    if not token:
        raise HTTPException(status_code=401, detail="未登录")

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        token_version = payload.get("tv")
        if user_id is None:
            raise HTTPException(status_code=401, detail="无效的Token")
    except JWTError:
        raise HTTPException(status_code=401, detail="Token解析失败")

    try:
        result = await db.execute(select(User).where(User.id == int(user_id)))
    except (ValueError, TypeError):
        raise HTTPException(status_code=401, detail="无效的Token")
    user = result.scalar_one_or_none()
    if user is None or not user.is_active:
        raise HTTPException(status_code=401, detail="用户不存在或已禁用")
    # token_version 校验：改密码或禁用过的旧 token 立即失效。
    # 缺失 tv（迁移前签发的旧 token）也视为失效，强制重新登录。
    if token_version is None or token_version != user.token_version:
        raise HTTPException(status_code=401, detail="Token已失效，请重新登录")
    return user


def require_role(*roles: UserRole):
    async def checker(current_user: User = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(status_code=403, detail="权限不足")
        return current_user

    return checker


require_admin = require_role(UserRole.admin)
require_agent = require_role(UserRole.admin, UserRole.agent)


async def require_super_admin(current_user: User = Depends(get_current_user)):
    if current_user.role != UserRole.admin or not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="需要超级管理员权限")
    return current_user
