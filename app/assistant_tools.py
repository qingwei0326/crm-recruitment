from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import shutil
from collections import defaultdict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_lead_utils import _student_search_predicate
from app.admin_ops_utils import backup_items
from app.auth import hash_password, invalidate_user_tokens
from app.backup import do_backup_async
from app.models import (
    EnrollmentRecord,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
    User,
    UserRole,
)
from app.services.assignment_service import AssignmentTarget, apply_assignment_changes
from app.services.lead_outcome_service import apply_outcome_reason
from app.services.work_item_service import sync_students_work_items
from app.status_policy import (
    canonical_status_value,
    canonical_student_status,
    normalize_status_for_write,
    statuses_for_canonical,
)
from app.student_delete import delete_students_cascade
from app.task_stats import ASSIGNABLE_STUDENT_STATUSES, TERMINAL_STUDENT_STATUSES
from app.utils import make_batch_id, make_operation_log, mask_phone, normalize_phone, utcnow

RISK_READ = "read"
RISK_WRITE = "write"
RISK_DESTRUCTIVE = "destructive"

ToolHandler = Callable[[AsyncSession, BaseModel, User], Awaitable[dict[str, Any]]]


class AssistantToolError(ValueError):
    pass


class StrictArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class SearchStudentsArgs(StrictArgs):
    query: str = Field(min_length=1, max_length=100)
    status: str | None = Field(default=None, max_length=32)
    limit: int = Field(default=10, ge=1, le=20)


class GetStudentArgs(StrictArgs):
    student_id: int = Field(gt=0)


class ListUsersArgs(StrictArgs):
    query: str = Field(default="", max_length=100)
    role: str | None = Field(default=None, pattern="^(admin|agent)$")
    active_only: bool = True
    limit: int = Field(default=20, ge=1, le=50)


class LeadSummaryArgs(StrictArgs):
    school_name: str = Field(default="", max_length=128)


class DuplicatePhonesArgs(StrictArgs):
    minimum_students: int = Field(default=3, ge=2, le=100)
    limit: int = Field(default=30, ge=1, le=100)


class OperationLogsArgs(StrictArgs):
    query: str = Field(default="", max_length=100)
    student_id: int | None = Field(default=None, gt=0)
    limit: int = Field(default=20, ge=1, le=50)


class SystemHealthArgs(StrictArgs):
    pass


class StudentIdsArgs(StrictArgs):
    student_ids: list[int] = Field(min_length=1, max_length=100)

    @field_validator("student_ids")
    @classmethod
    def normalize_student_ids(cls, value: list[int]) -> list[int]:
        normalized = list(dict.fromkeys(value))
        if any(student_id <= 0 for student_id in normalized):
            raise ValueError("student_ids 必须是正整数")
        return normalized


class MarkStudentsInvalidArgs(StudentIdsArgs):
    reason: str = Field(min_length=1, max_length=64)

    @field_validator("reason")
    @classmethod
    def normalize_reason(cls, value: str) -> str:
        reason = value.strip()
        if not reason:
            raise ValueError("无效原因不能为空")
        return reason


class AssignStudentsArgs(StudentIdsArgs):
    agent_id: int = Field(gt=0)


class AssignSchoolStudentsArgs(StrictArgs):
    school_name: str = Field(min_length=1, max_length=128)
    agent_ids: list[int] = Field(default_factory=list, max_length=20)
    agent_names: list[str] = Field(default_factory=list, max_length=20)

    @field_validator("school_name")
    @classmethod
    def normalize_school_name(cls, value: str) -> str:
        school_name = value.strip()
        if not school_name:
            raise ValueError("school_name 不能为空")
        return school_name

    @field_validator("agent_ids")
    @classmethod
    def normalize_agent_ids(cls, value: list[int]) -> list[int]:
        normalized = list(dict.fromkeys(value))
        if any(agent_id <= 0 for agent_id in normalized):
            raise ValueError("agent_ids 必须是正整数")
        return normalized

    @field_validator("agent_names")
    @classmethod
    def normalize_agent_names(cls, value: list[str]) -> list[str]:
        normalized = list(dict.fromkeys(name.strip() for name in value if name.strip()))
        if any(len(name) > 64 for name in normalized):
            raise ValueError("agent_names 中的姓名过长")
        return normalized


class ResetUserPasswordArgs(StrictArgs):
    user_id: int = Field(gt=0)


class CreateBackupArgs(StrictArgs):
    reason: str = Field(default="AI 助手执行前备份", max_length=100)


class CleanupDuplicatePhonesArgs(StrictArgs):
    minimum_students: int = Field(default=3, ge=2, le=100)
    delete_without_numbers: bool = True


class DeleteUnusablePhonesArgs(StrictArgs):
    include_enrolled: bool = False


@dataclass(frozen=True)
class AssistantToolDefinition:
    name: str
    label: str
    description: str
    risk_level: str
    args_model: type[BaseModel]
    execute: ToolHandler
    preview: ToolHandler | None = None
    requires_backup: bool = False
    sensitive_result_fields: tuple[str, ...] = ()

    def openai_schema(self) -> dict[str, Any]:
        schema = self.args_model.model_json_schema()
        schema["additionalProperties"] = False
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": schema,
            },
        }

    def parse_args(self, value: dict[str, Any]) -> BaseModel:
        try:
            return self.args_model.model_validate(value)
        except ValueError as exc:
            raise AssistantToolError(f"工具 {self.name} 参数无效：{exc}") from exc


