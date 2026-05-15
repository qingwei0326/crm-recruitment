from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql import Select

from app.models import Student, User, UserRole


def is_admin(user: User) -> bool:
    return user.role == UserRole.admin


def can_access_student(user: User, student: Student) -> bool:
    if is_admin(user):
        return True
    if user.role != UserRole.agent:
        return False
    return student.assigned_to == user.id


def apply_student_scope(query: Select, user: User) -> Select:
    if is_admin(user):
        return query
    return query.where(Student.assigned_to == user.id)


async def get_student_or_404(db: AsyncSession, student_id: int) -> Student:
    result = await db.execute(select(Student).where(Student.id == student_id))
    student = result.scalar_one_or_none()
    if student is None:
        raise HTTPException(status_code=404, detail="学生不存在")
    return student


async def get_accessible_student(
    db: AsyncSession,
    student_id: int,
    current_user: User,
) -> Student:
    student = await get_student_or_404(db, student_id)
    if not can_access_student(current_user, student):
        raise HTTPException(status_code=403, detail="无权访问该学生")
    return student
