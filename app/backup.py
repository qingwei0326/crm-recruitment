import asyncio
import base64
import hashlib
import logging
import os
import random
import re
import sqlite3
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.config import DB_PATH

BACKUP_ENCRYPTION_KEY = os.getenv("BACKUP_ENCRYPTION_KEY", "")
BACKUP_REMOTE_UPLOAD = os.getenv(
    "BACKUP_REMOTE_UPLOAD", ""
)  # e.g. "s3://bucket/path" or "scp://user@host:/path"
BACKUP_REMOTE_SCRIPT = os.getenv("BACKUP_REMOTE_SCRIPT", "")  # custom script path

logger = logging.getLogger("backup")

# 旧版备份用的是自造 XOR 流密码：SQLite 文件头是已知明文，密钥流可直接还原，
# 等同于没加密。这类文件无法用 Fernet 解开，属预期行为，给出明确提示而不是崩栈。
LEGACY_XOR_BACKUP_HINT = (
    "该 .enc 备份由旧版 XOR 算法生成，无法解密；"
    "请用生成它的旧版本程序还原，或直接改用未加密的历史备份文件。"
)


def _backup_fernet(key: str) -> Fernet:
    """由 BACKUP_ENCRYPTION_KEY 派生 Fernet 密钥（AES-256-CBC + HMAC-SHA256）。"""
    digest = hashlib.sha256(f"crm-backup:{key}".encode()).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def _encrypt_file(src: str, dst: str, key: str) -> None:
    """Encrypt a backup file with Fernet (AES-256-CBC + HMAC-SHA256)."""
    with open(src, "rb") as f_in:
        payload = f_in.read()
    with open(dst, "wb") as f_out:
        f_out.write(_backup_fernet(key).encrypt(payload))


def decrypt_backup_file(src: str, dst: str, key: str) -> None:
    """Decrypt a Fernet-encrypted backup. 旧 XOR 备份会抛出明确的 ValueError。"""
    with open(src, "rb") as f_in:
        payload = f_in.read()
    try:
        plaintext = _backup_fernet(key).decrypt(payload)
    except InvalidToken as exc:
        raise ValueError(LEGACY_XOR_BACKUP_HINT) from exc
    with open(dst, "wb") as f_out:
        f_out.write(plaintext)


def _warn_plaintext_backup(dest: str) -> None:
    logger.warning(
        "BACKUP_ENCRYPTION_KEY 未配置：备份文件 %s 以明文落盘，"
        "数据库泄露即等于全量数据泄露。请配置 BACKUP_ENCRYPTION_KEY 后重新备份。",
        dest,
    )


def _upload_remote(filepath: str) -> None:
    """Upload backup to remote storage using configured method."""
    if not BACKUP_REMOTE_UPLOAD and not BACKUP_REMOTE_SCRIPT:
        return

    if BACKUP_REMOTE_SCRIPT:
        try:
            subprocess.run(
                [BACKUP_REMOTE_SCRIPT, filepath],
                capture_output=True,
                timeout=120,
                check=True,
            )
            logger.info("Remote upload via script: %s", filepath)
        except Exception as e:
            logger.error("Remote script upload failed: %s", e)
        return

    # Parse URL scheme
    url = BACKUP_REMOTE_UPLOAD
    if url.startswith("s3://"):
        try:
            subprocess.run(
                ["aws", "s3", "cp", filepath, url],
                capture_output=True,
                timeout=300,
                check=True,
            )
            logger.info("Uploaded to S3: %s", url)
        except Exception as e:
            logger.error("S3 upload failed: %s", e)
    elif url.startswith("scp://") or url.startswith("rsync://"):
        # Parse scp://user@host:/path
        target = url.replace("scp://", "").replace("rsync://", "")
        try:
            subprocess.run(
                ["scp", filepath, target],
                capture_output=True,
                timeout=300,
                check=True,
            )
            logger.info("Uploaded via SCP: %s", target)
        except Exception as e:
            logger.error("SCP upload failed: %s", e)


BACKUP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "backups")

# Which automatic backups to keep: the newest few, then the newest one of each recent
# day and week. A backup runs every 6 hours and at every start, so keeping a fixed
# number of files (it used to be 7) covered less than two days.
KEEP_RECENT = int(os.getenv("BACKUP_KEEP_RECENT", "4"))
KEEP_DAILY = int(os.getenv("BACKUP_KEEP_DAILY", "14"))
KEEP_WEEKLY = int(os.getenv("BACKUP_KEEP_WEEKLY", "8"))
KEEP_PRE_MIGRATION = 5
# The most files the policy can keep; the ops page shows it next to the count.
MAX_BACKUPS = KEEP_RECENT + KEEP_DAILY + KEEP_WEEKLY + KEEP_PRE_MIGRATION
# A container that fails to start restarts every few seconds. Reusing a recent
# pre-migration backup keeps the first, clean copy instead of adding one per restart.
PRE_MIGRATION_MIN_INTERVAL = timedelta(hours=6)

_STAMP_FORMAT = "%Y%m%d_%H%M%S"
_SCHEDULED_NAME = re.compile(r"^crm_(\d{8}_\d{6})$")
_PRE_MIGRATION_NAME = re.compile(r"^crm_before_(.+)_(\d{8}_\d{6})$")


def _get_backup_extension():
    """备份文件扩展名（系统只支持 SQLite）。"""
    return ".db"


def _backup_stem(filename: str) -> str | None:
    """'crm_20261114_120000.db.enc' -> 'crm_20261114_120000'; None for other files."""
    ext = _get_backup_extension()
    for suffix in (f"{ext}.enc", ext):
        if filename.endswith(suffix):
            return filename[: -len(suffix)]
    return None


