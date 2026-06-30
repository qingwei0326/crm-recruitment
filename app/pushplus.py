import logging
import os

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models import Student, SystemConfig, User

logger = logging.getLogger(__name__)

PUSHPLUS_API = "https://www.pushplus.plus/send"
PUSHPLUS_TITLE = "CRM A-level intent alert"
PUSHPLUS_TIMEOUT = 10


def _markdown_escape(value: object) -> str:
    return "" if value is None else str(value).replace("|", "\\|").replace("\n", " ")


async def get_pushplus_token(db: AsyncSession) -> str:
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == "pushplus_token"))
    config = result.scalar_one_or_none()
    if config and config.value:
        return config.value.strip()
    return os.getenv("PUSHPLUS_TOKEN", "").strip()


async def _send_pushplus(token: str, title: str, content: str) -> None:
    async with httpx.AsyncClient(timeout=PUSHPLUS_TIMEOUT) as client:
        resp = await client.post(
            PUSHPLUS_API,
            json={"token": token, "title": title, "content": content, "template": "markdown"},
        )
        resp.raise_for_status()


async def _resolve_user_pushplus_token(db: AsyncSession, user_id: int) -> str:
    user_token = ""
    if user_id:
        result = await db.execute(select(User.pushplus_token).where(User.id == user_id))
        user_token = (result.scalar_one_or_none() or "").strip()
    return user_token or await get_pushplus_token(db)


async def send_pushplus_message(db: AsyncSession, title: str, content: str) -> bool:
    token = await get_pushplus_token(db)
    if not token:
        return False
    try:
        await _send_pushplus(token, title, content)
        return True
    except (httpx.HTTPError, TimeoutError) as exc:
        logger.warning("PushPlus send failed: %s", exc)
        return False


async def send_pushplus_to_user(
    db: AsyncSession,
    user_id: int,
    title: str,
    content: str,
) -> bool:
    """优先用 User.pushplus_token 推送给个人，失败/未设置时回退到全局 token。"""
    token = await _resolve_user_pushplus_token(db, user_id)
    if not token:
        return False
    try:
        await _send_pushplus(token, title, content)
        return True
    except (httpx.HTTPError, TimeoutError) as exc:
        logger.warning("PushPlus user-send failed (user_id=%s): %s", user_id, exc)
        return False


def _build_a_level_content(
    student_name: str,
    school_name: str,
    region: str,
    agent_name: str,
    operator_name: str,
    source: str,
    changed_at,
) -> str:
    return "\n".join(
        [
            "## A-level intent alert",
            "",
            f"- Student: {_markdown_escape(student_name)}",
            f"- School: {_markdown_escape(school_name or 'empty')}",
            f"- Region: {_markdown_escape(region or 'empty')}",
            f"- Agent: {_markdown_escape(agent_name)}",
            f"- Operator: {_markdown_escape(operator_name)}",
            f"- Source: {_markdown_escape(source or 'unknown')}",
            f"- Time: {_markdown_escape(changed_at)}",
        ]
    )


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
    content = _build_a_level_content(
        student.name,
        student.school_name or "",
        student.region or "",
        agent_name,
        operator_name,
        source,
        student.updated_at or student.created_at,
    )
    return await send_pushplus_message(db, PUSHPLUS_TITLE, content)


async def send_pushplus_to_user_background(user_id: int, title: str, content: str) -> bool:
    """Send a user notification with a fresh DB session for background tasks."""
    async with async_session() as db:
        token = await _resolve_user_pushplus_token(db, user_id)
    if not token:
        return False
    try:
        await _send_pushplus(token, title, content)
        return True
    except (httpx.HTTPError, TimeoutError) as exc:
        logger.warning("PushPlus background user-send failed (user_id=%s): %s", user_id, exc)
        return False


async def notify_a_level_change_background(
    student_id: int,
    operator_name: str = "system",
    source: str = "",
) -> bool:
    """Send an A-level alert without reusing a request-scoped AsyncSession."""
    async with async_session() as db:
        result = await db.execute(
            select(
                Student.name,
                Student.school_name,
                Student.region,
                Student.assigned_to,
                Student.intent_level,
                Student.updated_at,
                Student.created_at,
            ).where(Student.id == student_id)
        )
        row = result.one_or_none()
        if row is None or str(row.intent_level) != "A":
            return False
        agent_name = "unassigned"
        if row.assigned_to:
            agent_result = await db.execute(select(User.name).where(User.id == row.assigned_to))
            agent_name = agent_result.scalar_one_or_none() or "unassigned"
        token = await get_pushplus_token(db)
        content = _build_a_level_content(
            row.name,
            row.school_name or "",
            row.region or "",
            agent_name,
            operator_name,
            source,
            row.updated_at or row.created_at,
        )

    if not token:
        return False
    try:
        await _send_pushplus(token, PUSHPLUS_TITLE, content)
        return True
    except (httpx.HTTPError, TimeoutError) as exc:
        logger.warning(
            "PushPlus background A-level send failed (student_id=%s): %s",
            student_id,
            exc,
        )
        return False
