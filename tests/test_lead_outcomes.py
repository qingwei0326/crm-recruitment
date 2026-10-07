import pytest
from sqlalchemy import select

from app.migration_data.domain_backfill_20260711 import OUTCOME_ROWS
from app.models import Note, Student, StudentStatus
from app.services.lead_outcome_service import resolve_outcome_reason


@pytest.mark.asyncio
async def test_outcome_catalog_is_authenticated_and_ordered(
    client,
    db,
    admin_headers,
):
    unauthorized = await client.get("/api/lead-outcome-reasons")
    response = await client.get(
        "/api/lead-outcome-reasons",
        headers=admin_headers,
    )

    assert unauthorized.status_code == 401
    assert response.status_code == 200
    data = response.json()["data"]
    assert [row["code"] for row in data] == [row[0] for row in OUTCOME_ROWS]
    assert next(row for row in data if row["code"] == "enrolled_elsewhere") == {
        "code": "enrolled_elsewhere",
        "label": "已报名其他学校",
        "terminal": True,
        "reclaimable": False,
    }


@pytest.mark.asyncio
async def test_resolve_outcome_accepts_code_label_and_maps_unknown_to_other(db):
    by_code = await resolve_outcome_reason(db, "enrolled_elsewhere")
    by_label = await resolve_outcome_reason(db, "已报名其他学校")
    unknown = await resolve_outcome_reason(db, "明确转去海外学校")

    assert by_code.code == "enrolled_elsewhere"
    assert by_label.code == "enrolled_elsewhere"
    assert unknown.code == "other"


@pytest.mark.asyncio
async def test_invalid_outcome_projection_persists_code_and_clears_on_reopen(
    client,
    db,
    admin_headers,
    sample_student,
):
    marked = await client.put(
        f"/api/students/{sample_student.id}",
        json={"status": "无效", "invalid_reason": "已报名其他学校"},
        headers=admin_headers,
    )

    assert marked.status_code == 200
    assert marked.json()["data"]["status_detail"] == "已报名其他学校"
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.invalid
    assert sample_student.outcome_reason_code == "enrolled_elsewhere"
    invalid_list = await client.get(
        "/api/admin/invalid-students",
        headers=admin_headers,
    )
    listed = next(
        row for row in invalid_list.json()["data"]["list"] if row["id"] == sample_student.id
    )
    assert listed["outcome_reason_code"] == "enrolled_elsewhere"

    reopened = await client.put(
        f"/api/students/{sample_student.id}",
        json={"status": "已联系"},
        headers=admin_headers,
    )

    assert reopened.status_code == 200
    await db.refresh(sample_student)
    assert sample_student.outcome_reason_code is None


@pytest.mark.asyncio
async def test_unknown_invalid_reason_keeps_audit_text_and_uses_other_code(
    client,
    db,
    admin_headers,
    sample_student,
):
    response = await client.put(
        f"/api/students/{sample_student.id}",
        json={"status": "无效", "invalid_reason": "明确转去海外学校"},
        headers=admin_headers,
    )

    assert response.status_code == 200
    await db.refresh(sample_student)
    assert sample_student.status_detail == "明确转去海外学校"
    assert sample_student.outcome_reason_code == "other"


@pytest.mark.asyncio
async def test_reclaim_preview_reports_assignment_and_notes_without_mutating(
    client,
    db,
    admin_headers,
    agent_user,
    assignment_baseline,
    sample_student,
):
    sample_student.status = StudentStatus.invalid
    sample_student.status_detail = "无意向"
    sample_student.outcome_reason_code = "no_intent"
    await assignment_baseline(sample_student, agent_user)
    db.add(Note(student_id=sample_student.id, agent_id=agent_user.id, content="保留备注"))
    await db.commit()

    preview = await client.post(
        "/api/admin/invalid-students/reclaim-preview",
        json={"student_ids": [sample_student.id]},
        headers=admin_headers,
    )

    assert preview.status_code == 200
    assert preview.json()["data"] | {
        "preview_token": "ignored",
    } == {
        "student_count": 1,
        "assigned_count": 1,
        "unassigned_count": 0,
        "students_with_notes": 1,
        "note_count": 1,
        "preview_token": "ignored",
    }
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.invalid
    assert sample_student.assigned_to == agent_user.id

    # 该接口已强制二次确认：必须带上 preview 发放的 token，否则拒绝执行。
    reclaimed = await client.post(
        "/api/admin/invalid-students/reclaim",
        json={
            "student_ids": [sample_student.id],
            "preview_token": preview.json()["data"]["preview_token"],
        },
        headers=admin_headers,
    )

    assert reclaimed.status_code == 200
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.not_contacted
    assert sample_student.assigned_to is None
    assert (
        (await db.execute(select(Note).where(Note.student_id == sample_student.id))).scalars().all()
    )


