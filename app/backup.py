import asyncio
import logging
import os
import random
import shutil
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from app.config import DB_ENGINE, DATABASE_URL, DB_PATH

logger = logging.getLogger("backup")

BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backups")
MAX_BACKUPS = 7


def _get_backup_extension():
    """返回当前数据库引擎对应的备份文件扩展名。"""
    return ".dump" if DB_ENGINE == "postgresql" else ".db"


def _backup_postgresql():
    """使用 pg_dump 备份 PostgreSQL 数据库。"""
    os.makedirs(BACKUP_DIR, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    ext = _get_backup_extension()
    dest = os.path.join(BACKUP_DIR, f"crm_{ts}{ext}")

    # 从 DATABASE_URL 解析连接参数
    # 格式: postgresql+asyncpg://user:pass@host:5432/dbname
    url = DATABASE_URL
    # 移除驱动后缀以解析
    for suffix in ("+asyncpg", "+psycopg2", "+psycopg"):
        url = url.replace(suffix, "")
    parsed = urlparse(url)

    host = parsed.hostname or "localhost"
    port = str(parsed.port or 5432)
    user = parsed.username or ""
    dbname = parsed.path.lstrip("/") or ""
    password = parsed.password or ""

    env = os.environ.copy()
    if password:
        env["PGPASSWORD"] = password

    try:
        cmd = [
            "pg_dump",
            "-h", host,
            "-p", port,
            "-U", user,
            "-d", dbname,
            "-Fc",  # custom format，可 pg_restore
            "-f", dest,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env=env)
        if result.returncode != 0:
            logger.error(f"pg_dump failed (code {result.returncode}): {result.stderr}")
            if os.path.isfile(dest):
                os.remove(dest)
            return
    except FileNotFoundError:
        logger.error("pg_dump not found. Install PostgreSQL client tools.")
        return
    except subprocess.TimeoutExpired:
        logger.error("pg_dump timed out after 300s")
        if os.path.isfile(dest):
            os.remove(dest)
        return

    if not os.path.isfile(dest):
        return

    logger.info(f"Backup created: {dest}")
    _prune_old_backups()


def _backup_sqlite():
    """Hot-copy DB via SQLite backup API. Keeps last MAX_BACKUPS files."""
    if not DB_PATH or DB_PATH == ":memory:":
        logger.warning("Skipping backup: in-memory or empty database path")
        return
    if not os.path.isfile(DB_PATH):
        logger.warning(f"Database not found: {DB_PATH}")
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    ext = _get_backup_extension()
    dest = os.path.join(BACKUP_DIR, f"crm_{ts}{ext}")

    src_uri = Path(DB_PATH).resolve().as_uri() + "?mode=ro"
    try:
        src = sqlite3.connect(src_uri, uri=True, timeout=60.0)
    except sqlite3.Error as e:
        logger.error(f"Backup open source failed: {e}")
        return

    try:
        dst = sqlite3.connect(dest, timeout=60.0)
        try:
            src.backup(dst)
        finally:
            dst.close()
    except sqlite3.Error as e:
        logger.error(f"Backup failed: {e}")
        if os.path.isfile(dest):
            try:
                os.remove(dest)
            except OSError:
                pass
    finally:
        src.close()

    if not os.path.isfile(dest):
        return

    logger.info(f"Backup created: {dest}")
    _prune_old_backups()


def _prune_old_backups():
    """保留最近 MAX_BACKUPS 个备份文件，删除更早的。"""
    ext = _get_backup_extension()
    files = sorted(
        [f for f in os.listdir(BACKUP_DIR) if f.startswith("crm_") and f.endswith(ext)],
        reverse=True,
    )
    for old in files[MAX_BACKUPS:]:
        try:
            os.remove(os.path.join(BACKUP_DIR, old))
            logger.info(f"Removed old backup: {old}")
        except OSError as e:
            logger.warning(f"Could not remove old backup {old}: {e}")


def do_backup():
    """根据数据库引擎选择备份方式。"""
    if DB_ENGINE == "postgresql":
        _backup_postgresql()
    else:
        _backup_sqlite()


async def do_backup_async():
    """Async wrapper for do_backup using thread pool to avoid blocking the event loop."""
    await asyncio.to_thread(do_backup)


async def backup_scheduler():
    """Run backup every 6 hours."""
    while True:
        try:
            await do_backup_async()
        except Exception as e:
            logger.error(f"Backup failed: {e}")
        await asyncio.sleep(6 * 3600 + random.uniform(0, 600))
