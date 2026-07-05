
from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    require_admin,
)
from app.database import get_db
from app.models import (
    IntentLevel,
    Student,
    StudentStage,
    StudentStatus,
    User,
)
from app.schemas import Response
from app.status_policy import statuses_for_canonical

router = APIRouter(prefix="/api/stats", tags=["统计"])


def _stage_stats_key(stage) -> str:
    if stage == StudentStage.visit_scheduled:
        return StudentStage.campus_visit_scheduled.value
    if stage == StudentStage.visited:
        return StudentStage.campus_visit_arrived.value
    return stage.value if hasattr(stage, "value") else str(stage)


def _enum_value(value) -> str:
    return value.value if hasattr(value, "value") else str(value or "")


def _percent(part: int | float, total: int | float) -> float:
    return round(float(part or 0) / float(total or 0) * 100, 1) if total else 0.0


def _region_label(value: str | None) -> str:
    return (value or "").strip() or "未知"


@router.get("/sources")
async def source_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    rows = await db.execute(
        select(
            Student.region,
            func.count(Student.id),
            func.sum(
                case(
                    (
                        Student.status.not_in([StudentStatus.not_contacted, StudentStatus.invalid]),
                        1,
                    ),
                    else_=0,
                )
            ),
            func.sum(case((Student.intent_level == IntentLevel.A, 1), else_=0)),
        )
        .where(Student.region != "")
        .group_by(Student.region)
    )
    data = [
        {
            "source": region,
            "total": total,
            "contacted": int(contacted),
            "a_count": int(a_count),
            "conversion_rate": round(int(a_count) / total * 100, 1) if total > 0 else 0,
        }
        for region, total, contacted, a_count in rows.all()
    ]
    return Response.ok(data)


@router.get("/stages")
async def stage_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    result = await db.execute(
        select(Student.stage, func.count(Student.id))
        .where(Student.status.not_in(statuses_for_canonical(StudentStatus.invalid)))
        .group_by(Student.stage)
    )
    by_stage = {}
    for stage, count in result.all():
        key = _stage_stats_key(stage)
        by_stage[key] = by_stage.get(key, 0) + count
    unassigned = (
        await db.execute(
            select(func.count(Student.id)).where(
                Student.assigned_to.is_(None),
                Student.status.not_in(statuses_for_canonical(StudentStatus.invalid)),
            )
        )
    ).scalar() or 0
    by_stage["未分配"] = unassigned
    return Response.ok(by_stage)
