import os
import re
import secrets
import time
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_config import (
    ALLOWED_CONFIG_KEYS,
    SCORE_DAILY_CALL_TARGET_MAX,
    mask_config_value,
    validate_config_value,
)
from app.admin_daily_ops import (
    DAILY_OPS_REVIEW_STATUSES,
    _build_daily_ops_payload,
    _daily_ops_batch_id,
    _today_cst_date_key,
)
from app.admin_lead_utils import (
    _admin_student_search_payload,
    _build_duplicate_phone_cleanup_plan,
    _duplicate_phone_cleanup_summary,
    _latest_log_payload,
    _operation_log_search_predicate,
    _student_governance_payload,
    _student_phone_values,
    _student_search_predicate,
    invalid_reason_predicate,
)
from app.agent_score import score_agent_work
from app.auth import (
    ADMIN_OP_ASSIGNMENT_ROLLBACK,
    ADMIN_OP_DUPLICATE_CLEANUP,
    ADMIN_OP_GOVERNANCE_REVIEW,
    ADMIN_OP_INVALID_DELETE,
    ADMIN_OP_INVALID_RECLAIM,
    ADMIN_OP_STUDENT_ASSIGN,
    ADMIN_OP_USER_CREATE,
    ADMIN_OP_USER_DELETE,
    ADMIN_OP_USER_EDIT,
    ADMIN_OP_USER_OFFBOARD,
    ADMIN_OP_USER_RESET_PASSWORD,
    ADMIN_OP_USER_UNLOCK,
    ADMIN_PAGE_ACCOUNT_MANAGE,
    ADMIN_PAGE_AUDIT_LOGS,
    ADMIN_PAGE_INVALID_RECLAIM,
    ADMIN_PAGE_LEAD_GOVERNANCE,
    ADMIN_PAGE_LEADS_MANAGE,
    ADMIN_PAGE_SCHOOL_DISTRIBUTION,
    ADMIN_PAGE_SCORE_PREVIEW,
    get_current_user,
    hash_password,
    invalidate_user_tokens,
    normalize_operation_permissions,
    normalize_page_permissions,
    operation_permissions_to_storage,
    page_permissions_to_storage,
    require_admin,
    require_any_page_permission,
    require_operation_permission,
    require_page_permission,
    require_super_admin,
    user_has_operation_permission,
)
from app.backup import BACKUP_DIR, MAX_BACKUPS, _get_backup_extension, do_backup_async
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
    StudentStage,
    StudentStatus,
    SystemConfig,
    User,
    UserRole,
    Visit,
)
from app.schemas import Response, StaleReassignReq
from app.status_policy import (
    canonical_status_value,
    canonical_student_status,
    status_detail_value,
    statuses_for_canonical,
)
from app.task_stats import ACTIVE_TASK_STATUSES, TERMINAL_STUDENT_STATUSES, build_task_stats
from app.utils import (
    assignment_state_label,
    make_assignment_rollback_note,
    make_batch_id,
    make_operation_log,
    mask_phone,
    parse_assignment_rollback_note,
    today_cst_as_utc,
    utcnow,
)

router = APIRouter(prefix="/api/admin", tags=["管理"])
GOVERNANCE_REVIEW_PREFIX = "governance-review:"
GOVERNANCE_REVIEW_TTL_DAYS = 7
RESERVED_USER_DISPLAY_NAMES = {"离职", "已离职", "禁用", "停用", "启用"}


class UserCreateReq(BaseModel):
    username: str
    password: str
    name: str
    role: Literal["admin", "agent"] = "agent"
    is_super_admin: bool = False
    service_regions: str = ""
    page_permissions: list[str] = []
    operation_permissions: list[str] = []


class UserUpdateReq(BaseModel):
    name: str | None = None
    role: Literal["admin", "agent"] | None = None
    is_active: bool | None = None
    is_super_admin: bool | None = None
    password: str | None = None
    service_regions: str | None = None
    page_permissions: list[str] | None = None
    operation_permissions: list[str] | None = None


class ConfigUpdateReq(BaseModel):
    key: str
    value: str


class DuplicatePhoneCleanupReq(BaseModel):
    confirm: bool = False


class AssignmentRollbackReq(BaseModel):
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


def _clean_user_display_name(value: str) -> str:
    return (value or "").strip()


def _validate_user_display_name(value: str) -> str | None:
    name = _clean_user_display_name(value)
    if not name:
        return "姓名不能为空"
    if name in RESERVED_USER_DISPLAY_NAMES:
        return "姓名不能填写离职、禁用等状态词；请填写真实姓名"
    return None


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


ASSIGNMENT_ROLLBACK_ACTIONS = {
    "手动分配",
    "自动分配",
    "区域分配",
    "学校分配",
    "多学校分发",
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


def _parse_assignment_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def _build_assignment_rollback_plan(db: AsyncSession, batch_id: str) -> dict:
    logs_r = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action.in_(ASSIGNMENT_ROLLBACK_ACTIONS),
            OperationLog.target_student_id.is_not(None),
        )
        .order_by(OperationLog.id.asc())
    )
    logs = logs_r.scalars().all()
    student_ids = [log.target_student_id for log in logs if log.target_student_id is not None]

    students_by_id: dict[int, Student] = {}
    if student_ids:
        students_r = await db.execute(select(Student).where(Student.id.in_(student_ids)))
        students_by_id = {student.id: student for student in students_r.scalars().all()}

    items = []
    for log in logs:
        payload = parse_assignment_rollback_note(log.note_content or "")
        student = students_by_id.get(log.target_student_id)
        status = "ok"
        reason = ""
        if payload is None:
            status = "skipped"
            reason = "缺少回滚信息"
        elif student is None:
            status = "skipped"
            reason = "学生不存在"
        elif student.assigned_to != payload.get("new_assigned_to"):
            status = "skipped"
            reason = "当前分配人与批次记录不一致，可能已被再次分配"

        items.append(
            {
                "log_id": log.id,
                "student_id": log.target_student_id,
                "student_name": student.name if student else "",
                "school_name": student.school_name if student else "",
                "case_no": log.case_no or "",
                "old_assigned_to": payload.get("old_assigned_to") if payload else None,
                "new_assigned_to": payload.get("new_assigned_to") if payload else None,
                "current_assigned_to": student.assigned_to if student else None,
                "status": status,
                "reason": reason,
            }
        )

    rollbackable = [item for item in items if item["status"] == "ok"]
    return {
        "batch_id": batch_id,
        "total_logs": len(logs),
        "rollbackable_count": len(rollbackable),
        "skipped_count": len(items) - len(rollbackable),
        "items": items[:100],
    }


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


async def delete_students_with_related(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    action: str = "批量删除无效线索",
) -> int:
    deleted_count = 0
    for student in students:
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                action,
                content=f"删除学生 {student.name}（含通话/备注/回访/到访/日志）",
            )
        )
        for model in (Call, Note, FollowUp, LeadViewLog, Visit, DialLog):
            await db.execute(delete(model).where(model.student_id == student.id))
        await db.delete(student)
        deleted_count += 1
    return deleted_count


async def reclaim_invalid_students_to_pool(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    action: str = "回收无效线索",
) -> int:
    reclaimed_count = 0
    for student in students:
        old_agent_id = student.assigned_to
        student.status = StudentStatus.not_contacted
        student.status_detail = ""
        student.intent_level = IntentLevel.none
        student.stage = StudentStage.initial_contact
        student.need_help = False
        student.assigned_to = None
        student.assigned_at = None

        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                action,
                content=f"从话务员 {old_agent_id or '未分配'} 回收，进入未分配池",
                old_status="无效",
                new_status="未联系",
            )
        )
        reclaimed_count += 1
    return reclaimed_count


def to_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


async def get_config_value(db: AsyncSession, key: str, fallback: str = "") -> str:
    """Read SystemConfig, then same-name uppercase env var, then fallback."""
    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    item = result.scalar_one_or_none()
    if item and item.value:
        return item.value
    return os.getenv(key.upper(), fallback)


async def count_active_super_admins(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count(User.id)).where(
            User.role == UserRole.admin,
            User.is_active,
            User.is_super_admin,
        )
    )
    return result.scalar() or 0


