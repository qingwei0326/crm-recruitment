from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.auth import (
    ADMIN_OP_ENROLLMENT_ATTRIBUTION,
    ADMIN_OP_ENROLLMENT_CREATE,
    ADMIN_OP_ENROLLMENT_SETTLEMENT,
    ADMIN_OP_REPORT_EXPORT,
    ADMIN_PAGE_ENROLLMENT_SETTLEMENT,
    get_current_user,
)
from app.database import get_db
from app.models import (
    AttributionMethod,
    CampusVisitTask,
    EnrollmentRecord,
    HomeVisitTask,
    SettlementStatus,
    User,
)
from app.permissions import get_accessible_student, is_admin
from app.routers.admissions import (
    _create_enrollment_record,
    _enrollment_payload,
    _get_enrollment_or_404,
    _load_enrollment_payload,
    _page_payload,
    _require_admin_module,
    _require_admin_operation,
)
from app.schemas import EnrollmentCreate, EnrollmentUpdate, Response
from app.utils import make_batch_id, make_operation_log

router = APIRouter(prefix="/api/admissions", tags=["招生推进"])


@router.get("/enrollments")
async def list_enrollments(
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_module(current_user, ADMIN_PAGE_ENROLLMENT_SETTLEMENT)
    conditions = []
    if not is_admin(current_user):
        conditions.append(EnrollmentRecord.attributed_agent_id == current_user.id)

    count_stmt = select(func.count(EnrollmentRecord.id))
    query = (
        select(EnrollmentRecord)
        .options(
            joinedload(EnrollmentRecord.attributed_agent),
            joinedload(EnrollmentRecord.confirmed_by_admin),
            joinedload(EnrollmentRecord.first_assigned_agent),
            joinedload(EnrollmentRecord.current_assigned_agent),
            joinedload(EnrollmentRecord.last_effective_agent),
            joinedload(EnrollmentRecord.home_visit_task).joinedload(HomeVisitTask.creator_agent),
            joinedload(EnrollmentRecord.campus_visit_task).joinedload(CampusVisitTask.creator_user),
            joinedload(EnrollmentRecord.campus_visit_task)
            .joinedload(CampusVisitTask.home_visit_task)
            .joinedload(HomeVisitTask.creator_agent),
        )
        .order_by(EnrollmentRecord.enrolled_at.desc())
    )
    if conditions:
        count_stmt = count_stmt.where(*conditions)
        query = query.where(*conditions)

    total = (await db.execute(count_stmt)).scalar() or 0
    result = await db.execute(query.offset((page - 1) * page_size).limit(page_size))
    rows = [_enrollment_payload(record) for record in result.scalars().unique().all()]
    return Response.ok(_page_payload(total, page, page_size, rows))


@router.get("/enrollments/summary")
async def enrollment_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_module(current_user, ADMIN_PAGE_ENROLLMENT_SETTLEMENT)
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="无权查看报名结算汇总")

    result = await db.execute(
        select(
            EnrollmentRecord.attributed_agent_id,
            User.name,
            func.count(EnrollmentRecord.id),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status == SettlementStatus.unsettled, 1),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status == SettlementStatus.settled, 1),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status == SettlementStatus.postponed, 1),
                    else_=0,
                )
            ),
            func.sum(
                case(
                    (EnrollmentRecord.settlement_status == SettlementStatus.disputed, 1),
                    else_=0,
                )
            ),
        )
        .join(User, User.id == EnrollmentRecord.attributed_agent_id)
        .group_by(EnrollmentRecord.attributed_agent_id, User.name)
        .order_by(func.count(EnrollmentRecord.id).desc(), User.name.asc())
    )
    rows = []
    for (
        agent_id,
        agent_name,
        total,
        unsettled,
        settled,
        postponed,
        disputed,
    ) in result.all():
        rows.append(
            {
                "attributed_agent_id": agent_id,
                "attributed_agent_name": agent_name,
                "total": total or 0,
                "unsettled": unsettled or 0,
                "settled": settled or 0,
                "postponed": postponed or 0,
                "disputed": disputed or 0,
            }
        )
    return Response.ok({"list": rows})


