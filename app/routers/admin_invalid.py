import hashlib

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_lead_utils import invalid_reason_predicate, student_search_predicate
from app.auth import (
    ADMIN_OP_ASSIGNMENT_ROLLBACK,
    ADMIN_OP_INVALID_DELETE,
    ADMIN_OP_INVALID_RECLAIM,
    ADMIN_PAGE_INVALID_RECLAIM,
    require_operation_permission,
    require_page_permission,
)
from app.database import get_db
from app.domain_errors import DomainConflict
from app.models import (
    IntentLevel,
    Note,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
    User,
)
from app.schemas import Response
from app.services.assignment_service import AssignmentTarget, apply_assignment_changes
from app.services.lead_outcome_service import require_reclaimable_reasons
from app.status_policy import (
    canonical_status_value,
    canonical_student_status,
    status_detail_value,
    statuses_for_canonical,
)
from app.student_delete import delete_students_cascade
from app.utils import (
    make_batch_id,
    make_operation_log,
    make_reclaim_rollback_note,
    mask_phone,
    parse_assignment_rollback_note,
    parse_reclaim_rollback_note,
    utcnow,
)

router = APIRouter(prefix="/api/admin", tags=["管理"])


async def delete_students_with_related(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    action: str = "批量删除无效线索",
) -> int:
    return await delete_students_cascade(db, students, current_user, action=action)


async def reclaim_invalid_students_to_pool(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    action: str = "回收无效线索",
) -> dict[str, int | str]:
    await require_reclaimable_reasons(db, students)
    impact = await _reclaim_impact(db, students)
    reclaimed_count = 0
    now = utcnow()
    batch_id = make_batch_id("invalid-reclaim")
    for student in students:
        old_agent_id = student.assigned_to
        rollback_note = make_reclaim_rollback_note(student)
        student.status = StudentStatus.not_contacted
        student.status_detail = ""
        student.outcome_reason_code = None
        student.intent_level = IntentLevel.none
        student.stage = StudentStage.initial_contact
        student.need_help = False

        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                action,
                content=f"从话务员 {old_agent_id or '未分配'} 回收，进入未分配池",
                old_status="无效",
                new_status="未联系",
                note_content=rollback_note,
                batch_id=batch_id,
            )
        )
        reclaimed_count += 1
    await apply_assignment_changes(
        db,
        [AssignmentTarget(student_id=student.id, agent_id=None) for student in students],
        operator=current_user,
        reason="invalid_reclaim",
        batch_id=batch_id,
        at=now,
    )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="线索回收汇总",
            content=(
                f"{action}，共 {reclaimed_count} 条；"
                f"原有负责人 {impact['assigned_count']} 条；"
                f"有备注 {impact['students_with_notes']} 条（{impact['note_count']} 条备注）"
            ),
            old_status="无效",
            new_status="未联系",
            batch_id=batch_id,
        )
    )
    return {**impact, "reclaimed_count": reclaimed_count, "batch_id": batch_id}


