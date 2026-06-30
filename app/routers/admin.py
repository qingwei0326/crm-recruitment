import os
import re
import secrets
import time
from datetime import datetime, timedelta
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agent_score import score_agent_work
from app.auth import (
    get_current_user,
    hash_password,
    invalidate_user_tokens,
    require_admin,
    require_super_admin,
)
from app.backup import BACKUP_DIR, MAX_BACKUPS, _get_backup_extension, do_backup_async
from app.database import get_db
from app.expiry import build_last_activity_subquery
from app.models import (
    Call,
    DialLog,
    FollowUp,
    IntentLevel,
    LeadViewLog,
    Note,
    OperationLog,
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
from app.utils import make_operation_log, mask_phone, today_cst_as_utc, utcnow

router = APIRouter(prefix="/api/admin", tags=["管理"])
SCORE_DAILY_CALL_TARGET_MAX = 1000


class UserCreateReq(BaseModel):
    username: str
    password: str
    name: str
    role: Literal["admin", "agent"] = "agent"
    is_super_admin: bool = False
    service_regions: str = ""


class UserUpdateReq(BaseModel):
    name: str | None = None
    role: Literal["admin", "agent"] | None = None
    is_active: bool | None = None
    is_super_admin: bool | None = None
    password: str | None = None
    service_regions: str | None = None


class ConfigUpdateReq(BaseModel):
    key: str
    value: str


INVALID_REASON_LABELS = {
    "高分段",
    "无意向",
    "孩子不想读",
    "空号",
    "其他",
}


ALLOWED_CONFIG_KEYS = {
    "pushplus_token",
    "stale_days",
    "dial_window_start",
    "dial_window_end",
    "dial_max_per_24h",
    "deepseek_api_key",
    "ai_provider",
    "mimo_api_key",
    "mimo_base",
    "mimo_model",
    "ai_custom_api_key",
    "ai_custom_base",
    "ai_custom_model",
    "follow_up_window_minutes",
    "score_daily_call_target",
}


def invalid_reason_predicate(reason: str):
    reason = (reason or "").strip()
    if not reason:
        return None
    if reason not in INVALID_REASON_LABELS:
        return None
    stored_statuses = [
        status
        for status in statuses_for_canonical(StudentStatus.invalid)
        if status_detail_value(status, "") == reason
    ]
    clauses = [Student.status_detail == reason]
    if stored_statuses:
        clauses.append(Student.status.in_(stored_statuses))
    return clauses[0] if len(clauses) == 1 else clauses[0] | clauses[1]


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


_AI_PROVIDERS = {"deepseek", "mimo", "custom"}
_AI_BASE_KEYS = {"mimo_base", "ai_custom_base"}
_AI_MODEL_KEYS = {"mimo_model", "ai_custom_model"}
_AI_GENERIC_KEY_KEYS = {"mimo_api_key", "ai_custom_api_key"}

_HHMM_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _validate_config_value(key: str, value: str) -> tuple[str | None, str | None]:
    """Returns (normalized_value, error_msg). 任一字段在前端都能改，必须独立校验。"""
    if key == "stale_days":
        try:
            n = int(value)
        except ValueError:
            return None, "stale_days must be an integer between 1 and 30"
        if not 1 <= n <= 30:
            return None, "stale_days must be an integer between 1 and 30"
        return str(n), None
    if key == "follow_up_window_minutes":
        try:
            n = int(value)
        except ValueError:
            return None, "follow_up_window_minutes must be an integer between 1 and 60"
        if not 1 <= n <= 60:
            return None, "follow_up_window_minutes must be an integer between 1 and 60"
        return str(n), None
    if key == "dial_max_per_24h":
        try:
            n = int(value)
        except ValueError:
            return None, "dial_max_per_24h must be an integer between 1 and 20"
        if not 1 <= n <= 20:
            return None, "dial_max_per_24h must be an integer between 1 and 20"
        return str(n), None
    if key == "score_daily_call_target":
        score_target_msg = (
            "score_daily_call_target must be an integer between 1 and "
            f"{SCORE_DAILY_CALL_TARGET_MAX}"
        )
        try:
            n = int(value)
        except ValueError:
            return None, score_target_msg
        if not 1 <= n <= SCORE_DAILY_CALL_TARGET_MAX:
            return None, score_target_msg
        return str(n), None
    if key in ("dial_window_start", "dial_window_end"):
        if not _HHMM_RE.match(value):
            return None, f"{key} must be HH:MM (24h)"
        return value, None
    if key == "pushplus_token":
        if len(value) > 64:
            return None, "pushplus_token too long"
        return value, None
    if key == "deepseek_api_key":
        if value and len(value) > 128:
            return None, "deepseek_api_key too long"
        # 接受空串（用于清除）；非空必须形如 sk-xxx 避免误填
        if value and not value.startswith("sk-"):
            return None, "deepseek_api_key 必须以 sk- 开头"
        return value, None
    if key == "ai_provider":
        if value and value not in _AI_PROVIDERS:
            return None, "ai_provider 必须是 deepseek / mimo / custom 之一"
        return (value or "deepseek"), None
    if key in _AI_BASE_KEYS:
        if value and not (value.startswith("http://") or value.startswith("https://")):
            return None, f"{key} 必须是 http(s):// 开头的接口地址"
        if len(value) > 256:
            return None, f"{key} too long"
        return value, None
    if key in _AI_MODEL_KEYS:
        if len(value) > 64:
            return None, f"{key} too long"
        return value, None
    if key in _AI_GENERIC_KEY_KEYS:
        # MiMo / 自定义 的 key 不强制 sk- 前缀，只做长度上限
        if len(value) > 256:
            return None, f"{key} too long"
        return value, None
    return value, None


def to_datetime(value):
    if value is None or isinstance(value, datetime):
        return value
    if isinstance(value, str):
        return datetime.fromisoformat(value)
    return value


def mask_config_value(key: str, value: str) -> str:
    if (
        key in ("pushplus_token", "deepseek_api_key", "mimo_api_key", "ai_custom_api_key")
        and len(value) > 4
    ):
        return "****" + value[-4:]
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

    normalized, err = _validate_config_value(key, value)
    if err:
        return Response.error(code=1, msg=err)
    value = normalized

    result = await db.execute(select(SystemConfig).where(SystemConfig.key == key))
    item = result.scalar_one_or_none()
    if item:
        item.value = value
    else:
        item = SystemConfig(key=key, value=value)
        db.add(item)
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
    current_user: User = Depends(require_admin),
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
    current_user: User = Depends(require_admin),
):
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
    current_user: User = Depends(require_admin),
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
    current_user: User = Depends(require_admin),
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
    current_user: User = Depends(require_admin),
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
    total_leads = sum(counts.values())

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
        .where(Student.assigned_to == agent_id, Student.status.in_(ACTIVE_TASK_STATUSES))
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
    current_user: User = Depends(require_super_admin),
):
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        return Response.error(code=1, msg=f"用户名 {body.username} 已存在")
    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        name=body.name,
        role=UserRole(body.role),
        service_regions=body.service_regions,
        is_active=True,
        is_super_admin=body.role == "admin" and body.is_super_admin,
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
        }
    )


