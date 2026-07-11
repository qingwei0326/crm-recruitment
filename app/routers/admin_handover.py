from collections import defaultdict
from dataclasses import asdict
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field, field_validator, model_validator
from sqlalchemy import exists, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ADMIN_OP_USER_OFFBOARD, require_operation_permission
from app.database import get_db
from app.domain_errors import DomainError
from app.domain_models import (
    HandoverBatch,
    HandoverBatchStatus,
    HandoverItem,
    HandoverItemStatus,
    HandoverTransfer,
    HandoverTransferMode,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import IntentLevel, Student, User, UserRole
from app.schemas import Response
from app.services.handover_service import (
    execute_transfer,
    handover_batch_transaction_lock,
    handover_transaction_lock,
    preview_transfer,
    start_handover,
)
from app.utils import utcnow

router = APIRouter(prefix="/api/admin", tags=["离职交接"])

_OPEN_HANDOVER_WORK_STATUSES = {
    WorkItemStatus.open,
    WorkItemStatus.blocked_suspension,
    WorkItemStatus.blocked_handover,
}


class _IdempotentRequest(BaseModel):
    idempotency_key: str = Field(min_length=1, max_length=128)

    @field_validator("idempotency_key")
    @classmethod
    def validate_idempotency_key(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("idempotency_key不能为空")
        return value


class StartOffboardingRequest(_IdempotentRequest):
    expected_version: int = Field(ge=0)


class _TransferSelection(BaseModel):
    mode: Literal["selected", "all_remaining"]
    student_ids: list[int] = Field(default_factory=list)

    @field_validator("student_ids")
    @classmethod
    def validate_student_ids(cls, values: list[int]) -> list[int]:
        if any(value <= 0 for value in values):
            raise ValueError("student_ids必须为正整数")
        if len(values) != len(set(values)):
            raise ValueError("student_ids不能重复")
        return values

    @model_validator(mode="after")
    def validate_selection(self):
        if self.mode == "selected" and not self.student_ids:
            raise ValueError("selected模式必须选择学生")
        if self.mode == "all_remaining" and self.student_ids:
            raise ValueError("all_remaining模式不能指定student_ids")
        return self


class PreviewTransferRequest(_TransferSelection):
    pass


class ExecuteTransferRequest(_IdempotentRequest, _TransferSelection):
    target_agent_id: int = Field(gt=0)
    expected_version: int = Field(ge=0)


def _require_super_admin(user: User) -> None:
    if not user.is_super_admin:
        raise HTTPException(status_code=403, detail="需要超级管理员权限")


def _datetime_text(value) -> str | None:
    return str(value) if value is not None else None


def _batch_payload(batch: HandoverBatch, source_agent: User) -> dict:
    return {
        "id": batch.id,
        "source_agent": {
            "id": source_agent.id,
            "name": source_agent.name,
            "username": source_agent.username,
        },
        "status": batch.status.value,
        "version": batch.version,
        "total_items": batch.total_items,
        "remaining_items": batch.remaining_items,
        "transferred_items": batch.transferred_items,
        "initiated_by": batch.initiated_by,
        "initiated_at": _datetime_text(batch.initiated_at),
        "completed_by": batch.completed_by,
        "completed_at": _datetime_text(batch.completed_at),
    }


async def _load_batch_row(
    db: AsyncSession,
    batch_id: int,
) -> tuple[HandoverBatch, User]:
    row = (
        await db.execute(
            select(HandoverBatch, User)
            .join(User, User.id == HandoverBatch.source_agent_id)
            .where(HandoverBatch.id == batch_id)
        )
    ).one_or_none()
    if row is None:
        raise DomainError("交接批次不存在")
    return row


@router.get("/handovers")
async def list_handovers(
    status: HandoverBatchStatus | None = Query(default=None),
    q: str = Query(default="", max_length=64),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(
        require_operation_permission(ADMIN_OP_USER_OFFBOARD)
    ),
):
    query = select(HandoverBatch, User).join(
        User,
        User.id == HandoverBatch.source_agent_id,
    )
    if status is not None:
        query = query.where(HandoverBatch.status == status)
    keyword = q.strip()
    if keyword:
        pattern = f"%{keyword}%"
        query = query.where(
            or_(
                User.name.like(pattern),
                User.username.like(pattern),
            )
        )

    total = int(
        (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    )
    rows = (
        await db.execute(
            query.order_by(
                HandoverBatch.initiated_at.desc(),
                HandoverBatch.id.desc(),
            )
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "list": [_batch_payload(batch, source) for batch, source in rows],
        }
    )


@router.post("/users/{user_id}/offboarding/start")
async def start_user_offboarding(
    user_id: int,
    body: StartOffboardingRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_operation_permission(ADMIN_OP_USER_OFFBOARD)
    ),
):
    _require_super_admin(current_user)
    source_user = await db.get(User, user_id)
    if source_user is None:
        raise DomainError("用户不存在")
    if source_user.role != UserRole.agent:
        raise DomainError("仅话务员可以进入离职交接")

    async with handover_transaction_lock(source_user.id):
        batch = await start_handover(
            db,
            source_user,
            current_user,
            body.idempotency_key,
            expected_employment_version=body.expected_version,
        )
        await db.commit()
    return Response.ok(_batch_payload(batch, source_user))


def _active_work_exists(batch_id: int, kind: WorkItemKind | None = None):
    conditions = [
        WorkItem.student_id == Student.id,
        WorkItem.handover_batch_id == batch_id,
        WorkItem.status.in_(_OPEN_HANDOVER_WORK_STATUSES),
    ]
    if kind is not None:
        conditions.append(WorkItem.kind == kind)
    return exists(select(WorkItem.id).where(*conditions))


def _overdue_follow_up_exists(batch_id: int):
    return exists(
        select(WorkItem.id).where(
            WorkItem.student_id == Student.id,
            WorkItem.handover_batch_id == batch_id,
            WorkItem.kind == WorkItemKind.scheduled_follow_up,
            WorkItem.status == WorkItemStatus.blocked_handover,
            WorkItem.due_at.is_not(None),
            WorkItem.due_at < utcnow(),
        )
    )


async def _detail_filter_options(db: AsyncSession, batch_id: int) -> dict:
    rows = (
        await db.execute(
            select(Student.region, Student.school_name, Student.intent_level)
            .join(HandoverItem, HandoverItem.student_id == Student.id)
            .where(HandoverItem.handover_batch_id == batch_id)
        )
    ).all()
    work_kinds = (
        await db.execute(
            select(WorkItem.kind)
            .where(
                WorkItem.handover_batch_id == batch_id,
                WorkItem.status.in_(_OPEN_HANDOVER_WORK_STATUSES),
            )
            .distinct()
        )
    ).scalars()
    return {
        "regions": sorted({region for region, _school, _intent in rows if region}),
        "schools": sorted({school for _region, school, _intent in rows if school}),
        "intents": sorted(
            {
                intent.value if hasattr(intent, "value") else str(intent)
                for _region, _school, intent in rows
                if intent is not None
            }
        ),
        "kinds": sorted(
            {kind.value if hasattr(kind, "value") else str(kind) for kind in work_kinds}
        ),
    }


@router.get("/handovers/{batch_id}")
async def get_handover_detail(
    batch_id: int,
    status: HandoverItemStatus | None = Query(default=None),
    region: str = Query(default="", max_length=64),
    school: str = Query(default="", max_length=128),
    intent: IntentLevel | None = Query(default=None),
    kind: WorkItemKind | None = Query(default=None),
    overdue: bool | None = Query(default=None),
    q: str = Query(default="", max_length=64),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(
        require_operation_permission(ADMIN_OP_USER_OFFBOARD)
    ),
):
    batch, source_agent = await _load_batch_row(db, batch_id)
    query = select(HandoverItem, Student).join(
        Student,
        Student.id == HandoverItem.student_id,
    ).where(HandoverItem.handover_batch_id == batch_id)
    if status is not None:
        query = query.where(HandoverItem.status == status)
    if region.strip():
        query = query.where(Student.region == region.strip())
    if school.strip():
        query = query.where(Student.school_name == school.strip())
    if intent is not None:
        query = query.where(Student.intent_level == intent)
    if kind is not None:
        query = query.where(_active_work_exists(batch_id, kind))
    if overdue is not None:
        overdue_condition = _overdue_follow_up_exists(batch_id)
        query = query.where(overdue_condition if overdue else ~overdue_condition)
    keyword = q.strip()
    if keyword:
        pattern = f"%{keyword}%"
        query = query.where(
            or_(
                Student.name.like(pattern),
                Student.case_no.like(pattern),
                Student.school_name.like(pattern),
                Student.region.like(pattern),
            )
        )

    total = int(
        (await db.execute(select(func.count()).select_from(query.subquery()))).scalar_one()
    )
    rows = (
        await db.execute(
            query.order_by(HandoverItem.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    student_ids = [student.id for _item, student in rows]
    work_by_student: dict[int, list[WorkItem]] = defaultdict(list)
    if student_ids:
        work_rows = await db.execute(
            select(WorkItem).where(
                WorkItem.student_id.in_(student_ids),
                WorkItem.handover_batch_id == batch_id,
                WorkItem.status.in_(_OPEN_HANDOVER_WORK_STATUSES),
            )
        )
        for work_item in work_rows.scalars().all():
            work_by_student[work_item.student_id].append(work_item)

    now = utcnow()
    items = []
    for handover_item, student in rows:
        work_items = work_by_student[student.id]
        kinds = sorted({work_item.kind.value for work_item in work_items})
        items.append(
            {
                "id": handover_item.id,
                "student_id": student.id,
                "name": student.name,
                "case_no": student.case_no or "",
                "school_name": student.school_name or "",
                "region": student.region or "",
                "status": student.status.value,
                "status_detail": student.status_detail or "",
                "intent_level": student.intent_level.value,
                "stage": student.stage.value,
                "need_help": bool(student.need_help),
                "assigned_to": student.assigned_to,
                "handover_status": handover_item.status.value,
                "target_agent_id": handover_item.target_agent_id,
                "transfer_id": handover_item.transfer_id,
                "transferred_at": _datetime_text(handover_item.transferred_at),
                "overdue": any(
                    work_item.kind == WorkItemKind.scheduled_follow_up
                    and work_item.status == WorkItemStatus.blocked_handover
                    and work_item.due_at is not None
                    and work_item.due_at < now
                    for work_item in work_items
                ),
                "work_item_kinds": kinds,
                "open_work_item_count": len(work_items),
            }
        )

    return Response.ok(
        {
            "batch": _batch_payload(batch, source_agent),
            "total": total,
            "page": page,
            "page_size": page_size,
            "items": items,
            "filter_options": await _detail_filter_options(db, batch_id),
        }
    )


@router.post("/handovers/{batch_id}/preview-transfer")
async def preview_handover_transfer(
    batch_id: int,
    body: PreviewTransferRequest,
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(
        require_operation_permission(ADMIN_OP_USER_OFFBOARD)
    ),
):
    preview = await preview_transfer(
        db,
        batch_id,
        body.student_ids if body.mode == "selected" else None,
    )
    return Response.ok({**asdict(preview), "mode": body.mode})


async def _transfer_would_complete(
    db: AsyncSession,
    batch_id: int,
    body: ExecuteTransferRequest,
) -> bool:
    if body.mode == "all_remaining":
        return True
    pending_count = int(
        (
            await db.execute(
                select(func.count(HandoverItem.id)).where(
                    HandoverItem.handover_batch_id == batch_id,
                    HandoverItem.status == HandoverItemStatus.pending,
                )
            )
        ).scalar_one()
    )
    if pending_count == 0:
        return False
    selected_pending = int(
        (
            await db.execute(
                select(func.count(HandoverItem.id)).where(
                    HandoverItem.handover_batch_id == batch_id,
                    HandoverItem.status == HandoverItemStatus.pending,
                    HandoverItem.student_id.in_(body.student_ids),
                )
            )
        ).scalar_one()
    )
    return selected_pending == pending_count


@router.post("/handovers/{batch_id}/transfers")
async def execute_handover_transfer(
    batch_id: int,
    body: ExecuteTransferRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(
        require_operation_permission(ADMIN_OP_USER_OFFBOARD)
    ),
):
    async with handover_batch_transaction_lock(batch_id):
        if not current_user.is_super_admin and await _transfer_would_complete(
            db,
            batch_id,
            body,
        ):
            _require_super_admin(current_user)
        result = await execute_transfer(
            db,
            batch_id,
            body.target_agent_id,
            HandoverTransferMode(body.mode),
            current_user,
            body.idempotency_key,
            body.expected_version,
            body.student_ids,
        )
        await db.commit()
    return Response.ok(asdict(result))


@router.get("/handovers/{batch_id}/transfers")
async def list_handover_transfers(
    batch_id: int,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _current_user: User = Depends(
        require_operation_permission(ADMIN_OP_USER_OFFBOARD)
    ),
):
    await _load_batch_row(db, batch_id)
    total = int(
        (
            await db.execute(
                select(func.count(HandoverTransfer.id)).where(
                    HandoverTransfer.handover_batch_id == batch_id
                )
            )
        ).scalar_one()
    )
    transfers = (
        (
            await db.execute(
                select(HandoverTransfer)
                .where(HandoverTransfer.handover_batch_id == batch_id)
                .order_by(HandoverTransfer.created_at.desc(), HandoverTransfer.id.desc())
                .offset((page - 1) * page_size)
                .limit(page_size)
            )
        )
        .scalars()
        .all()
    )
    target_ids = {transfer.target_agent_id for transfer in transfers}
    operator_ids = {transfer.operator_id for transfer in transfers}
    user_ids = sorted(target_ids | operator_ids)
    users = {}
    if user_ids:
        user_rows = await db.execute(select(User).where(User.id.in_(user_ids)))
        users = {user.id: user for user in user_rows.scalars().all()}
    transferred_by_id: dict[int, list[int]] = defaultdict(list)
    transfer_ids = [transfer.id for transfer in transfers]
    if transfer_ids:
        item_rows = await db.execute(
            select(HandoverItem.transfer_id, HandoverItem.student_id).where(
                HandoverItem.transfer_id.in_(transfer_ids),
                HandoverItem.status == HandoverItemStatus.transferred,
            )
        )
        for transfer_id, student_id in item_rows.all():
            transferred_by_id[transfer_id].append(student_id)

    data = []
    for transfer in transfers:
        target = users.get(transfer.target_agent_id)
        operator = users.get(transfer.operator_id)
        data.append(
            {
                "id": transfer.id,
                "batch_id": transfer.handover_batch_id,
                "target_agent": {
                    "id": transfer.target_agent_id,
                    "name": target.name if target else "",
                },
                "mode": transfer.mode.value,
                "status": transfer.status.value,
                "requested_count": transfer.requested_count,
                "transferred_count": transfer.transferred_count,
                "conflict_count": transfer.conflict_count,
                "transferred_ids": sorted(transferred_by_id[transfer.id]),
                "operator": {
                    "id": transfer.operator_id,
                    "name": operator.name if operator else "",
                },
                "expected_version": transfer.expected_batch_version,
                "created_at": _datetime_text(transfer.created_at),
                "completed_at": _datetime_text(transfer.completed_at),
                "audit_batch_id": f"handover-transfer:{transfer.id}",
            }
        )
    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "list": data,
        }
    )
