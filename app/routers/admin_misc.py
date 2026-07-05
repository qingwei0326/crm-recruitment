import os
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_lead_utils import (
    _admin_student_search_payload,
    _latest_log_payload,
    _operation_log_search_predicate,
    _student_search_predicate,
)
from app.admin_ops_utils import backup_items
from app.auth import (
    ADMIN_PAGE_AUDIT_LOGS,
    ADMIN_PAGE_LEADS_MANAGE,
    get_current_user,
    require_admin,
    require_page_permission,
    require_super_admin,
)
from app.backup import BACKUP_DIR, _get_backup_extension, do_backup_async
from app.database import get_db
from app.models import OperationLog, Student, User
from app.schemas import Response
from app.utils import make_operation_log, utcnow

router = APIRouter(prefix="/api/admin", tags=["管理"])


class ErrorReport(BaseModel):
    type: str
    message: str
    stack: str = ""
    url: str = ""
    user_agent: str = ""


@router.get("/backups")
async def list_backups(
    current_user: User = Depends(require_super_admin),
):
    """列出已有备份文件。"""
    return Response.ok(backup_items())


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