@router.get("/invalid-students")
async def list_invalid_students(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    school_name: str | None = Query(None),
    invalid_reason: str | None = Query(None),
    q: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_INVALID_RECLAIM)),
):
    """列出所有标记为无效的线索，用于回收和重新分配"""
    invalid_statuses = statuses_for_canonical(StudentStatus.invalid)
    where = [Student.status.in_(invalid_statuses)]
    if school_name:
        where.append(Student.school_name == school_name)
    reason_clause = invalid_reason_predicate(invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    search_clause = student_search_predicate(q)
    if search_clause is not None:
        where.append(search_clause)

    query = (
        select(Student, User.name.label("agent_name"))
        .outerjoin(User, User.id == Student.assigned_to)
        .where(*where)
        .order_by(Student.updated_at.desc())
    )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    query = query.offset((page - 1) * page_size).limit(page_size)
    result = await db.execute(query)
    rows = result.all()

    # 获取无效原因（从操作日志中提取）
    student_ids = [s.id for s, _ in rows]
    invalid_reasons = {}
    if student_ids:
        # 查询最近一次标记为无效的操作日志
        logs_result = await db.execute(
            select(
                OperationLog.target_student_id,
                OperationLog.note_content,
                OperationLog.operator_name,
                OperationLog.content,
                OperationLog.created_at,
            )
            .where(
                OperationLog.target_student_id.in_(student_ids),
                OperationLog.action == "修改状态",
                OperationLog.new_status == "无效",
            )
            .order_by(OperationLog.created_at.desc())
        )
        for sid, reason, operator_name, content, created_at in logs_result.all():
            if sid not in invalid_reasons:
                invalid_reasons[sid] = {
                    "reason": reason or "",
                    "operator_name": operator_name or "",
                    "content": content or "",
                    "created_at": str(created_at) if created_at else "",
                }

    data = [
        {
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "school_name": s.school_name,
            "guardian_name": s.guardian_name,
            "guardian_phone": mask_phone(s.guardian_phone),
            "guardian2_name": s.guardian2_name,
            "guardian2_phone": mask_phone(s.guardian2_phone),
            "assigned_to": s.assigned_to,
            "agent_name": agent_name or "未分配",
            "status": canonical_status_value(s.status),
            "status_detail": status_detail_value(s.status, s.status_detail),
            "outcome_reason_code": s.outcome_reason_code,
            "invalid_reason": status_detail_value(s.status, s.status_detail)
            or invalid_reasons.get(s.id, {}).get("reason", ""),
            "invalid_operator_name": invalid_reasons.get(s.id, {}).get("operator_name", ""),
            "invalid_content": invalid_reasons.get(s.id, {}).get("content", ""),
            "invalid_at": invalid_reasons.get(s.id, {}).get("created_at", ""),
            "updated_at": str(s.updated_at),
            "case_no": s.case_no,
        }
        for s, agent_name in rows
    ]

    return Response.ok(
        {
            "total": total,
            "page": page,
            "page_size": page_size,
            "list": data,
        }
    )


class ReclaimStudentsReq(BaseModel):
    student_ids: list[int]
    agent_id: int
    preview_token: str | None = None


class BulkInvalidStudentsReq(BaseModel):
    student_ids: list[int]
    preview_token: str | None = None


async def _reclaim_impact(
    db: AsyncSession,
    students: list[Student],
) -> dict[str, int | str]:
    """Build the confirmation summary without changing any rows."""
    student_ids = [student.id for student in students]
    note_count = 0
    students_with_notes = 0
    if student_ids:
        note_rows = await db.execute(
            select(Note.student_id, func.count(Note.id))
            .where(Note.student_id.in_(student_ids))
            .group_by(Note.student_id)
        )
        note_counts = dict(note_rows.all())
        students_with_notes = len(note_counts)
        note_count = sum(note_counts.values())
    return {
        "student_count": len(students),
        "assigned_count": sum(student.assigned_to is not None for student in students),
        "unassigned_count": sum(student.assigned_to is None for student in students),
        "students_with_notes": students_with_notes,
        "note_count": note_count,
        "preview_token": _reclaim_preview_token(students),
    }


def _reclaim_preview_token(students: list[Student]) -> str:
    snapshot = "|".join(
        ":".join(
            (
                str(student.id),
                str(student.status),
                student.status_detail or "",
                student.outcome_reason_code or "",
                str(student.assigned_to or ""),
                str(student.updated_at or ""),
            )
        )
        for student in sorted(students, key=lambda item: item.id)
    )
    return hashlib.sha256(snapshot.encode("utf-8")).hexdigest()


def _verify_reclaim_preview_token(
    students: list[Student],
    preview_token: str | None,
) -> None:
    """可选校验：仅当客户端带了 token 时才比对。

    适用范围：``reclaim-students`` / ``reclaim-by-school`` 两个接口目前**没有**
    对应的 preview 发放口，客户端拿不到 token，因此这里只能做可选校验。
    待这两个接口补上 preview 流程后，应统一改用
    ``_verify_reclaim_preview_token_required``，让二次确认不可被省略。
    """
    if preview_token and preview_token != _reclaim_preview_token(students):
        raise DomainConflict("预览后的学生数据已变化，请刷新后重新预览")


def _verify_reclaim_preview_token_required(
    students: list[Student],
    preview_token: str | None,
) -> None:
    """强校验：缺失或过期一律拒绝（对齐 ``_verify_delete_preview_token``）。

    用于 ``/invalid-students/reclaim``——该接口有完整的
    ``/invalid-students/reclaim-preview`` 发放口，二次确认必须走完，
    不允许靠「不传 preview_token」跳过。
    """
    if not preview_token:
        raise DomainConflict(
            "请先调用 /api/admin/invalid-students/reclaim-preview 预览确认后再执行回收"
        )
    if preview_token != _reclaim_preview_token(students):
        raise DomainConflict("预览后的学生数据已变化，请刷新后重新预览")


# 按校删除是不可回滚的批量物理删除，二次确认不能靠客户端「不传 preview_token」跳过。
MAX_DELETE_BY_SCHOOL_STUDENTS = 500


def _verify_delete_preview_token(
    students: list[Student],
    preview_token: str | None,
) -> None:
    """校验按校删除的预览 token：缺失或过期一律拒绝。"""
    if not preview_token:
        raise DomainConflict(
            "请先调用 /api/admin/delete-by-school-preview 预览确认后再执行删除"
        )
    if preview_token != _reclaim_preview_token(students):
        raise DomainConflict("预览后的学生数据已变化，请刷新后重新预览")


def _check_delete_batch_limit(students: list[Student]) -> str | None:
    """单次删除条数上限，避免一次误删整校数据。"""
    if len(students) > MAX_DELETE_BY_SCHOOL_STUDENTS:
        return (
            f"单次按校删除上限 {MAX_DELETE_BY_SCHOOL_STUDENTS} 条，"
            f"当前命中 {len(students)} 条；请先用无效原因或搜索条件缩小范围"
        )
    return None


def _school_invalid_students_query(school_name: str, invalid_reason: str | None) -> list:
    """按学校 + 可选无效原因拼出无效线索查询条件。"""
    where = [
        Student.school_name == school_name,
        Student.status.in_(statuses_for_canonical(StudentStatus.invalid)),
    ]
    reason_clause = invalid_reason_predicate(invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    return where


@router.post("/invalid-students/reclaim-preview")
async def preview_reclaim_invalid_students(
    body: BulkInvalidStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """Preview selected invalid leads before moving them to the unassigned pool."""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")
    students = list(
        (
            await db.execute(select(Student).where(Student.id.in_(body.student_ids)))
        ).scalars().all()
    )
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")
    non_invalid = [
        student
        for student in students
        if canonical_student_status(student.status) != StudentStatus.invalid
    ]
    if non_invalid:
        return Response.error(code=1, msg="部分学生已不是无效状态，请刷新后重试")
    await require_reclaimable_reasons(db, students)
    return Response.ok(await _reclaim_impact(db, students))


@router.post("/reclaim-students")
async def reclaim_invalid_students(
    body: ReclaimStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """回收无效线索并重新分配给话务员验证"""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    # 验证话务员存在且激活
    agent_result = await db.execute(select(User).where(User.id == body.agent_id, User.is_active))
    agent = agent_result.scalar_one_or_none()
    if not agent:
        return Response.error(code=1, msg="话务员不存在或已禁用")

    # 查询要回收的学生，确保都是无效状态
    students_result = await db.execute(select(Student).where(Student.id.in_(body.student_ids)))
    students = students_result.scalars().all()

    if not students:
        return Response.error(code=1, msg="未找到指定的学生")

    # 检查是否都是无效状态
    non_invalid = [
        s for s in students if canonical_student_status(s.status) != StudentStatus.invalid
    ]
    if non_invalid:
        names = ", ".join([s.name for s in non_invalid[:3]])
        return Response.error(code=1, msg=f"部分学生不是无效状态，无法回收: {names}")

    # 注意：/reclaim-students 目前没有独立的 preview 发放口，客户端拿不到 token，
    # 因此这里只能做可选校验。待补上 preview 接口后再改用
    # _verify_reclaim_preview_token_required，让二次确认不可被省略。
    _verify_reclaim_preview_token(students, body.preview_token)
    await require_reclaimable_reasons(db, students)
    impact = await _reclaim_impact(db, students)

    # 回收：重置状态为未联系，重新分配
    now = utcnow()
    batch_id = make_batch_id("invalid-reclaim")
    reclaimed_count = 0
    for student in students:
        old_agent_id = student.assigned_to
        rollback_note = make_reclaim_rollback_note(student)
        student.status = StudentStatus.not_contacted
        student.status_detail = ""
        student.outcome_reason_code = None
        # 与 delete_user/offboard 的回收契约保持一致：重置意向/阶段/求助，
        # 否则新话务员会看到旧的意向 A、阶段「已来访」，误以为是自己跟出来的，
        # 同时污染漏斗/转化统计。
        student.intent_level = IntentLevel.none
        student.stage = StudentStage.initial_contact
        student.need_help = False

        # 记录操作日志
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "回收无效线索",
                content=(
                    f"从话务员 {old_agent_id or '未分配'} 回收，"
                    f"重新分配给 {agent.name}（ID:{body.agent_id}）"
                ),
                old_status="无效",
                new_status="未联系",
                note_content=rollback_note,
                batch_id=batch_id,
            )
        )
        reclaimed_count += 1

    await apply_assignment_changes(
        db,
        [
            AssignmentTarget(student_id=student.id, agent_id=body.agent_id)
            for student in students
        ],
        operator=current_user,
        reason="invalid_reclaim",
        batch_id=batch_id,
        at=now,
    )

    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="线索回收汇总",
            content=(
                f"回收无效线索并重新分配给 {agent.name}"
                f"（ID:{body.agent_id}），共 {reclaimed_count} 条；"
                f"原有负责人 {impact['assigned_count']} 条；"
                f"有备注 {impact['students_with_notes']} 条（{impact['note_count']} 条备注）"
            ),
            old_status="无效",
            new_status="未联系",
            batch_id=batch_id,
        )
    )

    await db.commit()

    return Response.ok(
        {
            "reclaimed_count": reclaimed_count,
            "agent_id": body.agent_id,
            "agent_name": agent.name,
            "batch_id": batch_id,
        }
    )


