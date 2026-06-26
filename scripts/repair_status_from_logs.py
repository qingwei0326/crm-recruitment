"""Repair students whose current status conflicts with their latest status log.

Default mode is read-only. Use --apply to back up the SQLite DB and update
students that are still assigned, still marked not_contacted, and whose latest
status-change log says they had already moved to another workflow status.
"""

from __future__ import annotations

import argparse
import sqlite3
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


REOPEN_ACTIONS = ("线索回收", "回收无效线索", "分配", "多学校分发")

STATUS_LOG_TO_STORED_STATUS = {
    "new_lead": "not_contacted",
    "新线索": "not_contacted",
    "not_contacted": "not_contacted",
    "未联系": "not_contacted",
    "contacted": "contacted",
    "已联系": "contacted",
    "very_interested": "contacted",
    "非常有意向": "contacted",
    "pending_visit": "pending_visit",
    "待回访": "pending_visit",
    "interested_add_wechat": "pending_visit",
    "意向了解加微": "pending_visit",
    "not_reached": "not_reached",
    "未接": "not_reached",
    "rejected": "not_reached",
    "拒绝接听": "not_reached",
    "invalid": "invalid",
    "无效": "invalid",
    "completed": "invalid",
    "已完成": "invalid",
    "expired": "invalid",
    "已过期": "invalid",
    "high_score": "invalid",
    "高分段": "invalid",
    "not_interested": "invalid",
    "无意向": "invalid",
    "child_not_want_study": "invalid",
    "孩子不想读": "invalid",
    "enrolled": "enrolled",
    "已报名": "enrolled",
}

STORED_STATUS_TO_DISPLAY = {
    "not_contacted": "未联系",
    "contacted": "已联系",
    "pending_visit": "待回访",
    "not_reached": "未接",
    "invalid": "无效",
    "enrolled": "已报名",
}


@dataclass(frozen=True)
class RepairCandidate:
    student_id: int
    name: str
    case_no: str
    assigned_to: int
    assigned_name: str
    status_log_at: str
    status_operator: str
    log_old_status: str
    log_new_status: str
    log_content: str
    target_status: str

    @property
    def target_display(self) -> str:
        return STORED_STATUS_TO_DISPLAY.get(self.target_status, self.target_status)


def connect(db_path: Path, *, read_only: bool) -> sqlite3.Connection:
    if read_only:
        conn = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
    else:
        conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    return conn


def fetch_candidates(
    conn: sqlite3.Connection,
    *,
    agent_id: int | None = None,
    agent_name: str | None = None,
) -> tuple[list[RepairCandidate], list[sqlite3.Row]]:
    filters: list[str] = []
    params: dict[str, object] = {}
    if agent_id is not None:
        filters.append("s.assigned_to = :agent_id")
        params["agent_id"] = agent_id
    if agent_name:
        filters.append("u.name = :agent_name")
        params["agent_name"] = agent_name

    agent_filter_sql = ""
    if filters:
        agent_filter_sql = " and " + " and ".join(filters)

    reopen_placeholders = ", ".join(f":reopen_{i}" for i, _ in enumerate(REOPEN_ACTIONS))
    params.update({f"reopen_{i}": action for i, action in enumerate(REOPEN_ACTIONS)})

    rows = conn.execute(
        f"""
        with ranked_status_logs as (
          select ol.target_student_id, ol.created_at, ol.operator_name,
                 ol.old_status, ol.new_status, ol.content,
                 row_number() over (
                   partition by ol.target_student_id
                   order by ol.created_at desc, ol.id desc
                 ) as rn
          from operation_logs ol
          where ol.action = '修改状态'
        ), latest_log as (
          select target_student_id, created_at, operator_name,
                 old_status, new_status, content
          from ranked_status_logs
          where rn = 1
        )
        select s.id, s.name, coalesce(s.case_no, '') as case_no, s.assigned_to,
               coalesce(u.name, '') as assigned_name, ll.created_at as status_log_at,
               coalesce(ll.operator_name, '') as status_operator,
               coalesce(ll.old_status, '') as log_old_status,
               coalesce(ll.new_status, '') as log_new_status,
               coalesce(ll.content, '') as log_content
        from students s
        join latest_log ll on ll.target_student_id = s.id
        left join users u on u.id = s.assigned_to
        where s.assigned_to is not null
          and s.status = 'not_contacted'
          and ll.new_status not in ('未联系', 'not_contacted')
          {agent_filter_sql}
          and not exists (
            select 1
            from operation_logs later
            where later.target_student_id = s.id
              and later.created_at > ll.created_at
              and (
                later.action in ({reopen_placeholders})
                or later.new_status in ('未联系', 'not_contacted')
              )
          )
        order by s.assigned_to, s.id
        """,
        params,
    ).fetchall()

    candidates: list[RepairCandidate] = []
    skipped: list[sqlite3.Row] = []
    for row in rows:
        target_status = STATUS_LOG_TO_STORED_STATUS.get(row["log_new_status"])
        if not target_status or target_status == "not_contacted":
            skipped.append(row)
            continue
        candidates.append(
            RepairCandidate(
                student_id=int(row["id"]),
                name=row["name"] or "",
                case_no=row["case_no"] or "",
                assigned_to=int(row["assigned_to"]),
                assigned_name=row["assigned_name"] or "",
                status_log_at=row["status_log_at"] or "",
                status_operator=row["status_operator"] or "",
                log_old_status=row["log_old_status"] or "",
                log_new_status=row["log_new_status"] or "",
                log_content=row["log_content"] or "",
                target_status=target_status,
            )
        )
    return candidates, skipped


