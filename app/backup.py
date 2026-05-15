import asyncio
import logging
import os
import sqlite3
from datetime import datetime
from pathlib import Path

from app.config import DB_PATH

logger = logging.getLogger("backup")

BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backups")
MAX_BACKUPS = 7


def do_backup():
    """Hot-copy DB via SQLite backup API. Keeps last MAX_BACKUPS files."""
    if not DB_PATH or DB_PATH == ":memory:":
        logger.warning("Skipping backup: in-memory or empty database path")
        return
    if not os.path.isfile(DB_PATH):
        logger.warning(f"Database not found: {DB_PATH}")
        return

    os.makedirs(BACKUP_DIR, exist_ok=True)

    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = os.path.join(BACKUP_DIR, f"crm_{ts}.db")

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

    files = sorted(
        [f for f in os.listdir(BACKUP_DIR) if f.startswith("crm_") and f.endswith(".db")],
        reverse=True,
    )
    for old in files[MAX_BACKUPS:]:
        try:
            os.remove(os.path.join(BACKUP_DIR, old))
            logger.info(f"Removed old backup: {old}")
        except OSError as e:
            logger.warning(f"Could not remove old backup {old}: {e}")


async def do_backup_async():
    """Async wrapper for do_backup using thread pool to avoid blocking the event loop."""
    await asyncio.to_thread(do_backup)


async def backup_scheduler():
    """Run backup every 6 hours."""
    while True:
        await asyncio.sleep(6 * 3600)
        try:
            await do_backup_async()
        except Exception as e:
            logger.error(f"Backup failed: {e}")