def _backup_items() -> list[dict]:
    if not os.path.isdir(BACKUP_DIR):
        return []
    items = []
    ext = _get_backup_extension()
    for fname in os.listdir(BACKUP_DIR):
        if not (fname.startswith("crm_") and fname.endswith(ext)):
            continue
        fpath = os.path.join(BACKUP_DIR, fname)
        try:
            st = os.stat(fpath)
        except OSError:
            continue
        items.append(
            {
                "name": fname,
                "size": st.st_size,
                "modified_at": datetime.fromtimestamp(st.st_mtime).isoformat(),
            }
        )
    items.sort(key=lambda x: x["modified_at"], reverse=True)
    return items


def _status_rank(status: str) -> int:
    return {"ok": 0, "warning": 1, "error": 2}.get(status, 0)


def _combined_status(*statuses: str) -> str:
    if not statuses:
        return "ok"
    return max(statuses, key=_status_rank)


def _log_file_summary(name: str) -> dict:
    base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = os.path.join(base_dir, name)
    exists = os.path.isfile(path)
    data = {"name": name, "exists": exists, "size": 0, "modified_at": None}
    if not exists:
        return data
    try:
        st = os.stat(path)
    except OSError:
        return data
    data.update(
        {
            "size": st.st_size,
            "modified_at": datetime.fromtimestamp(st.st_mtime).isoformat(),
        }
    )
    return data


@router.get("/config")
async def get_system_config(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    result = await db.execute(select(SystemConfig).order_by(SystemConfig.key))
    data = {item.key: mask_config_value(item.key, item.value) for item in result.scalars().all()}
    return Response.ok(data)


@router.put("/config")
async def update_system_config(
    body: ConfigUpdateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    key = body.key.strip()
    value = body.value.strip()
    if key not in ALLOWED_CONFIG_KEYS:
        return Response.error(code=1, msg="Unsupported config key")

    normalized, err = validate_config_value(key, value)
    if err:
        return Response.error(code=1, msg=err)
    value = normalized

    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    item = result.scalar_one_or_none()
    old_value = item.value if item else ""
    if item:
        item.value = value
    else:
        item = SystemConfig(key=key, value=value)
        db.add(item)
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="修改系统配置",
            content=(
                f"{key}: {mask_config_value(key, old_value)} → {mask_config_value(key, value)}"
            ),
        )
    )
    await db.commit()

    return Response.ok({"key": key, "value": mask_config_value(key, value)})


@router.get("/ops-health")
async def ops_health(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """管理员运维总览：聚合数据库、备份、日志和关键业务积压状态。"""
    db_start = time.monotonic()
    await db.execute(select(func.count()).select_from(User))
    db_ms = round((time.monotonic() - db_start) * 1000)

    now = utcnow()
    today = today_cst_as_utc()
    backup_items = _backup_items()
    latest_backup = backup_items[0] if backup_items else None
    backup_exists = os.path.isdir(BACKUP_DIR)
    backup_status = "ok" if latest_backup else "warning"

    user_stats = (
        await db.execute(
            select(
                func.count(User.id)
                .filter(User.role == UserRole.admin, User.is_active)
                .label("active_admins"),
                func.count(User.id)
                .filter(User.role == UserRole.agent, User.is_active)
                .label("active_agents"),
                func.count(User.id)
                .filter(User.role == UserRole.agent, User.is_active.is_(False))
                .label("disabled_agents"),
                func.count(User.id).filter(User.locked_until.is_not(None)).label("locked_users"),
            )
        )
    ).one()

    student_stats = (
        await db.execute(
            select(
                func.count(Student.id).label("total_students"),
                func.count(Student.id)
                .filter(
                    Student.assigned_to.is_(None),
                    Student.status.in_(ACTIVE_TASK_STATUSES),
                )
                .label("unassigned_active"),
                func.count(Student.id)
                .filter(
                    Student.status.in_(ACTIVE_TASK_STATUSES),
                    Student.guardian_phone == "",
                    Student.guardian2_phone == "",
                )
                .label("missing_phone_tasks"),
            )
        )
    ).one()

    follow_up_stats = (
        await db.execute(
            select(
                func.count(FollowUp.id)
                .filter(FollowUp.is_completed.is_(False))
                .label("open_follow_ups"),
                func.count(FollowUp.id)
                .filter(
                    FollowUp.is_completed.is_(False),
                    FollowUp.follow_up_date < now,
                )
                .label("overdue_follow_ups"),
                func.count(FollowUp.id)
                .filter(
                    FollowUp.is_completed.is_(False),
                    FollowUp.follow_up_date >= today,
                    FollowUp.follow_up_date < today + timedelta(days=1),
                )
                .label("today_follow_ups"),
            )
        )
    ).one()

    notification_failures_7d = (
        await db.execute(
            select(func.count(OperationLog.id)).where(
                OperationLog.action == "通知失败",
                OperationLog.created_at >= now - timedelta(days=7),
            )
        )
    ).scalar_one()
    frontend_errors_24h = (
        await db.execute(
            select(func.count(OperationLog.id)).where(
                OperationLog.action == "前端错误",
                OperationLog.created_at >= now - timedelta(days=1),
            )
        )
    ).scalar_one()

    business_status = "ok"
    if (
        int(getattr(follow_up_stats, "overdue_follow_ups") or 0) > 0
        or int(getattr(user_stats, "locked_users") or 0) > 0
        or int(notification_failures_7d or 0) > 0
        or int(frontend_errors_24h or 0) > 0
    ):
        business_status = "warning"

    logs = [
        _log_file_summary(name)
        for name in (
            "backend.log",
            "backend_stderr.log",
            "backend_access.log",
            "forward.log",
            "forward_err.log",
        )
    ]

    data = {
        "status": _combined_status("ok", backup_status, business_status),
        "generated_at": now.isoformat(),
        "database": {
            "status": "ok",
            "db_ms": db_ms,
        },
        "backups": {
            "status": backup_status,
            "directory": BACKUP_DIR,
            "exists": backup_exists,
            "count": len(backup_items),
            "max_keep": MAX_BACKUPS,
            "latest": latest_backup,
        },
        "logs": {
            "status": "ok",
            "files": logs,
        },
        "business": {
            "status": business_status,
            "active_admins": int(getattr(user_stats, "active_admins") or 0),
            "active_agents": int(getattr(user_stats, "active_agents") or 0),
            "disabled_agents": int(getattr(user_stats, "disabled_agents") or 0),
            "locked_users": int(getattr(user_stats, "locked_users") or 0),
            "total_students": int(getattr(student_stats, "total_students") or 0),
            "unassigned_active": int(getattr(student_stats, "unassigned_active") or 0),
            "missing_phone_tasks": int(getattr(student_stats, "missing_phone_tasks") or 0),
            "open_follow_ups": int(getattr(follow_up_stats, "open_follow_ups") or 0),
            "overdue_follow_ups": int(getattr(follow_up_stats, "overdue_follow_ups") or 0),
            "today_follow_ups": int(getattr(follow_up_stats, "today_follow_ups") or 0),
            "notification_failures_7d": int(notification_failures_7d or 0),
            "frontend_errors_24h": int(frontend_errors_24h or 0),
        },
    }
    return Response.ok(data)


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


@router.get("/daily-ops")
async def daily_ops_center(
    date_key: str | None = Query(None, alias="date"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    date_key = (date_key or _today_cst_date_key()).strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_key):
        raise HTTPException(status_code=422, detail="date 必须是 YYYY-MM-DD")
    return Response.ok(await _build_daily_ops_payload(db, date_key))


@router.post("/daily-ops/reviews")
async def acknowledge_daily_ops_item(
    body: DailyOpsReviewReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_GOVERNANCE_REVIEW)),
):
    key = re.sub(r"[^a-zA-Z0-9_.:-]+", "-", body.key.strip())[:40]
    if not key:
        return Response.error(code=1, msg="缺少待办项")
    status = (body.status or "已处理").strip()
    if status not in DAILY_OPS_REVIEW_STATUSES:
        return Response.error(
            code=1,
            msg="状态必须是处理中、已处理、已忽略、暂缓、明日继续跟进、无需处理之一",
        )
    date_key = _today_cst_date_key()
    count = max(int(body.count or 0), 0)
    note = (body.note or "").strip()
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="每日运营闭环",
            content=f"{date_key} {key} 标记为{status}",
            old_status=str(count),
            new_status=status,
            note_content=note,
            batch_id=_daily_ops_batch_id(date_key, key),
        )
    )
    await db.commit()
    return Response.ok({"reviewed": True, "key": key, "status": status, "date": date_key})


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


