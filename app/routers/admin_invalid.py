from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_lead_utils import _student_search_predicate, invalid_reason_predicate
from app.auth import (
    ADMIN_OP_INVALID_DELETE,
    ADMIN_OP_INVALID_RECLAIM,
    ADMIN_PAGE_INVALID_RECLAIM,
    require_operation_permission,
    require_page_permission,
)
from app.database import get_db
from app.models import (
    Call,
    DialLog,
    FollowUp,
    IntentLevel,
    LeadViewLog,
    Note,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
    User,
    Visit,
)
from app.schemas import Response
from app.status_policy import (
    canonical_status_value,
    canonical_student_status,
    status_detail_value,
    statuses_for_canonical,
)
from app.utils import make_operation_log, mask_phone, utcnow

router = APIRouter(prefix="/api/admin", tags=["管理"])


async def delete_students_with_related(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    action: str = "批量删除无效线索",
) -> int:
    deleted_count = 0
    for student in students:
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                action,
                content=f"删除学生 {student.name}（含通话/备注/回访/到访/日志）",
            )
        )
        for model in (Call, Note, FollowUp, LeadViewLog, Visit, DialLog):
            await db.execute(delete(model).where(model.student_id == student.id))
        await db.delete(student)
        deleted_count += 1
    return deleted_count


async def reclaim_invalid_students_to_pool(
    db: AsyncSession,
    students: list[Student],
    current_user: User,
    action: str = "回收无效线索",
) -> int:
    reclaimed_count = 0
    for student in students:
        old_agent_id = student.assigned_to
        student.status = StudentStatus.not_contacted
        student.status_detail = ""
        student.intent_level = IntentLevel.none
        student.stage = StudentStage.initial_contact
        student.need_help = False
        student.assigned_to = None
        student.assigned_at = None

        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                action,
                content=f"从话务员 {old_agent_id or '未分配'} 回收，进入未分配池",
                old_status="无效",
                new_status="未联系",
            )
        )
        reclaimed_count += 1
    return reclaimed_count


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
    search_clause = _student_search_predicate(q)
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


class BulkInvalidStudentsReq(BaseModel):
    student_ids: list[int]


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

    # 回收：重置状态为未联系，重新分配
    now = utcnow()
    reclaimed_count = 0
    for student in students:
        old_agent_id = student.assigned_to
        student.status = StudentStatus.not_contacted
        student.status_detail = ""
        # 与 delete_user/offboard 的回收契约保持一致：重置意向/阶段/求助，
        # 否则新话务员会看到旧的意向 A、阶段「已来访」，误以为是自己跟出来的，
        # 同时污染漏斗/转化统计。
        student.intent_level = IntentLevel.none
        student.stage = StudentStage.initial_contact
        student.need_help = False
        student.assigned_to = body.agent_id
        student.assigned_at = now

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
            )
        )
        reclaimed_count += 1

    await db.commit()

    return Response.ok(
        {
            "reclaimed_count": reclaimed_count,
            "agent_id": body.agent_id,
            "agent_name": agent.name,
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

    reclaimed_count = await reclaim_invalid_students_to_pool(
        db, students, current_user, action="批量回收无效线索"
    )
    await db.commit()
    return Response.ok({"reclaimed_count": reclaimed_count})


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
    where = [
        Student.school_name == body.school_name,
        Student.status.in_(statuses_for_canonical(StudentStatus.invalid)),
    ]
    reason_clause = invalid_reason_predicate(body.invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    result = await db.execute(select(Student).where(*where))
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可回收的无效线索")

    reclaimed_count = await reclaim_invalid_students_to_pool(
        db, students, current_user, action="分学校回收"
    )

    await db.commit()

    return Response.ok(
        {
            "reclaimed_count": reclaimed_count,
            "school_name": body.school_name,
        }
    )


@router.post("/delete-by-school")
async def delete_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_DELETE)),
):
    """按学校批量删除无效线索（含关联的通话/备注/回访/到访/日志）"""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")

    where = [
        Student.school_name == body.school_name,
        Student.status.in_(statuses_for_canonical(StudentStatus.invalid)),
    ]
    reason_clause = invalid_reason_predicate(body.invalid_reason or "")
    if reason_clause is not None:
        where.append(reason_clause)
    result = await db.execute(select(Student).where(*where))
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可删除的无效线索")

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
    search_clause = _student_search_predicate(q)
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