def _json_digest(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(raw.encode()).hexdigest()


def _redact_phone_text(value: str) -> str:
    return re.sub(r"(?<!\d)(1\d{2})\d{4}(\d{4})(?!\d)", r"\1****\2", value or "")


def _student_payload(student: Student, agent_name: str | None = None) -> dict[str, Any]:
    return {
        "id": student.id,
        "name": student.name,
        "status": canonical_status_value(student.status),
        "status_detail": student.status_detail or "",
        "stage": student.stage.value,
        "school_name": student.school_name or "",
        "region": student.region or "",
        "guardian_phone": mask_phone(student.guardian_phone or ""),
        "guardian2_phone": mask_phone(student.guardian2_phone or ""),
        "assigned_to": student.assigned_to,
        "agent_name": agent_name or "未分配",
        "enrolled_at": str(student.enrolled_at) if student.enrolled_at else None,
        "updated_at": str(student.updated_at),
    }


async def _load_students_exact(
    db: AsyncSession,
    student_ids: list[int],
) -> list[Student]:
    result = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    by_id = {student.id: student for student in result.scalars().all()}
    missing = [student_id for student_id in student_ids if student_id not in by_id]
    if missing:
        raise AssistantToolError(f"未找到学生 ID：{', '.join(map(str, missing[:10]))}")
    return [by_id[student_id] for student_id in student_ids]


async def _search_students(
    db: AsyncSession,
    args: SearchStudentsArgs,
    _operator: User,
) -> dict[str, Any]:
    predicate = _student_search_predicate(args.query)
    where = [predicate]
    if args.status:
        try:
            canonical, _detail = normalize_status_for_write(args.status)
        except ValueError as exc:
            raise AssistantToolError(f"不支持的学生状态：{args.status}") from exc
        where.append(Student.status.in_(statuses_for_canonical(canonical)))
    rows = await db.execute(
        select(Student, User.name.label("agent_name"))
        .outerjoin(User, User.id == Student.assigned_to)
        .where(*where)
        .order_by(Student.updated_at.desc(), Student.id.desc())
        .limit(args.limit)
    )
    items = [_student_payload(student, agent_name) for student, agent_name in rows.all()]
    return {"query": args.query, "count": len(items), "students": items}


async def _get_student(
    db: AsyncSession,
    args: GetStudentArgs,
    _operator: User,
) -> dict[str, Any]:
    row = (
        await db.execute(
            select(Student, User.name.label("agent_name"))
            .outerjoin(User, User.id == Student.assigned_to)
            .where(Student.id == args.student_id)
        )
    ).one_or_none()
    if row is None:
        raise AssistantToolError("学生不存在")
    student, agent_name = row
    return {"student": _student_payload(student, agent_name)}


async def _list_users(
    db: AsyncSession,
    args: ListUsersArgs,
    _operator: User,
) -> dict[str, Any]:
    where = []
    if args.query.strip():
        keyword = args.query.strip()
        where.append(or_(User.name.contains(keyword), User.username.contains(keyword)))
    if args.role:
        where.append(User.role == UserRole(args.role))
    if args.active_only:
        where.append(User.is_active.is_(True))
    rows = (
        (
            await db.execute(
                select(User)
                .where(*where)
                .order_by(User.is_active.desc(), User.id)
                .limit(args.limit)
            )
        )
        .scalars()
        .all()
    )
    return {
        "count": len(rows),
        "users": [
            {
                "id": user.id,
                "name": user.name,
                "username": _redact_phone_text(user.username),
                "role": user.role.value,
                "is_active": user.is_active,
                "is_super_admin": user.is_super_admin,
            }
            for user in rows
        ],
    }


async def _lead_summary(
    db: AsyncSession,
    args: LeadSummaryArgs,
    _operator: User,
) -> dict[str, Any]:
    filters = []
    if args.school_name.strip():
        filters.append(Student.school_name == args.school_name.strip())
    total = (await db.execute(select(func.count(Student.id)).where(*filters))).scalar_one()
    assigned = (
        await db.execute(
            select(func.count(Student.id)).where(*filters, Student.assigned_to.is_not(None))
        )
    ).scalar_one()
    missing_phone = (
        await db.execute(
            select(func.count(Student.id)).where(
                *filters,
                func.trim(func.coalesce(Student.guardian_phone, "")) == "",
                func.trim(func.coalesce(Student.guardian2_phone, "")) == "",
            )
        )
    ).scalar_one()
    statuses = {}
    for status in (
        StudentStatus.not_contacted,
        StudentStatus.contacted,
        StudentStatus.not_reached,
        StudentStatus.pending_visit,
        StudentStatus.enrolled,
        StudentStatus.invalid,
    ):
        count = (
            await db.execute(
                select(func.count(Student.id)).where(
                    *filters,
                    Student.status.in_(statuses_for_canonical(status)),
                )
            )
        ).scalar_one()
        statuses[status.value] = count
    raw_unassigned = total - assigned
    assignable_unassigned = (
        await db.execute(
            select(func.count(Student.id)).where(
                *filters,
                Student.assigned_to.is_(None),
                Student.status.in_(ASSIGNABLE_STUDENT_STATUSES),
            )
        )
    ).scalar_one()
    return {
        "school_name": args.school_name.strip(),
        "total": total,
        "assigned": assigned,
        # AI 的“未分配”必须与实际分配入口保持同一口径，不能包含终态线索。
        "unassigned": assignable_unassigned,
        "assignable_unassigned": assignable_unassigned,
        "raw_unassigned": raw_unassigned,
        "terminal_unassigned": raw_unassigned - assignable_unassigned,
        "missing_phone": missing_phone,
        "statuses": statuses,
    }


async def _duplicate_phone_groups(
    db: AsyncSession,
    minimum_students: int,
) -> tuple[list[dict[str, Any]], dict[int, Student]]:
    students = (await db.execute(select(Student).order_by(Student.id))).scalars().all()
    groups: dict[str, set[int]] = defaultdict(set)
    by_id = {student.id: student for student in students}
    for student in students:
        for raw_phone in (student.guardian_phone, student.guardian2_phone):
            phone = normalize_phone(raw_phone)
            if phone:
                groups[phone].add(student.id)
    rows = [
        {"phone": phone, "student_ids": sorted(student_ids)}
        for phone, student_ids in groups.items()
        if len(student_ids) >= minimum_students
    ]
    rows.sort(key=lambda row: (-len(row["student_ids"]), row["phone"]))
    return rows, by_id


async def _find_duplicate_phones(
    db: AsyncSession,
    args: DuplicatePhonesArgs,
    _operator: User,
) -> dict[str, Any]:
    groups, by_id = await _duplicate_phone_groups(db, args.minimum_students)
    visible = []
    for group in groups[: args.limit]:
        students = [by_id[student_id] for student_id in group["student_ids"]]
        visible.append(
            {
                "phone": mask_phone(group["phone"]),
                "student_count": len(students),
                "students": [
                    {
                        "id": student.id,
                        "name": student.name,
                        "school_name": student.school_name or "",
                        "status": canonical_status_value(student.status),
                    }
                    for student in students[:10]
                ],
            }
        )
    return {
        "minimum_students": args.minimum_students,
        "total_groups": len(groups),
        "groups": visible,
        "truncated": len(groups) > args.limit,
    }


async def _operation_logs(
    db: AsyncSession,
    args: OperationLogsArgs,
    _operator: User,
) -> dict[str, Any]:
    where = []
    if args.student_id:
        where.append(OperationLog.target_student_id == args.student_id)
    if args.query.strip():
        keyword = args.query.strip()
        like = f"%{keyword}%"
        where.append(
            or_(
                OperationLog.operator_name.like(like),
                OperationLog.action.like(like),
                OperationLog.content.like(like),
                OperationLog.note_content.like(like),
                OperationLog.batch_id.like(like),
            )
        )
    rows = (
        (
            await db.execute(
                select(OperationLog)
                .where(*where)
                .order_by(OperationLog.created_at.desc(), OperationLog.id.desc())
                .limit(args.limit)
            )
        )
        .scalars()
        .all()
    )
    return {
        "count": len(rows),
        "logs": [
            {
                "id": row.id,
                "operator_name": row.operator_name,
                "student_id": row.target_student_id,
                "action": row.action,
                "content": _redact_phone_text((row.content or "")[:500]),
                "note_content": _redact_phone_text((row.note_content or "")[:300]),
                "batch_id": row.batch_id,
                "created_at": str(row.created_at),
            }
            for row in rows
        ],
    }


async def _system_health(
    db: AsyncSession,
    _args: SystemHealthArgs,
    _operator: User,
) -> dict[str, Any]:
    started = datetime.now(UTC)
    await db.execute(text("SELECT 1"))
    db_ms = round((datetime.now(UTC) - started).total_seconds() * 1000, 1)
    total, used, free = shutil.disk_usage(os.getcwd())
    try:
        load = list(os.getloadavg())
    except (AttributeError, OSError):
        load = []
    return {
        "database": "ok",
        "database_ms": db_ms,
        "load_average": load,
        "disk": {"total": total, "used": used, "free": free},
        "backups": backup_items()[:5],
    }


async def _preview_mark_invalid(
    db: AsyncSession,
    args: MarkStudentsInvalidArgs,
    _operator: User,
) -> dict[str, Any]:
    students = await _load_students_exact(db, args.student_ids)
    enrollment_counts = dict(
        (
            await db.execute(
                select(EnrollmentRecord.student_id, func.count(EnrollmentRecord.id))
                .where(EnrollmentRecord.student_id.in_(args.student_ids))
                .group_by(EnrollmentRecord.student_id)
            )
        ).all()
    )
    blocked = [
        student
        for student in students
        if canonical_student_status(student.status) == StudentStatus.enrolled
        and enrollment_counts.get(student.id, 0) > 0
    ]
    if blocked:
        names = "、".join(student.name for student in blocked[:5])
        raise AssistantToolError(f"{names} 存在正式报名记录，不能直接改为无效")
    items = [
        {
            "id": student.id,
            "name": student.name,
            "old_status": canonical_status_value(student.status),
            "new_status": StudentStatus.invalid.value,
            "reason": args.reason,
            "will_clear_enrollment": (
                canonical_student_status(student.status) == StudentStatus.enrolled
                or student.stage == StudentStage.enrolled
            ),
        }
        for student in students
    ]
    state = [
        {
            "id": student.id,
            "status": str(student.status),
            "detail": student.status_detail,
            "stage": str(student.stage),
            "enrolled_at": str(student.enrolled_at or ""),
            "substage": str(student.enrollment_substage or ""),
            "updated_at": str(student.updated_at),
            "enrollment_records": enrollment_counts.get(student.id, 0),
        }
        for student in students
    ]
    return {"summary": f"将 {len(items)} 名学生标记为无效", "items": items, "state": state}


async def _execute_mark_invalid(
    db: AsyncSession,
    args: MarkStudentsInvalidArgs,
    operator: User,
) -> dict[str, Any]:
    students = await _load_students_exact(db, args.student_ids)
    preview = await _preview_mark_invalid(db, args, operator)
    batch_id = make_batch_id("assistant-invalid")
    for student in students:
        old_status = canonical_status_value(student.status) or ""
        old_stage = student.stage.value
        was_enrolled = (
            canonical_student_status(student.status) == StudentStatus.enrolled
            or student.stage == StudentStage.enrolled
        )
        student.status = StudentStatus.invalid
        await apply_outcome_reason(db, student, args.reason)
        if was_enrolled:
            student.stage = StudentStage.initial_contact
            student.enrolled_at = None
            student.enrollment_substage = None
        parts = [f"状态 {old_status} → 无效", f"无效原因：{student.status_detail}"]
        if was_enrolled:
            parts.append(f"阶段 {old_stage} → {StudentStage.initial_contact.value}")
            parts.append("清除报名日期和报名后状态")
        db.add(
            make_operation_log(
                operator,
                student.id,
                student.case_no or "",
                "AI助手修改状态",
                content="; ".join(parts),
                old_status=old_status,
                new_status=StudentStatus.invalid.value,
                note_content=student.status_detail,
                batch_id=batch_id,
            )
        )
    await sync_students_work_items(db, students, operator, at=utcnow())
    return {
        "changed_count": len(students),
        "batch_id": batch_id,
        "students": preview["items"],
    }


async def _preview_assign_students(
    db: AsyncSession,
    args: AssignStudentsArgs,
    _operator: User,
) -> dict[str, Any]:
    agent = await db.get(User, args.agent_id)
    if not agent or not agent.is_active or agent.role != UserRole.agent:
        raise AssistantToolError("目标话务员不存在、已停用或不是话务员")
    students = await _load_students_exact(db, args.student_ids)
    terminal = [student for student in students if student.status in TERMINAL_STUDENT_STATUSES]
    if terminal:
        names = "、".join(student.name for student in terminal[:5])
        raise AssistantToolError(f"终态学生不能重新分配：{names}")
    items = [
        {
            "id": student.id,
            "name": student.name,
            "old_agent_id": student.assigned_to,
            "new_agent_id": agent.id,
            "new_agent_name": agent.name,
        }
        for student in students
    ]
    state = [
        {
            "id": student.id,
            "assigned_to": student.assigned_to,
            "status": str(student.status),
            "updated_at": str(student.updated_at),
        }
        for student in students
    ]
    return {"summary": f"将 {len(items)} 名学生分配给 {agent.name}", "items": items, "state": state}


async def _execute_assign_students(
    db: AsyncSession,
    args: AssignStudentsArgs,
    operator: User,
) -> dict[str, Any]:
    preview = await _preview_assign_students(db, args, operator)
    batch_id = make_batch_id("assistant-assign")
    await apply_assignment_changes(
        db,
        [
            AssignmentTarget(student_id=student_id, agent_id=args.agent_id)
            for student_id in args.student_ids
        ],
        operator=operator,
        reason="assistant_assignment",
        batch_id=batch_id,
        at=utcnow(),
    )
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="AI助手批量分配",
            content=preview["summary"],
            batch_id=batch_id,
        )
    )
    return {
        "assigned_count": len(args.student_ids),
        "agent_id": args.agent_id,
        "batch_id": batch_id,
    }


