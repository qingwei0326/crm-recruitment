import os

from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import (
    DATABASE_URL,
    DATABASE_URL_SYNC,
    EXPECTED_ALEMBIC_REVISION,
)

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
    # 自愈：启动时先把数据库迁移到 head，再校验版本等于预期。
    # 这样落后的库（实测本地 20260726_01 vs 预期 head 20260925_01）会在启动时被自动升级，
    # 而不是「拒绝启动」或「静默错列」导致报名/财务等接口 500。
    _run_alembic_upgrade_head()
    async with engine.begin() as conn:
        await conn.run_sync(_assert_schema_revision, EXPECTED_ALEMBIC_REVISION)


def _run_alembic_upgrade_head() -> None:
    """在启动时将数据库迁移到最新版本（head）。

    alembic 仅在部署/运行环境可用，故在此惰性导入，避免影响单元测试环境
    （测试用 create_all，不调用 init_db）。
    """
    from alembic.config import Config

    from alembic import command

    config_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "alembic.ini"
    )
    cfg = Config(config_path)
    # 复用当前进程的数据库环境变量（DATABASE_URL / DATABASE_PATH），env.py 据此解析同步迁移 URL。
    command.upgrade(cfg, "head")


def _assert_schema_revision(sync_connection, expected_revision: str) -> None:
    inspector = inspect(sync_connection)
    if "alembic_version" not in inspector.get_table_names():
        raise RuntimeError("生产数据库缺少 alembic_version，拒绝自动建表")
    actual_revision = sync_connection.execute(
        text("SELECT version_num FROM alembic_version")
    ).scalar_one_or_none()
    if actual_revision != expected_revision:
        raise RuntimeError(
            f"生产数据库版本不匹配：expected={expected_revision}, actual={actual_revision}"
        )
