from collections import Counter
from datetime import datetime
from typing import Any

from sqlalchemy import MetaData, Table, bindparam, select, text
from sqlalchemy.orm import Session

OUTCOME_ROWS = (
    ("phone_invalid", "空号", True, True, 10),
    ("high_score", "高分段", True, True, 20),
    ("no_intent", "无意向", True, True, 30),
    ("child_declined", "孩子不想读", True, True, 40),
    ("enrolled_elsewhere", "已报名其他学校", True, False, 50),
    ("legacy_unspecified", "历史未注明", True, True, 90),
    ("other", "其他", True, True, 100),
)

REASON_CODE_BY_TEXT = {
    "空号": "phone_invalid",
    "高分段": "high_score",
    "无意向": "no_intent",
    "孩子不想读": "child_declined",
    "报好了": "enrolled_elsewhere",
    "已报名其他学校": "enrolled_elsewhere",
    "其他": "other",
    "phone_invalid": "phone_invalid",
    "high_score": "high_score",
    "not_interested": "no_intent",
    "no_intent": "no_intent",
    "child_not_want_study": "child_declined",
    "child_not_interested": "child_declined",
    "enrolled_elsewhere": "enrolled_elsewhere",
    "other": "other",
}

INVALID_STATUS_VALUES = {
    "invalid",
    "completed",
    "expired",
    "high_score",
    "not_interested",
    "no_intent",
    "child_not_want_study",
    "child_not_interested",
    "无效",
    "已完成",
    "已过期",
    "高分段",
    "无意向",
    "孩子不想读",
}
TERMINAL_STATUS_VALUES = INVALID_STATUS_VALUES | {"enrolled", "已报名"}

HOME_OPEN_STATUS_VALUES = {"pending", "confirmed", "scheduled", "postponed"}
HOME_FOLLOW_ON_RESULTS = {"considering", "waiting_score", "campus_visit"}
CAMPUS_OPEN_STATUS_VALUES = {"pending", "scheduled", "rescheduled"}
CAMPUS_FOLLOW_ON_STATUS_VALUES = {"arrived", "no_show"}
CAMPUS_FOLLOW_ON_RESULTS = {"arrived", "no_show", "rescheduled", "considering"}
OPEN_SETTLEMENT_STATUS_VALUES = {"unsettled", "postponed", "disputed"}

TABLE_NAMES = (
    "users",
    "students",
    "operation_logs",
    "follow_ups",
    "home_visit_tasks",
    "campus_visit_tasks",
    "enrollment_records",
    "agent_employment",
    "agent_employment_events",
    "student_assignments",
    "work_items",
    "lead_outcome_reasons",
)


def _load_tables(session: Session) -> dict[str, Table]:
    metadata = MetaData()
    metadata.reflect(bind=session.connection(), only=TABLE_NAMES)
    return {name: metadata.tables[name] for name in TABLE_NAMES}


def _all_rows(session: Session, table: Table) -> list[dict[str, Any]]:
    return [dict(row) for row in session.execute(select(table)).mappings()]


def _is_terminal(value: object) -> bool:
    return str(value or "").strip() in TERMINAL_STATUS_VALUES


def _is_invalid(value: object) -> bool:
    return str(value or "").strip() in INVALID_STATUS_VALUES


def _outcome_code(student: dict[str, Any]) -> str:
    detail = str(student.get("status_detail") or "").strip()
    if detail:
        return REASON_CODE_BY_TEXT.get(detail, "other")
    status = str(student.get("status") or "").strip()
    return REASON_CODE_BY_TEXT.get(status, "legacy_unspecified")


def _offboard_marker(user: dict[str, Any]) -> str:
    return (
        f"离职 {user.get('role') or ''} {user.get('username') or ''}"
        f"({user.get('name') or ''})："
    )


