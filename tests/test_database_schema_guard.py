import pytest
from sqlalchemy import create_engine, text

from app.database import _assert_schema_revision


def test_production_schema_guard_accepts_expected_revision():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('20260726_01')"))
        _assert_schema_revision(connection, "20260726_01")


def test_production_schema_guard_rejects_old_revision_without_creating_tables():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"))
        connection.execute(text("INSERT INTO alembic_version VALUES ('20260714_01')"))
        with pytest.raises(RuntimeError, match="expected=20260726_01"):
            _assert_schema_revision(connection, "20260726_01")
        tables = {
            row[0]
            for row in connection.execute(text("SELECT name FROM sqlite_master WHERE type='table'"))
        }
        assert "personal_groups" not in tables


def test_production_schema_guard_rejects_unstamped_database():
    engine = create_engine("sqlite://")
    with engine.begin() as connection:
        with pytest.raises(RuntimeError, match="缺少 alembic_version"):
            _assert_schema_revision(connection, "20260726_01")
