import argparse
import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path

from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

os.environ.setdefault("SECRET_KEY", "domain-consistency-audit-only")

from app.domain_consistency import audit_domain_consistency  # noqa: E402


def _read_revision(database: Path) -> str | None:
    read_only_uri = f"{database.as_uri()}?mode=ro"
    with sqlite3.connect(read_only_uri, uri=True) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "select name from sqlite_master where type = 'table'"
            )
        }
        if "alembic_version" not in tables:
            return None
        revisions = connection.execute(
            "select version_num from alembic_version order by version_num"
        ).fetchall()
        return str(revisions[0][0]) if len(revisions) == 1 else None


async def _run_audit(database: Path) -> dict[str, int | bool]:
    database_url = (
        f"sqlite+aiosqlite:///file:{database.as_posix()}?mode=ro&uri=true"
    )
    engine = create_async_engine(database_url, poolclass=NullPool)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with session_factory() as session:
            return await audit_domain_consistency(session)
    finally:
        await engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--expect-revision", default="20260823_01")
    args = parser.parse_args()
    database = args.database.expanduser().resolve()

    if not database.is_file():
        print(json.dumps({"error": "database_not_found"}, sort_keys=True))
        return 2

    try:
        revision = _read_revision(database)
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
        report = asyncio.run(_run_audit(database))
    except (OSError, sqlite3.DatabaseError, SQLAlchemyError, KeyError) as exc:
        print(
            json.dumps(
                {
                    "error": "domain_consistency_audit_failed",
                    "error_type": type(exc).__name__,
                },
                sort_keys=True,
            )
        )
        return 2

    print(json.dumps(report, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
