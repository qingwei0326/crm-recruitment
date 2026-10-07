import asyncio
from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from weakref import WeakValueDictionary

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain_errors import DomainConflict, DomainError
from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    HandoverBatch,
    HandoverBatchStatus,
    HandoverItem,
    HandoverItemStatus,
    HandoverTransfer,
    HandoverTransferMode,
    HandoverTransferStatus,
    StudentAssignment,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import IntentLevel, Student, StudentStatus, User, UserRole
from app.services.assignment_service import AssignmentTarget, apply_assignment_changes
from app.services.employment_service import set_employment_status
from app.services.work_item_service import transfer_open_work_items
from app.status_policy import canonical_student_status
from app.utils import make_operation_log, utcnow


@dataclass(frozen=True)
class HandoverPreview:
    batch_id: int
    version: int
    selected_count: int
    open_work_item_count: int
    overdue_count: int
    high_intent_count: int
    by_kind: dict[str, int]


@dataclass(frozen=True)
class HandoverExecutionResult:
    transfer_id: int
    transferred_ids: tuple[int, ...]
    skipped_ids: tuple[int, ...]
    remaining_count: int
    batch_version: int
    completed: bool


_ACTIVE_BATCH_STATUSES = {
    HandoverBatchStatus.pending,
    HandoverBatchStatus.in_progress,
}
_HANDOVER_TRANSACTION_LOCKS: WeakValueDictionary[int, asyncio.Lock] = (
    WeakValueDictionary()
)
_HANDOVER_BATCH_TRANSACTION_LOCKS: WeakValueDictionary[int, asyncio.Lock] = (
    WeakValueDictionary()
)


def handover_transaction_lock(source_user_id: int) -> asyncio.Lock:
    lock = _HANDOVER_TRANSACTION_LOCKS.get(source_user_id)
    if lock is None:
        lock = asyncio.Lock()
        _HANDOVER_TRANSACTION_LOCKS[source_user_id] = lock
    return lock


def handover_batch_transaction_lock(batch_id: int) -> asyncio.Lock:
    lock = _HANDOVER_BATCH_TRANSACTION_LOCKS.get(batch_id)
    if lock is None:
        lock = asyncio.Lock()
        _HANDOVER_BATCH_TRANSACTION_LOCKS[batch_id] = lock
    return lock


async def _batch_by_idempotency_key(
    db: AsyncSession,
    idempotency_key: str,
) -> HandoverBatch | None:
    result = await db.execute(
        select(HandoverBatch).where(
            HandoverBatch.idempotency_key == idempotency_key
        )
    )
    return result.scalar_one_or_none()


async def _active_batch_for_source(
    db: AsyncSession,
    source_agent_id: int,
) -> HandoverBatch | None:
    result = await db.execute(
        select(HandoverBatch)
        .where(
            HandoverBatch.source_agent_id == source_agent_id,
            HandoverBatch.status.in_(_ACTIVE_BATCH_STATUSES),
        )
        .order_by(HandoverBatch.id)
    )
    return result.scalars().first()