async def _preview_assign_school_students(
    db: AsyncSession,
    args: AssignSchoolStudentsArgs,
    _operator: User,
) -> dict[str, Any]:
    if not args.agent_ids and not args.agent_names:
        raise AssistantToolError("至少提供一个话务员姓名或用户 ID")
    target_filters = []
    if args.agent_ids:
        target_filters.append(User.id.in_(args.agent_ids))
    if args.agent_names:
        target_filters.append(User.name.in_(args.agent_names))
    users = (
        (
            await db.execute(
                select(User).where(
                    or_(*target_filters),
                    User.is_active.is_(True),
                    User.role == UserRole.agent,
                )
            )
        )
        .scalars()
        .all()
    )
    by_id = {user.id: user for user in users}
    missing_ids = [agent_id for agent_id in args.agent_ids if agent_id not in by_id]
    if missing_ids:
        raise AssistantToolError(f"话务员不存在、已停用或不是话务员：{missing_ids}")
    agents = [by_id[agent_id] for agent_id in args.agent_ids]
    for name in args.agent_names:
        matches = [user for user in users if user.name == name]
        if not matches:
            raise AssistantToolError(f"未找到在职话务员：{name}")
        if len(matches) > 1:
            raise AssistantToolError(f"话务员姓名重名，请改用用户 ID：{name}")
        agents.append(matches[0])
    agents = list({agent.id: agent for agent in agents}.values())
    students = (
        (
            await db.execute(
                select(Student)
                .where(
                    Student.school_name == args.school_name,
                    Student.assigned_to.is_(None),
                    Student.status.in_(ASSIGNABLE_STUDENT_STATUSES),
                )
                .order_by(Student.id)
            )
        )
        .scalars()
        .all()
    )
    if not students:
        raise AssistantToolError(
            f"{args.school_name} 当前没有可分配的未分配学生；终态线索不能直接分配"
        )
    targets = [
        AssignmentTarget(student_id=student.id, agent_id=agents[index % len(agents)].id)
        for index, student in enumerate(students)
    ]
    distribution: dict[int, int] = defaultdict(int)
    for target in targets:
        if target.agent_id is None:
            raise AssistantToolError("学校分配目标缺少话务员")
        distribution[target.agent_id] += 1
    items = [
        {
            "id": student.id,
            "name": student.name,
            "new_agent_id": targets[index].agent_id,
            "new_agent_name": by_id[targets[index].agent_id].name,
        }
        for index, student in enumerate(students[:20])
    ]
    state = [
        {
            "id": student.id,
            "assigned_to": student.assigned_to,
            "status": str(student.status),
            "updated_at": str(student.updated_at),
        }
        for student in students
    ]
    return {
        "summary": f"将 {len(students)} 名学生按顺序均分给 {len(agents)} 名话务员",
        "school_name": args.school_name,
        "student_count": len(students),
        "distribution": [
            {"agent_id": agent.id, "agent_name": agent.name, "count": distribution[agent.id]}
            for agent in agents
        ],
        "items": items,
        "items_truncated": len(students) > len(items),
        "_targets": [
            {"student_id": target.student_id, "agent_id": target.agent_id} for target in targets
        ],
        "state": state,
    }


