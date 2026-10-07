"""旧离职端点的安全交接兼容测试。"""

import asyncio

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.auth import create_access_token, hash_password
from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    HandoverBatch,
    HandoverBatchStatus,
    HandoverItem,
    StudentAssignment,
)
from app.models import IntentLevel, Student, StudentStage, StudentStatus, User


@pytest_asyncio.fixture
async def departing_agent(db):
    user = User(
        username="leaving_agent",
        hashed_password=hash_password("pwd"),
        role="agent",
        name="即将离职的话务员",
        is_active=True,
    )
    db.add(user)
    await db.flush()
    db.add(
        AgentEmployment(
            user_id=user.id,
            status=EmploymentStatus.active,
            updated_by=user.id,
        )
    )
    await db.commit()
    await db.refresh(user)
    return user


@pytest_asyncio.fixture
async def departing_token(departing_agent):
    return create_access_token(
        {
            "sub": str(departing_agent.id),
            "role": departing_agent.role,
            "tv": departing_agent.token_version,
        }
    )


@pytest_asyncio.fixture
async def departing_headers(departing_token):
    return {"Authorization": f"Bearer {departing_token}"}


@pytest_asyncio.fixture
async def students_under_departing(db, departing_agent, assignment_baseline):
    students = [
        Student(
            name="未联系A",
            assigned_to=departing_agent.id,
            status=StudentStatus.not_contacted,
            status_detail="刚导入",
            intent_level=IntentLevel.A,
            stage=StudentStage.interested,
            need_help=True,
        ),
        Student(
            name="已联系B",
            assigned_to=departing_agent.id,
            status=StudentStatus.contacted,
            status_detail="已加微信",
            intent_level=IntentLevel.B,
            stage=StudentStage.materials_sent,
        ),
        Student(
            name="待回访C",
            assigned_to=departing_agent.id,
            status=StudentStatus.pending_visit,
            status_detail="等家长回复",
            intent_level=IntentLevel.C,
            stage=StudentStage.visit_scheduled,
        ),
        Student(
            name="已报名D",
            assigned_to=departing_agent.id,
            status=StudentStatus.enrolled,
            status_detail="已缴费",
            intent_level=IntentLevel.A,
            stage=StudentStage.enrolled,
        ),
        Student(
            name="已过期E",
            assigned_to=departing_agent.id,
            status=StudentStatus.expired,
            status_detail="历史过期",
            intent_level=IntentLevel.none,
            stage=StudentStage.initial_contact,
        ),
    ]
    db.add_all(students)
    await db.flush()
    for student in students:
        await assignment_baseline(student, departing_agent)
    await db.commit()
    for student in students:
        await db.refresh(student)
    return students


async def _post_offboard(client, headers, user_id):
    return await client.post(
        f"/api/admin/users/{user_id}/offboard",
        headers=headers,
    )


