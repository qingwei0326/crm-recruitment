from datetime import datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ADMIN_OP_STUDENT_ASSIGN, require_operation_permission
from app.database import get_db
from app.models import Student, StudentStage, StudentStatus, User, UserRole
from app.schemas import Response
from app.task_stats import TERMINAL_STUDENT_STATUSES
from app.utils import (
    assignment_state_label,
    make_assignment_rollback_note,
    make_batch_id,
    make_operation_log,
    utcnow,
)

router = APIRouter(prefix="/api/students", tags=["学生"])


def _is_enrolled_student(student: Student) -> bool:
    return student.status == StudentStatus.enrolled or student.stage == StudentStage.enrolled


class AssignReq(BaseModel):
    student_ids: list[int]
    agent_id: int


class SchoolAssignReq(BaseModel):
    school_name: str = Field(..., min_length=1)
    agent_ids: list[int] = Field(..., min_length=1)
    regions: list[str] = Field(default_factory=list)

    @field_validator("school_name")
    @classmethod
    def normalize_school_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("请选择学校")
        return value

    @field_validator("regions")
    @classmethod
    def normalize_regions(cls, value: list[str]) -> list[str]:
        return [region.strip() for region in value if isinstance(region, str) and region.strip()]


def _add_assignment_logs(
    db: AsyncSession,
    current_user: User,
    students: list[Student],
    assigned_by_student_id: dict[int, int],
    *,
    action: str,
    content_prefix: str = "分配给话务员",
    batch_id: str = "",
    old_assignment_by_student_id: dict[int, tuple[int | None, datetime | None]] | None = None,
    assigned_at_by_student_id: dict[int, datetime] | None = None,
):
    for student in students:
        agent_id = assigned_by_student_id.get(student.id)
        if agent_id is None:
            continue
        old_agent_id, old_assigned_at = (old_assignment_by_student_id or {}).get(
            student.id,
            (None, None),
        )
        new_assigned_at = (assigned_at_by_student_id or {}).get(student.id)
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                action,
                content=f"{content_prefix} {agent_id}",
                old_status=assignment_state_label(old_agent_id),
                new_status=assignment_state_label(agent_id),
                note_content=make_assignment_rollback_note(
                    old_assigned_to=old_agent_id,
                    old_assigned_at=old_assigned_at,
                    new_assigned_to=agent_id,
                    new_assigned_at=new_assigned_at,
                ),
                batch_id=batch_id,
            )
        )


def _student_names_preview(students: list[Student], limit: int = 5) -> str:
    names = [student.name or f"学生{student.id}" for student in students[:limit]]
    suffix = f" 等 {len(students)} 人" if len(students) > limit else ""
    return "、".join(names) + suffix


def _add_batch_summary_log(
    db: AsyncSession,
    current_user: User,
    *,
    action: str,
    content: str,
    batch_id: str = "",
):
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action=action,
            content=content,
            batch_id=batch_id,
        )
    )


@router.post("/assign")
async def assign_students(
    body: AssignReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_ASSIGN)),
):
    if not body.student_ids:
        return Response.error(code=1, msg="student_ids不能为空")

    agent_result = await db.execute(select(User).where(User.id == body.agent_id, User.is_active))
    if not agent_result.scalar_one_or_none():
        return Response.error(code=1, msg="话务员不存在或已禁用")

    students_result = await db.execute(select(Student).where(Student.id.in_(body.student_ids)))
    students = students_result.scalars().all()
    if not students:
        return Response.error(code=1, msg="未找到指定的学生")
    enrolled_students = [student for student in students if _is_enrolled_student(student)]
    if enrolled_students:
        names = "、".join(student.name for student in enrolled_students[:3])
        suffix = f" 等 {len(enrolled_students)} 人" if len(enrolled_students) > 3 else ""
        return Response.error(code=1, msg=f"已报名学生不能重新分配：{names}{suffix}")

    now = utcnow()
    batch_id = make_batch_id("assign")
    old_assignment_by_student_id = {
        student.id: (student.assigned_to, student.assigned_at) for student in students
    }
    assigned_at_by_student_id = {student.id: now for student in students}
    await db.execute(
        update(Student)
        .where(Student.id.in_(body.student_ids))
        .values(assigned_to=body.agent_id, assigned_at=now)
    )
    _add_assignment_logs(
        db,
        current_user,
        students,
        {student.id: body.agent_id for student in students},
        action="手动分配",
        batch_id=batch_id,
        old_assignment_by_student_id=old_assignment_by_student_id,
        assigned_at_by_student_id=assigned_at_by_student_id,
    )
    _add_batch_summary_log(
        db,
        current_user,
        action="批量分配",
        content=(
            f"共 {len(students)} 名学生分配给话务员 {body.agent_id}；"
            f"样例：{_student_names_preview(students)}"
        ),
        batch_id=batch_id,
    )
    await db.commit()

    return Response.ok(
        {"assigned_count": len(students), "agent_id": body.agent_id, "batch_id": batch_id}
    )


