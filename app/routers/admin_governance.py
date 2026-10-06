from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_DUPLICATE_CLEANUP,
    ADMIN_OP_GOVERNANCE_REVIEW,
    ADMIN_PAGE_LEAD_GOVERNANCE,
    require_admin,
    require_operation_permission,
    require_page_permission,
)
from app.database import get_db
from app.models import User
from app.schemas import Response
from app.services import data_quality_service as data_quality_svc
from app.services import duplicate_lead_service as duplicates
from app.services import governance_review as reviews
from app.services import governance_signals as signals
from app.services.governance_review import GovernanceRequestError

# Re-exported: tests/test_admin.py imports the private name from this module.
from app.services.governance_signals import is_work_hour as _is_work_hour  # noqa: F401
from app.utils import month_start_cst_as_utc, today_cst_as_utc

router = APIRouter(prefix="/api/admin", tags=["管理"])


class DuplicatePhoneCleanupReq(BaseModel):
    confirm: bool = False


class GovernanceReviewReq(BaseModel):
    key: str
    title: str = ""
    detail: str = ""
    count: int = 0
    review_token: str = ""


@router.get("/data-quality")
async def data_quality(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """管理员数据质量看板：通话时长回写、缺电话、逾期回访和无效原因分布。"""
    # The clock is read here (not in the service) so tests can pin "today" / "month start".
    return Response.ok(
        await data_quality_svc.data_quality(
            db, today=today_cst_as_utc(), month_start=month_start_cst_as_utc()
        )
    )


@router.get("/domain-consistency")
async def domain_consistency(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Run the read-only domain projection consistency audit on demand."""
    return Response.ok(await data_quality_svc.domain_consistency(db))


@router.get("/data-health")
async def data_health_center(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
    """线索治理健康中心：聚合可复核的数据异常入口，不自动修改数据。"""
    return Response.ok(await signals.data_health(db))


@router.post("/governance-reviews")
async def acknowledge_governance_review(
    body: GovernanceReviewReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_GOVERNANCE_REVIEW)),
):
    try:
        result = await reviews.acknowledge_governance_review(
            db,
            current_user,
            key=body.key,
            title=body.title,
            detail=body.detail,
            review_token=body.review_token,
        )
    except GovernanceRequestError as exc:
        return Response.error(code=1, msg=exc.message)
    return Response.ok(result)


@router.get("/lead-duplicates")
async def lead_duplicates(
    limit: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
    """只读识别疑似重复线索，不做自动合并或删除。"""
    return Response.ok(await duplicates.lead_duplicates(db, limit))


@router.get("/lead-duplicates/cleanup-preview")
async def duplicate_phone_cleanup_preview(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
    """预览重复手机号清理影响范围，不修改数据。"""
    return Response.ok(await duplicates.duplicate_phone_cleanup_preview(db))


@router.post("/lead-duplicates/cleanup")
async def duplicate_phone_cleanup(
    body: DuplicatePhoneCleanupReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_DUPLICATE_CLEANUP)),
):
    """清理可安全移除的重复手机号；无剩余号码的学生保留并交由人工处理。"""
    if not body.confirm:
        return Response.error(code=1, msg="需要确认后才能清理重复手机号")
    return Response.ok(await duplicates.duplicate_phone_cleanup(db, current_user))


@router.get("/risk-alerts")
async def risk_alerts(
    days: int = Query(7, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
    """只读聚合近期高风险操作，供管理员复核。"""
    return Response.ok(await signals.risk_alerts(db, days))
