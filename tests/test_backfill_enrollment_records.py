import sqlite3
from datetime import datetime
from pathlib import Path

from scripts.backfill_enrollment_records import backfill_legacy_enrollments


def _schema(conn: sqlite3.Connection):
    conn.executescript(
        """
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username VARCHAR(64) NOT NULL,
            hashed_password VARCHAR(256) NOT NULL,
            role VARCHAR(5) NOT NULL,
            name VARCHAR(64) NOT NULL,
            is_active BOOLEAN NOT NULL,
            created_at DATETIME NOT NULL,
            failed_login_attempts INTEGER NOT NULL DEFAULT 0,
            locked_until TIMESTAMP,
            service_regions VARCHAR(512) NOT NULL DEFAULT '',
            pushplus_token VARCHAR(64) NOT NULL DEFAULT '',
            token_version INTEGER NOT NULL DEFAULT 1,
            last_login_device VARCHAR(512) NOT NULL DEFAULT '',
            last_login_ip VARCHAR(64) NOT NULL DEFAULT '',
            must_change_password BOOLEAN NOT NULL DEFAULT 0,
            is_super_admin BOOLEAN NOT NULL DEFAULT 0
        );

        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name VARCHAR(64) NOT NULL,
            region VARCHAR(64) NOT NULL DEFAULT '',
            assigned_to INTEGER,
            status VARCHAR(13) NOT NULL,
            intent_level VARCHAR(4) NOT NULL DEFAULT 'none',
            stage VARCHAR(15) NOT NULL DEFAULT 'initial_contact',
            join_reasons TEXT,
            enrolled_at DATE,
            program VARCHAR(128) NOT NULL DEFAULT '',
            deposit FLOAT,
            expired_at DATE,
            assigned_at DATETIME,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL,
            score FLOAT,
            guardian_name TEXT DEFAULT '',
            guardian_phone TEXT DEFAULT '',
            school_name TEXT DEFAULT '',
            school_address TEXT DEFAULT '',
            case_no TEXT,
            need_help INTEGER DEFAULT 0,
            guardian2_name VARCHAR(64) NOT NULL DEFAULT '',
            guardian2_phone VARCHAR(20) NOT NULL DEFAULT '',
            enrollment_substage VARCHAR(32),
            agent_id INTEGER,
            priority INTEGER DEFAULT 0,
            last_contact_at DATETIME,
            next_follow_up DATETIME,
            follow_up_count INTEGER DEFAULT 0,
            attempt_count INTEGER DEFAULT 0,
            is_expired BOOLEAN DEFAULT 0,
            expired_reason VARCHAR(50),
            status_detail VARCHAR(64) NOT NULL DEFAULT ''
        );

        CREATE TABLE dial_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            agent_id INTEGER NOT NULL,
            dialed_at DATETIME NOT NULL,
            duration_seconds INTEGER DEFAULT 0
        );

        CREATE TABLE enrollment_records (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            attributed_agent_id INTEGER NOT NULL,
            confirmed_by_admin_id INTEGER NOT NULL,
            first_assigned_agent_id INTEGER,
            current_assigned_agent_id INTEGER,
            last_effective_agent_id INTEGER,
            home_visit_task_id INTEGER,
            campus_visit_task_id INTEGER,
            student_name_snapshot VARCHAR(64) NOT NULL,
            guardian_phone_snapshot VARCHAR(20) NOT NULL,
            region_snapshot VARCHAR(64) NOT NULL,
            school_name_snapshot VARCHAR(128) NOT NULL,
            intent_program VARCHAR(128) NOT NULL,
            enrolled_program VARCHAR(128) NOT NULL,
            enrolled_at DATETIME NOT NULL,
            source VARCHAR(12) NOT NULL,
            attribution_method VARCHAR(20) NOT NULL,
            attribution_reason TEXT NOT NULL,
            amount FLOAT,
            settlement_status VARCHAR(9) NOT NULL,
            settlement_notes TEXT NOT NULL,
            created_at DATETIME NOT NULL,
            updated_at DATETIME NOT NULL
        );

        CREATE TABLE operation_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operator_id INTEGER,
            operator_name VARCHAR(64) NOT NULL,
            target_student_id INTEGER,
            case_no VARCHAR(36),
            action VARCHAR(32) NOT NULL,
            content TEXT,
            old_status VARCHAR(32),
            new_status VARCHAR(32),
            note_content TEXT,
            created_at DATETIME NOT NULL,
            batch_id VARCHAR(64) NOT NULL DEFAULT ''
        );
        """
    )


