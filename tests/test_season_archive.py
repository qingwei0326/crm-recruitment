import sqlite3
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.domain_models import (
    PersonalGroup,
    PersonalGroupMembership,
    StudentAssignment,
    WorkItem,
    WorkItemKind,
)
from app.models import (
    Call,
    DialLog,
    FollowUp,
    Note,
    OperationLog,
    Student,
    Visit,
    VisitType,
)
from app.services import season_archive_service as archive_service
from app.utils import utcnow


async def _fake_backup(path):
    return str(path)


async def _seed_season_data(db, admin_user, agent_user):
    student = Student(
        name="招生季学生",
        assigned_to=agent_user.id,
        guardian_phone="13900000000",
        case_no="season-student-1",
    )
    db.add(student)
    await db.flush()
    db.add_all(
        [
            Call(student_id=student.id, agent_id=agent_user.id, duration_seconds=30),
            Note(student_id=student.id, agent_id=agent_user.id, content="已沟通"),
            FollowUp(
                student_id=student.id,
                agent_id=agent_user.id,
                follow_up_date=utcnow() + timedelta(days=1),
            ),
            DialLog(student_id=student.id, agent_id=agent_user.id),
            Visit(
                student_id=student.id,
                agent_id=agent_user.id,
                visit_type=VisitType.campus,
                scheduled_date=utcnow() + timedelta(days=1),
            ),
            StudentAssignment(
                student_id=student.id,
                agent_id=agent_user.id,
                started_at=utcnow(),
                start_reason="test",
                started_by=admin_user.id,
            ),
            WorkItem(
                student_id=student.id,
                kind=WorkItemKind.lead_contact,
                source_type="student",
                source_id=student.id,
                creator_user_id=admin_user.id,
            ),
            OperationLog(
                operator_id=admin_user.id,
                operator_name=admin_user.name,
                target_student_id=student.id,
                action="写备注",
                content="学生历史操作",
            ),
        ]
    )
    group = PersonalGroup(owner_id=agent_user.id, name="本季重点")
    db.add(group)
    await db.flush()
    db.add(
        PersonalGroupMembership(
            group_id=group.id,
            student_id=student.id,
            created_by=agent_user.id,
        )
    )
    await db.commit()
    return student


@pytest.fixture
def archive_environment(monkeypatch, tmp_path):
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    archive_dir = backup_dir / "season-archives"
    backup_path = backup_dir / "crm_20260823_120000.db"
    with sqlite3.connect(backup_path) as connection:
        connection.execute("create table backup_marker (id integer primary key)")
        connection.execute("insert into backup_marker values (1)")

    monkeypatch.setattr(archive_service, "BACKUP_DIR", str(backup_dir))
    monkeypatch.setattr(archive_service, "SEASON_ARCHIVE_DIR", str(archive_dir))

    async def fake_backup():
        return str(backup_path)

    monkeypatch.setattr(archive_service, "do_backup_async", fake_backup)
    return backup_path


@pytest.mark.asyncio
async def test_season_archive_prepare_and_cleanup_keeps_summary_audit(
    client,
    db,
    admin_user,
    agent_user,
    admin_headers,
    archive_environment,
):
    await _seed_season_data(db, admin_user, agent_user)

    preview = await client.get("/api/admin/season-archive/preview", headers=admin_headers)
    assert preview.status_code == 200
    assert preview.json()["data"]["student_count"] == 1
    assert preview.json()["data"]["counts"]["calls"] == 1

    prepared = await client.post("/api/admin/season-archive/prepare", headers=admin_headers)
    assert prepared.status_code == 200
    payload = prepared.json()["data"]
    assert payload["ready"] is True
    assert payload["backup"]["integrity_check"] == "ok"

    rejected = await client.post(
        "/api/admin/season-archive/cleanup",
        headers=admin_headers,
        json={
            "archive_id": payload["archive_id"],
            "export_name": payload["name"],
            "backup_name": payload["backup_name"],
            "confirm_text": "确认清理",
            "reason": "招生季结束",
        },
    )
    assert rejected.json()["msg"] == "请输入准确确认词：清理本招生季"
    assert (await db.execute(select(func.count(Student.id)))).scalar_one() == 1

    cleaned = await client.post(
        "/api/admin/season-archive/cleanup",
        headers=admin_headers,
        json={
            "archive_id": payload["archive_id"],
            "export_name": payload["name"],
            "backup_name": payload["backup_name"],
            "confirm_text": "清理本招生季",
            "reason": "招生季结束，已完成导出和备份校验",
        },
    )
    assert cleaned.status_code == 200
    assert cleaned.json()["data"]["deleted"] is True
    assert cleaned.json()["data"]["counts"]["students"] == 1
    assert (await db.execute(select(func.count(Student.id)))).scalar_one() == 0
    assert (await db.execute(select(func.count(Call.id)))).scalar_one() == 0
    assert (await db.execute(select(func.count(Note.id)))).scalar_one() == 0
    assert (await db.execute(select(func.count(FollowUp.id)))).scalar_one() == 0
    assert (await db.execute(select(func.count(StudentAssignment.id)))).scalar_one() == 0
    assert (await db.execute(select(func.count(WorkItem.id)))).scalar_one() == 0
    assert (
        await db.execute(
            select(func.count(OperationLog.id)).where(
                OperationLog.action == "招生季清理汇总"
            )
        )
    ).scalar_one() == 1


@pytest.mark.asyncio
async def test_season_archive_refuses_cleanup_when_students_change(
    client,
    db,
    admin_user,
    agent_user,
    admin_headers,
    archive_environment,
):
    await _seed_season_data(db, admin_user, agent_user)
    prepared = await client.post("/api/admin/season-archive/prepare", headers=admin_headers)
    payload = prepared.json()["data"]

    db.add(Student(name="准备后新增学生", case_no="season-student-2"))
    await db.commit()
    response = await client.post(
        "/api/admin/season-archive/cleanup",
        headers=admin_headers,
        json={
            "archive_id": payload["archive_id"],
            "export_name": payload["name"],
            "backup_name": payload["backup_name"],
            "confirm_text": "清理本招生季",
            "reason": "测试数据变化保护",
        },
    )
    assert response.json()["msg"] == "准备归档后学生数据已变化，请重新生成导出和备份"
    assert (await db.execute(select(func.count(Student.id)))).scalar_one() == 2


@pytest.mark.asyncio
async def test_season_archive_refuses_cleanup_when_related_data_changes(
    client,
    db,
    admin_user,
    agent_user,
    admin_headers,
    archive_environment,
):
    await _seed_season_data(db, admin_user, agent_user)
    prepared = await client.post("/api/admin/season-archive/prepare", headers=admin_headers)
    payload = prepared.json()["data"]

    note = (await db.execute(select(Note))).scalars().one()
    note.content = "准备归档后新增沟通"
    await db.commit()
    response = await client.post(
        "/api/admin/season-archive/cleanup",
        headers=admin_headers,
        json={
            "archive_id": payload["archive_id"],
            "export_name": payload["name"],
            "backup_name": payload["backup_name"],
            "confirm_text": "清理本招生季",
            "reason": "测试关联数据变化保护",
        },
    )
    assert response.json()["msg"] == "准备归档后学生数据已变化，请重新生成导出和备份"
    assert (await db.execute(select(func.count(Student.id)))).scalar_one() == 1
