"""Read-only agent score preview (no FastAPI dependencies, writes nothing)."""

from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent_score import score_agent_work
from app.dial_recording import (
    DIAL_RECORDING_COMPLETED,
    DIAL_RECORDING_LEGACY_MISSING,
    DIAL_RECORDING_PENDING,
)
from app.models import DialLog, FollowUp, IntentLevel, Note, Student, StudentStatus, User, UserRole
from app.services.agent_directory_service import lead_stats_by_agent
from app.task_stats import ACTIVE_TASK_STATUSES, build_task_stats
from app.utils import today_cst_as_utc, utcnow


async def agent_score_preview(
    db: AsyncSession,
    *,
    effective_daily_call_target: int,
    configured_call_target: int,
) -> dict:
    """只读评分预览：聚合现有工作记录，不写库、不改变派单或话务流程。"""
    agents_r = await db.execute(
        select(User).where(User.role == UserRole.agent, User.is_active).order_by(User.id)
    )
    agents = agents_r.scalars().all()
    if not agents:
        return {
            "generated_at": str(utcnow()),
            "daily_call_target": effective_daily_call_target,
            "configured_daily_call_target": configured_call_target,
            "items": [],
        }

    agent_ids = [agent.id for agent in agents]
    today = today_cst_as_utc()
    tomorrow = today + timedelta(days=1)

    status_counts_by_agent, total_leads_by_agent = await lead_stats_by_agent(db, agent_ids)

    student_metrics_r = await db.execute(
        select(
            Student.assigned_to,
            func.count(Student.id)
            .filter(Student.status.not_in([StudentStatus.not_contacted, StudentStatus.invalid]))
            .label("contacted_count"),
            func.count(Student.id)
            .filter(Student.intent_level == IntentLevel.A)
            .label("a_level_count"),
            func.count(Student.id)
            .filter(Student.status == StudentStatus.enrolled)
            .label("enrolled_count"),
            func.count(Student.id)
            .filter(
                Student.status.in_(ACTIVE_TASK_STATUSES),
                Student.guardian_phone == "",
                Student.guardian2_phone == "",
            )
            .label("missing_phone_tasks"),
        )
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to)
    )
    student_metrics = {
        int(row.assigned_to): {
            "contacted_count": int(row.contacted_count or 0),
            "a_level_count": int(row.a_level_count or 0),
            "enrolled_count": int(row.enrolled_count or 0),
            "missing_phone_tasks": int(row.missing_phone_tasks or 0),
        }
        for row in student_metrics_r.all()
    }

    today_calls_r = await db.execute(
        select(
            DialLog.agent_id,
            func.count(DialLog.id).label("today_calls"),
            func.count(DialLog.id)
            .filter(DialLog.recording_state == DIAL_RECORDING_COMPLETED)
            .label("today_recorded_calls"),
            func.count(DialLog.id)
            .filter(
                DialLog.recording_state.in_(
                    [DIAL_RECORDING_PENDING, DIAL_RECORDING_LEGACY_MISSING]
                )
            )
            .label("today_unrecorded_calls"),
            func.count(DialLog.id)
            .filter(DialLog.recording_state == DIAL_RECORDING_PENDING)
            .label("today_pending_dial_sessions"),
            func.count(DialLog.id)
            .filter(DialLog.recording_state == DIAL_RECORDING_LEGACY_MISSING)
            .label("today_legacy_missing_duration"),
            func.avg(DialLog.duration_seconds)
            .filter(
                DialLog.recording_state == DIAL_RECORDING_COMPLETED,
                DialLog.duration_seconds > 0,
            )
            .label("avg_recorded_duration_seconds"),
        )
        .where(
            DialLog.agent_id.in_(agent_ids),
            DialLog.dialed_at >= today,
            DialLog.dialed_at < tomorrow,
        )
        .group_by(DialLog.agent_id)
    )
    today_call_metrics = {
        int(row.agent_id): {
            "today_calls": int(row.today_calls or 0),
            "today_recorded_calls": int(row.today_recorded_calls or 0),
            "today_unrecorded_calls": int(row.today_unrecorded_calls or 0),
            "today_pending_dial_sessions": int(row.today_pending_dial_sessions or 0),
            "today_legacy_missing_duration": int(row.today_legacy_missing_duration or 0),
            "avg_recorded_duration_seconds": round(row.avg_recorded_duration_seconds or 0, 1),
        }
        for row in today_calls_r.all()
    }

    follow_up_r = await db.execute(
        select(
            FollowUp.agent_id,
            func.count(FollowUp.id)
            .filter(FollowUp.is_completed.is_(False))
            .label("open_follow_ups"),
            func.count(FollowUp.id)
            .filter(
                FollowUp.is_completed.is_(False),
                FollowUp.follow_up_date < utcnow(),
            )
            .label("overdue_follow_ups"),
            func.count(FollowUp.id)
            .filter(
                FollowUp.is_completed.is_(False),
                FollowUp.follow_up_date >= today,
                FollowUp.follow_up_date < tomorrow,
            )
            .label("today_follow_ups"),
        )
        .where(FollowUp.agent_id.in_(agent_ids))
        .group_by(FollowUp.agent_id)
    )
    follow_up_metrics = {
        int(row.agent_id): {
            "open_follow_ups": int(row.open_follow_ups or 0),
            "overdue_follow_ups": int(row.overdue_follow_ups or 0),
            "today_follow_ups": int(row.today_follow_ups or 0),
        }
        for row in follow_up_r.all()
    }

    notes_today_r = await db.execute(
        select(Note.agent_id, func.count(Note.id))
        .where(
            Note.agent_id.in_(agent_ids),
            Note.created_at >= today,
            Note.created_at < tomorrow,
        )
        .group_by(Note.agent_id)
    )
    notes_today_map = {int(agent_id): int(count or 0) for agent_id, count in notes_today_r.all()}

    items = []
    for agent in agents:
        task_stats = build_task_stats(status_counts_by_agent.get(agent.id, {}))
        sm = student_metrics.get(agent.id, {})
        fm = follow_up_metrics.get(agent.id, {})
        active_tasks = int(task_stats["total"])
        missing_phone_tasks = int(sm.get("missing_phone_tasks", 0))
        call_metrics = today_call_metrics.get(
            agent.id,
            {
                "today_calls": 0,
                "today_recorded_calls": 0,
                "today_unrecorded_calls": 0,
                "today_pending_dial_sessions": 0,
                "today_legacy_missing_duration": 0,
                "avg_recorded_duration_seconds": 0,
            },
        )
        metrics = {
            "total_leads": total_leads_by_agent.get(agent.id, 0),
            "active_tasks": active_tasks,
            "done_tasks": int(task_stats["done"]),
            "pending_tasks": int(task_stats["pending"]),
            "follow_up_tasks": int(task_stats["follow_up"]),
            "progress_pct": float(task_stats["progress_pct"]),
            "today_calls": call_metrics["today_calls"],
            "today_recorded_calls": call_metrics["today_recorded_calls"],
            "today_unrecorded_calls": call_metrics["today_unrecorded_calls"],
            "today_pending_dial_sessions": call_metrics["today_pending_dial_sessions"],
            "today_legacy_missing_duration": call_metrics[
                "today_legacy_missing_duration"
            ],
            "avg_recorded_duration_seconds": call_metrics["avg_recorded_duration_seconds"],
            "open_follow_ups": int(fm.get("open_follow_ups", 0)),
            "overdue_follow_ups": int(fm.get("overdue_follow_ups", 0)),
            "today_follow_ups": int(fm.get("today_follow_ups", 0)),
            "contacted_count": int(sm.get("contacted_count", 0)),
            "a_level_count": int(sm.get("a_level_count", 0)),
            "enrolled_count": int(sm.get("enrolled_count", 0)),
            "notes_today": notes_today_map.get(agent.id, 0),
            "missing_phone_tasks": missing_phone_tasks,
            "data_completeness_pct": round(
                (active_tasks - missing_phone_tasks) / active_tasks * 100, 1
            )
            if active_tasks > 0
            else 100.0,
        }
        score = score_agent_work(
            metrics,
            daily_call_target=effective_daily_call_target,
        )
        items.append(
            {
                "agent": {
                    "id": agent.id,
                    "name": agent.name,
                    "username": agent.username,
                    "is_active": agent.is_active,
                    "service_regions": agent.service_regions,
                },
                "metrics": metrics,
                **score,
            }
        )

    items.sort(
        key=lambda item: (
            item["score"],
            -item["metrics"]["overdue_follow_ups"],
            item["agent"]["id"],
        )
    )
    return {
        "generated_at": str(utcnow()),
        "daily_call_target": effective_daily_call_target,
        "configured_daily_call_target": configured_call_target,
        "items": items,
    }
