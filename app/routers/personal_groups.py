from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_PAGE_AUDIT_LOGS,
    get_current_user,
    require_page_permission,
)
from app.database import get_db
from app.domain_models import PersonalGroup, PersonalGroupMembership
from app.models import Student, User, UserRole

from app.schemas import Response
from app.utils import make_operation_log, utcnow

router = APIRouter(prefix="/api/personal-groups", tags=["私人工作分组"])
admin_router = APIRouter(prefix="/api/admin/personal-groups", tags=["管理"])


class GroupCreate(BaseModel):
    name: str = Field(min_length=1, max_length=20)
    color: str = Field(default="cyan", max_length=16)


class GroupUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=20)
    color: str | None = Field(default=None, max_length=16)


class MemberBatch(BaseModel):
    student_ids: list[int] = Field(min_length=1, max_length=200)


def _require_agent(user: User) -> None:
    if user.role != UserRole.agent:
        raise HTTPException(status_code=403, detail="仅话务员可使用私人工作分组")


async def _owned_group(db: AsyncSession, group_id: int, owner_id: int) -> PersonalGroup:
    row = await db.execute(
        select(PersonalGroup).where(
            PersonalGroup.id == group_id,
            PersonalGroup.owner_id == owner_id,
            PersonalGroup.archived_at.is_(None),
        )
    )
    group = row.scalar_one_or_none()
    if group is None:
        raise HTTPException(status_code=404, detail="分组不存在")
    return group


async def _serialize_group(db: AsyncSession, group: PersonalGroup) -> dict:
    count = await db.scalar(
        select(func.count(PersonalGroupMembership.student_id)).where(
            PersonalGroupMembership.group_id == group.id,
            PersonalGroupMembership.archived_at.is_(None),
        )
    )
    return {
        "id": group.id,
        "name": group.name,
        "color": group.color,
        "member_count": int(count or 0),
        "created_at": group.created_at.isoformat() if group.created_at else None,
        "updated_at": group.updated_at.isoformat() if group.updated_at else None,
    }


@router.get("")
async def list_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_agent(current_user)
    rows = await db.execute(
        select(PersonalGroup)
        .where(
            PersonalGroup.owner_id == current_user.id,
            PersonalGroup.archived_at.is_(None),
        )
        .order_by(PersonalGroup.created_at, PersonalGroup.id)
    )
    groups = rows.scalars().all()
    return Response.ok([await _serialize_group(db, group) for group in groups])


@router.post("")
async def create_group(
    body: GroupCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_agent(current_user)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="分组名称不能为空")
    active_count = await db.scalar(
        select(func.count(PersonalGroup.id)).where(
            PersonalGroup.owner_id == current_user.id,
            PersonalGroup.archived_at.is_(None),
        )
    )
    if int(active_count or 0) >= 20:
        raise HTTPException(status_code=409, detail="每位话务员最多创建20个私人分组")
    duplicate = await db.scalar(
        select(PersonalGroup.id).where(
            PersonalGroup.owner_id == current_user.id,
            PersonalGroup.name == name,
            PersonalGroup.archived_at.is_(None),
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=409, detail="同名分组已存在")
    group = PersonalGroup(owner_id=current_user.id, name=name, color=body.color.strip() or "cyan")
    db.add(group)
    try:
        await db.flush()
        db.add(
            make_operation_log(
                current_user,
                None,
                "",
                "创建私人分组",
                f"group_id={group.id}; name={name}",
            )
        )
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="同名分组已存在") from exc
    await db.refresh(group)
    return Response.ok(await _serialize_group(db, group))


@router.patch("/{group_id}")
async def update_group(
    group_id: int,
    body: GroupUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_agent(current_user)
    group = await _owned_group(db, group_id, current_user.id)
    old_name = group.name
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="分组名称不能为空")
        duplicate = await db.scalar(
            select(PersonalGroup.id).where(
                PersonalGroup.owner_id == current_user.id,
                PersonalGroup.name == name,
                PersonalGroup.archived_at.is_(None),
                PersonalGroup.id != group.id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=409, detail="同名分组已存在")
        group.name = name
    if body.color is not None:
        group.color = body.color.strip() or "cyan"
    db.add(
        make_operation_log(
            current_user,
            None,
            "",
            "修改私人分组",
            f"group_id={group.id}; {old_name} -> {group.name}",
        )
    )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="同名分组已存在") from exc
    await db.refresh(group)
    return Response.ok(await _serialize_group(db, group))


