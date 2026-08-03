"""Create and validate a consistent online backup of a SQLite database."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import unquote

SQLITE_URL_RE = re.compile(r"^sqlite(?:\+[A-Za-z0-9_]+)?:///(.*)$")


def read_revision(connection: sqlite3.Connection) -> str:
    table = connection.execute(
        "select 1 from sqlite_master where type = 'table' and name = 'alembic_version'"
    ).fetchone()
    if table is None:
        return ""
    row = connection.execute("select version_num from alembic_version limit 1").fetchone()
    return str(row[0]) if row else ""


def inspect_database(
    source: Path,
    expected_revision: str = "",
) -> dict[str, object]:
    source = source.resolve()
    if not source.is_file():
        raise ValueError(f"source database does not exist: {source}")

    source_uri = f"file:{source.as_posix()}?mode=ro"
    with sqlite3.connect(source_uri, uri=True) as connection:
        revision = read_revision(connection)
        if expected_revision and revision != expected_revision:
            raise ValueError(
                "database revision mismatch: "
                f"expected {expected_revision}, got {revision or 'unversioned'}"
            )
        quick_check = str(connection.execute("pragma quick_check").fetchone()[0])
        foreign_key_violations = len(
            connection.execute("pragma foreign_key_check").fetchall()
        )

    if quick_check != "ok":
        raise ValueError(f"database quick check failed: {quick_check}")
    if foreign_key_violations:
        raise ValueError(
            f"database foreign key check failed: {foreign_key_violations} violation(s)"
        )

    return {
        "source": str(source),
        "bytes": source.stat().st_size,
        "quick_check": quick_check,
        "foreign_key_violations": foreign_key_violations,
        "alembic_revision": revision,
    }


def read_process_environment(process_id: int) -> dict[str, str]:
    raw = Path("/proc", str(process_id), "environ").read_bytes()
    environment: dict[str, str] = {}
    for item in raw.split(b"\0"):
        if not item or b"=" not in item:
            continue
        key, value = item.split(b"=", 1)
        environment[key.decode(errors="surrogateescape")] = value.decode(errors="surrogateescape")
    return environment


def read_process_working_directory(process_id: int) -> Path:
    return Path("/proc", str(process_id), "cwd").resolve()


def resolve_process_sqlite_source(
    process_id: int,
    expected_working_directory: Path | None = None,
) -> Path:
    process_working_directory = read_process_working_directory(process_id)
    if (
        expected_working_directory is not None
        and process_working_directory != expected_working_directory.resolve()
    ):
        raise ValueError(
            "running service working directory mismatch: "
            f"expected {expected_working_directory.resolve()}, got {process_working_directory}"
        )
    environment = read_process_environment(process_id)
    return resolve_sqlite_source(environment, process_working_directory)


def resolve_sqlite_source(
    environment: Mapping[str, str],
    working_directory: Path,
) -> Path:
    database_url = environment.get("DATABASE_URL", "").strip()
    if database_url:
        match = SQLITE_URL_RE.match(database_url)
        if not match:
            raise ValueError("running service is not configured for a file-backed SQLite database")
        raw_path = unquote(match.group(1).split("?", 1)[0])
        if raw_path in {"", ":memory:"}:
            raise ValueError("running service does not use a file-backed SQLite database")
        source = Path(raw_path)
    else:
        source = Path(environment.get("DATABASE_PATH", "crm.db"))

    if not source.is_absolute():
        source = working_directory / source
    return source.resolve()


def create_backup(
    source: Path,
    destination: Path,
    expected_revision: str = "",
) -> dict[str, object]:
    source = source.resolve()
    destination = destination.resolve()
    if not source.is_file():
        raise ValueError(f"source database does not exist: {source}")
    if destination.exists():
        raise ValueError(f"backup destination already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)

    source_uri = f"file:{source.as_posix()}?mode=ro"
    try:
        with sqlite3.connect(source_uri, uri=True) as source_db:
            revision = read_revision(source_db)
            if expected_revision and revision != expected_revision:
                raise ValueError(
                    "database revision mismatch: "
                    f"expected {expected_revision}, got {revision or 'unversioned'}"
                )
            with sqlite3.connect(destination) as backup_db:
                source_db.backup(backup_db)

        with sqlite3.connect(f"file:{destination.as_posix()}?mode=ro", uri=True) as backup_db:
            integrity = str(backup_db.execute("pragma integrity_check").fetchone()[0])
            backup_revision = read_revision(backup_db)
        if integrity != "ok":
            raise ValueError(f"backup integrity check failed: {integrity}")
        if backup_revision != revision:
            raise ValueError(
                f"backup revision mismatch: source {revision or 'unversioned'}, "
                f"backup {backup_revision or 'unversioned'}"
            )
    except Exception:
        destination.unlink(missing_ok=True)
        raise

    return {
        "source": str(source),
        "destination": str(destination),
        "bytes": destination.stat().st_size,
        "integrity_check": integrity,
        "alembic_revision": revision,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source_group = parser.add_mutually_exclusive_group(required=True)
    source_group.add_argument("--source", type=Path)
    source_group.add_argument("--process-id", type=int)
    parser.add_argument("--expect-working-directory", type=Path)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--expect-revision", default="")
    parser.add_argument("--print-source", action="store_true")
    parser.add_argument("--print-revision", action="store_true")
    parser.add_argument("--inspect", action="store_true")
    args = parser.parse_args()

    selected_actions = sum(
        int(selected)
        for selected in (args.print_source, args.print_revision, args.inspect)
    )
    if selected_actions > 1:
        parser.error("choose only one of --print-source, --print-revision, or --inspect")

    source = args.source
    if args.process_id is not None:
        source = resolve_process_sqlite_source(
            args.process_id,
            args.expect_working_directory,
        )

    if args.print_source:
        print(source.resolve())
        return 0
    if args.print_revision:
        print(read_revision_from_path(source))
        return 0
    if args.inspect:
        result = inspect_database(source, args.expect_revision)
        print(json.dumps(result, ensure_ascii=True, sort_keys=True))
        return 0
    if args.destination is None:
        parser.error(
            "--destination is required unless an inspection or print action is used"
        )

    result = create_backup(source, args.destination, args.expect_revision)
    print(json.dumps(result, ensure_ascii=True, sort_keys=True))
    return 0


def read_revision_from_path(source: Path) -> str:
    source = source.resolve()
    if not source.is_file():
        raise ValueError(f"source database does not exist: {source}")
    with sqlite3.connect(f"file:{source.as_posix()}?mode=ro", uri=True) as connection:
        return read_revision(connection)


if __name__ == "__main__":
    raise SystemExit(main())
