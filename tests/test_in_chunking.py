"""Id lists keyed by students are queried in chunks (SQLite caps bound variables)."""

import sqlite3

import pytest
from sqlalchemy import func, select

import app.db_utils as db_utils
from app.db_utils import chunked, rowcount_in_chunks, scalars_in_chunks
from app.domain_models import StudentAssignment, WorkItem
from app.models import Student, StudentStatus
from app.services.assignment_service import AssignmentTarget, apply_assignment_changes
from app.services.work_item_service import sync_students_work_items


def test_chunked_splits_without_losing_or_reordering():
    assert list(chunked([1, 2, 3, 4, 5], 2)) == [[1, 2], [3, 4], [5]]
    assert list(chunked([], 2)) == []
    assert list(chunked([1, 2], 10)) == [[1, 2]]


def test_chunk_size_is_read_at_call_time(monkeypatch):
    monkeypatch.setattr(db_utils, "IN_CHUNK_SIZE", 3)
    assert [len(c) for c in chunked(list(range(7)))] == [3, 3, 1]


@pytest.mark.asyncio
async def test_helpers_cover_every_chunk(db, monkeypatch):
    monkeypatch.setattr(db_utils, "IN_CHUNK_SIZE", 2)
    students = [Student(name=f"s{i}", status=StudentStatus.not_contacted) for i in range(7)]
    db.add_all(students)
    await db.flush()
    ids = [s.id for s in students]

    found = await scalars_in_chunks(db, lambda c: select(Student).where(Student.id.in_(c)), ids)
    assert sorted(s.id for s in found) == ids
    assert (
        await rowcount_in_chunks(
            db,
            lambda c: Student.__table__.update().where(Student.id.in_(c)).values(need_help=True),
            ids,
        )
        == 7
    )


@pytest.fixture
async def low_sqlite_variable_limit(db):
    """Emulate an old SQLite build: at most 50 bound variables per statement."""
    connection = await db.connection()
    driver = (await connection.get_raw_connection()).driver_connection
    raw = driver._conn  # sqlite3 connection; only usable from aiosqlite's worker thread
    previous = await driver._execute(raw.getlimit, sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER)
    await driver._execute(raw.setlimit, sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 50)
    yield 50
    await driver._execute(raw.setlimit, sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, previous)


@pytest.mark.asyncio
async def test_assignment_and_work_items_work_across_chunks(
    db, admin_user, agent_user, assignment_baseline, monkeypatch, low_sqlite_variable_limit
):
    monkeypatch.setattr(db_utils, "IN_CHUNK_SIZE", 20)
    total = 120  # more students than the emulated per-statement variable limit
    students = [
        Student(name=f"s{i}", status=StudentStatus.not_contacted, guardian_phone=f"138{i:08d}")
        for i in range(total)
    ]
    db.add_all(students)
    await db.flush()
    for student in students:
        await assignment_baseline(student, agent_user)
    await sync_students_work_items(db, students, admin_user)

    await apply_assignment_changes(
        db,
        [AssignmentTarget(student_id=s.id, agent_id=None) for s in students],
        operator=admin_user,
        reason="test_release",
        batch_id="chunk-test",
    )
    await db.commit()

    async def count(model, *conditions):
        return (
            await db.execute(select(func.count()).select_from(model).where(*conditions))
        ).scalar_one()

    assert await count(Student, Student.assigned_to.is_not(None)) == 0
    assert await count(StudentAssignment, StudentAssignment.ended_at.is_(None)) == 0
    assert await count(WorkItem, WorkItem.owner_agent_id == agent_user.id) == 0
