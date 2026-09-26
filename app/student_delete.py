"""共享的学生级联删除工具。

历史上有三处「删除学生」入口，但只有 assistant_tools 的版本删干净了全部 12 张关联表，
students.py 与 admin_invalid.py 的版本只删了 6 张，导致已分配/有报名/有家访等记录的学生
删除时触发外键错误（实测 94.7% 的无效线索带 assignment 行）。

本模块抽出唯一真源，三处入口统一调用，确保删除学生时一并清理所有关联业务记录。
"""
from __future__ import annotations

from sqlalchemy import delete

from app.domain_models import (
    HandoverItem,
    StudentAssignment,
    WorkItem,
)
from app.models import (
    Call,
    CampusVisitTask,
    DialLog,
    EnrollmentRecord,
    FollowUp,
    HomeVisitTask,
    LeadViewLog,
    Note,
    Student,
    Visit,
)
from app.utils import make_operation_log

# 所有直接以 student_id 外键关联到 students 表的业务模型。
# 顺序无关紧要：因为联接表（assignment 等）本身也会在本函数内一并删除。
RELATED_MODELS = (
    HandoverItem,
    WorkItem,
    EnrollmentRecord,
    CampusVisitTask,
    HomeVisitTask,
    StudentAssignment,
    DialLog,
    Call,
    Note,
    FollowUp,
    LeadViewLog,
    Visit,
)


async def delete_students_cascade(
    db,
    students: list[Student],
    operator,
    *,
    action: str = "删除学生",
    batch_id: str | None = None,
) -> int:
    """删除给定的学生，并一并清理全部关联业务记录。

    返回成功删除的学生数量。空列表直接返回 0，不抛错。
    """
    if not students:
        return 0

    student_ids = [s.id for s in students]

    for student in students:
        db.add(
            make_operation_log(
                operator,
                student.id,
                student.case_no or "",
                action,
                content=f"删除学生 {student.name} 及全部关联业务记录",
                batch_id=batch_id,
            )
        )

    for model in RELATED_MODELS:
        await db.execute(delete(model).where(model.student_id.in_(student_ids)))

    await db.execute(delete(Student).where(Student.id.in_(student_ids)))
    return len(student_ids)
