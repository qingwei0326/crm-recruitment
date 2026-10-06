from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_current_user
from app.database import get_db
from app.domain_errors import DomainError
from app.models import User
from app.schemas import Response
from app.services import agent_task_service as agent_tasks

router = APIRouter(prefix="/api/tasks", tags=["任务"])


def _http_error(exc: DomainError) -> HTTPException:
    # Keep the {"detail": ...} envelope these endpoints have always returned.
    return HTTPException(status_code=exc.http_status, detail=exc.message)


@router.get("/today")
async def today_tasks(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    search: str = Query(None),
    school_name: str = Query(None),
    intent_level: str = Query(None),
    overdue: bool = Query(False),
    personal_group_id: int | None = Query(None),
    ungrouped: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        data = await agent_tasks.today_tasks(
            db,
            current_user.id,
            limit=limit,
            offset=offset,
            search=search,
            school_name=school_name,
            intent_level=intent_level,
            overdue=overdue,
            personal_group_id=personal_group_id,
            ungrouped=ungrouped,
        )
    except DomainError as exc:
        raise _http_error(exc) from exc
    return Response.ok(data)


@router.get("/handled")
async def handled_students(
    status: str = Query(None),
    status_detail: str = Query(None),
    intent_level: str = Query(None),
    search: str = Query(None),
    region: str = Query(None),
    personal_group_id: int | None = Query(None),
    ungrouped: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """待办学生列表：已联系、未接、待回访，需要话务员继续处理。"""
    try:
        data = await agent_tasks.handled_students(
            db,
            current_user.id,
            status=status,
            status_detail=status_detail,
            intent_level=intent_level,
            search=search,
            region=region,
            personal_group_id=personal_group_id,
            ungrouped=ungrouped,
            limit=limit,
            offset=offset,
        )
    except DomainError as exc:
        raise _http_error(exc) from exc
    return Response.ok(data)


@router.get("/yesterday")
async def yesterday_review(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return Response.ok(await agent_tasks.yesterday_review(db, current_user.id))


@router.get("/following")
async def following_students(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """跟进中：有意向但尚未报名/无效的学员"""
    return Response.ok(await agent_tasks.following_students(db, current_user.id))


@router.get("/backlog")
async def my_backlog(
    days_threshold: int = Query(3, ge=1, le=30),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """当前话务员积压情况：分配超过 N 天且仍未到终态的学员数量与最久天数。"""
    return Response.ok(await agent_tasks.backlog(db, current_user.id, days_threshold))
