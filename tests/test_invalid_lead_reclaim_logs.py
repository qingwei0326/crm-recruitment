"""Pin the operation-log wording written by the two invalid-lead reclaim flows.

These logs are what admins read in 操作记录 and what reclaim rollback relies on,
so moving the logic into invalid_lead_service must not change them.
"""

import pytest
from sqlalchemy import select

from app.models import OperationLog, Student, StudentStatus


async def _seed_invalid_student(db, agent_user, assignment_baseline, name):
    student = Student(
        name=name,
        status=StudentStatus.invalid,
        assigned_to=agent_user.id,
        guardian_phone="13800138111",
    )
    db.add(student)
    await db.flush()
    await assignment_baseline(student, agent_user)
    await db.commit()
    await db.refresh(student)
    return student


async def _batch_logs(db, batch_id):
    rows = await db.execute(
        select(OperationLog)
        .where(OperationLog.batch_id == batch_id, OperationLog.action != "修改归属")
        .order_by(OperationLog.id.asc())
    )
    return [(log.action, log.target_student_id, log.content) for log in rows.scalars().all()]


@pytest.mark.asyncio
async def test_reclaim_to_agent_writes_expected_logs(
    client, db, agent_user, admin_headers, assignment_baseline
):
    student = await _seed_invalid_student(db, agent_user, assignment_baseline, "日志回收给坐席")

    response = await client.post(
        "/api/admin/reclaim-students",
        json={"student_ids": [student.id], "agent_id": agent_user.id},
        headers=admin_headers,
    )
    assert response.json()["code"] == 0
    batch_id = response.json()["data"]["batch_id"]

    agent = f"{agent_user.name}（ID:{agent_user.id}）"
    assert await _batch_logs(db, batch_id) == [
        ("回收无效线索", student.id, f"从话务员 {agent_user.id} 回收，重新分配给 {agent}"),
        (
            "线索回收汇总",
            None,
            f"回收无效线索并重新分配给 {agent}，共 1 条；原有负责人 1 条；有备注 0 条（0 条备注）",
        ),
    ]


@pytest.mark.asyncio
async def test_reclaim_to_pool_writes_expected_logs(
    client, db, agent_user, admin_headers, assignment_baseline
):
    student = await _seed_invalid_student(db, agent_user, assignment_baseline, "日志回收到池")

    preview = await client.post(
        "/api/admin/invalid-students/reclaim-preview",
        json={"student_ids": [student.id]},
        headers=admin_headers,
    )
    token = preview.json()["data"]["preview_token"]
    response = await client.post(
        "/api/admin/invalid-students/reclaim",
        json={"student_ids": [student.id], "preview_token": token},
        headers=admin_headers,
    )
    assert response.json()["code"] == 0
    batch_id = response.json()["data"]["batch_id"]

    assert await _batch_logs(db, batch_id) == [
        ("批量回收无效线索", student.id, f"从话务员 {agent_user.id} 回收，进入未分配池"),
        (
            "线索回收汇总",
            None,
            "批量回收无效线索，共 1 条；原有负责人 1 条；有备注 0 条（0 条备注）",
        ),
    ]
