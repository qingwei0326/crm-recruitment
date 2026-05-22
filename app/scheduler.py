import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from app.database import async_session
from app.models import FollowUp, Student, StudentStatus, User
from app.pushplus import send_pushplus_to_user
from app.utils import today_cst_as_utc, utcnow

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
            ok = await send_pushplus_to_user(db, agent.id, "CRM 回访提醒", content)
            if ok:
                follow_up.is_notified = True
                try:
                    await db.commit()
                except Exception as e:
                    logger.warning("follow_up notify commit failed: %s", e)
                    await db.rollback()


async def scan_expired_students():
    """扫描即将过期/已过期且未标记为已过期的学生，推送给负责的话务员。"""
    async with async_session() as db:
        today = today_cst_as_utc().date()
        result = await db.execute(
            select(Student, User)
            .join(User, User.id == Student.assigned_to)
            .where(
                Student.expired_at.is_not(None),
                Student.expired_at <= today,
                Student.status != StudentStatus.expired,
                Student.status != StudentStatus.enrolled,
                Student.assigned_to.is_not(None),
            )
        )
        # 按 agent 聚合，每个 agent 一条汇总推送，避免刷屏
        by_agent: dict[int, list[Student]] = {}
        for student, agent in result.all():
            by_agent.setdefault(agent.id, []).append(student)

        for agent_id, students in by_agent.items():
            lines = ["## 学生即将/已过期提醒", "", f"共 {len(students)} 名学生需要处理：", ""]
            for s in students[:20]:
                lines.append(f"- {s.name}（{s.intent_level}，过期 {s.expired_at}）")
            if len(students) > 20:
                lines.append(f"- ……另有 {len(students) - 20} 名")
            await send_pushplus_to_user(db, agent_id, "CRM 学生过期告警", "\n".join(lines))


async def follow_up_reminder_scheduler():
    while True:
        try:
            await scan_follow_up_reminders()
        except Exception as e:
            logger.error("scan_follow_up_reminders failed: %s", e)
        await asyncio.sleep(300)


async def expired_student_scheduler():
    """每天扫一次过期学生（间隔 24h）。"""
    while True:
        try:
            await scan_expired_students()
        except Exception as e:
            logger.error("scan_expired_students failed: %s", e)
        await asyncio.sleep(86400)

