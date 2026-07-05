import os
import time
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_ops_utils import backup_items
from app.auth import (
    require_admin,
)
from app.backup import BACKUP_DIR, MAX_BACKUPS
from app.database import get_db
from app.models import (
    FollowUp,
    OperationLog,
    Student,
    User,
    UserRole,
)
from app.routers.admin_config import get_config_value as get_config_value  # noqa: F401
from app.schemas import Response
from app.task_stats import ACTIVE_TASK_STATUSES
from app.utils import (
    today_cst_as_utc,
    utcnow,
)

router = APIRouter(prefix="/api/admin", tags=["管理"])


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
    backup_items_list = backup_items(BACKUP_DIR)
    latest_backup = backup_items_list[0] if backup_items_list else None
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
            "count": len(backup_items_list),
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