async def _execute_assign_school_students(
    db: AsyncSession,
    args: AssignSchoolStudentsArgs,
    operator: User,
) -> dict[str, Any]:
    preview = await _preview_assign_school_students(db, args, operator)
    batch_id = make_batch_id("assistant-school-assign")
    targets = [AssignmentTarget(**target) for target in preview["_targets"]]
    await apply_assignment_changes(
        db,
        targets,
        operator=operator,
        reason="assistant_school_assignment",
        batch_id=batch_id,
        at=utcnow(),
    )
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="AI助手学校分配",
            content=preview["summary"],
            batch_id=batch_id,
        )
    )
    return {
        "assigned_count": preview["student_count"],
        "school_name": args.school_name,
        "distribution": preview["distribution"],
        "batch_id": batch_id,
    }


async def _preview_reclaim_students(
    db: AsyncSession,
    args: StudentIdsArgs,
    _operator: User,
) -> dict[str, Any]:
    students = await _load_students_exact(db, args.student_ids)
    assigned = [student for student in students if student.assigned_to is not None]
    if not assigned:
        raise AssistantToolError("所选学生当前均未分配")
    items = [
        {
            "id": student.id,
            "name": student.name,
            "old_agent_id": student.assigned_to,
            "new_agent_id": None,
            "status": canonical_status_value(student.status),
        }
        for student in assigned
    ]
    state = [
        {
            "id": student.id,
            "assigned_to": student.assigned_to,
            "status": str(student.status),
            "updated_at": str(student.updated_at),
        }
        for student in students
    ]
    return {"summary": f"回收 {len(items)} 名学生到未分配池", "items": items, "state": state}


