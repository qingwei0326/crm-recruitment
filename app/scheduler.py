import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from app.database import async_session
from app.models import FollowUp, Student, User
from app.pushplus import send_pushplus_message
from app.utils import utcnow

logger = logging.getLogger(__name__)


async def scan_follow_up_reminders():
    async with async_session() as db:
        now = utcnow()
        deadline = now + timedelta(minutes=15)
        # 下限：只扫 7 天内的待提醒回访，避免拉取大量历史未通知记录
        floor = now - timedelta(days=7)
        result = await db.execute(
            select(FollowUp, Student, User)
            .join(Student, Student.id == FollowUp.student_id)
            .join(User, User.id == FollowUp.agent_id)
            .where(
                FollowUp.follow_up_date <= deadline,
                FollowUp.follow_up_date >= floor,
                FollowUp.is_notified.is_(False),
            )
            .order_by(FollowUp.follow_up_date.asc())
        )
        for follow_up, student, agent in result.all():
            content = "\n".join(
                [
                    "## 回访提醒",
                    "",
                    f"- 学生姓名: {student.name}",
                    f"- 意向等级: {student.intent_level}",
                    f"- 回访时间: {follow_up.follow_up_date}",
                    f"- 负责坐席: {agent.name}",
                ]
            )
            ok = await send_pushplus_message(db, "CRM 回访提醒", content)
            if ok:
                follow_up.is_notified = True
                try:
                    await db.commit()
                except Exception as e:
                    logger.warning("follow_up notify commit failed: %s", e)
                    await db.rollback()


async def follow_up_reminder_scheduler():
    while True:
        try:
            await scan_follow_up_reminders()
        except Exception as e:
            logger.error("scan_follow_up_reminders failed: %s", e)
        await asyncio.sleep(300)

