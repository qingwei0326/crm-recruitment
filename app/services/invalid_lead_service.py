"""Invalid-lead reclaim, rollback and deletion rules (no FastAPI dependencies).

Routers in ``app/routers/admin_invalid.py`` validate requests and turn the
results of these functions into HTTP responses; the business rules live here.
"""

import hashlib

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_lead_utils import invalid_reason_predicate, student_search_predicate
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

RECLAIM_ROLLBACK_ACTIONS = {
    "回收无效线索",
    "批量回收无效线索",
    "分学校回收",
}


# ── Queries ──────────────────────────────────────────────────


def _invalid_where(invalid_reason: str | None, q: str = "") -> list:
    where = [Student.status.in_(statuses_for_canonical(StudentStatus.invalid))]
    reason_clause = invalid_reason_predicate(invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    search_clause = student_search_predicate(q)
    if search_clause is not None:
        where.append(search_clause)
    return where


def school_invalid_students_where(school_name: str, invalid_reason: str | None) -> list:
    """按学校 + 可选无效原因拼出无效线索查询条件。"""
    where = [
        Student.school_name == school_name,
        Student.status.in_(statuses_for_canonical(StudentStatus.invalid)),
    ]
    reason_clause = invalid_reason_predicate(invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    return where


async def load_students(db: AsyncSession, student_ids: list[int]) -> list[Student]:
    result = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    return list(result.scalars().all())


async def load_school_invalid_students(
    db: AsyncSession,
    school_name: str,
    invalid_reason: str | None,
) -> list[Student]:
    where = school_invalid_students_where(school_name, invalid_reason)
    return list((await db.execute(select(Student).where(*where))).scalars().all())


def non_invalid_students(students: list[Student]) -> list[Student]:
    return [
        student
        for student in students
        if canonical_student_status(student.status) != StudentStatus.invalid
    ]


async def list_invalid_students(
    db: AsyncSession,
    *,
    page: int,
    page_size: int,
    school_name: str | None,
    invalid_reason: str | None,
    q: str,
) -> dict:
    """列出所有标记为无效的线索，用于回收和重新分配"""
    where = _invalid_where(invalid_reason, q)
    if school_name:
        where.insert(1, Student.school_name == school_name)

    query = (
        select(Student, User.name.label("agent_name"))
        .outerjoin(User, User.id == Student.assigned_to)
        .where(*where)
        .order_by(Student.updated_at.desc())
    )

    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    query = query.offset((page - 1) * page_size).limit(page_size)
    rows = (await db.execute(query)).all()

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
    return {"total": total, "page": page, "page_size": page_size, "list": data}


async def invalid_school_groups(
    db: AsyncSession,
    *,
    invalid_reason: str | None,
    q: str,
) -> list[dict]:
    """按学校聚合无效线索数量"""
    result = await db.execute(
        select(Student.school_name, func.count())
        .where(*_invalid_where(invalid_reason, q))
        .group_by(Student.school_name)
        .order_by(func.count().desc())
    )
    return [{"name": name or "未知学校", "count": cnt} for name, cnt in result.all()]


# ── Preview tokens and impact ────────────────────────────────


def reclaim_preview_token(students: list[Student]) -> str:
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


def verify_reclaim_preview_token(students: list[Student], preview_token: str | None) -> None:
    """可选校验：仅当客户端带了 token 时才比对。

    适用范围：``reclaim-students`` 目前**没有**对应的 preview 发放口，客户端拿不到
    token，因此这里只能做可选校验。待该接口补上 preview 流程后，应统一改用
    ``verify_reclaim_preview_token_required``，让二次确认不可被省略。
    """
    if preview_token and preview_token != reclaim_preview_token(students):
        raise DomainConflict("预览后的学生数据已变化，请刷新后重新预览")


def verify_reclaim_preview_token_required(
    students: list[Student],
    preview_token: str | None,
) -> None:
    """强校验：缺失或过期一律拒绝（对齐 ``verify_delete_preview_token``）。

    用于有 preview 发放口的回收接口，二次确认必须走完，
    不允许靠「不传 preview_token」跳过。
    """
    if not preview_token:
        raise DomainConflict(
            "请先调用 /api/admin/invalid-students/reclaim-preview 预览确认后再执行回收"
        )
    if preview_token != reclaim_preview_token(students):
        raise DomainConflict("预览后的学生数据已变化，请刷新后重新预览")


def verify_delete_preview_token(students: list[Student], preview_token: str | None) -> None:
    """校验按校删除的预览 token：缺失或过期一律拒绝。"""
    if not preview_token:
        raise DomainConflict(
            "请先调用 /api/admin/delete-by-school-preview 预览确认后再执行删除"
        )
    if preview_token != reclaim_preview_token(students):
        raise DomainConflict("预览后的学生数据已变化，请刷新后重新预览")


def check_delete_batch_limit(students: list[Student], limit: int) -> str | None:
    """单次删除条数上限，避免一次误删整校数据。"""
    if len(students) > limit:
        return (
            f"单次按校删除上限 {limit} 条，"
            f"当前命中 {len(students)} 条；请先用无效原因或搜索条件缩小范围"
        )
    return None


async def reclaim_impact(db: AsyncSession, students: list[Student]) -> dict[str, int | str]:
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
        "preview_token": reclaim_preview_token(students),
    }


async def preview_reclaim(db: AsyncSession, students: list[Student]) -> dict[str, int | str]:
    await require_reclaimable_reasons(db, students)
    return await reclaim_impact(db, students)


# ── Reclaim ──────────────────────────────────────────────────


def _reset_reclaimed_student(student: Student) -> None:
    student.status = StudentStatus.not_contacted
    student.status_detail = ""
    student.outcome_reason_code = None
    # 与 delete_user/offboard 的回收契约保持一致：重置意向/阶段/求助，
    # 否则新话务员会看到旧的意向 A、阶段「已来访」，误以为是自己跟出来的，
    # 同时污染漏斗/转化统计。
    student.intent_level = IntentLevel.none
    student.stage = StudentStage.initial_contact
    student.need_help = False


async def _reclaim(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    *,
    action: str,
    agent: User | None,
) -> dict[str, int | str]:
    await require_reclaimable_reasons(db, students)
    impact = await reclaim_impact(db, students)
    now = utcnow()
    batch_id = make_batch_id("invalid-reclaim")
    agent_id = agent.id if agent else None
    destination = f"重新分配给 {agent.name}（ID:{agent.id}）" if agent else "进入未分配池"
    reclaimed_count = 0
    for student in students:
        old_agent_id = student.assigned_to
        rollback_note = make_reclaim_rollback_note(student)
        _reset_reclaimed_student(student)
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                action,
                content=f"从话务员 {old_agent_id or '未分配'} 回收，{destination}",
                old_status="无效",
                new_status="未联系",
                note_content=rollback_note,
                batch_id=batch_id,
            )
        )
        reclaimed_count += 1
    await apply_assignment_changes(
        db,
        [AssignmentTarget(student_id=student.id, agent_id=agent_id) for student in students],
        operator=current_user,
        reason="invalid_reclaim",
        batch_id=batch_id,
        at=now,
    )
    summary_action = (
        f"回收无效线索并重新分配给 {agent.name}（ID:{agent.id}）" if agent else action
    )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="线索回收汇总",
            content=(
                f"{summary_action}，共 {reclaimed_count} 条；"
                f"原有负责人 {impact['assigned_count']} 条；"
                f"有备注 {impact['students_with_notes']} 条（{impact['note_count']} 条备注）"
            ),
            old_status="无效",
            new_status="未联系",
            batch_id=batch_id,
        )
    )
    return {**impact, "reclaimed_count": reclaimed_count, "batch_id": batch_id}