@router.get("/stale-a")
async def stale_a_students(
    days: int = Query(3, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    last_activity = build_last_activity_subquery()

    latest_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("latest_activity_at")
    cutoff = utcnow() - timedelta(days=days)

    result = await db.execute(
        select(Student, User.name.label("agent_name"), latest_activity_at)
        .outerjoin(User, User.id == Student.assigned_to)
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(
            Student.intent_level == IntentLevel.A,
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            latest_activity_at < cutoff,
        )
        .order_by(latest_activity_at.asc(), Student.id.asc())
    )

    now = utcnow()
    data = []
    for student, agent_name, raw_last_activity_at in result.all():
        last_activity_at = to_datetime(raw_last_activity_at)
        data.append(
            {
                "id": student.id,
                "name": student.name,
                "region": student.region,
                "status": canonical_status_value(student.status),
                "status_detail": status_detail_value(student.status, student.status_detail),
                "stage": student.stage.value,
                "intent_level": student.intent_level.value,
                "assigned_to": student.assigned_to,
                "agent_name": agent_name,
                "last_activity_at": last_activity_at.isoformat() if last_activity_at else None,
                "days_since": (now - last_activity_at).days if last_activity_at else 0,
            }
        )

    return Response.ok(data)


@router.get("/stale-students")
async def stale_students(
    days: int = Query(3, ge=1, le=30),
    agent_id: int | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE)),
):
    last_activity = build_last_activity_subquery()
    last_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("last_activity_at")
    cutoff = utcnow() - timedelta(days=days)
    stale_filters = [Student.status.not_in(TERMINAL_STUDENT_STATUSES)]

    if agent_id is None:
        stale_filters.extend(
            [
                Student.assigned_to.isnot(None),
                last_activity_at < cutoff,
            ]
        )
    else:
        stale_filters.append(Student.assigned_to == agent_id)

    result = await db.execute(
        select(Student, User.name.label("agent_name"), last_activity_at)
        .outerjoin(User, User.id == Student.assigned_to)
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(*stale_filters)
        .order_by(last_activity_at.asc(), Student.id.asc())
    )

    data = []
    for student, agent_name, raw_last_activity_at in result.all():
        activity_at = to_datetime(raw_last_activity_at)
        data.append(
            {
                "student_id": student.id,
                "name": student.name,
                "region": student.region,
                "intent_level": student.intent_level.value,
                "status": canonical_status_value(student.status),
                "status_detail": status_detail_value(student.status, student.status_detail),
                "agent_name": agent_name,
                "assigned_at": student.assigned_at.isoformat() if student.assigned_at else None,
                "last_activity_at": activity_at.isoformat() if activity_at else None,
            }
        )

    return Response.ok(data)


@router.get("/stale-school-groups")
async def stale_school_groups(
    days: int = Query(3, ge=1, le=30),
    group_by: str = Query("school_name"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校或区域聚合超时未跟进的学员数量"""
    last_activity = build_last_activity_subquery()
    last_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("last_activity_at")
    cutoff = utcnow() - timedelta(days=days)

    group_col = Student.school_name if group_by == "school_name" else Student.region

    result = await db.execute(
        select(group_col, func.count())
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(
            Student.assigned_to.isnot(None),
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            last_activity_at < cutoff,
        )
        .group_by(group_col)
        .order_by(func.count().desc())
    )
    groups = [{"name": name or "未知", "count": cnt} for name, cnt in result.all()]
    total = sum(g["count"] for g in groups)
    return Response.ok({"groups": groups, "total": total})


class StaleReclaimByGroupReq(BaseModel):
    group_name: str
    group_by: Literal["school_name", "region"] = "school_name"
    days: int = 3


@router.post("/stale-reclaim-by-group")
async def stale_reclaim_by_group(
    body: StaleReclaimByGroupReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校或区域一键回收超时学员 → assigned_to=null"""
    last_activity = build_last_activity_subquery()
    last_activity_at = func.coalesce(
        last_activity.c.last_activity_at, Student.assigned_at, Student.created_at
    ).label("last_activity_at")
    cutoff = utcnow() - timedelta(days=body.days)

    group_col = Student.school_name if body.group_by == "school_name" else Student.region

    result = await db.execute(
        select(Student)
        .outerjoin(last_activity, last_activity.c.student_id == Student.id)
        .where(
            group_col == body.group_name,
            Student.assigned_to.isnot(None),
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            last_activity_at < cutoff,
        )
    )
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg="没有可回收的超时学员")

    reclaimed_count = 0
    for s in students:
        old_agent_id = s.assigned_to
        s.assigned_to = None
        s.assigned_at = None
        db.add(
            OperationLog(
                operator_id=current_user.id,
                operator_name=current_user.name,
                target_student_id=s.id,
                case_no=s.case_no or "",
                action="线索回收",
                content=(
                    f"按{('学校' if body.group_by == 'school_name' else '区域')}"
                    f"回收「{body.group_name}」，从话务员 "
                    f"{old_agent_id or '未分配'} 回收至未分配池"
                ),
            )
        )
        reclaimed_count += 1

    await db.commit()
    return Response.ok({"reclaimed_count": reclaimed_count, "group_name": body.group_name})


@router.post("/stale-reassign")
async def stale_reassign(
    body: StaleReassignReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE)),
):
    if not user_has_operation_permission(current_user, ADMIN_OP_STUDENT_ASSIGN):
        raise HTTPException(status_code=403, detail="无权分配学生")
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")
    student_ids = list(dict.fromkeys(body.student_ids))

    students_result = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="没有可回收的线索")

    now = utcnow()
    distribution: dict[str, int] = {}

    if body.mode == "recycle":
        for student in students:
            student.assigned_to = None
            student.assigned_at = None
        distribution["总名单"] = len(students)
    elif body.mode == "manual":
        if body.agent_id is None:
            return Response.error(code=1, msg="manual mode requires agent_id")
        agent_result = await db.execute(
            select(User).where(
                User.id == body.agent_id,
                User.is_active,
                User.role == UserRole.agent,
            )
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            return Response.error(code=1, msg="话务员不存在或已禁用")
        for student in students:
            student.assigned_to = agent.id
            student.assigned_at = now
            distribution[agent.name] = distribution.get(agent.name, 0) + 1
    else:
        agent_result = await db.execute(
            select(User).where(User.is_active, User.role == UserRole.agent).order_by(User.id)
        )
        agents = agent_result.scalars().all()
        if not agents:
            return Response.error(code=1, msg="没有可用的话务员")

        # 一次查询获取所有 agent 的当前负载
        load_r = await db.execute(
            select(Student.assigned_to, func.count(Student.id))
            .where(
                Student.assigned_to.in_([a.id for a in agents]),
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            )
            .group_by(Student.assigned_to)
        )
        load = {aid: cnt for aid, cnt in load_r.all()}
        for agent in agents:
            load.setdefault(agent.id, 0)
            distribution[agent.name] = 0
        agent_map = {agent.id: agent for agent in agents}

        for student in sorted(students, key=lambda item: item.id):
            agent_id = min(load, key=load.get)
            agent = agent_map[agent_id]
            student.assigned_to = agent_id
            student.assigned_at = now
            load[agent_id] += 1
            distribution[agent.name] += 1

    log_content = "回收到总名单" if body.mode == "recycle" else "超时未跟进，重新分配"
    for student in students:
        db.add(
            OperationLog(
                operator_id=current_user.id,
                operator_name=current_user.name,
                target_student_id=student.id,
                case_no=student.case_no or "",
                action="线索回收",
                content=log_content,
            )
        )

    await db.commit()
    return Response.ok({"reassigned_count": len(students), "distribution": distribution})


@router.get("/agents")
async def list_agents(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(User).where(User.role == UserRole.agent, User.is_active).order_by(User.id)
    )
    agents = result.scalars().all()
    if not agents:
        return Response.ok([])

    agent_ids = [a.id for a in agents]
    today = today_cst_as_utc()

    # 合并学生统计：总线索 + 各状态计数一次查询，任务口径由 app.task_stats 统一解释。
    stats_r = await db.execute(
        select(
            Student.assigned_to,
            Student.status,
            func.count().label("count"),
        )
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to, Student.status)
    )
    status_counts_by_agent: dict[int, dict[StudentStatus, int]] = {}
    total_leads_by_agent: dict[int, int] = {}
    for row in stats_r.all():
        status_counts_by_agent.setdefault(row.assigned_to, {})[row.status] = int(row.count or 0)
        total_leads_by_agent[row.assigned_to] = total_leads_by_agent.get(row.assigned_to, 0) + int(
            row.count or 0
        )

    # 今日呼出数：拨号动作写入 DialLog，未做 AI 分析也要计入。
    today_calls_r = await db.execute(
        select(DialLog.agent_id, func.count(DialLog.id))
        .where(DialLog.agent_id.in_(agent_ids), DialLog.dialed_at >= today)
        .group_by(DialLog.agent_id)
    )
    today_calls_map = dict(today_calls_r.all())

    data = []
    for a in agents:
        task_stats = build_task_stats(status_counts_by_agent.get(a.id, {}))
        data.append(
            {
                "id": a.id,
                "name": a.name,
                "username": a.username,
                "is_active": a.is_active,
                "is_super_admin": a.is_super_admin,
                "service_regions": a.service_regions,
                "total_tasks": task_stats["total"],
                "done_tasks": task_stats["done"],
                "pending_tasks": task_stats["pending"],
                "follow_up_tasks": task_stats["follow_up"],
                "total_leads": total_leads_by_agent.get(a.id, 0),
                "today_calls": int(today_calls_map.get(a.id, 0)),
                "locked_until": str(a.locked_until) if a.locked_until else None,
                "failed_login_attempts": a.failed_login_attempts,
                "created_at": str(a.created_at),
            }
        )

    return Response.ok(data)


