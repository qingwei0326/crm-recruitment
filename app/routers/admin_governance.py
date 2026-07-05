import re
import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_lead_utils import (
    _build_duplicate_phone_cleanup_plan,
    _duplicate_phone_cleanup_summary,
    _student_governance_payload,
    _student_phone_values,
)
from app.auth import (
    ADMIN_OP_DUPLICATE_CLEANUP,
    ADMIN_OP_GOVERNANCE_REVIEW,
    ADMIN_PAGE_LEAD_GOVERNANCE,
    require_admin,
    require_operation_permission,
    require_page_permission,
)
from app.database import get_db
from app.expiry import build_last_activity_subquery
from app.models import (
    Call,
    CampusVisitStatus,
    CampusVisitTask,
    DialLog,
    EnrollmentRecord,
    FollowUp,
    HomeVisitStatus,
    HomeVisitTask,
    IntentLevel,
    LeadViewLog,
    Note,
    OperationLog,
    SettlementStatus,
    Student,
    StudentStatus,
    User,
    Visit,
)
from app.schemas import Response
from app.status_policy import canonical_status_value, status_detail_value, statuses_for_canonical
from app.task_stats import ACTIVE_TASK_STATUSES, TERMINAL_STUDENT_STATUSES
from app.utils import make_operation_log, today_cst_as_utc, utcnow

router = APIRouter(prefix="/api/admin", tags=["管理"])


class DuplicatePhoneCleanupReq(BaseModel):
    confirm: bool = False


class GovernanceReviewReq(BaseModel):
    key: str
    title: str = ""
    detail: str = ""
    count: int = 0


class DailyOpsReviewReq(BaseModel):
    key: str
    status: str = "已处理"
    note: str = ""
    count: int = 0
GOVERNANCE_REVIEW_PREFIX = "governance-review:"
GOVERNANCE_REVIEW_TTL_DAYS = 7



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
) -> dict:
    return {
        "type": alert_type,
        "title": title,
        "severity": severity,
        "count": count,
        "detail": detail,
        "action": action,
        "category": category,
        "q": q,
        "to": to,
    }


BATCH_DISTRIBUTION_SUMMARY_ACTIONS = {
    "批量分配",
    "自动分配汇总",
    "区域分配汇总",
    "学校分配汇总",
    "多学校分发汇总",
}

WORK_HOUR_WINDOWS = (
    (9 * 60, 11 * 60),
    (14 * 60 + 30, 18 * 60),
    (19 * 60, 21 * 60),
)


def _is_work_hour(dt: datetime | None) -> bool:
    if not dt:
        return True
    minutes = dt.hour * 60 + dt.minute
    return any(start <= minutes < end for start, end in WORK_HOUR_WINDOWS)


def _health_signal(
    *,
    key: str,
    title: str,
    count: int,
    severity: str,
    detail: str,
    to: str,
) -> dict:
    return {
        "key": key,
        "title": title,
        "count": int(count or 0),
        "severity": severity,
        "detail": detail,
        "to": to,
    }


async def _latest_governance_reviews(db: AsyncSession, cutoff: datetime) -> dict[str, dict]:
    rows = (
        await db.execute(
            select(OperationLog.batch_id, OperationLog.old_status, OperationLog.created_at)
            .where(
                OperationLog.action == "治理复核",
                OperationLog.batch_id.like(f"{GOVERNANCE_REVIEW_PREFIX}%"),
                OperationLog.created_at >= cutoff,
            )
            .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
        )
    ).all()
    reviews = {}
    for batch_id, old_status, reviewed_at in rows:
        batch_id = batch_id or ""
        if not batch_id.startswith(GOVERNANCE_REVIEW_PREFIX):
            continue
        key = batch_id[len(GOVERNANCE_REVIEW_PREFIX) :].strip()
        if not key or key in reviews:
            continue
        try:
            reviewed_count = int(old_status or 0)
        except (TypeError, ValueError):
            reviewed_count = 0
        reviews[key] = {
            "count": max(reviewed_count, 0),
            "reviewed_at": reviewed_at,
        }
    return reviews