async def reclaim_invalid_students_to_pool(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    action: str = "回收无效线索",
) -> dict[str, int | str]:
    """回收无效线索到未分配池（不提交事务）。"""
    return await _reclaim(db, students, current_user, action=action, agent=None)


async def reclaim_invalid_students_to_agent(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    agent: User,
) -> dict[str, int | str]:
    """回收无效线索并重新分配给话务员（不提交事务）。"""
    return await _reclaim(db, students, current_user, action="回收无效线索", agent=agent)


async def get_active_user(db: AsyncSession, user_id: int) -> User | None:
    result = await db.execute(select(User).where(User.id == user_id, User.is_active))
    return result.scalar_one_or_none()


# ── Rollback ─────────────────────────────────────────────────


async def _load_reclaim_batch(db: AsyncSession, batch_id: str):
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

    students = {}
    student_ids = [log.target_student_id for log in status_logs]
    if student_ids:
        rows = await db.execute(select(Student).where(Student.id.in_(student_ids)))
        students = {student.id: student for student in rows.scalars().all()}
    return status_logs, assignment_payloads, students


def _rollback_skip_reason(student: Student | None, payload, assignment) -> str:
    """Return why a reclaimed student cannot be rolled back, or "" if it can."""
    expected_assigned_to = assignment.get("new_assigned_to") if assignment else None
    if payload is None:
        return "缺少回收快照"
    if student is None:
        return "学生不存在"
    if student.assigned_to != expected_assigned_to:
        return "负责人已变化"
    if (
        student.status != StudentStatus.not_contacted
        or student.status_detail
        or student.outcome_reason_code is not None
        or student.intent_level != IntentLevel.none
        or student.stage != StudentStage.initial_contact
        or student.need_help
    ):
        return "学生状态已变化"
    return ""


async def build_reclaim_rollback_plan(db: AsyncSession, batch_id: str) -> dict:
    status_logs, assignment_payloads, students = await _load_reclaim_batch(db, batch_id)
    items = []
    for log in status_logs:
        student = students.get(log.target_student_id)
        payload = parse_reclaim_rollback_note(log.note_content or "")
        assignment = assignment_payloads.get(log.target_student_id)
        reason = _rollback_skip_reason(student, payload, assignment)
        items.append(
            {
                "log_id": log.id,
                "student_id": log.target_student_id,
                "student_name": student.name if student else "",
                "school_name": student.school_name if student else "",
                "old_status": payload.get("old_status") if payload else "",
                "old_assigned_to": assignment.get("old_assigned_to") if assignment else None,
                "current_assigned_to": student.assigned_to if student else None,
                "status": "skipped" if reason else "ok",
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


async def rollback_reclaim_batch(
    db: AsyncSession,
    batch_id: str,
    current_user: User,
) -> dict | None:
    """Restore a reclaim batch (不提交事务). Returns None when the batch has no reclaim logs."""
    status_logs, assignment_payloads, students = await _load_reclaim_batch(db, batch_id)
    if not status_logs:
        return None

    targets = []
    skipped = 0
    for log in status_logs:
        student = students.get(log.target_student_id)
        payload = parse_reclaim_rollback_note(log.note_content or "")
        assignment = assignment_payloads.get(log.target_student_id)
        if _rollback_skip_reason(student, payload, assignment):
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
    return {"batch_id": batch_id, "rolled_back_count": rolled_back, "skipped_count": skipped}


# ── Delete ───────────────────────────────────────────────────


async def delete_invalid_students(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    action: str = "批量删除无效线索",
) -> int:
    """删除无效线索及全部关联记录（不提交事务）。"""
    return await delete_students_cascade(db, students, current_user, action=action)
