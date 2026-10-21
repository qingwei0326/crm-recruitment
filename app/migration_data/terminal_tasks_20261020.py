"""Close tasks left open on students who are already 无效 or 已报名 (Alembic 20261020_01).

Until this release, marking a student 无效 or 已报名 closed only the contact and help
work items. Their open follow-ups, unvisited home/campus visits and those work items
stayed open, and still counted as 逾期回访 and in agent scores. This revision applies
the rule the app now applies on every status change: open follow-ups are completed,
visits that have not happened are cancelled (unless they enrolled the student: result
已报名, or named by an enrollment record), and any follow-up or visit work item still
active is cancelled.

Each affected student gets one operation log whose ``note_content`` keeps the previous
state of every row it touched, so the downgrade can reopen them.

Status names are frozen here on purpose: later changes to the app enums must not change
what this revision does to a database.
"""

import json
from collections import Counter
from datetime import datetime
from typing import Any

from sqlalchemy import MetaData, Table, and_, delete, or_, select, update
from sqlalchemy.engine import Connection

MIGRATION_ACTION = "自动关闭待办"
MIGRATION_BATCH_ID = "alembic-20261020_01"
MIGRATION_OPERATOR = "系统迁移"

# Stored student status names that canonicalize to 已报名 or 无效.
TERMINAL_STUDENT_STATUSES = (
    "enrolled",
    "invalid",
    "completed",
    "expired",
    "high_score",
    "not_interested",
    "no_intent",
    "child_not_want_study",
    "child_not_interested",
)
HOME_OPEN_STATUSES = ("pending", "confirmed", "scheduled", "postponed")
CAMPUS_OPEN_STATUSES = ("pending", "scheduled", "rescheduled")
ENROLLED_RESULT = "enrolled"
CLOSED_WORK_KINDS = ("scheduled_follow_up", "home_visit", "campus_visit")
ACTIVE_WORK_STATUSES = ("open", "blocked_suspension", "blocked_handover")
WORK_ITEM_COLUMNS = (
    "status",
    "owner_agent_id",
    "completed_at",
    "handover_batch_id",
    "version",
    "updated_at",
)
WORK_ITEM_DATETIME_COLUMNS = ("completed_at", "updated_at")
TABLE_NAMES = (
    "students",
    "follow_ups",
    "home_visit_tasks",
    "campus_visit_tasks",
    "work_items",
    "enrollment_records",
    "operation_logs",
)
STATUS_LABELS = {"enrolled": "已报名"}


def _load_tables(connection: Connection) -> dict[str, Table]:
    metadata = MetaData()
    metadata.reflect(bind=connection, only=TABLE_NAMES)
    return {name: metadata.tables[name] for name in TABLE_NAMES}


def _iso(value: Any) -> Any:
    return value.isoformat() if isinstance(value, datetime) else value


def _open_visits(
    table: Table,
    student_ids: list[int],
    open_statuses: tuple[str, ...],
    enrolling_ids: Any,
):
    return select(table.c.id, table.c.student_id, table.c.status, table.c.updated_at).where(
        table.c.student_id.in_(student_ids),
        table.c.status.in_(open_statuses),
        or_(table.c.result.is_(None), table.c.result != ENROLLED_RESULT),
        table.c.id.not_in(enrolling_ids),
    )