@pytest.mark.asyncio
async def test_reclaim_rejects_stale_preview_and_exposes_batch_audit(
    client,
    db,
    admin_headers,
    agent_user,
    assignment_baseline,
    sample_student,
):
    sample_student.status = StudentStatus.invalid
    sample_student.status_detail = "无意向"
    sample_student.outcome_reason_code = "no_intent"
    await assignment_baseline(sample_student, agent_user)
    await db.commit()

    preview = await client.post(
        "/api/admin/invalid-students/reclaim-preview",
        json={"student_ids": [sample_student.id]},
        headers=admin_headers,
    )
    token = preview.json()["data"]["preview_token"]
    sample_student.status_detail = "高分段"
    sample_student.outcome_reason_code = "high_score"
    await db.commit()

    stale = await client.post(
        "/api/admin/invalid-students/reclaim",
        json={"student_ids": [sample_student.id], "preview_token": token},
        headers=admin_headers,
    )
    assert stale.status_code == 409
    assert stale.json()["code"] == "version_conflict"
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.invalid
    assert sample_student.assigned_to == agent_user.id

    fresh = await client.post(
        "/api/admin/invalid-students/reclaim-preview",
        json={"student_ids": [sample_student.id]},
        headers=admin_headers,
    )
    reclaimed = await client.post(
        "/api/admin/invalid-students/reclaim",
        json={
            "student_ids": [sample_student.id],
            "preview_token": fresh.json()["data"]["preview_token"],
        },
        headers=admin_headers,
    )
    batch_id = reclaimed.json()["data"]["batch_id"]
    audit = await client.get(
        f"/api/operation-logs/batch/{batch_id}",
        headers=admin_headers,
    )
    assert audit.status_code == 200
    audit_data = audit.json()["data"]
    assert audit_data["batch_id"] == batch_id
    assert audit_data["student_count"] == 1
    assert {item["action"] for item in audit_data["actions"]} >= {
        "批量回收无效线索",
        "修改归属",
        "线索回收汇总",
    }
    rollback_preview = await client.get(
        f"/api/admin/reclaim-rollbacks/{batch_id}",
        headers=admin_headers,
    )
    assert rollback_preview.status_code == 200
    assert rollback_preview.json()["data"]["rollbackable_count"] == 1
    rolled_back = await client.post(
        f"/api/admin/reclaim-rollbacks/{batch_id}",
        json={"confirm": True},
        headers=admin_headers,
    )
    assert rolled_back.status_code == 200
    assert rolled_back.json()["data"]["rolled_back_count"] == 1
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.invalid
    assert sample_student.status_detail == "高分段"
    assert sample_student.outcome_reason_code == "high_score"
    assert sample_student.assigned_to == agent_user.id


