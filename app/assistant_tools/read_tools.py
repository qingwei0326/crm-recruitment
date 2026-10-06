from __future__ import annotations

import os
import shutil
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from pydantic import Field
from sqlalchemy import func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_lead_utils import student_search_predicate
from app.admin_ops_utils import backup_items
from app.assistant_tools.base import (
    RISK_READ,
    AssistantToolDefinition,
    AssistantToolError,
    StrictArgs,
    redact_phone_text,
    student_payload,
)
from app.models import (
    OperationLog,
    Student,
    StudentStatus,
    User,
    UserRole,
)
from app.status_policy import (
    canonical_status_value,
    normalize_status_for_write,
    statuses_for_canonical,
)
from app.task_stats import ASSIGNABLE_STUDENT_STATUSES
from app.utils import mask_phone, normalize_phone


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


async def _search_students(
    db: AsyncSession,
    args: SearchStudentsArgs,
    _operator: User,
) -> dict[str, Any]:
    predicate = student_search_predicate(args.query)
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
    items = [student_payload(student, agent_name) for student, agent_name in rows.all()]
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
    return {"student": student_payload(student, agent_name)}


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
                "username": redact_phone_text(user.username),
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


async def duplicate_phone_groups(
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
    groups, by_id = await duplicate_phone_groups(db, args.minimum_students)
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
                "content": redact_phone_text((row.content or "")[:500]),
                "note_content": redact_phone_text((row.note_content or "")[:300]),
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
)