async def start_handover(
    db: AsyncSession,
    source_user: User,
    operator: User,
    idempotency_key: str,
    expected_employment_version: int | None = None,
) -> HandoverBatch:
    source_user_id = source_user.id
    existing = await _batch_by_idempotency_key(db, idempotency_key)
    if existing is not None:
        if existing.source_agent_id != source_user_id:
            raise DomainConflict("幂等键已用于其他员工的交接")
        return existing

    active_batch = await _active_batch_for_source(db, source_user_id)
    if active_batch is not None:
        raise DomainConflict(f"员工已有进行中的交接批次: {active_batch.id}")

    employment = (
        await db.execute(
            select(AgentEmployment)
            .where(AgentEmployment.user_id == source_user_id)
            .with_for_update()
        )
    ).scalar_one_or_none()
    if employment is None:
        raise DomainError("员工状态不存在，请先执行数据库迁移")
    if (
        expected_employment_version is not None
        and employment.version != expected_employment_version
    ):
        raise DomainConflict("员工状态已变化，请刷新后重试")
    if employment.status not in {
        EmploymentStatus.active,
        EmploymentStatus.suspended,
    }:
        raise DomainConflict(f"员工当前状态不可开始交接: {employment.status}")

    now = utcnow()
    batch = HandoverBatch(
        source_agent_id=source_user_id,
        status=HandoverBatchStatus.pending,
        version=1,
        total_items=0,
        remaining_items=0,
        transferred_items=0,
        initiated_by=operator.id,
        initiated_at=now,
        idempotency_key=idempotency_key,
    )
    try:
        async with db.begin_nested():
            db.add(batch)
            await db.flush()
    except IntegrityError:
        winner = await _batch_by_idempotency_key(db, idempotency_key)
        if winner is not None:
            if winner.source_agent_id != source_user_id:
                raise DomainConflict("幂等键已用于其他员工的交接")
            return winner
        winner = await _active_batch_for_source(db, source_user_id)
        if winner is not None:
            raise DomainConflict(f"员工已有进行中的交接批次: {winner.id}")
        raise DomainConflict("交接批次已由其他请求创建")

    student_rows = await db.execute(
        select(Student).where(Student.assigned_to == source_user_id)
    )
    students = student_rows.scalars().all()
    student_ids = [student.id for student in students]
    assignments: list[StudentAssignment] = []
    if student_ids:
        assignment_rows = await db.execute(
            select(StudentAssignment).where(
                StudentAssignment.student_id.in_(student_ids),
                StudentAssignment.ended_at.is_(None),
            )
        )
        assignments = assignment_rows.scalars().all()
    assignment_by_student = {
        assignment.student_id: assignment for assignment in assignments
    }
    invalid_assignments = sorted(
        student.id
        for student in students
        if student.id not in assignment_by_student
        or assignment_by_student[student.id].agent_id != source_user_id
    )
    if invalid_assignments:
        raise DomainConflict(f"学生归属投影不一致: {invalid_assignments[:3]}")

    terminal_students = [
        student
        for student in students
        if canonical_student_status(student.status)
        in {StudentStatus.enrolled, StudentStatus.invalid}
    ]
    nonterminal_students = [
        student for student in students if student not in terminal_students
    ]
    for student in nonterminal_students:
        db.add(
            HandoverItem(
                handover_batch_id=batch.id,
                student_id=student.id,
                source_assignment_id=assignment_by_student[student.id].id,
                status=HandoverItemStatus.pending,
                created_at=now,
                updated_at=now,
            )
        )
    batch.total_items = len(nonterminal_students)
    batch.remaining_items = len(nonterminal_students)

    if terminal_students:
        await apply_assignment_changes(
            db,
            [
                AssignmentTarget(student_id=student.id, agent_id=None)
                for student in terminal_students
            ],
            operator=operator,
            reason="terminal_unassign",
            batch_id=f"handover-start:{batch.id}",
            handover_batch_id=batch.id,
            at=now,
        )

    nonterminal_ids = [student.id for student in nonterminal_students]
    for from_status in (
        WorkItemStatus.open,
        WorkItemStatus.blocked_suspension,
    ):
        await transfer_open_work_items(
            db,
            nonterminal_ids,
            source_user_id,
            from_status,
            WorkItemStatus.blocked_handover,
            handover_batch_id=batch.id,
            at=now,
        )

    employment = await set_employment_status(
        db,
        source_user,
        EmploymentStatus.handover_pending,
        operator=operator,
        reason="handover_start",
        expected_version=expected_employment_version,
        handover_batch_id=batch.id,
        at=now,
    )
    if batch.remaining_items == 0:
        batch.status = HandoverBatchStatus.completed
        batch.completed_by = operator.id
        batch.completed_at = now
        await set_employment_status(
            db,
            source_user,
            EmploymentStatus.offboarded,
            operator=operator,
            reason="handover_complete_empty",
            expected_version=employment.version,
            handover_batch_id=batch.id,
            at=now,
        )

    source_user.failed_login_attempts = 0
    source_user.locked_until = None
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="开始离职交接",
            content=(
                f"员工 {source_user_id}：待交接 {batch.remaining_items} 条，"
                f"终态历史 {len(terminal_students)} 条"
            ),
            batch_id=f"handover:{batch.id}",
        )
    )
    await db.flush()
    return batch