@pytest.mark.asyncio
async def test_reclaim_to_agent_exposes_reclaim_batch_for_rollback(
    client,
    db,
    admin_headers,
    agent_user,
    sample_student,
):
    sample_student.status = StudentStatus.invalid
    sample_student.status_detail = "无意向"
    sample_student.outcome_reason_code = "no_intent"
    await db.commit()

    response = await client.post(
        "/api/admin/reclaim-students",
        json={"student_ids": [sample_student.id], "agent_id": agent_user.id},
        headers=admin_headers,
    )

    assert response.status_code == 200
    batch_id = response.json()["data"]["batch_id"]
    audit = await client.get(
        f"/api/operation-logs/batch/{batch_id}",
        headers=admin_headers,
    )
    assert audit.status_code == 200
    assert any(item["action"] == "线索回收汇总" for item in audit.json()["data"]["items"])
    listed = await client.get(
        "/api/operation-logs",
        params={"batch_id": batch_id},
        headers=admin_headers,
    )
    assert listed.status_code == 200
    assert any(
        item["action"] == "线索回收汇总" and item["can_rollback_reclaim"]
        for item in listed.json()["data"]["list"]
    )

    rollback_preview = await client.get(
        f"/api/admin/reclaim-rollbacks/{batch_id}",
        headers=admin_headers,
    )
    assert rollback_preview.status_code == 200
    assert rollback_preview.json()["data"]["rollbackable_count"] == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "mode",
    ["assign_to_agent", "selected_to_pool", "school_to_pool"],
)
async def test_all_invalid_reclaim_paths_atomically_reject_enrolled_elsewhere(
    mode,
    client,
    db,
    admin_headers,
    agent_user,
):
    blocked = [
        Student(
            name=f"不可回收学生{index}",
            school_name="不可回收学校",
            assigned_to=agent_user.id,
            status=StudentStatus.invalid,
            status_detail="已报名其他学校",
            outcome_reason_code="enrolled_elsewhere",
        )
        for index in range(4)
    ]
    reclaimable = Student(
        name="可回收学生",
        school_name="不可回收学校",
        assigned_to=agent_user.id,
        status=StudentStatus.invalid,
        status_detail="无意向",
        outcome_reason_code="no_intent",
    )
    students = [*blocked, reclaimable]
    db.add_all(students)
    await db.commit()
    student_ids = [student.id for student in students]

    if mode == "assign_to_agent":
        response = await client.post(
            "/api/admin/reclaim-students",
            json={"student_ids": student_ids, "agent_id": agent_user.id},
            headers=admin_headers,
        )
    elif mode == "selected_to_pool":
        # 该接口已强制二次确认，需先走 reclaim-preview。
        # preview 自身同样执行原子性校验，因此含不可回收学生时会在此处就被拒绝——
        # 与旧版「直接调 reclaim」断言的是同一行为（409 + 暴露被拒学生）。
        preview = await client.post(
            "/api/admin/invalid-students/reclaim-preview",
            json={"student_ids": student_ids},
            headers=admin_headers,
        )
        if preview.status_code == 200:
            response = await client.post(
                "/api/admin/invalid-students/reclaim",
                json={
                    "student_ids": student_ids,
                    "preview_token": preview.json()["data"]["preview_token"],
                },
                headers=admin_headers,
            )
        else:
            response = preview
    else:
        # 该接口同样已强制二次确认，需先走 reclaim-by-school-preview。
        # preview 自身执行原子性校验，含不可回收学生时会在此处被拒绝。
        preview = await client.post(
            "/api/admin/reclaim-by-school-preview",
            json={"school_name": "不可回收学校"},
            headers=admin_headers,
        )
        if preview.status_code == 200:
            response = await client.post(
                "/api/admin/reclaim-by-school",
                json={
                    "school_name": "不可回收学校",
                    "preview_token": preview.json()["data"]["preview_token"],
                },
                headers=admin_headers,
            )
        else:
            response = preview

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == "version_conflict"
    for student in blocked[:3]:
        assert str(student.id) in body["msg"]
    assert str(blocked[3].id) not in body["msg"]
    assert all(student.name not in body["msg"] for student in students)

    for student in students:
        await db.refresh(student)
        assert student.status == StudentStatus.invalid
        assert student.assigned_to == agent_user.id
        assert student.outcome_reason_code in {
            "enrolled_elsewhere",
            "no_intent",
        }


async def _prepare_reclaimable_student(db, agent_user, assignment_baseline, sample_student):
    sample_student.status = StudentStatus.invalid
    sample_student.status_detail = "无意向"
    sample_student.outcome_reason_code = "no_intent"
    await assignment_baseline(sample_student, agent_user)
    await db.commit()


@pytest.mark.asyncio
async def test_reclaim_rejects_missing_preview_token(
    client,
    db,
    admin_headers,
    agent_user,
    assignment_baseline,
    sample_student,
):
    """二次确认不能被「不传 preview_token」跳过。"""
    await _prepare_reclaimable_student(db, agent_user, assignment_baseline, sample_student)

    response = await client.post(
        "/api/admin/invalid-students/reclaim",
        json={"student_ids": [sample_student.id]},
        headers=admin_headers,
    )

    assert response.status_code == 409
    await db.refresh(sample_student)
    # 关键：缺 token 时必须拒绝，绝不能静默执行回收
    assert sample_student.status == StudentStatus.invalid
    assert sample_student.assigned_to == agent_user.id


@pytest.mark.asyncio
async def test_reclaim_rejects_forged_preview_token(
    client,
    db,
    admin_headers,
    agent_user,
    assignment_baseline,
    sample_student,
):
    """伪造的 preview_token 必须被拒绝。"""
    await _prepare_reclaimable_student(db, agent_user, assignment_baseline, sample_student)

    response = await client.post(
        "/api/admin/invalid-students/reclaim",
        json={"student_ids": [sample_student.id], "preview_token": "forged-token"},
        headers=admin_headers,
    )

    assert response.status_code == 409
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.invalid
    assert sample_student.assigned_to == agent_user.id


@pytest.mark.asyncio
async def test_reclaim_accepts_valid_preview_token_and_mutates(
    client,
    db,
    admin_headers,
    agent_user,
    assignment_baseline,
    sample_student,
):
    """走完 preview 并带上合法 token 时，回收正常执行（防止收紧过头）。"""
    await _prepare_reclaimable_student(db, agent_user, assignment_baseline, sample_student)

    preview = await client.post(
        "/api/admin/invalid-students/reclaim-preview",
        json={"student_ids": [sample_student.id]},
        headers=admin_headers,
    )
    assert preview.status_code == 200

    response = await client.post(
        "/api/admin/invalid-students/reclaim",
        json={
            "student_ids": [sample_student.id],
            "preview_token": preview.json()["data"]["preview_token"],
        },
        headers=admin_headers,
    )

    assert response.status_code == 200
    await db.refresh(sample_student)
    assert sample_student.status == StudentStatus.not_contacted
    assert sample_student.assigned_to is None
