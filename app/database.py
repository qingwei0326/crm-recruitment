from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import DATABASE_URL, DATABASE_URL_SYNC, DB_ENGINE

_sqlite_args = {"timeout": 15} if DATABASE_URL.startswith("sqlite") else {}
engine = create_async_engine(DATABASE_URL, echo=False, connect_args=_sqlite_args)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
sync_engine = create_engine(DATABASE_URL_SYNC, echo=False, connect_args=_sqlite_args)


def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    # WAL：并发读写期间避免 "database is locked"。备份/回访/过期三个后台任务并发写入，必需。
    cursor.execute("PRAGMA journal_mode=WAL")
    # NORMAL 比 FULL 快很多，WAL 模式下崩溃后仍能保证最近 commit 的数据不丢。
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.close()


if DATABASE_URL.startswith("sqlite"):
    event.listen(engine.sync_engine, "connect", _enable_sqlite_foreign_keys)
    event.listen(sync_engine, "connect", _enable_sqlite_foreign_keys)


class Base(DeclarativeBase):
    pass


async def get_db():
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()


async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        await conn.run_sync(_drop_legacy_student_phone_column)
        await conn.run_sync(_migrate_follow_up_columns)
        await conn.run_sync(_drop_message_templates_table)
        await conn.run_sync(_ensure_student_indexes)
        await conn.run_sync(_migrate_user_token_version)
        await conn.run_sync(_migrate_user_device_tracking)
        await conn.run_sync(_migrate_user_must_change_password)
        await conn.run_sync(_migrate_operation_log_nullable)
        await conn.run_sync(_migrate_student_status_detail)
        await conn.run_sync(_migrate_legacy_student_status_values)


def _migrate_user_token_version(sync_connection):
    inspector = inspect(sync_connection)
    if "users" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("users")}
    if "token_version" not in columns:
        if DB_ENGINE == "postgresql":
            sync_connection.execute(
                text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version "
                    "INTEGER NOT NULL DEFAULT 1"
                )
            )
        else:
            sync_connection.execute(
                text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1")
            )


def _migrate_user_device_tracking(sync_connection):
    inspector = inspect(sync_connection)
    if "users" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("users")}
    if "last_login_device" not in columns:
        if DB_ENGINE == "postgresql":
            sync_connection.execute(
                text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_device "
                    "VARCHAR(512) DEFAULT '' NOT NULL"
                )
            )
        else:
            sync_connection.execute(
                text(
                    "ALTER TABLE users ADD COLUMN last_login_device "
                    "VARCHAR(512) DEFAULT '' NOT NULL"
                )
            )
    if "last_login_ip" not in columns:
        if DB_ENGINE == "postgresql":
            sync_connection.execute(
                text(
                    "ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_ip "
                    "VARCHAR(64) DEFAULT '' NOT NULL"
                )
            )
        else:
            sync_connection.execute(
                text("ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(64) DEFAULT '' NOT NULL")
            )


def _migrate_user_must_change_password(sync_connection):
    inspector = inspect(sync_connection)
    if "users" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("users")}
    if "must_change_password" in columns:
        return
    if DB_ENGINE == "postgresql":
        sync_connection.execute(
            text(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password "
                "BOOLEAN NOT NULL DEFAULT FALSE"
            )
        )
    else:
        sync_connection.execute(
            text(
                "ALTER TABLE users ADD COLUMN must_change_password "
                "BOOLEAN NOT NULL DEFAULT 0"
            )
        )


def _migrate_operation_log_nullable(sync_connection):
    """将 operation_logs.operator_id 改为 nullable（删除学生时系统操作无 operator）"""
    inspector = inspect(sync_connection)
    if "operation_logs" not in inspector.get_table_names():
        return

    # 检查 operator_id 是否已经是 nullable
    columns = inspector.get_columns("operation_logs")
    operator_id_col = next((c for c in columns if c["name"] == "operator_id"), None)
    if not operator_id_col or operator_id_col.get("nullable", False):
        return  # 已经是 nullable 或字段不存在

    if DB_ENGINE == "postgresql":
        # PostgreSQL 直接 ALTER COLUMN
        sync_connection.execute(
            text("ALTER TABLE operation_logs ALTER COLUMN operator_id DROP NOT NULL")
        )
    else:
        # SQLite 不支持 ALTER COLUMN，需要重建表
        # 动态获取当前列，只修改 operator_id 为 nullable
        col_names = [c["name"] for c in columns]
        col_defs = []
        for c in columns:
            if c["name"] == "operator_id":
                col_defs.append("operator_id INTEGER")
            else:
                # 保留原始定义
                col_type = str(c["type"])
                nullable = "NOT NULL" if not c.get("nullable", True) else ""
                default = ""
                if c.get("default") is not None:
                    default_val = str(c["default"])
                    if "CURRENT_TIMESTAMP" in default_val:
                        default = "DEFAULT CURRENT_TIMESTAMP"
                    elif "nextval" in default_val:
                        default = ""  # SERIAL handled by AUTOINCREMENT
                    else:
                        default = f"DEFAULT {default_val}"
                pk = " PRIMARY KEY AUTOINCREMENT" if c.get("primary_key") else ""
                col_defs.append(f"    {c['name']} {col_type}{pk} {nullable} {default}".strip())

        create_sql = "CREATE TABLE operation_logs_new (\n" + ",\n".join(col_defs) + "\n)"
        sync_connection.execute(text(create_sql))

        cols_str = ", ".join(col_names)
        sync_connection.execute(
            text(
                f"INSERT INTO operation_logs_new ({cols_str}) SELECT {cols_str} FROM operation_logs"
            )
        )

        sync_connection.execute(text("DROP TABLE operation_logs"))
        sync_connection.execute(text("ALTER TABLE operation_logs_new RENAME TO operation_logs"))

        # 重建索引
        sync_connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_operation_logs_created_at "
                "ON operation_logs(created_at)"
            )
        )
        sync_connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_operation_logs_target_student_id "
                "ON operation_logs(target_student_id)"
            )
        )