@router.get("/enrollments/settlement-batch")
async def settlement_batch_preview(
    status: str = Query("未结算"),
    start_date: date | None = Query(None),
    end_date: date | None = Query(None),
    agent_id: int | None = Query(None),
    agent_name: str = Query(""),
    region: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_admin_module(current_user, ADMIN_PAGE_ENROLLMENT_SETTLEMENT)
    _require_admin_operation(current_user, ADMIN_OP_REPORT_EXPORT)
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="无权生成结算批次")

    conditions = []
    if status and status != "全部":
        try:
            settlement_status = SettlementStatus(status)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="结算状态无效") from exc
        conditions.append(EnrollmentRecord.settlement_status == settlement_status)
    if start_date is not None:
        conditions.append(
            EnrollmentRecord.enrolled_at >= datetime.combine(start_date, datetime.min.time())
        )
    if end_date is not None:
        conditions.append(
            EnrollmentRecord.enrolled_at
            < datetime.combine(end_date, datetime.min.time()) + timedelta(days=1)
        )
    if agent_id is not None:
        conditions.append(EnrollmentRecord.attributed_agent_id == agent_id)
    if agent_name.strip():
        conditions.append(
            EnrollmentRecord.attributed_agent.has(User.name.contains(agent_name.strip()))
        )
    if region.strip():
        conditions.append(EnrollmentRecord.region_snapshot.contains(region.strip()))

    query = (
        select(EnrollmentRecord)
        .options(
            joinedload(EnrollmentRecord.attributed_agent),
            joinedload(EnrollmentRecord.confirmed_by_admin),
            joinedload(EnrollmentRecord.first_assigned_agent),
            joinedload(EnrollmentRecord.current_assigned_agent),
            joinedload(EnrollmentRecord.last_effective_agent),
            joinedload(EnrollmentRecord.home_visit_task).joinedload(HomeVisitTask.creator_agent),
            joinedload(EnrollmentRecord.campus_visit_task).joinedload(CampusVisitTask.creator_user),
            joinedload(EnrollmentRecord.campus_visit_task)
            .joinedload(CampusVisitTask.home_visit_task)
            .joinedload(HomeVisitTask.creator_agent),
        )
        .order_by(EnrollmentRecord.enrolled_at.asc(), EnrollmentRecord.id.asc())
    )
    if conditions:
        query = query.where(*conditions)
    result = await db.execute(query)
    rows = [_enrollment_payload(record) for record in result.scalars().unique().all()]
    amount_total = sum(float(row["amount"] or 0) for row in rows)
    agent_counts: dict[str, int] = {}
    for row in rows:
        name = row["attributed_agent_name"] or f"话务员 #{row['attributed_agent_id']}"
        agent_counts[name] = agent_counts.get(name, 0) + 1

    batch_id = make_batch_id("settlement")
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="生成结算批次",
            content=(
                f"批次 {batch_id}：{len(rows)} 条；状态 {status or '全部'}；金额 {amount_total:.2f}"
            ),
            old_status=str(len(rows)),
            new_status=status or "全部",
            batch_id=batch_id,
        )
    )
    await db.commit()
    return Response.ok(
        {
            "batch_id": batch_id,
            "record_count": len(rows),
            "amount_total": amount_total,
            "agent_counts": agent_counts,
            "filters": {
                "status": status,
                "start_date": start_date.isoformat() if start_date else "",
                "end_date": end_date.isoformat() if end_date else "",
                "agent_id": agent_id,
                "agent_name": agent_name.strip(),
                "region": region.strip(),
            },
            "list": rows,
        }
    )


@router.post("/enrollments")
async def create_enrollment(
    body: EnrollmentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="只有管理员可以确认报名")
    _require_admin_module(current_user, ADMIN_PAGE_ENROLLMENT_SETTLEMENT)
    _require_admin_operation(current_user, ADMIN_OP_ENROLLMENT_CREATE)

    student = await get_accessible_student(db, body.student_id, current_user)
    record = await _create_enrollment_record(db, body, student, current_user)
    await db.commit()
    await db.refresh(record)
    return Response.ok(await _load_enrollment_payload(db, record.id))


@router.patch("/enrollments/{record_id}")
async def update_enrollment(
    record_id: int,
    body: EnrollmentUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not is_admin(current_user):
        raise HTTPException(status_code=403, detail="只有管理员可以修改报名结算")
    _require_admin_module(current_user, ADMIN_PAGE_ENROLLMENT_SETTLEMENT)
    changed_fields = body.model_fields_set
    if "attributed_agent_id" in changed_fields:
        _require_admin_operation(current_user, ADMIN_OP_ENROLLMENT_ATTRIBUTION)
    if {"settlement_status", "settlement_notes"} & changed_fields:
        _require_admin_operation(current_user, ADMIN_OP_ENROLLMENT_SETTLEMENT)

    record = await _get_enrollment_or_404(db, record_id)
    old_agent_id = record.attributed_agent_id
    old_settlement = record.settlement_status

    if "attributed_agent_id" in changed_fields and body.attributed_agent_id is not None:
        reason = (body.attribution_reason or "").strip()
        if not reason:
            raise HTTPException(status_code=400, detail="修改报名归属必须填写原因")
        record.attributed_agent_id = body.attributed_agent_id
        record.attribution_method = AttributionMethod.manual
        record.attribution_reason = reason

    if "settlement_status" in changed_fields and body.settlement_status is not None:
        record.settlement_status = SettlementStatus(body.settlement_status)
    if "settlement_notes" in changed_fields and body.settlement_notes is not None:
        record.settlement_notes = body.settlement_notes

    if old_agent_id != record.attributed_agent_id or old_settlement != record.settlement_status:
        db.add(
            make_operation_log(
                current_user,
                record.student_id,
                "",
                "修改报名结算",
                content=(
                    f"报名 #{record.id}: 归属 {old_agent_id}→{record.attributed_agent_id}; "
                    f"结算 {old_settlement.value if old_settlement else ''}"
                    f"→{record.settlement_status.value if record.settlement_status else ''}"
                ),
                note_content=record.attribution_reason,
            )
        )

    await db.commit()
    return Response.ok(await _load_enrollment_payload(db, record.id))
