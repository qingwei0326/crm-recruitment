import os

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_config import (
    ALLOWED_CONFIG_KEYS,
    ASSIGNMENT_CAPACITY_DEFAULTS,
    decrypt_secret_config_value,
    encrypt_secret_config_value,
    mask_config_value,
    validate_capacity_settings,
    validate_config_value,
)
from app.auth import require_super_admin
from app.database import get_db
from app.models import SystemConfig, User
from app.schemas import Response
from app.utils import make_operation_log

router = APIRouter(prefix="/api/admin", tags=["管理"])


class ConfigUpdateReq(BaseModel):
    key: str
    value: str


async def get_config_value(db: AsyncSession, key: str, fallback: str = "") -> str:
    """Read SystemConfig, then same-name uppercase env var, then fallback."""
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    item = result.scalar_one_or_none()
    if item and item.value:
        return decrypt_secret_config_value(key, item.value)
    return os.getenv(key.upper(), fallback)


@router.get("/config")
async def get_system_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    result = await db.execute(select(SystemConfig).order_by(SystemConfig.key))
    data = {item.key: mask_config_value(item.key, item.value) for item in result.scalars().all()}
    return Response.ok(data)


@router.put("/config")
async def update_system_config(
    body: ConfigUpdateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    key = body.key.strip()
    value = body.value.strip()
    if key not in ALLOWED_CONFIG_KEYS:
        return Response.error(code=1, msg="Unsupported config key")

    normalized, err = validate_config_value(key, value)
    if err:
        return Response.error(code=1, msg=err)
    value = normalized
    # 校验基于明文；通过后才加密落库，历史明文值在下次保存时自动转为密文。
    stored_value = encrypt_secret_config_value(key, value)

    if key in ASSIGNMENT_CAPACITY_DEFAULTS:
        capacity_result = await db.execute(
            select(SystemConfig).where(
                SystemConfig.key.in_(tuple(ASSIGNMENT_CAPACITY_DEFAULTS))
            )
        )
        capacity_values = {
            setting_key: str(default)
            for setting_key, default in ASSIGNMENT_CAPACITY_DEFAULTS.items()
        }
        capacity_values.update(
            {item.key: item.value.strip() for item in capacity_result.scalars().all()}
        )
        capacity_values[key] = value
        try:
            valid, capacity_error = validate_capacity_settings(
                lookback_days=int(capacity_values["assignment_capacity_lookback_days"]),
                observed_days=int(capacity_values["assignment_capacity_observed_days"]),
                min_daily_capacity=int(capacity_values["assignment_capacity_min"]),
                max_daily_capacity=int(capacity_values["assignment_capacity_max"]),
                insufficient_history_mode=capacity_values[
                    "assignment_capacity_insufficient_history"
                ],
            )
        except (TypeError, ValueError):
            valid = False
            capacity_error = "现有招生容量配置无效"
        if not valid:
            return Response.error(code=1, msg=capacity_error or "Invalid capacity settings")

    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    item = result.scalar_one_or_none()
    old_value = item.value if item else ""
    if item:
        item.value = stored_value
    else:
        item = SystemConfig(key=key, value=stored_value)
        db.add(item)
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="修改系统配置",
            content=(
                f"{key}: {mask_config_value(key, old_value)} → {mask_config_value(key, value)}"
            ),
        )
    )
    await db.commit()

    return Response.ok({"key": key, "value": mask_config_value(key, value)})
