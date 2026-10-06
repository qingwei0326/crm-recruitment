"""Account lifecycle rules: create, edit, delete, offboard, unlock, reset password.

No FastAPI dependencies. Every mutating function commits (the offboard commit has
to happen while the handover lock is held). Rejections raise ``UserRequestError``
or ``UserForbidden``; routers turn them into the responses these endpoints always
returned.
"""

import secrets
from typing import Literal

from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import (
    ADMIN_OP_USER_RESET_PASSWORD,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    USERNAME_PATTERN,
    hash_password,
    invalidate_user_tokens,
    normalize_operation_permissions,
    normalize_page_permissions,
    operation_permissions_to_storage,
    page_permissions_to_storage,
    user_has_operation_permission,
    validate_password_strength,
)
from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    HandoverBatch,
    HandoverBatchStatus,
    StudentAssignment,
)
from app.models import IntentLevel, Student, StudentStage, StudentStatus, User, UserRole
from app.services.assignment_service import AssignmentTarget, apply_assignment_changes
from app.services.employment_service import set_employment_status
from app.services.handover_service import handover_transaction_lock, start_handover
from app.services.user_errors import UserForbidden, UserRequestError
from app.task_stats import TERMINAL_STUDENT_STATUSES
from app.utils import make_batch_id, make_operation_log


class UserCreateReq(BaseModel):
    # 用户名只接受 ASCII 账号字符，顺带挡掉空格/路径分隔符带来的注入与误配。
    username: str = Field(..., min_length=3, max_length=32, pattern=USERNAME_PATTERN)
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=MAX_PASSWORD_LENGTH)
    name: str
    role: Literal["admin", "agent"] = "agent"
    is_super_admin: bool = False
    service_regions: str = ""
    page_permissions: list[str] = []
    operation_permissions: list[str] = []

    @field_validator("password")
    @classmethod
    def validate_password(cls, value: str) -> str:
        return validate_password_strength(value)


class UserUpdateReq(BaseModel):
    name: str | None = None
    role: Literal["admin", "agent"] | None = None
    is_active: bool | None = None
    is_super_admin: bool | None = None
    password: str | None = None
    service_regions: str | None = None
    page_permissions: list[str] | None = None
    operation_permissions: list[str] | None = None
    expected_version: int | None = Field(default=None, ge=0)


RESERVED_USER_DISPLAY_NAMES = {"离职", "已离职", "禁用", "停用", "启用"}


def _clean_user_display_name(value: str) -> str:
    return (value or "").strip()


def _validate_user_display_name(value: str) -> str | None:
    name = _clean_user_display_name(value)
    if not name:
        return "姓名不能为空"
    if name in RESERVED_USER_DISPLAY_NAMES:
        return "姓名不能填写离职、禁用等状态词；请填写真实姓名"
    return None


async def count_active_super_admins(db: AsyncSession) -> int:
    result = await db.execute(
        select(func.count(User.id)).where(
            User.role == UserRole.admin,
            User.is_active,
            User.is_super_admin,
        )
    )
    return result.scalar() or 0


def account_payload(user: User, employment: AgentEmployment) -> dict:
    return {
        "id": user.id,
        "username": user.username,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
        "employment_status": employment.status.value,
        "employment_version": employment.version,
        "employment_status_changed_at": str(employment.status_changed_at),
        "is_super_admin": user.is_super_admin,
        "page_permissions": normalize_page_permissions(user.page_permissions),
        "operation_permissions": normalize_operation_permissions(user.operation_permissions),
    }


async def create_user(
    db: AsyncSession,
    current_user: User,
    body: UserCreateReq,
) -> dict:
    if not current_user.is_super_admin and (
        body.role == "admin"
        or body.is_super_admin
        or body.page_permissions
        or body.operation_permissions
    ):
        raise UserForbidden("只有超级管理员可以创建管理员或授权")
    display_name_error = _validate_user_display_name(body.name)
    if display_name_error:
        raise UserRequestError(display_name_error)
    result = await db.execute(select(User).where(User.username == body.username))
    if result.scalar_one_or_none():
        raise UserRequestError(f"用户名 {body.username} 已存在")
    display_name = _clean_user_display_name(body.name)
    user = User(
        username=body.username,
        hashed_password=hash_password(body.password),
        name=display_name,
        role=UserRole(body.role),
        service_regions=body.service_regions,
        is_active=True,
        is_super_admin=body.role == "admin" and body.is_super_admin,
        page_permissions=(
            ""
            if body.role != "admin" or body.is_super_admin
            else page_permissions_to_storage(body.page_permissions)
        ),
        operation_permissions=(
            ""
            if body.role != "admin" or body.is_super_admin
            else operation_permissions_to_storage(body.operation_permissions)
        ),
        # 账号密码由创建者代设，无论话务员还是管理员，首次登录都强制本人改密，
        # 否则「创建者知道新账号密码」会一直成立。
        must_change_password=True,
    )
    db.add(user)
    await db.flush()
    employment = AgentEmployment(
        user_id=user.id,
        status=EmploymentStatus.active,
        updated_by=current_user.id,
    )
    db.add(employment)
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="创建用户",
            content=f"创建{body.role} {user.username}({user.name})",
        )
    )
    await db.commit()
    await db.refresh(user)
    return account_payload(user, employment)


