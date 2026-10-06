"""Governance signals: the data-health center and recent high-risk operation alerts.
"""

from datetime import UTC, datetime, timedelta, timezone

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_lead_utils import _build_duplicate_phone_cleanup_plan, _student_phone_values
from app.expiry import build_last_activity_subquery
from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    DialLog,
    EnrollmentRecord,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    OperationLog,
    SettlementStatus,
    Student,
)
from app.services.governance_review import (
    GOVERNANCE_REVIEW_TTL_DAYS,
    _apply_governance_review,
    _latest_governance_reviews,
)
from app.task_stats import ACTIVE_TASK_STATUSES, TERMINAL_STUDENT_STATUSES
from app.utils import utcnow

_CST = timezone(timedelta(hours=8))


def _risk_alert(
    *,
    alert_type: str,
    title: str,
    severity: str,
    count: int,
    detail: str,
    action: str = "",
    category: str = "",
    q: str = "",
    to: str = "",
    entity_keys: list[str] | None = None,
) -> dict:
    return {
        "type": alert_type,
        "review_key": alert_type,
        "title": title,
        "severity": severity,
        "count": count,
        "detail": detail,
        "action": action,
        "category": category,
        "q": q,
        "to": to,
        "_review_entities": entity_keys or [],
    }


BATCH_DISTRIBUTION_SUMMARY_ACTIONS = {
    "批量分配",
    "自动分配汇总",
    "区域分配汇总",
    "学校分配汇总",
    "多学校分发汇总",
    "智能分配汇总",
}


WORK_HOUR_WINDOWS = (
    (9 * 60, 11 * 60),
    (14 * 60 + 30, 18 * 60),
    (19 * 60, 21 * 60),
)


def is_work_hour(dt: datetime | None) -> bool:
    if not dt:
        return True
    utc_dt = dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt.astimezone(UTC)
    local_dt = utc_dt.astimezone(_CST)
    minutes = local_dt.hour * 60 + local_dt.minute
    return any(start <= minutes < end for start, end in WORK_HOUR_WINDOWS)


def _health_signal(
    *,
    key: str,
    title: str,
    count: int,
    severity: str,
    detail: str,
    to: str,
    review_key: str = "",
    entity_keys: list[str] | None = None,
) -> dict:
    return {
        "key": key,
        "review_key": review_key or key,
        "title": title,
        "count": int(count or 0),
        "severity": severity,
        "detail": detail,
        "to": to,
        "_review_entities": entity_keys or [],
    }