@router.post("/auto-assign")
async def auto_assign(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_ASSIGN)),
):
    agent_result = await db.execute(select(User).where(User.is_active, User.role == UserRole.agent))
    agents = agent_result.scalars().all()
    if not agents:
        return Response.error(code=1, msg="没有可用的话务员")

    load = {}
    for a in agents:
        cnt = await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to == a.id,
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            )
        )
        load[a.id] = cnt.scalar() or 0

    unassigned_result = await db.execute(
        select(Student)
        .where(
            Student.assigned_to.is_(None),
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
        )
        .order_by(Student.created_at.asc())
    )
    unassigned = unassigned_result.scalars().all()
    if not unassigned:
        return Response.ok({"message": "没有未分配的学生", "distribution": {}})

    distribution = {a.id: 0 for a in agents}
    now = utcnow()
    batch_id = make_batch_id("auto-assign")
    old_assignment_by_student_id = {
        student.id: (student.assigned_to, student.assigned_at) for student in unassigned
    }
    assigned_at_by_student_id = {student.id: now for student in unassigned}
    by_agent: dict[int, list[int]] = {}
    assigned_by_student_id: dict[int, int] = {}
    for student in unassigned:
        min_agent_id = min(load, key=load.get)
        by_agent.setdefault(min_agent_id, []).append(student.id)
        assigned_by_student_id[student.id] = min_agent_id
        load[min_agent_id] += 1
        distribution[min_agent_id] += 1

    for agent_id, ids in by_agent.items():
        if not ids:
            continue
        await db.execute(
            update(Student).where(Student.id.in_(ids)).values(assigned_to=agent_id, assigned_at=now)
        )

    _add_assignment_logs(
        db,
        current_user,
        unassigned,
        assigned_by_student_id,
        action="自动分配",
        batch_id=batch_id,
        old_assignment_by_student_id=old_assignment_by_student_id,
        assigned_at_by_student_id=assigned_at_by_student_id,
    )
    distribution_text = ", ".join(
        f"{a.id}:{distribution.get(a.id, 0)}" for a in agents if distribution.get(a.id, 0) > 0
    )
    _add_batch_summary_log(
        db,
        current_user,
        action="自动分配汇总",
        content=(
            f"自动均摊未分配线索，共 {len(unassigned)} 名；"
            f"分布：{distribution_text}；"
            f"样例：{_student_names_preview(unassigned)}"
        ),
        batch_id=batch_id,
    )
    await db.commit()
    # 按 agent_id 聚合返回，避免重名话务员被合并（name 非唯一）
    result = [
        {"agent_id": a.id, "name": a.name, "count": distribution.get(a.id, 0)}
        for a in agents
        if distribution.get(a.id, 0) > 0
    ]

    return Response.ok(
        {"total_assigned": len(unassigned), "distribution": result, "batch_id": batch_id}
    )


