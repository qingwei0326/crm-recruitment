import secrets
from collections.abc import Iterable
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

ADMIN_PAGE_SCORE_PREVIEW = "score_preview"
ADMIN_PAGE_ACCOUNT_MANAGE = "account_manage"
ADMIN_PAGE_REPORT_CENTER = "report_center"
ADMIN_PAGE_AUDIT_LOGS = "audit_logs"
ADMIN_PAGE_WORK_CENTER = "work_center"
ADMIN_PAGE_HOME_VISITS = "home_visits"
ADMIN_PAGE_CAMPUS_VISITS = "campus_visits"
ADMIN_PAGE_ENROLLMENT_SETTLEMENT = "enrollment_settlement"
ADMIN_PAGE_LEADS_MANAGE = "leads_manage"
ADMIN_PAGE_LEAD_GOVERNANCE = "lead_governance"
ADMIN_PAGE_INVALID_RECLAIM = "invalid_reclaim"
ADMIN_PAGE_SCHOOL_DISTRIBUTION = "school_distribution"

ADMIN_PAGE_PERMISSION_KEYS = {
    ADMIN_PAGE_WORK_CENTER,
    ADMIN_PAGE_HOME_VISITS,
    ADMIN_PAGE_CAMPUS_VISITS,
    ADMIN_PAGE_ENROLLMENT_SETTLEMENT,
    ADMIN_PAGE_LEADS_MANAGE,
    ADMIN_PAGE_LEAD_GOVERNANCE,
    ADMIN_PAGE_INVALID_RECLAIM,
    ADMIN_PAGE_SCHOOL_DISTRIBUTION,
    ADMIN_PAGE_SCORE_PREVIEW,
    ADMIN_PAGE_ACCOUNT_MANAGE,
    ADMIN_PAGE_REPORT_CENTER,
    ADMIN_PAGE_AUDIT_LOGS,
}

ADMIN_OP_STUDENT_CREATE = "student_create"
ADMIN_OP_STUDENT_EDIT = "student_edit"
ADMIN_OP_STUDENT_DELETE = "student_delete"
ADMIN_OP_STUDENT_IMPORT = "student_import"
ADMIN_OP_STUDENT_ASSIGN = "student_assign"
ADMIN_OP_STUDENT_PHONE = "student_phone"
ADMIN_OP_INVALID_RECLAIM = "invalid_reclaim"
ADMIN_OP_INVALID_DELETE = "invalid_delete"
ADMIN_OP_DUPLICATE_CLEANUP = "duplicate_cleanup"
ADMIN_OP_ASSIGNMENT_ROLLBACK = "assignment_rollback"
ADMIN_OP_GOVERNANCE_REVIEW = "governance_review"
ADMIN_OP_USER_CREATE = "user_create"
ADMIN_OP_USER_EDIT = "user_edit"
ADMIN_OP_USER_DELETE = "user_delete"
ADMIN_OP_USER_OFFBOARD = "user_offboard"
ADMIN_OP_USER_UNLOCK = "user_unlock"
ADMIN_OP_USER_RESET_PASSWORD = "user_reset_password"
ADMIN_OP_ENROLLMENT_CREATE = "enrollment_create"
ADMIN_OP_ENROLLMENT_ATTRIBUTION = "enrollment_attribution"
ADMIN_OP_ENROLLMENT_SETTLEMENT = "enrollment_settlement"
ADMIN_OP_REPORT_EXPORT = "report_export"
ADMIN_OP_AUDIT_ROLLBACK = "audit_rollback"
ADMIN_OP_AUDIT_EXPORT = "audit_export"

ADMIN_OPERATION_PERMISSION_KEYS = {
    ADMIN_OP_STUDENT_CREATE,
    ADMIN_OP_STUDENT_EDIT,
    ADMIN_OP_STUDENT_DELETE,
    ADMIN_OP_STUDENT_IMPORT,
    ADMIN_OP_STUDENT_ASSIGN,
    ADMIN_OP_STUDENT_PHONE,
    ADMIN_OP_INVALID_RECLAIM,
    ADMIN_OP_INVALID_DELETE,
    ADMIN_OP_DUPLICATE_CLEANUP,
    ADMIN_OP_ASSIGNMENT_ROLLBACK,
    ADMIN_OP_GOVERNANCE_REVIEW,
    ADMIN_OP_USER_CREATE,
    ADMIN_OP_USER_EDIT,
    ADMIN_OP_USER_DELETE,
    ADMIN_OP_USER_OFFBOARD,
    ADMIN_OP_USER_UNLOCK,
    ADMIN_OP_USER_RESET_PASSWORD,
    ADMIN_OP_ENROLLMENT_CREATE,
    ADMIN_OP_ENROLLMENT_ATTRIBUTION,
    ADMIN_OP_ENROLLMENT_SETTLEMENT,
    ADMIN_OP_REPORT_EXPORT,
    ADMIN_OP_AUDIT_ROLLBACK,
    ADMIN_OP_AUDIT_EXPORT,
}


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


def normalize_page_permissions(value: Iterable[str] | str | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw_values = value.replace("，", ",").split(",")
    else:
        raw_values = value
    seen = set()
    permissions = []
    for item in raw_values:
        key = str(item or "").strip()
        if key in ADMIN_PAGE_PERMISSION_KEYS and key not in seen:
            seen.add(key)
            permissions.append(key)
    return permissions


def page_permissions_to_storage(value: Iterable[str] | str | None) -> str:
    return ",".join(normalize_page_permissions(value))


def normalize_operation_permissions(value: Iterable[str] | str | None) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw_values = value.replace("，", ",").split(",")
    else:
        raw_values = value
    seen = set()
    permissions = []
    for item in raw_values:
        key = str(item or "").strip()
        if key in ADMIN_OPERATION_PERMISSION_KEYS and key not in seen:
            seen.add(key)
            permissions.append(key)
    return permissions


def operation_permissions_to_storage(value: Iterable[str] | str | None) -> str:
    return ",".join(normalize_operation_permissions(value))


def user_has_page_permission(user: User, permission: str) -> bool:
    if user.role != UserRole.admin:
        return False
    if user.is_super_admin:
        return True
    return permission in normalize_page_permissions(user.page_permissions)


def user_has_operation_permission(user: User, permission: str) -> bool:
    if user.role != UserRole.admin:
        return False
    if user.is_super_admin:
        return True
    return permission in normalize_operation_permissions(
        getattr(user, "operation_permissions", "") or ""
    )


def require_page_permission(permission: str):
    async def checker(current_user: User = Depends(require_admin)):
        if not user_has_page_permission(current_user, permission):
            raise HTTPException(status_code=403, detail="无权访问该管理模块")
        return current_user

    return checker


def require_any_page_permission(*permissions: str):
    async def checker(current_user: User = Depends(require_admin)):
        if not any(
            user_has_page_permission(current_user, permission) for permission in permissions
        ):
            raise HTTPException(status_code=403, detail="无权访问该管理模块")
        return current_user

    return checker


def require_operation_permission(permission: str):
    async def checker(current_user: User = Depends(require_admin)):
        if not user_has_operation_permission(current_user, permission):
            raise HTTPException(status_code=403, detail="无权执行该操作")
        return current_user

    return checker
