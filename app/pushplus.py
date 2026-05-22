import asyncio
import json
import logging
import os
from urllib.error import URLError
from urllib.request import Request, urlopen

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Student, SystemConfig, User

logger = logging.getLogger(__name__)

PUSHPLUS_API = "https://www.pushplus.plus/send"
PUSHPLUS_TITLE = "CRM A-level intent alert"


def _markdown_escape(value: object) -> str:
    return "" if value is None else str(value).replace("|", "\\|").replace("\n", " ")


async def get_pushplus_token(db: AsyncSession) -> str:
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == "pushplus_token"))
    config = result.scalar_one_or_none()
    if config and config.value:
        return config.value.strip()
    return os.getenv("PUSHPLUS_TOKEN", "").strip()


def _send_pushplus_sync(token: str, title: str, content: str) -> None:
    payload = {
        "token": token,
        "title": title,
        "content": content,
        "template": "markdown",
    }
    request = Request(
        PUSHPLUS_API,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8", errors="replace")
        if response.status >= 400:
            raise RuntimeError(f"PushPlus request failed: HTTP {response.status} {body}")


async def send_pushplus_message(db: AsyncSession, title: str, content: str) -> bool:
    token = await get_pushplus_token(db)
    if not token:
        return False

    try:
        await asyncio.to_thread(_send_pushplus_sync, token, title, content)
        return True
    except (URLError, TimeoutError, RuntimeError, OSError) as exc:
        logger.warning("PushPlus send failed: %s", exc)
        return False


async def send_pushplus_to_user(
    db: AsyncSession,
    user_id: int,
    title: str,
    content: str,
) -> bool:
    """优先用 User.pushplus_token 推送给个人，失败/未设置时回退到全局 token。"""
    user_token = ""
    if user_id:
        result = await db.execute(select(User.pushplus_token).where(User.id == user_id))
        user_token = (result.scalar_one_or_none() or "").strip()

    token = user_token or await get_pushplus_token(db)
    if not token:
        return False

    try:
        await asyncio.to_thread(_send_pushplus_sync, token, title, content)
        return True
    except (URLError, TimeoutError, RuntimeError, OSError) as exc:
        logger.warning("PushPlus user-send failed (user_id=%s): %s", user_id, exc)
        return False


async def notify_a_level_change(
    db: AsyncSession,
    student: Student,
    operator: User | None = None,
    source: str = "",
) -> bool:
    if str(student.intent_level) != "A":
        return False

    agent_name = "unassigned"
    if student.assigned_to:
        agent_result = await db.execute(select(User.name).where(User.id == student.assigned_to))
        agent_name = agent_result.scalar_one_or_none() or "unassigned"
    operator_name = operator.name if operator else "system"
    content = "\n".join(
        [
            "## A-level intent alert",
            "",
            f"- Student: {_markdown_escape(student.name)}",
            f"- School: {_markdown_escape(student.school_name or 'empty')}",
            f"- Region: {_markdown_escape(student.region or 'empty')}",
            f"- Agent: {_markdown_escape(agent_name)}",
            f"- Operator: {_markdown_escape(operator_name)}",
            f"- Source: {_markdown_escape(source or 'unknown')}",
            f"- Time: {_markdown_escape(student.updated_at or student.created_at)}",
        ]
    )
    return await send_pushplus_message(db, PUSHPLUS_TITLE, content)