@router.get("/users")
async def list_users(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_any_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE, ADMIN_PAGE_AUDIT_LOGS)
    ),
):
    result = await db.execute(
        select(User).where(User.role.in_([UserRole.admin, UserRole.agent])).order_by(User.id)
    )
    users = result.scalars().all()
    if not users:
        return Response.ok([])

    agent_ids = [user.id for user in users if user.role == UserRole.agent]
    status_counts_by_agent: dict[int, dict[StudentStatus, int]] = {}
    total_leads_by_agent: dict[int, int] = {}
    today_calls_map: dict[int, int] = {}
    if agent_ids:
        today = today_cst_as_utc()
        stats_r = await db.execute(
            select(
                Student.assigned_to,
                Student.status,
                func.count().label("count"),
            )
            .where(Student.assigned_to.in_(agent_ids))
            .group_by(Student.assigned_to, Student.status)
        )
        for row in stats_r.all():
            status_counts_by_agent.setdefault(row.assigned_to, {})[row.status] = int(row.count or 0)
            total_leads_by_agent[row.assigned_to] = total_leads_by_agent.get(
                row.assigned_to, 0
            ) + int(row.count or 0)

        today_calls_r = await db.execute(
            select(DialLog.agent_id, func.count(DialLog.id))
            .where(DialLog.agent_id.in_(agent_ids), DialLog.dialed_at >= today)
            .group_by(DialLog.agent_id)
        )
        today_calls_map = dict(today_calls_r.all())

    data = []
    for user in users:
        task_stats = build_task_stats(status_counts_by_agent.get(user.id, {}))
        data.append(
            {
                "id": user.id,
                "name": user.name,
                "username": user.username,
                "role": user.role,
                "is_active": user.is_active,
                "is_super_admin": user.is_super_admin,
                "page_permissions": normalize_page_permissions(user.page_permissions),
                "operation_permissions": normalize_operation_permissions(
                    user.operation_permissions
                ),
                "service_regions": user.service_regions,
                "total_tasks": task_stats["total"] if user.role == UserRole.agent else 0,
                "done_tasks": task_stats["done"] if user.role == UserRole.agent else 0,
                "pending_tasks": task_stats["pending"] if user.role == UserRole.agent else 0,
                "follow_up_tasks": task_stats["follow_up"] if user.role == UserRole.agent else 0,
                "total_leads": total_leads_by_agent.get(user.id, 0),
                "today_calls": int(today_calls_map.get(user.id, 0)),
                "locked_until": str(user.locked_until) if user.locked_until else None,
                "failed_login_attempts": user.failed_login_attempts,
                "created_at": str(user.created_at),
            }
        )

    return Response.ok(data)


@router.get("/agent-score-preview")
async def agent_score_preview(
    daily_call_target: int | None = Query(None, ge=1, le=SCORE_DAILY_CALL_TARGET_MAX),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_SCORE_PREVIEW)),
):
    """只读评分预览：聚合现有工作记录，不写库、不改变派单或话务流程。"""
    configured_call_target = int(await get_config_value(db, "score_daily_call_target", "30") or 30)
    effective_daily_call_target = daily_call_target or configured_call_target
    agents_r = await db.execute(
        select(User).where(User.role == UserRole.agent, User.is_active).order_by(User.id)
    )
    agents = agents_r.scalars().all()
    if not agents:
        return Response.ok(
            {
                "generated_at": str(utcnow()),
                "daily_call_target": effective_daily_call_target,
                "configured_daily_call_target": configured_call_target,
                "items": [],
            }
        )

    agent_ids = [agent.id for agent in agents]
    today = today_cst_as_utc()
    tomorrow = today + timedelta(days=1)

    status_counts_r = await db.execute(
        select(
            Student.assigned_to,
            Student.status,
            func.count(Student.id).label("count"),
        )
        .where(Student.assigned_to.in_(agent_ids))
        .group_by(Student.assigned_to, Student.status)
    )
    status_counts_by_agent: dict[int, dict[StudentStatus, int]] = {}
    total_leads_by_agent: dict[int, int] = {}
    for row in status_counts_r.all():
        status_counts_by_agent.setdefault(row.assigned_to, {})[row.status] = int(row.count or 0)
        total_leads_by_agent[row.assigned_to] = total_leads_by_agent.get(row.assigned_to, 0) + int(
            row.count or 0
        )

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
            .filter(DialLog.duration_seconds > 0)
            .label("today_recorded_calls"),
            func.count(DialLog.id)
            .filter(or_(DialLog.duration_seconds <= 0, DialLog.duration_seconds.is_(None)))
            .label("today_unrecorded_calls"),
            func.avg(DialLog.duration_seconds)
            .filter(DialLog.duration_seconds > 0)
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
    return Response.ok(
        {
            "generated_at": str(utcnow()),
            "daily_call_target": effective_daily_call_target,
            "configured_daily_call_target": configured_call_target,
            "items": items,
        }
    )


@router.get("/agents/{agent_id}/tasks")
async def agent_tasks(
    agent_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_ACCOUNT_MANAGE)),
):
    agent_r = await db.execute(select(User).where(User.id == agent_id))
    agent = agent_r.scalar_one_or_none()
    if not agent:
        return Response.error(code=1, msg="话务员不存在")

    # 使用统一任务口径统计，避免管理员和话务员工作台数字漂移。
    stats_r = await db.execute(
        select(
            Student.status,
            func.count(Student.id).label("count"),
        )
        .where(Student.assigned_to == agent_id)
        .group_by(Student.status)
    )
    counts = {row.status: int(row.count or 0) for row in stats_r.all()}
    task_stats = build_task_stats(counts)
    total_leads = (
        await db.execute(select(func.count(Student.id)).where(Student.assigned_to == agent_id))
    ).scalar() or 0

    extra_stats_r = await db.execute(
        select(
            func.count(Student.id).filter(Student.intent_level == IntentLevel.A).label("a_level"),
        ).where(Student.assigned_to == agent_id)
    )
    extra_stats = extra_stats_r.one()
    a_level = int(extra_stats.a_level or 0)

    # 获取学生列表（仍需用于返回）
    students_r = await db.execute(
        select(Student)
        .where(
            Student.assigned_to == agent_id,
            Student.status.in_(ACTIVE_TASK_STATUSES),
        )
        .order_by(Student.updated_at.desc())
    )
    students = students_r.scalars().all()

    # 批量查询 view_count
    student_ids = [s.id for s in students]
    view_count = 0
    if student_ids:
        v_r = await db.execute(
            select(func.count(LeadViewLog.id)).where(LeadViewLog.student_id.in_(student_ids))
        )
        view_count = v_r.scalar() or 0

    return Response.ok(
        {
            "agent": {"id": agent.id, "name": agent.name, "username": agent.username},
            "stats": {
                **task_stats,
                "a_level": a_level,
                "view_count": view_count,
                "total_leads": total_leads,
            },
            "list": [
                {
                    "id": s.id,
                    "name": s.name,
                    "region": s.region,
                    "status": canonical_status_value(s.status),
                    "status_detail": status_detail_value(s.status, s.status_detail),
                    "invalid_reason": status_detail_value(s.status, s.status_detail)
                    if canonical_status_value(s.status) == StudentStatus.invalid.value
                    else "",
                    "stage": s.stage.value,
                    "intent_level": s.intent_level.value,
                    "join_reasons": s.join_reasons,
                    "assigned_at": str(s.assigned_at) if s.assigned_at else None,
                    "updated_at": str(s.updated_at),
                }
                for s in students
            ],
        }
    )