def _apply_governance_review(item: dict, reviews: dict[str, dict], key: str) -> dict:
    review = reviews.get(key)
    if not review:
        return {**item, "reviewed": False}

    current_count = max(int(item.get("count") or 0), 0)
    reviewed_count = max(int(review.get("count") or 0), 0)
    reviewed_at = review.get("reviewed_at")
    data = {
        **item,
        "reviewed": False,
        "reviewed_count": reviewed_count,
        "reviewed_at": reviewed_at.isoformat() if reviewed_at else "",
    }
    if current_count <= 0:
        return data
    if current_count <= reviewed_count:
        return {
            **data,
            "count": 0,
            "severity": "low",
            "reviewed": True,
            "detail": f"已确认复核；如后续数量增加会重新提醒。原复核数量 {reviewed_count} 项。",
        }
    data["count"] = current_count - reviewed_count
    if reviewed_count:
        data["detail"] = (
            f"{item.get('detail', '')} 已复核 {reviewed_count} 项，当前新增 {data['count']} 项。"
        )
    return data


@router.get("/data-quality")
async def data_quality(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """管理员数据质量看板：通话时长回写、缺电话、逾期回访和无效原因分布。"""
    now = utcnow()
    today = today_cst_as_utc()
    tomorrow = today + timedelta(days=1)
    month_start = today.replace(day=1)

    def unrecorded_clause():
        return or_(DialLog.duration_seconds <= 0, DialLog.duration_seconds.is_(None))

    call_summary_r = await db.execute(
        select(
            func.count(DialLog.id)
            .filter(DialLog.dialed_at >= today, DialLog.dialed_at < tomorrow)
            .label("today_total"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= today,
                DialLog.dialed_at < tomorrow,
                DialLog.duration_seconds > 0,
            )
            .label("today_recorded"),
            func.count(DialLog.id)
            .filter(
                DialLog.dialed_at >= today,
                DialLog.dialed_at < tomorrow,
                unrecorded_clause(),
            )
            .label("today_unrecorded"),
            func.count(DialLog.id).filter(DialLog.dialed_at >= month_start).label("month_total"),
            func.count(DialLog.id)
            .filter(DialLog.dialed_at >= month_start, DialLog.duration_seconds > 0)
            .label("month_recorded"),
            func.count(DialLog.id)
            .filter(DialLog.dialed_at >= month_start, unrecorded_clause())
            .label("month_unrecorded"),
            func.avg(DialLog.duration_seconds)
            .filter(DialLog.dialed_at >= month_start, DialLog.duration_seconds > 0)
            .label("month_avg_recorded"),
        )
    )
    call_summary = call_summary_r.one()

    agent_call_r = await db.execute(
        select(
            DialLog.agent_id,
            User.name.label("agent_name"),
            func.count(DialLog.id).label("total_calls"),
            func.count(DialLog.id).filter(DialLog.duration_seconds > 0).label("recorded_calls"),
            func.count(DialLog.id).filter(unrecorded_clause()).label("unrecorded_calls"),
            func.avg(DialLog.duration_seconds)
            .filter(DialLog.duration_seconds > 0)
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
                "unrecorded_ratio": round(unrecorded_calls / total_calls * 100, 1)
                if total_calls
                else 0,
                "avg_recorded_duration_seconds": round(row.avg_recorded_duration_seconds or 0, 1),
            }
        )
    agent_rows.sort(key=lambda item: (-item["unrecorded_calls"], item["agent_name"]))

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
    status = (
        "warning"
        if (
            month_unrecorded > 0
            or int(getattr(student_quality, "missing_phone_tasks") or 0) > 0
            or int(getattr(follow_up_quality, "overdue_follow_ups") or 0) > 0
        )
        else "ok"
    )

    return Response.ok(
        {
            "status": status,
            "generated_at": now.isoformat(),
            "calls": {
                "today": {
                    "total_calls": int(call_summary.today_total or 0),
                    "recorded_calls": int(call_summary.today_recorded or 0),
                    "unrecorded_calls": int(call_summary.today_unrecorded or 0),
                },
                "month": {
                    "total_calls": month_total,
                    "recorded_calls": int(call_summary.month_recorded or 0),
                    "unrecorded_calls": month_unrecorded,
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
                "invalid_total": invalid_total,
                "invalid_reasons": invalid_reasons,
            },
            "follow_ups": {
                "open_follow_ups": int(getattr(follow_up_quality, "open_follow_ups") or 0),
                "overdue_follow_ups": int(getattr(follow_up_quality, "overdue_follow_ups") or 0),
            },
        }
    )


@router.get("/data-health")
async def data_health_center(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
    """线索治理健康中心：聚合可复核的数据异常入口，不自动修改数据。"""
    now = utcnow()
    cutoff_7d = now - timedelta(days=GOVERNANCE_REVIEW_TTL_DAYS)
    stale_cutoff = now - timedelta(days=3)
    reviewed = await _latest_governance_reviews(db, cutoff_7d)

    duplicate_phones, duplicate_rows = await _build_duplicate_phone_cleanup_plan(db)
    duplicate_phone_student_count = len(duplicate_rows)

    duplicate_phone_list = sorted(duplicate_phones)
    same_name_school_phone_count = 0
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
        same_name_school_phone_count = sum(1 for ids in groups.values() if len(ids) >= 2)

    missing_phone_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.status.in_(ACTIVE_TASK_STATUSES),
                or_(Student.guardian_phone == "", Student.guardian_phone.is_(None)),
                or_(Student.guardian2_phone == "", Student.guardian2_phone.is_(None)),
            )
        )
    ).scalar() or 0

    enrolled_status_change_count = (
        await db.execute(
            select(func.count(OperationLog.id)).where(
                OperationLog.action == "修改状态",
                OperationLog.created_at >= cutoff_7d,
                or_(
                    OperationLog.old_status.contains("已报名"),
                    OperationLog.new_status.contains("已报名"),
                    OperationLog.content.contains("已报名"),
                ),
            )
        )
    ).scalar() or 0

    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("latest_activity_at")
    stale_a_count = (
        await db.execute(
            select(func.count(Student.id))
            .outerjoin(last_activity, last_activity.c.student_id == Student.id)
            .where(
                Student.intent_level == IntentLevel.A,
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
                latest_activity_at < stale_cutoff,
            )
        )
    ).scalar() or 0

    dialed_student_ids = select(DialLog.student_id).distinct()
    assigned_no_call_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to.is_not(None),
                Student.assigned_at.is_not(None),
                Student.status.in_(ACTIVE_TASK_STATUSES),
                Student.id.not_in(dialed_student_ids),
            )
        )
    ).scalar() or 0

    status_logs_r = await db.execute(
        select(OperationLog.id, OperationLog.created_at).where(
            OperationLog.action == "修改状态",
            OperationLog.created_at >= cutoff_7d,
        )
    )
    off_hours_status_change_count = sum(
        1 for _, created_at in status_logs_r.all() if not _is_work_hour(created_at)
    )

    signals = [
        _health_signal(
            key="duplicate_phone",
            title="重复手机号",
            count=duplicate_phone_student_count,
            severity="high" if duplicate_phone_student_count else "low",
            detail=f"{len(duplicate_phones)} 个手机号出现在多条线索中，需复核是否重复导入。",
            to="/admin/governance?section=duplicates",
        ),
        _health_signal(
            key="same_name_school_phone",
            title="同名同校同手机号",
            count=same_name_school_phone_count,
            severity="high" if same_name_school_phone_count else "low",
            detail="同一个姓名、学校、手机号同时重复，优先级高于普通同名。",
            to="/admin/governance?section=duplicates",
        ),
        _health_signal(
            key="missing_phone",
            title="无手机号线索",
            count=missing_phone_count,
            severity="medium" if missing_phone_count else "low",
            detail="活跃线索缺少两个监护人手机号，话务员无法有效拨打。",
            to="/admin/leads?active=1&missing_phone=1",
        ),
        _health_signal(
            key="enrolled_status_change",
            title="已报名异常变更",
            count=enrolled_status_change_count,
            severity="high" if enrolled_status_change_count else "low",
            detail="近 7 天涉及已报名的状态变更，需确认是否为正常报名登记。",
            to="/admin/audit-logs?action=%E4%BF%AE%E6%94%B9%E7%8A%B6%E6%80%81&q=%E5%B7%B2%E6%8A%A5%E5%90%8D",
        ),
        _health_signal(
            key="stale_a",
            title="A 级长期未跟进",
            count=stale_a_count,
            severity="high" if stale_a_count else "low",
            detail="A 级且 3 天以上无新活动，建议优先回访或主管介入。",
            to="/admin/work-center?queue=stale-a",
        ),
        _health_signal(
            key="assigned_no_call",
            title="分配后无通话",
            count=assigned_no_call_count,
            severity="medium" if assigned_no_call_count else "low",
            detail="已分配但没有拨号记录，可能未真正开始处理。",
            to="/admin/leads?active=1",
        ),
        _health_signal(
            key="off_hours_status_change",
            title="非工作时间状态变更",
            count=off_hours_status_change_count,
            severity="high" if off_hours_status_change_count else "low",
            detail="近 7 天在 9:00-11:00、14:30-18:00、19:00-21:00 外修改状态。",
            to="/admin/audit-logs?action=%E4%BF%AE%E6%94%B9%E7%8A%B6%E6%80%81",
        ),
    ]
    signals = [_apply_governance_review(signal, reviewed, signal["key"]) for signal in signals]
    total_issue_count = sum(item["count"] for item in signals)
    return Response.ok(
        {
            "status": "warning" if total_issue_count else "ok",
            "generated_at": now.isoformat(),
            "total_issue_count": total_issue_count,
            "signals": signals,
        }
    )


