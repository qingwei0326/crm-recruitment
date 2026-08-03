from collections import Counter
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain_errors import (
    DomainConflict,
    InactiveAssignmentTarget,
    StudentNotFound,
)
from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    PersonalGroup,
    PersonalGroupMembership,
    StudentAssignment,
)
from app.models import Student, User, UserRole
from app.services.work_item_service import (
    sync_assignment_source_work_items,
    sync_students_work_items,
)
from app.utils import (
    assignment_state_label,
    make_assignment_rollback_note,
    make_operation_log,
    utcnow,
)


@dataclass(frozen=True)
class AssignmentTarget:
    student_id: int
    agent_id: int | None


@dataclass(frozen=True)
class AssignmentResult:
    changed_ids: tuple[int, ...]
    unchanged_ids: tuple[int, ...]


async def apply_assignment_changes(
    db: AsyncSession,
    targets: Sequence[AssignmentTarget],
    *,
    operator: User,
    reason: str,
    batch_id: str,
    at: datetime | None = None,
    handover_batch_id: int | None = None,
) -> AssignmentResult:
    requested: dict[int, int | None] = {}
    for target in targets:
        existing = requested.get(target.student_id)
        if target.student_id in requested and existing != target.agent_id:
            raise DomainConflict(f"学生 {target.student_id} 出现多个目标负责人")
        requested[target.student_id] = target.agent_id
    if not requested:
        return AssignmentResult((), ())

    now = at or utcnow()
    student_rows = await db.execute(
        select(Student).where(Student.id.in_(sorted(requested)))
    )
    students = {student.id: student for student in student_rows.scalars().all()}
    missing = sorted(set(requested) - set(students))
    if missing:
        raise StudentNotFound(f"学生不存在: {missing}")

    target_ids = sorted(
        {agent_id for agent_id in requested.values() if agent_id is not None}
    )
    if target_ids:
        target_rows = await db.execute(
            select(User, AgentEmployment)
            .join(AgentEmployment, AgentEmployment.user_id == User.id)
            .where(User.id.in_(target_ids))
        )
        valid_targets = {
            user.id
            for user, employment in target_rows.all()
            if user.role == UserRole.agent
            and employment.status == EmploymentStatus.active
        }
        invalid = sorted(set(target_ids) - valid_targets)
        if invalid:
            raise InactiveAssignmentTarget(f"目标员工不可接收学生: {invalid}")

    assignment_rows = await db.execute(
        select(StudentAssignment).where(
            StudentAssignment.student_id.in_(sorted(requested)),
            StudentAssignment.ended_at.is_(None),
        )
    )
    active_assignments = assignment_rows.scalars().all()
    active_counts = Counter(row.student_id for row in active_assignments)
    duplicate_active = sorted(
        student_id for student_id, count in active_counts.items() if count > 1
    )
    if duplicate_active:
        raise DomainConflict(f"学生存在多个活跃归属: {duplicate_active}")
    active_by_student = {
        assignment.student_id: assignment for assignment in active_assignments
    }

    if handover_batch_id is None:
        current_agent_ids = sorted(
            {
                assignment.agent_id
                for student_id, assignment in active_by_student.items()
                if requested[student_id] != assignment.agent_id
            }
        )
        pending_agent_ids: set[int] = set()
        if current_agent_ids:
            employment_rows = await db.execute(
                select(AgentEmployment).where(
                    AgentEmployment.user_id.in_(current_agent_ids),
                    AgentEmployment.status == EmploymentStatus.handover_pending,
                )
            )
            pending_agent_ids = {
                employment.user_id for employment in employment_rows.scalars().all()
            }
        blocked_student_ids = sorted(
            student_id
            for student_id, assignment in active_by_student.items()
            if requested[student_id] != assignment.agent_id
            and assignment.agent_id in pending_agent_ids
        )
        if blocked_student_ids:
            raise DomainConflict(
                f"待交接学生请通过交接流程转移: {blocked_student_ids[:3]}"
            )

    changed: list[int] = []
    unchanged: list[int] = []
    previous_agent_by_student: dict[int, int | None] = {}
    for student_id in sorted(requested):
        student = students[student_id]
        current = active_by_student.get(student_id)
        current_agent_id = current.agent_id if current else None
        if current_agent_id != student.assigned_to:
            raise DomainConflict(f"学生 {student_id} 的归属投影不一致")

        target_agent_id = requested[student_id]
        if current_agent_id == target_agent_id:
            unchanged.append(student_id)
            continue
        previous_agent_by_student[student_id] = current_agent_id
        current_assigned_at = student.assigned_at
        if current is not None:
            current.ended_at = now
            current.end_reason = reason
            current.ended_by = operator.id
            current.handover_batch_id = handover_batch_id
        if target_agent_id is not None:
            db.add(
                StudentAssignment(
                    student_id=student_id,
                    agent_id=target_agent_id,
                    started_at=now,
                    start_reason=reason,
                    started_by=operator.id,
                    handover_batch_id=handover_batch_id,
                    previous_assignment_id=current.id if current else None,
                )
            )
        student.assigned_to = target_agent_id
        student.assigned_at = now if target_agent_id is not None else None
        db.add(
            make_operation_log(
                operator,
                student.id,
                student.case_no or "",
                "修改归属",
                content=(
                    f"{current_agent_id or '未分配'} -> "
                    f"{target_agent_id or '未分配'}"
                ),
                old_status=assignment_state_label(current_agent_id),
                new_status=assignment_state_label(target_agent_id),
                note_content=make_assignment_rollback_note(
                    old_assigned_to=current_agent_id,
                    old_assigned_at=current_assigned_at,
                    new_assigned_to=target_agent_id,
                    new_assigned_at=now if target_agent_id is not None else None,
                ),
                batch_id=batch_id,
            )
        )
        changed.append(student_id)

    if changed:
        membership_rows = await db.execute(
            select(PersonalGroupMembership, PersonalGroup).join(
                PersonalGroup,
                PersonalGroup.id == PersonalGroupMembership.group_id,
            ).where(
                PersonalGroupMembership.student_id.in_(changed),
                PersonalGroupMembership.archived_at.is_(None),
                PersonalGroup.archived_at.is_(None),
            )
        )
        for membership, group in membership_rows.all():
            if group.owner_id != previous_agent_by_student.get(membership.student_id):
                continue
            membership.archived_at = now
            membership.archived_by = operator.id
            membership.archive_reason = "assignment_changed"
            student = students[membership.student_id]
            db.add(
                make_operation_log(
                    operator,
                    student.id,
                    student.case_no or "",
                    "归档私人分组",
                    f"group_id={group.id}; name={group.name}（负责人变更）",
                    batch_id=batch_id,
                )
            )

    changed_students = [students[student_id] for student_id in changed]
    await sync_students_work_items(
        db,
        changed_students,
        operator,
        at=now,
    )
    if handover_batch_id is None:
        await sync_assignment_source_work_items(
            db,
            changed_students,
            at=now,
        )
    await db.flush()
    return AssignmentResult(tuple(changed), tuple(unchanged))
