import asyncio
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    HandoverBatch,
    HandoverTransfer,
    WorkItemKind,
)
from app.models import FollowUp, IntentLevel, Student, StudentStage, StudentStatus, User, UserRole
from app.services.work_item_service import sync_source_work_item, sync_student_work_items
from app.utils import utcnow


async def _source_agent(db, username: str = "api-handover-source") -> User:
    source = User(
        username=username,
        hashed_password="test",
        role=UserRole.agent,
        name="API Handover Source",
        is_active=True,
    )
    db.add(source)
    await db.flush()
    db.add(
        AgentEmployment(
            user_id=source.id,
            status=EmploymentStatus.active,
            updated_by=source.id,
        )
    )
    await db.flush()
    return source


async def _handover_students(
    db,
    source,
    admin_user,
    assignment_baseline,
) -> list[Student]:
    students = [
        Student(
            name="Overdue High Intent",
            assigned_to=source.id,
            status=StudentStatus.pending_visit,
            status_detail="重点跟进",
            intent_level=IntentLevel.A,
            stage=StudentStage.interested,
            need_help=True,
            region="思明区",
            school_name="第一中学",
        ),
        Student(
            name="Future Normal Intent",
            assigned_to=source.id,
            status=StudentStatus.contacted,
            intent_level=IntentLevel.B,
            stage=StudentStage.materials_sent,
            region="湖里区",
            school_name="第二中学",
        ),
    ]
    db.add_all(students)
    await db.flush()
    for student in students:
        await assignment_baseline(student, source)
        await sync_student_work_items(db, student, admin_user)

    follow_up = FollowUp(
        student_id=students[0].id,
        agent_id=source.id,
        follow_up_date=utcnow() - timedelta(days=1),
    )
    db.add(follow_up)
    await db.flush()
    await sync_source_work_item(
        db,
        WorkItemKind.scheduled_follow_up,
        "follow_up",
        follow_up.id,
        students[0],
        source.id,
        follow_up.follow_up_date,
        False,
        admin_user,
    )
    await db.commit()
    return students


@pytest.mark.asyncio
async def test_admin_handover_api_full_workflow(
    client,
    db,
    admin_headers,
    admin_user,
    agent_user,
    assignment_baseline,
):
    source = await _source_agent(db)
    students = await _handover_students(
        db,
        source,
        admin_user,
        assignment_baseline,
    )

    start_response = await client.post(
        f"/api/admin/users/{source.id}/offboarding/start",
        json={"idempotency_key": "api-start-1", "expected_version": 1},
        headers=admin_headers,
    )
    assert start_response.status_code == 200
    start_data = start_response.json()["data"]
    batch_id = start_data["id"]
    assert start_data["source_agent"]["id"] == source.id
    assert start_data["status"] == "pending"
    assert start_data["remaining_items"] == 2

    list_response = await client.get(
        "/api/admin/handovers?status=pending&q=Handover&page=1&page_size=10",
        headers=admin_headers,
    )
    assert list_response.status_code == 200
    list_data = list_response.json()["data"]
    assert list_data["total"] == 1
    assert list_data["list"][0]["id"] == batch_id

    detail_response = await client.get(
        (
            f"/api/admin/handovers/{batch_id}"
            "?status=pending&intent=A&kind=scheduled_follow_up&overdue=true"
        ),
        headers=admin_headers,
    )
    assert detail_response.status_code == 200
    detail = detail_response.json()["data"]
    assert detail["batch"]["id"] == batch_id
    assert detail["total"] == 1
    assert detail["items"][0]["student_id"] == students[0].id
    assert detail["items"][0]["overdue"] is True
    assert "scheduled_follow_up" in detail["items"][0]["work_item_kinds"]
    assert detail["filter_options"]["regions"] == ["思明区", "湖里区"]

    preview_response = await client.post(
        f"/api/admin/handovers/{batch_id}/preview-transfer",
        json={"mode": "selected", "student_ids": [students[0].id]},
        headers=admin_headers,
    )
    assert preview_response.status_code == 200
    preview = preview_response.json()["data"]
    assert preview["version"] == 1
    assert preview["selected_count"] == 1
    assert preview["overdue_count"] == 1
    assert preview["mode"] == "selected"

    selected_response = await client.post(
        f"/api/admin/handovers/{batch_id}/transfers",
        json={
            "target_agent_id": agent_user.id,
            "mode": "selected",
            "student_ids": [students[0].id],
            "expected_version": preview["version"],
            "idempotency_key": "api-transfer-selected",
        },
        headers=admin_headers,
    )
    assert selected_response.status_code == 200
    selected = selected_response.json()["data"]
    assert selected["transferred_ids"] == [students[0].id]
    assert selected["remaining_count"] == 1
    assert selected["batch_version"] == 2

    remaining_preview_response = await client.post(
        f"/api/admin/handovers/{batch_id}/preview-transfer",
        json={"mode": "all_remaining", "student_ids": []},
        headers=admin_headers,
    )
    remaining_preview = remaining_preview_response.json()["data"]
    assert remaining_preview["selected_count"] == 1
    assert remaining_preview["version"] == 2

    completed_response = await client.post(
        f"/api/admin/handovers/{batch_id}/transfers",
        json={
            "target_agent_id": agent_user.id,
            "mode": "all_remaining",
            "student_ids": [],
            "expected_version": remaining_preview["version"],
            "idempotency_key": "api-transfer-all",
        },
        headers=admin_headers,
    )
    assert completed_response.status_code == 200
    completed = completed_response.json()["data"]
    assert completed["completed"] is True
    assert completed["remaining_count"] == 0
    assert completed["batch_version"] == 3

    history_response = await client.get(
        f"/api/admin/handovers/{batch_id}/transfers",
        headers=admin_headers,
    )
    assert history_response.status_code == 200
    history = history_response.json()["data"]
    assert history["total"] == 2
    assert {row["mode"] for row in history["list"]} == {
        "selected",
        "all_remaining",
    }
    assert sum(row["transferred_count"] for row in history["list"]) == 2


