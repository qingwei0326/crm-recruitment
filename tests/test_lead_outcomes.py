import pytest

from app.migration_data.domain_backfill_20260711 import OUTCOME_ROWS
from app.models import Student, StudentStatus
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
        row
        for row in invalid_list.json()["data"]["list"]
        if row["id"] == sample_student.id
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
        response = await client.post(
            "/api/admin/invalid-students/reclaim",
            json={"student_ids": student_ids},
            headers=admin_headers,
        )
    else:
        response = await client.post(
            "/api/admin/reclaim-by-school",
            json={"school_name": "不可回收学校"},
            headers=admin_headers,
        )

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
