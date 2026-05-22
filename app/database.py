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