@pytest.mark.asyncio
class TestOffboard:
    async def test_offboard_returns_safe_handover_counts(
        self,
        client,
        admin_headers,
        departing_agent,
        students_under_departing,
    ):
        response = await _post_offboard(client, admin_headers, departing_agent.id)

        assert response.status_code == 200
        assert response.json()["code"] == 0
        data = response.json()["data"]
        assert data["pending_handover_count"] == 3
        assert data["terminal_history_count"] == 2
        assert data["recycled_count"] == 0
        assert data["preserved_count"] == 5
        assert data["was_already_disabled"] is False
        assert data["handover_batch_id"] > 0

    async def test_offboard_disables_account_and_invalidates_existing_token(
        self,
        client,
        admin_headers,
        departing_headers,
        db,
        departing_agent,
        students_under_departing,
    ):
        assert (await client.get("/api/me", headers=departing_headers)).status_code == 200

        await _post_offboard(client, admin_headers, departing_agent.id)

        await db.refresh(departing_agent)
        assert departing_agent.is_active is False
        assert (await client.get("/api/me", headers=departing_headers)).status_code == 401
        employment = await db.get(AgentEmployment, departing_agent.id)
        assert employment.status == EmploymentStatus.handover_pending

    async def test_offboard_preserves_nonterminal_progress_and_assignment(
        self,
        client,
        admin_headers,
        db,
        departing_agent,
        students_under_departing,
    ):
        snapshots = {
            student.id: (
                student.status,
                student.status_detail,
                student.intent_level,
                student.stage,
                student.need_help,
                student.assigned_to,
            )
            for student in students_under_departing[:3]
        }

        response = await _post_offboard(client, admin_headers, departing_agent.id)
        batch_id = response.json()["data"]["handover_batch_id"]

        for student in students_under_departing[:3]:
            await db.refresh(student)
            assert (
                student.status,
                student.status_detail,
                student.intent_level,
                student.stage,
                student.need_help,
                student.assigned_to,
            ) == snapshots[student.id]
        active_assignments = (
            (
                await db.execute(
                    select(StudentAssignment).where(
                        StudentAssignment.student_id.in_(
                            [student.id for student in students_under_departing[:3]]
                        ),
                        StudentAssignment.ended_at.is_(None),
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(active_assignments) == 3
        assert {row.agent_id for row in active_assignments} == {departing_agent.id}
        item_count = int(
            (
                await db.execute(
                    select(func.count(HandoverItem.id)).where(
                        HandoverItem.handover_batch_id == batch_id
                    )
                )
            ).scalar_one()
        )
        assert item_count == 3

    async def test_offboard_unassigns_terminal_students_without_rewriting_state(
        self,
        client,
        admin_headers,
        db,
        departing_agent,
        students_under_departing,
    ):
        terminal_snapshots = {
            student.id: (
                student.status,
                student.status_detail,
                student.intent_level,
                student.stage,
                student.need_help,
            )
            for student in students_under_departing[3:]
        }

        response = await _post_offboard(client, admin_headers, departing_agent.id)
        batch_id = response.json()["data"]["handover_batch_id"]

        for student in students_under_departing[3:]:
            await db.refresh(student)
            assert student.assigned_to is None
            assert (
                student.status,
                student.status_detail,
                student.intent_level,
                student.stage,
                student.need_help,
            ) == terminal_snapshots[student.id]
        ended = (
            (
                await db.execute(
                    select(StudentAssignment).where(
                        StudentAssignment.student_id.in_(
                            [student.id for student in students_under_departing[3:]]
                        )
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(ended) == 2
        assert all(row.end_reason == "terminal_unassign" for row in ended)
        assert all(row.handover_batch_id == batch_id for row in ended)

    async def test_two_sequential_legacy_calls_reuse_one_batch(
        self,
        client,
        admin_headers,
        db,
        departing_agent,
        students_under_departing,
    ):
        first = await _post_offboard(client, admin_headers, departing_agent.id)
        second = await _post_offboard(client, admin_headers, departing_agent.id)

        first_data = first.json()["data"]
        second_data = second.json()["data"]
        assert second.json()["code"] == 0
        assert second_data["handover_batch_id"] == first_data["handover_batch_id"]
        assert second_data["pending_handover_count"] == 3
        assert second_data["terminal_history_count"] == 2
        assert second_data["recycled_count"] == 0
        assert second_data["preserved_count"] == 5
        assert second_data["was_already_disabled"] is True
        count = int(
            (
                await db.execute(
                    select(func.count(HandoverBatch.id)).where(
                        HandoverBatch.source_agent_id == departing_agent.id
                    )
                )
            ).scalar_one()
        )
        assert count == 1

    async def test_two_concurrent_legacy_calls_reuse_one_batch(
        self,
        client,
        admin_headers,
        db,
        departing_agent,
        students_under_departing,
    ):
        responses = await asyncio.gather(
            _post_offboard(client, admin_headers, departing_agent.id),
            _post_offboard(client, admin_headers, departing_agent.id),
        )

        assert all(response.status_code == 200 for response in responses)
        assert all(response.json()["code"] == 0 for response in responses)
        batch_ids = {response.json()["data"]["handover_batch_id"] for response in responses}
        assert len(batch_ids) == 1
        count = int(
            (
                await db.execute(
                    select(func.count(HandoverBatch.id)).where(
                        HandoverBatch.source_agent_id == departing_agent.id
                    )
                )
            ).scalar_one()
        )
        assert count == 1

    async def test_legacy_call_after_new_start_reuses_active_batch(
        self,
        client,
        admin_headers,
        db,
        departing_agent,
        students_under_departing,
    ):
        started = await client.post(
            f"/api/admin/users/{departing_agent.id}/offboarding/start",
            json={"idempotency_key": "new-api-start", "expected_version": 1},
            headers=admin_headers,
        )
        batch_id = started.json()["data"]["id"]

        legacy = await _post_offboard(client, admin_headers, departing_agent.id)

        assert legacy.status_code == 200
        assert legacy.json()["data"]["handover_batch_id"] == batch_id
        count = int(
            (
                await db.execute(
                    select(func.count(HandoverBatch.id)).where(
                        HandoverBatch.source_agent_id == departing_agent.id
                    )
                )
            ).scalar_one()
        )
        assert count == 1

    async def test_cannot_offboard_self(self, client, admin_headers, admin_user):
        response = await _post_offboard(client, admin_headers, admin_user.id)
        assert response.json()["code"] == 1
        assert "自己" in response.json()["msg"]

    async def test_can_offboard_admin_when_another_super_admin_remains(
        self,
        client,
        admin_headers,
        admin_user,
        db,
    ):
        other_admin = User(
            username="other_admin",
            hashed_password=hash_password("pwd"),
            role="admin",
            name="另一个管理员",
            is_active=True,
            is_super_admin=True,
        )
        db.add(other_admin)
        await db.flush()
        db.add(
            AgentEmployment(
                user_id=other_admin.id,
                status=EmploymentStatus.active,
                updated_by=other_admin.id,
            )
        )
        await db.commit()

        response = await _post_offboard(client, admin_headers, other_admin.id)

        assert response.status_code == 200
        assert response.json()["code"] == 0
        assert response.json()["data"]["pending_handover_count"] == 0
        batch = await db.get(
            HandoverBatch,
            response.json()["data"]["handover_batch_id"],
        )
        assert batch.status == HandoverBatchStatus.completed

    async def test_offboard_requires_admin(self, client, agent_headers, departing_agent):
        response = await _post_offboard(client, agent_headers, departing_agent.id)
        assert response.status_code == 403

    async def test_offboard_requires_super_admin_even_with_operation_permission(
        self,
        client,
        normal_admin_headers,
        normal_admin_user,
        departing_agent,
        db,
    ):
        normal_admin_user.operation_permissions = "user_offboard"
        await db.commit()

        response = await _post_offboard(
            client,
            normal_admin_headers,
            departing_agent.id,
        )

        assert response.status_code == 403

    async def test_offboard_nonexistent_user(self, client, admin_headers):
        response = await _post_offboard(client, admin_headers, 99999)
        assert response.json()["code"] == 1
        assert "不存在" in response.json()["msg"]