def _employment_statuses(
    users: list[dict[str, Any]],
    students: list[dict[str, Any]],
    operation_logs: list[dict[str, Any]],
) -> dict[int, str]:
    nonterminal_owners = {
        int(student["assigned_to"])
        for student in students
        if student.get("assigned_to") is not None
        and not _is_terminal(student.get("status"))
    }
    offboard_contents = [
        str(row.get("content") or "")
        for row in operation_logs
        if row.get("action") == "离职用户"
    ]

    result: dict[int, str] = {}
    for user in users:
        user_id = int(user["id"])
        if bool(user.get("is_active")):
            result[user_id] = "active"
            continue
        has_offboard_log = any(
            content.startswith(_offboard_marker(user)) for content in offboard_contents
        )
        result[user_id] = (
            "offboarded"
            if has_offboard_log and user_id not in nonterminal_owners
            else "suspended"
        )
    return result


def _work_status(owner_id: int, employment_by_user: dict[int, str]) -> str:
    return "open" if employment_by_user.get(owner_id) == "active" else "blocked_suspension"


def _is_overdue(value: object, now: datetime) -> bool:
    return isinstance(value, datetime) and value < now


def _priority(value: object, *, overdue: bool = False, urgent: bool = False) -> str:
    if overdue or urgent:
        return "high"
    normalized = str(value or "").strip().lower()
    if normalized in {"高", "high"}:
        return "high"
    if normalized in {"低", "low"}:
        return "low"
    return "medium"


def _home_visit_is_open(row: dict[str, Any]) -> bool:
    status = str(row.get("status") or "")
    if status in HOME_OPEN_STATUS_VALUES:
        return True
    if status != "completed" or str(row.get("result") or "") not in HOME_FOLLOW_ON_RESULTS:
        return False
    return bool(
        row.get("next_follow_up_at")
        or row.get("next_action")
        or row.get("result") == "campus_visit"
    )


def _campus_visit_is_open(row: dict[str, Any]) -> bool:
    status = str(row.get("status") or "")
    if status in CAMPUS_OPEN_STATUS_VALUES:
        return True
    if status not in CAMPUS_FOLLOW_ON_STATUS_VALUES:
        return False
    return bool(
        row.get("next_follow_up_at")
        or row.get("next_action")
        or str(row.get("result") or "") in CAMPUS_FOLLOW_ON_RESULTS
    )


def _source_item(
    *,
    kind: str,
    source_type: str,
    source_id: int,
    student: dict[str, Any],
    creator_user_id: int | None,
    due_at: object,
    priority: str,
    created_at: object,
    employment_by_user: dict[int, str],
    now: datetime,
) -> dict[str, Any] | None:
    assigned_to = student.get("assigned_to")
    owner_id = int(assigned_to) if assigned_to is not None else creator_user_id
    if owner_id is None:
        return None
    return {
        "student_id": int(student["id"]),
        "kind": kind,
        "status": _work_status(owner_id, employment_by_user),
        "owner_agent_id": owner_id,
        "creator_user_id": creator_user_id,
        "priority": priority,
        "due_at": due_at,
        "completed_at": None,
        "source_type": source_type,
        "source_id": source_id,
        "handover_batch_id": None,
        "version": 1,
        "created_at": created_at or now,
        "updated_at": now,
    }


