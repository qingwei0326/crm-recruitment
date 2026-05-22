import asyncio
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.backup import backup_scheduler, do_backup_async
from app.config import CORS_ORIGINS
from app.database import init_db
from app.routers import (
    admin,
    auth,
    calls,
    follow_ups,
    notes,
    operation_logs,
    stats,
    students,
    tasks,
    visits,
)
from app.scheduler import follow_up_reminder_scheduler

FRONTEND_DIR = os.getenv(
    "FRONTEND_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist"),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    # Startup backup + background scheduler
    await do_backup_async()
    backup_task = asyncio.create_task(backup_scheduler())
    follow_up_task = asyncio.create_task(follow_up_reminder_scheduler())
    yield
    for task in (backup_task, follow_up_task):
        task.cancel()
    for task in (backup_task, follow_up_task):
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="招生话务CRM系统", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(auth.api_router)
app.include_router(students.router)
app.include_router(calls.router)
app.include_router(notes.router)
app.include_router(follow_ups.router)
app.include_router(stats.router)
app.include_router(tasks.router)
app.include_router(admin.router)
app.include_router(visits.router)
app.include_router(operation_logs.router)


@app.get("/api/health")
async def health():
    return {"code": 0, "msg": "ok"}


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
        file_path = os.path.join(FRONTEND_DIR, path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))

    @app.get("/")
    async def root():
        return FileResponse(os.path.join(FRONTEND_DIR, "index.html"))
else:

    @app.get("/")
    async def root():
        return {"code": 0, "msg": "招生话务CRM系统运行中"}