async def _execute_reclaim_students(
    db: AsyncSession,
    args: StudentIdsArgs,
    operator: User,
) -> dict[str, Any]:
    preview = await _preview_reclaim_students(db, args, operator)
    student_ids = [item["id"] for item in preview["items"]]
    batch_id = make_batch_id("assistant-reclaim")
    await apply_assignment_changes(
        db,
        [AssignmentTarget(student_id=student_id, agent_id=None) for student_id in student_ids],
        operator=operator,
        reason="assistant_reclaim",
        batch_id=batch_id,
        at=utcnow(),
    )
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="AI助手线索回收",
            content=preview["summary"],
            batch_id=batch_id,
        )
    )
    return {"reclaimed_count": len(student_ids), "batch_id": batch_id}


async def _preview_reset_password(
    db: AsyncSession,
    args: ResetUserPasswordArgs,
    operator: User,
) -> dict[str, Any]:
    user = await db.get(User, args.user_id)
    if not user:
        raise AssistantToolError("用户不存在")
    if user.id == operator.id:
        raise AssistantToolError("不能通过 AI 助手重置自己的密码")
    return {
        "summary": f"重置 {user.name} 的登录密码并使旧登录失效",
        "items": [
            {
                "id": user.id,
                "name": user.name,
                "username": _redact_phone_text(user.username),
                "role": user.role.value,
                "must_change_password": True,
            }
        ],
        "state": {
            "id": user.id,
            "token_version": user.token_version,
            "is_active": user.is_active,
            "hashed_password": _json_digest(user.hashed_password),
        },
    }


