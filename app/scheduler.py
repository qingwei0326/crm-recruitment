import asyncio
from datetime import timedelta

from sqlalchemy import select

from app.database import async_session
from app.models import FollowUp, Student, User
from app.pushplus import send_pushplus_message
from app.utils import utcnow


async def scan_follow_up_reminders():
    async with async_session() as db:
        now = utcnow()
        deadline = now + timedelta(minutes=15)
        result = await db.execute(
            select(FollowUp, Student, User)
            .join(Student, Student.id == FollowUp.student_id)
            .join(User, User.id == FollowUp.agent_id)
            .where(
                FollowUp.follow_up_date <= deadline,
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
                await db.commit()
            else:
                await db.rollback()


async def follow_up_reminder_scheduler():
    while True:
        await scan_follow_up_reminders()
        await asyncio.sleep(300)
