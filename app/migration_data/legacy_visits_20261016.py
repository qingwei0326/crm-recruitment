"""Fold the legacy ``visits`` table into home/campus visit tasks (Alembic 20261016_01).

Every legacy visit becomes a ``home_visit_tasks`` or ``campus_visit_tasks`` row. An open
task whose student is still in play gets the work item the live admissions services would
create for it. Each move writes one operation log whose ``note_content`` keeps the original
visit row, so the downgrade can put the legacy rows back.

Status names and mappings are frozen here on purpose: later changes to the app enums must
not change what this revision does to a database.
"""

import json
from collections import Counter
from datetime import datetime
from typing import Any

from sqlalchemy import MetaData, Table, and_, delete, insert, select, update
from sqlalchemy.engine import Connection

MIGRATION_ACTION = "合并旧到访"
MIGRATION_BATCH_ID = "alembic-20261016_01"
MIGRATION_OPERATOR = "系统迁移"

HOME_STATUS_BY_VISIT_STATUS = {
    "pending": "pending",
    "confirmed": "confirmed",
    "completed": "completed",
    "cancelled": "cancelled",
}
CAMPUS_STATUS_BY_VISIT_STATUS = {
    "pending": "pending",
    "confirmed": "scheduled",
    "completed": "arrived",
    "cancelled": "cancelled",
}
HOME_OPEN_STATUSES = {"pending", "confirmed", "scheduled", "postponed"}
CAMPUS_OPEN_STATUSES = {"pending", "scheduled", "rescheduled"}
HOME_SCHEDULED_STATUSES = {"confirmed", "completed"}
# Stored student status names that canonicalize to 已报名 or 无效.
TERMINAL_STUDENT_STATUSES = {
    "enrolled",
    "invalid",
    "completed",
    "expired",
    "high_score",
    "not_interested",
    "no_intent",
    "child_not_want_study",
    "child_not_interested",
}
WORK_STATUS_BY_EMPLOYMENT = {
    "active": "open",
    "suspended": "blocked_suspension",
    "handover_pending": "blocked_handover",
}
VISIT_COLUMNS = (
    "id",
    "student_id",
    "agent_id",
    "visit_type",
    "scheduled_date",
    "status",
    "notes",
    "created_at",
    "updated_at",
)
VISIT_DATETIME_COLUMNS = ("scheduled_date", "created_at", "updated_at")
TABLE_NAMES = (
    "students",
    "home_visit_tasks",
    "campus_visit_tasks",
    "enrollment_records",
    "work_items",
    "agent_employment",
    "operation_logs",
)


def _load_tables(connection: Connection, *extra: str) -> dict[str, Table]:
    names = (*TABLE_NAMES, *extra)
    metadata = MetaData()
    metadata.reflect(bind=connection, only=names)
    return {name: metadata.tables[name] for name in names}


def _visit_payload(row: Any) -> dict[str, Any]:
    payload = {column: row[column] for column in VISIT_COLUMNS}
    for column in VISIT_DATETIME_COLUMNS:
        if payload[column] is not None:
            payload[column] = payload[column].isoformat()
    return payload