def backfill_domain_core(session: Session, now: datetime) -> dict[str, int]:
    tables = _load_tables(session)
    users = _all_rows(session, tables["users"])
    students = _all_rows(session, tables["students"])
    operation_logs = _all_rows(session, tables["operation_logs"])
    employment_by_user = _employment_statuses(users, students, operation_logs)

    report = {
        "employment_created": 0,
        "employment_events_created": 0,
        "assignments_created": 0,
        "lead_work_items_created": 0,
        "source_work_items_created": 0,
        "source_work_items_skipped_no_owner": 0,
        "outcome_reasons_created": 0,
        "outcomes_mapped": 0,
    }

    employment_table = tables["agent_employment"]
    existing_employment = {
        int(row["user_id"]): str(row["status"])
        for row in _all_rows(session, employment_table)
    }
    employment_rows = []
    for user in users:
        user_id = int(user["id"])
        if user_id in existing_employment:
            employment_by_user[user_id] = existing_employment[user_id]
            continue
        status = employment_by_user[user_id]
        employment_rows.append(
            {
                "user_id": user_id,
                "status": status,
                "version": 1,
                "status_changed_at": now,
                "offboarding_started_at": now if status == "offboarded" else None,
                "offboarded_at": now if status == "offboarded" else None,
                "updated_by": None,
            }
        )
    if employment_rows:
        session.execute(employment_table.insert(), employment_rows)
        report["employment_created"] = len(employment_rows)

    event_table = tables["agent_employment_events"]
    existing_event_users = {
        int(row["user_id"])
        for row in _all_rows(session, event_table)
        if row.get("reason") == "legacy_backfill"
    }
    event_rows = [
        {
            "user_id": user_id,
            "from_status": status,
            "to_status": status,
            "reason": "legacy_backfill",
            "operator_id": None,
            "handover_batch_id": None,
            "created_at": now,
        }
        for user_id, status in employment_by_user.items()
        if user_id not in existing_event_users
    ]
    if event_rows:
        session.execute(event_table.insert(), event_rows)
        report["employment_events_created"] = len(event_rows)

    assignment_table = tables["student_assignments"]
    active_assignments = {
        int(row["student_id"]): int(row["agent_id"])
        for row in _all_rows(session, assignment_table)
        if row.get("ended_at") is None
    }
    assignment_rows = []
    for student in students:
        assigned_to = student.get("assigned_to")
        if assigned_to is None:
            continue
        student_id = int(student["id"])
        agent_id = int(assigned_to)
        existing_agent_id = active_assignments.get(student_id)
        if existing_agent_id is not None:
            if existing_agent_id != agent_id:
                raise RuntimeError(
                    "active student assignment disagrees with legacy projection"
                )
            continue
        assignment_rows.append(
            {
                "student_id": student_id,
                "agent_id": agent_id,
                "started_at": student.get("assigned_at")
                or student.get("created_at")
                or now,
                "ended_at": None,
                "start_reason": "legacy_backfill",
                "end_reason": None,
                "started_by": None,
                "ended_by": None,
                "handover_batch_id": None,
                "previous_assignment_id": None,
                "created_at": now,
                "updated_at": now,
            }
        )
    if assignment_rows:
        session.execute(assignment_table.insert(), assignment_rows)
        report["assignments_created"] = len(assignment_rows)

    work_item_table = tables["work_items"]
    existing_work_keys = {
        (str(row["kind"]), str(row["source_type"]), int(row["source_id"]))
        for row in _all_rows(session, work_item_table)
    }
    work_rows: list[dict[str, Any]] = []
    for student in students:
        assigned_to = student.get("assigned_to")
        if assigned_to is None or _is_terminal(student.get("status")):
            continue
        key = ("lead_contact", "student", int(student["id"]))
        if key in existing_work_keys:
            continue
        owner_id = int(assigned_to)
        work_rows.append(
            {
                "student_id": int(student["id"]),
                "kind": "lead_contact",
                "status": _work_status(owner_id, employment_by_user),
                "owner_agent_id": owner_id,
                "creator_user_id": owner_id,
                "priority": "medium",
                "due_at": None,
                "completed_at": None,
                "source_type": "student",
                "source_id": int(student["id"]),
                "handover_batch_id": None,
                "version": 1,
                "created_at": student.get("created_at") or now,
                "updated_at": now,
            }
        )
        existing_work_keys.add(key)
        report["lead_work_items_created"] += 1

    student_by_id = {int(row["id"]): row for row in students}

    def add_source_item(candidate: dict[str, Any] | None) -> None:
        if candidate is None:
            report["source_work_items_skipped_no_owner"] += 1
            return
        key = (
            str(candidate["kind"]),
            str(candidate["source_type"]),
            int(candidate["source_id"]),
        )
        if key in existing_work_keys:
            return
        existing_work_keys.add(key)
        work_rows.append(candidate)
        report["source_work_items_created"] += 1

    for follow_up in _all_rows(session, tables["follow_ups"]):
        if bool(follow_up.get("is_completed")):
            continue
        student = student_by_id[int(follow_up["student_id"])]
        due_at = follow_up.get("follow_up_date")
        add_source_item(
            _source_item(
                kind="scheduled_follow_up",
                source_type="follow_up",
                source_id=int(follow_up["id"]),
                student=student,
                creator_user_id=int(follow_up["agent_id"]),
                due_at=due_at,
                priority=_priority(None, overdue=_is_overdue(due_at, now)),
                created_at=follow_up.get("created_at"),
                employment_by_user=employment_by_user,
                now=now,
            )
        )

    for task in _all_rows(session, tables["home_visit_tasks"]):
        if not _home_visit_is_open(task):
            continue
        student = student_by_id[int(task["student_id"])]
        due_at = (
            task.get("next_follow_up_at")
            or task.get("scheduled_at")
            or task.get("requested_visit_time")
        )
        add_source_item(
            _source_item(
                kind="home_visit",
                source_type="home_visit",
                source_id=int(task["id"]),
                student=student,
                creator_user_id=int(task["creator_agent_id"]),
                due_at=due_at,
                priority=_priority(
                    task.get("priority"),
                    overdue=_is_overdue(due_at, now),
                ),
                created_at=task.get("created_at"),
                employment_by_user=employment_by_user,
                now=now,
            )
        )

    for task in _all_rows(session, tables["campus_visit_tasks"]):
        if not _campus_visit_is_open(task):
            continue
        student = student_by_id[int(task["student_id"])]
        due_at = task.get("next_follow_up_at") or task.get("appointment_at")
        add_source_item(
            _source_item(
                kind="campus_visit",
                source_type="campus_visit",
                source_id=int(task["id"]),
                student=student,
                creator_user_id=int(task["creator_user_id"]),
                due_at=due_at,
                priority=_priority(None, overdue=_is_overdue(due_at, now)),
                created_at=task.get("created_at"),
                employment_by_user=employment_by_user,
                now=now,
            )
        )

    for record in _all_rows(session, tables["enrollment_records"]):
        if str(record.get("settlement_status") or "") not in OPEN_SETTLEMENT_STATUS_VALUES:
            continue
        student = student_by_id[int(record["student_id"])]
        add_source_item(
            _source_item(
                kind="enrollment_settlement",
                source_type="enrollment",
                source_id=int(record["id"]),
                student=student,
                creator_user_id=int(record["attributed_agent_id"]),
                due_at=record.get("enrolled_at"),
                priority=_priority(
                    None,
                    urgent=str(record.get("settlement_status") or "") == "disputed",
                ),
                created_at=record.get("created_at"),
                employment_by_user=employment_by_user,
                now=now,
            )
        )

    for student in students:
        if not bool(student.get("need_help")):
            continue
        assigned_to = student.get("assigned_to")
        creator_id = int(assigned_to) if assigned_to is not None else None
        add_source_item(
            _source_item(
                kind="help_request",
                source_type="help",
                source_id=int(student["id"]),
                student=student,
                creator_user_id=creator_id,
                due_at=student.get("updated_at"),
                priority="high",
                created_at=student.get("created_at"),
                employment_by_user=employment_by_user,
                now=now,
            )
        )

    if work_rows:
        session.execute(work_item_table.insert(), work_rows)

    outcome_table = tables["lead_outcome_reasons"]
    existing_outcomes = {
        str(row["code"]) for row in _all_rows(session, outcome_table)
    }
    outcome_rows = [
        {
            "code": code,
            "label": label,
            "terminal": terminal,
            "reclaimable": reclaimable,
            "active": True,
            "sort_order": sort_order,
        }
        for code, label, terminal, reclaimable, sort_order in OUTCOME_ROWS
        if code not in existing_outcomes
    ]
    if outcome_rows:
        session.execute(outcome_table.insert(), outcome_rows)
        report["outcome_reasons_created"] = len(outcome_rows)

    outcome_updates = [
        {
            "student_id_for_outcome": int(student["id"]),
            "mapped_outcome_code": _outcome_code(student),
        }
        for student in students
        if _is_invalid(student.get("status"))
        and not str(student.get("outcome_reason_code") or "").strip()
    ]
    if outcome_updates:
        statement = (
            tables["students"]
            .update()
            .where(
                tables["students"].c.id
                == bindparam("student_id_for_outcome")
            )
            .values(outcome_reason_code=bindparam("mapped_outcome_code"))
        )
        session.execute(statement, outcome_updates)
        report["outcomes_mapped"] = len(outcome_updates)

    session.flush()
    return report


