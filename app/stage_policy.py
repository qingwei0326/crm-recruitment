"""Rules for the student conversion-stage projection.

Admission task endpoints are the source of truth for home visits, campus
visits, and enrollment. The generic stage endpoint may only project a stage
that is already supported by the student's task history.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    CampusVisitStatus,
    CampusVisitTask,
    HomeVisitStatus,
    HomeVisitTask,
    Student,
    StudentStage,
)

STAGE_RANK = {
    StudentStage.initial_contact: 0,
    StudentStage.interested: 1,
    StudentStage.materials_sent: 2,
    StudentStage.home_visit_pending: 3,
    StudentStage.home_visit_scheduled: 4,
    StudentStage.home_visit_completed: 5,
    StudentStage.campus_visit_pending: 6,
    StudentStage.campus_visit_scheduled: 7,
    StudentStage.campus_visit_arrived: 8,
    StudentStage.enrolled: 9,
    # Legacy values are accepted on input but projected to the canonical ones.
    StudentStage.visit_scheduled: 7,
    StudentStage.visited: 8,
}

STAGE_ALIASES = {
    StudentStage.visit_scheduled: StudentStage.campus_visit_scheduled,
    StudentStage.visited: StudentStage.campus_visit_arrived,
}


def normalize_stage(value: StudentStage | str) -> StudentStage:
    if isinstance(value, StudentStage):
        stage = value
    else:
        try:
            stage = StudentStage(value)
        except ValueError as exc:
            raise ValueError(f"无效的阶段: {value}") from exc
    return STAGE_ALIASES.get(stage, stage)


def stage_rank(value: StudentStage | str) -> int:
    return STAGE_RANK[normalize_stage(value)]


async def _has_home_visit(
    db: AsyncSession,
    student_id: int,
    statuses: set[HomeVisitStatus],
) -> bool:
    result = await db.execute(
        select(HomeVisitTask.id)
        .where(
            HomeVisitTask.student_id == student_id,
            HomeVisitTask.status.in_(statuses),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _has_campus_visit(
    db: AsyncSession,
    student_id: int,
    statuses: set[CampusVisitStatus],
) -> bool:
    result = await db.execute(
        select(CampusVisitTask.id)
        .where(
            CampusVisitTask.student_id == student_id,
            CampusVisitTask.status.in_(statuses),
        )
        .limit(1)
    )
    return result.scalar_one_or_none() is not None


async def validate_stage_transition(
    db: AsyncSession,
    student: Student,
    requested_stage: StudentStage | str,
) -> StudentStage:
    """Validate and normalize a manually requested stage projection."""
    new_stage = normalize_stage(requested_stage)
    current_stage = normalize_stage(student.stage)

    if new_stage == StudentStage.enrolled:
        raise ValueError("已报名必须通过正式报名确认流程登记，不能直接修改阶段")

    if stage_rank(new_stage) < stage_rank(current_stage):
        raise ValueError("阶段只能向前推进，如需纠正请通过对应业务任务处理")

    if new_stage in {
        StudentStage.home_visit_pending,
        StudentStage.home_visit_scheduled,
        StudentStage.home_visit_completed,
    }:
        required_statuses = {
            StudentStage.home_visit_pending: {
                HomeVisitStatus.pending,
                HomeVisitStatus.confirmed,
                HomeVisitStatus.scheduled,
                HomeVisitStatus.completed,
                HomeVisitStatus.postponed,
            },
            StudentStage.home_visit_scheduled: {
                HomeVisitStatus.confirmed,
                HomeVisitStatus.scheduled,
                HomeVisitStatus.completed,
            },
            StudentStage.home_visit_completed: {HomeVisitStatus.completed},
        }[new_stage]
        if not await _has_home_visit(db, student.id, required_statuses):
            raise ValueError("该阶段必须先存在对应的家访任务并完成相应处理")

    if new_stage in {
        StudentStage.campus_visit_pending,
        StudentStage.campus_visit_scheduled,
        StudentStage.campus_visit_arrived,
    }:
        required_statuses = {
            StudentStage.campus_visit_pending: {
                CampusVisitStatus.pending,
                CampusVisitStatus.scheduled,
                CampusVisitStatus.rescheduled,
                CampusVisitStatus.arrived,
                CampusVisitStatus.no_show,
            },
            StudentStage.campus_visit_scheduled: {
                CampusVisitStatus.scheduled,
                CampusVisitStatus.rescheduled,
                CampusVisitStatus.arrived,
                CampusVisitStatus.no_show,
            },
            StudentStage.campus_visit_arrived: {CampusVisitStatus.arrived},
        }[new_stage]
        if not await _has_campus_visit(db, student.id, required_statuses):
            raise ValueError("该阶段必须先存在对应的到校任务并完成相应处理")

    return new_stage