@router.delete("/{group_id}")
async def archive_group(
    group_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_agent(current_user)
    group = await _owned_group(db, group_id, current_user.id)
    now = utcnow()
    group.archived_at = now
    memberships = await db.execute(
        select(PersonalGroupMembership).where(
            PersonalGroupMembership.group_id == group.id,
            PersonalGroupMembership.archived_at.is_(None),
        )
    )
    for membership in memberships.scalars().all():
        membership.archived_at = now
        membership.archived_by = current_user.id
        membership.archive_reason = "group_archived"
    db.add(
        make_operation_log(
            current_user,
            None,
            "",
            "删除私人分组",
            f"group_id={group.id}; name={group.name}",
        )
    )
    await db.commit()
    return Response.ok({"id": group.id})


@router.get("/student/{student_id}")
async def list_student_memberships(
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_agent(current_user)
    student = await db.get(Student, student_id)
    if student is None or student.assigned_to != current_user.id:
        raise HTTPException(status_code=404, detail="学生不存在")
    rows = await db.execute(
        select(PersonalGroupMembership.group_id)
        .join(PersonalGroup, PersonalGroup.id == PersonalGroupMembership.group_id)
        .where(
            PersonalGroup.owner_id == current_user.id,
            PersonalGroup.archived_at.is_(None),
            PersonalGroupMembership.student_id == student_id,
            PersonalGroupMembership.archived_at.is_(None),
        )
        .order_by(PersonalGroupMembership.group_id)
    )
    return Response.ok({"student_id": student_id, "group_ids": list(rows.scalars())})


@router.post("/{group_id}/members")
async def add_members(
    group_id: int,
    body: MemberBatch,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_agent(current_user)
    group = await _owned_group(db, group_id, current_user.id)
    student_ids = sorted(set(body.student_ids))
    rows = await db.execute(select(Student).where(Student.id.in_(student_ids)))
    students = {student.id: student for student in rows.scalars().all()}
    invalid = [student_id for student_id in student_ids if student_id not in students or students[student_id].assigned_to != current_user.id]
    if invalid:
        raise HTTPException(status_code=409, detail=f"只能整理自己当前负责的学生: {invalid[:5]}")

    existing_rows = await db.execute(
        select(PersonalGroupMembership).where(
            PersonalGroupMembership.group_id == group.id,
            PersonalGroupMembership.student_id.in_(student_ids),
            PersonalGroupMembership.archived_at.is_(None),
        )
    )
    existing = {membership.student_id: membership for membership in existing_rows.scalars().all()}
    added = 0
    for student_id in student_ids:
        membership = existing.get(student_id)
        if membership is not None:
            continue
        membership = PersonalGroupMembership(
            group_id=group.id,
            student_id=student_id,
            created_by=current_user.id,
        )
        db.add(membership)
        added += 1
        student = students[student_id]
        db.add(
            make_operation_log(
                current_user,
                student.id,
                student.case_no or "",
                "加入私人分组",
                f"group_id={group.id}; name={group.name}",
            )
        )
    try:
        await db.commit()
    except IntegrityError as exc:
        await db.rollback()
        raise HTTPException(status_code=409, detail="学生分组已变化，请刷新后重试") from exc
    return Response.ok({"added_count": added, "group_id": group.id})


@router.delete("/{group_id}/members/{student_id}")
async def remove_member(
    group_id: int,
    student_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _require_agent(current_user)
    group = await _owned_group(db, group_id, current_user.id)
    membership = await db.scalar(
        select(PersonalGroupMembership).where(
            PersonalGroupMembership.group_id == group.id,
            PersonalGroupMembership.student_id == student_id,
            PersonalGroupMembership.archived_at.is_(None),
        )
    )
    if membership is None:
        raise HTTPException(status_code=404, detail="学生不在该分组")
    student = await db.get(Student, student_id)
    if student is None or student.assigned_to != current_user.id:
        raise HTTPException(status_code=409, detail="只能整理自己当前负责的学生")
    membership.archived_at = utcnow()
    membership.archived_by = current_user.id
    membership.archive_reason = "removed_by_owner"
    db.add(
        make_operation_log(
            current_user,
            student.id,
            student.case_no or "",
            "移出私人分组",
            f"group_id={group.id}; name={group.name}",
        )
    )
    await db.commit()
    return Response.ok({"student_id": student_id, "group_id": group.id})


@admin_router.get("")
async def audit_groups(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_AUDIT_LOGS)),
):
    rows = await db.execute(
        select(PersonalGroup, User.name, func.count(PersonalGroupMembership.student_id))
        .join(User, User.id == PersonalGroup.owner_id)
        .outerjoin(
            PersonalGroupMembership,
            (PersonalGroupMembership.group_id == PersonalGroup.id)
            & PersonalGroupMembership.archived_at.is_(None),
        )
        .where(PersonalGroup.archived_at.is_(None))
        .group_by(PersonalGroup.id, User.name)
        .order_by(User.name, PersonalGroup.created_at)
    )
    return Response.ok(
        [
            {
                "id": group.id,
                "owner_id": group.owner_id,
                "owner_name": owner_name,
                "name": group.name,
                "color": group.color,
                "member_count": int(member_count or 0),
            }
            for group, owner_name, member_count in rows.all()
        ]
    )


@admin_router.get("/{group_id}/members")
async def audit_group_members(
    group_id: int,
    include_archived: bool = Query(True),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_page_permission(ADMIN_PAGE_AUDIT_LOGS)),
):
    group = await db.get(PersonalGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="分组不存在")
    owner = await db.get(User, group.owner_id)
    query = (
        select(PersonalGroupMembership, Student)
        .join(Student, Student.id == PersonalGroupMembership.student_id)
        .where(PersonalGroupMembership.group_id == group.id)
        .order_by(PersonalGroupMembership.created_at, PersonalGroupMembership.id)
    )
    if not include_archived:
        query = query.where(PersonalGroupMembership.archived_at.is_(None))
    rows = await db.execute(query)
    return Response.ok(
        {
            "group": {
                "id": group.id,
                "name": group.name,
                "owner_id": group.owner_id,
                "owner_name": owner.name if owner else "",
                "archived_at": group.archived_at.isoformat() if group.archived_at else None,
            },
            "list": [
                {
                    "student_id": student.id,
                    "student_name": student.name,
                    "case_no": student.case_no or "",
                    "archived_at": membership.archived_at.isoformat() if membership.archived_at else None,
                    "archive_reason": membership.archive_reason or "",
                }
                for membership, student in rows.all()
            ],
        }
    )