def audit_domain_core(session: Session) -> dict[str, object]:
    tables = _load_tables(session)
    users = _all_rows(session, tables["users"])
    students = _all_rows(session, tables["students"])
    employments = _all_rows(session, tables["agent_employment"])
    assignments = _all_rows(session, tables["student_assignments"])
    work_items = _all_rows(session, tables["work_items"])
    outcomes = _all_rows(session, tables["lead_outcome_reasons"])

    employment_by_user = {
        int(row["user_id"]): str(row["status"]) for row in employments
    }
    users_without_employment = sum(
        1 for user in users if int(user["id"]) not in employment_by_user
    )

    active_assignments = [
        row for row in assignments if row.get("ended_at") is None
    ]
    active_assignment_counts = Counter(
        int(row["student_id"]) for row in active_assignments
    )
    duplicate_active_assignments = sum(
        1 for count in active_assignment_counts.values() if count > 1
    )
    active_by_student = {
        int(row["student_id"]): int(row["agent_id"])
        for row in active_assignments
    }
    projection_by_student = {
        int(student["id"]): (
            int(student["assigned_to"])
            if student.get("assigned_to") is not None
            else None
        )
        for student in students
    }
    active_assignment_projection_mismatches = sum(
        1
        for student_id in set(projection_by_student) | set(active_by_student)
        if projection_by_student.get(student_id) != active_by_student.get(student_id)
    )

    open_items = [row for row in work_items if str(row.get("status")) == "open"]
    open_items_without_owner = sum(
        1 for row in open_items if row.get("owner_agent_id") is None
    )
    open_items_owned_by_inactive = sum(
        1
        for row in open_items
        if row.get("owner_agent_id") is not None
        and employment_by_user.get(int(row["owner_agent_id"])) != "active"
    )
    source_counts = Counter(
        (str(row["kind"]), str(row["source_type"]), int(row["source_id"]))
        for row in work_items
    )
    duplicate_source_work_items = sum(
        1 for count in source_counts.values() if count > 1
    )

    outcome_codes = {str(row["code"]) for row in outcomes}
    invalid_reasons_without_catalog_entry = sum(
        1
        for student in students
        if _is_invalid(student.get("status"))
        and (
            not str(student.get("outcome_reason_code") or "").strip()
            or str(student.get("outcome_reason_code")) not in outcome_codes
        )
    )

    foreign_key_violations = 0
    if session.get_bind().dialect.name == "sqlite":
        foreign_key_violations = len(
            session.execute(text("pragma foreign_key_check")).all()
        )

    report: dict[str, object] = {
        "users_without_employment": users_without_employment,
        "duplicate_active_assignments": duplicate_active_assignments,
        "active_assignment_projection_mismatches": (
            active_assignment_projection_mismatches
        ),
        "open_items_without_owner": open_items_without_owner,
        "open_items_owned_by_inactive": open_items_owned_by_inactive,
        "duplicate_source_work_items": duplicate_source_work_items,
        "invalid_reasons_without_catalog_entry": (
            invalid_reasons_without_catalog_entry
        ),
        "foreign_key_violations": foreign_key_violations,
    }
    report["ok"] = all(value == 0 for value in report.values())
    return {"ok": report.pop("ok"), **report}
