"""Send daily PushPlus alerts for stale A-level CRM students.

This script is intended to be run by cron. It intentionally uses only the
standard library and synchronous sqlite3 access.
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request
from pathlib import Path


PUSHPLUS_API = "https://www.pushplus.plus/send"
TITLE = "CRM A级未跟进预警"
TERMINAL_STATUSES = ("completed", "invalid", "enrolled", "rejected", "expired")


def get_stale_days(raw: str | None = None) -> int:
    raw = raw if raw is not None else os.getenv("STALE_DAYS", "3")
    try:
        return min(30, max(1, int(raw)))
    except ValueError:
        return 3


def get_database_path() -> str:
    return os.getenv("DATABASE_PATH") or str(Path(__file__).resolve().parents[1] / "crm.db")


def read_db_config(db_path: str) -> dict[str, str]:
    with sqlite3.connect(db_path) as conn:
        rows = conn.execute(
            """
            SELECT key, value
            FROM system_configs
            WHERE key IN ('pushplus_token', 'stale_days')
            """
        ).fetchall()
    return {key: value for key, value in rows}


def query_report(db_path: str, stale_days: int) -> tuple[int, list[sqlite3.Row]]:
    placeholders = ", ".join("?" for _ in TERMINAL_STATUSES)
    params = [*TERMINAL_STATUSES]

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row

        total_sql = f"""
            SELECT COUNT(*) AS total
            FROM students
            WHERE intent_level = 'A'
              AND status NOT IN ({placeholders})
        """
        total = conn.execute(total_sql, params).fetchone()["total"]

        stale_sql = f"""
            WITH last_events AS (
                SELECT student_id, MAX(created_at) AS last_at
                FROM (
                    SELECT student_id, created_at FROM calls
                    UNION ALL
                    SELECT student_id, created_at FROM notes
                )
                GROUP BY student_id
            )
            SELECT
                s.name AS student_name,
                COALESCE(u.name, '') AS agent_name,
                COALESCE(le.last_at, s.assigned_at, s.created_at) AS last_activity,
                CAST(
                    julianday('now') - julianday(COALESCE(le.last_at, s.assigned_at, s.created_at))
                    AS INTEGER
                ) AS stale_days
            FROM students s
            LEFT JOIN users u ON u.id = s.assigned_to
            LEFT JOIN last_events le ON le.student_id = s.id
            WHERE s.intent_level = 'A'
              AND s.status NOT IN ({placeholders})
              AND COALESCE(le.last_at, s.assigned_at, s.created_at) < datetime('now', ?)
            ORDER BY last_activity ASC, s.id ASC
        """
        stale_params = [*TERMINAL_STATUSES, f"-{stale_days} days"]
        rows = conn.execute(stale_sql, stale_params).fetchall()

    return total, rows


def markdown_escape(value: object) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\n", " ")


def format_report(total_a_level: int, stale_rows: list[sqlite3.Row]) -> str:
    lines = [
        f"## {TITLE}",
        "",
        f"- A级总数: {total_a_level}",
        f"- 已滞留: {len(stale_rows)}",
        "",
        "| 姓名 | 话务员 | 最后跟进 | 已滞留(天) |",
        "| --- | --- | --- | ---: |",
    ]

    if stale_rows:
        for row in stale_rows:
            lines.append(
                "| {name} | {agent} | {last_activity} | {days} |".format(
                    name=markdown_escape(row["student_name"]),
                    agent=markdown_escape(row["agent_name"] or "未分配"),
                    last_activity=markdown_escape(row["last_activity"]),
                    days=markdown_escape(row["stale_days"]),
                )
            )
    else:
        lines.append("| 无 | - | - | 0 |")

    return "\n".join(lines)


def send_pushplus(token: str, content: str) -> None:
    payload = {
        "token": token,
        "title": TITLE,
        "content": content,
        "template": "markdown",
    }
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        PUSHPLUS_API,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read().decode("utf-8", errors="replace")
        if response.status >= 400:
            raise RuntimeError(f"PushPlus request failed: HTTP {response.status} {body}")


def main() -> int:
    db_path = get_database_path()

    try:
        config = read_db_config(db_path)
        pushplus_token = (config.get("pushplus_token") or os.getenv("PUSHPLUS_TOKEN", "")).strip()
        stale_days = get_stale_days(config.get("stale_days") or os.getenv("STALE_DAYS", "3"))
        total_a_level, stale_rows = query_report(db_path, stale_days)
    except sqlite3.Error as exc:
        print(f"DB error: {exc}", file=sys.stderr)
        return 1

    report = format_report(total_a_level, stale_rows)
    if not pushplus_token:
        print(report)
        return 0

    try:
        send_pushplus(pushplus_token, report)
    except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
        print(f"PushPlus error: {exc}", file=sys.stderr)
        return 1

    print(f"PushPlus alert sent: A-level={total_a_level}, stale={len(stale_rows)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
