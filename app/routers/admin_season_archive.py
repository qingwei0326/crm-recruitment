import json
import logging
import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_super_admin
from app.database import get_db
from app.models import User
from app.schemas import Response
from app.services.season_archive_service import (
    SEASON_CONFIRM_TEXT,
    _archive_path,
    cleanup_current_season,
    prepare_season_archive,
    preview_current_season,
)
from app.utils import make_operation_log

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/admin/season-archive", tags=["招生季归档"])


class SeasonCleanupReq(BaseModel):
    archive_id: str = Field(..., min_length=1, max_length=80)
    export_name: str = Field(..., min_length=1, max_length=160)
    backup_name: str = Field(..., min_length=1, max_length=160)
    confirm_text: str = Field(..., min_length=1, max_length=64)
    reason: str = Field(..., min_length=1, max_length=500)


@router.get("/preview")
async def season_archive_preview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """只读查看当前招生季及其关联数据规模。"""
    return Response.ok(await preview_current_season(db))


@router.post("/prepare")
async def season_archive_prepare(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """生成招生季导出包，同时生成并校验数据库备份。"""
    try:
        result = await prepare_season_archive(db)
        db.add(
            make_operation_log(
                current_user,
                target_student_id=None,
                case_no="",
                action="招生季归档准备",
                content=(
                    f"批次 {result['archive_id']}：生成 {result['student_count']} 名学生的导出包，"
                    f"备份 {result['backup_name']} 已通过完整性校验"
                ),
                note_content=json.dumps(
                    {
                        "archive_id": result["archive_id"],
                        "export_name": result["name"],
                        "export_sha256": result["sha256"],
                        "backup_name": result["backup_name"],
                        "backup_sha256": result["backup_sha256"],
                        "student_count": result["student_count"],
                        "counts": result["counts"],
                    },
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
                batch_id=result["archive_id"],
            )
        )
        await db.commit()
        return Response.ok(result, msg="导出和备份已生成并校验")
    except ValueError as exc:
        await db.rollback()
        return Response.error(code=1, msg=str(exc))
    except Exception:
        await db.rollback()
        logger.exception("Season archive preparation failed")
        return Response.error(code=1, msg="招生季归档准备失败，请查看服务器日志")


@router.get("/exports/{name}")
async def download_season_export(
    name: str,
    current_user: User = Depends(require_super_admin),
):
    """下载已经生成的招生季导出包。"""
    try:
        path = _archive_path(name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not os.path.isfile(path):
        raise HTTPException(status_code=404, detail="招生季导出文件不存在")
    return FileResponse(path, media_type="application/zip", filename=name)


@router.post("/cleanup")
async def season_archive_cleanup(
    body: SeasonCleanupReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_super_admin),
):
    """在导出、备份和数据指纹均匹配时清理当前招生季。"""
    if body.confirm_text.strip() != SEASON_CONFIRM_TEXT:
        return Response.error(code=1, msg=f"请输入准确确认词：{SEASON_CONFIRM_TEXT}")
    try:
        result = await cleanup_current_season(
            db,
            operator=current_user,
            archive_id=body.archive_id.strip(),
            export_name=body.export_name.strip(),
            backup_name=body.backup_name.strip(),
            reason=body.reason.strip(),
        )
        return Response.ok(result, msg="招生季数据已清理，审计汇总已保留")
    except ValueError as exc:
        await db.rollback()
        return Response.error(code=1, msg=str(exc))
    except Exception:
        await db.rollback()
        logger.exception("Season archive cleanup failed")
        return Response.error(code=1, msg="招生季清理失败，数据未提交，请查看服务器日志")