async def data_health(db: AsyncSession) -> dict:
    """线索治理健康中心：聚合可复核的数据异常入口，不自动修改数据。"""
    now = utcnow()
    cutoff_7d = now - timedelta(days=GOVERNANCE_REVIEW_TTL_DAYS)
    stale_cutoff = now - timedelta(days=3)
    reviewed = await _latest_governance_reviews(db, cutoff_7d)

    duplicate_phones, duplicate_rows = await _build_duplicate_phone_cleanup_plan(db)
    duplicate_phone_student_count = len(duplicate_rows)
    duplicate_phone_entities = [f"student:{row['student_id']}" for row in duplicate_rows]

    duplicate_phone_list = sorted(duplicate_phones)
    same_name_school_phone_entities = []
    if duplicate_phone_list:
        same_phone_students_r = await db.execute(
            select(Student).where(
                or_(
                    Student.guardian_phone.in_(duplicate_phone_list),
                    Student.guardian2_phone.in_(duplicate_phone_list),
                )
            )
        )
        groups: dict[tuple[str, str, str], set[int]] = {}
        for student in same_phone_students_r.scalars().all():
            name = (student.name or "").strip()
            school = (student.school_name or "").strip()
            if not name or not school:
                continue
            for phone in _student_phone_values(student) & duplicate_phones:
                groups.setdefault((name, school, phone), set()).add(student.id)
        same_name_school_phone_entities = [
            f"same-name-school-phone:{name}|{school}|{phone}"
            for (name, school, phone), ids in groups.items()
            if len(ids) >= 2
        ]
    same_name_school_phone_count = len(same_name_school_phone_entities)

    missing_phone_ids = list(
        (
            await db.execute(
                select(Student.id).where(
                    Student.status.in_(ACTIVE_TASK_STATUSES),
                    or_(Student.guardian_phone == "", Student.guardian_phone.is_(None)),
                    or_(Student.guardian2_phone == "", Student.guardian2_phone.is_(None)),
                )
            )
        ).scalars()
    )
    missing_phone_count = len(missing_phone_ids)

    enrolled_status_change_ids = list(
        (
            await db.execute(
                select(OperationLog.id).where(
                    OperationLog.action == "修改状态",
                    OperationLog.created_at >= cutoff_7d,
                    or_(
                        OperationLog.old_status.contains("已报名"),
                        OperationLog.new_status.contains("已报名"),
                        OperationLog.content.contains("已报名"),
                    ),
                )
            )
        ).scalars()
    )
    enrolled_status_change_count = len(enrolled_status_change_ids)

    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("latest_activity_at")
    stale_a_ids = list(
        (
            await db.execute(
                select(Student.id)
                .outerjoin(last_activity, last_activity.c.student_id == Student.id)
                .where(
                    Student.intent_level == IntentLevel.A,
                    Student.status.not_in(TERMINAL_STUDENT_STATUSES),
                    latest_activity_at < stale_cutoff,
                )
            )
        ).scalars()
    )
    stale_a_count = len(stale_a_ids)

    dialed_student_ids = select(DialLog.student_id).distinct()
    assigned_no_call_ids = list(
        (
            await db.execute(
                select(Student.id).where(
                    Student.assigned_to.is_not(None),
                    Student.assigned_at.is_not(None),
                    Student.status.in_(ACTIVE_TASK_STATUSES),
                    Student.id.not_in(dialed_student_ids),
                )
            )
        ).scalars()
    )
    assigned_no_call_count = len(assigned_no_call_ids)

    status_logs_r = await db.execute(
        select(OperationLog.id, OperationLog.created_at).where(
            OperationLog.action == "修改状态",
            OperationLog.created_at >= cutoff_7d,
        )
    )
    off_hours_status_change_ids = [
        log_id for log_id, created_at in status_logs_r.all() if not is_work_hour(created_at)
    ]
    off_hours_status_change_count = len(off_hours_status_change_ids)

    signals = [
        _health_signal(
            key="duplicate_phone",
            title="重复手机号",
            count=duplicate_phone_student_count,
            severity="high" if duplicate_phone_student_count else "low",
            detail=f"{len(duplicate_phones)} 个手机号出现在多条线索中，需复核是否重复导入。",
            to="/admin/governance?section=duplicates",
            entity_keys=duplicate_phone_entities,
        ),
        _health_signal(
            key="same_name_school_phone",
            title="同名同校同手机号",
            count=same_name_school_phone_count,
            severity="high" if same_name_school_phone_count else "low",
            detail="同一个姓名、学校、手机号同时重复，优先级高于普通同名。",
            to="/admin/governance?section=duplicates",
            entity_keys=same_name_school_phone_entities,
        ),
        _health_signal(
            key="missing_phone",
            title="无手机号线索",
            count=missing_phone_count,
            severity="medium" if missing_phone_count else "low",
            detail="活跃线索缺少两个监护人手机号，话务员无法有效拨打。",
            to="/admin/leads?active=1&missing_phone=1",
            entity_keys=[f"student:{student_id}" for student_id in missing_phone_ids],
        ),
        _health_signal(
            key="enrolled_status_change",
            title="已报名异常变更",
            count=enrolled_status_change_count,
            severity="high" if enrolled_status_change_count else "low",
            detail="近 7 天涉及已报名的状态变更，需确认是否为正常报名登记。",
            to="/admin/audit-logs?action=%E4%BF%AE%E6%94%B9%E7%8A%B6%E6%80%81&q=%E5%B7%B2%E6%8A%A5%E5%90%8D",
            entity_keys=[f"operation:{log_id}" for log_id in enrolled_status_change_ids],
        ),
        _health_signal(
            key="stale_a",
            review_key="stale_a_students",
            title="A 级长期未跟进",
            count=stale_a_count,
            severity="high" if stale_a_count else "low",
            detail="A 级且 3 天以上无新活动，建议优先回访或主管介入。",
            to="/admin/work-center?queue=stale-a",
            entity_keys=[f"student:{student_id}" for student_id in stale_a_ids],
        ),
        _health_signal(
            key="assigned_no_call",
            title="分配后无通话",
            count=assigned_no_call_count,
            severity="medium" if assigned_no_call_count else "low",
            detail="已分配但没有拨号记录，可能未真正开始处理。",
            to="/admin/leads?active=1",
            entity_keys=[f"student:{student_id}" for student_id in assigned_no_call_ids],
        ),
        _health_signal(
            key="off_hours_status_change",
            title="非工作时间状态变更",
            count=off_hours_status_change_count,
            severity="high" if off_hours_status_change_count else "low",
            detail="近 7 天在 9:00-11:00、14:30-18:00、19:00-21:00 外修改状态。",
            to="/admin/audit-logs?action=%E4%BF%AE%E6%94%B9%E7%8A%B6%E6%80%81",
            entity_keys=[f"operation:{log_id}" for log_id in off_hours_status_change_ids],
        ),
    ]
    signals = [
        _apply_governance_review(
            signal,
            reviewed,
            signal.get("review_key") or signal["key"],
        )
        for signal in signals
    ]
    total_issue_count = sum(item["count"] for item in signals)
    return {
        "status": "warning" if total_issue_count else "ok",
        "generated_at": now.isoformat(),
        "total_issue_count": total_issue_count,
        "signals": signals,
    }


