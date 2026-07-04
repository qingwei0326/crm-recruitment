import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from app.database import async_session
from app.models import FollowUp, OperationLog, Student, User
from app.pushplus import send_pushplus_to_user
from app.utils import utcnow

logger = logging.getLogger(__name__)


async def scan_follow_up_reminders():
    async with async_session() as db:
        now = utcnow()
        # 从 SystemConfig 读回访提醒窗口，默认 15min
        from app.routers.admin import get_config_value

        window_str = await get_config_value(db, "follow_up_window_minutes", "15")
        try:
            window_minutes = max(1, min(60, int(window_str)))
        except (ValueError, TypeError):
            window_minutes = 15
        deadline = now + timedelta(minutes=window_minutes)
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
            else:
                # 推送失败，记录但不标记 is_notified，下次扫描会自动重试
                db.add(
                    OperationLog(
                        operator_id=None,
                        operator_name="scheduler",
                        action="通知失败",
                        content=(
                            f"CRM 回访提醒|||agent_id={agent.id}|||"
                            f"follow_up_id={follow_up.id}|||" + content
                        ),
                    )
                )
                try:
                    await db.commit()
                except Exception as e:
                    logger.warning("follow_up notify_fail log commit failed: %s", e)
                    await db.rollback()


async def scan_expired_students():
    """过期逻辑已暂时停用，保留函数以兼容旧测试/脚本调用。"""
    logger.info("scan_expired_students skipped: expiry flow disabled")


async def follow_up_reminder_scheduler():
    while True:
        try:
            await scan_follow_up_reminders()
        except Exception as e:
            logger.error("scan_follow_up_reminders failed: %s", e)
        await asyncio.sleep(300)


async def expired_student_scheduler():
    """过期调度已暂时停用。"""
    logger.info("expired_student_scheduler disabled")


async def retry_failed_notifications():
    """重试最近 24h 内的通知失败记录。"""
    async with async_session() as db:
        from datetime import timedelta

        cutoff = utcnow() - timedelta(hours=24)

        # 查找最近 24h 的通知失败记录
        result = await db.execute(
            select(OperationLog)
            .where(
                OperationLog.action == "通知失败",
                OperationLog.created_at >= cutoff,
            )
            .order_by(OperationLog.created_at.asc())
            .limit(50)  # 每次最多重试 50 条
        )
        logs = result.scalars().all()

        retried = 0
        for log in logs:
            # 解析 content: "title|||metadata|||actual_content"
            parts = log.content.split("|||", 2)
            if len(parts) < 3:
                # 无法解析，删除旧记录
                await db.delete(log)
                continue

            title = parts[0]
            metadata = parts[1]
            content = parts[2]

            # 从 metadata 提取 agent_id
            agent_id = None
            for segment in metadata.split(","):
                segment = segment.strip()
                if segment.startswith("agent_id="):
                    try:
                        agent_id = int(segment.split("=")[1])
                    except (ValueError, IndexError):
                        pass

            if not agent_id:
                await db.delete(log)
                continue

            # 重试发送
            ok = await send_pushplus_to_user(db, agent_id, title, content)
            if ok:
                await db.delete(log)
                retried += 1
                logger.info("retry succeeded: %s to agent_id=%s", title, agent_id)
            else:
                logger.info("retry still failed: %s to agent_id=%s", title, agent_id)

        if retried > 0:
            try:
                await db.commit()
                logger.info("retry sweep: %d/%d succeeded", retried, len(logs))
            except Exception as e:
                logger.warning("retry sweep commit failed: %s", e)
                await db.rollback()


async def notification_retry_scheduler():
    """每 30 分钟重试失败的通知。"""
    while True:
        try:
            await retry_failed_notifications()
        except Exception as e:
            logger.error("retry_failed_notifications failed: %s", e)
        await asyncio.sleep(1800)
