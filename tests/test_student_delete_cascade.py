"""Phase 0-2 回归测试：共享级联删除必须清理全部 12 张关联表。

P0-2 的实测问题：删除入口只清了 6 张表，已分配/有报名/有家访等记录的学生删除时
触发外键错误（实测 94.7% 的无效线索带 assignment 行）。本文件锁定该修复：
1) 共享函数必须覆盖此前遗漏的 6 张表；
2) 通过 API 删除一个「已分配」学生会成功，且不留孤儿 assignment 行；
3) 直接调用共享函数，验证此前遗漏的 enrollment/assignment 等表一并被清。
"""

import pytest
from sqlalchemy import func, select

from app.domain_models import StudentAssignment
from app.models import EnrollmentRecord, Student
from app.student_delete import RELATED_MODELS, delete_students_cascade
from app.utils import utcnow


@pytest.mark.asyncio
class TestCascadeDeleteCoversMissingTables:
    async def test_related_models_include_six_previously_missing(self):
        expected_missing = {
            "StudentAssignment",
            "WorkItem",
            "EnrollmentRecord",
            "CampusVisitTask",
            "HomeVisitTask",
            "HandoverItem",
        }
        names = {m.__name__ for m in RELATED_MODELS}
        # 此前只删 6 张，遗漏上述 6 张；修复后必须全部覆盖。
        assert expected_missing <= names
        # 12 张关联表总数（6 原有 + 6 遗漏）必须完整。
        assert len(RELATED_MODELS) == 12

    async def test_original_six_tables_still_covered(self):
        original = {
            "Call",
            "DialLog",
            "FollowUp",
            "LeadViewLog",
            "Note",
            "Visit",
        }
        names = {m.__name__ for m in RELATED_MODELS}
        assert original <= names


@pytest.mark.asyncio
class TestApiDeleteAssignedStudent:
    async def test_delete_assigned_student_succeeds_and_clears_assignment(
        self, db, client, admin_headers, sample_student, assignment_baseline, admin_user
    ):
        student = sample_student
        await assignment_baseline(student, admin_user)

        before = (
            await db.execute(
                select(func.count())
                .select_from(StudentAssignment)
                .where(StudentAssignment.student_id == student.id)
            )
        ).scalar_one()
        assert before == 1

        resp = await client.delete(f"/api/students/{student.id}", headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["code"] == 0

        remaining = (
            await db.execute(
                select(func.count()).select_from(Student).where(Student.id == student.id)
            )
        ).scalar_one()
        orphan = (
            await db.execute(
                select(func.count())
                .select_from(StudentAssignment)
                .where(StudentAssignment.student_id == student.id)
            )
        ).scalar_one()
        assert remaining == 0
        assert orphan == 0


@pytest.mark.asyncio
class TestCascadeDeleteFunction:
    async def test_delete_students_cascade_clears_formerly_missing_tables(
        self, db, admin_user, sample_student
    ):
        student = sample_student
        db.add(
            StudentAssignment(
                student_id=student.id,
                agent_id=admin_user.id,
                started_at=utcnow(),
                start_reason="test",
                started_by=admin_user.id,
            )
        )
        db.add(
            EnrollmentRecord(
                student_id=student.id,
                attributed_agent_id=admin_user.id,
                confirmed_by_admin_id=admin_user.id,
            )
        )
        await db.flush()

        deleted = await delete_students_cascade(db, [student], admin_user, action="测试删除")
        await db.commit()
        assert deleted == 1

        assignment_count = (
            await db.execute(
                select(func.count())
                .select_from(StudentAssignment)
                .where(StudentAssignment.student_id == student.id)
            )
        ).scalar_one()
        enrollment_count = (
            await db.execute(
                select(func.count())
                .select_from(EnrollmentRecord)
                .where(EnrollmentRecord.student_id == student.id)
            )
        ).scalar_one()
        student_count = (
            await db.execute(
                select(func.count()).select_from(Student).where(Student.id == student.id)
            )
        ).scalar_one()
        assert assignment_count == 0
        assert enrollment_count == 0
        assert student_count == 0

    async def test_delete_empty_list_is_safe(self, db, admin_user):
        assert await delete_students_cascade(db, [], admin_user, action="noop") == 0
