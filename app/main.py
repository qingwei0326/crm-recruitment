import asyncio
import logging
import os
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from sqlalchemy import text

from app.backup import backup_scheduler, do_backup_async
from app.config import CORS_ORIGINS
from app.database import async_session, init_db
from app.domain_errors import DomainError
from app.limiter import limiter
from app.routers import (
    admin,
    admin_assignment,
    admin_assignment_review,
    admin_assistant,
    admin_config,
    admin_daily,
    admin_governance,
    admin_handover,
    admin_invalid,
    admin_misc,
    admin_season_archive,
    admin_smart_assignment,
    admin_stale,
    admin_users,
    admissions,
    admissions_campus_visits,
    admissions_enrollments,
    admissions_home_visits,
    admissions_work_items,
    auth,
    calls,
    follow_ups,
    lead_outcomes,
    notes,
    operation_logs,
    personal_groups,
    stats,
    stats_agents,
    stats_dashboard,
    stats_enrollment,
    students,
    students_assignment,
    students_enrollment,
    students_import,
    students_phone,
    students_query,
    tasks,
    visits,
)
from app.scheduler import (
    follow_up_reminder_scheduler,
    notification_retry_scheduler,
)

logger = logging.getLogger("crm.health")

FRONTEND_DIR = os.getenv(
    "FRONTEND_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist"),
)
NO_STORE_HEADERS = {
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
}


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Startup backup + background scheduler
    await do_backup_async()
    backup_task = asyncio.create_task(backup_scheduler())
    follow_up_task = asyncio.create_task(follow_up_reminder_scheduler())
    retry_task = asyncio.create_task(notification_retry_scheduler())
    yield
    for task in (backup_task, follow_up_task, retry_task):
        task.cancel()
    for task in (backup_task, follow_up_task, retry_task):
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="招生话务CRM系统", version="1.0.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


async def _domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.http_status,
        content={"code": exc.code, "data": None, "msg": exc.message},
    )


app.add_exception_handler(DomainError, _domain_error_handler)


async def _http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
    """把 126 处 raise HTTPException 的 {"detail": ...} 收敛成项目信封 {code,data,msg}。

    保留 detail 字段做兼容：前端 utils.getApiErrorMessage 与既有测试都读它。
    前端 api.js 也靠 detail 区分这类响应与 Response.error（HTTP 4xx、无 detail）的业务失败信封。
    """
    detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content={"code": exc.status_code, "data": None, "msg": detail, "detail": detail},
        headers=getattr(exc, "headers", None),
    )


app.add_exception_handler(HTTPException, _http_exception_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    # 显式枚举：避免 "*" 与 allow_credentials 组合带来的安全盲区。
    # 新增方法/头时主动来这里加一行，等于强制 code review 一次。
    allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
    max_age=600,  # 预检结果缓存 10 分钟，减少 OPTIONS 请求
)

app.include_router(auth.router)
app.include_router(auth.api_router)
# Student subrouters with static/specific paths must be registered before
# generic /{student_id} routes to avoid path shadowing.
app.include_router(students_assignment.router)
app.include_router(students_enrollment.router)
app.include_router(students_import.router)
app.include_router(students_phone.router)
app.include_router(students_query.router)
app.include_router(students.router)
app.include_router(calls.router)
app.include_router(notes.router)
app.include_router(follow_ups.router)
app.include_router(lead_outcomes.router)
app.include_router(personal_groups.router)
app.include_router(personal_groups.admin_router)
app.include_router(stats.router)
app.include_router(stats_agents.router)
app.include_router(stats_enrollment.router)
app.include_router(stats_dashboard.router)
app.include_router(tasks.router)
app.include_router(admin.router)
app.include_router(admin_assistant.router)
app.include_router(admin_config.router)
app.include_router(admin_governance.router)
app.include_router(admin_handover.router)
app.include_router(admin_daily.router)
app.include_router(admin_assignment.router)
app.include_router(admin_assignment_review.router)
app.include_router(admin_smart_assignment.router)
app.include_router(admin_season_archive.router)
app.include_router(admin_invalid.router)
app.include_router(admin_misc.router)
app.include_router(admin_stale.router)
app.include_router(admin_users.router)
app.include_router(admissions.router)
app.include_router(admissions_work_items.router)
app.include_router(admissions_home_visits.router)
app.include_router(admissions_campus_visits.router)
app.include_router(admissions_enrollments.router)
app.include_router(visits.router)
app.include_router(operation_logs.router)


@app.get("/api/health")
async def health():
    start = time.monotonic()
    try:
        async with async_session() as session:
            await session.execute(text("SELECT 1"))
        db_ms = round((time.monotonic() - start) * 1000)
        return {"code": 0, "msg": "ok", "db": "ok", "db_ms": db_ms}
    except Exception:
        # 异常原文可能带 DSN / 数据库文件路径，只写日志，对外返回固定文案。
        logger.exception("健康检查：数据库探测失败")
        return {"code": 1, "msg": "database error", "db": "error"}


def _resolve_spa_path(path: str) -> str | None:
    """将请求路径约束在 FRONTEND_DIR 内部，防止 ``/..%2F..%2F.env`` 类路径穿越。

    返回绝对安全路径；若解析后越出 FRONTEND_DIR（含符号链接逃逸），返回 ``None``。
    """
    base_dir = os.path.realpath(FRONTEND_DIR)
    requested = os.path.realpath(os.path.join(base_dir, path))
    if requested != base_dir and not requested.startswith(base_dir + os.sep):
        return None
    return requested


# Serve frontend static in production
if os.path.isdir(FRONTEND_DIR):
    _assets = os.path.join(FRONTEND_DIR, "assets")
    if os.path.isdir(_assets):
        app.mount("/assets", StaticFiles(directory=_assets), name="assets")

    @app.get("/{path:path}")
    async def spa_fallback(path: str):
        if path.startswith("api/"):
            from fastapi import HTTPException

            raise HTTPException(status_code=404)
        # Path-traversal guard: resolve symlinks/``..`` and confine to FRONTEND_DIR.
        requested = _resolve_spa_path(path)
        if requested is None:
            from fastapi import HTTPException

            raise HTTPException(status_code=404)
        if os.path.isfile(requested):
            headers = NO_STORE_HEADERS if os.path.basename(requested) == "index.html" else None
            return FileResponse(requested, headers=headers)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), headers=NO_STORE_HEADERS)

    @app.get("/")
    async def root():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"), headers=NO_STORE_HEADERS)
else:

    @app.get("/")
    async def root():
        return {"code": 0, "msg": "招生话务CRM系统运行中"}
