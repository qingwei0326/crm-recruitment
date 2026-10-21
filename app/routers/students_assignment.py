from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import ADMIN_OP_STUDENT_ASSIGN, require_operation_permission
from app.database import get_db
from app.models import Student, StudentStage, StudentStatus, User, UserRole
from app.schemas import Response
from app.services.assignment_capacity_service import build_capacity_plan
from app.services.assignment_service import AssignmentTarget, apply_assignment_changes
from app.task_stats import ASSIGNABLE_STUDENT_STATUSES, TERMINAL_STUDENT_STATUSES
from app.utils import (
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
    override_reason: str = Field(default="", max_length=200)


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
    terminal_students = [
        student for student in students if student.status in TERMINAL_STUDENT_STATUSES
    ]
    if terminal_students:
        names = "、".join(student.name for student in terminal_students[:3])
        suffix = f" 等 {len(terminal_students)} 人" if len(terminal_students) > 3 else ""
        return Response.error(code=1, msg=f"终态学生不能直接分配，请先恢复状态：{names}{suffix}")

    now = utcnow()
    batch_id = make_batch_id("assign")
    await apply_assignment_changes(
        db,
        [
            AssignmentTarget(student_id=student.id, agent_id=body.agent_id)
            for student in students
        ],
        operator=current_user,
        reason="manual_assignment",
        batch_id=batch_id,
        at=now,
        capacity_override_reason=body.override_reason,
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
        Student.status.in_(ASSIGNABLE_STUDENT_STATUSES),
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
    plan = await build_capacity_plan(
        db,
        [student.id for student in students],
        [agent.id for agent in agents],
        at=now,
    )
    await apply_assignment_changes(
        db,
        [
            AssignmentTarget(student_id=student_id, agent_id=agent_id)
            for agent_id, student_ids in plan.assignments_by_agent.items()
            for student_id in student_ids
        ],
        operator=current_user,
        reason="school_assignment",
        batch_id=batch_id,
        at=now,
    )
    _add_batch_summary_log(
        db,
        current_user,
        action="学校分配汇总",
            content=(
            f"学校「{school}」分发，共 {plan.planned_count} 名；"
            f"超容量留池 {plan.overflow_count} 名；"
            f"区县：{('、'.join(regions) if regions else '全部')}；"
            f"话务员：{', '.join(str(a.id) for a in agents)}；"
            f"样例：{_student_names_preview(students)}"
        ),
        batch_id=batch_id,
    )
    await db.commit()
    return Response.ok(
        {
            "total_assigned": plan.planned_count,
            "overflow_count": plan.overflow_count,
            "distribution": {
                f"agent_{a_id}": len(ids)
                for a_id, ids in plan.assignments_by_agent.items()
            },
            "batch_id": batch_id,
        }
    )
