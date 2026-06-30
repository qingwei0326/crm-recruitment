from sqlalchemy import inspect

from app.database import (
    Base,
    _ensure_student_indexes,
    _migrate_student_phone_normalization,
    sync_engine,
)
from app.models import Student


def _reset_schema():
    Base.metadata.drop_all(sync_engine)
    Base.metadata.create_all(sync_engine)


def test_ensure_student_indexes_adds_guardian2_phone_index():
    _reset_schema()
    with sync_engine.begin() as conn:
        conn.exec_driver_sql("DROP INDEX IF EXISTS ix_students_guardian2_phone")

    with sync_engine.begin() as conn:
        _ensure_student_indexes(conn)

    inspector = inspect(sync_engine)
    index_names = {index["name"] for index in inspector.get_indexes("students")}
    assert "ix_students_guardian2_phone" in index_names


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
