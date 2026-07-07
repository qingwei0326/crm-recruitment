from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_STUDENT_ASSIGN,
    ADMIN_PAGE_LEAD_GOVERNANCE,
    require_operation_permission,
    require_page_permission,
)
from app.database import get_db
from app.models import Student, User
from app.schemas import Response
from app.smart_assignment import SmartAssignParams, build_smart_assignment_plan
from app.utils import (
    assignment_state_label,
    make_assignment_rollback_note,
    make_batch_id,
    make_operation_log,
    utcnow,
)

router = APIRouter(prefix="/api/admin", tags=["管理"])


class SmartAssignExecuteReq(BaseModel):
    school_name: str = ""
    region: str = ""
    limit: int = Field(default=500, ge=1, le=5000)
    per_agent_limit: int = Field(default=100, ge=1, le=1000)
    confirm: bool = False

    @field_validator("school_name", "region")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        return (value or "").strip()

    def params(self) -> SmartAssignParams:
        return SmartAssignParams(
            school_name=self.school_name,
            region=self.region,
            limit=self.limit,
            per_agent_limit=self.per_agent_limit,
        )


def _params_from_query(
    school_name: str = "",
    region: str = "",
    limit: int = Query(default=500, ge=1, le=5000),
    per_agent_limit: int = Query(default=100, ge=1, le=1000),
) -> SmartAssignParams:
    return SmartAssignParams(
        school_name=(school_name or "").strip(),
        region=(region or "").strip(),
        limit=limit,
        per_agent_limit=per_agent_limit,
    )


@router.get("/smart-assign/preview")
async def smart_assign_preview(
    params: SmartAssignParams = Depends(_params_from_query),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_LEAD_GOVERNANCE)),
):
    plan = await build_smart_assignment_plan(db, params)
    return Response.ok(plan.payload)


@router.post("/smart-assign/execute")
async def smart_assign_execute(
    body: SmartAssignExecuteReq,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_operation_permission(ADMIN_OP_STUDENT_ASSIGN)),
):
    if not body.confirm:
        return Response.error(code=1, msg="请确认后再执行智能分配")

    plan = await build_smart_assignment_plan(db, body.params())
    if not plan.assignments_by_agent:
        return Response.ok(
            {
                "batch_id": "",
                "assigned_count": 0,
                "skipped_count": 0,
                "per_agent": [],
                "warnings": plan.payload.get("warnings", []),
            }
        )

    now = utcnow()
    batch_id = make_batch_id("smart-assign")
    all_student_ids = [
        student_id
        for ids in plan.assignments_by_agent.values()
        for student_id in ids
    ]
    students = (
        (await db.execute(select(Student).where(Student.id.in_(all_student_ids))))
        .scalars()
        .all()
    )
    students_by_id = {student.id: student for student in students}
    assigned_count = 0
    skipped_count = 0
    assigned_by_agent: dict[int, int] = {}

    for agent_id, student_ids in plan.assignments_by_agent.items():
        for student_id in student_ids:
            student = students_by_id.get(student_id)
            if student is None or student.assigned_to is not None:
                skipped_count += 1
                continue
            old_assigned_to = student.assigned_to
            old_assigned_at = student.assigned_at
            student.assigned_to = agent_id
            student.assigned_at = now
            db.add(
                make_operation_log(
                    current_user,
                    student.id,
                    student.case_no or "",
                    "智能分配",
                    content=f"智能分配给话务员 {agent_id}",
                    old_status=assignment_state_label(old_assigned_to),
                    new_status=assignment_state_label(agent_id),
                    note_content=make_assignment_rollback_note(
                        old_assigned_to=old_assigned_to,
                        old_assigned_at=old_assigned_at,
                        new_assigned_to=agent_id,
                        new_assigned_at=now,
                    ),
                    batch_id=batch_id,
                )
            )
            assigned_count += 1
            assigned_by_agent[agent_id] = assigned_by_agent.get(agent_id, 0) + 1

    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="智能分配汇总",
            content=(
                f"智能分配执行：计划 {plan.payload['plan']['planned']} 条，"
                f"实际 {assigned_count} 条，跳过 {skipped_count} 条；"
                f"学校：{body.school_name or '全部'}；区县：{body.region or '全部'}"
            ),
            batch_id=batch_id,
        )
    )
    await db.commit()

    per_agent = []
    for row in plan.payload["plan"]["per_agent"]:
        assigned_for_agent = assigned_by_agent.get(row["agent_id"], 0)
        if assigned_for_agent:
            per_agent.append({**row, "count": assigned_for_agent})

    return Response.ok(
        {
            "batch_id": batch_id,
            "assigned_count": assigned_count,
            "skipped_count": skipped_count,
            "per_agent": per_agent,
            "warnings": plan.payload.get("warnings", []),
        }
    )