async def update_user(
    db: AsyncSession,
    current_user: User,
    user_id: int,
    body: UserUpdateReq,
) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise UserRequestError("用户不存在")
    employment = await db.get(AgentEmployment, user.id)
    if employment is None:
        raise UserRequestError("员工状态记录不存在")
    if body.role is not None and UserRole(body.role) != user.role:
        raise UserRequestError("已有账号角色不可修改；请新建对应角色账号并通过交接流程处理")
    if not current_user.is_super_admin and (
        user.role == UserRole.admin
        or body.role == "admin"
        or body.is_super_admin is not None
        or body.page_permissions is not None
        or body.operation_permissions is not None
    ):
        raise UserForbidden("只有超级管理员可以调整管理员或权限")

    changes = []
    if body.name is not None:
        display_name_error = _validate_user_display_name(body.name)
        if display_name_error:
            raise UserRequestError(display_name_error)
        display_name = _clean_user_display_name(body.name)
        if display_name != user.name:
            changes.append(f"姓名 {user.name}→{display_name}")
            user.name = display_name
    if body.is_super_admin is not None and body.is_super_admin != user.is_super_admin:
        if body.is_super_admin and user.role != UserRole.admin:
            raise UserRequestError("只有管理员账号可以设为超级管理员")
        if not body.is_super_admin and user.is_super_admin and user.is_active:
            if await count_active_super_admins(db) <= 1:
                raise UserRequestError("系统至少需要保留一个超级管理员")
        user.is_super_admin = body.is_super_admin
        changes.append("设为超级管理员" if body.is_super_admin else "取消超级管理员")
    if body.page_permissions is not None:
        next_permissions = (
            ""
            if user.role != UserRole.admin or user.is_super_admin
            else page_permissions_to_storage(body.page_permissions)
        )
        if next_permissions != user.page_permissions:
            user.page_permissions = next_permissions
            changes.append("修改页面权限")
    if body.operation_permissions is not None:
        next_permissions = (
            ""
            if user.role != UserRole.admin or user.is_super_admin
            else operation_permissions_to_storage(body.operation_permissions)
        )
        if next_permissions != user.operation_permissions:
            user.operation_permissions = next_permissions
            changes.append("修改操作权限")
    if body.is_active is not None:
        target_employment_status = (
            EmploymentStatus.active if body.is_active else EmploymentStatus.suspended
        )
        # 防止把唯一一个 admin / super admin 停用
        if (
            user.role == UserRole.admin
            and employment.status == EmploymentStatus.active
            and target_employment_status == EmploymentStatus.suspended
        ):
            admin_count = (
                await db.execute(
                    select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
                )
            ).scalar() or 0
            if admin_count <= 1:
                raise UserRequestError("不能停用最后一个管理员")
            if user.is_super_admin and await count_active_super_admins(db) <= 1:
                raise UserRequestError("不能停用最后一个超级管理员")
        if target_employment_status != employment.status:
            changes.append("启用" if body.is_active else "停用")
        employment = await set_employment_status(
            db,
            user,
            target_employment_status,
            operator=current_user,
            reason="admin_resume" if body.is_active else "admin_suspend",
            expected_version=body.expected_version,
        )
    if body.service_regions is not None and body.service_regions != user.service_regions:
        changes.append("修改服务区域")
        user.service_regions = body.service_regions
    if body.password is not None:
        if not user_has_operation_permission(current_user, ADMIN_OP_USER_RESET_PASSWORD):
            raise UserForbidden("无权重置账号密码")
        changes.append("重置密码")
        user.hashed_password = hash_password(body.password)
        invalidate_user_tokens(user)

    if changes:
        db.add(
            make_operation_log(
                current_user,
                target_student_id=None,
                case_no="",
                action="修改用户",
                content=f"{user.username}: {'; '.join(changes)}",
            )
        )
    await db.commit()
    return account_payload(user, employment)