@router.post("/invalid-students/reclaim")
async def reclaim_invalid_students_to_unassigned_pool(
    body: BulkInvalidStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """回收选中的无效线索到未分配池。"""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    students_result = await db.execute(select(Student).where(Student.id.in_(body.student_ids)))
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")

    non_invalid = [
        student
        for student in students
        if canonical_student_status(student.status) != StudentStatus.invalid
    ]
    if non_invalid:
        names = ", ".join([student.name for student in non_invalid[:3]])
        return Response.error(code=1, msg=f"部分学生不是无效状态，无法回收: {names}")

    # 该接口有 /invalid-students/reclaim-preview 发放口，二次确认必须走完。
    _verify_reclaim_preview_token_required(students, body.preview_token)
    reclaimed_count = await reclaim_invalid_students_to_pool(
        db, students, current_user, action="批量回收无效线索"
    )
    await db.commit()
    return Response.ok(reclaimed_count)


class ReclaimRollbackReq(BaseModel):
    confirm: bool = False


RECLAIM_ROLLBACK_ACTIONS = {
    "回收无效线索",
    "批量回收无效线索",
    "分学校回收",
}


async def _build_reclaim_rollback_plan(db: AsyncSession, batch_id: str) -> dict:
    status_rows = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action.in_(RECLAIM_ROLLBACK_ACTIONS),
            OperationLog.target_student_id.is_not(None),
        )
        .order_by(OperationLog.id.asc())
    )
    status_logs = status_rows.scalars().all()
    assignment_rows = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action == "修改归属",
            OperationLog.target_student_id.is_not(None),
        )
        .order_by(OperationLog.id.asc())
    )
    assignment_payloads = {}
    for log in assignment_rows.scalars().all():
        payload = parse_assignment_rollback_note(log.note_content or "")
        if payload is not None:
            assignment_payloads[log.target_student_id] = payload

    student_ids = [log.target_student_id for log in status_logs]
    students = {}
    if student_ids:
        rows = await db.execute(select(Student).where(Student.id.in_(student_ids)))
        students = {student.id: student for student in rows.scalars().all()}

    items = []
    for log in status_logs:
        student = students.get(log.target_student_id)
        payload = parse_reclaim_rollback_note(log.note_content or "")
        assignment = assignment_payloads.get(log.target_student_id)
        expected_assigned_to = assignment.get("new_assigned_to") if assignment else None
        status = "ok"
        reason = ""
        if payload is None:
            status, reason = "skipped", "缺少回收快照"
        elif student is None:
            status, reason = "skipped", "学生不存在"
        elif student.assigned_to != expected_assigned_to:
            status, reason = "skipped", "负责人已变化"
        elif (
            student.status != StudentStatus.not_contacted
            or student.status_detail
            or student.outcome_reason_code is not None
            or student.intent_level != IntentLevel.none
            or student.stage != StudentStage.initial_contact
            or student.need_help
        ):
            status, reason = "skipped", "学生状态已变化"
        items.append(
            {
                "log_id": log.id,
                "student_id": log.target_student_id,
                "student_name": student.name if student else "",
                "school_name": student.school_name if student else "",
                "old_status": payload.get("old_status") if payload else "",
                "old_assigned_to": assignment.get("old_assigned_to") if assignment else None,
                "current_assigned_to": student.assigned_to if student else None,
                "status": status,
                "reason": reason,
            }
        )
    rollbackable = [item for item in items if item["status"] == "ok"]
    return {
        "batch_id": batch_id,
        "total_logs": len(status_logs),
        "rollbackable_count": len(rollbackable),
        "skipped_count": len(items) - len(rollbackable),
        "items": items[:100],
    }


