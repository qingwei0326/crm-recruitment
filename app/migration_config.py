from pathlib import Path


def resolve_sync_migration_url(
    database_url: str = "",
    database_path: str = "crm.db",
) -> str:
    if database_url:
        return (
            database_url.replace("sqlite+aiosqlite://", "sqlite://", 1)
            .replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
        )

    path = Path(database_path).expanduser().resolve()
    return f"sqlite:///{path.as_posix()}"
