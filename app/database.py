from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import DATABASE_URL, DATABASE_URL_SYNC

engine = create_async_engine(DATABASE_URL, echo=False)
async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
sync_engine = create_engine(DATABASE_URL_SYNC, echo=False)


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
        await conn.run_sync(_migrate_operation_log_nullable)


def _migrate_user_token_version(sync_connection):
    inspector = inspect(sync_connection)
    if "users" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("users")}
    if "token_version" not in columns:
        sync_connection.execute(
            text("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 1")
        )


def _migrate_user_device_tracking(sync_connection):
    inspector = inspect(sync_connection)
    if "users" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("users")}
    if "last_login_device" not in columns:
        sync_connection.execute(
            text("ALTER TABLE users ADD COLUMN last_login_device VARCHAR(512) DEFAULT '' NOT NULL")
        )
    if "last_login_ip" not in columns:
        sync_connection.execute(
            text("ALTER TABLE users ADD COLUMN last_login_ip VARCHAR(64) DEFAULT '' NOT NULL")
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

    # SQLite 不支持 ALTER COLUMN，需要重建表
    sync_connection.execute(text("""
        CREATE TABLE operation_logs_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            operator_id INTEGER,
            operator_name VARCHAR(64) NOT NULL,
            target_student_id INTEGER,
            case_no VARCHAR(36) DEFAULT '',
            action VARCHAR(64) NOT NULL,
            details TEXT DEFAULT '',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (operator_id) REFERENCES users(id)
        )
    """))

    sync_connection.execute(text(
        "INSERT INTO operation_logs_new SELECT * FROM operation_logs"
    ))

    sync_connection.execute(text("DROP TABLE operation_logs"))
    sync_connection.execute(text("ALTER TABLE operation_logs_new RENAME TO operation_logs"))

    # 重建索引
    sync_connection.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_operation_logs_created_at ON operation_logs(created_at)"
    ))
    sync_connection.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_operation_logs_target_student_id ON operation_logs(target_student_id)"
    ))


def _ensure_student_indexes(sync_connection):
    sync_connection.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_students_region ON students(region)"
    ))
    sync_connection.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_students_school_name ON students(school_name)"
    ))


def _migrate_follow_up_columns(sync_connection):
    inspector = inspect(sync_connection)
    if "follow_ups" not in inspector.get_table_names():
        return
    columns = {col["name"] for col in inspector.get_columns("follow_ups")}
    if "follow_up_type" not in columns:
        sync_connection.execute(text("ALTER TABLE follow_ups ADD COLUMN follow_up_type VARCHAR(16)"))
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
    for index in inspector.get_indexes("students"):
        if "phone" in index.get("column_names", []):
            index_name = index["name"].replace('"', '""')
            sync_connection.execute(text(f'DROP INDEX IF EXISTS "{index_name}"'))
    sync_connection.execute(text("ALTER TABLE students DROP COLUMN phone"))


def _drop_message_templates_table(sync_connection):
    inspector = inspect(sync_connection)
    if "message_templates" in inspector.get_table_names():
        sync_connection.execute(text("DROP TABLE message_templates"))