def backup_database(db_path: Path, backup_dir: Path) -> Path:
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    backup_path = backup_dir / f"{db_path.stem}.before-status-repair.{stamp}{db_path.suffix}"
    with sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True) as source:
        with sqlite3.connect(str(backup_path)) as target:
            source.backup(target)
    return backup_path


def apply_repairs(conn: sqlite3.Connection, candidates: list[RepairCandidate]) -> int:
    repaired = 0
    with conn:
        for candidate in candidates:
            result = conn.execute(
                "update students set status = ? where id = ? and status = 'not_contacted'",
                (candidate.target_status, candidate.student_id),
            )
            if result.rowcount != 1:
                continue
            content = (
                "根据最新状态日志恢复学生状态："
                f"{candidate.log_old_status or '未联系'} -> {candidate.target_display}；"
                f"原日志时间 {candidate.status_log_at}；"
                f"原操作人 {candidate.status_operator or '未知'}；"
                f"原日志内容：{candidate.log_content}"
            )
            conn.execute(
                """
                insert into operation_logs (
                    operator_id, operator_name, target_student_id, case_no,
                    action, content, old_status, new_status, note_content, created_at
                ) values (
                    null, '系统数据修复', ?, ?, '数据修复', ?, '未联系', ?, ?, CURRENT_TIMESTAMP
                )
                """,
                (
                    candidate.student_id,
                    candidate.case_no,
                    content,
                    candidate.target_display,
                    candidate.log_new_status,
                ),
            )
            repaired += 1
    return repaired


def print_summary(candidates: list[RepairCandidate], skipped: list[sqlite3.Row]) -> None:
    by_agent_and_status = Counter(
        (candidate.assigned_name, candidate.target_display) for candidate in candidates
    )
    print("候选修复记录:")
    if by_agent_and_status:
        for (agent_name, target_display), count in sorted(by_agent_and_status.items()):
            print(f"  {agent_name or '未知坐席'} -> {target_display}: {count}")
    else:
        print("  无")
    print(f"候选合计: {len(candidates)}")
    print(f"跳过未识别/未联系状态: {len(skipped)}")
    if candidates:
        print("样例:")
        for candidate in candidates[:8]:
            print(
                f"  #{candidate.student_id} {candidate.name} "
                f"{candidate.log_new_status} -> {candidate.target_display} "
                f"({candidate.status_log_at})"
            )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", default="crm.db", help="SQLite database path")
    parser.add_argument("--apply", action="store_true", help="Apply repairs after backup")
    parser.add_argument("--backup-dir", default="backups/status-repair", help="Backup directory")
    parser.add_argument("--agent-id", type=int, default=None, help="Limit to one assigned agent ID")
    parser.add_argument("--agent-name", default=None, help="Limit to one assigned agent name")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).resolve()
    if not db_path.exists():
        raise SystemExit(f"数据库不存在: {db_path}")

    with connect(db_path, read_only=not args.apply) as conn:
        candidates, skipped = fetch_candidates(
            conn,
            agent_id=args.agent_id,
            agent_name=args.agent_name,
        )
        print_summary(candidates, skipped)
        if not args.apply:
            print("当前为 dry-run，未修改数据库。加 --apply 才会备份并执行修复。")
            return 0

    backup_path = backup_database(db_path, Path(args.backup_dir).resolve())
    print(f"已备份数据库: {backup_path}")
    with connect(db_path, read_only=False) as conn:
        candidates, _ = fetch_candidates(
            conn,
            agent_id=args.agent_id,
            agent_name=args.agent_name,
        )
        repaired = apply_repairs(conn, candidates)
    print(f"已修复: {repaired}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
