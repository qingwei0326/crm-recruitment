import hashlib
import json
import os
import sqlite3
import stat
import subprocess
import sys
import uuid
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
WORKING_DIR = PROJECT_ROOT / "backups" / "server-audit" / "working"


def run_alembic(db_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.pop("DATABASE_URL", None)
    env.update(
        DATABASE_PATH=str(db_path),
        SECRET_KEY="snapshot-clone-test-secret",
        APP_ENV="development",
    )
    return subprocess.run(
        [sys.executable, "-m", "alembic", *args],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def create_unstamped_source(db_path: Path) -> None:
    result = run_alembic(db_path, "upgrade", "20260711_01")
    assert result.returncode == 0, result.stderr
    with sqlite3.connect(db_path) as connection:
        connection.execute("drop table alembic_version")


def destination_path(label: str) -> Path:
    WORKING_DIR.mkdir(parents=True, exist_ok=True)
    return WORKING_DIR / f"pytest-{label}-{uuid.uuid4().hex}.db"


def run_clone(source: Path, destination: Path) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.setdefault("SECRET_KEY", "snapshot-clone-test-secret")
    return subprocess.run(
        [
            sys.executable,
            "scripts/migrate_snapshot_clone.py",
            "--source",
            str(source),
            "--destination",
            str(destination),
        ],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_snapshot_clone_migrates_and_never_changes_source(tmp_path):
    source = tmp_path / "source.db"
    create_unstamped_source(source)
    original_bytes = source.read_bytes()
    destination = destination_path("success")
    try:
        result = run_clone(source, destination)

        assert result.returncode == 0, result.stderr
        report = json.loads(result.stdout)
        assert report["source_sha256_before"] == report["source_sha256_after"]
        assert report["source_sha256_after"] == hashlib.sha256(original_bytes).hexdigest()
        assert report["destination_quick_check"] == "ok"
        assert report["destination_foreign_key_violations"] == 0
        assert report["destination_revision"] == "20261007_01"
        assert report["legacy_row_count_mismatches"] == {}
        assert report["domain_audit"]["ok"] is True
        assert source.read_bytes() == original_bytes
        assert destination.is_file()
    finally:
        destination.unlink(missing_ok=True)


def test_snapshot_clone_migrates_from_read_only_source(tmp_path):
    source = tmp_path / "read-only-source.db"
    create_unstamped_source(source)
    original_bytes = source.read_bytes()
    source.chmod(stat.S_IREAD)
    destination = destination_path("read-only-source")
    try:
        result = run_clone(source, destination)

        assert result.returncode == 0, result.stdout + result.stderr
        assert source.read_bytes() == original_bytes
        assert destination.is_file()
        assert os.access(destination, os.W_OK)
    finally:
        source.chmod(stat.S_IREAD | stat.S_IWRITE)
        if destination.exists():
            destination.chmod(stat.S_IREAD | stat.S_IWRITE)
            destination.unlink()


def test_snapshot_clone_refuses_identical_paths(tmp_path):
    source = tmp_path / "same.db"
    source.write_bytes(b"unchanged")

    result = run_clone(source, source)

    assert result.returncode == 2
    assert json.loads(result.stdout)["error"] == "source_equals_destination"
    assert source.read_bytes() == b"unchanged"


def test_snapshot_clone_refuses_destination_outside_repository(tmp_path):
    source = tmp_path / "source.db"
    source.write_bytes(b"source")
    destination = tmp_path / "outside.db"

    result = run_clone(source, destination)

    assert result.returncode == 2
    assert json.loads(result.stdout)["error"] == "destination_outside_repository"
    assert not destination.exists()


def test_snapshot_clone_refuses_existing_destination(tmp_path):
    source = tmp_path / "source.db"
    source.write_bytes(b"source")
    destination = destination_path("existing")
    destination.write_bytes(b"keep")
    try:
        result = run_clone(source, destination)

        assert result.returncode == 2
        assert json.loads(result.stdout)["error"] == "destination_exists"
        assert destination.read_bytes() == b"keep"
    finally:
        destination.unlink(missing_ok=True)


def test_snapshot_clone_removes_new_destination_after_migration_failure(tmp_path):
    source = tmp_path / "broken.db"
    with sqlite3.connect(source) as connection:
        connection.execute("create table users (id integer primary key)")
    destination = destination_path("failure")
    try:
        result = run_clone(source, destination)

        assert result.returncode == 1
        assert json.loads(result.stdout)["error"] == "baseline_preflight_failed"
        assert not destination.exists()
    finally:
        destination.unlink(missing_ok=True)