async def preview_transfer(
    db: AsyncSession,
    batch_id: int,
    student_ids: Sequence[int] | None = None,
) -> HandoverPreview:
    batch = await db.get(HandoverBatch, batch_id)
    if batch is None:
        raise DomainError("交接批次不存在")

    conditions = [
        HandoverItem.handover_batch_id == batch_id,
        HandoverItem.status == HandoverItemStatus.pending,
    ]
    if student_ids is not None:
        unique_ids = sorted(set(student_ids))
        if not unique_ids:
            return HandoverPreview(batch_id, batch.version, 0, 0, 0, 0, {})
        conditions.append(HandoverItem.student_id.in_(unique_ids))
    rows = await db.execute(select(HandoverItem).where(*conditions))
    items = rows.scalars().all()
    selected_student_ids = [item.student_id for item in items]
    if not selected_student_ids:
        return HandoverPreview(batch_id, batch.version, 0, 0, 0, 0, {})

    work_rows = await db.execute(
        select(WorkItem).where(
            WorkItem.student_id.in_(selected_student_ids),
            WorkItem.status == WorkItemStatus.blocked_handover,
        )
    )
    work_items = work_rows.scalars().all()
    now = utcnow()
    overdue_count = sum(
        1
        for item in work_items
        if item.kind == WorkItemKind.scheduled_follow_up
        and item.due_at is not None
        and item.due_at < now
    )
    by_kind = Counter(item.kind.value for item in work_items)
    high_intent_count = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.id.in_(selected_student_ids),
                Student.intent_level == IntentLevel.A,
            )
        )
    ).scalar_one()
    return HandoverPreview(
        batch_id=batch_id,
        version=batch.version,
        selected_count=len(items),
        open_work_item_count=len(work_items),
        overdue_count=overdue_count,
        high_intent_count=high_intent_count,
        by_kind=dict(sorted(by_kind.items())),
    )


async def _existing_transfer_result(
    db: AsyncSession,
    transfer: HandoverTransfer,
    requested_student_ids: Sequence[int],
) -> HandoverExecutionResult:
    batch = await db.get(HandoverBatch, transfer.handover_batch_id)
    rows = await db.execute(
        select(HandoverItem.student_id).where(
            HandoverItem.transfer_id == transfer.id,
            HandoverItem.status == HandoverItemStatus.transferred,
        )
    )
    transferred_ids = tuple(sorted(rows.scalars().all()))
    skipped_ids = ()
    if transfer.mode == HandoverTransferMode.selected:
        skipped_ids = tuple(
            sorted(set(requested_student_ids) - set(transferred_ids))
        )
    transferred_through_request = int(
        (
            await db.execute(
                select(func.coalesce(func.sum(HandoverTransfer.transferred_count), 0)).where(
                    HandoverTransfer.handover_batch_id == transfer.handover_batch_id,
                    HandoverTransfer.status == HandoverTransferStatus.completed,
                    HandoverTransfer.expected_batch_version
                    <= transfer.expected_batch_version,
                )
            )
        ).scalar_one()
    )
    remaining_count = max(batch.total_items - transferred_through_request, 0)
    return HandoverExecutionResult(
        transfer_id=transfer.id,
        transferred_ids=transferred_ids,
        skipped_ids=skipped_ids,
        remaining_count=remaining_count,
        batch_version=transfer.expected_batch_version + 1,
        completed=remaining_count == 0,
    )


async def _replay_transfer_result(
    db: AsyncSession,
    transfer: HandoverTransfer,
    *,
    batch_id: int,
    target_agent_id: int,
    mode: HandoverTransferMode,
    expected_batch_version: int,
    requested_student_ids: Sequence[int],
) -> HandoverExecutionResult:
    if (
        transfer.handover_batch_id != batch_id
        or transfer.target_agent_id != target_agent_id
        or transfer.mode != mode
        or transfer.expected_batch_version != expected_batch_version
    ):
        raise DomainConflict("幂等键已用于其他交接操作")
    result = await _existing_transfer_result(
        db,
        transfer,
        requested_student_ids,
    )
    if mode == HandoverTransferMode.selected and (
        transfer.requested_count != len(requested_student_ids)
        or not set(result.transferred_ids).issubset(requested_student_ids)
    ):
        raise DomainConflict("幂等键已用于其他交接操作")
    return result