def _seed(conn: sqlite3.Connection):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn.executemany(
        """
        INSERT INTO users (
            id, username, hashed_password, role, name, is_active, created_at, is_super_admin
        )
        VALUES (?, ?, 'x', ?, ?, ?, ?, ?)
        """,
        [
            (1, "admin", "admin", "系统管理员", 1, now, 1),
            (10, "agent10", "agent", "李燕艺", 1, now, 0),
            (11, "agent11", "agent", "蒲安琪", 1, now, 0),
        ],
    )
    conn.executemany(
        """
        INSERT INTO students (
            id, name, region, assigned_to, status, enrolled_at, program, deposit,
            created_at, updated_at, guardian_phone, school_name, case_no
        )
        VALUES (?, ?, ?, ?, 'enrolled', '2026-06-30', ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                100,
                "当前负责人报名",
                "长泰县",
                10,
                "护理",
                500,
                now,
                now,
                "13000000000",
                "长泰二中",
                "case-100",
            ),
            (
                101,
                "通话归属报名",
                "华安县",
                None,
                "汽修",
                None,
                now,
                now,
                "13100000000",
                "华安中学",
                "case-101",
            ),
            (
                102,
                "待确认报名",
                "华安县",
                None,
                "",
                None,
                now,
                now,
                "13200000000",
                "华安中学",
                "case-102",
            ),
        ],
    )
    conn.execute(
        """
        INSERT INTO dial_logs (student_id, agent_id, dialed_at, duration_seconds)
        VALUES (101, 11, '2026-06-30 10:00:00', 30)
        """
    )
    conn.commit()


def _prepare_db(tmp_path: Path) -> Path:
    db_path = tmp_path / "crm.db"
    conn = sqlite3.connect(db_path)
    try:
        _schema(conn)
        _seed(conn)
    finally:
        conn.close()
    return db_path


def test_backfill_dry_run_does_not_write(tmp_path):
    db_path = _prepare_db(tmp_path)

    summary = backfill_legacy_enrollments(db_path, apply=False)

    assert summary["total_candidates"] == 3
    assert summary["inserted"] == 0
    assert summary["applied"] is False
    conn = sqlite3.connect(db_path)
    try:
        assert conn.execute("SELECT COUNT(*) FROM enrollment_records").fetchone()[0] == 0
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM users WHERE username = '__pending_enrollment_attribution__'"
            ).fetchone()[0]
            == 0
        )
    finally:
        conn.close()


def test_backfill_creates_records_and_is_idempotent(tmp_path):
    db_path = _prepare_db(tmp_path)

    first = backfill_legacy_enrollments(db_path, apply=True)
    second = backfill_legacy_enrollments(db_path, apply=True)

    assert first["inserted"] == 3
    assert first["by_resolution"] == {
        "current_agent": 1,
        "latest_call_agent": 1,
        "pending_attribution": 1,
    }
    assert second["inserted"] == 0

    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = {
            row["student_id"]: row
            for row in conn.execute(
                """
                SELECT student_id, attributed_agent_id, attribution_method,
                       settlement_status, source, settlement_notes
                FROM enrollment_records
                """
            )
        }
        assert rows[100]["attributed_agent_id"] == 10
        assert rows[100]["attribution_method"] == "current_agent"
        assert rows[100]["settlement_status"] == "unsettled"
        assert rows[100]["source"] == "admin"

        assert rows[101]["attributed_agent_id"] == 11
        assert rows[101]["attribution_method"] == "manual"
        assert rows[101]["settlement_status"] == "unsettled"

        pending_user = conn.execute(
            "SELECT id, is_active FROM users WHERE username = '__pending_enrollment_attribution__'"
        ).fetchone()
        assert pending_user is not None
        assert pending_user["is_active"] == 0
        assert rows[102]["attributed_agent_id"] == pending_user["id"]
        assert rows[102]["settlement_status"] == "disputed"
        assert rows[102]["settlement_notes"] == "历史已报名自动补录生成"

        assert conn.execute("SELECT COUNT(*) FROM enrollment_records").fetchone()[0] == 3
        assert (
            conn.execute(
                "SELECT COUNT(*) FROM operation_logs WHERE action = '历史报名补录'"
            ).fetchone()[0]
            == 3
        )
    finally:
        conn.close()
