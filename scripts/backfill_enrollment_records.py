"""Backfill enrollment_records for legacy enrolled students.

Default mode is dry-run. Pass --apply to write changes.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

PENDING_AGENT_USERNAME = "__pending_enrollment_attribution__"
PENDING_AGENT_NAME = "待确认归属"


@dataclass
class BackfillCandidate:
    student: sqlite3.Row
    attributed_agent_id: int
    attribution_method: str
    attribution_reason: str
    settlement_status: str
    first_assigned_agent_id: int | None
    current_assigned_agent_id: int | None
    last_effective_agent_id: int | None
    resolution: str


def connect(db_path: Path) -> sqlite3.Connection:
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def _one(conn: sqlite3.Connection, sql: str, params: tuple = ()) -> sqlite3.Row | None:
    return conn.execute(sql, params).fetchone()


def _table_columns(conn: sqlite3.Connection, table: str) -> set[str]:
    return {row["name"] for row in conn.execute(f"PRAGMA table_info({table})")}


def _require_schema(conn: sqlite3.Connection) -> None:
    tables = {
        row["name"]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }
    required_tables = {"students", "users", "enrollment_records", "operation_logs"}
    missing_tables = sorted(required_tables - tables)
    if missing_tables:
        raise RuntimeError(f"Missing required tables: {', '.join(missing_tables)}")

    required_enrollment_columns = {
        "student_id",
        "attributed_agent_id",
        "confirmed_by_admin_id",
        "student_name_snapshot",
        "guardian_phone_snapshot",
        "region_snapshot",
        "school_name_snapshot",
        "intent_program",
        "enrolled_program",
        "enrolled_at",
        "source",
        "attribution_method",
        "attribution_reason",
        "settlement_status",
        "settlement_notes",
        "created_at",
        "updated_at",
    }
    missing_columns = sorted(required_enrollment_columns - _table_columns(conn, "enrollment_records"))
    if missing_columns:
        raise RuntimeError(f"Missing enrollment_records columns: {', '.join(missing_columns)}")


def get_admin(conn: sqlite3.Connection) -> sqlite3.Row:
    admin = _one(
        conn,
        """
        SELECT id, name
        FROM users
        WHERE role = 'admin' AND is_active = 1
        ORDER BY is_super_admin DESC, id ASC
        LIMIT 1
        """,
    )
    if admin is None:
        raise RuntimeError("No active admin user found for confirmed_by_admin_id")
    return admin


def get_or_create_pending_agent(conn: sqlite3.Connection, *, apply: bool) -> int:
    existing = _one(
        conn,
        "SELECT id FROM users WHERE username = ? LIMIT 1",
        (PENDING_AGENT_USERNAME,),
    )
    if existing:
        return int(existing["id"])
    if not apply:
        return -1

    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        """
        INSERT INTO users (
            username,
            hashed_password,
            role,
            name,
            is_active,
            created_at,
            failed_login_attempts,
            service_regions,
            pushplus_token,
            token_version,
            last_login_device,
            last_login_ip,
            must_change_password,
            is_super_admin
        )
        VALUES (?, ?, 'agent', ?, 0, ?, 0, '', '', 1, '', '', 0, 0)
        """,
        (PENDING_AGENT_USERNAME, "disabled-pending-attribution", PENDING_AGENT_NAME, now),
    )
    return int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])


def latest_call_agent(conn: sqlite3.Connection, student_id: int) -> sqlite3.Row | None:
    if "dial_logs" not in {
        row["name"]
        for row in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
    }:
        return None
    return _one(
        conn,
        """
        SELECT d.agent_id, u.name, MAX(d.dialed_at) AS last_call
        FROM dial_logs d
        JOIN users u ON u.id = d.agent_id
        WHERE d.student_id = ? AND u.role = 'agent'
        GROUP BY d.agent_id, u.name
        ORDER BY last_call DESC
        LIMIT 1
        """,
        (student_id,),
    )


def active_agent_exists(conn: sqlite3.Connection, agent_id: int | None) -> bool:
    if agent_id is None:
        return False
    row = _one(
        conn,
        "SELECT id FROM users WHERE id = ? AND role = 'agent' LIMIT 1",
        (agent_id,),
    )
    return row is not None


def legacy_enrolled_students(conn: sqlite3.Connection) -> list[sqlite3.Row]:
    return conn.execute(
        """
        SELECT s.*
        FROM students s
        LEFT JOIN enrollment_records er ON er.student_id = s.id
        WHERE s.status = 'enrolled' AND er.id IS NULL
        ORDER BY s.region, s.id
        """
    ).fetchall()


def build_candidates(
    conn: sqlite3.Connection,
    students: list[sqlite3.Row],
    pending_agent_id: int,
) -> list[BackfillCandidate]:
    candidates: list[BackfillCandidate] = []
    for student in students:
        assigned_to = student["assigned_to"]
        if active_agent_exists(conn, assigned_to):
            candidates.append(
                BackfillCandidate(
                    student=student,
                    attributed_agent_id=int(assigned_to),
                    attribution_method="current_agent",
                    attribution_reason="历史已报名自动补录：按当前负责话务员归属",
                    settlement_status="unsettled",
                    first_assigned_agent_id=int(assigned_to),
                    current_assigned_agent_id=int(assigned_to),
                    last_effective_agent_id=int(assigned_to),
                    resolution="current_agent",
                )
            )
            continue

        call_agent = latest_call_agent(conn, int(student["id"]))
        if call_agent is not None:
            agent_id = int(call_agent["agent_id"])
            candidates.append(
                BackfillCandidate(
                    student=student,
                    attributed_agent_id=agent_id,
                    attribution_method="manual",
                    attribution_reason="历史已报名自动补录：按最近有效通话话务员归属",
                    settlement_status="unsettled",
                    first_assigned_agent_id=assigned_to,
                    current_assigned_agent_id=assigned_to,
                    last_effective_agent_id=agent_id,
                    resolution="latest_call_agent",
                )
            )
            continue

        candidates.append(
            BackfillCandidate(
                student=student,
                attributed_agent_id=pending_agent_id,
                attribution_method="manual",
                attribution_reason="历史已报名自动补录：未找到话务员证据，待人工确认归属",
                settlement_status="disputed",
                first_assigned_agent_id=assigned_to,
                current_assigned_agent_id=assigned_to,
                last_effective_agent_id=None,
                resolution="pending_attribution",
            )
        )
    return candidates


def _enrolled_at(student: sqlite3.Row) -> str:
    enrolled_at = student["enrolled_at"]
    if enrolled_at:
        return f"{str(enrolled_at)[:10]} 00:00:00"
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def insert_candidate(
    conn: sqlite3.Connection,
    candidate: BackfillCandidate,
    admin: sqlite3.Row,
) -> int:
    student = candidate.student
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.execute(
        """
        INSERT INTO enrollment_records (
            student_id,
            attributed_agent_id,
            confirmed_by_admin_id,
            first_assigned_agent_id,
            current_assigned_agent_id,
            last_effective_agent_id,
            home_visit_task_id,
            campus_visit_task_id,
            student_name_snapshot,
            guardian_phone_snapshot,
            region_snapshot,
            school_name_snapshot,
            intent_program,
            enrolled_program,
            enrolled_at,
            source,
            attribution_method,
            attribution_reason,
            amount,
            settlement_status,
            settlement_notes,
            created_at,
            updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 'admin', ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            int(student["id"]),
            candidate.attributed_agent_id,
            int(admin["id"]),
            candidate.first_assigned_agent_id,
            candidate.current_assigned_agent_id,
            candidate.last_effective_agent_id,
            student["name"] or "",
            (student["guardian_phone"] or student["guardian2_phone"] or ""),
            student["region"] or "",
            student["school_name"] or "",
            student["program"] or "",
            student["program"] or "",
            _enrolled_at(student),
            candidate.attribution_method,
            candidate.attribution_reason,
            student["deposit"],
            candidate.settlement_status,
            "历史已报名自动补录生成",
            now,
            now,
        ),
    )
    record_id = int(conn.execute("SELECT last_insert_rowid()").fetchone()[0])
    conn.execute(
        """
        INSERT INTO operation_logs (
            operator_id,
            operator_name,
            target_student_id,
            case_no,
            action,
            content,
            old_status,
            new_status,
            note_content,
            created_at,
            batch_id
        )
        VALUES (?, ?, ?, ?, '历史报名补录', ?, '', '已报名', ?, ?, 'backfill_enrollment_records')
        """,
        (
            int(admin["id"]),
            admin["name"] or "系统管理员",
            int(student["id"]),
            student["case_no"] or "",
            f"报名记录 #{record_id}；归属用户 #{candidate.attributed_agent_id}；状态 {candidate.settlement_status}",
            candidate.attribution_reason,
            now,
        ),
    )
    return record_id