@router.put("/users/{user_id}")
async def update_user(
    user_id: int,
    body: UserUpdateReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")

    changes = []
    if body.name is not None and body.name != user.name:
        changes.append(f"姓名 {user.name}→{body.name}")
        user.name = body.name
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
    if body.is_super_admin is not None and body.is_super_admin != user.is_super_admin:
        if body.is_super_admin and user.role != UserRole.admin:
            return Response.error(code=1, msg="只有管理员账号可以设为超级管理员")
        if not body.is_super_admin and user.is_super_admin and user.is_active:
            if await count_active_super_admins(db) <= 1:
                return Response.error(code=1, msg="系统至少需要保留一个超级管理员")
        user.is_super_admin = body.is_super_admin
        changes.append("设为超级管理员" if body.is_super_admin else "取消超级管理员")
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
        }
    )


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    if user_id == current_user.id:
        return Response.error(code=1, msg="不能删除自己")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
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
            content=f"删除{user.role} {user.username}({user.name})，非终态学生已重置并回收至池",
        )
    )
    await db.delete(user)
    await db.commit()
    return Response.ok(msg="已删除，该话务员的学生已回收至池")


@router.post("/users/{user_id}/offboard")
async def offboard_user(
    user_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
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
    current_user: User = Depends(require_super_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
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
    current_user: User = Depends(require_super_admin),
):
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        return Response.error(code=1, msg="用户不存在")
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


@router.get("/invalid-students")
async def list_invalid_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    school_name: str | None = Query(None),
    invalid_reason: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """列出所有标记为无效的线索，用于回收和重新分配"""
    invalid_statuses = statuses_for_canonical(StudentStatus.invalid)
    where = [Student.status.in_(invalid_statuses)]
    if school_name:
        where.append(Student.school_name == school_name)
    reason_clause = invalid_reason_predicate(invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)

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
                OperationLog.target_student_id, OperationLog.note_content, OperationLog.created_at
            )
            .where(
                OperationLog.target_student_id.in_(student_ids),
                OperationLog.action == "修改状态",
                OperationLog.new_status == "无效",
            )
            .order_by(OperationLog.created_at.desc())
        )
        for sid, reason, _ in logs_result.all():
            if sid not in invalid_reasons and reason:
                invalid_reasons[sid] = reason

    data = [
        {
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "school_name": s.school_name,
            "guardian_phone": mask_phone(s.guardian_phone),
            "assigned_to": s.assigned_to,
            "agent_name": agent_name or "未分配",
            "status": canonical_status_value(s.status),
            "status_detail": status_detail_value(s.status, s.status_detail),
            "invalid_reason": status_detail_value(s.status, s.status_detail)
            or invalid_reasons.get(s.id, ""),
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
    current_user: User = Depends(require_admin),
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
    current_user: User = Depends(require_admin),
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
    current_user: User = Depends(require_super_admin),
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
    current_user: User = Depends(require_admin),
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
    current_user: User = Depends(require_super_admin),
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
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """按学校聚合无效线索数量"""
    where = [Student.status.in_(statuses_for_canonical(StudentStatus.invalid))]
    reason_clause = invalid_reason_predicate(invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
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
    current_user: User = Depends(require_admin),
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
    current_user: User = Depends(require_admin),
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
    distribution: dict[str, int] = {}

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
            load[agent_id] += 1
            distribution[agent_map[agent_id].name] += 1

    for s in students:
        db.add(
            OperationLog(
                operator_id=current_user.id,
                operator_name=current_user.name,
                target_student_id=s.id,
                case_no=s.case_no or "",
                action="多学校分发",
                content=f"从学校「{s.school_name}」分发给话务员",
            )
        )

    await db.commit()
    return Response.ok(
        {
            "distributed_count": len(students),
            "distribution": distribution,
            "schools": body.school_names,
        }
    )


@router.get("/operation-logs")
async def count_operation_logs(
    action: str | None = None,
    days: int = 7,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """统计近 N 天 OperationLog 数量（按 action 过滤）。"""
    cutoff = utcnow() - timedelta(days=days)
    q = select(func.count()).select_from(OperationLog).where(OperationLog.created_at >= cutoff)
    if action:
        q = q.where(OperationLog.action == action)
    total = (await db.execute(q)).scalar_one()
    return Response.ok({"total": total})


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
