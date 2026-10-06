from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_ASSIGNMENT_ROLLBACK,
    ADMIN_OP_INVALID_DELETE,
    ADMIN_OP_INVALID_RECLAIM,
    ADMIN_PAGE_INVALID_RECLAIM,
    require_operation_permission,
    require_page_permission,
)
from app.database import get_db
from app.models import Student, User
from app.schemas import Response
from app.services import invalid_lead_service as invalid_leads

router = APIRouter(prefix="/api/admin", tags=["管理"])

# 按校删除是不可回滚的批量物理删除，二次确认不能靠客户端「不传 preview_token」跳过。
MAX_DELETE_BY_SCHOOL_STUDENTS = 500


def _check_delete_batch_limit(students: list[Student]) -> str | None:
    """单次删除条数上限，避免一次误删整校数据。"""
    return invalid_leads.check_delete_batch_limit(students, MAX_DELETE_BY_SCHOOL_STUDENTS)


def _non_invalid_error(students: list[Student], verb: str):
    non_invalid = invalid_leads.non_invalid_students(students)
    if not non_invalid:
        return None
    names = ", ".join([student.name for student in non_invalid[:3]])
    return Response.error(code=1, msg=f"部分学生不是无效状态，无法{verb}: {names}")


class ReclaimStudentsReq(BaseModel):
    student_ids: list[int]
    agent_id: int
    preview_token: str | None = None


class BulkInvalidStudentsReq(BaseModel):
    student_ids: list[int]
    preview_token: str | None = None


class ReclaimRollbackReq(BaseModel):
    confirm: bool = False


class ReclaimBySchoolReq(BaseModel):
    school_name: str
    invalid_reason: str | None = None
    preview_token: str | None = None


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
    return Response.ok(
        await invalid_leads.list_invalid_students(
            db,
            page=page,
            page_size=page_size,
            school_name=school_name,
            invalid_reason=invalid_reason,
            q=q,
        )
    )


@router.post("/invalid-students/reclaim-preview")
async def preview_reclaim_invalid_students(
    body: BulkInvalidStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """Preview selected invalid leads before moving them to the unassigned pool."""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")
    students = await invalid_leads.load_students(db, body.student_ids)
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")
    if invalid_leads.non_invalid_students(students):
        return Response.error(code=1, msg="部分学生已不是无效状态，请刷新后重试")
    return Response.ok(await invalid_leads.preview_reclaim(db, students))


@router.post("/reclaim-students")
async def reclaim_invalid_students(
    body: ReclaimStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """回收无效线索并重新分配给话务员验证"""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    agent = await invalid_leads.get_active_user(db, body.agent_id)
    if not agent:
        return Response.error(code=1, msg="话务员不存在或已禁用")

    students = await invalid_leads.load_students(db, body.student_ids)
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")
    if error := _non_invalid_error(students, "回收"):
        return error

    # /reclaim-students 目前没有独立的 preview 发放口，客户端拿不到 token，只能做可选校验。
    invalid_leads.verify_reclaim_preview_token(students, body.preview_token)
    result = await invalid_leads.reclaim_invalid_students_to_agent(
        db, students, current_user, agent
    )
    await db.commit()
    return Response.ok(
        {
            "reclaimed_count": result["reclaimed_count"],
            "agent_id": body.agent_id,
            "agent_name": agent.name,
            "batch_id": result["batch_id"],
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
    students = await invalid_leads.load_students(db, body.student_ids)
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")
    if error := _non_invalid_error(students, "回收"):
        return error

    # 该接口有 /invalid-students/reclaim-preview 发放口，二次确认必须走完。
    invalid_leads.verify_reclaim_preview_token_required(students, body.preview_token)
    result = await invalid_leads.reclaim_invalid_students_to_pool(
        db, students, current_user, action="批量回收无效线索"
    )
    await db.commit()
    return Response.ok(result)


@router.get("/reclaim-rollbacks/{batch_id}")
async def preview_reclaim_rollback(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_ASSIGNMENT_ROLLBACK)),
):
    batch_id = batch_id.strip()
    if not batch_id:
        return Response.error(code=1, msg="batch_id不能为空")
    plan = await invalid_leads.build_reclaim_rollback_plan(db, batch_id)
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
    result = await invalid_leads.rollback_reclaim_batch(db, batch_id, current_user)
    if result is None:
        return Response.error(code=1, msg="未找到可回滚的回收批次")
    await db.commit()
    return Response.ok(result)


@router.post("/invalid-students/delete")
async def delete_invalid_students(
    body: BulkInvalidStudentsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_DELETE)),
):
    """删除选中的无效线索及关联记录。"""
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")
    students = await invalid_leads.load_students(db, body.student_ids)
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")
    if error := _non_invalid_error(students, "删除"):
        return error

    deleted_count = await invalid_leads.delete_invalid_students(
        db, students, current_user, action="批量删除无效线索"
    )
    await db.commit()
    return Response.ok({"deleted_count": deleted_count})


