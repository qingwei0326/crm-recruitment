import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select

from app.database import async_session
from app.expiry import mark_expired_students
from app.models import FollowUp, OperationLog, Student, StudentStatus, User
from app.pushplus import send_pushplus_to_user
from app.utils import today_cst_as_utc, utcnow

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
                            f"follow_up_id={follow_up.id}|||"
                            + content
                        ),
                    )
                )
                try:
                    await db.commit()
                except Exception as e:
                    logger.warning("follow_up notify_fail log commit failed: %s", e)
                    await db.rollback()


async def scan_expired_students():
    """每日：先把已过期且不活跃的学生自动标记为 expired，再对仍需处理的推送提醒。"""
    async with async_session() as db:
        # 1) 自动标记：已过期 + 最后活动早于今日 + 非终态 → status=expired
        #    （与管理员手动「过期检查」共用 app.expiry.mark_expired_students）
        try:
            marked = await mark_expired_students(db)
            await db.commit()
            if marked:
                logger.info("auto-marked %d students as expired", marked)
        except Exception as e:
            logger.warning("auto expire-mark failed: %s", e)
            await db.rollback()

        # 2) 提醒：对仍未进入 expired 终态、但已到期/即将到期的学生推送话务员。
        #    被上一步归档的（不活跃）已变为 expired，会被 status != expired 过滤掉，不再骚扰。
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
            ok = await send_pushplus_to_user(db, agent_id, "CRM 学生过期告警", "\n".join(lines))
            if not ok:
                db.add(
                    OperationLog(
                        operator_id=None,
                        operator_name="scheduler",
                        action="通知失败",
                        content=(
                            f"CRM 学生过期告警|||agent_id={agent_id}|||"
                            f"{len(students)} students|||"
                            + "\n".join(lines)
                        ),
                    )
                )
                try:
                    await db.commit()
                except Exception as e:
                    logger.warning("notify_fail log commit failed: %s", e)
                    await db.rollback()
            else:
                logger.info(
                    "expired alert sent to agent_id=%s (%d students)", agent_id, len(students)
                )


async def follow_up_reminder_scheduler():
    while True:
        try:
            await scan_follow_up_reminders()
        except Exception as e:
            logger.error("scan_follow_up_reminders failed: %s", e)
        await asyncio.sleep(300)


async def expired_student_scheduler():
    """每天 08:00 CST 扫一次过期学生，重启后不丢窗口。"""
    from app.utils import _CST

    while True:
        try:
            now = datetime.now(_CST)
            # 计算下一次 08:00 CST
            target = now.replace(hour=8, minute=0, second=0, microsecond=0)
            if target <= now:
                from datetime import timedelta

                target += timedelta(days=1)
            wait_seconds = (target - now).total_seconds()
            logger.info("expired_student_scheduler: next scan in %.0fs", wait_seconds)
            await asyncio.sleep(wait_seconds)
            await scan_expired_students()
        except Exception as e:
            logger.error("scan_expired_students failed: %s", e)
            await asyncio.sleep(3600)  # 失败后 1h 重试


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
