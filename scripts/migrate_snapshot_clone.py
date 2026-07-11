import argparse
import hashlib
import json
import os
import shutil
import sqlite3
import stat
import subprocess
import sys
import time
from contextlib import suppress
from pathlib import Path
from typing import Any

PROJECT_ROOT = Path(__file__).resolve().parents[1]


class CloneMigrationError(RuntimeError):
    def __init__(self, code: str, *, exit_code: int = 1):
        super().__init__(code)
        self.code = code
        self.exit_code = exit_code


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _read_only_connection(path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"{path.resolve().as_uri()}?mode=ro", uri=True)


def _make_writable(path: Path) -> None:
    path.chmod(path.stat().st_mode | stat.S_IWUSR)


def _database_state(path: Path) -> dict[str, Any]:
    with _read_only_connection(path) as connection:
        tables = {
            row[0]
            for row in connection.execute(
                "select name from sqlite_master where type = 'table'"
            )
        }
        revision = None
        if "alembic_version" in tables:
            revisions = connection.execute(
                "select version_num from alembic_version order by version_num"
            ).fetchall()
            if len(revisions) == 1:
                revision = revisions[0][0]
        return {
            "quick_check": connection.execute("pragma quick_check").fetchone()[0],
            "foreign_key_violations": len(
                connection.execute("pragma foreign_key_check").fetchall()
            ),
            "revision": revision,
        }


def _table_counts(path: Path) -> dict[str, int]:
    with _read_only_connection(path) as connection:
        table_names = [
            row[0]
            for row in connection.execute(
                "select name from sqlite_master "
                "where type = 'table' "
                "and name not like 'sqlite_%' "
                "and name != 'alembic_version' "
                "order by name"
            )
        ]
        counts = {}
        for table_name in table_names:
            quoted_name = table_name.replace('"', '""')
            counts[table_name] = int(
                connection.execute(
                    f'select count(*) from "{quoted_name}"'  # noqa: S608
                ).fetchone()[0]
            )
        return counts


def _run_command(
    arguments: list[str],
    *,
    error_code: str,
    env: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(
        arguments,
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise CloneMigrationError(error_code)
    return result


def _json_stdout(result: subprocess.CompletedProcess[str], error_code: str) -> dict:
    try:
        value = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise CloneMigrationError(error_code) from exc
    if not isinstance(value, dict):
        raise CloneMigrationError(error_code)
    return value


def _validate_paths(source: Path, destination: Path) -> None:
    if source == destination:
        raise CloneMigrationError("source_equals_destination", exit_code=2)
    if not source.is_file():
        raise CloneMigrationError("source_not_found", exit_code=2)
    if not destination.is_relative_to(PROJECT_ROOT):
        raise CloneMigrationError("destination_outside_repository", exit_code=2)
    if destination.exists():
        raise CloneMigrationError("destination_exists", exit_code=2)
    wal_path = Path(f"{source}-wal")
    if wal_path.is_file() and wal_path.stat().st_size > 0:
        raise CloneMigrationError("source_has_uncheckpointed_wal", exit_code=2)


def migrate_snapshot_clone(source: Path, destination: Path) -> dict[str, Any]:
    source = source.expanduser().resolve()
    destination = destination.expanduser().resolve()
    _validate_paths(source, destination)

    source_state = _database_state(source)
    if (
        source_state["quick_check"] != "ok"
        or source_state["foreign_key_violations"] != 0
    ):
        raise CloneMigrationError("source_integrity_failed", exit_code=2)

    source_hash_before = _sha256(source)
    source_size = source.stat().st_size
    source_counts = _table_counts(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    created_destination = False
    started_at = time.perf_counter()

    try:
        descriptor = os.open(
            destination,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY,
        )
        os.close(descriptor)
        created_destination = True
        shutil.copy2(source, destination)
        _make_writable(destination)

        baseline_result = _run_command(
            [
                sys.executable,
                str(PROJECT_ROOT / "scripts" / "prepare_alembic_baseline.py"),
                "--database",
                str(destination),
                "--apply",
            ],
            error_code="baseline_preflight_failed",
        )
        baseline_report = _json_stdout(
            baseline_result,
            "baseline_preflight_invalid_json",
        )

        migration_env = os.environ.copy()
        migration_env.pop("DATABASE_URL", None)
        migration_env.update(
            DATABASE_PATH=str(destination),
            SECRET_KEY=migration_env.get(
                "SECRET_KEY",
                "snapshot-clone-migration-only",
            ),
            APP_ENV="development",
        )
        _run_command(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            env=migration_env,
            error_code="alembic_upgrade_failed",
        )

        audit_result = _run_command(
            [
                sys.executable,
                str(PROJECT_ROOT / "scripts" / "audit_domain_backfill.py"),
                "--database",
                str(destination),
            ],
            error_code="domain_audit_failed",
        )
        domain_audit = _json_stdout(audit_result, "domain_audit_invalid_json")
        destination_state = _database_state(destination)
        destination_counts = _table_counts(destination)
        source_hash_after = _sha256(source)

        if source_hash_before != source_hash_after:
            raise CloneMigrationError("source_changed_during_migration")
        if destination_state["revision"] != "20260711_03":
            raise CloneMigrationError("unexpected_destination_revision")
        if (
            destination_state["quick_check"] != "ok"
            or destination_state["foreign_key_violations"] != 0
        ):
            raise CloneMigrationError("destination_integrity_failed")
        if domain_audit.get("ok") is not True:
            raise CloneMigrationError("domain_audit_failed")

        row_count_mismatches = {
            table_name: {
                "source": source_count,
                "destination": destination_counts.get(table_name),
            }
            for table_name, source_count in source_counts.items()
            if destination_counts.get(table_name) != source_count
        }
        if row_count_mismatches:
            raise CloneMigrationError("legacy_row_count_mismatch")

        return {
            "source_sha256_before": source_hash_before,
            "source_sha256_after": source_hash_after,
            "source_size": source_size,
            "source_quick_check": source_state["quick_check"],
            "source_foreign_key_violations": source_state[
                "foreign_key_violations"
            ],
            "destination_sha256": _sha256(destination),
            "destination_size": destination.stat().st_size,
            "destination_revision": destination_state["revision"],
            "destination_quick_check": destination_state["quick_check"],
            "destination_foreign_key_violations": destination_state[
                "foreign_key_violations"
            ],
            "legacy_tables_compared": len(source_counts),
            "legacy_row_count_mismatches": row_count_mismatches,
            "baseline_revision": baseline_report.get("stamped_revision"),
            "domain_audit": domain_audit,
            "duration_ms": round((time.perf_counter() - started_at) * 1000),
        }
    except Exception:
        if (
            created_destination
            and destination.is_relative_to(PROJECT_ROOT)
            and destination.is_file()
        ):
            with suppress(OSError):
                _make_writable(destination)
                destination.unlink()
        raise


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()

    try:
        report = migrate_snapshot_clone(args.source, args.destination)
    except CloneMigrationError as exc:
        print(json.dumps({"error": exc.code}, sort_keys=True))
        return exc.exit_code
    except (OSError, sqlite3.DatabaseError) as exc:
        print(
            json.dumps(
                {"error": "snapshot_clone_failed", "error_type": type(exc).__name__},
                sort_keys=True,
            )
        )
        return 1

    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
