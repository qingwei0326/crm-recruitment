"""Two concurrent transfers on one batch: the database, not the process lock, decides.

Runs against a real file-backed SQLite database (two independent connections); the
shared in-memory test engine cannot model concurrent writers. Calls execute_transfer
directly, i.e. without the in-process lock the router takes.
"""

import asyncio

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.database import Base
from app.domain_errors import DomainConflict
from app.domain_models import (
    AgentEmployment,
    EmploymentStatus,
    HandoverBatch,
    HandoverBatchStatus,
    HandoverTransfer,
    HandoverTransferMode,
    LeadOutcomeReason,
    StudentAssignment,
)
from app.models import Student, StudentStage, StudentStatus, User, UserRole
from app.services.handover_service import execute_transfer, start_handover
from app.utils import utcnow
from tests.conftest import OUTCOME_ROWS


async def _user(db, name, role):
    user = User(
        username=name,
        hashed_password="x",
        role=role,
        name=name,
        is_active=True,
        is_super_admin=role == UserRole.admin,
    )
    db.add(user)
    await db.flush()
    if role == UserRole.agent:
        db.add(AgentEmployment(user_id=user.id, status=EmploymentStatus.active, updated_by=user.id))
        await db.flush()
    return user


@pytest.mark.asyncio
async def test_concurrent_transfers_one_wins_other_conflicts_cleanly(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'race.db'}")

    @event.listens_for(engine.sync_engine, "connect")
    def _pragmas(dbapi_connection, _record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.close()

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
            await conn.execute(
                LeadOutcomeReason.__table__.insert(),
                [
                    {
                        "code": c,
                        "label": lb,
                        "terminal": t,
                        "reclaimable": r,
                        "active": True,
                        "sort_order": s,
                    }
                    for c, lb, t, r, s in OUTCOME_ROWS
                ],
            )
        async with sessions() as db:
            admin = await _user(db, "adm", UserRole.admin)
            source = await _user(db, "src", UserRole.agent)
            targets = [await _user(db, "t1", UserRole.agent), await _user(db, "t2", UserRole.agent)]
            students = [
                Student(
                    name=f"s{i}",
                    assigned_to=source.id,
                    status=StudentStatus.not_contacted,
                    stage=StudentStage.initial_contact,
                    assigned_at=utcnow(),
                )
                for i in range(4)
            ]
            db.add_all(students)
            await db.flush()
            db.add_all(
                StudentAssignment(
                    student_id=s.id,
                    agent_id=source.id,
                    started_at=utcnow(),
                    start_reason="seed",
                    started_by=source.id,
                )
                for s in students
            )
            await db.flush()
            batch = await start_handover(db, source, admin, "start-1")
            await db.commit()
            batch_id, version, admin_id = batch.id, batch.version, admin.id
            target_ids = [t.id for t in targets]

        async def attempt(key, target_id):
            async with sessions() as db:
                try:
                    operator = await db.get(User, admin_id)
                    result = await execute_transfer(
                        db,
                        batch_id,
                        target_id,
                        HandoverTransferMode.all_remaining,
                        operator,
                        key,
                        version,
                    )
                    await db.commit()
                    return len(result.transferred_ids)
                except DomainConflict as exc:
                    await db.rollback()
                    return exc
                except BaseException:
                    await db.rollback()
                    raise

        results = await asyncio.gather(attempt("k1", target_ids[0]), attempt("k2", target_ids[1]))

        winners = [r for r in results if r == 4]
        losers = [r for r in results if isinstance(r, DomainConflict)]
        assert (len(winners), len(losers)) == (1, 1), results

        async with sessions() as db:
            transfers = (await db.execute(select(HandoverTransfer))).scalars().all()
            assert len(transfers) == 1 and transfers[0].status.value == "completed"
            owners = (
                await db.execute(
                    select(Student.assigned_to, func.count()).group_by(Student.assigned_to)
                )
            ).all()
            assert len(owners) == 1 and owners[0][1] == 4
            final = await db.get(HandoverBatch, batch_id)
            assert final.status == HandoverBatchStatus.completed
            assert final.version == version + 1
    finally:
        await engine.dispose()