@router.post("/users")
async def create_user(
    body: UserCreateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_CREATE)),
):
    if not current_user.is_super_admin and (
        body.role == "admin"
        or body.is_super_admin
        or body.page_permissions
        or body.operation_permissions
    ):
        raise HTTPException(status_code=403, detail="只有超级管理员可以创建管理员或授权")
    display_name_error = _validate_user_display_name(body.name)
    if display_name_error:
        return Response.error(code=1, msg=display_name_error)
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        return Response.error(code=1, msg=f"用户名 {body.username} 已存在")
    display_name = _clean_user_display_name(body.name)
    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        name=display_name,
        role=UserRole(body.role),
        service_regions=body.service_regions,
        is_active=True,
        is_super_admin=body.role == "admin" and body.is_super_admin,
        page_permissions=(
            ""
            if body.role != "admin" or body.is_super_admin
            else page_permissions_to_storage(body.page_permissions)
        ),
        operation_permissions=(
            ""
            if body.role != "admin" or body.is_super_admin
            else operation_permissions_to_storage(body.operation_permissions)
        ),
        # 新建话务员：首次登录强制本人改密；管理员账号不强制
        must_change_password=(UserRole(body.role) == UserRole.agent),
    )
    db.add(user)
    await db.flush()
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="创建用户",
            content=f"创建{body.role} {user.username}({user.name})",
        )
    )
    await db.commit()
    await db.refresh(user)
    return Response.ok(
        {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "is_super_admin": user.is_super_admin,
            "page_permissions": normalize_page_permissions(user.page_permissions),
            "operation_permissions": normalize_operation_permissions(user.operation_permissions),
        }
    )


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_EDIT)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if not current_user.is_super_admin and (
        user.role == UserRole.admin
        or body.role == "admin"
        or body.is_super_admin is not None
        or body.page_permissions is not None
        or body.operation_permissions is not None
    ):
        raise HTTPException(status_code=403, detail="只有超级管理员可以调整管理员或权限")

    changes = []
    if body.name is not None:
        display_name_error = _validate_user_display_name(body.name)
        if display_name_error:
            return Response.error(code=1, msg=display_name_error)
        display_name = _clean_user_display_name(body.name)
        if display_name != user.name:
            changes.append(f"姓名 {user.name}→{display_name}")
            user.name = display_name
    if body.role is not None:
        new_role = UserRole(body.role)
        if new_role != user.role:
            # 防止把唯一一个 admin / super admin 降级
            if user.role == UserRole.admin and new_role != UserRole.admin:
                admin_count = (
                    await db.execute(
                        select(func.count(User.id)).where(
                            User.role == UserRole.admin, User.is_active
                        )
                    )
                ).scalar() or 0
                if admin_count <= 1:
                    return Response.error(code=1, msg="系统至少需要保留一个管理员")
                if (
                    user.is_super_admin
                    and user.is_active
                    and await count_active_super_admins(db) <= 1
                ):
                    return Response.error(code=1, msg="系统至少需要保留一个超级管理员")
            changes.append(f"角色 {user.role}→{new_role}")
            user.role = new_role
            if new_role != UserRole.admin and user.is_super_admin:
                user.is_super_admin = False
                changes.append("取消超级管理员")
            if new_role != UserRole.admin and user.page_permissions:
                user.page_permissions = ""
                changes.append("清空页面权限")
            if new_role != UserRole.admin and user.operation_permissions:
                user.operation_permissions = ""
                changes.append("清空操作权限")
    if body.is_super_admin is not None and body.is_super_admin != user.is_super_admin:
        if body.is_super_admin and user.role != UserRole.admin:
            return Response.error(code=1, msg="只有管理员账号可以设为超级管理员")
        if not body.is_super_admin and user.is_super_admin and user.is_active:
            if await count_active_super_admins(db) <= 1:
                return Response.error(code=1, msg="系统至少需要保留一个超级管理员")
        user.is_super_admin = body.is_super_admin
        changes.append("设为超级管理员" if body.is_super_admin else "取消超级管理员")
    if body.page_permissions is not None:
        next_permissions = (
            ""
            if user.role != UserRole.admin or user.is_super_admin
            else page_permissions_to_storage(body.page_permissions)
        )
        if next_permissions != user.page_permissions:
            user.page_permissions = next_permissions
            changes.append("修改页面权限")
    if body.operation_permissions is not None:
        next_permissions = (
            ""
            if user.role != UserRole.admin or user.is_super_admin
            else operation_permissions_to_storage(body.operation_permissions)
        )
        if next_permissions != user.operation_permissions:
            user.operation_permissions = next_permissions
            changes.append("修改操作权限")
    if body.is_active is not None and body.is_active != user.is_active:
        # 防止把唯一一个 admin / super admin 停用
        if user.role == UserRole.admin and user.is_active and not body.is_active:
            admin_count = (
                await db.execute(
                    select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
                )
            ).scalar() or 0
            if admin_count <= 1:
                return Response.error(code=1, msg="不能停用最后一个管理员")
            if user.is_super_admin and await count_active_super_admins(db) <= 1:
                return Response.error(code=1, msg="不能停用最后一个超级管理员")
        changes.append("启用" if body.is_active else "停用")
        user.is_active = body.is_active
        # 禁用时立即撤销现有 token，防止账号被禁用后旧会话仍能访问
        if not body.is_active:
            invalidate_user_tokens(user)
    if body.service_regions is not None and body.service_regions != user.service_regions:
        changes.append("修改服务区域")
        user.service_regions = body.service_regions
    if body.password is not None:
        if not user_has_operation_permission(current_user, ADMIN_OP_USER_RESET_PASSWORD):
            raise HTTPException(status_code=403, detail="无权重置账号密码")
        changes.append("重置密码")
        user.hashed_password = hash_password(body.password)
        invalidate_user_tokens(user)

    if changes:
        db.add(
            make_operation_log(
                current_user,
                target_student_id=None,
                case_no="",
                action="修改用户",
                content=f"{user.username}: {'; '.join(changes)}",
            )
        )
    await db.commit()
    return Response.ok(
        {
            "id": user.id,
            "username": user.username,
            "name": user.name,
            "role": user.role,
            "is_active": user.is_active,
            "is_super_admin": user.is_super_admin,
            "page_permissions": normalize_page_permissions(user.page_permissions),
            "operation_permissions": normalize_operation_permissions(user.operation_permissions),
        }
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_DELETE)),
):
    if user_id == current_user.id:
        return Response.error(code=1, msg="不能删除自己")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以删除管理员")
    # 防止删除最后一个 admin
    if user.role == UserRole.admin:
        admin_count = (
            await db.execute(
                select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
            )
        ).scalar() or 0
        if admin_count <= 1:
            return Response.error(code=1, msg="不能删除最后一个管理员")
        if user.is_super_admin and user.is_active and await count_active_super_admins(db) <= 1:
            return Response.error(code=1, msg="不能删除最后一个超级管理员")
    terminal_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to == user_id,
                Student.status.in_(TERMINAL_STUDENT_STATUSES),
            )
        )
    ).scalar() or 0
    non_terminal_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to == user_id,
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            )
        )
    ).scalar() or 0

    # 1) 先处理终态学员：只解绑话务员，保留状态作为历史归档
    await db.execute(
        update(Student)
        .where(
            Student.assigned_to == user_id,
            Student.status.in_(TERMINAL_STUDENT_STATUSES),
        )
        .values(assigned_to=None, assigned_at=None)
    )
    # 2) 再回收非终态学员：清除分配、状态、意向、阶段，避免新话务员误以为旧记录是自己跟出来的
    await db.execute(
        update(Student)
        .where(Student.assigned_to == user_id)
        .values(
            assigned_to=None,
            assigned_at=None,
            status=StudentStatus.not_contacted,
            status_detail="",
            intent_level=IntentLevel.none,
            stage=StudentStage.initial_contact,
            need_help=False,
        )
    )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="删除用户",
            content=(
                f"删除{user.role} {user.username}({user.name})："
                f"回收非终态 {non_terminal_count} 条、保留终态 {terminal_count} 条"
            ),
        )
    )
    await db.delete(user)
    await db.commit()
    return Response.ok(msg="已删除，该话务员的学生已回收至池")


