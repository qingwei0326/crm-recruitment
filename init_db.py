"""数据库初始化脚本 — 建表 + 预置账号 + 迁移"""
import asyncio
import os

from sqlalchemy import inspect, select, text

from app.auth import hash_password
from app.config import DB_ENGINE
from app.database import async_session, init_db, sync_engine
from app.models import User, UserRole


def get_preset_users():
    users = []
    admin_password = os.getenv("INIT_ADMIN_PASSWORD")
    if admin_password:
        users.append(
            {
                "username": os.getenv("INIT_ADMIN_USERNAME", "admin"),
                "password": admin_password,
                "role": UserRole.admin,
                "name": os.getenv("INIT_ADMIN_NAME", "系统管理员"),
            }
        )

    agent_password = os.getenv("INIT_AGENT_PASSWORD")
    if agent_password:
        users.append(
            {
                "username": os.getenv("INIT_AGENT_USERNAME", "agent"),
                "password": agent_password,
                "role": UserRole.agent,
                "name": os.getenv("INIT_AGENT_NAME", "话务员"),
            }
        )
    return users


async def seed():
    await init_db()
    print("[OK] 数据库表创建完成")

    with sync_engine.connect() as conn:
        if DB_ENGINE == "postgresql":
            # PostgreSQL 使用 ON CONFLICT DO NOTHING
            conn.execute(
                text("INSERT INTO system_configs (key, value) VALUES ('pushplus_token', '') ON CONFLICT (key) DO NOTHING")
            )
            conn.execute(
                text("INSERT INTO system_configs (key, value) VALUES ('stale_days', '3') ON CONFLICT (key) DO NOTHING")
            )
            conn.execute(
                text("INSERT INTO system_configs (key, value) VALUES ('dial_window_start', '08:00') ON CONFLICT (key) DO NOTHING")
            )
            conn.execute(
                text("INSERT INTO system_configs (key, value) VALUES ('dial_window_end', '21:00') ON CONFLICT (key) DO NOTHING")
            )
            conn.execute(
                text("INSERT INTO system_configs (key, value) VALUES ('dial_max_per_24h', '3') ON CONFLICT (key) DO NOTHING")
            )
            conn.execute(
                text("INSERT INTO system_configs (key, value) VALUES ('deepseek_api_key', '') ON CONFLICT (key) DO NOTHING")
            )
        else:
            # SQLite 使用 INSERT OR IGNORE
            conn.execute(
                text("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('pushplus_token', '')")
            )
            conn.execute(
                text("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('stale_days', '3')")
            )
            conn.execute(
                text("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('dial_window_start', '08:00')")
            )
            conn.execute(
                text("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('dial_window_end', '21:00')")
            )
            conn.execute(
                text("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('dial_max_per_24h', '3')")
            )
            conn.execute(
                text("INSERT OR IGNORE INTO system_configs (key, value) VALUES ('deepseek_api_key', '')")
            )
        conn.commit()

        insp = inspect(sync_engine)

        # 1. Rename leads → students if old table exists
        existing_tables = insp.get_table_names()
        if "leads" in existing_tables and "students" not in existing_tables:
            # Rename FK columns in child tables first
            fk_migrations = [
                ("calls", "lead_id", "student_id", "INTEGER"),
                ("notes", "lead_id", "student_id", "INTEGER"),
                ("follow_ups", "lead_id", "student_id", "INTEGER"),
                ("lead_view_logs", "lead_id", "student_id", "INTEGER"),
            ]
            for t, old, new, dtype in fk_migrations:
                try:
                    cols = [c["name"] for c in insp.get_columns(t)]
                    if old in cols and new not in cols:
                        conn.execute(text(f"ALTER TABLE {t} RENAME COLUMN {old} TO {new}"))
                        conn.commit()
                        print(f"[MIG] {t}.{old} → {new}")
                except Exception as e:
                    print(f"[WARN] {t}.{old} rename failed: {e}")

            try:
                conn.execute(text("ALTER TABLE leads RENAME TO students"))
                conn.commit()
                print("[MIG] leads → students 表重命名成功")
                existing_tables = insp.get_table_names()
            except Exception as e:
                print(f"[WARN] 表重命名失败: {e}")

        # 2. Add new columns
        migrations = [
            ("users", "failed_login_attempts", "INTEGER NOT NULL DEFAULT 0"),
            ("users", "locked_until", "TIMESTAMP"),
            ("users", "service_regions", "VARCHAR(512) NOT NULL DEFAULT ''"),
            ("users", "pushplus_token", "VARCHAR(64) NOT NULL DEFAULT ''"),
            ("notes", "source", "VARCHAR(16) NOT NULL DEFAULT 'human'"),
            ("notes", "updated_at", "TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"),
        ]
        students_table = "students" if "students" in existing_tables else "leads"
        student_migrations = [
            ("region", "VARCHAR(64) NOT NULL DEFAULT ''"),
            ("stage", "VARCHAR(32) NOT NULL DEFAULT '初次联系'"),
            ("enrolled_at", "DATE"),
            ("program", "VARCHAR(128) NOT NULL DEFAULT ''"),
            ("deposit", "FLOAT"),
            ("expired_at", "DATE"),
            ("score", "FLOAT"),
            ("guardian_name", "VARCHAR(64) NOT NULL DEFAULT ''"),
            ("guardian_phone", "VARCHAR(20) NOT NULL DEFAULT ''"),
            ("guardian2_name", "VARCHAR(64) NOT NULL DEFAULT ''"),
            ("guardian2_phone", "VARCHAR(20) NOT NULL DEFAULT ''"),
            ("school_name", "VARCHAR(128) NOT NULL DEFAULT ''"),
            ("school_address", "VARCHAR(256) NOT NULL DEFAULT ''"),
            ("case_no", "VARCHAR(36)"),
            ("need_help", "BOOLEAN NOT NULL DEFAULT 0"),
            ("enrollment_substage", "VARCHAR(32)"),
        ]
        # Generate case_no for existing rows without one
        import uuid

        rows_without_case_no = conn.execute(
            text(f"SELECT id FROM {students_table} WHERE case_no IS NULL")
        ).fetchall()
        for row in rows_without_case_no:
            conn.execute(
                text(f"UPDATE {students_table} SET case_no = :cn WHERE id = :id"),
                {"cn": str(uuid.uuid4()), "id": row[0]},
            )
        conn.commit()
        for col, dtype in student_migrations:
            migrations.append((students_table, col, dtype))

        try:
            cols = [c["name"] for c in insp.get_columns(students_table)]
            if "phone" in cols:
                if DB_ENGINE == "postgresql":
                    # PostgreSQL 直接 DROP COLUMN，CASCADE 自动删除依赖索引
                    conn.execute(text(f"ALTER TABLE {students_table} DROP COLUMN IF EXISTS phone CASCADE"))
                else:
                    # SQLite 需要先手动删除索引
                    for index in insp.get_indexes(students_table):
                        if "phone" in index.get("column_names", []):
                            index_name = index["name"].replace('"', '""')
                            conn.execute(text(f'DROP INDEX IF EXISTS "{index_name}"'))
                    conn.execute(text(f"ALTER TABLE {students_table} DROP COLUMN phone"))
                conn.commit()
                print(f"[MIG] {students_table}.phone 已删除")
        except Exception as e:
            print(f"[WARN] {students_table}.phone drop failed: {e}")

        # Also handle visits table if it has lead_id
        if "visits" in insp.get_table_names():
            cols = [c["name"] for c in insp.get_columns("visits")]
            if "lead_id" in cols and "student_id" not in cols:
                try:
                    conn.execute(text("ALTER TABLE visits RENAME COLUMN lead_id TO student_id"))
                    conn.commit()
                    print("[MIG] visits.lead_id → student_id")
                except Exception:
                    pass

        for table, col, dtype in migrations:
            try:
                cols = [c["name"] for c in insp.get_columns(table)]
                if col not in cols:
                    if DB_ENGINE == "postgresql":
                        # PostgreSQL 支持 IF NOT EXISTS
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN IF NOT EXISTS {col} {dtype}"))
                    else:
                        conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {dtype}"))
                    conn.commit()
                    print(f"[MIG] {table}.{col} 添加成功")
            except Exception as e:
                print(f"[SKIP] {table}.{col}: {e}")

        # 3. operation_logs.operator_id: NOT NULL → NULL
        # 旧 schema NOT NULL 会让"删用户"在 SQLAlchemy set null 时 IntegrityError
        # operator_name 已同步存储，仍可作为审计追溯
        try:
            if "operation_logs" in insp.get_table_names():
                op_cols = insp.get_columns("operation_logs")
                op_id = next((c for c in op_cols if c["name"] == "operator_id"), None)
                if op_id and not op_id.get("nullable", True):
                    if DB_ENGINE == "postgresql":
                        # PostgreSQL 直接 ALTER COLUMN
                        print("[MIG] operation_logs.operator_id ALTER COLUMN DROP NOT NULL...")
                        conn.execute(text("ALTER TABLE operation_logs ALTER COLUMN operator_id DROP NOT NULL"))
                        conn.commit()
                        print("[MIG] operation_logs.operator_id 修改完成")
                    else:
                        # SQLite 需重建表
                        print("[MIG] operation_logs.operator_id 重建为 nullable...")
                        conn.execute(text("PRAGMA foreign_keys=OFF"))
                        conn.execute(text("""
                            CREATE TABLE operation_logs_new (
                                id INTEGER PRIMARY KEY AUTOINCREMENT,
                                operator_id INTEGER REFERENCES users(id),
                                operator_name VARCHAR(64) NOT NULL,
                                target_student_id INTEGER,
                                case_no VARCHAR(36) DEFAULT '',
                                action VARCHAR(32) NOT NULL,
                                content TEXT DEFAULT '',
                                old_status VARCHAR(32) DEFAULT '',
                                new_status VARCHAR(32) DEFAULT '',
                                note_content TEXT DEFAULT '',
                                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                            )
                        """))
                        conn.execute(text("""
                            INSERT INTO operation_logs_new
                            (id, operator_id, operator_name, target_student_id, case_no, action,
                             content, old_status, new_status, note_content, created_at)
                            SELECT id, operator_id, operator_name, target_student_id, case_no, action,
                                   content, old_status, new_status, note_content, created_at
                            FROM operation_logs
                        """))
                        conn.execute(text("DROP TABLE operation_logs"))
                        conn.execute(text("ALTER TABLE operation_logs_new RENAME TO operation_logs"))
                        conn.execute(text("PRAGMA foreign_keys=ON"))
                        conn.commit()
                        print("[MIG] operation_logs.operator_id 重建完成")
        except Exception as e:
            print(f"[WARN] operation_logs.operator_id 迁移失败: {e}")

    async with async_session() as session:
        if os.getenv("SEED_PRESET_USERS", "0").lower() not in {"1", "true", "yes", "on"}:
            print("[SKIP] 未启用预置账号初始化。如需本地测试，设置 SEED_PRESET_USERS=1")
            return

        preset_users = get_preset_users()
        if not preset_users:
            print("[SKIP] 未配置 INIT_ADMIN_PASSWORD，跳过预置账号创建")
            return

        for u in preset_users:
            result = await session.execute(
                select(User).where(User.username == u["username"])
            )
            if result.scalar_one_or_none():
                print(f"[SKIP] {u['username']} 已存在，跳过")
                continue

            user = User(
                username=u["username"],
                hashed_password=hash_password(u["password"]),
                role=u["role"],
                name=u["name"],
                is_active=True,
            )
            session.add(user)
            await session.commit()
            print(f"[OK] 预置账号完成 ({u['username']})")


if __name__ == "__main__":
    asyncio.run(seed())
