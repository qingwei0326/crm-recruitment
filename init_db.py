"""数据库初始化脚本 — 建表 + 预置账号 + 迁移"""
import asyncio
from sqlalchemy import select, text, inspect
from app.database import async_session, init_db, sync_engine, Base
from app.models import User, UserRole
from app.auth import hash_password

PRESET_USERS = [
    {"username": "admin", "password": "admin123", "role": UserRole.admin, "name": "系统管理员"},
    {"username": "test01", "password": "test123", "role": UserRole.agent, "name": "测试坐席"},
]


async def seed():
    await init_db()
    print("[OK] 数据库表创建完成")

    with sync_engine.connect() as conn:
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
            except Exception as e:
                print(f"[WARN] 表重命名失败: {e}")

        # 2. Add new columns
        migrations = [
            ("users", "failed_login_attempts", "INTEGER NOT NULL DEFAULT 0"),
            ("users", "locked_until", "TIMESTAMP"),
            ("users", "service_regions", "VARCHAR(512) NOT NULL DEFAULT ''"),
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
            ("school_name", "VARCHAR(128) NOT NULL DEFAULT ''"),
            ("school_address", "VARCHAR(256) NOT NULL DEFAULT ''"),
            ("case_no", "VARCHAR(36)"),
            ("need_help", "BOOLEAN NOT NULL DEFAULT 0"),
        ]
        # Generate case_no for existing rows without one
        import uuid
        for row in conn.execute(text(f"SELECT id FROM {students_table} WHERE case_no IS NULL")).fetchall():
            conn.execute(text(f"UPDATE {students_table} SET case_no = :cn WHERE id = :id"),
                         {"cn": str(uuid.uuid4()), "id": row[0]})
        conn.commit()
        for col, dtype in student_migrations:
            migrations.append((students_table, col, dtype))

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
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {dtype}"))
                    conn.commit()
                    print(f"[MIG] {table}.{col} 添加成功")
            except Exception as e:
                print(f"[SKIP] {table}.{col}: {e}")

    async with async_session() as session:
        for u in PRESET_USERS:
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
            print(f"[OK] 预置账号完成 ({u['username']} / {u['password']})")


if __name__ == "__main__":
    asyncio.run(seed())
