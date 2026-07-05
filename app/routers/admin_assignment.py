from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_ASSIGNMENT_ROLLBACK,
    ADMIN_OP_STUDENT_ASSIGN,
    ADMIN_PAGE_SCHOOL_DISTRIBUTION,
    require_operation_permission,
    require_page_permission,
)
from app.database import get_db
from app.models import OperationLog, Student, User, UserRole
from app.schemas import Response
from app.task_stats import TERMINAL_STUDENT_STATUSES
from app.utils import (
    assignment_state_label,
    make_assignment_rollback_note,
    make_batch_id,
    make_operation_log,
    parse_assignment_rollback_note,
    utcnow,
)

router = APIRouter(prefix="/api/admin", tags=["管理"])

ASSIGNMENT_ROLLBACK_ACTIONS = {
    "手动分配",
    "自动分配",
    "区域分配",
    "学校分配",
    "多学校分发",
}


class AssignmentRollbackReq(BaseModel):
    confirm: bool = False


class DistributeBySchoolsReq(BaseModel):
    school_names: list[str]
    mode: Literal["auto", "manual"] = "auto"
    agent_id: int | None = None


def _parse_assignment_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


async def _build_assignment_rollback_plan(db: AsyncSession, batch_id: str) -> dict:
    logs_r = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action.in_(ASSIGNMENT_ROLLBACK_ACTIONS),
            OperationLog.target_student_id.is_not(None),
        )
        .order_by(OperationLog.id.asc())
    )
    logs = logs_r.scalars().all()
    student_ids = [log.target_student_id for log in logs if log.target_student_id is not None]

    students_by_id: dict[int, Student] = {}
    if student_ids:
        students_r = await db.execute(select(Student).where(Student.id.in_(student_ids)))
        students_by_id = {student.id: student for student in students_r.scalars().all()}

    items = []
    for log in logs:
        payload = parse_assignment_rollback_note(log.note_content or "")
        student = students_by_id.get(log.target_student_id)
        status = "ok"
        reason = ""
        if payload is None:
            status = "skipped"
            reason = "缺少回滚信息"
        elif student is None:
            status = "skipped"
            reason = "学生不存在"
        elif student.assigned_to != payload.get("new_assigned_to"):
            status = "skipped"
            reason = "当前分配人与批次记录不一致，可能已被再次分配"

        items.append(
            {
                "log_id": log.id,
                "student_id": log.target_student_id,
                "student_name": student.name if student else "",
                "school_name": student.school_name if student else "",
                "case_no": log.case_no or "",
                "old_assigned_to": payload.get("old_assigned_to") if payload else None,
                "new_assigned_to": payload.get("new_assigned_to") if payload else None,
                "current_assigned_to": student.assigned_to if student else None,
                "status": status,
                "reason": reason,
            }
        )

    rollbackable = [item for item in items if item["status"] == "ok"]
    return {
        "batch_id": batch_id,
        "total_logs": len(logs),
        "rollbackable_count": len(rollbackable),
        "skipped_count": len(items) - len(rollbackable),
        "items": items[:100],
    }


@router.get("/unassigned-school-groups")
async def unassigned_school_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_SCHOOL_DISTRIBUTION)),
):
    """按学校聚合未分配（assigned_to=null）且未完成的学员数量"""
    region_expr = func.coalesce(func.max(func.nullif(Student.region, "")), "")
    result = await db.execute(
        select(Student.school_name, region_expr.label("region"), func.count())
        .where(
            Student.assigned_to.is_(None),
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
        )
        .group_by(Student.school_name)
        .order_by(func.count().desc())
    )
    groups = [
        {"name": name or "未知学校", "region": region or "未知区县", "count": cnt}
        for name, region, cnt in result.all()
    ]
    total = sum(g["count"] for g in groups)
    return Response.ok({"groups": groups, "total": total})


