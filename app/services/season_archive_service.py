"""招生季导出、备份校验和清理。

招生系统按单招生季运行。该模块把年末动作固定为：先生成可下载导出和数据库备份，
再由超级管理员在数据指纹未变化的前提下执行一次性清理。
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import sqlite3
import tempfile
import zipfile
from datetime import date, datetime
from enum import Enum
from pathlib import Path
from typing import Any

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_ops_utils import backup_items
from app.backup import BACKUP_DIR, BACKUP_ENCRYPTION_KEY, do_backup_async
from app.config import DB_ENGINE
from app.domain_models import (
    HandoverItem,
    PersonalGroupMembership,
    StudentAssignment,
    WorkItem,
)
from app.models import (
    Call,
    CampusVisitTask,
    DialLog,
    EnrollmentRecord,
    FollowUp,
    HomeVisitTask,
    LeadViewLog,
    Note,
    OperationLog,
    Student,
    User,
    Visit,
)
from app.utils import make_batch_id, make_operation_log, utcnow

SEASON_ARCHIVE_DIR = os.path.join(BACKUP_DIR, "season-archives")
SEASON_ARCHIVE_PREFIX = "crm_season_"
SEASON_CONFIRM_TEXT = "清理本招生季"

# 这些表的 student_id 是直接关联；OperationLog 使用 target_student_id。
STUDENT_DATA_MODELS = (
    Call,
    Note,
    FollowUp,
    LeadViewLog,
    Visit,
    HomeVisitTask,
    CampusVisitTask,
    EnrollmentRecord,
    DialLog,
    StudentAssignment,
    WorkItem,
    HandoverItem,
    PersonalGroupMembership,
)

EXPORT_MODELS = (Student, *STUDENT_DATA_MODELS, OperationLog)


def _archive_path(name: str) -> str:
    if (
        not name.startswith(SEASON_ARCHIVE_PREFIX)
        or not name.endswith(".zip")
        or "/" in name
        or "\\" in name
        or ".." in name
    ):
        raise ValueError("非法的招生季导出文件名")
    root = os.path.realpath(SEASON_ARCHIVE_DIR)
    path = os.path.realpath(os.path.join(SEASON_ARCHIVE_DIR, name))
    if not path.startswith(root + os.sep):
        raise ValueError("非法的招生季导出路径")
    return path


def _json_value(value: Any) -> Any:
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def _row_payload(row: dict[str, Any]) -> dict[str, Any]:
    return {key: _json_value(value) for key, value in row.items()}


def _fingerprint_row(digest: Any, table_name: str, row: dict[str, Any]) -> None:
    payload = json.dumps(
        {"table": table_name, "row": _row_payload(row)},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )
    digest.update(payload.encode("utf-8"))
    digest.update(b"\n")


async def _season_data_fingerprint(db: AsyncSession) -> tuple[int, str]:
    digest = hashlib.sha256()
    count = 0
    student_result = await db.stream(
        select(Student.__table__).order_by(Student.id.asc())
    )
    async for row in student_result:
        _fingerprint_row(digest, Student.__tablename__, dict(row._mapping))
        count += 1
    for model in (*STUDENT_DATA_MODELS, OperationLog):
        query = select(model.__table__).order_by(model.id.asc())
        if model is not OperationLog:
            query = query.where(_student_predicate(model))
        else:
            query = query.where(
                OperationLog.target_student_id.in_(select(Student.id))
            )
        result = await db.stream(query)
        async for row in result:
            _fingerprint_row(digest, model.__tablename__, dict(row._mapping))
    return count, digest.hexdigest()


def _student_predicate(model):
    column = getattr(model, "student_id", None)
    if column is not None:
        return column.in_(select(Student.id))
    return OperationLog.target_student_id.in_(select(Student.id))


async def _relation_counts(db: AsyncSession) -> dict[str, int]:
    counts = {"students": int((await db.execute(select(func.count(Student.id)))).scalar_one())}
    for model in STUDENT_DATA_MODELS:
        counts[model.__tablename__] = int(
            (
                await db.execute(
                    select(func.count(model.id)).where(_student_predicate(model))
                )
            ).scalar_one()
        )
    counts["operation_logs"] = int(
        (
            await db.execute(
                select(func.count(OperationLog.id)).where(
                    OperationLog.target_student_id.in_(select(Student.id))
                )
            )
        ).scalar_one()
    )
    return counts


async def preview_current_season(db: AsyncSession) -> dict[str, Any]:
    student_count, student_id_hash = await _season_data_fingerprint(db)
    counts = await _relation_counts(db)
    items = backup_items(BACKUP_DIR)
    latest_backup = items[0] if items else None
    return {
        "student_count": student_count,
        "student_id_hash": student_id_hash,
        "counts": counts,
        "latest_backup": latest_backup,
        "archive_directory": SEASON_ARCHIVE_DIR,
        "confirm_text": SEASON_CONFIRM_TEXT,
        "ready": False,
    }


def _csv_text(rows: list[dict[str, Any]], fieldnames: list[str]) -> str:
    from io import StringIO

    output = StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow(
            {
                key: "" if row.get(key) is None else str(_json_value(row.get(key)))
                for key in fieldnames
            }
        )
    return output.getvalue()


async def _export_model(
    db: AsyncSession, model
) -> tuple[str, list[dict[str, Any]], list[str]]:
    query = select(model.__table__)
    if model is not Student:
        query = query.where(_student_predicate(model))
    result = await db.execute(query.order_by(model.id.asc()))
    rows = [_row_payload(dict(row)) for row in result.mappings().all()]
    fields = [column.name for column in model.__table__.columns]
    return model.__tablename__, rows, fields


async def create_season_export(
    db: AsyncSession,
    *,
    batch_id: str,
    backup_name: str,
    backup_sha256: str,
    counts: dict[str, int],
    student_count: int,
    student_id_hash: str,
) -> dict[str, Any]:
    os.makedirs(SEASON_ARCHIVE_DIR, exist_ok=True)
    created_at = utcnow().isoformat()
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    name = f"{SEASON_ARCHIVE_PREFIX}{timestamp}_{batch_id.rsplit('-', 1)[-1]}.zip"
    destination = _archive_path(name)
    fd, temp_path = tempfile.mkstemp(
        prefix=".season-archive-", suffix=".tmp", dir=SEASON_ARCHIVE_DIR
    )
    os.close(fd)
    manifest = {
        "version": 1,
        "archive_id": batch_id,
        "created_at": created_at,
        "backup_name": backup_name,
        "backup_sha256": backup_sha256,
        "student_count": student_count,
        "student_id_hash": student_id_hash,
        "counts": counts,
        "tables": [model.__tablename__ for model in EXPORT_MODELS],
    }
    try:
        with zipfile.ZipFile(temp_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(
                "manifest.json",
                json.dumps(manifest, ensure_ascii=False, indent=2).encode("utf-8"),
            )
            for model in EXPORT_MODELS:
                table_name, rows, fields = await _export_model(db, model)
                archive.writestr(
                    f"data/{table_name}.csv",
                    _csv_text(rows, fields).encode("utf-8-sig"),
                )
        os.replace(temp_path, destination)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    return {
        "name": name,
        "size": os.path.getsize(destination),
        "sha256": _sha256_file(destination),
        "archive_id": batch_id,
        "created_at": created_at,
        "backup_name": backup_name,
        "backup_sha256": backup_sha256,
        "student_count": student_count,
        "counts": counts,
    }


def _sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_backup(path: str | None) -> dict[str, Any]:
    if not path or not os.path.isfile(path):
        return {"valid": False, "reason": "备份文件不存在"}
    result = {
        "valid": False,
        "name": os.path.basename(path),
        "size": os.path.getsize(path),
        "sha256": _sha256_file(path),
    }
    if result["size"] <= 0:
        result["reason"] = "备份文件为空"
        return result
    if path.endswith(".enc"):
        if not BACKUP_ENCRYPTION_KEY:
            result["reason"] = "加密备份缺少 BACKUP_ENCRYPTION_KEY，无法校验"
            return result
        fd, decrypted_path = tempfile.mkstemp(prefix=".backup-check-", suffix=".db")
        os.close(fd)
        try:
            key_bytes = hashlib.sha256(BACKUP_ENCRYPTION_KEY.encode()).digest()
            offset = 0
            with open(path, "rb") as source, open(decrypted_path, "wb") as target:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    target.write(
                        bytes(
                            value ^ key_bytes[(offset + index) % len(key_bytes)]
                            for index, value in enumerate(chunk)
                        )
                    )
                    offset += len(chunk)
            decrypted_check = validate_backup(decrypted_path)
            result.update(
                {
                    "valid": decrypted_check["valid"],
                    "integrity_check": decrypted_check.get("integrity_check"),
                    "foreign_key_violations": decrypted_check.get("foreign_key_violations"),
                }
            )
            if not result["valid"]:
                result["reason"] = decrypted_check.get("reason", "解密后的 SQLite 备份校验失败")
        finally:
            if os.path.exists(decrypted_path):
                os.remove(decrypted_path)
        return result
    if DB_ENGINE == "sqlite" or path.endswith(".db"):
        try:
            with sqlite3.connect(f"file:{Path(path).resolve()}?mode=ro", uri=True) as connection:
                integrity = connection.execute("PRAGMA integrity_check").fetchone()[0]
                foreign_keys = connection.execute("PRAGMA foreign_key_check").fetchall()
            result.update(
                {
                    "valid": integrity == "ok" and not foreign_keys,
                    "integrity_check": integrity,
                    "foreign_key_violations": len(foreign_keys),
                }
            )
            if not result["valid"]:
                result["reason"] = "SQLite 完整性或外键校验失败"
        except (OSError, sqlite3.Error) as exc:
            result["reason"] = f"备份无法读取：{exc}"
        return result
    result["valid"] = True
    result["validation"] = "文件存在且非空"
    return result


async def prepare_season_archive(db: AsyncSession) -> dict[str, Any]:
    preview = await preview_current_season(db)
    backup_path = await do_backup_async()
    if not backup_path:
        raise ValueError("数据库备份未生成，请先确认服务器数据库路径可写")
    backup_check = validate_backup(backup_path)
    if not backup_check["valid"]:
        raise ValueError(f"数据库备份校验失败：{backup_check.get('reason', '未知错误')}")
    batch_id = make_batch_id("season-archive")
    export = await create_season_export(
        db,
        batch_id=batch_id,
        backup_name=backup_check["name"],
        backup_sha256=backup_check["sha256"],
        counts=preview["counts"],
        student_count=preview["student_count"],
        student_id_hash=preview["student_id_hash"],
    )
    return {
        **export,
        "backup": backup_check,
        "ready": True,
        "confirm_text": SEASON_CONFIRM_TEXT,
    }


async def _read_manifest(name: str) -> tuple[str, dict[str, Any]]:
    path = _archive_path(name)
    if not os.path.isfile(path):
        raise ValueError("招生季导出文件不存在")
    try:
        with zipfile.ZipFile(path) as archive:
            if archive.testzip() is not None:
                raise ValueError("招生季导出文件损坏")
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
    except (OSError, KeyError, ValueError, json.JSONDecodeError, zipfile.BadZipFile) as exc:
        raise ValueError(f"招生季导出文件校验失败：{exc}") from exc
    return path, manifest


async def cleanup_current_season(
    db: AsyncSession,
    *,
    operator: User,
    archive_id: str,
    export_name: str,
    backup_name: str,
    reason: str,
) -> dict[str, Any]:
    if not reason.strip():
        raise ValueError("必须填写清理原因")
    archive_path, manifest = await _read_manifest(export_name)
    if manifest.get("archive_id") != archive_id:
        raise ValueError("归档批次与导出文件不匹配")
    if manifest.get("backup_name") != backup_name:
        raise ValueError("归档批次与数据库备份不匹配")
    backup_path = os.path.join(BACKUP_DIR, backup_name)
    backup_check = validate_backup(backup_path)
    if not backup_check["valid"] or backup_check["sha256"] != manifest.get("backup_sha256"):
        raise ValueError("数据库备份已变化或校验失败，请重新生成归档")
    current = await preview_current_season(db)
    if (
        current["student_count"] != manifest.get("student_count")
        or current["student_id_hash"] != manifest.get("student_id_hash")
    ):
        raise ValueError("准备归档后学生数据已变化，请重新生成导出和备份")

    student_ids = select(Student.id)
    counts: dict[str, int] = {}
    for model in STUDENT_DATA_MODELS:
        counts[model.__tablename__] = int(
            (
                await db.execute(
                    select(func.count(model.id)).where(_student_predicate(model))
                )
            ).scalar_one()
        )
    counts["operation_logs"] = int(
        (
            await db.execute(
                select(func.count(OperationLog.id)).where(
                    OperationLog.target_student_id.in_(student_ids)
                )
            )
        ).scalar_one()
    )
    counts["students"] = int(current["student_count"])

    for model in (
        HandoverItem,
        WorkItem,
        EnrollmentRecord,
        CampusVisitTask,
        HomeVisitTask,
        StudentAssignment,
        DialLog,
        Call,
        Note,
        FollowUp,
        LeadViewLog,
        Visit,
        PersonalGroupMembership,
    ):
        await db.execute(delete(model).where(_student_predicate(model)))
    await db.execute(
        delete(OperationLog).where(OperationLog.target_student_id.in_(student_ids))
    )
    await db.execute(delete(Student).where(Student.id.in_(student_ids)))

    batch_id = archive_id
    summary = {
        "archive_id": archive_id,
        "export_name": os.path.basename(archive_path),
        "backup_name": backup_name,
        "backup_sha256": backup_check["sha256"],
        "reason": reason.strip(),
        "counts": counts,
    }
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="招生季清理汇总",
            content=(
                f"批次 {archive_id}：已清理 {counts['students']} 名学生及关联业务数据；"
                f"原因：{reason.strip()}"
            ),
            new_status="已完成",
            note_content=json.dumps(summary, ensure_ascii=False, separators=(",", ":")),
            batch_id=batch_id,
        )
    )
    await db.commit()
    return {**summary, "deleted": True}
