"""Admin data-quality dashboard and the on-demand domain consistency audit.
"""

from datetime import datetime, timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.dial_recording import (
    DIAL_RECORDING_COMPLETED,
    DIAL_RECORDING_LEGACY_MISSING,
    DIAL_RECORDING_PENDING,
)
from app.domain_consistency import audit_domain_consistency
from app.models import DialLog, FollowUp, Student, StudentStatus, User
from app.status_policy import status_detail_value, statuses_for_canonical
from app.task_stats import ACTIVE_TASK_STATUSES
from app.utils import utcnow


async def data_quality(db: AsyncSession, *, today: datetime, month_start: datetime) -> dict:
    """管理员数据质量看板：通话时长回写、缺电话、逾期回访和无效原因分布。"""
    now = utcnow()
    tomorrow = today + timedelta(days=1)

    def unrecorded_clause():
        return DialLog.recording_state.in_(
            [DIAL_RECORDING_PENDING, DIAL_RECORDING_LEGACY_MISSING]
        )

    call_summary_r = await db.execute(
        select(
            func.count(DialLog.id)
            .filter(DialLog.dialed_at >= today, DialLog.dialed_at < tomorrow)
            .label("today_total"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= today,
                DialLog.dialed_at < tomorrow,
                DialLog.recording_state == DIAL_RECORDING_COMPLETED,
            )
            .label("today_recorded"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= today,
                DialLog.dialed_at < tomorrow,
                DialLog.recording_state == DIAL_RECORDING_PENDING,
            )
            .label("today_pending"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= today,
                DialLog.dialed_at < tomorrow,
                DialLog.recording_state == DIAL_RECORDING_LEGACY_MISSING,
            )
            .label("today_legacy_missing"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= today,
                DialLog.dialed_at < tomorrow,
                unrecorded_clause(),
            )
            .label("today_unrecorded"),
            func.count(DialLog.id).filter(DialLog.dialed_at >= month_start).label("month_total"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= month_start,
                DialLog.recording_state == DIAL_RECORDING_COMPLETED,
            )
            .label("month_recorded"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= month_start,
                DialLog.recording_state == DIAL_RECORDING_PENDING,
            )
            .label("month_pending"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= month_start,
                DialLog.recording_state == DIAL_RECORDING_LEGACY_MISSING,
            )
            .label("month_legacy_missing"),
            func.count(DialLog.id)
            .filter(DialLog.dialed_at >= month_start, unrecorded_clause())
            .label("month_unrecorded"),
            func.avg(DialLog.duration_seconds)
            .filter(
                DialLog.dialed_at >= month_start,
                DialLog.recording_state == DIAL_RECORDING_COMPLETED,
                DialLog.duration_seconds > 0,
            )
            .label("month_avg_recorded"),
        )
    )
    call_summary = call_summary_r.one()

    agent_call_r = await db.execute(
        select(
            DialLog.agent_id,
            User.name.label("agent_name"),
            func.count(DialLog.id).label("total_calls"),
            func.count(DialLog.id)
            .filter(DialLog.recording_state == DIAL_RECORDING_COMPLETED)
            .label("recorded_calls"),
            func.count(DialLog.id)
            .filter(DialLog.recording_state == DIAL_RECORDING_PENDING)
            .label("pending_dial_sessions"),
            func.count(DialLog.id)
            .filter(DialLog.recording_state == DIAL_RECORDING_LEGACY_MISSING)
            .label("legacy_missing_duration"),
            func.count(DialLog.id).filter(unrecorded_clause()).label("unrecorded_calls"),
            func.avg(DialLog.duration_seconds)
            .filter(
                DialLog.recording_state == DIAL_RECORDING_COMPLETED,
                DialLog.duration_seconds > 0,
            )
            .label("avg_recorded_duration_seconds"),
        )
        .join(User, User.id == DialLog.agent_id)
        .where(DialLog.dialed_at >= month_start)
        .group_by(DialLog.agent_id, User.name)
    )
    agent_rows = []
    for row in agent_call_r.all():
        total_calls = int(row.total_calls or 0)
        unrecorded_calls = int(row.unrecorded_calls or 0)
        agent_rows.append(
            {
                "agent_id": int(row.agent_id),
                "agent_name": row.agent_name or "",
                "total_calls": total_calls,
                "recorded_calls": int(row.recorded_calls or 0),
                "unrecorded_calls": unrecorded_calls,
                "completed_dial_sessions": int(row.recorded_calls or 0),
                "pending_dial_sessions": int(row.pending_dial_sessions or 0),
                "legacy_missing_duration": int(row.legacy_missing_duration or 0),
                "unrecorded_ratio": round(unrecorded_calls / total_calls * 100, 1)
                if total_calls
                else 0,
                "avg_recorded_duration_seconds": round(row.avg_recorded_duration_seconds or 0, 1),
            }
        )
    agent_rows.sort(
        key=lambda item: (
            -item["pending_dial_sessions"],
            -item["legacy_missing_duration"],
            item["agent_name"],
        )
    )

    student_quality_r = await db.execute(
        select(
            func.count(Student.id)
            .filter(
                Student.status.in_(ACTIVE_TASK_STATUSES),
                or_(Student.guardian_phone == "", Student.guardian_phone.is_(None)),
                or_(Student.guardian2_phone == "", Student.guardian2_phone.is_(None)),
            )
            .label("missing_phone_tasks"),
            func.count(Student.id)
            .filter(Student.status.in_(ACTIVE_TASK_STATUSES), Student.assigned_to.is_(None))
            .label("unassigned_active"),
            func.count(Student.id)
            .filter(Student.status == StudentStatus.not_contacted, Student.assigned_to.is_not(None))
            .label("assigned_uncontacted"),
        )
    )
    student_quality = student_quality_r.one()

    invalid_reasons_r = await db.execute(
        select(Student.status, Student.status_detail, func.count(Student.id).label("count"))
        .where(Student.status.in_(statuses_for_canonical(StudentStatus.invalid)))
        .group_by(Student.status, Student.status_detail)
    )
    invalid_reason_counts: dict[str, int] = {}
    invalid_total = 0
    for row in invalid_reasons_r.all():
        count = int(row.count or 0)
        invalid_total += count
        reason = status_detail_value(row.status, row.status_detail) or "未填写"
        invalid_reason_counts[reason] = invalid_reason_counts.get(reason, 0) + count
    invalid_reasons = [
        {"reason": reason, "count": count}
        for reason, count in sorted(
            invalid_reason_counts.items(), key=lambda item: (-item[1], item[0])
        )
    ]

    follow_up_quality_r = await db.execute(
        select(
            func.count(FollowUp.id)
            .filter(FollowUp.is_completed.is_(False))
            .label("open_follow_ups"),
            func.count(FollowUp.id)
            .filter(FollowUp.is_completed.is_(False), FollowUp.follow_up_date < now)
            .label("overdue_follow_ups"),
        )
    )
    follow_up_quality = follow_up_quality_r.one()

    month_total = int(call_summary.month_total or 0)
    month_unrecorded = int(call_summary.month_unrecorded or 0)
    month_pending = int(call_summary.month_pending or 0)
    status = (
        "warning"
        if (
            month_pending > 0
            or int(getattr(student_quality, "missing_phone_tasks") or 0) > 0
            or int(getattr(follow_up_quality, "overdue_follow_ups") or 0) > 0
        )
        else "ok"
    )

    return {
        "status": status,
        "generated_at": now.isoformat(),
        "calls": {
            "today": {
                "total_calls": int(call_summary.today_total or 0),
                "recorded_calls": int(call_summary.today_recorded or 0),
                "unrecorded_calls": int(call_summary.today_unrecorded or 0),
                "completed_dial_sessions": int(call_summary.today_recorded or 0),
                "pending_dial_sessions": int(call_summary.today_pending or 0),
                "legacy_missing_duration": int(
                    call_summary.today_legacy_missing or 0
                ),
            },
            "month": {
                "total_calls": month_total,
                "recorded_calls": int(call_summary.month_recorded or 0),
                "unrecorded_calls": month_unrecorded,
                "completed_dial_sessions": int(call_summary.month_recorded or 0),
                "pending_dial_sessions": month_pending,
                "legacy_missing_duration": int(
                    call_summary.month_legacy_missing or 0
                ),
                "unrecorded_ratio": round(month_unrecorded / month_total * 100, 1)
                if month_total
                else 0,
                "avg_recorded_duration_seconds": round(call_summary.month_avg_recorded or 0, 1),
            },
            "agents": agent_rows[:10],
        },
        "students": {
            "missing_phone_tasks": int(getattr(student_quality, "missing_phone_tasks") or 0),
            "unassigned_active": int(getattr(student_quality, "unassigned_active") or 0),
            "assigned_uncontacted": int(getattr(student_quality, "assigned_uncontacted") or 0),
            "invalid_total": invalid_total,
            "invalid_reasons": invalid_reasons,
        },
        "follow_ups": {
            "open_follow_ups": int(getattr(follow_up_quality, "open_follow_ups") or 0),
            "overdue_follow_ups": int(getattr(follow_up_quality, "overdue_follow_ups") or 0),
        },
    }


async def domain_consistency(db: AsyncSession) -> dict:
    """Run the read-only domain projection consistency audit on demand."""
    report = await audit_domain_consistency(db)
    failed_checks = [
        key for key, value in report.items() if key != "ok" and int(value or 0) > 0
    ]
    return {
        "status": "ok" if report["ok"] else "warning",
        "failed_checks": failed_checks,
        "checks": report,
        "generated_at": utcnow().isoformat(),
    }
