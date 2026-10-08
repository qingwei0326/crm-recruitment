import pytest
from sqlalchemy import select

from app.models import CampusVisitTask, EnrollmentRecord, HomeVisitTask, Student, StudentStatus


@pytest.mark.parametrize("manual", [False, True])
@pytest.mark.parametrize("foreign_task", ["home", "campus"])
async def test_enrollment_rejects_other_students_tasks(
    client, db, admin_headers, agent_user, manual, foreign_task
):
    student = Student(name="本次报名学生", assigned_to=agent_user.id)
    other = Student(name="其他学生", assigned_to=agent_user.id)
    db.add_all([student, other])
    await db.flush()
    home = HomeVisitTask(
        student_id=other.id if foreign_task == "home" else student.id,
        creator_agent_id=agent_user.id,
    )
    campus = CampusVisitTask(
        student_id=other.id if foreign_task == "campus" else student.id,
        creator_user_id=agent_user.id,
    )
    db.add_all([home, campus])
    await db.commit()
    body = {
        "student_id": student.id,
        "home_visit_task_id": home.id,
        "campus_visit_task_id": campus.id,
    }
    if manual:
        body.update(attributed_agent_id=agent_user.id, attribution_reason="手动确认归属")
    response = await client.post("/api/admissions/enrollments", headers=admin_headers, json=body)
    assert response.status_code == 400
    assert "不属于该学生" in response.json()["detail"]
    assert (await db.execute(select(EnrollmentRecord))).scalars().all() == []
    await db.refresh(student)
    assert student.status == StudentStatus.not_contacted


@pytest.mark.parametrize(
    "amounts,detail",
    [
        ({"tuition_list_amount": 100, "student_subsidy_amount": 101}, "学费补贴不能高于标准学费"),
        ({"commission_base_amount": 100, "commission_adjustment_amount": -101},
         "佣金调整后应结金额不能小于 0"),
    ],
)
async def test_enrollment_invalid_finance_is_client_error(
    client, db, admin_headers, agent_user, amounts, detail
):
    student = Student(name="金额校验学生", assigned_to=agent_user.id)
    db.add(student)
    await db.commit()
    response = await client.post(
        "/api/admissions/enrollments",
        headers=admin_headers,
        json={"student_id": student.id, **amounts},
    )
    assert response.status_code == 400
    assert response.json()["detail"] == detail
    assert (await db.execute(select(EnrollmentRecord))).scalars().all() == []
    await db.refresh(student)
    assert student.status == StudentStatus.not_contacted


@pytest.mark.parametrize("target", ["missing", "admin"])
async def test_manual_attribution_must_be_an_existing_agent(
    client, db, admin_headers, admin_user, agent_user, target
):
    student = Student(name="归属校验学生", assigned_to=agent_user.id)
    db.add(student)
    await db.commit()
    bad_id = 987654 if target == "missing" else admin_user.id

    created = await client.post(
        "/api/admissions/enrollments",
        headers=admin_headers,
        json={
            "student_id": student.id,
            "attributed_agent_id": bad_id,
            "attribution_reason": "手动确认归属",
        },
    )
    assert created.status_code == 422
    assert "话务员" in created.json()["msg"]
    assert (await db.execute(select(EnrollmentRecord))).scalars().all() == []

    ok = await client.post(
        "/api/admissions/enrollments",
        headers=admin_headers,
        json={"student_id": student.id},
    )
    record_id = ok.json()["data"]["id"]
    patched = await client.patch(
        f"/api/admissions/enrollments/{record_id}",
        headers=admin_headers,
        json={"attributed_agent_id": bad_id, "attribution_reason": "手动确认归属"},
    )
    assert patched.status_code == 422
    assert "话务员" in patched.json()["msg"]
    record = await db.get(EnrollmentRecord, record_id)
    await db.refresh(record)
    assert record.attributed_agent_id == agent_user.id