@router.post("/region-assign")
async def region_assign(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_ASSIGN)),
):
    agent_result = await db.execute(select(User).where(User.is_active, User.role == UserRole.agent))
    agents = agent_result.scalars().all()
    if not agents:
        return Response.error(code=1, msg="没有可用的话务员")

    # 一个地区可被多个话务员服务；命中地区时按当前活跃负载最小者分配
    region_map: dict[str, list[User]] = {}
    for a in agents:
        if a.service_regions:
            for r in a.service_regions.replace("，", ",").split(","):
                r = r.strip()
                if r:
                    region_map.setdefault(r, []).append(a)

    # 活跃负载基线（排除终态学生），避免历史已报名/已过期影响公平
    load = {}
    for a in agents:
        cnt = await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to == a.id,
                Student.status.not_in(TERMINAL_STUDENT_STATUSES),
            )
        )
        load[a.id] = cnt.scalar() or 0
    agent_name_by_id = {a.id: a.name for a in agents}

    unassigned_result = await db.execute(
        select(Student)
        .where(
            Student.assigned_to.is_(None),
            Student.status.not_in(TERMINAL_STUDENT_STATUSES),
        )
        .order_by(Student.created_at.asc())
    )
    unassigned = unassigned_result.scalars().all()

    distribution = {a.name: {"matched": 0, "fallback": 0} for a in agents}
    now = utcnow()
    batch_id = make_batch_id("region-assign")
    old_assignment_by_student_id = {
        student.id: (student.assigned_to, student.assigned_at) for student in unassigned
    }
    assigned_at_by_student_id = {student.id: now for student in unassigned}
    total_assigned = 0
    by_agent: dict[int, list[int]] = {}
    assigned_by_student_id: dict[int, int] = {}

    for student in unassigned:
        matched_candidates = region_map.get(student.region or "", [])
        if matched_candidates:
            # 同地区多话务员：选负载最小者
            chosen = min(matched_candidates, key=lambda a: load[a.id])
            agent_id = chosen.id
            distribution[chosen.name]["matched"] += 1
        else:
            agent_id = min(load, key=load.get)
            name = agent_name_by_id.get(agent_id, "")
            if name:
                distribution[name]["fallback"] += 1

        by_agent.setdefault(agent_id, []).append(student.id)
        assigned_by_student_id[student.id] = agent_id
        load[agent_id] += 1
        total_assigned += 1

    for agent_id, ids in by_agent.items():
        if not ids:
            continue
        await db.execute(
            update(Student).where(Student.id.in_(ids)).values(assigned_to=agent_id, assigned_at=now)
        )

    _add_assignment_logs(
        db,
        current_user,
        unassigned,
        assigned_by_student_id,
        action="区域分配",
        batch_id=batch_id,
        old_assignment_by_student_id=old_assignment_by_student_id,
        assigned_at_by_student_id=assigned_at_by_student_id,
    )
    _add_batch_summary_log(
        db,
        current_user,
        action="区域分配汇总",
        content=(
            f"区域分配未分配线索，共 {total_assigned} 名；"
            f"样例：{_student_names_preview(unassigned)}"
        ),
        batch_id=batch_id,
    )
    await db.commit()
    return Response.ok(
        {
            "total_assigned": total_assigned,
            "distribution": distribution,
            "batch_id": batch_id,
        }
    )


@router.post("/school-assign")
async def school_assign(
    body: SchoolAssignReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_ASSIGN)),
):
    """按学校分发：选学校、可选区县过滤、选多个话务员ID、轮询分配"""
    school = body.school_name
    agent_ids = body.agent_ids
    regions = body.regions

    # 验证话务员存在
    agents_result = await db.execute(
        select(User).where(User.id.in_(agent_ids), User.is_active, User.role == UserRole.agent)
    )
    agents = agents_result.scalars().all()
    if not agents:
        return Response.error(code=1, msg="没有可用的话务员")

    # 查出该学校未分配的学生（可选按区县过滤）
    conditions = [
        Student.school_name == school,
        Student.assigned_to.is_(None),
        Student.status.not_in(TERMINAL_STUDENT_STATUSES),
    ]
    if regions:
        conditions.append(Student.region.in_(regions))
    students_result = await db.execute(
        select(Student).where(*conditions).order_by(Student.created_at.asc())
    )
    students = students_result.scalars().all()
    if not students:
        return Response.error(
            code=1,
            msg="该学校在所选区县下没有未分配的学生" if regions else "该学校没有未分配的学生",
        )

    now = utcnow()
    batch_id = make_batch_id("school-assign")
    old_assignment_by_student_id = {
        student.id: (student.assigned_to, student.assigned_at) for student in students
    }
    assigned_at_by_student_id = {student.id: now for student in students}
    by_agent: dict[int, list[int]] = {}
    agent_id_list = [a.id for a in agents]
    counts = {a_id: 0 for a_id in agent_id_list}

    for student in students:
        # 轮询：选当前分配数量最少的话务员
        min_agent_id = min(counts, key=counts.get)
        by_agent.setdefault(min_agent_id, []).append(student.id)
        counts[min_agent_id] += 1

    for agent_id, ids in by_agent.items():
        await db.execute(
            update(Student).where(Student.id.in_(ids)).values(assigned_to=agent_id, assigned_at=now)
        )

    _add_assignment_logs(
        db,
        current_user,
        students,
        {student_id: agent_id for agent_id, ids in by_agent.items() for student_id in ids},
        action="学校分配",
        content_prefix=f"学校「{school}」分配给话务员",
        batch_id=batch_id,
        old_assignment_by_student_id=old_assignment_by_student_id,
        assigned_at_by_student_id=assigned_at_by_student_id,
    )
    _add_batch_summary_log(
        db,
        current_user,
        action="学校分配汇总",
        content=(
            f"学校「{school}」分发，共 {len(students)} 名；"
            f"区县：{('、'.join(regions) if regions else '全部')}；"
            f"话务员：{', '.join(str(a.id) for a in agents)}；"
            f"样例：{_student_names_preview(students)}"
        ),
        batch_id=batch_id,
    )
    await db.commit()
    return Response.ok(
        {
            "total_assigned": len(students),
            "distribution": {f"agent_{a_id}": len(ids) for a_id, ids in by_agent.items()},
            "batch_id": batch_id,
        }
    )