def _migrate_legacy_student_status_values(sync_connection):
    inspector = inspect(sync_connection)
    if "students" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("students")}
    if "status" not in columns:
        return

    if "status_detail" in columns:
        detail_map = {
            "非常有意向": "非常有意向",
            "very_interested": "非常有意向",
            "意向了解加微": "意向了解加微",
            "interested_add_wechat": "意向了解加微",
            "高分段": "高分段",
            "high_score": "高分段",
            "无意向": "无意向",
            "not_interested": "无意向",
            "no_intent": "无意向",
            "孩子不想读": "孩子不想读",
            "child_not_want_study": "孩子不想读",
            "child_not_interested": "孩子不想读",
            "空号": "空号",
            "其他": "其他",
        }
        for old, detail in detail_map.items():
            sync_connection.execute(
                text(
                    "UPDATE students SET status_detail = :detail "
                    "WHERE status = :old AND (status_detail IS NULL OR status_detail = '')"
                ),
                {"old": old, "detail": detail},
            )

    legacy_map = {
        "新线索": "new_lead",
        "未联系": "not_contacted",
        "已联系": "contacted",
        "待回访": "pending_visit",
        "已完成": "completed",
        "无效": "invalid",
        "已报名": "enrolled",
        "拒绝接听": "rejected",
        "已过期": "expired",
        "非常有意向": "very_interested",
        "意向了解加微": "interested_add_wechat",
        "未接": "not_reached",
        "高分段": "high_score",
        "无意向": "not_interested",
        "孩子不想读": "child_not_want_study",
        "空号": "invalid",
        "其他": "invalid",
        "unassigned": "not_contacted",
        "no_intent": "not_interested",
        "child_not_interested": "child_not_want_study",
    }
    for old, new in legacy_map.items():
        sync_connection.execute(
            text("UPDATE students SET status = :new WHERE status = :old"),
            {"old": old, "new": new},
        )


def _migrate_student_status_detail(sync_connection):
    inspector = inspect(sync_connection)
    if "students" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("students")}
    if "status_detail" in columns:
        return
    if DB_ENGINE == "postgresql":
        sync_connection.execute(
            text(
                "ALTER TABLE students ADD COLUMN IF NOT EXISTS status_detail "
                "VARCHAR(64) NOT NULL DEFAULT ''"
            )
        )
    else:
        sync_connection.execute(
            text("ALTER TABLE students ADD COLUMN status_detail VARCHAR(64) NOT NULL DEFAULT ''")
        )


def _ensure_student_indexes(sync_connection):
    # CREATE INDEX IF NOT EXISTS 在 SQLite 和 PostgreSQL 中都支持
    sync_connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_students_region ON students(region)")
    )
    sync_connection.execute(
        text("CREATE INDEX IF NOT EXISTS ix_students_school_name ON students(school_name)")
    )


def _migrate_follow_up_columns(sync_connection):
    inspector = inspect(sync_connection)
    if "follow_ups" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("follow_ups")}

    if DB_ENGINE == "postgresql":
        # PostgreSQL 支持 IF NOT EXISTS
        if "follow_up_type" not in columns:
            sync_connection.execute(
                text("ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS follow_up_type VARCHAR(16)")
            )
        if "notes" not in columns:
            sync_connection.execute(
                text("ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT ''")
            )
        if "is_completed" not in columns:
            sync_connection.execute(
                text(
                    "ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS is_completed "
                    "BOOLEAN NOT NULL DEFAULT FALSE"
                )
            )
    else:
        if "follow_up_type" not in columns:
            sync_connection.execute(
                text("ALTER TABLE follow_ups ADD COLUMN follow_up_type VARCHAR(16)")
            )
        if "notes" not in columns:
            sync_connection.execute(text("ALTER TABLE follow_ups ADD COLUMN notes TEXT DEFAULT ''"))
        if "is_completed" not in columns:
            sync_connection.execute(
                text("ALTER TABLE follow_ups ADD COLUMN is_completed BOOLEAN NOT NULL DEFAULT 0")
            )


def _drop_legacy_student_phone_column(sync_connection):
    inspector = inspect(sync_connection)
    if "students" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("students")}
    if "phone" not in columns:
        return

    if DB_ENGINE == "postgresql":
        # PostgreSQL 直接 DROP COLUMN，CASCADE 自动删除依赖索引
        sync_connection.execute(text("ALTER TABLE students DROP COLUMN IF EXISTS phone CASCADE"))
    else:
        # SQLite 需要先手动删除索引
        for index in inspector.get_indexes("students"):
            if "phone" in index.get("column_names", []):
                index_name = index["name"].replace('"', '""')
                sync_connection.execute(text(f'DROP INDEX IF EXISTS "{index_name}"'))
        sync_connection.execute(text("ALTER TABLE students DROP COLUMN phone"))


def _drop_message_templates_table(sync_connection):
    inspector = inspect(sync_connection)
    if "message_templates" in inspector.get_table_names():
        if DB_ENGINE == "postgresql":
            sync_connection.execute(text("DROP TABLE IF EXISTS message_templates CASCADE"))
        else:
            sync_connection.execute(text("DROP TABLE message_templates"))
