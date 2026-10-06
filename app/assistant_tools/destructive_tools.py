from __future__ import annotations

from typing import Any

from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.assistant_tools.base import (
    RISK_DESTRUCTIVE,
    AssistantToolDefinition,
    AssistantToolError,
    StrictArgs,
    StudentIdsArgs,
    json_digest,
    load_students_exact,
)
from app.assistant_tools.read_tools import duplicate_phone_groups
from app.models import (
    Student,
    StudentStatus,
    User,
)
from app.status_policy import (
    canonical_status_value,
    canonical_student_status,
    statuses_for_canonical,
)
from app.student_delete import delete_students_cascade
from app.utils import make_batch_id, make_operation_log, mask_phone, normalize_phone


class CleanupDuplicatePhonesArgs(StrictArgs):
    minimum_students: int = Field(default=3, ge=2, le=100)
    delete_without_numbers: bool = True


class DeleteUnusablePhonesArgs(StrictArgs):
    include_enrolled: bool = False


async def _duplicate_cleanup_plan(
    db: AsyncSession,
    minimum_students: int,
) -> dict[str, Any]:
    groups, by_id = await duplicate_phone_groups(db, minimum_students)
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
            "phones": json_digest(
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
        "state": {"count": len(state_rows), "digest": json_digest(state_rows)},
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
    return await delete_students_cascade(db, students, operator, action=action, batch_id=batch_id)


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
        "state": {"count": len(state_rows), "digest": json_digest(state_rows)},
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
    students = await load_students_exact(db, args.student_ids)
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
        "state": {"count": len(state_rows), "digest": json_digest(state_rows)},
    }


async def _execute_delete_invalid(
    db: AsyncSession,
    args: StudentIdsArgs,
    operator: User,
) -> dict[str, Any]:
    await _preview_delete_invalid(db, args, operator)
    students = await load_students_exact(db, args.student_ids)
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