async def _execute_reset_password(
    db: AsyncSession,
    args: ResetUserPasswordArgs,
    operator: User,
) -> dict[str, Any]:
    preview = await _preview_reset_password(db, args, operator)
    user = await db.get(User, args.user_id)
    new_password = secrets.token_urlsafe(8)
    user.hashed_password = hash_password(new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    user.must_change_password = True
    invalidate_user_tokens(user)
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="AI助手重置密码",
            content=f"重置 {user.username} 的密码，旧登录已失效",
        )
    )
    return {
        "user_id": user.id,
        "name": user.name,
        "new_password": new_password,
        "must_change_password": True,
        "summary": preview["summary"],
    }


async def _execute_create_backup(
    db: AsyncSession,
    args: CreateBackupArgs,
    operator: User,
) -> dict[str, Any]:
    before = {item["name"] for item in backup_items()}
    await do_backup_async()
    after = backup_items()
    created = next((item for item in after if item["name"] not in before), None)
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="AI助手备份",
            content=f"AI 助手触发数据库备份：{args.reason}",
        )
    )
    return {"created": created is not None, "backup": created, "reason": args.reason}


async def _preview_create_backup(
    _db: AsyncSession,
    args: CreateBackupArgs,
    _operator: User,
) -> dict[str, Any]:
    backups = backup_items()
    return {
        "summary": f"立即创建数据库备份：{args.reason}",
        "items": [{"reason": args.reason, "latest_backup": backups[0] if backups else None}],
        "state": {"reason": args.reason},
    }


async def _duplicate_cleanup_plan(
    db: AsyncSession,
    minimum_students: int,
) -> dict[str, Any]:
    groups, by_id = await _duplicate_phone_groups(db, minimum_students)
    duplicate_phones = {group["phone"] for group in groups}
    affected: list[dict[str, Any]] = []
    for student in by_id.values():
        old_1 = normalize_phone(student.guardian_phone)
        old_2 = normalize_phone(student.guardian2_phone)
        new_1 = "" if old_1 in duplicate_phones else old_1
        new_2 = "" if old_2 in duplicate_phones else old_2
        removed = [phone for phone in dict.fromkeys((old_1, old_2)) if phone in duplicate_phones]
        if not removed:
            continue
        affected.append(
            {
                "student": student,
                "removed": removed,
                "new_1": new_1,
                "new_2": new_2,
                "will_delete": not (new_1 or new_2),
            }
        )
    state_rows = [
        {
            "id": row["student"].id,
            "phones": _json_digest(
                [row["student"].guardian_phone or "", row["student"].guardian2_phone or ""]
            ),
            "updated_at": str(row["student"].updated_at),
        }
        for row in affected
    ]
    return {
        "groups": groups,
        "duplicate_phones": duplicate_phones,
        "affected": affected,
        "state": {"count": len(state_rows), "digest": _json_digest(state_rows)},
    }


async def _preview_cleanup_duplicates(
    db: AsyncSession,
    args: CleanupDuplicatePhonesArgs,
    _operator: User,
) -> dict[str, Any]:
    plan = await _duplicate_cleanup_plan(db, args.minimum_students)
    delete_count = sum(1 for row in plan["affected"] if row["will_delete"])
    clear_count = len(plan["affected"]) - delete_count
    items = [
        {
            "id": row["student"].id,
            "name": row["student"].name,
            "school_name": row["student"].school_name or "",
            "removed_phones": [mask_phone(phone) for phone in row["removed"]],
            "remaining_phones": [
                mask_phone(phone) for phone in (row["new_1"], row["new_2"]) if phone
            ],
            "will_delete": row["will_delete"] and args.delete_without_numbers,
        }
        for row in plan["affected"][:50]
    ]
    return {
        "summary": (
            f"清理 {len(plan['groups'])} 个重复手机号组，影响 {len(plan['affected'])} 名学生；"
            f"保留并清号 {clear_count} 名，"
            f"{'删除' if args.delete_without_numbers else '保留'}无剩余号码 {delete_count} 名"
        ),
        "duplicate_group_count": len(plan["groups"]),
        "affected_count": len(plan["affected"]),
        "clear_count": clear_count,
        "delete_count": delete_count if args.delete_without_numbers else 0,
        "items": items,
        "truncated": len(plan["affected"]) > len(items),
        "state": plan["state"],
    }


async def _delete_students_with_all_relations(
    db: AsyncSession,
    students: list[Student],
    operator: User,
    *,
    action: str,
    batch_id: str,
) -> int:
    return await delete_students_cascade(
        db, students, operator, action=action, batch_id=batch_id
    )


async def _execute_cleanup_duplicates(
    db: AsyncSession,
    args: CleanupDuplicatePhonesArgs,
    operator: User,
) -> dict[str, Any]:
    plan = await _duplicate_cleanup_plan(db, args.minimum_students)
    batch_id = make_batch_id("assistant-phone-cleanup")
    delete_students = []
    cleared_count = 0
    for row in plan["affected"]:
        student = row["student"]
        if row["will_delete"] and args.delete_without_numbers:
            delete_students.append(student)
            continue
        student.guardian_phone = row["new_1"]
        student.guardian2_phone = row["new_2"]
        kept_phone_text = "、".join(
            mask_phone(phone) for phone in (row["new_1"], row["new_2"]) if phone
        )
        db.add(
            make_operation_log(
                operator,
                student.id,
                student.case_no or "",
                "AI助手清理重复号码",
                content=(
                    f"清除重复号码 {'、'.join(mask_phone(phone) for phone in row['removed'])}；"
                    f"剩余号码 {kept_phone_text or '无'}"
                ),
                batch_id=batch_id,
            )
        )
        cleared_count += 1
    deleted_count = await _delete_students_with_all_relations(
        db,
        delete_students,
        operator,
        action="AI助手删除无号码线索",
        batch_id=batch_id,
    )
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="AI助手数据清理汇总",
            content=(
                f"重复号码组 {len(plan['groups'])} 个，影响 {len(plan['affected'])} 名；"
                f"清号 {cleared_count} 名，删除无号码 {deleted_count} 名"
            ),
            batch_id=batch_id,
        )
    )
    return {
        "batch_id": batch_id,
        "duplicate_group_count": len(plan["groups"]),
        "affected_count": len(plan["affected"]),
        "cleared_count": cleared_count,
        "deleted_count": deleted_count,
    }