# ── 分学校回收 / 删除 ────────────────────────────────────────


@router.post("/reclaim-by-school-preview")
async def preview_reclaim_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """Preview a school-level invalid-lead reclaim without changing rows."""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")
    students = await invalid_leads.load_school_invalid_students(
        db, body.school_name, body.invalid_reason
    )
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可回收的无效线索")
    return Response.ok(await invalid_leads.preview_reclaim(db, students))


@router.post("/reclaim-by-school")
async def reclaim_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_RECLAIM)),
):
    """按学校一键回收无效线索 → assigned_to=null（未分配池）"""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")
    students = await invalid_leads.load_school_invalid_students(
        db, body.school_name, body.invalid_reason
    )
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可回收的无效线索")

    # 该接口有 /reclaim-by-school-preview 发放口，二次确认必须走完。
    invalid_leads.verify_reclaim_preview_token_required(students, body.preview_token)
    result = await invalid_leads.reclaim_invalid_students_to_pool(
        db, students, current_user, action="分学校回收"
    )
    await db.commit()
    return Response.ok({**result, "school_name": body.school_name})


@router.post("/delete-by-school-preview")
async def preview_delete_by_school(
    body: ReclaimBySchoolReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_INVALID_DELETE)),
):
    """按校删除的预览确认：返回命中条数与 preview_token（删除接口强制校验）。"""
    if not body.school_name:
        return Response.error(code=1, msg="school_name不能为空")
    students = await invalid_leads.load_school_invalid_students(
        db, body.school_name, body.invalid_reason
    )
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可删除的无效线索")
    if limit_error := _check_delete_batch_limit(students):
        return Response.error(code=1, msg=limit_error)
    return Response.ok(
        {
            "school_name": body.school_name,
            "student_count": len(students),
            "preview_token": invalid_leads.reclaim_preview_token(students),
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
    students = await invalid_leads.load_school_invalid_students(
        db, body.school_name, body.invalid_reason
    )
    if not students:
        return Response.error(code=1, msg=f"学校「{body.school_name}」没有可删除的无效线索")
    if limit_error := _check_delete_batch_limit(students):
        return Response.error(code=1, msg=limit_error)
    invalid_leads.verify_delete_preview_token(students, body.preview_token)

    deleted_count = await invalid_leads.delete_invalid_students(
        db, students, current_user, action="批量删除无效线索"
    )
    await db.commit()
    return Response.ok({"deleted_count": deleted_count, "school_name": body.school_name})


@router.get("/invalid-school-groups")
async def invalid_school_groups(
    invalid_reason: str | None = Query(None),
    q: str = Query(""),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_INVALID_RECLAIM)),
):
    """按学校聚合无效线索数量"""
    groups = await invalid_leads.invalid_school_groups(db, invalid_reason=invalid_reason, q=q)
    return Response.ok({"groups": groups})
