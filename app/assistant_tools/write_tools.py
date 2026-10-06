from __future__ import annotations

import secrets
from collections import defaultdict
from typing import Any

from pydantic import Field, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_ops_utils import backup_items
from app.assistant_tools.base import (
    RISK_WRITE,
    AssistantToolDefinition,
    AssistantToolError,
    StrictArgs,
    StudentIdsArgs,
    json_digest,
    load_students_exact,
    redact_phone_text,
)
from app.auth import hash_password, invalidate_user_tokens
from app.backup import do_backup_async
from app.models import (
    EnrollmentRecord,
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
)
from app.task_stats import ASSIGNABLE_STUDENT_STATUSES, TERMINAL_STUDENT_STATUSES
from app.utils import make_batch_id, make_operation_log, utcnow


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


async def _preview_mark_invalid(
    db: AsyncSession,
    args: MarkStudentsInvalidArgs,
    _operator: User,
) -> dict[str, Any]:
    students = await load_students_exact(db, args.student_ids)
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
    students = await load_students_exact(db, args.student_ids)
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
    students = await load_students_exact(db, args.student_ids)
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
    students = await load_students_exact(db, args.student_ids)
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
                "username": redact_phone_text(user.username),
                "role": user.role.value,
                "must_change_password": True,
            }
        ],
        "state": {
            "id": user.id,
            "token_version": user.token_version,
            "is_active": user.is_active,
            "hashed_password": json_digest(user.hashed_password),
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


TOOLS = (
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
)