@router.get("/reclaim-rollbacks/{batch_id}")
async def preview_reclaim_rollback(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_ASSIGNMENT_ROLLBACK)),
):
    batch_id = batch_id.strip()
    if not batch_id:
        return Response.error(code=1, msg="batch_id不能为空")
    plan = await _build_reclaim_rollback_plan(db, batch_id)
    if not plan["total_logs"]:
        return Response.error(code=1, msg="未找到可回滚的回收批次")
    return Response.ok(plan)


@router.post("/reclaim-rollbacks/{batch_id}")
async def rollback_reclaim_batch(
    batch_id: str,
    body: ReclaimRollbackReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_ASSIGNMENT_ROLLBACK)),
):
    batch_id = batch_id.strip()
    if not batch_id:
        return Response.error(code=1, msg="batch_id不能为空")
    if not body.confirm:
        return Response.error(code=1, msg="请确认后再执行回滚")

    status_rows = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action.in_(RECLAIM_ROLLBACK_ACTIONS),
            OperationLog.target_student_id.is_not(None),
        )
        .order_by(OperationLog.id.asc())
    )
    status_logs = status_rows.scalars().all()
    assignment_rows = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action == "修改归属",
            OperationLog.target_student_id.is_not(None),
        )
    )
    assignment_payloads = {}
    for log in assignment_rows.scalars().all():
        payload = parse_assignment_rollback_note(log.note_content or "")
        if payload is not None:
            assignment_payloads[log.target_student_id] = payload
    if not status_logs:
        return Response.error(code=1, msg="未找到可回滚的回收批次")

    student_ids = [log.target_student_id for log in status_logs]
    rows = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    students = {student.id: student for student in rows.scalars().all()}
    targets = []
    skipped = 0
    for log in status_logs:
        student = students.get(log.target_student_id)
        payload = parse_reclaim_rollback_note(log.note_content or "")
        assignment = assignment_payloads.get(log.target_student_id)
        expected_assigned_to = assignment.get("new_assigned_to") if assignment else None
        if (
            payload is None
            or student is None
            or student.assigned_to != expected_assigned_to
            or student.status != StudentStatus.not_contacted
            or student.status_detail
            or student.outcome_reason_code is not None
            or student.intent_level != IntentLevel.none
            or student.stage != StudentStage.initial_contact
            or student.need_help
        ):
            skipped += 1
            continue
        try:
            old_status = StudentStatus[payload["old_status"]]
            old_intent = IntentLevel[payload["old_intent_level"]]
            old_stage = StudentStage[payload["old_stage"]]
        except (KeyError, TypeError):
            skipped += 1
            continue
        student.status = old_status
        student.status_detail = payload.get("old_status_detail", "")
        student.outcome_reason_code = payload.get("old_outcome_reason_code")
        student.intent_level = old_intent
        student.stage = old_stage
        student.need_help = bool(payload.get("old_need_help"))
        targets.append(
            AssignmentTarget(
                student_id=student.id,
                agent_id=assignment.get("old_assigned_to") if assignment else None,
            )
        )

    rolled_back = len(targets)
    if targets:
        await apply_assignment_changes(
            db,
            targets,
            operator=current_user,
            reason="invalid_reclaim_rollback",
            batch_id=f"rollback:{batch_id}",
        )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="回收回滚汇总",
            content=f"回滚回收批次 {batch_id}，成功 {rolled_back} 条，跳过 {skipped} 条",
            batch_id=batch_id,
        )
    )
    await db.commit()
    return Response.ok(
        {
            "batch_id": batch_id,
            "rolled_back_count": rolled_back,
            "skipped_count": skipped,
        }
    )