async def _claim_batch_version(
    db: AsyncSession,
    batch: HandoverBatch,
    expected_version: int,
) -> None:
    """Compare-and-swap the batch version so concurrent transfers cannot both proceed.

    The version bump is the claim: it is atomic in the database, so correctness does
    not depend on the in-process lock above (which only serialises one worker). The
    loser gets a conflict before any transfer row is written. SQLite reports a lost
    race on a stale read snapshot as "database is locked"; treat that as a conflict too.
    """
    try:
        claimed = await db.execute(
            update(HandoverBatch)
            .where(
                HandoverBatch.id == batch.id,
                HandoverBatch.version == expected_version,
                HandoverBatch.status.in_(_ACTIVE_BATCH_STATUSES),
            )
            .values(version=HandoverBatch.version + 1)
        )
    except OperationalError as exc:
        raise DomainConflict("交接数据已变化，请刷新后重试") from exc
    if claimed.rowcount != 1:
        raise DomainConflict("交接数据已变化，请刷新后重试")
    await db.refresh(batch, attribute_names=["version"])


async def execute_transfer(
    db: AsyncSession,
    batch_id: int,
    target_agent_id: int,
    mode: HandoverTransferMode | str,
    operator: User,
    idempotency_key: str,
    expected_batch_version: int,
    student_ids: Sequence[int] = (),
) -> HandoverExecutionResult:
    transfer_mode = HandoverTransferMode(mode)
    requested_student_ids = tuple(sorted(set(student_ids)))
    existing_rows = await db.execute(
        select(HandoverTransfer).where(
            HandoverTransfer.idempotency_key == idempotency_key
        )
    )
    existing = existing_rows.scalar_one_or_none()
    if existing is not None:
        return await _replay_transfer_result(
            db,
            existing,
            batch_id=batch_id,
            target_agent_id=target_agent_id,
            mode=transfer_mode,
            expected_batch_version=expected_batch_version,
            requested_student_ids=requested_student_ids,
        )

    batch_rows = await db.execute(
        select(HandoverBatch)
        .where(HandoverBatch.id == batch_id)
        .with_for_update()
    )
    batch = batch_rows.scalar_one_or_none()
    if batch is None:
        raise DomainError("交接批次不存在")

    existing_rows = await db.execute(
        select(HandoverTransfer).where(
            HandoverTransfer.idempotency_key == idempotency_key
        )
    )
    existing = existing_rows.scalar_one_or_none()
    if existing is not None:
        return await _replay_transfer_result(
            db,
            existing,
            batch_id=batch_id,
            target_agent_id=target_agent_id,
            mode=transfer_mode,
            expected_batch_version=expected_batch_version,
            requested_student_ids=requested_student_ids,
        )
    if batch.version != expected_batch_version:
        raise DomainConflict("交接数据已变化，请刷新后重试")
    if batch.status not in _ACTIVE_BATCH_STATUSES:
        raise DomainConflict("交接批次已结束")
    if target_agent_id == batch.source_agent_id:
        raise DomainConflict("不能将交接学生转回原员工")
    await _claim_batch_version(db, batch, expected_batch_version)

    target_rows = await db.execute(
        select(User, AgentEmployment)
        .join(AgentEmployment, AgentEmployment.user_id == User.id)
        .where(User.id == target_agent_id)
    )
    target = target_rows.one_or_none()
    if (
        target is None
        or target[0].role != UserRole.agent
        or target[1].status != EmploymentStatus.active
    ):
        raise DomainConflict("目标员工不可接收交接学生")

    pending_count = (
        await db.execute(
            select(func.count(HandoverItem.id)).where(
                HandoverItem.handover_batch_id == batch_id,
                HandoverItem.status == HandoverItemStatus.pending,
            )
        )
    ).scalar_one()
    if transfer_mode == HandoverTransferMode.selected:
        if not requested_student_ids:
            raise DomainConflict("请选择要转移的学生")
        item_rows = await db.execute(
            select(HandoverItem)
            .where(
                HandoverItem.handover_batch_id == batch_id,
                HandoverItem.student_id.in_(requested_student_ids),
            )
            .with_for_update()
        )
        requested_items = item_rows.scalars().all()
        eligible = [
            item
            for item in requested_items
            if item.status == HandoverItemStatus.pending
        ]
        eligible_ids = {item.student_id for item in eligible}
        skipped_ids = tuple(
            sorted(set(requested_student_ids) - eligible_ids)
        )
        requested_count = len(requested_student_ids)
    else:
        item_rows = await db.execute(
            select(HandoverItem)
            .where(
                HandoverItem.handover_batch_id == batch_id,
                HandoverItem.status == HandoverItemStatus.pending,
            )
            .with_for_update()
        )
        eligible = item_rows.scalars().all()
        skipped_ids = ()
        requested_count = len(eligible)
    if not eligible:
        raise DomainConflict("没有可转移的待交接学生")

    now = utcnow()
    transfer = HandoverTransfer(
        handover_batch_id=batch_id,
        target_agent_id=target_agent_id,
        mode=transfer_mode,
        status=HandoverTransferStatus.running,
        requested_count=requested_count,
        transferred_count=0,
        conflict_count=len(skipped_ids),
        operator_id=operator.id,
        expected_batch_version=expected_batch_version,
        idempotency_key=idempotency_key,
        created_at=now,
    )
    try:
        async with db.begin_nested():
            db.add(transfer)
            await db.flush()
    except IntegrityError:
        winner_rows = await db.execute(
            select(HandoverTransfer).where(
                HandoverTransfer.idempotency_key == idempotency_key
            )
        )
        winner = winner_rows.scalar_one_or_none()
        if winner is not None:
            return await _replay_transfer_result(
                db,
                winner,
                batch_id=batch_id,
                target_agent_id=target_agent_id,
                mode=transfer_mode,
                expected_batch_version=expected_batch_version,
                requested_student_ids=requested_student_ids,
            )
        raise DomainConflict("交接操作已由其他请求执行")

    transferred_ids = tuple(sorted(item.student_id for item in eligible))
    await apply_assignment_changes(
        db,
        [
            AssignmentTarget(student_id=student_id, agent_id=target_agent_id)
            for student_id in transferred_ids
        ],
        operator=operator,
        reason="handover_transfer",
        batch_id=f"handover-transfer:{transfer.id}",
        handover_batch_id=batch_id,
        at=now,
    )
    await transfer_open_work_items(
        db,
        transferred_ids,
        target_agent_id,
        WorkItemStatus.blocked_handover,
        WorkItemStatus.open,
        handover_batch_id=batch_id,
        at=now,
    )

    for item in eligible:
        item.status = HandoverItemStatus.transferred
        item.target_agent_id = target_agent_id
        item.transfer_id = transfer.id
        item.transferred_at = now
        item.updated_at = now
    transfer.status = HandoverTransferStatus.completed
    transfer.transferred_count = len(eligible)
    transfer.completed_at = now

    remaining_count = pending_count - len(eligible)
    batch.remaining_items = remaining_count
    batch.transferred_items += len(eligible)
    completed = remaining_count == 0
    if completed:
        batch.status = HandoverBatchStatus.completed
        batch.completed_by = operator.id
        batch.completed_at = now
        source_user = await db.get(User, batch.source_agent_id)
        await set_employment_status(
            db,
            source_user,
            EmploymentStatus.offboarded,
            operator=operator,
            reason="handover_complete",
            handover_batch_id=batch.id,
            at=now,
        )
    else:
        batch.status = HandoverBatchStatus.in_progress

    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="执行离职交接",
            content=(
                f"批次 {batch.id} 转移 {len(eligible)} 条给员工 {target_agent_id}，"
                f"跳过 {len(skipped_ids)} 条，剩余 {remaining_count} 条"
            ),
            batch_id=f"handover-transfer:{transfer.id}",
        )
    )
    await db.flush()
    return HandoverExecutionResult(
        transfer_id=transfer.id,
        transferred_ids=transferred_ids,
        skipped_ids=skipped_ids,
        remaining_count=remaining_count,
        batch_version=batch.version,
        completed=completed,
    )
