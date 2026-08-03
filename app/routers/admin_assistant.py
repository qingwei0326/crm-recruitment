from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant_config_service import (
    AssistantConfigError,
    apply_assistant_config_update,
    assistant_config_payload,
    get_assistant_config,
    runtime_assistant_config,
)
from app.assistant_provider import AssistantProviderError, test_openai_tool_call
from app.assistant_service import (
    AssistantServiceError,
    approve_assistant_tool_call,
    assistant_session_detail,
    create_assistant_session,
    list_assistant_sessions,
    reject_assistant_tool_call,
    run_assistant_turn,
)
from app.auth import require_super_admin
from app.database import get_db
from app.models import User
from app.schemas import Response
from app.utils import make_operation_log

router = APIRouter(prefix="/api/admin/assistant", tags=["超级管理员 AI 助手"])


class AssistantConfigUpdate(BaseModel):
    enabled: bool = False
    base_url: str = Field(default="https://api.openai.com/v1", max_length=512)
    model: str = Field(default="", max_length=128)
    api_key: str | None = Field(default=None, max_length=512)
    clear_api_key: bool = False


class AssistantPageContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    route: str = Field(default="", max_length=200)
    student_id: int | None = Field(default=None, gt=0)
    selected_student_ids: list[int] = Field(default_factory=list, max_length=100)


class AssistantTurnReq(BaseModel):
    content: str = Field(min_length=1, max_length=4000)
    context: AssistantPageContext = Field(default_factory=AssistantPageContext)


class AssistantApproveReq(BaseModel):
    approval_token: str = Field(min_length=1, max_length=2000)
    confirmation_phrase: str = Field(default="", max_length=128)


@router.get("/config")
async def read_assistant_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    config = await get_assistant_config(db)
    return Response.ok(assistant_config_payload(config))


@router.put("/config")
async def update_assistant_config(
    body: AssistantConfigUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    config = await get_assistant_config(db)
    old_payload = assistant_config_payload(config)
    old_ciphertext = config.api_key_ciphertext
    try:
        apply_assistant_config_update(
            config,
            enabled=body.enabled,
            base_url=body.base_url,
            model=body.model,
            api_key=body.api_key,
            clear_api_key=body.clear_api_key,
            operator_id=current_user.id,
        )
    except AssistantConfigError as exc:
        return Response.error(msg=str(exc))
    db.add(config)
    new_payload = assistant_config_payload(config)
    key_changed = old_ciphertext != config.api_key_ciphertext
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="修改AI助手配置",
            content=(
                f"启用 {old_payload['enabled']} → {new_payload['enabled']}; "
                f"模型 {old_payload['model'] or '未设置'} → {new_payload['model'] or '未设置'}; "
                f"接口 {old_payload['base_url']} → {new_payload['base_url']}; "
                f"密钥{'已更新' if key_changed else '未变更'}"
            ),
        )
    )
    await db.commit()
    return Response.ok(new_payload)


@router.post("/config/test")
async def test_assistant_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    config = await get_assistant_config(db)
    try:
        runtime = runtime_assistant_config(config)
        result = await test_openai_tool_call(runtime)
    except (AssistantConfigError, AssistantProviderError) as exc:
        return Response.error(msg=str(exc))
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="测试AI助手",
            content=f"模型 {runtime.model} Tool Calling 测试通过",
        )
    )
    await db.commit()
    return Response.ok(result, msg="连接和 Tool Calling 测试通过")


@router.get("/sessions")
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    return Response.ok(await list_assistant_sessions(db, current_user))


@router.post("/sessions")
async def create_session(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    return Response.ok(await create_assistant_session(db, current_user))


@router.get("/sessions/{session_id}")
async def get_session(
    session_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    try:
        data = await assistant_session_detail(db, session_id, current_user)
    except AssistantServiceError as exc:
        return Response.error(msg=str(exc))
    return Response.ok(data)


@router.post("/sessions/{session_id}/messages")
async def send_message(
    session_id: str,
    body: AssistantTurnReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    try:
        data = await run_assistant_turn(
            db,
            session_id=session_id,
            content=body.content,
            context=body.context.model_dump(mode="json"),
            operator=current_user,
        )
    except AssistantServiceError as exc:
        return Response.error(msg=str(exc))
    return Response.ok(data)


@router.post("/tool-calls/{tool_call_id}/approve")
async def approve_tool_call(
    tool_call_id: str,
    body: AssistantApproveReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    try:
        data = await approve_assistant_tool_call(
            db,
            tool_call_id=tool_call_id,
            approval_token=body.approval_token,
            confirmation_phrase=body.confirmation_phrase,
            operator=current_user,
        )
    except AssistantServiceError as exc:
        return Response.error(msg=str(exc))
    return Response.ok(data)


@router.post("/tool-calls/{tool_call_id}/reject")
async def reject_tool_call(
    tool_call_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    try:
        data = await reject_assistant_tool_call(
            db,
            tool_call_id=tool_call_id,
            operator=current_user,
        )
    except AssistantServiceError as exc:
        return Response.error(msg=str(exc))
    return Response.ok(data)