def summarize(candidates: list[BackfillCandidate]) -> dict:
    by_resolution: dict[str, int] = {}
    by_region: dict[str, int] = {}
    for candidate in candidates:
        by_resolution[candidate.resolution] = by_resolution.get(candidate.resolution, 0) + 1
        region = candidate.student["region"] or "未知"
        by_region[region] = by_region.get(region, 0) + 1
    return {
        "total_candidates": len(candidates),
        "by_resolution": by_resolution,
        "by_region": by_region,
        "pending_student_ids": [
            int(candidate.student["id"])
            for candidate in candidates
            if candidate.resolution == "pending_attribution"
        ],
    }


def backfill_legacy_enrollments(db_path: Path, *, apply: bool = False) -> dict:
    conn = connect(db_path)
    try:
        _require_schema(conn)
        admin = get_admin(conn)
        students = legacy_enrolled_students(conn)
        needs_pending = any(not active_agent_exists(conn, row["assigned_to"]) for row in students)
        pending_agent_id = get_or_create_pending_agent(conn, apply=apply) if needs_pending else -1
        candidates = build_candidates(conn, students, pending_agent_id)
        summary = summarize(candidates)
        summary["applied"] = False
        summary["inserted"] = 0
        summary["pending_agent_id"] = pending_agent_id if needs_pending else None
        if apply:
            for candidate in candidates:
                insert_candidate(conn, candidate, admin)
            conn.commit()
            summary["applied"] = True
            summary["inserted"] = len(candidates)
        else:
            conn.rollback()
        return summary
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="crm.db", help="Path to SQLite database")
    parser.add_argument("--apply", action="store_true", help="Write changes")
    args = parser.parse_args()
    summary = backfill_legacy_enrollments(Path(args.db), apply=args.apply)
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
