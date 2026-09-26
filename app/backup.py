import asyncio
import base64
import hashlib
import logging
import os
import random
import sqlite3
import subprocess
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from cryptography.fernet import Fernet, InvalidToken

from app.config import DATABASE_URL, DB_ENGINE, DB_PATH

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
            "-h",
            host,
            "-p",
            port,
            "-U",
            user,
            "-d",
            dbname,
            "-Fc",  # custom format，可 pg_restore
            "-f",
            dest,
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


def _backup_sqlite():
    """Hot-copy DB via SQLite backup API. Keeps last MAX_BACKUPS files."""
    if not DB_PATH or DB_PATH == ":memory:":
        logger.warning("Skipping backup: in-memory or empty database path")
        return None
    if not os.path.isfile(DB_PATH):
        logger.warning(f"Database not found: {DB_PATH}")
        return None

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


def _prune_old_backups():
    """保留最近 MAX_BACKUPS 个备份文件，删除更早的。"""
    ext = _get_backup_extension()
    files = sorted(
        [
            f
            for f in os.listdir(BACKUP_DIR)
            if f.startswith("crm_") and (f.endswith(ext) or f.endswith(f"{ext}.enc"))
        ],
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
        return _backup_postgresql()
    return _backup_sqlite()


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