@pytest.mark.asyncio
async def test_handover_permissions_allow_partial_but_protect_start_and_completion(
    client,
    db,
    admin_headers,
    normal_admin_headers,
    agent_headers,
    admin_user,
    normal_admin_user,
    agent_user,
    assignment_baseline,
):
    source = await _source_agent(db, "permission-source")
    students = await _handover_students(
        db,
        source,
        admin_user,
        assignment_baseline,
    )

    assert (await client.get("/api/admin/handovers", headers=agent_headers)).status_code == 403
    assert (
        await client.get("/api/admin/handovers", headers=normal_admin_headers)
    ).status_code == 403

    normal_admin_user.operation_permissions = "user_offboard"
    await db.commit()
    assert (
        await client.get("/api/admin/handovers", headers=normal_admin_headers)
    ).status_code == 200
    assert (
        await client.post(
            f"/api/admin/users/{source.id}/offboarding/start",
            json={"idempotency_key": "normal-start", "expected_version": 1},
            headers=normal_admin_headers,
        )
    ).status_code == 403

    start_response = await client.post(
        f"/api/admin/users/{source.id}/offboarding/start",
        json={"idempotency_key": "permission-start", "expected_version": 1},
        headers=admin_headers,
    )
    batch_id = start_response.json()["data"]["id"]

    partial_response = await client.post(
        f"/api/admin/handovers/{batch_id}/transfers",
        json={
            "target_agent_id": agent_user.id,
            "mode": "selected",
            "student_ids": [students[0].id],
            "expected_version": 1,
            "idempotency_key": "normal-partial",
        },
        headers=normal_admin_headers,
    )
    assert partial_response.status_code == 200
    assert partial_response.json()["data"]["remaining_count"] == 1

    complete_selected = await client.post(
        f"/api/admin/handovers/{batch_id}/transfers",
        json={
            "target_agent_id": agent_user.id,
            "mode": "selected",
            "student_ids": [students[1].id],
            "expected_version": 2,
            "idempotency_key": "normal-complete-selected",
        },
        headers=normal_admin_headers,
    )
    assert complete_selected.status_code == 403
    complete_all = await client.post(
        f"/api/admin/handovers/{batch_id}/transfers",
        json={
            "target_agent_id": agent_user.id,
            "mode": "all_remaining",
            "student_ids": [],
            "expected_version": 2,
            "idempotency_key": "normal-complete-all",
        },
        headers=normal_admin_headers,
    )
    assert complete_all.status_code == 403


@pytest.mark.asyncio
async def test_handover_request_validation(client, admin_headers):
    invalid_start = await client.post(
        "/api/admin/users/1/offboarding/start",
        json={"idempotency_key": "   ", "expected_version": -1},
        headers=admin_headers,
    )
    assert invalid_start.status_code == 422

    invalid_selections = [
        {"mode": "selected", "student_ids": []},
        {"mode": "selected", "student_ids": [1, 1]},
        {"mode": "selected", "student_ids": [0]},
        {"mode": "all_remaining", "student_ids": [1]},
    ]
    for body in invalid_selections:
        response = await client.post(
            "/api/admin/handovers/1/preview-transfer",
            json=body,
            headers=admin_headers,
        )
        assert response.status_code == 422

    invalid_execute = await client.post(
        "/api/admin/handovers/1/transfers",
        json={
            "target_agent_id": 0,
            "mode": "selected",
            "student_ids": [1],
            "expected_version": -1,
            "idempotency_key": "",
        },
        headers=admin_headers,
    )
    assert invalid_execute.status_code == 422


@pytest.mark.asyncio
async def test_concurrent_transfers_with_same_version_allow_one_writer(
    client,
    db,
    admin_headers,
    admin_user,
    agent_user,
    assignment_baseline,
):
    source = await _source_agent(db, "concurrent-transfer-source")
    students = await _handover_students(
        db,
        source,
        admin_user,
        assignment_baseline,
    )
    started = await client.post(
        f"/api/admin/users/{source.id}/offboarding/start",
        json={"idempotency_key": "concurrent-transfer-start", "expected_version": 1},
        headers=admin_headers,
    )
    batch_id = started.json()["data"]["id"]

    responses = await asyncio.gather(
        *[
            client.post(
                f"/api/admin/handovers/{batch_id}/transfers",
                json={
                    "target_agent_id": agent_user.id,
                    "mode": "selected",
                    "student_ids": [student.id],
                    "expected_version": 1,
                    "idempotency_key": f"concurrent-transfer-{student.id}",
                },
                headers=admin_headers,
            )
            for student in students
        ]
    )

    assert sorted(response.status_code for response in responses) == [200, 409]
    conflict = next(response for response in responses if response.status_code == 409)
    assert conflict.json()["code"] == "version_conflict"
    transfer_count = int(
        (
            await db.execute(
                select(func.count(HandoverTransfer.id)).where(
                    HandoverTransfer.handover_batch_id == batch_id
                )
            )
        ).scalar_one()
    )
    assert transfer_count == 1
    batch = await db.get(HandoverBatch, batch_id)
    assert batch.version == 2
    assert batch.remaining_items == 1