def close_terminal_students_tasks(connection: Connection, now: datetime) -> dict[str, int]:
    tables = _load_tables(connection)
    students, follow_ups = tables["students"], tables["follow_ups"]
    home, campus = tables["home_visit_tasks"], tables["campus_visit_tasks"]
    work_items, logs = tables["work_items"], tables["operation_logs"]
    enrollments = tables["enrollment_records"]
    enrolling_ids = {
        "home_visits": select(enrollments.c.home_visit_task_id).where(
            enrollments.c.home_visit_task_id.is_not(None)
        ),
        "campus_visits": select(enrollments.c.campus_visit_task_id).where(
            enrollments.c.campus_visit_task_id.is_not(None)
        ),
    }

    terminal = {
        row.id: row
        for row in connection.execute(
            select(students.c.id, students.c.case_no, students.c.status).where(
                students.c.status.in_(TERMINAL_STUDENT_STATUSES)
            )
        )
    }
    report: Counter[str] = Counter()
    if not terminal:
        return dict(report)
    student_ids = sorted(terminal)

    touched: dict[int, dict[str, list]] = {}

    def bucket(student_id: int) -> dict[str, list]:
        return touched.setdefault(
            student_id,
            {"follow_ups": [], "home_visits": [], "campus_visits": [], "work_items": []},
        )

    for chunk_start in range(0, len(student_ids), 500):
        chunk = student_ids[chunk_start : chunk_start + 500]
        for row in connection.execute(
            select(follow_ups.c.id, follow_ups.c.student_id).where(
                follow_ups.c.student_id.in_(chunk),
                follow_ups.c.is_completed.is_(False),
            )
        ):
            bucket(row.student_id)["follow_ups"].append(row.id)
        for key, table, statuses in (
            ("home_visits", home, HOME_OPEN_STATUSES),
            ("campus_visits", campus, CAMPUS_OPEN_STATUSES),
        ):
            for row in connection.execute(
                _open_visits(table, chunk, statuses, enrolling_ids[key])
            ):
                bucket(row.student_id)[key].append(
                    {"id": row.id, "status": row.status, "updated_at": _iso(row.updated_at)}
                )
        for row in connection.execute(
            select(work_items.c.id, work_items.c.student_id, *[
                work_items.c[column] for column in WORK_ITEM_COLUMNS
            ]).where(
                work_items.c.student_id.in_(chunk),
                work_items.c.kind.in_(CLOSED_WORK_KINDS),
                work_items.c.status.in_(ACTIVE_WORK_STATUSES),
            )
        ):
            previous = {column: _iso(row._mapping[column]) for column in WORK_ITEM_COLUMNS}
            bucket(row.student_id)["work_items"].append({"id": row.id, **previous})

    for student_id, rows in sorted(touched.items()):
        follow_up_ids = rows["follow_ups"]
        if follow_up_ids:
            connection.execute(
                update(follow_ups).where(follow_ups.c.id.in_(follow_up_ids)).values(
                    is_completed=True
                )
            )
        for key, table in (("home_visits", home), ("campus_visits", campus)):
            ids = [visit["id"] for visit in rows[key]]
            if ids:
                connection.execute(
                    update(table).where(table.c.id.in_(ids)).values(
                        status="cancelled", updated_at=now
                    )
                )
        for item in rows["work_items"]:
            connection.execute(
                update(work_items).where(work_items.c.id == item["id"]).values(
                    status="cancelled",
                    owner_agent_id=None,
                    completed_at=None,
                    handover_batch_id=None,
                    version=item["version"] + 1,
                    updated_at=now,
                )
            )

        parts = [
            f"{label} {len(rows[key])} 条"
            for key, label in (
                ("follow_ups", "回访"),
                ("home_visits", "家访"),
                ("campus_visits", "到校"),
            )
            if rows[key]
        ]
        student = terminal[student_id]
        status_label = STATUS_LABELS.get(student.status, "无效")
        connection.execute(
            logs.insert().values(
                operator_id=None,
                operator_name=MIGRATION_OPERATOR,
                target_student_id=student_id,
                case_no=student.case_no or "",
                action=MIGRATION_ACTION,
                content=(
                    f"学生{status_label}，关闭{'、'.join(parts)}"
                    if parts
                    else f"学生{status_label}，关闭遗留工作项 {len(rows['work_items'])} 条"
                ),
                old_status="",
                new_status="",
                note_content=json.dumps(rows, ensure_ascii=False),
                batch_id=MIGRATION_BATCH_ID,
                created_at=now,
            )
        )
        report["students"] += 1
        report["follow_ups_completed"] += len(follow_up_ids)
        report["home_visits_cancelled"] += len(rows["home_visits"])
        report["campus_visits_cancelled"] += len(rows["campus_visits"])
        report["work_items_cancelled"] += len(rows["work_items"])
    return dict(report)


def reopen_terminal_students_tasks(connection: Connection) -> int:
    """Undo :func:`close_terminal_students_tasks` from its operation logs.

    Rows changed again after the upgrade are put back to their pre-upgrade state.
    """
    tables = _load_tables(connection)
    follow_ups, work_items, logs = (
        tables["follow_ups"],
        tables["work_items"],
        tables["operation_logs"],
    )
    visit_tables = {
        "home_visits": tables["home_visit_tasks"],
        "campus_visits": tables["campus_visit_tasks"],
    }
    migrated = connection.execute(
        select(logs.c.id, logs.c.note_content).where(
            and_(logs.c.action == MIGRATION_ACTION, logs.c.batch_id == MIGRATION_BATCH_ID)
        )
    ).all()
    for _log_id, note_content in migrated:
        rows = json.loads(note_content)
        if rows["follow_ups"]:
            connection.execute(
                update(follow_ups).where(follow_ups.c.id.in_(rows["follow_ups"])).values(
                    is_completed=False
                )
            )
        for key, table in visit_tables.items():
            for visit in rows[key]:
                connection.execute(
                    update(table).where(table.c.id == visit["id"]).values(
                        status=visit["status"],
                        updated_at=datetime.fromisoformat(visit["updated_at"]),
                    )
                )
        for item in rows["work_items"]:
            values = {column: item[column] for column in WORK_ITEM_COLUMNS}
            for column in WORK_ITEM_DATETIME_COLUMNS:
                if values[column] is not None:
                    values[column] = datetime.fromisoformat(values[column])
            connection.execute(
                update(work_items).where(work_items.c.id == item["id"]).values(**values)
            )
    connection.execute(
        delete(logs).where(
            and_(logs.c.action == MIGRATION_ACTION, logs.c.batch_id == MIGRATION_BATCH_ID)
        )
    )
    return len(migrated)
