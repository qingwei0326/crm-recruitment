import pytest
from sqlalchemy import select

from app.models import (
    EnrollmentRecord,
    EnrollmentReport,
    IntentLevel,
    OperationLog,
    Student,
    StudentStage,
    StudentStatus,
)


@pytest.fixture
def student_of_agent(db, agent_user, assignment_baseline):
    async def make(name: str = "报了名的学生") -> int:
        student = Student(
            name=name,
            region="华安仙都",
            guardian_phone="13800138000",
            school_name="华安一中",
            stage=StudentStage.campus_visit_arrived,
            status=StudentStatus.contacted,
            intent_level=IntentLevel.A,
        )
        await assignment_baseline(student, agent_user)
        await db.commit()
        return student.id

    return make


async def _report(client, headers, student_id, **extra):
    return await client.post(
        "/api/admissions/enrollment-reports",
        json={"student_id": student_id, "enrolled_program": "无人机", **extra},
        headers=headers,
    )


@pytest.mark.asyncio
async def test_an_agent_report_waits_for_an_admin_and_does_not_enroll_the_student(
    client, db, agent_user, agent_headers, student_of_agent
):
    student_id = await student_of_agent()

    resp = await _report(client, agent_headers, student_id)

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["status"] == "待确认"
    assert data["enrolled_program"] == "无人机"
    assert data["region"] == "华安仙都"
    assert data["reporter_name"] == agent_user.name
    db.expire_all()
    student = await db.get(Student, student_id)
    assert student.status == StudentStatus.contacted
    log = (
        await db.execute(
            select(OperationLog).where(
                OperationLog.target_student_id == student_id,
                OperationLog.action == "上报报名",
            )
        )
    ).scalar_one()
    assert "无人机" in log.content


@pytest.mark.asyncio
async def test_a_second_report_for_the_same_student_is_refused(
    client, agent_headers, student_of_agent
):
    student_id = await student_of_agent()
    assert (await _report(client, agent_headers, student_id)).status_code == 200

    again = await _report(client, agent_headers, student_id)

    assert again.status_code == 409
    assert again.json()["msg"] == "已经上报过，等管理员确认"


@pytest.mark.asyncio
async def test_only_admins_see_and_settle_reports(client, agent_headers, student_of_agent):
    student_id = await student_of_agent()
    report_id = (await _report(client, agent_headers, student_id)).json()["data"]["id"]

    listed = await client.get("/api/admissions/enrollment-reports", headers=agent_headers)
    confirmed = await client.post(
        f"/api/admissions/enrollment-reports/{report_id}/confirm",
        json={},
        headers=agent_headers,
    )

    assert listed.status_code == 403
    assert confirmed.status_code == 403


@pytest.mark.asyncio
async def test_confirming_a_report_registers_the_enrollment(
    client, db, agent_user, agent_headers, admin_headers, student_of_agent
):
    agent_id, agent_name = agent_user.id, agent_user.name
    student_id = await student_of_agent()
    report_id = (await _report(client, agent_headers, student_id)).json()["data"]["id"]

    pending = await client.get("/api/admissions/enrollment-reports", headers=admin_headers)
    assert [row["id"] for row in pending.json()["data"]["list"]] == [report_id]
    assert pending.json()["data"]["list"][0]["assigned_agent_name"] == agent_name

    resp = await client.post(
        f"/api/admissions/enrollment-reports/{report_id}/confirm",
        json={"student_paid_amount": 500},
        headers=admin_headers,
    )

    assert resp.status_code == 200, resp.text
    data = resp.json()["data"]
    assert data["report"]["status"] == "已确认"
    assert data["report"]["enrollment_record_id"] == data["enrollment_id"]
    db.expire_all()
    record = await db.get(EnrollmentRecord, data["enrollment_id"])
    assert record.enrolled_program == "无人机"
    assert record.attributed_agent_id == agent_id
    student = await db.get(Student, student_id)
    assert student.status == StudentStatus.enrolled
    still_pending = await client.get("/api/admissions/enrollment-reports", headers=admin_headers)
    assert still_pending.json()["data"]["list"] == []

    twice = await client.post(
        f"/api/admissions/enrollment-reports/{report_id}/confirm",
        json={},
        headers=admin_headers,
    )
    assert twice.status_code == 409
    after_enrolled = await _report(client, agent_headers, student_id)
    assert after_enrolled.status_code == 409
    assert after_enrolled.json()["msg"] == "该学生已经登记报名"


@pytest.mark.asyncio
async def test_a_rejected_report_can_be_filed_again(
    client, db, agent_headers, admin_headers, student_of_agent
):
    student_id = await student_of_agent()
    report_id = (await _report(client, agent_headers, student_id)).json()["data"]["id"]

    rejected = await client.post(
        f"/api/admissions/enrollment-reports/{report_id}/reject",
        json={"reason": "还没交钱"},
        headers=admin_headers,
    )

    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["data"]["status"] == "已驳回"
    assert rejected.json()["data"]["reject_reason"] == "还没交钱"
    assert (await _report(client, agent_headers, student_id)).status_code == 200


@pytest.mark.asyncio
async def test_enrolling_the_student_directly_closes_the_pending_report(
    client, db, agent_headers, admin_headers, student_of_agent
):
    student_id = await student_of_agent()
    report_id = (await _report(client, agent_headers, student_id)).json()["data"]["id"]

    enrolled = await client.post(
        "/api/admissions/enrollments",
        json={"student_id": student_id, "source": "管理员补录", "enrolled_program": "机电"},
        headers=admin_headers,
    )

    assert enrolled.status_code == 200, enrolled.text
    db.expire_all()
    report = await db.get(EnrollmentReport, report_id)
    assert report.status.value == "已确认"
    assert report.enrollment_record_id == enrolled.json()["data"]["id"]
