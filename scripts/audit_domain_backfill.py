import argparse
import json
import sqlite3
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from app.migration_data.domain_backfill_20260711 import audit_domain_core  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    args = parser.parse_args()
    database = args.database.expanduser().resolve()

    if not database.is_file():
        print(json.dumps({"error": "database_not_found"}, sort_keys=True))
        return 2

    read_only_uri = f"{database.as_uri()}?mode=ro"
    engine = create_engine(
        "sqlite://",
        creator=lambda: sqlite3.connect(read_only_uri, uri=True),
        poolclass=NullPool,
    )
    try:
        with Session(engine) as session:
            report = audit_domain_core(session)
    except (sqlite3.DatabaseError, KeyError, SQLAlchemyError) as exc:
        print(
            json.dumps(
                {"error": "domain_audit_failed", "error_type": type(exc).__name__},
                sort_keys=True,
            )
        )
        return 2
    finally:
        engine.dispose()

    print(json.dumps(report, sort_keys=True))
    return 0 if report["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