@router.post("/users/{user_id}/offboard")
async def offboard_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_OFFBOARD)),
):
    """软离职：禁用账号 + 撤销 token + 回收线索 + 留存历史。

    相比 delete_user 的优势：
      1) 保留 Call/Note/FollowUp 等历史归属，报表口径不丢
      2) 绕开 FK 约束（hard delete 在话务员有工作记录时会报错）
      3) 一个原子操作完成所有离职动作，避免 admin 分多步做漏环节
    """
    if user_id == current_user.id:
        return Response.error(code=1, msg="不能离职自己")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以为管理员办理离职")

    # 防止把最后一个 admin 离职
    if user.role == UserRole.admin and user.is_active:
        admin_count = (
            await db.execute(
                select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
            )
        ).scalar() or 0
        if admin_count <= 1:
            return Response.error(code=1, msg="不能离职最后一个管理员")
        if user.is_super_admin and await count_active_super_admins(db) <= 1:
            return Response.error(code=1, msg="不能离职最后一个超级管理员")

    # 1) 终态学员（已报名/无效及旧无效类状态）：只解绑，状态保留作为历史
    terminal_statuses = TERMINAL_STUDENT_STATUSES
    preserved_q = await db.execute(
        select(func.count(Student.id)).where(
            Student.assigned_to == user_id,
            Student.status.in_(terminal_statuses),
        )
    )
    preserved_count = preserved_q.scalar() or 0
    await db.execute(
        update(Student)
        .where(
            Student.assigned_to == user_id,
            Student.status.in_(terminal_statuses),
        )
        .values(assigned_to=None, assigned_at=None)
    )

    # 2) 非终态学员：全部回收到池，清除阶段/意向，避免新话务员误以为是自己跟出来的
    recycled_q = await db.execute(
        select(func.count(Student.id)).where(Student.assigned_to == user_id)
    )
    recycled_count = recycled_q.scalar() or 0
    await db.execute(
        update(Student)
        .where(Student.assigned_to == user_id)
        .values(
            assigned_to=None,
            assigned_at=None,
            status=StudentStatus.not_contacted,
            status_detail="",
            intent_level=IntentLevel.none,
            stage=StudentStage.initial_contact,
            need_help=False,
        )
    )

    # 3) 禁用账号 + 撤销现有 token
    was_active = user.is_active
    user.is_active = False
    user.failed_login_attempts = 0
    user.locked_until = None
    invalidate_user_tokens(user)

    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="离职用户",
            content=(
                f"离职 {user.role} {user.username}({user.name})："
                f"回收非终态 {recycled_count} 条、保留终态 {preserved_count} 条"
                + ("" if was_active else "（账号原本已禁用）")
            ),
        )
    )
    await db.commit()
    return Response.ok(
        {
            "user_id": user.id,
            "username": user.username,
            "recycled_count": recycled_count,
            "preserved_count": preserved_count,
            "was_already_disabled": not was_active,
        }
    )


@router.post("/users/{user_id}/unlock")
async def unlock_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_UNLOCK)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以解锁管理员")
    user.failed_login_attempts = 0
    user.locked_until = None
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="解锁用户",
            content=f"解锁 {user.username}",
        )
    )
    await db.commit()
    return Response.ok(msg=f"用户 {user.username} 已解锁")


@router.post("/users/{user_id}/reset-password")
async def reset_user_password(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_USER_RESET_PASSWORD)),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise HTTPException(status_code=403, detail="只有超级管理员可以重置管理员密码")
    new_password = secrets.token_urlsafe(8)
    user.hashed_password = hash_password(new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    # 重置后强制本人下次登录改密
    user.must_change_password = True
    invalidate_user_tokens(user)
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="重置密码",
            content=f"重置 {user.username} 的密码",
        )
    )
    await db.commit()
    return Response.ok(
        {"new_password": new_password, "msg": f"用户 {user.name} 密码已重置为 {new_password}"}
    )


@router.get("/backups")
async def list_backups(
    current_user: User = Depends(require_super_admin),
):
    """列出已有备份文件。"""
    return Response.ok(_backup_items())


@router.post("/backups")
async def trigger_backup(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """手动触发一次数据库备份。"""
    await do_backup_async()
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="手动备份",
            content="管理员手动触发数据库备份",
        )
    )
    await db.commit()
    return Response.ok({"msg": "备份完成"})


@router.get("/backups/{name}")
async def download_backup(
    name: str,
    current_user: User = Depends(require_super_admin),
):
    """下载指定备份文件。"""
    # 双重防穿越：1) 文件名白名单 2) realpath 必须仍在 BACKUP_DIR 下
    ext = _get_backup_extension()
    if (
        not name.startswith("crm_")
        or not name.endswith(ext)
        or "/" in name
        or "\\" in name
        or ".." in name
    ):
        raise HTTPException(status_code=400, detail="非法的备份文件名")
    backup_root = os.path.realpath(BACKUP_DIR)
    fpath = os.path.realpath(os.path.join(BACKUP_DIR, name))
    if not fpath.startswith(backup_root + os.sep):
        raise HTTPException(status_code=400, detail="非法的备份路径")
    if not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="备份文件不存在")
    return FileResponse(fpath, media_type="application/octet-stream", filename=name)


@router.post("/expire-check")
async def check_expired(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """过期逻辑已暂时停用，保留接口以兼容旧前端/脚本调用。"""
    return Response.ok({"expired_count": 0, "disabled": True})


@router.get("/global-search")
async def global_search(
    q: str = Query(""),
    limit: int = Query(20, ge=1, le=50),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEADS_MANAGE)),
):
    """管理员全局搜索：覆盖学生、无效线索和操作记录，便于按手机号快速找人。"""
    keyword = (q or "").strip()
    if not keyword:
        return Response.ok({"q": "", "students": [], "operation_logs": []})

    student_predicate = _student_search_predicate(keyword)
    student_rows = []
    if student_predicate is not None:
        student_result = await db.execute(
            select(Student, User.name.label("agent_name"))
            .outerjoin(User, User.id == Student.assigned_to)
            .where(student_predicate)
            .order_by(Student.updated_at.desc(), Student.id.desc())
            .limit(limit)
        )
        student_rows = student_result.all()

    student_ids = [student.id for student, _ in student_rows]
    latest_logs_by_student_id: dict[int, OperationLog] = {}
    if student_ids:
        logs_result = await db.execute(
            select(OperationLog)
            .where(OperationLog.target_student_id.in_(student_ids))
            .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
        )
        for log in logs_result.scalars().all():
            if log.target_student_id not in latest_logs_by_student_id:
                latest_logs_by_student_id[log.target_student_id] = log

    operation_log_predicate = _operation_log_search_predicate(keyword)
    operation_logs = []
    if operation_log_predicate is not None:
        operation_log_result = await db.execute(
            select(OperationLog, Student, User.name.label("agent_name"))
            .outerjoin(Student, OperationLog.target_student_id == Student.id)
            .outerjoin(User, User.id == Student.assigned_to)
            .where(operation_log_predicate)
            .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
            .limit(limit)
        )
        for log, student, agent_name in operation_log_result.all():
            operation_logs.append(
                {
                    **_latest_log_payload(log),
                    "student": (
                        _admin_student_search_payload(student, agent_name, None)
                        if student is not None
                        else None
                    ),
                }
            )

    return Response.ok(
        {
            "q": keyword,
            "students": [
                _admin_student_search_payload(
                    student,
                    agent_name,
                    latest_logs_by_student_id.get(student.id),
                )
                for student, agent_name in student_rows
            ],
            "operation_logs": operation_logs,
        }
    )


