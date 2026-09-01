"""Preview or repair source work-item owners after ordinary reassignment."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sqlite3
import sys
from collections import Counter
from pathlib import Path

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import aliased
from sqlalchemy.pool import NullPool

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("SECRET_KEY", "work-item-owner-repair-only")

from app.domain_consistency import audit_domain_consistency  # noqa: E402
from app.domain_models import (  # noqa: E402
    AgentEmployment,
    EmploymentStatus,
    WorkItem,
    WorkItemKind,
    WorkItemStatus,
)
from app.models import Student, StudentStatus  # noqa: E402
from app.status_policy import canonical_student_status  # noqa: E402
from app.utils import utcnow  # noqa: E402

EXPECTED_STATUS = {
    EmploymentStatus.active: WorkItemStatus.open,
    EmploymentStatus.suspended: WorkItemStatus.blocked_suspension,
    EmploymentStatus.handover_pending: WorkItemStatus.blocked_handover,
}
ACTIVE_WORK_STATUSES = tuple(EXPECTED_STATUS.values())
TERMINAL_STUDENT_STATUSES = {
    canonical_student_status(StudentStatus.enrolled),
    canonical_student_status(StudentStatus.invalid),
}


class RepairError(RuntimeError):
    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


def read_revision(database: Path) -> str | None:
    uri = f"file:{database.as_posix()}?mode=ro"
    with sqlite3.connect(uri, uri=True) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "select name from sqlite_master where type = 'table'"
            )
        }
        if "alembic_version" not in tables:
            return None
        rows = connection.execute(
            "select version_num from alembic_version order by version_num"
        ).fetchall()
    return str(rows[0][0]) if len(rows) == 1 else None


async def collect_owner_changes(
    db: AsyncSession,
) -> tuple[list[tuple[WorkItem, Student, int, WorkItemStatus]], dict[str, int]]:
    employment = aliased(AgentEmployment)
    desired_owner = func.coalesce(
        Student.assigned_to,
        WorkItem.owner_agent_id,
        WorkItem.creator_user_id,
    )
    rows = (
        await db.execute(
            select(WorkItem, Student, employment)
            .join(Student, Student.id == WorkItem.student_id)
            .outerjoin(employment, employment.user_id == desired_owner)
            .where(
                WorkItem.status.in_(ACTIVE_WORK_STATUSES),
                ~or_(
                    and_(
                        WorkItem.kind == WorkItemKind.lead_contact,
                        WorkItem.source_type == "student",
                    ),
                    and_(
                        WorkItem.kind == WorkItemKind.help_request,
                        WorkItem.source_type == "help",
                    ),
                ),
            )
            .order_by(WorkItem.id)
        )
    ).all()

    changes: list[tuple[WorkItem, Student, int | None, WorkItemStatus]] = []
    counts: Counter[str] = Counter()
    for item, student, owner_employment in rows:
        if canonical_student_status(student.status) in TERMINAL_STUDENT_STATUSES:
            if (
                item.status != WorkItemStatus.cancelled
                or item.owner_agent_id is not None
                or item.completed_at is not None
                or item.handover_batch_id is not None
            ):
                changes.append((item, student, None, WorkItemStatus.cancelled))
                counts[item.source_type] += 1
            continue
        owner_agent_id = (
            student.assigned_to
            or item.owner_agent_id
            or item.creator_user_id
        )
        if owner_agent_id is None or owner_employment is None:
            raise RepairError("source_work_item_owner_unavailable")
        status = EXPECTED_STATUS.get(owner_employment.status)
        if status is None:
            raise RepairError("source_work_item_owner_offboarded")
        if (
            item.owner_agent_id == owner_agent_id
            and item.status == status
            and item.handover_batch_id is None
        ):
            continue
        changes.append((item, student, owner_agent_id, status))
        counts[item.source_type] += 1
    return changes, dict(sorted(counts.items()))


def _other_audit_failures(report: dict[str, int | bool]) -> dict[str, int]:
    return {
        key: int(value)
        for key, value in report.items()
        if key not in {"ok", "source_work_item_projection_mismatches"}
        and int(value) != 0
    }


async def _unhandled_inactive_work_items(
    db: AsyncSession,
    planned_items: list[tuple[WorkItem, Student, int | None, WorkItemStatus]],
) -> list[int]:
    employment = aliased(AgentEmployment)
    rows = await db.execute(
        select(WorkItem.id)
        .outerjoin(employment, employment.user_id == WorkItem.owner_agent_id)
        .where(
            WorkItem.status.in_(ACTIVE_WORK_STATUSES),
            WorkItem.owner_agent_id.is_not(None),
            or_(
                employment.user_id.is_(None),
                employment.status == EmploymentStatus.offboarded,
            ),
        )
    )
    planned_ids = {item.id for item, *_ in planned_items}
    return sorted(
        int(item_id)
        for (item_id,) in rows.all()
        if item_id not in planned_ids
    )


async def run_repair(database: Path, apply: bool) -> dict[str, object]:
    if apply:
        database_url = f"sqlite+aiosqlite:///{database.as_posix()}"
    else:
        database_url = (
            f"sqlite+aiosqlite:///file:{database.as_posix()}?mode=ro&uri=true"
        )
    engine = create_async_engine(
        database_url,
        poolclass=NullPool,
        connect_args={"timeout": 30},
    )
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as db:
            async with db.begin():
                before = await audit_domain_consistency(db)
                failures = _other_audit_failures(before)
                failures.pop("open_items_owned_by_inactive", None)
                if failures:
                    raise RepairError("unrelated_domain_inconsistencies")
                changes, by_source_type = await collect_owner_changes(db)
                unhandled = await _unhandled_inactive_work_items(db, changes)
                if unhandled:
                    raise RepairError("unhandled_inactive_work_items")
                report: dict[str, object] = {
                    "applied": apply,
                    "before": before,
                    "planned_changes": len(changes),
                    "planned_by_source_type": by_source_type,
                }
                if not apply:
                    return report

                now = utcnow()
                changed_items: list[WorkItem] = []
                for item, _student, owner_agent_id, status in changes:
                    item.owner_agent_id = owner_agent_id
                    item.status = status
                    item.handover_batch_id = None
                    item.completed_at = None
                    item.version += 1
                    item.updated_at = now
                    changed_items.append(item)
                after = await audit_domain_consistency(db)
                if not after["ok"]:
                    raise RepairError("domain_consistency_failed_after_repair")
                report["changed"] = len(changed_items)
                report["after"] = after
                return report
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--expect-revision", default="20260823_01")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    database = args.database.expanduser().resolve()

    if not database.is_file():
        print(json.dumps({"error": "database_not_found"}, sort_keys=True))
        return 2
    try:
        revision = read_revision(database)
        if revision != args.expect_revision:
            print(
                json.dumps(
                    {
                        "actual_revision": revision,
                        "error": "unexpected_revision",
                        "expected_revision": args.expect_revision,
                    },
                    sort_keys=True,
                )
            )
            return 2
        report = asyncio.run(run_repair(database, args.apply))
    except (OSError, sqlite3.DatabaseError, SQLAlchemyError, RepairError) as exc:
        error = exc.code if isinstance(exc, RepairError) else "work_item_owner_repair_failed"
        print(
            json.dumps(
                {"error": error, "error_type": type(exc).__name__},
                sort_keys=True,
            )
        )
        return 2

    print(json.dumps(report, ensure_ascii=True, sort_keys=True))
    if not args.apply and int(report["planned_changes"]) > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