async def _unusable_phone_students(
    db: AsyncSession,
    include_enrolled: bool,
) -> list[Student]:
    where = [
        func.trim(func.coalesce(Student.guardian_phone, "")) == "",
        func.trim(func.coalesce(Student.guardian2_phone, "")) == "",
    ]
    if not include_enrolled:
        where.append(Student.status.not_in(statuses_for_canonical(StudentStatus.enrolled)))
    return (await db.execute(select(Student).where(*where).order_by(Student.id))).scalars().all()


async def _preview_delete_unusable(
    db: AsyncSession,
    args: DeleteUnusablePhonesArgs,
    _operator: User,
) -> dict[str, Any]:
    students = await _unusable_phone_students(db, args.include_enrolled)
    state_rows = [
        {"id": student.id, "status": str(student.status), "updated_at": str(student.updated_at)}
        for student in students
    ]
    items = [
        {
            "id": student.id,
            "name": student.name,
            "school_name": student.school_name or "",
            "status": canonical_status_value(student.status),
        }
        for student in students[:50]
    ]
    return {
        "summary": f"删除 {len(students)} 名没有任何可用号码的学生",
        "delete_count": len(students),
        "items": items,
        "truncated": len(students) > len(items),
        "state": {"count": len(state_rows), "digest": _json_digest(state_rows)},
    }


async def _execute_delete_unusable(
    db: AsyncSession,
    args: DeleteUnusablePhonesArgs,
    operator: User,
) -> dict[str, Any]:
    students = await _unusable_phone_students(db, args.include_enrolled)
    batch_id = make_batch_id("assistant-no-phone-delete")
    deleted_count = await _delete_students_with_all_relations(
        db,
        students,
        operator,
        action="AI助手删除无号码线索",
        batch_id=batch_id,
    )
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="AI助手数据清理汇总",
            content=f"删除没有任何可用号码的学生 {deleted_count} 名",
            batch_id=batch_id,
        )
    )
    return {"deleted_count": deleted_count, "batch_id": batch_id}


async def _preview_delete_invalid(
    db: AsyncSession,
    args: StudentIdsArgs,
    _operator: User,
) -> dict[str, Any]:
    students = await _load_students_exact(db, args.student_ids)
    non_invalid = [
        student
        for student in students
        if canonical_student_status(student.status) != StudentStatus.invalid
    ]
    if non_invalid:
        names = "、".join(student.name for student in non_invalid[:5])
        raise AssistantToolError(f"以下学生不是无效状态：{names}")
    state_rows = [
        {"id": student.id, "status": str(student.status), "updated_at": str(student.updated_at)}
        for student in students
    ]
    return {
        "summary": f"永久删除 {len(students)} 名无效学生及关联业务记录",
        "delete_count": len(students),
        "items": [
            {
                "id": student.id,
                "name": student.name,
                "school_name": student.school_name or "",
                "reason": student.status_detail or "未填写",
            }
            for student in students[:50]
        ],
        "truncated": len(students) > 50,
        "state": {"count": len(state_rows), "digest": _json_digest(state_rows)},
    }


async def _execute_delete_invalid(
    db: AsyncSession,
    args: StudentIdsArgs,
    operator: User,
) -> dict[str, Any]:
    await _preview_delete_invalid(db, args, operator)
    students = await _load_students_exact(db, args.student_ids)
    batch_id = make_batch_id("assistant-invalid-delete")
    deleted_count = await _delete_students_with_all_relations(
        db,
        students,
        operator,
        action="AI助手批量删除无效线索",
        batch_id=batch_id,
    )
    db.add(
        make_operation_log(
            operator,
            target_student_id=None,
            case_no="",
            action="AI助手数据清理汇总",
            content=f"批量删除无效学生 {deleted_count} 名",
            batch_id=batch_id,
        )
    )
    return {"deleted_count": deleted_count, "batch_id": batch_id}


