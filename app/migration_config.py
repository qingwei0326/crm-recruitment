from pathlib import Path

FROZEN_LEGACY_TABLES = frozenset(
    {"agents", "follow_up_assignments", "tasks", "today_tasks"}
)


def include_schema_object(
    _object: object,
    name: str | None,
    object_type: str,
    reflected: bool,
    compare_to: object,
) -> bool:
    return not (
        object_type == "table"
        and reflected
        and compare_to is None
        and name in FROZEN_LEGACY_TABLES
    )


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
