import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models import User, UserRole

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def _database(tmp_path: Path, revision: str = "20260711_03") -> Path:
    database = tmp_path / "domain-consistency.db"
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    Base.metadata.create_all(engine)
    with engine.begin() as connection:
        connection.exec_driver_sql(
            "create table alembic_version (version_num varchar(32) not null)"
        )
        connection.exec_driver_sql(
            "insert into alembic_version (version_num) values (?)",
            (revision,),
        )
    engine.dispose()
    return database


def _run_cli(database: Path, revision: str = "20260711_03"):
    env = os.environ.copy()
    env.setdefault("SECRET_KEY", "domain-consistency-cli-test")
    return subprocess.run(
        [
            sys.executable,
            "scripts/audit_domain_consistency.py",
            "--database",
            str(database),
            "--expect-revision",
            revision,
        ],
        cwd=PROJECT_ROOT,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_consistency_cli_is_read_only_and_aggregate_only(tmp_path):
    database = _database(tmp_path)
    before_hash = hashlib.sha256(database.read_bytes()).hexdigest()

    result = _run_cli(database)

    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["ok"] is True
    assert all(value == 0 for key, value in report.items() if key != "ok")
    assert hashlib.sha256(database.read_bytes()).hexdigest() == before_hash
    assert str(database) not in result.stdout
    assert result.stderr == ""


def test_consistency_cli_returns_one_for_projection_mismatch(tmp_path):
    database = _database(tmp_path)
    engine = create_engine(f"sqlite:///{database.as_posix()}")
    with Session(engine) as session:
        session.add(
            User(
                username="private-user",
                hashed_password="test",
                role=UserRole.agent,
                name="Private Name",
                is_active=True,
            )
        )
        session.commit()
    engine.dispose()

    result = _run_cli(database)

    assert result.returncode == 1
    report = json.loads(result.stdout)
    assert report["ok"] is False
    assert report["users_without_employment"] == 1
    assert "private-user" not in result.stdout
    assert "Private Name" not in result.stdout


def test_consistency_cli_rejects_unexpected_revision(tmp_path):
    database = _database(tmp_path, revision="20260711_02")

    result = _run_cli(database)

    assert result.returncode == 2
    report = json.loads(result.stdout)
    assert report == {
        "actual_revision": "20260711_02",
        "error": "unexpected_revision",
        "expected_revision": "20260711_03",
    }


def test_consistency_cli_rejects_missing_database(tmp_path):
    result = _run_cli(tmp_path / "missing.db")

    assert result.returncode == 2
    assert json.loads(result.stdout) == {"error": "database_not_found"}
    assert not (tmp_path / "missing.db").exists()