TOOLS = (
    AssistantToolDefinition(
        "search_students",
        "搜索学生",
        "按姓名、学校、地区、手机号尾号或历史记录模糊搜索学生。",
        RISK_READ,
        SearchStudentsArgs,
        _search_students,
    ),
    AssistantToolDefinition(
        "get_student",
        "查看学生",
        "按精确学生 ID 查看脱敏后的当前信息。",
        RISK_READ,
        GetStudentArgs,
        _get_student,
    ),
    AssistantToolDefinition(
        "list_users",
        "搜索账号",
        "搜索管理员或话务员账号，返回可用于后续操作的用户 ID。",
        RISK_READ,
        ListUsersArgs,
        _list_users,
    ),
    AssistantToolDefinition(
        "get_lead_summary",
        "线索统计",
        (
            "查询全局或指定学校的线索状态、可分配未分配人数和终态未分配人数；"
            "分配决策必须使用 assignable_unassigned/unassigned，不能使用 raw_unassigned。"
        ),
        RISK_READ,
        LeadSummaryArgs,
        _lead_summary,
    ),
    AssistantToolDefinition(
        "find_duplicate_phones",
        "重复号码检查",
        "查找同时属于多名学生的家长手机号，返回脱敏号码和学生列表。",
        RISK_READ,
        DuplicatePhonesArgs,
        _find_duplicate_phones,
    ),
    AssistantToolDefinition(
        "get_operation_logs",
        "查询操作记录",
        "按关键词或学生 ID 查询最近操作记录。",
        RISK_READ,
        OperationLogsArgs,
        _operation_logs,
    ),
    AssistantToolDefinition(
        "get_system_health",
        "系统健康检查",
        "查询数据库响应、系统负载、磁盘和最近备份。",
        RISK_READ,
        SystemHealthArgs,
        _system_health,
    ),
    AssistantToolDefinition(
        "mark_students_invalid",
        "标记学生无效",
        "将精确学生 ID 标记为无效并记录原因；错误报名且没有正式报名记录时会清理报名标记。",
        RISK_WRITE,
        MarkStudentsInvalidArgs,
        _execute_mark_invalid,
        preview=_preview_mark_invalid,
    ),
    AssistantToolDefinition(
        "assign_students",
        "分配学生",
        "把指定学生 ID 的非终态学生分配给指定的在职话务员。",
        RISK_WRITE,
        AssignStudentsArgs,
        _execute_assign_students,
        preview=_preview_assign_students,
    ),
    AssistantToolDefinition(
        "assign_school_students",
        "按学校分配学生",
        (
            "把指定学校当前所有可分配且未分配的非终态学生，"
            "按顺序均分给一个或多个在职话务员；用户按学校提出整校分配时"
            "应优先使用此工具，不需要先获取学生 ID。"
        ),
        RISK_WRITE,
        AssignSchoolStudentsArgs,
        _execute_assign_school_students,
        preview=_preview_assign_school_students,
    ),
    AssistantToolDefinition(
        "reclaim_students_to_pool",
        "回收学生",
        "取消学生当前归属，使其进入未分配池；保留状态和历史。",
        RISK_WRITE,
        StudentIdsArgs,
        _execute_reclaim_students,
        preview=_preview_reclaim_students,
    ),
    AssistantToolDefinition(
        "reset_user_password",
        "重置账号密码",
        "重置指定账号密码、使旧登录失效并返回一次性随机密码。",
        RISK_WRITE,
        ResetUserPasswordArgs,
        _execute_reset_password,
        preview=_preview_reset_password,
        sensitive_result_fields=("new_password",),
    ),
    AssistantToolDefinition(
        "create_database_backup",
        "创建数据库备份",
        "立即创建一次数据库备份并记录原因。",
        RISK_WRITE,
        CreateBackupArgs,
        _execute_create_backup,
        preview=_preview_create_backup,
    ),
    AssistantToolDefinition(
        "cleanup_duplicate_phones",
        "清洗重复号码",
        "清除同时属于至少指定人数的手机号，并可删除清洗后没有号码的学生。",
        RISK_DESTRUCTIVE,
        CleanupDuplicatePhonesArgs,
        _execute_cleanup_duplicates,
        preview=_preview_cleanup_duplicates,
        requires_backup=True,
    ),
    AssistantToolDefinition(
        "delete_students_without_phones",
        "删除无号码学生",
        "删除主家长和第二家长手机号都为空的学生及关联业务记录。",
        RISK_DESTRUCTIVE,
        DeleteUnusablePhonesArgs,
        _execute_delete_unusable,
        preview=_preview_delete_unusable,
        requires_backup=True,
    ),
    AssistantToolDefinition(
        "delete_invalid_students",
        "删除无效学生",
        "按精确学生 ID 永久删除无效学生及全部关联业务记录。",
        RISK_DESTRUCTIVE,
        StudentIdsArgs,
        _execute_delete_invalid,
        preview=_preview_delete_invalid,
        requires_backup=True,
    ),
)

TOOL_BY_NAME = {tool.name: tool for tool in TOOLS}


def assistant_tool_schemas() -> list[dict[str, Any]]:
    return [tool.openai_schema() for tool in TOOLS]


def assistant_tool(name: str) -> AssistantToolDefinition:
    try:
        return TOOL_BY_NAME[name]
    except KeyError as exc:
        raise AssistantToolError(f"AI 请求了未授权工具：{name}") from exc


def public_preview(preview: dict[str, Any]) -> dict[str, Any]:
    return {
        key: value
        for key, value in preview.items()
        if not key.startswith("_") and key != "state"
    }


def preview_state_hash(preview: dict[str, Any]) -> str:
    return _json_digest(preview.get("state"))


def redact_sensitive_result(
    tool: AssistantToolDefinition,
    result: dict[str, Any],
) -> dict[str, Any]:
    persisted = dict(result)
    for field in tool.sensitive_result_fields:
        if field in persisted:
            persisted[field] = "[仅在执行响应中显示一次]"
    return persisted