@router.post("/invalid-students/delete")
async def delete_invalid_students(
    body: BulkInvalidStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_DELETE)),
):
    """删除选中的无效线索及关联记录。"""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    students_result = await db.execute(select(Student).where(Student.id.in_(body.student_ids)))
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")

    non_invalid = [
        student
        for student in students
        if canonical_student_status(student.status) != StudentStatus.invalid
    ]
    if non_invalid:
        names = ", ".join([student.name for student in non_invalid[:3]])
        return Response.error(code=1, msg=f"部分学生不是无效状态，无法删除: {names}")

    deleted_count = await delete_students_with_related(
        db, students, current_user, action="批量删除无效线索"
    )
    await db.commit()
    return Response.ok({"deleted_count": deleted_count})


# ── 分学校回收 ──────────────────────────────────────────────


class ReclaimBySchoolReq(BaseModel):
    school_name: str
    invalid_reason: str | None = None
    preview_token: str | None = None


@router.post("/reclaim-by-school-preview")
async def preview_reclaim_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """Preview a school-level invalid-lead reclaim without changing rows."""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")
    where = _school_invalid_students_query(body.school_name, body.invalid_reason)
    students = list((await db.execute(select(Student).where(*where))).scalars().all())
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可回收的无效线索")
    await require_reclaimable_reasons(db, students)
    return Response.ok(await _reclaim_impact(db, students))