async def risk_alerts(db: AsyncSession, days: int) -> dict:
    """只读聚合近期高风险操作，供管理员复核。"""
    cutoff = utcnow() - timedelta(days=days)
    reviewed = await _latest_governance_reviews(db, cutoff)
    rows = (
        (
            await db.execute(
                select(OperationLog)
                .where(OperationLog.created_at >= cutoff)
                .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
            )
        )
        .scalars()
        .all()
    )

    delete_log_ids = [log.id for log in rows if log.action in {"删除线索", "删除用户"}]
    batch_distribution_log_ids = [
        log.id for log in rows if log.action in BATCH_DISTRIBUTION_SUMMARY_ACTIONS
    ]
    enrolled_status_change_log_ids = [
        log.id
        for log in rows
        if log.action == "修改状态"
        and (
            "已报名" in (log.old_status or "")
            or "已报名" in (log.new_status or "")
            or "已报名" in (log.content or "")
        )
    ]
    delete_count = len(delete_log_ids)
    batch_distribution_count = len(batch_distribution_log_ids)
    enrolled_status_change_count = len(enrolled_status_change_log_ids)

    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("latest_activity_at")
    stale_a_ids = list(
        (
            await db.execute(
                select(Student.id)
                .outerjoin(last_activity, last_activity.c.student_id == Student.id)
                .where(
                    Student.intent_level == IntentLevel.A,
                    Student.status.not_in(TERMINAL_STUDENT_STATUSES),
                    latest_activity_at < utcnow() - timedelta(days=3),
                )
            )
        ).scalars()
    )
    open_home_visit_ids = list(
        (
            await db.execute(
                select(HomeVisitTask.id).where(
                    HomeVisitTask.status.in_(
                        [
                            HomeVisitStatus.pending,
                            HomeVisitStatus.confirmed,
                            HomeVisitStatus.scheduled,
                            HomeVisitStatus.postponed,
                        ]
                    )
                )
            )
        ).scalars()
    )
    campus_due_ids = list(
        (
            await db.execute(
                select(CampusVisitTask.id).where(
                    or_(
                        CampusVisitTask.status == CampusVisitStatus.pending,
                        and_(
                            CampusVisitTask.status.in_(
                                [CampusVisitStatus.scheduled, CampusVisitStatus.rescheduled]
                            ),
                            CampusVisitTask.appointment_at.is_not(None),
                            CampusVisitTask.appointment_at < utcnow(),
                        ),
                    )
                )
            )
        ).scalars()
    )
    unsettled_enrollment_ids = list(
        (
            await db.execute(
                select(EnrollmentRecord.id).where(
                    EnrollmentRecord.settlement_status != SettlementStatus.settled
                )
            )
        ).scalars()
    )
    stale_a_count = len(stale_a_ids)
    open_home_visit_count = len(open_home_visit_ids)
    campus_due_count = len(campus_due_ids)
    unsettled_enrollment_count = len(unsettled_enrollment_ids)

    alerts = []
    if delete_count:
        alerts.append(
            _risk_alert(
                alert_type="delete_leads",
                title="近期存在删除操作",
                severity="high",
                count=delete_count,
                detail=f"近 {days} 天有 {delete_count} 条删除类操作，请复核是否为预期清理。",
                category="删除",
                entity_keys=[f"operation:{log_id}" for log_id in delete_log_ids],
            )
        )
    if batch_distribution_count:
        alerts.append(
            _risk_alert(
                alert_type="batch_distribution",
                title="近期存在批量分配",
                severity="medium",
                count=batch_distribution_count,
                detail=(
                    f"近 {days} 天有 {batch_distribution_count} 条批量分配汇总，请抽查分配范围。"
                ),
                category="分配",
                entity_keys=[
                    f"operation:{log_id}" for log_id in batch_distribution_log_ids
                ],
            )
        )
    if enrolled_status_change_count:
        alerts.append(
            _risk_alert(
                alert_type="enrolled_status_change",
                title="已报名相关状态变更",
                severity="high",
                count=enrolled_status_change_count,
                detail=f"近 {days} 天有 {enrolled_status_change_count} 条涉及已报名的状态变更。",
                action="修改状态",
                q="已报名",
                entity_keys=[
                    f"operation:{log_id}" for log_id in enrolled_status_change_log_ids
                ],
            )
        )
    if stale_a_count:
        alerts.append(
            _risk_alert(
                alert_type="stale_a_students",
                title="A 级学生超时未推进",
                severity="high",
                count=stale_a_count,
                detail=(
                    f"有 {stale_a_count} 名 A 级学生超过 3 天没有新活动，"
                    "建议优先回访或主管介入。"
                ),
                to="/admin/work-center?queue=stale-a",
                entity_keys=[f"student:{student_id}" for student_id in stale_a_ids],
            )
        )
    if open_home_visit_count:
        alerts.append(
            _risk_alert(
                alert_type="home_visit_pending",
                title="家访任务待处理",
                severity="medium",
                count=open_home_visit_count,
                detail=(
                    f"当前有 {open_home_visit_count} 个家访任务未完成，"
                    "需要确认安排、结果或后续动作。"
                ),
                to="/admin/work-center?queue=home_visit",
                entity_keys=[f"home-visit:{task_id}" for task_id in open_home_visit_ids],
            )
        )
    if campus_due_count:
        alerts.append(
            _risk_alert(
                alert_type="campus_visit_pending",
                title="到校参观待确认",
                severity="medium",
                count=campus_due_count,
                detail=f"当前有 {campus_due_count} 个到校任务待预约或已过预约时间未确认到校结果。",
                to="/admin/work-center?queue=campus_visit",
                entity_keys=[f"campus-visit:{task_id}" for task_id in campus_due_ids],
            )
        )
    if unsettled_enrollment_count:
        alerts.append(
            _risk_alert(
                alert_type="unsettled_enrollments",
                title="已报名未结算",
                severity="high",
                count=unsettled_enrollment_count,
                detail=(
                    f"当前有 {unsettled_enrollment_count} 条报名记录未结算、暂缓或争议，"
                    "需在结算页确认归属。"
                ),
                to="/admin/enrollment-settlement",
                entity_keys=[
                    f"enrollment:{record_id}" for record_id in unsettled_enrollment_ids
                ],
            )
        )

    alerts = [
        _apply_governance_review(
            alert,
            reviewed,
            alert.get("review_key") or alert["type"],
        )
        for alert in alerts
    ]
    alerts = [alert for alert in alerts if alert["count"] > 0]
    return {"days": days, "alerts": alerts}