@router.post("/governance-reviews")
async def acknowledge_governance_review(
    body: GovernanceReviewReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_GOVERNANCE_REVIEW)),
):
    key = body.key.strip()
    if not key:
        return Response.error(code=1, msg="缺少复核项")
    safe_key = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", key)[:40]
    title = (body.title or key).strip()
    detail = (body.detail or "").strip()
    count = max(int(body.count or 0), 0)
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="治理复核",
            content=f"确认复核 {title}：{detail}" if detail else f"确认复核 {title}",
            old_status=str(count),
            new_status="已复核",
            batch_id=f"{GOVERNANCE_REVIEW_PREFIX}{safe_key}",
        )
    )
    await db.commit()
    return Response.ok({"reviewed": True, "key": safe_key, "count": count})


@router.get("/lead-duplicates")
async def lead_duplicates(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
    """只读识别疑似重复线索，不做自动合并或删除。"""
    result = await db.execute(select(Student).order_by(Student.created_at.desc()).limit(5000))
    students = result.scalars().all()

    grouped: dict[tuple[str, str], list[Student]] = {}
    for student in students:
        for phone in _student_phone_values(student):
            grouped.setdefault(("手机号重复", phone), []).append(student)

    name_school_groups: dict[tuple[str, str], list[Student]] = {}
    for student in students:
        name_school = ((student.name or "").strip(), (student.school_name or "").strip())
        if all(name_school):
            name_school_groups.setdefault(name_school, []).append(student)

    for (name, school), items in name_school_groups.items():
        if len({student.id for student in items}) < 2:
            continue
        phones_in_group: dict[str, list[Student]] = {}
        for student in items:
            for phone in _student_phone_values(student):
                phones_in_group.setdefault(phone, []).append(student)
        for phone, phone_items in phones_in_group.items():
            unique_phone_items = list({student.id: student for student in phone_items}.values())
            if len(unique_phone_items) >= 2:
                grouped.setdefault(
                    ("同名同校同手机号", f"{name}｜{school}｜{phone}"),
                    unique_phone_items,
                )

    groups = []
    for (group_type, key), items in grouped.items():
        unique_items = list({student.id: student for student in items}.values())
        if len(unique_items) < 2:
            continue
        groups.append(
            {
                "type": group_type,
                "key": key,
                "search_q": key.split("｜")[-1] if group_type == "同名同校同手机号" else key,
                "count": len(unique_items),
                "students": [
                    _student_governance_payload(student)
                    for student in sorted(unique_items, key=lambda item: item.id)[:5]
                ],
            }
        )

    groups.sort(key=lambda item: (-item["count"], item["type"], item["key"]))
    return Response.ok({"total_groups": len(groups), "groups": groups[:limit]})


@router.get("/lead-duplicates/cleanup-preview")
async def duplicate_phone_cleanup_preview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
    """预览重复手机号清理影响范围，不修改数据。"""
    duplicate_phones, rows = await _build_duplicate_phone_cleanup_plan(db)
    return Response.ok(_duplicate_phone_cleanup_summary(rows, duplicate_phones))


@router.post("/lead-duplicates/cleanup")
async def duplicate_phone_cleanup(
    body: DuplicatePhoneCleanupReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_DUPLICATE_CLEANUP)),
):
    """清理重复手机号；清完无号码的学生连同关联记录删除。"""
    if not body.confirm:
        return Response.error(code=1, msg="需要确认后才能清理重复手机号")

    duplicate_phones, rows = await _build_duplicate_phone_cleanup_plan(db)
    summary = _duplicate_phone_cleanup_summary(rows, duplicate_phones)
    if not rows:
        return Response.ok({**summary, "batch_id": "", "changed": False})

    batch_id = f"phone-dedupe-{datetime.now().strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(3)}"
    by_id = {row["student_id"]: row for row in rows}
    result = await db.execute(select(Student).where(Student.id.in_(list(by_id.keys()))))
    students = sorted(result.scalars().all(), key=lambda student: student.id)

    cleared_count = 0
    deleted_count = 0
    for student in students:
        row = by_id[student.id]
        removed_text = "、".join(row["removed_phones"])
        if row["will_delete"]:
            db.add(
                make_operation_log(
                    current_user,
                    student.id,
                    student.case_no or "",
                    "数据清理",
                    content=(
                        f"批次 {batch_id}：清理重复手机号 {removed_text} 后无可用号码，"
                        f"删除学生 {student.name}（{student.school_name or '-'}）"
                    ),
                    old_status=canonical_status_value(student.status),
                    new_status="已删除",
                    batch_id=batch_id,
                )
            )
            for model in (Call, Note, FollowUp, LeadViewLog, Visit, DialLog):
                await db.execute(delete(model).where(model.student_id == student.id))
            await db.delete(student)
            deleted_count += 1
        else:
            student.guardian_phone = row["new_guardian_phone"]
            student.guardian2_phone = row["new_guardian2_phone"]
            kept_phones = [
                phone for phone in (row["new_guardian_phone"], row["new_guardian2_phone"]) if phone
            ]
            db.add(
                make_operation_log(
                    current_user,
                    student.id,
                    student.case_no or "",
                    "数据清理",
                    content=(
                        f"批次 {batch_id}：清理重复手机号 {removed_text}；"
                        f"保留号码 {'、'.join(kept_phones)}"
                    ),
                    batch_id=batch_id,
                )
            )
            cleared_count += 1

    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="数据清理汇总",
            content=(
                f"批次 {batch_id}：清理重复手机号 {len(duplicate_phones)} 个，"
                f"影响学生 {len(rows)} 条，清号保留 {cleared_count} 条，删除 {deleted_count} 条"
            ),
            batch_id=batch_id,
        )
    )
    await db.commit()
    return Response.ok(
        {
            **summary,
            "batch_id": batch_id,
            "changed": True,
            "cleared_count": cleared_count,
            "deleted_count": deleted_count,
        }
    )