@router.post("/distribute-by-schools")
async def distribute_by_schools(
    body: DistributeBySchoolsReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_ASSIGN)),
):
    """按学校批量分发未分配学员给话务员"""
    if not body.school_names:
        return Response.error(code=1, msg="school_names不能为空")

    where = [
        Student.school_name.in_(body.school_names),
        Student.assigned_to.is_(None),
        Student.status.not_in(TERMINAL_STUDENT_STATUSES),
    ]
    result = await db.execute(select(Student).where(*where))
    students = result.scalars().all()
    if not students:
        return Response.error(code=1, msg="所选学校没有可分配的学员")

    now = utcnow()
    batch_id = make_batch_id("school-distribute")
    old_assignment_by_student_id = {
        student.id: (student.assigned_to, student.assigned_at) for student in students
    }
    distribution: dict[str, int] = {}
    assigned_by_student_id: dict[int, int] = {}

    if body.mode == "manual":
        if body.agent_id is None:
            return Response.error(code=1, msg="manual模式需要agent_id")
        agent_result = await db.execute(
            select(User).where(
                User.id == body.agent_id, User.is_active, User.role == UserRole.agent
            )
        )
        agent = agent_result.scalar_one_or_none()
        if not agent:
            return Response.error(code=1, msg="话务员不存在或已禁用")
        for s in students:
            s.assigned_to = agent.id
            s.assigned_at = now
            assigned_by_student_id[s.id] = agent.id
        distribution[agent.name] = len(students)
    else:
        agent_result = await db.execute(
            select(User).where(User.is_active, User.role == UserRole.agent).order_by(User.id)
        )
        agents = agent_result.scalars().all()
        if not agents:
            return Response.error(code=1, msg="没有可用的话务员")

        load_r = await db.execute(
            select(Student.assigned_to, func.count(Student.id))
            .where(
                Student.assigned_to.in_([a.id for a in agents]),
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            )
            .group_by(Student.assigned_to)
        )
        load = {aid: cnt for aid, cnt in load_r.all()}
        for agent in agents:
            load.setdefault(agent.id, 0)
            distribution[agent.name] = 0
        agent_map = {agent.id: agent for agent in agents}

        for s in sorted(students, key=lambda item: item.id):
            agent_id = min(load, key=load.get)
            s.assigned_to = agent_id
            s.assigned_at = now
            assigned_by_student_id[s.id] = agent_id
            load[agent_id] += 1
            distribution[agent_map[agent_id].name] += 1

    for s in students:
        old_agent_id, old_assigned_at = old_assignment_by_student_id.get(
            s.id,
            (None, None),
        )
        new_agent_id = assigned_by_student_id.get(s.id)
        db.add(
            make_operation_log(
                current_user,
                s.id,
                s.case_no or "",
                action="多学校分发",
                content=f"从学校「{s.school_name}」分发给话务员",
                old_status=assignment_state_label(old_agent_id),
                new_status=assignment_state_label(new_agent_id),
                note_content=make_assignment_rollback_note(
                    old_assigned_to=old_agent_id,
                    old_assigned_at=old_assigned_at,
                    new_assigned_to=new_agent_id,
                    new_assigned_at=now,
                ),
                batch_id=batch_id,
            )
        )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="多学校分发汇总",
            content=(f"多学校分发，共 {len(students)} 名；学校：{'、'.join(body.school_names)}"),
            batch_id=batch_id,
        )
    )

    await db.commit()
    return Response.ok(
        {
            "distributed_count": len(students),
            "distribution": distribution,
            "schools": body.school_names,
            "batch_id": batch_id,
        }
    )


@router.get("/assignment-rollbacks/{batch_id}")
async def preview_assignment_rollback(
    batch_id: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_ASSIGNMENT_ROLLBACK)),
):
    """预览某个分配批次可回滚的学生。"""
    batch_id = batch_id.strip()
    if not batch_id:
        return Response.error(code=1, msg="batch_id不能为空")
    return Response.ok(await _build_assignment_rollback_plan(db, batch_id))


@router.post("/assignment-rollbacks/{batch_id}")
async def rollback_assignment_batch(
    batch_id: str,
    body: AssignmentRollbackReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_ASSIGNMENT_ROLLBACK)),
):
    """按批次撤销分配：仅回滚当前分配仍与该批次一致的学生。"""
    batch_id = batch_id.strip()
    if not batch_id:
        return Response.error(code=1, msg="batch_id不能为空")
    if not body.confirm:
        return Response.error(code=1, msg="请确认后再执行回滚")

    logs_r = await db.execute(
        select(OperationLog)
        .where(
            OperationLog.batch_id == batch_id,
            OperationLog.action.in_(ASSIGNMENT_ROLLBACK_ACTIONS),
            OperationLog.target_student_id.is_not(None),
        )
        .order_by(OperationLog.id.asc())
    )
    logs = logs_r.scalars().all()
    if not logs:
        return Response.error(code=1, msg="未找到可回滚的分配批次")

    student_ids = [log.target_student_id for log in logs if log.target_student_id is not None]
    students_r = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    students_by_id = {student.id: student for student in students_r.scalars().all()}

    rolled_back = 0
    skipped = 0
    for log in logs:
        payload = parse_assignment_rollback_note(log.note_content or "")
        student = students_by_id.get(log.target_student_id)
        if (
            payload is None
            or student is None
            or student.assigned_to != payload.get("new_assigned_to")
        ):
            skipped += 1
            continue

        old_assigned_to = payload.get("old_assigned_to")
        old_assigned_at = _parse_assignment_dt(payload.get("old_assigned_at"))
        current_assigned_to = student.assigned_to
        student.assigned_to = old_assigned_to
        student.assigned_at = old_assigned_at
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                action="分配回滚",
                content=(
                    f"回滚批次 {batch_id}："
                    f"{assignment_state_label(current_assigned_to)} → "
                    f"{assignment_state_label(old_assigned_to)}"
                ),
                old_status=assignment_state_label(current_assigned_to),
                new_status=assignment_state_label(old_assigned_to),
                batch_id=batch_id,
            )
        )
        rolled_back += 1

    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="分配回滚汇总",
            content=f"回滚分配批次 {batch_id}，成功 {rolled_back} 条，跳过 {skipped} 条",
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