@router.get("/invalid-students")
async def list_invalid_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    school_name: str | None = Query(None),
    invalid_reason: str | None = Query(None),
    q: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_INVALID_RECLAIM)),
):
    """列出所有标记为无效的线索，用于回收和重新分配"""
    invalid_statuses = statuses_for_canonical(StudentStatus.invalid)
    where = [Student.status.in_(invalid_statuses)]
    if school_name:
        where.append(Student.school_name == school_name)
    reason_clause = invalid_reason_predicate(invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    search_clause = _student_search_predicate(q)
    if search_clause is not None:
        where.append(search_clause)

    query = (
        select(Student, User.name.label("agent_name"))
        .outerjoin(User, User.id == Student.assigned_to)
        .where(*where)
        .order_by(Student.updated_at.desc())
    )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    rows = result.all()

    # 获取无效原因（从操作日志中提取）
    student_ids = [s.id for s, _ in rows]
    invalid_reasons = {}
    if student_ids:
        # 查询最近一次标记为无效的操作日志
        logs_result = await db.execute(
            select(
                OperationLog.target_student_id,
                OperationLog.note_content,
                OperationLog.operator_name,
                OperationLog.content,
                OperationLog.created_at,
            )
            .where(
                OperationLog.target_student_id.in_(student_ids),
                OperationLog.action == "修改状态",
                OperationLog.new_status == "无效",
            )
            .order_by(OperationLog.created_at.desc())
        )
        for sid, reason, operator_name, content, created_at in logs_result.all():
            if sid not in invalid_reasons:
                invalid_reasons[sid] = {
                    "reason": reason or "",
                    "operator_name": operator_name or "",
                    "content": content or "",
                    "created_at": str(created_at) if created_at else "",
                }

    data = [
        {
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "school_name": s.school_name,
            "guardian_name": s.guardian_name,
            "guardian_phone": mask_phone(s.guardian_phone),
            "guardian2_name": s.guardian2_name,
            "guardian2_phone": mask_phone(s.guardian2_phone),
            "assigned_to": s.assigned_to,
            "agent_name": agent_name or "未分配",
            "status": canonical_status_value(s.status),
            "status_detail": status_detail_value(s.status, s.status_detail),
            "invalid_reason": status_detail_value(s.status, s.status_detail)
            or invalid_reasons.get(s.id, {}).get("reason", ""),
            "invalid_operator_name": invalid_reasons.get(s.id, {}).get("operator_name", ""),
            "invalid_content": invalid_reasons.get(s.id, {}).get("content", ""),
            "invalid_at": invalid_reasons.get(s.id, {}).get("created_at", ""),
            "updated_at": str(s.updated_at),
            "case_no": s.case_no,
        }
        for s, agent_name in rows
    ]

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "list": data,
        }
    )


class ReclaimStudentsReq(BaseModel):
    student_ids: list[int]
    agent_id: int


class BulkInvalidStudentsReq(BaseModel):
    student_ids: list[int]


@router.post("/reclaim-students")
async def reclaim_invalid_students(
    body: ReclaimStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """回收无效线索并重新分配给话务员验证"""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    # 验证话务员存在且激活
    agent_result = await db.execute(select(User).where(User.id == body.agent_id, User.is_active))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        return Response.error(code=1, msg="话务员不存在或已禁用")

    # 查询要回收的学生，确保都是无效状态
    students_result = await db.execute(select(Student).where(Student.id.in_(body.student_ids)))
    students = students_result.scalars().all()

    if not students:
        return Response.error(code=1, msg="未找到指定的学生")

    # 检查是否都是无效状态
    non_invalid = [
        s for s in students if canonical_student_status(s.status) != StudentStatus.invalid
    ]
    if non_invalid:
        names = ", ".join([s.name for s in non_invalid[:3]])
        return Response.error(code=1, msg=f"部分学生不是无效状态，无法回收: {names}")

    # 回收：重置状态为未联系，重新分配
    now = utcnow()
    reclaimed_count = 0
    for student in students:
        old_agent_id = student.assigned_to
        student.status = StudentStatus.not_contacted
        student.status_detail = ""
        # 与 delete_user/offboard 的回收契约保持一致：重置意向/阶段/求助，
        # 否则新话务员会看到旧的意向 A、阶段「已来访」，误以为是自己跟出来的，
        # 同时污染漏斗/转化统计。
        student.intent_level = IntentLevel.none
        student.stage = StudentStage.initial_contact
        student.need_help = False
        student.assigned_to = body.agent_id
        student.assigned_at = now

        # 记录操作日志
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "回收无效线索",
                content=(
                    f"从话务员 {old_agent_id or '未分配'} 回收，"
                    f"重新分配给 {agent.name}（ID:{body.agent_id}）"
                ),
                old_status="无效",
                new_status="未联系",
            )
        )
        reclaimed_count += 1

    await db.commit()

    return Response.ok(
        {
            "reclaimed_count": reclaimed_count,
            "agent_id": body.agent_id,
            "agent_name": agent.name,
        }
    )


@router.post("/invalid-students/reclaim")
async def reclaim_invalid_students_to_unassigned_pool(
    body: BulkInvalidStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """回收选中的无效线索到未分配池。"""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    students_result = await db.execute(select(Student).where(Student.id.in_(body.student_ids)))
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")

    non_invalid = [
        student
        for student in students
        if canonical_student_status(student.status) != StudentStatus.invalid
    ]
    if non_invalid:
        names = ", ".join([student.name for student in non_invalid[:3]])
        return Response.error(code=1, msg=f"部分学生不是无效状态，无法回收: {names}")

    reclaimed_count = await reclaim_invalid_students_to_pool(
        db, students, current_user, action="批量回收无效线索"
    )
    await db.commit()
    return Response.ok({"reclaimed_count": reclaimed_count})


@router.post("/invalid-students/delete")
async def delete_invalid_students(
    body: BulkInvalidStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_DELETE)),
):
    """删除选中的无效线索及关联记录。"""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    students_result = await db.execute(select(Student).where(Student.id.in_(body.student_ids)))
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")

    non_invalid = [
        student
        for student in students
        if canonical_student_status(student.status) != StudentStatus.invalid
    ]
    if non_invalid:
        names = ", ".join([student.name for student in non_invalid[:3]])
        return Response.error(code=1, msg=f"部分学生不是无效状态，无法删除: {names}")

    deleted_count = await delete_students_with_related(
        db, students, current_user, action="批量删除无效线索"
    )
    await db.commit()
    return Response.ok({"deleted_count": deleted_count})


# ── 分学校回收 ──────────────────────────────────────────────


class ReclaimBySchoolReq(BaseModel):
    school_name: str
    invalid_reason: str | None = None


@router.post("/reclaim-by-school")
async def reclaim_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """按学校一键回收无效线索 → assigned_to=null（未分配池）"""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")

    # 查出该校所有无效学员
    where = [
        Student.school_name == body.school_name,
        Student.status.in_(statuses_for_canonical(StudentStatus.invalid)),
    ]
    reason_clause = invalid_reason_predicate(body.invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    result = await db.execute(select(Student).where(*where))
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可回收的无效线索")

    reclaimed_count = await reclaim_invalid_students_to_pool(
        db, students, current_user, action="分学校回收"
    )

    await db.commit()

    return Response.ok(
        {
            "reclaimed_count": reclaimed_count,
            "school_name": body.school_name,
        }
    )


@router.post("/delete-by-school")
async def delete_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_DELETE)),
):
    """按学校批量删除无效线索（含关联的通话/备注/回访/到访/日志）"""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")

    where = [
        Student.school_name == body.school_name,
        Student.status.in_(statuses_for_canonical(StudentStatus.invalid)),
    ]
    reason_clause = invalid_reason_predicate(body.invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    result = await db.execute(select(Student).where(*where))
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可删除的无效线索")

    deleted_count = await delete_students_with_related(
        db, students, current_user, action="批量删除无效线索"
    )

    await db.commit()

    return Response.ok(
        {
            "deleted_count": deleted_count,
            "school_name": body.school_name,
        }
    )


@router.get("/invalid-school-groups")
async def invalid_school_groups(
    invalid_reason: str | None = Query(None),
    q: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_INVALID_RECLAIM)),
):
    """按学校聚合无效线索数量"""
    where = [Student.status.in_(statuses_for_canonical(StudentStatus.invalid))]
    reason_clause = invalid_reason_predicate(invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    search_clause = _student_search_predicate(q)
    if search_clause is not None:
        where.append(search_clause)
    result = await db.execute(
        select(Student.school_name, func.count())
        .where(*where)
        .group_by(Student.school_name)
        .order_by(func.count().desc())
    )
    groups = [{"name": name or "未知学校", "count": cnt} for name, cnt in result.all()]
    return Response.ok({"groups": groups})


# ── 多学校分发 ──────────────────────────────────────────────


@router.get("/unassigned-school-groups")
async def unassigned_school_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_SCHOOL_DISTRIBUTION)),
):
    """按学校聚合未分配（assigned_to=null）且未完成的学员数量"""
    region_expr = func.coalesce(func.max(func.nullif(Student.region, "")), "")
    result = await db.execute(
        select(Student.school_name, region_expr.label("region"), func.count())
        .where(
            Student.assigned_to.is_(None),
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
        )
        .group_by(Student.school_name)
        .order_by(func.count().desc())
    )
    groups = [
        {"name": name or "未知学校", "region": region or "未知区县", "count": cnt}
        for name, region, cnt in result.all()
    ]
    total = sum(g["count"] for g in groups)
    return Response.ok({"groups": groups, "total": total})