@router.post("/reclaim-by-school")
async def reclaim_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """按学校一键回收无效线索 → assigned_to=null（未分配池）"""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")

    # 查出该校所有无效学员
    where = _school_invalid_students_query(body.school_name, body.invalid_reason)
    result = await db.execute(select(Student).where(*where))
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可回收的无效线索")

    # 该接口有 /reclaim-by-school-preview 发放口，二次确认必须走完。
    _verify_reclaim_preview_token_required(students, body.preview_token)

    reclaimed_count = await reclaim_invalid_students_to_pool(
        db, students, current_user, action="分学校回收"
    )

    await db.commit()

    return Response.ok({**reclaimed_count, "school_name": body.school_name})


@router.post("/delete-by-school-preview")
async def preview_delete_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_DELETE)),
):
    """按校删除的预览确认：返回命中条数与 preview_token（删除接口强制校验）。"""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")

    where = _school_invalid_students_query(body.school_name, body.invalid_reason)
    students = list((await db.execute(select(Student).where(*where))).scalars().all())
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可删除的无效线索")

    limit_error = _check_delete_batch_limit(students)
    if limit_error:
        return Response.error(code=1, msg=limit_error)

    return Response.ok(
        {
            "school_name": body.school_name,
            "student_count": len(students),
            "preview_token": _reclaim_preview_token(students),
        }
    )


@router.post("/delete-by-school")
async def delete_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_DELETE)),
):
    """按学校批量删除无效线索（含关联的通话/备注/回访/到访/日志）

    必须先调用 /delete-by-school-preview 拿到 preview_token，缺失或数据已变化一律拒绝。
    """
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")

    where = _school_invalid_students_query(body.school_name, body.invalid_reason)
    result = await db.execute(select(Student).where(*where))
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可删除的无效线索")

    limit_error = _check_delete_batch_limit(students)
    if limit_error:
        return Response.error(code=1, msg=limit_error)
    _verify_delete_preview_token(students, body.preview_token)

    deleted_count = await delete_students_with_related(
        db, students, current_user, action="批量删除无效线索"
    )

    await db.commit()

    return Response.ok(
        {
            "deleted_count": deleted_count,
            "school_name": body.school_name,
        }
    )


@router.get("/invalid-school-groups")
async def invalid_school_groups(
    invalid_reason: str | None = Query(None),
    q: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_INVALID_RECLAIM)),
):
    """按学校聚合无效线索数量"""
    where = [Student.status.in_(statuses_for_canonical(StudentStatus.invalid))]
    reason_clause = invalid_reason_predicate(invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    search_clause = student_search_predicate(q)
    if search_clause is not None:
        where.append(search_clause)
    result = await db.execute(
        select(Student.school_name, func.count())
        .where(*where)
        .group_by(Student.school_name)
        .order_by(func.count().desc())
    )
    groups = [{"name": name or "未知学校", "count": cnt} for name, cnt in result.all()]
    return Response.ok({"groups": groups})
