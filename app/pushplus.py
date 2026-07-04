import logging
import os

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session
from app.models import Student, SystemConfig, User, UserRole

logger = logging.getLogger(__name__)

PUSHPLUS_API = "https://www.pushplus.plus/send"
PUSHPLUS_TITLE = "招生系统 A级意向提醒"
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
    source_label = {
        "create": "新建线索",
        "manual": "手动标记",
        "ai": "AI分析",
    }.get(source or "", source or "未知来源")
    return "\n".join(
        [
            "## A级意向提醒",
            "",
            f"- 学生姓名: {_markdown_escape(student_name)}",
            f"- 学校: {_markdown_escape(school_name or '未填写')}",
            f"- 区域: {_markdown_escape(region or '未填写')}",
            f"- 负责话务员: {_markdown_escape(agent_name)}",
            f"- 操作人: {_markdown_escape(operator_name)}",
            f"- 来源: {_markdown_escape(source_label)}",
            f"- 时间: {_markdown_escape(changed_at)}",
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

    agent_name = "未分配"
    if student.assigned_to:
        agent_result = await db.execute(select(User.name).where(User.id == student.assigned_to))
        agent_name = agent_result.scalar_one_or_none() or "未分配"
    operator_name = operator.name if operator else "系统"
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


def _build_home_visit_content(
    student_name: str,
    guardian_phone: str,
    school_name: str,
    region: str,
    agent_name: str,
    intent_program: str,
    exam_score,
    usual_score,
    requested_visit_time,
    address: str,
    priority: str,
    parent_intent: str,
    student_situation: str,
    notes: str,
) -> str:
    return "\n".join(
        [
            "## 新家访上报",
            "",
            f"- 话务员: {_markdown_escape(agent_name)}",
            f"- 学生姓名: {_markdown_escape(student_name)}",
            f"- 家长电话: {_markdown_escape(guardian_phone or '未填写')}",
            (
                "- 区域/学校: "
                f"{_markdown_escape(region or '未填写')} / "
                f"{_markdown_escape(school_name or '未填写')}"
            ),
            f"- 意向专业: {_markdown_escape(intent_program or '未填写')}",
            f"- 中考分数: {_markdown_escape(exam_score if exam_score is not None else '未填写')}",
            f"- 平时成绩: {_markdown_escape(usual_score if usual_score is not None else '未填写')}",
            f"- 家访时间: {_markdown_escape(requested_visit_time or '未填写')}",
            f"- 地址: {_markdown_escape(address or '未填写')}",
            f"- 优先级: {_markdown_escape(priority or '中')}",
            f"- 家长意向: {_markdown_escape(parent_intent or '未填写')}",
            f"- 情况: {_markdown_escape(student_situation or '未填写')}",
            f"- 备注: {_markdown_escape(notes or '未填写')}",
        ]
    )


async def notify_home_visit_created_background(home_visit_task_id: int) -> bool:
    """Notify admins after an agent reports a home visit."""
    from app.models import HomeVisitTask

    async with async_session() as db:
        result = await db.execute(
            select(
                HomeVisitTask.student_name_snapshot,
                HomeVisitTask.guardian_phone_snapshot,
                HomeVisitTask.school_name_snapshot,
                HomeVisitTask.region_snapshot,
                HomeVisitTask.intent_program,
                HomeVisitTask.exam_score,
                HomeVisitTask.usual_score,
                HomeVisitTask.requested_visit_time,
                HomeVisitTask.address,
                HomeVisitTask.priority,
                HomeVisitTask.parent_intent,
                HomeVisitTask.student_situation,
                HomeVisitTask.notes,
                User.name,
            )
            .join(User, User.id == HomeVisitTask.creator_agent_id)
            .where(HomeVisitTask.id == home_visit_task_id)
        )
        row = result.one_or_none()
        if row is None:
            return False
        content = _build_home_visit_content(
            row.student_name_snapshot,
            row.guardian_phone_snapshot,
            row.school_name_snapshot,
            row.region_snapshot,
            row.name,
            row.intent_program,
            row.exam_score,
            row.usual_score,
            row.requested_visit_time,
            row.address,
            row.priority,
            row.parent_intent,
            row.student_situation,
            row.notes,
        )
        admin_result = await db.execute(
            select(User.id).where(User.role == UserRole.admin, User.is_active)
        )
        admin_ids = [user_id for (user_id,) in admin_result.all()]
        tokens = []
        for admin_id in admin_ids:
            token = await _resolve_user_pushplus_token(db, admin_id)
            if token and token not in tokens:
                tokens.append(token)

    if not tokens:
        return False
    sent = False
    for token in tokens:
        try:
            await _send_pushplus(token, "新家访上报", content)
            sent = True
        except (httpx.HTTPError, TimeoutError) as exc:
            logger.warning(
                "PushPlus background home-visit send failed (home_visit_task_id=%s): %s",
                home_visit_task_id,
                exc,
            )
    return sent


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
    operator_name: str = "系统",
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
        agent_name = "未分配"
        if row.assigned_to:
            agent_result = await db.execute(select(User.name).where(User.id == row.assigned_to))
            agent_name = agent_result.scalar_one_or_none() or "未分配"
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