def _home_task_values(row: Any) -> dict[str, Any]:
    status = HOME_STATUS_BY_VISIT_STATUS.get(row["status"])
    if status is None:
        raise RuntimeError(f"旧到访 #{row['id']} 状态无法识别: {row['status']!r}")
    scheduled_date = row["scheduled_date"]
    return {
        "student_id": row["student_id"],
        "creator_agent_id": row["agent_id"],
        "assigned_admin_id": None,
        "status": status,
        "result": None,
        "priority": "中",
        "student_name_snapshot": row["student_name"] or "",
        "guardian_phone_snapshot": row["guardian_phone"] or row["guardian2_phone"] or "",
        "region_snapshot": row["region"] or "",
        "school_name_snapshot": row["school_name"] or "",
        "intent_program": row["program"] or "",
        "exam_score": row["score"],
        "usual_score": None,
        "parent_intent": "",
        "student_situation": "",
        "is_wechat_added": False,
        "is_confirmed_with_guardian": False,
        "requested_visit_time": scheduled_date,
        "scheduled_at": scheduled_date if status in HOME_SCHEDULED_STATUSES else None,
        "address": "",
        "postpone_reason": "",
        "guardian_attitude": "",
        "student_attitude": "",
        "concerns": "",
        "next_action": "",
        "next_follow_up_at": None,
        "notes": row["notes"] or "",
        "result_notes": "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def _campus_task_values(row: Any) -> dict[str, Any]:
    status = CAMPUS_STATUS_BY_VISIT_STATUS.get(row["status"])
    if status is None:
        raise RuntimeError(f"旧到访 #{row['id']} 状态无法识别: {row['status']!r}")
    return {
        "student_id": row["student_id"],
        "creator_user_id": row["agent_id"],
        "reception_admin_id": None,
        "home_visit_task_id": None,
        "status": status,
        "result": None,
        "source": "电话外呼",
        "student_name_snapshot": row["student_name"] or "",
        "guardian_phone_snapshot": row["guardian_phone"] or row["guardian2_phone"] or "",
        "region_snapshot": row["region"] or "",
        "school_name_snapshot": row["school_name"] or "",
        "intent_program": row["program"] or "",
        "appointment_at": row["scheduled_date"],
        "needs_pickup": False,
        "visitor_count": 1,
        "current_concerns": "",
        "reception_content": "",
        "guardian_attitude": "",
        "student_attitude": "",
        "onsite_enrolled": False,
        "not_enrolled_reason": "",
        "next_action": "",
        "next_follow_up_at": None,
        "notes": row["notes"] or "",
        "result_notes": "",
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def fold_legacy_visits(connection: Connection, now: datetime) -> dict[str, int]:
    """Move every legacy visit into the task tables. The caller drops ``visits``."""
    tables = _load_tables(connection, "visits")
    visits = tables["visits"]
    students = tables["students"]
    employment = {
        int(user_id): str(status)
        for user_id, status in connection.execute(
            select(tables["agent_employment"].c.user_id, tables["agent_employment"].c.status)
        )
    }
    rows = (
        connection.execute(
            select(
                visits,
                students.c.name.label("student_name"),
                students.c.guardian_phone,
                students.c.guardian2_phone,
                students.c.region,
                students.c.school_name,
                students.c.program,
                students.c.score,
                students.c.case_no,
                students.c.assigned_to,
                students.c.status.label("student_status"),
            )
            .join(students, students.c.id == visits.c.student_id)
            .order_by(visits.c.id)
        )
        .mappings()
        .all()
    )
    total = connection.execute(select(visits.c.id)).all()
    if len(total) != len(rows):
        raise RuntimeError("存在找不到学生的旧到访记录，请先修复数据再迁移")

    report: Counter[str] = Counter()
    for row in rows:
        if row["visit_type"] == "home":
            values = _home_task_values(row)
            table = tables["home_visit_tasks"]
            kind, label = "home_visit", "家访任务"
            is_open = values["status"] in HOME_OPEN_STATUSES
            due_at = values["scheduled_at"] or values["requested_visit_time"]
            creator_id = values["creator_agent_id"]
        elif row["visit_type"] == "campus":
            values = _campus_task_values(row)
            table = tables["campus_visit_tasks"]
            kind, label = "campus_visit", "到校任务"
            is_open = values["status"] in CAMPUS_OPEN_STATUSES
            due_at = values["appointment_at"]
            creator_id = values["creator_user_id"]
        else:
            raise RuntimeError(f"旧到访 #{row['id']} 类型无法识别: {row['visit_type']!r}")

        task_id = connection.execute(insert(table).values(**values)).inserted_primary_key[0]
        report[f"{kind}_tasks_created"] += 1

        if is_open and str(row["student_status"]) not in TERMINAL_STUDENT_STATUSES:
            owner_id = row["assigned_to"] if row["assigned_to"] is not None else creator_id
            work_status = WORK_STATUS_BY_EMPLOYMENT.get(employment.get(int(owner_id), ""))
            if work_status is None:
                report["work_items_skipped_no_workable_owner"] += 1
            else:
                connection.execute(
                    insert(tables["work_items"]).values(
                        student_id=row["student_id"],
                        kind=kind,
                        status=work_status,
                        owner_agent_id=owner_id,
                        creator_user_id=creator_id,
                        priority="high" if due_at is not None and due_at < now else "medium",
                        due_at=due_at,
                        completed_at=None,
                        source_type=kind,
                        source_id=task_id,
                        handover_batch_id=None,
                        version=1,
                        created_at=now,
                        updated_at=now,
                    )
                )
                report["work_items_created"] += 1

        connection.execute(
            insert(tables["operation_logs"]).values(
                operator_id=None,
                operator_name=MIGRATION_OPERATOR,
                target_student_id=row["student_id"],
                case_no=row["case_no"] or "",
                action=MIGRATION_ACTION,
                content=f"旧到访记录 #{row['id']} 已并入{label} #{task_id}",
                old_status="",
                new_status="",
                note_content=json.dumps(
                    {"kind": kind, "task_id": task_id, "visit": _visit_payload(row)},
                    ensure_ascii=False,
                ),
                batch_id=MIGRATION_BATCH_ID,
                created_at=now,
            )
        )
    return dict(report)


def restore_legacy_visits(connection: Connection) -> int:
    """Undo :func:`fold_legacy_visits` into a freshly recreated ``visits`` table.

    Changes made to the moved tasks after the upgrade are lost with them.
    """
    tables = _load_tables(connection, "visits")
    logs = tables["operation_logs"]
    task_tables = {
        "home_visit": tables["home_visit_tasks"],
        "campus_visit": tables["campus_visit_tasks"],
    }
    enrollments = tables["enrollment_records"]
    work_items = tables["work_items"]
    migrated = connection.execute(
        select(logs.c.id, logs.c.note_content).where(
            logs.c.action == MIGRATION_ACTION,
            logs.c.batch_id == MIGRATION_BATCH_ID,
        )
    ).all()

    for _log_id, note_content in migrated:
        payload = json.loads(note_content)
        kind, task_id, visit = payload["kind"], int(payload["task_id"]), payload["visit"]
        for column in VISIT_DATETIME_COLUMNS:
            if visit[column] is not None:
                visit[column] = datetime.fromisoformat(visit[column])
        connection.execute(insert(tables["visits"]).values(**visit))

        if kind == "home_visit":
            campus = task_tables["campus_visit"]
            connection.execute(
                update(campus).where(campus.c.home_visit_task_id == task_id)
                .values(home_visit_task_id=None)
            )
            connection.execute(
                update(enrollments).where(enrollments.c.home_visit_task_id == task_id)
                .values(home_visit_task_id=None)
            )
        else:
            connection.execute(
                update(enrollments).where(enrollments.c.campus_visit_task_id == task_id)
                .values(campus_visit_task_id=None)
            )
        connection.execute(
            delete(work_items).where(
                and_(
                    work_items.c.kind == kind,
                    work_items.c.source_type == kind,
                    work_items.c.source_id == task_id,
                )
            )
        )
        table = task_tables[kind]
        connection.execute(delete(table).where(table.c.id == task_id))

    connection.execute(delete(logs).where(logs.c.id.in_([log_id for log_id, _ in migrated])))
    return len(migrated)
