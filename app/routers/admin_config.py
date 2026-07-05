import os

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_config import ALLOWED_CONFIG_KEYS, mask_config_value, validate_config_value
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
        return item.value
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

    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    item = result.scalar_one_or_none()
    old_value = item.value if item else ""
    if item:
        item.value = value
    else:
        item = SystemConfig(key=key, value=value)
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