async def delete_user(
    db: AsyncSession,
    current_user: User,
    user_id: int,
) -> None:
    if user_id == current_user.id:
        raise UserRequestError("不能删除自己")
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise UserRequestError("用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise UserForbidden("只有超级管理员可以删除管理员")
    # 防止删除最后一个 admin
    if user.role == UserRole.admin:
        admin_count = (
            await db.execute(
                select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
            )
        ).scalar() or 0
        if admin_count <= 1:
            raise UserRequestError("不能删除最后一个管理员")
        if user.is_super_admin and user.is_active and await count_active_super_admins(db) <= 1:
            raise UserRequestError("不能删除最后一个超级管理员")
    assigned_students = (
        (
            await db.execute(
                select(Student).where(Student.assigned_to == user_id)
            )
        )
        .scalars()
        .all()
    )
    terminal_students = [
        student
        for student in assigned_students
        if student.status in TERMINAL_STUDENT_STATUSES
    ]
    non_terminal_students = [
        student
        for student in assigned_students
        if student.status not in TERMINAL_STUDENT_STATUSES
    ]
    terminal_count = len(terminal_students)
    non_terminal_count = len(non_terminal_students)

    # 2) 再回收非终态学员：清除分配、状态、意向、阶段，避免新话务员误以为旧记录是自己跟出来的
    for student in non_terminal_students:
        student.status = StudentStatus.not_contacted
        student.status_detail = ""
        student.intent_level = IntentLevel.none
        student.stage = StudentStage.initial_contact
        student.need_help = False
    batch_id = make_batch_id("user-delete")
    await apply_assignment_changes(
        db,
        [
            AssignmentTarget(student_id=student.id, agent_id=None)
            for student in assigned_students
        ],
        operator=current_user,
        reason="user_delete",
        batch_id=batch_id,
    )
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="删除用户",
            content=(
                f"删除{user.role} {user.username}({user.name})："
                f"回收非终态 {non_terminal_count} 条、保留终态 {terminal_count} 条"
            ),
            batch_id=batch_id,
        )
    )
    employment = await db.get(AgentEmployment, user.id)
    if employment is not None and employment.status in {
        EmploymentStatus.active,
        EmploymentStatus.suspended,
    }:
        employment = await set_employment_status(
            db,
            user,
            EmploymentStatus.handover_pending,
            operator=current_user,
            reason="user_delete_start",
        )
    if employment is not None and employment.status == EmploymentStatus.handover_pending:
        await set_employment_status(
            db,
            user,
            EmploymentStatus.offboarded,
            operator=current_user,
            reason="user_delete_complete",
        )
    user.failed_login_attempts = 0
    user.locked_until = None
    await db.commit()
    return None


async def offboard_user(
    db: AsyncSession,
    current_user: User,
    user_id: int,
) -> dict:
    """兼容旧客户端的安全离职入口，不再回收或重置非终态学生。"""
    if user_id == current_user.id:
        raise UserRequestError("不能离职自己")
    if not current_user.is_super_admin:
        raise UserForbidden("需要超级管理员权限")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise UserRequestError("用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise UserForbidden("只有超级管理员可以为管理员办理离职")

    # 防止把最后一个 admin 离职
    if user.role == UserRole.admin and user.is_active:
        admin_count = (
            await db.execute(
                select(func.count(User.id)).where(User.role == UserRole.admin, User.is_active)
            )
        ).scalar() or 0
        if admin_count <= 1:
            raise UserRequestError("不能离职最后一个管理员")
        if user.is_super_admin and await count_active_super_admins(db) <= 1:
            raise UserRequestError("不能离职最后一个超级管理员")

    was_already_disabled = not user.is_active
    async with handover_transaction_lock(user.id):
        active_batch = (
            (
                await db.execute(
                    select(HandoverBatch)
                    .where(
                        HandoverBatch.source_agent_id == user.id,
                        HandoverBatch.status.in_(
                            {
                                HandoverBatchStatus.pending,
                                HandoverBatchStatus.in_progress,
                            }
                        ),
                    )
                    .order_by(HandoverBatch.id.desc())
                )
            )
            .scalars()
            .first()
        )
        batch = active_batch or await start_handover(
            db,
            user,
            current_user,
            f"legacy-offboard:user:{user.id}",
        )
        terminal_history_count = int(
            (
                await db.execute(
                    select(func.count(StudentAssignment.id)).where(
                        StudentAssignment.handover_batch_id == batch.id,
                        StudentAssignment.end_reason == "terminal_unassign",
                        StudentAssignment.ended_at.is_not(None),
                    )
                )
            ).scalar_one()
        )
        await db.commit()
    return {
        "user_id": user.id,
        "username": user.username,
        "handover_batch_id": batch.id,
        "pending_handover_count": batch.remaining_items,
        "terminal_history_count": terminal_history_count,
        "recycled_count": 0,
        "preserved_count": batch.remaining_items + terminal_history_count,
        "was_already_disabled": was_already_disabled,
    }


async def unlock_user(
    db: AsyncSession,
    current_user: User,
    user_id: int,
) -> str:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise UserRequestError("用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise UserForbidden("只有超级管理员可以解锁管理员")
    user.failed_login_attempts = 0
    user.locked_until = None
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="解锁用户",
            content=f"解锁 {user.username}",
        )
    )
    await db.commit()
    return user.username


async def reset_user_password(
    db: AsyncSession,
    current_user: User,
    user_id: int,
) -> dict:
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise UserRequestError("用户不存在")
    if user.role == UserRole.admin and not current_user.is_super_admin:
        raise UserForbidden("只有超级管理员可以重置管理员密码")
    new_password = secrets.token_urlsafe(8)
    user.hashed_password = hash_password(new_password)
    user.failed_login_attempts = 0
    user.locked_until = None
    # 重置后强制本人下次登录改密
    user.must_change_password = True
    invalidate_user_tokens(user)
    db.add(
        make_operation_log(
            current_user,
            target_student_id=None,
            case_no="",
            action="重置密码",
            content=f"重置 {user.username} 的密码",
        )
    )
    await db.commit()
    return {"new_password": new_password, "name": user.name}
