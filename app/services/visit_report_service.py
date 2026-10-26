"""Create home and campus visit tasks.

The single-visit endpoints and the combined visit report both create their tasks here,
so a report that asks for a home visit and a campus visit files the same tasks, logs
and work items as two separate requests would.
"""

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain_models import WorkItemKind
from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    HomeVisitStatus,
    HomeVisitTask,
    Student,
    StudentStage,
    User,
)
from app.services.work_item_service import (
    campus_visit_is_open,
    home_visit_is_open,
    sync_source_work_item,
    sync_student_work_items,
)
from app.stage_policy import advance_student_stage
from app.utils import make_operation_log

# A student may have only one campus visit in these states at a time.
CAMPUS_VISIT_OPEN_STATUSES = {
    CampusVisitStatus.pending,
    CampusVisitStatus.scheduled,
    CampusVisitStatus.rescheduled,
}

_PLAIN_SCORE = re.compile(r"^\s*(\d{1,3}(?:\.\d+)?)\s*分?\s*$")


def parse_exam_score(text: str) -> float | None:
    """'378' or '378分' -> 378.0; ranges and words such as '200-300分' -> None."""
    match = _PLAIN_SCORE.match(text or "")
    return float(match.group(1)) if match else None


def _snapshot(student: Student) -> dict[str, Any]:
    return {
        "student_name_snapshot": student.name,
        "guardian_phone_snapshot": student.guardian_phone or student.guardian2_phone or "",
        "region_snapshot": student.region,
        "school_name_snapshot": student.school_name,
    }


async def sync_home_visit_work_item(
    db: AsyncSession,
    task: HomeVisitTask,
    student: Student,
    actor: User,
) -> None:
    await db.flush()
    await sync_source_work_item(
        db,
        WorkItemKind.home_visit,
        "home_visit",
        task.id,
        student,
        task.creator_agent_id,
        task.next_follow_up_at or task.scheduled_at or task.requested_visit_time,
        not home_visit_is_open(task),
        actor,
    )
    await sync_student_work_items(db, student, actor)


async def sync_campus_visit_work_item(
    db: AsyncSession,
    task: CampusVisitTask,
    student: Student,
    actor: User,
) -> None:
    await db.flush()
    await sync_source_work_item(
        db,
        WorkItemKind.campus_visit,
        "campus_visit",
        task.id,
        student,
        task.creator_user_id,
        task.next_follow_up_at or task.appointment_at,
        not campus_visit_is_open(task),
        actor,
    )
    await sync_student_work_items(db, student, actor)


async def has_open_campus_visit(db: AsyncSession, student_id: int) -> bool:
    result = await db.execute(
        select(CampusVisitTask.id).where(
            CampusVisitTask.student_id == student_id,
            CampusVisitTask.status.in_(CAMPUS_VISIT_OPEN_STATUSES),
        )
    )
    return result.first() is not None


async def add_home_visit_task(
    db: AsyncSession,
    student: Student,
    actor: User,
    *,
    creator_agent_id: int,
    **fields: Any,
) -> HomeVisitTask:
    """Add a pending home visit; ``fields`` are HomeVisitTask columns."""
    task = HomeVisitTask(
        student_id=student.id,
        creator_agent_id=creator_agent_id,
        status=HomeVisitStatus.pending,
        **_snapshot(student),
        **fields,
    )
    advance_student_stage(student, StudentStage.home_visit_pending)
    db.add(task)
    db.add(
        make_operation_log(
            actor,
            student.id,
            student.case_no or "",
            "申请家访",
            content=f"家访申请：{student.name}；地址：{task.address or '未填写'}",
        )
    )
    await sync_home_visit_work_item(db, task, student, actor)
    return task


async def add_campus_visit_task(
    db: AsyncSession,
    student: Student,
    actor: User,
    *,
    creator_user_id: int,
    **fields: Any,
) -> CampusVisitTask:
    """Add a campus visit, scheduled when it has an exact time; ``fields`` are columns."""
    appointment_at = fields.get("appointment_at")
    task = CampusVisitTask(
        student_id=student.id,
        creator_user_id=creator_user_id,
        status=CampusVisitStatus.scheduled if appointment_at else CampusVisitStatus.pending,
        **_snapshot(student),
        **fields,
    )
    advance_student_stage(
        student,
        StudentStage.campus_visit_scheduled
        if appointment_at
        else StudentStage.campus_visit_pending,
    )
    db.add(task)
    when = appointment_at or fields.get("visit_time_note") or "待定"
    db.add(
        make_operation_log(
            actor,
            student.id,
            student.case_no or "",
            "预约到校",
            content=f"到校参观预约：{student.name}；时间：{when}",
        )
    )
    await sync_campus_visit_work_item(db, task, student, actor)
    return task