class DistributeBySchoolsReq(BaseModel):
    school_names: list[str]
    mode: Literal["auto", "manual"] = "auto"
    agent_id: int | None = None


@router.post("/distribute-by-schools")
async def distribute_by_schools(
    body: DistributeBySchoolsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_ASSIGN)),
):
    """按学校批量分发未分配学员给话务员"""
    if not body.school_names:
        return Response.error(code=1, msg="school_names不能为空")

    # 查出所有目标学校的未分配学员
    where = [
        Student.school_name.in_(body.school_names),
        Student.assigned_to.is_(None),
        Student.status.not_in(TERMINAL_STUDENT_STATUSES),
    ]
    result = await db.execute(select(Student).where(*where))
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg="所选学校没有可分配的学员")

    now = utcnow()
    batch_id = make_batch_id("school-distribute")
    old_assignment_by_student_id = {
        student.id: (student.assigned_to, student.assigned_at) for student in students
    }
    distribution: dict[str, int] = {}
    assigned_by_student_id: dict[int, int] = {}

    if body.mode == "manual":
        if body.agent_id is None:
            return Response.error(code=1, msg="manual模式需要agent_id")
        agent_result = await db.execute(
            select(User).where(
                User.id == body.agent_id, User.is_active, User.role == UserRole.agent
            )
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            return Response.error(code=1, msg="话务员不存在或已禁用")
        for s in students:
            s.assigned_to = agent.id
            s.assigned_at = now
            assigned_by_student_id[s.id] = agent.id
        distribution[agent.name] = len(students)
    else:
        # auto: 按当前负载均匀分配
        agent_result = await db.execute(
            select(User).where(User.is_active, User.role == UserRole.agent).order_by(User.id)
        )
        agents = agent_result.scalars().all()
        if not agents:
            return Response.error(code=1, msg="没有可用的话务员")

        load_r = await db.execute(
            select(Student.assigned_to, func.count(Student.id))
            .where(
                Student.assigned_to.in_([a.id for a in agents]),
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            )
            .group_by(Student.assigned_to)
        )
        load = {aid: cnt for aid, cnt in load_r.all()}
        for agent in agents:
            load.setdefault(agent.id, 0)
            distribution[agent.name] = 0
        agent_map = {agent.id: agent for agent in agents}

        for s in sorted(students, key=lambda item: item.id):
            agent_id = min(load, key=load.get)
            s.assigned_to = agent_id
            s.assigned_at = now
            assigned_by_student_id[s.id] = agent_id
            load[agent_id] += 1
            distribution[agent_map[agent_id].name] += 1

    for s in students:
        old_agent_id, old_assigned_at = old_assignment_by_student_id.get(
            s.id,
            (None, None),
        )
        new_agent_id = assigned_by_student_id.get(s.id)
        db.add(
            make_operation_log(
                current_user,
                s.id,
                s.case_no or "",
                action="多学校分发",
                content=f"从学校「{s.school_name}」分发给话务员",
                old_status=assignment_state_label(old_agent_id),
                new_status=assignment_state_label(new_agent_id),
                note_content=make_assignment_rollback_note(
                    old_assigned_to=old_agent_id,
                    old_assigned_at=old_assigned_at,
                    new_assigned_to=new_agent_id,
                    new_assigned_at=now,
                ),
                batch_id=batch_id,
            )
        )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="多学校分发汇总",
            content=(f"多学校分发，共 {len(students)} 名；学校：{'、'.join(body.school_names)}"),
            batch_id=batch_id,
        )
    )

    await db.commit()
    return Response.ok(
        {
            "distributed_count": len(students),
            "distribution": distribution,
            "schools": body.school_names,
            "batch_id": batch_id,
        }
    )


@router.get("/operation-logs")
async def count_operation_logs(
    action: str | None = None,
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_AUDIT_LOGS)),
):
    """统计近 N 天 OperationLog 数量（按 action 过滤）。"""
    cutoff = utcnow() - timedelta(days=days)
    q = select(func.count()).select_from(OperationLog).where(OperationLog.created_at >= cutoff)
    if action:
        q = q.where(OperationLog.action == action)
    total = (await db.execute(q)).scalar_one()
    return Response.ok({"total": total})


@router.get("/assignment-rollbacks/{batch_id}")
async def preview_assignment_rollback(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_ASSIGNMENT_ROLLBACK)),
):
    """预览某个分配批次可回滚的学生。"""
    batch_id = batch_id.strip()
    if not batch_id:
        return Response.error(code=1, msg="batch_id不能为空")
    return Response.ok(await _build_assignment_rollback_plan(db, batch_id))


@router.post("/assignment-rollbacks/{batch_id}")
async def rollback_assignment_batch(
    batch_id: str,
    body: AssignmentRollbackReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_ASSIGNMENT_ROLLBACK)),
):
    """按批次撤销分配：仅回滚当前分配仍与该批次一致的学生。"""
    batch_id = batch_id.strip()
    if not batch_id:
        return Response.error(code=1, msg="batch_id不能为空")
    if not body.confirm:
        return Response.error(code=1, msg="请确认后再执行回滚")

    logs_r = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action.in_(ASSIGNMENT_ROLLBACK_ACTIONS),
            OperationLog.target_student_id.is_not(None),
        )
        .order_by(OperationLog.id.asc())
    )
    logs = logs_r.scalars().all()
    if not logs:
        return Response.error(code=1, msg="未找到可回滚的分配批次")

    student_ids = [log.target_student_id for log in logs if log.target_student_id is not None]
    students_r = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    students_by_id = {student.id: student for student in students_r.scalars().all()}

    rolled_back = 0
    skipped = 0
    for log in logs:
        payload = parse_assignment_rollback_note(log.note_content or "")
        student = students_by_id.get(log.target_student_id)
        if (
            payload is None
            or student is None
            or student.assigned_to != payload.get("new_assigned_to")
        ):
            skipped += 1
            continue

        old_assigned_to = payload.get("old_assigned_to")
        old_assigned_at = _parse_assignment_dt(payload.get("old_assigned_at"))
        current_assigned_to = student.assigned_to
        student.assigned_to = old_assigned_to
        student.assigned_at = old_assigned_at
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                action="分配回滚",
                content=(
                    f"回滚批次 {batch_id}："
                    f"{assignment_state_label(current_assigned_to)} → "
                    f"{assignment_state_label(old_assigned_to)}"
                ),
                old_status=assignment_state_label(current_assigned_to),
                new_status=assignment_state_label(old_assigned_to),
                batch_id=batch_id,
            )
        )
        rolled_back += 1

    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="分配回滚汇总",
            content=f"回滚分配批次 {batch_id}，成功 {rolled_back} 条，跳过 {skipped} 条",
            batch_id=batch_id,
        )
    )
    await db.commit()
    return Response.ok(
        {
            "batch_id": batch_id,
            "rolled_back_count": rolled_back,
            "skipped_count": skipped,
        }
    )


class ErrorReport(BaseModel):
    type: str
    message: str
    stack: str = ""
    url: str = ""
    user_agent: str = ""


@router.post("/error-report")
async def report_frontend_error(
    body: ErrorReport,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """接收前端错误报告，记录到 OperationLog。"""
    content = f"[{body.type}] {body.message}"
    if body.stack:
        content += f"\n{body.stack[:500]}"
    if body.url:
        content += f"\nURL: {body.url}"

    db.add(
        OperationLog(
            operator_id=current_user.id,
            operator_name=current_user.name,
            action="前端错误",
            content=content[:1000],
        )
    )
    await db.commit()
    return Response.ok({"msg": "已记录"})
