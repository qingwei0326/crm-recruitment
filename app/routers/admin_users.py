from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_config import SCORE_DAILY_CALL_TARGET_MAX
from app.auth import (
    ADMIN_OP_USER_CREATE,
    ADMIN_OP_USER_DELETE,
    ADMIN_OP_USER_EDIT,
    ADMIN_OP_USER_OFFBOARD,
    ADMIN_OP_USER_RESET_PASSWORD,
    ADMIN_OP_USER_UNLOCK,
    ADMIN_PAGE_ACCOUNT_MANAGE,
    ADMIN_PAGE_AUDIT_LOGS,
    ADMIN_PAGE_SCORE_PREVIEW,
    require_admin,
    require_any_page_permission,
    require_operation_permission,
    require_page_permission,
)
from app.database import get_db
from app.models import User
from app.routers.admin import get_config_value
from app.schemas import Response
from app.services import agent_directory_service as directory
from app.services import agent_score_preview_service as score_preview
from app.services import user_account_service as accounts
from app.services.user_account_service import UserCreateReq, UserUpdateReq
from app.services.user_errors import UserForbidden, UserRequestError

router = APIRouter(prefix="/api/admin", tags=["管理"])


def _forbidden(exc: UserForbidden) -> HTTPException:
    return HTTPException(status_code=403, detail=exc.message)


@router.get("/agents")
async def list_agents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    return Response.ok(await directory.list_agents(db))


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_any_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE, ADMIN_PAGE_AUDIT_LOGS)
    ),
):
    return Response.ok(await directory.list_users(db))


@router.get("/agent-score-preview")
async def agent_score_preview(
    daily_call_target: int | None = Query(None, ge=1, le=SCORE_DAILY_CALL_TARGET_MAX),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_SCORE_PREVIEW)),
):
    """只读评分预览：聚合现有工作记录，不写库、不改变派单或话务流程。"""
    configured_call_target = int(await get_config_value(db, "score_daily_call_target", "30") or 30)
    return Response.ok(
        await score_preview.agent_score_preview(
            db,
            effective_daily_call_target=daily_call_target or configured_call_target,
            configured_call_target=configured_call_target,
        )
    )


@router.get("/agents/{agent_id}/tasks")
async def agent_tasks(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE)),
):
    try:
        return Response.ok(await directory.agent_tasks(db, agent_id))
    except UserRequestError as exc:
        return Response.error(code=1, msg=exc.message)


@router.post("/users")
async def create_user(
    body: UserCreateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_CREATE)),
):
    try:
        return Response.ok(await accounts.create_user(db, current_user, body))
    except UserRequestError as exc:
        return Response.error(code=1, msg=exc.message)
    except UserForbidden as exc:
        raise _forbidden(exc) from exc


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_EDIT)),
):
    try:
        return Response.ok(await accounts.update_user(db, current_user, user_id, body))
    except UserRequestError as exc:
        return Response.error(code=1, msg=exc.message)
    except UserForbidden as exc:
        raise _forbidden(exc) from exc


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_DELETE)),
):
    try:
        await accounts.delete_user(db, current_user, user_id)
    except UserRequestError as exc:
        return Response.error(code=1, msg=exc.message)
    except UserForbidden as exc:
        raise _forbidden(exc) from exc
    return Response.ok(msg="账号已停用并保留历史，该话务员的学生已回收至池")


@router.post("/users/{user_id}/offboard")
async def offboard_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_OFFBOARD)),
):
    """兼容旧客户端的安全离职入口，不再回收或重置非终态学生。"""
    try:
        return Response.ok(await accounts.offboard_user(db, current_user, user_id))
    except UserRequestError as exc:
        return Response.error(code=1, msg=exc.message)
    except UserForbidden as exc:
        raise _forbidden(exc) from exc


@router.post("/users/{user_id}/unlock")
async def unlock_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_UNLOCK)),
):
    try:
        username = await accounts.unlock_user(db, current_user, user_id)
    except UserRequestError as exc:
        return Response.error(code=1, msg=exc.message)
    except UserForbidden as exc:
        raise _forbidden(exc) from exc
    return Response.ok(msg=f"用户 {username} 已解锁")


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_RESET_PASSWORD)),
):
    try:
        result = await accounts.reset_user_password(db, current_user, user_id)
    except UserRequestError as exc:
        return Response.error(code=1, msg=exc.message)
    except UserForbidden as exc:
        raise _forbidden(exc) from exc
    return Response.ok(
        {"new_password": result["new_password"]},
        msg=f"用户 {result['name']} 密码已重置为 {result['new_password']}",
    )