@router.get("/risk-alerts")
async def risk_alerts(
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
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

    delete_count = sum(1 for log in rows if log.action in {"删除线索", "删除用户"})
    batch_distribution_count = sum(
        1 for log in rows if log.action in BATCH_DISTRIBUTION_SUMMARY_ACTIONS
    )
    enrolled_status_change_count = sum(
        1
        for log in rows
        if log.action == "修改状态"
        and (
            "已报名" in (log.old_status or "")
            or "已报名" in (log.new_status or "")
            or "已报名" in (log.content or "")
        )
    )

    last_activity = build_last_activity_subquery()
    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("latest_activity_at")
    stale_a_count = (
        await db.execute(
            select(func.count(Student.id))
            .outerjoin(last_activity, last_activity.c.student_id == Student.id)
            .where(
                Student.intent_level == IntentLevel.A,
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
                latest_activity_at < utcnow() - timedelta(days=3),
            )
        )
    ).scalar() or 0
    open_home_visit_count = (
        await db.execute(
            select(func.count(HomeVisitTask.id)).where(
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
    ).scalar() or 0
    campus_due_count = (
        await db.execute(
            select(func.count(CampusVisitTask.id)).where(
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
    ).scalar() or 0
    unsettled_enrollment_count = (
        await db.execute(
            select(func.count(EnrollmentRecord.id)).where(
                EnrollmentRecord.settlement_status != SettlementStatus.settled
            )
        )
    ).scalar() or 0

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
            )
        )

    alerts = [_apply_governance_review(alert, reviewed, alert["type"]) for alert in alerts]
    alerts = [alert for alert in alerts if alert["count"] > 0]
    return Response.ok({"days": days, "alerts": alerts})
