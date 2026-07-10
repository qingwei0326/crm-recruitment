from pathlib import Path

from app.migration_config import resolve_sync_migration_url


def test_resolve_sync_migration_url_uses_absolute_sqlite_path(tmp_path):
    db_path = tmp_path / "migration.db"

    result = resolve_sync_migration_url(database_path=str(db_path))

    assert result == f"sqlite:///{db_path.resolve().as_posix()}"


def test_resolve_sync_migration_url_converts_async_drivers():
    assert (
        resolve_sync_migration_url("sqlite+aiosqlite:///D:/crm.db")
        == "sqlite:///D:/crm.db"
    )
    assert (
        resolve_sync_migration_url("postgresql+asyncpg://u:p@db/crm")
        == "postgresql+psycopg2://u:p@db/crm"
    )


def test_resolve_sync_migration_url_keeps_percent_characters_literal():
    url = resolve_sync_migration_url(database_path="data/百分比.db")

    assert Path(url.removeprefix("sqlite:///")).is_absolute()
    assert "百分比.db" in url
