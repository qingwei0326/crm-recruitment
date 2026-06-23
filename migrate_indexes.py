"""为现有数据库添加缺失索引

用法: python migrate_indexes.py
"""
import sqlite3
import os

DB_PATH = os.environ.get("DATABASE_PATH", "crm.db")

INDEXES = [
    ("ix_calls_student_id", "calls", "student_id"),
    ("ix_calls_agent_id", "calls", "agent_id"),
    ("ix_calls_created_at", "calls", "created_at"),
    ("ix_notes_student_id", "notes", "student_id"),
    ("ix_follow_ups_student_id", "follow_ups", "student_id"),
    ("ix_follow_ups_agent_id", "follow_ups", "agent_id"),
    ("ix_visits_student_id", "visits", "student_id"),
    ("ix_visits_agent_id", "visits", "agent_id"),
    ("ix_operation_logs_target_student_id", "operation_logs", "target_student_id"),
    ("ix_operation_logs_action", "operation_logs", "action"),
    ("ix_lead_view_logs_student_id", "lead_view_logs", "student_id"),
]


def migrate():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    # 检查哪些索引已存在
    cursor.execute("SELECT name FROM sqlite_master WHERE type='index'")
    existing = {row[0] for row in cursor.fetchall()}

    created = 0
    skipped = 0

    for idx_name, table, column in INDEXES:
        if idx_name in existing:
            print(f"  跳过 {idx_name} (已存在)")
            skipped += 1
            continue

        try:
            sql = f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table} ({column})"
            cursor.execute(sql)
            print(f"  创建 {idx_name} ON {table}({column})")
            created += 1
        except Exception as e:
            print(f"  失败 {idx_name}: {e}")

    conn.commit()
    conn.close()

    print(f"\n完成: 创建 {created} 个索引, 跳过 {skipped} 个已存在的索引")


if __name__ == "__main__":
    print(f"数据库: {DB_PATH}")
    migrate()
