from sqlalchemy import create_engine, inspect

from app.database import Base, sync_engine
from app.legacy_schema_compat import (
    _migrate_dial_recording_state,
    _migrate_student_phone_normalization,
)
from app.models import Student


def _reset_schema():
    Base.metadata.drop_all(sync_engine)
    Base.metadata.create_all(sync_engine)


def test_student_phone_normalization_migration_cleans_existing_rows():
    _reset_schema()
    with sync_engine.begin() as conn:
        conn.execute(
            Student.__table__.insert().values(
                name="历史号码",
                guardian_phone="+86 139-6011-8706",
                guardian2_phone="189 6010-0618",
            )
        )

    with sync_engine.begin() as conn:
        _migrate_student_phone_normalization(conn)

    with sync_engine.connect() as conn:
        row = conn.exec_driver_sql(
            "SELECT guardian_phone, guardian2_phone FROM students WHERE name = ?",
            ("历史号码",),
        ).one()

    assert row.guardian_phone == "13960118706"
    assert row.guardian2_phone == "18960100618"


def test_dial_recording_state_migration_classifies_existing_rows_and_is_idempotent():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE dial_logs ("
            "id INTEGER PRIMARY KEY, duration_seconds INTEGER DEFAULT 0)"
        )
        conn.exec_driver_sql(
            "INSERT INTO dial_logs (id, duration_seconds) VALUES (1, 0), (2, 45)"
        )

        _migrate_dial_recording_state(conn)
        _migrate_dial_recording_state(conn)

        rows = conn.exec_driver_sql(
            "SELECT id, recording_state FROM dial_logs ORDER BY id"
        ).all()

    db_inspector = inspect(engine)
    assert rows == [(1, "legacy_missing"), (2, "completed")]
    assert "recording_state" in {
        column["name"] for column in db_inspector.get_columns("dial_logs")
    }
    assert "ix_dial_logs_recording_state" in {
        index["name"] for index in db_inspector.get_indexes("dial_logs")
    }
