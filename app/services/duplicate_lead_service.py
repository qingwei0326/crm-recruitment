"""Read-only duplicate-lead detection and the duplicate-phone cleanup.
"""

import secrets
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin_lead_utils import (
    _build_duplicate_phone_cleanup_plan,
    _duplicate_phone_cleanup_summary,
    _student_governance_payload,
    _student_phone_values,
)
from app.models import Student, User
from app.utils import make_operation_log


async def lead_duplicates(db: AsyncSession, limit: int) -> dict:
    """只读识别疑似重复线索，不做自动合并或删除。"""
    result = await db.execute(select(Student).order_by(Student.created_at.desc()).limit(5000))
    students = result.scalars().all()

    grouped: dict[tuple[str, str], list[Student]] = {}
    for student in students:
        for phone in _student_phone_values(student):
            grouped.setdefault(("手机号重复", phone), []).append(student)

    name_school_groups: dict[tuple[str, str], list[Student]] = {}
    for student in students:
        name_school = ((student.name or "").strip(), (student.school_name or "").strip())
        if all(name_school):
            name_school_groups.setdefault(name_school, []).append(student)

    for (name, school), items in name_school_groups.items():
        if len({student.id for student in items}) < 2:
            continue
        phones_in_group: dict[str, list[Student]] = {}
        for student in items:
            for phone in _student_phone_values(student):
                phones_in_group.setdefault(phone, []).append(student)
        for phone, phone_items in phones_in_group.items():
            unique_phone_items = list({student.id: student for student in phone_items}.values())
            if len(unique_phone_items) >= 2:
                grouped.setdefault(
                    ("同名同校同手机号", f"{name}｜{school}｜{phone}"),
                    unique_phone_items,
                )

    groups = []
    for (group_type, key), items in grouped.items():
        unique_items = list({student.id: student for student in items}.values())
        if len(unique_items) < 2:
            continue
        groups.append(
            {
                "type": group_type,
                "key": key,
                "search_q": key.split("｜")[-1] if group_type == "同名同校同手机号" else key,
                "count": len(unique_items),
                "students": [
                    _student_governance_payload(student)
                    for student in sorted(unique_items, key=lambda item: item.id)[:5]
                ],
            }
        )

    groups.sort(key=lambda item: (-item["count"], item["type"], item["key"]))
    return {"total_groups": len(groups), "groups": groups[:limit]}


async def duplicate_phone_cleanup_preview(db: AsyncSession) -> dict:
    """预览重复手机号清理影响范围，不修改数据。"""
    duplicate_phones, rows = await _build_duplicate_phone_cleanup_plan(db)
    return _duplicate_phone_cleanup_summary(rows, duplicate_phones)


async def duplicate_phone_cleanup(db: AsyncSession, current_user: User) -> dict:
    """清理可安全移除的重复手机号；无剩余号码的学生保留并交由人工处理。"""
    duplicate_phones, rows = await _build_duplicate_phone_cleanup_plan(db)
    summary = _duplicate_phone_cleanup_summary(rows, duplicate_phones)
    safe_rows = [row for row in rows if not row.get("requires_manual_review")]
    if not safe_rows:
        return {
            **summary,
            "batch_id": "",
            "changed": False,
            "cleared_count": 0,
            "deleted_count": 0,
        }

    batch_id = f"phone-dedupe-{datetime.now().strftime('%Y%m%d%H%M%S')}-{secrets.token_hex(3)}"
    by_id = {row["student_id"]: row for row in safe_rows}
    result = await db.execute(select(Student).where(Student.id.in_(list(by_id.keys()))))
    students = sorted(result.scalars().all(), key=lambda student: student.id)

    cleared_count = 0
    for student in students:
        row = by_id[student.id]
        removed_text = "、".join(row["removed_phones"])
        student.guardian_phone = row["new_guardian_phone"]
        student.guardian2_phone = row["new_guardian2_phone"]
        kept_phones = [
            phone for phone in (row["new_guardian_phone"], row["new_guardian2_phone"]) if phone
        ]
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "数据清理",
                content=(
                    f"批次 {batch_id}：清理重复手机号 {removed_text}；"
                    f"保留号码 {'、'.join(kept_phones)}"
                ),
                batch_id=batch_id,
            )
        )
        cleared_count += 1

    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="数据清理汇总",
            content=(
                f"批次 {batch_id}：清理重复手机号 {len(duplicate_phones)} 个，"
                f"影响学生 {len(rows)} 条，安全清号 {cleared_count} 条，"
                f"保留待人工复核 {summary['manual_review_count']} 条"
            ),
            batch_id=batch_id,
        )
    )
    await db.commit()
    return {
        **summary,
        "batch_id": batch_id,
        "changed": True,
        "cleared_count": cleared_count,
        "deleted_count": 0,
    }