def _parse_stamp(value: str) -> datetime | None:
    try:
        return datetime.strptime(value, _STAMP_FORMAT)
    except ValueError:
        return None


def _sqlite_backup_is_sound(path: str) -> bool:
    try:
        # immutable: read the copy as it is, without creating -wal/-shm files beside it.
        uri = Path(path).resolve().as_uri() + "?mode=ro&immutable=1"
        conn = sqlite3.connect(uri, uri=True)
        try:
            return conn.execute("PRAGMA quick_check").fetchone()[0] == "ok"
        finally:
            conn.close()
    except sqlite3.Error:
        return False


def _backup_sqlite(stem: str):
    """Hot-copy DB via SQLite backup API, check the copy, then prune old backups."""
    if not DB_PATH or DB_PATH == ":memory:":
        logger.warning("Skipping backup: in-memory or empty database path")
        return None
    if not os.path.isfile(DB_PATH):
        logger.warning(f"Database not found: {DB_PATH}")
        return None

    os.makedirs(BACKUP_DIR, exist_ok=True)

    dest = os.path.join(BACKUP_DIR, stem + _get_backup_extension())

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
        return None
    if not _sqlite_backup_is_sound(dest):
        # A damaged copy must not count as a backup or push good ones out.
        logger.error("Backup failed its integrity check and was removed: %s", dest)
        try:
            os.remove(dest)
        except OSError:
            pass
        return None

    logger.info(f"Backup created: {dest}")

    # Optional encryption
    if BACKUP_ENCRYPTION_KEY:
        enc_dest = dest + ".enc"
        try:
            _encrypt_file(dest, enc_dest, BACKUP_ENCRYPTION_KEY)
            os.remove(dest)
            dest = enc_dest
            logger.info("Backup encrypted: %s", dest)
        except Exception as e:
            logger.error("Encryption failed: %s", e)
    else:
        _warn_plaintext_backup(dest)

    # Optional remote upload
    _upload_remote(dest)

    _prune_old_backups()
    return dest


def backups_to_delete(filenames: list[str]) -> list[str]:
    """The automatic backups the retention policy no longer needs.

    Files it cannot date, such as manual copies and pre-release backups, are never
    returned.
    """
    scheduled: list[tuple[datetime, str]] = []
    pre_migration: list[tuple[datetime, str]] = []
    for name in filenames:
        stem = _backup_stem(name) or ""
        if match := _SCHEDULED_NAME.match(stem):
            stamp, group = _parse_stamp(match.group(1)), scheduled
        elif match := _PRE_MIGRATION_NAME.match(stem):
            stamp, group = _parse_stamp(match.group(2)), pre_migration
        else:
            continue
        if stamp is not None:
            group.append((stamp, name))
    scheduled.sort(reverse=True)
    pre_migration.sort(reverse=True)

    keep = {name for _, name in scheduled[:KEEP_RECENT]}
    keep |= {name for _, name in pre_migration[:KEEP_PRE_MIGRATION]}
    for limit, period_of in (
        (KEEP_DAILY, lambda stamp: stamp.date()),
        (KEEP_WEEKLY, lambda stamp: tuple(stamp.isocalendar())[:2]),
    ):
        periods: set = set()
        # Newest first, so the first backup seen in a period is its newest.
        for stamp, name in scheduled:
            period = period_of(stamp)
            if period in periods:
                continue
            if len(periods) == limit:
                break
            periods.add(period)
            keep.add(name)
    return [name for _, name in scheduled + pre_migration if name not in keep]


def _prune_old_backups():
    """Delete the automatic backups the retention policy no longer needs."""
    for old in backups_to_delete(os.listdir(BACKUP_DIR)):
        try:
            os.remove(os.path.join(BACKUP_DIR, old))
            logger.info(f"Removed old backup: {old}")
        except OSError as e:
            logger.warning(f"Could not remove old backup {old}: {e}")


def do_backup(stem: str | None = None):
    """备份 SQLite 数据库。``stem`` 是不带扩展名的文件名，默认按当前时间命名。"""
    stem = stem or f"crm_{datetime.now().strftime(_STAMP_FORMAT)}"
    return _backup_sqlite(stem)


def backup_before_migration(from_revision: str) -> str | None:
    """Back up before a schema upgrade from ``from_revision``; None if the backup failed.

    A backup of the same revision made within PRE_MIGRATION_MIN_INTERVAL is reused.
    """
    revision = re.sub(r"[^A-Za-z0-9_]", "_", from_revision)
    now = datetime.now()
    if os.path.isdir(BACKUP_DIR):
        for name in os.listdir(BACKUP_DIR):
            match = _PRE_MIGRATION_NAME.match(_backup_stem(name) or "")
            if not match or match.group(1) != revision:
                continue
            stamp = _parse_stamp(match.group(2))
            if stamp is not None and now - stamp < PRE_MIGRATION_MIN_INTERVAL:
                return os.path.join(BACKUP_DIR, name)
    return do_backup(f"crm_before_{revision}_{now.strftime(_STAMP_FORMAT)}")


async def do_backup_async():
    """Async wrapper for do_backup using thread pool to avoid blocking the event loop."""
    return await asyncio.to_thread(do_backup)


async def backup_scheduler():
    """Run backup every 6 hours."""
    while True:
        try:
            await do_backup_async()
        except Exception as e:
            logger.error(f"Backup failed: {e}")
        await asyncio.sleep(6 * 3600 + random.uniform(0, 600))
