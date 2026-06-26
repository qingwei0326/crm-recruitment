import sqlite3

from scripts.repair_status_from_logs import apply_repairs, fetch_candidates


def _schema(conn: sqlite3.Connection):
    conn.executescript(
        """
        create table users (
            id integer primary key,
            name text not null
        );
        create table students (
            id integer primary key,
            name text not null,
            case_no text,
            assigned_to integer,
            status text not null
        );
        create table operation_logs (
            id integer primary key autoincrement,
            operator_id integer,
            operator_name text not null,
            target_student_id integer,
            case_no text,
            action text not null,
            content text,
            old_status text,
            new_status text,
            note_content text,
            created_at text not null
        );
        """
    )
    conn.execute("insert into users (id, name) values (8, '沈雨晨')")


def test_fetch_candidates_skips_reopened_and_unknown_statuses():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _schema(conn)
    insert_student_sql = (
        "insert into students (id, name, case_no, assigned_to, status) "
        "values (?, ?, ?, 8, 'not_contacted')"
    )
    conn.executemany(
        insert_student_sql,
        [
            (1, "应恢复", "A"),
            (2, "后来回收", "B"),
            (3, "未知状态", "C"),
        ],
    )
    conn.executemany(
        """
        insert into operation_logs (
            operator_name, target_student_id, case_no, action, content,
            old_status, new_status, created_at
        ) values (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                "沈雨晨",
                1,
                "A",
                "修改状态",
                "状态 未联系 -> 无效",
                "未联系",
                "无效",
                "2026-06-24 10:00:00",
            ),
            (
                "沈雨晨",
                2,
                "B",
                "修改状态",
                "状态 未联系 -> 无效",
                "未联系",
                "无效",
                "2026-06-24 10:00:00",
            ),
            (
                "系统管理员",
                2,
                "B",
                "线索回收",
                "超时未跟进，重新分配",
                "",
                "",
                "2026-06-25 10:00:00",
            ),
            (
                "沈雨晨",
                3,
                "C",
                "修改状态",
                "状态 未联系 -> 暂存",
                "未联系",
                "暂存",
                "2026-06-24 10:00:00",
            ),
        ],
    )

    candidates, skipped = fetch_candidates(conn)

    assert [candidate.student_id for candidate in candidates] == [1]
    assert candidates[0].target_status == "invalid"
    assert [row["id"] for row in skipped] == [3]


def test_apply_repairs_updates_status_and_writes_audit_log():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _schema(conn)
    conn.execute(
        """
        insert into students (id, name, case_no, assigned_to, status)
        values (1, '应恢复', 'A', 8, 'not_contacted')
        """
    )
    conn.execute(
        """
        insert into operation_logs (
            operator_name, target_student_id, case_no, action, content,
            old_status, new_status, created_at
        ) values (
            '沈雨晨', 1, 'A', '修改状态', '状态 未联系 -> 无效',
            '未联系', '无效', '2026-06-24 10:00:00'
        )
        """
    )
    candidates, _ = fetch_candidates(conn)

    assert apply_repairs(conn, candidates) == 1

    status = conn.execute("select status from students where id = 1").fetchone()["status"]
    assert status == "invalid"
    audit = conn.execute(
        """
        select operator_name, action, old_status, new_status, note_content
        from operation_logs
        where action = '数据修复'
        """
    ).fetchone()
    assert dict(audit) == {
        "operator_name": "系统数据修复",
        "action": "数据修复",
        "old_status": "未联系",
        "new_status": "无效",
        "note_content": "无效",
    }


def test_fetch_candidates_uses_last_log_id_when_status_logs_tie_on_time():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    _schema(conn)
    conn.execute(
        """
        insert into students (id, name, case_no, assigned_to, status)
        values (1, '同秒日志', 'A', 8, 'not_contacted')
        """
    )
    conn.executemany(
        """
        insert into operation_logs (
            operator_name, target_student_id, case_no, action, content,
            old_status, new_status, created_at
        ) values (?, 1, 'A', '修改状态', ?, ?, ?, '2026-06-24 10:00:00')
        """,
        [
            ("沈雨晨", "状态 未联系 -> 拒绝接听", "未联系", "拒绝接听"),
            ("沈雨晨", "状态 拒绝接听 -> 无效", "拒绝接听", "无效"),
        ],
    )

    candidates, skipped = fetch_candidates(conn)

    assert skipped == []
    assert len(candidates) == 1
    assert candidates[0].log_new_status == "无效"
    assert candidates[0].target_status == "invalid"
