import os
import sys
from logging.config import fileConfig

from sqlalchemy import engine_from_config, pool

from alembic import context

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import models as _models  # noqa: E402,F401
from app.database import Base  # noqa: E402
from app.migration_config import (  # noqa: E402
    include_schema_object,
    resolve_sync_migration_url,
)

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
migration_url = resolve_sync_migration_url(
    os.getenv("DATABASE_URL", ""),
    os.getenv("DATABASE_PATH", "crm.db"),
)
# Alembic Config uses percent signs for interpolation.
config.set_main_option("sqlalchemy.url", migration_url.replace("%", "%%"))


def run_migrations_offline() -> None:
    context.configure(
        url=migration_url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
        include_object=include_schema_object,
        render_as_batch=migration_url.startswith("sqlite:"),
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            compare_type=True,
            include_object=include_schema_object,
            render_as_batch=migration_url.startswith("sqlite:"),
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
