import os
import sqlite3
from datetime import datetime, timedelta

import pytest
from alembic.config import Config
from sqlalchemy import create_engine

from app import backup, database

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def scheduled_name(stamp: datetime, suffix: str = ".db") -> str:
    return f"crm_{stamp.strftime('%Y%m%d_%H%M%S')}{suffix}"


def create_database(path, revision: str | None = "20261021_01") -> None:
    with sqlite3.connect(path) as connection:
        connection.execute("create table students (id integer primary key, name text)")
        connection.execute("insert into students (name) values ('test student')")
        if revision is not None:
            connection.execute("create table alembic_version (version_num text not null)")
            connection.execute("insert into alembic_version values (?)", (revision,))


@pytest.fixture
def backup_env(tmp_path, monkeypatch):
    source = tmp_path / "crm.db"
    create_database(source)
    backup_dir = tmp_path / "backups"
    monkeypatch.setattr(backup, "DB_PATH", str(source))
    monkeypatch.setattr(backup, "BACKUP_DIR", str(backup_dir))
    monkeypatch.setattr(backup, "BACKUP_ENCRYPTION_KEY", "")
    return backup_dir


def test_retention_keeps_recent_then_one_per_day_and_week():
    newest = datetime(2026, 11, 14, 18, 0, 0)
    # Every 6 hours for 120 days, as the scheduler makes them.
    stamps = [newest - timedelta(hours=6 * step) for step in range(4 * 120)]
    names = [scheduled_name(stamp) for stamp in stamps]

    deleted = set(backup.backups_to_delete(names))
    kept = sorted((stamp for stamp in stamps if scheduled_name(stamp) not in deleted), reverse=True)

    assert kept[:4] == stamps[:4]
    # The newest backup of each of the last 14 days.
    kept_days = sorted({stamp.date() for stamp in kept}, reverse=True)
    assert kept_days[:14] == [newest.date() - timedelta(days=day) for day in range(14)]
    assert all(stamp.hour == 18 for stamp in kept[4:])
    # Older than that, one per week, back to 8 weeks.
    assert newest - kept[-1] > timedelta(days=42)
    assert newest - kept[-1] < timedelta(days=56)
    assert len(kept) <= backup.KEEP_RECENT + backup.KEEP_DAILY + backup.KEEP_WEEKLY


def test_retention_survives_many_restarts_in_one_day():
    newest = datetime(2026, 11, 14, 18, 0, 0)
    restarts = [newest - timedelta(seconds=20 * step) for step in range(50)]
    older_days = [datetime(2026, 11, day, 12, 0, 0) for day in range(1, 14)]

    deleted = set(backup.backups_to_delete([scheduled_name(s) for s in restarts + older_days]))

    assert all(scheduled_name(stamp) not in deleted for stamp in older_days)
    assert len([stamp for stamp in restarts if scheduled_name(stamp) not in deleted]) == 4


def test_retention_never_deletes_files_it_cannot_date():
    names = [
        "crm-before-20261114-reports-dashboard.db",
        "crm_server_latest.db",
        "crm_20261114.db",
        "notes.txt",
    ]
    names += [scheduled_name(datetime(2026, 1, 1) + timedelta(days=day)) for day in range(200)]

    deleted = backup.backups_to_delete(names)

    assert deleted
    assert not set(deleted) & set(names[:4])


def test_retention_counts_encrypted_backups_and_pre_migration_backups():
    scheduled = [
        scheduled_name(datetime(2026, 1, 1) + timedelta(days=day), ".db.enc") for day in range(200)
    ]
    pre_migration = [f"crm_before_20261021_01_202611{day:02d}_120000.db" for day in range(1, 9)]

    deleted = backup.backups_to_delete(scheduled + pre_migration)

    assert set(pre_migration) - set(deleted) == set(pre_migration[-backup.KEEP_PRE_MIGRATION :])
    assert all(name.endswith(".db.enc") for name in set(deleted) - set(pre_migration))
    assert len(set(scheduled) - set(deleted)) <= backup.MAX_BACKUPS


def test_backup_is_checked_and_old_backups_are_pruned(backup_env):
    backup_env.mkdir()
    stale = [scheduled_name(datetime(2025, 1, 1) + timedelta(days=day)) for day in range(60)]
    for name in stale:
        (backup_env / name).write_bytes(b"old")
    manual = backup_env / "crm-before-release.db"
    manual.write_bytes(b"manual")

    created = backup.do_backup()

    with sqlite3.connect(created) as connection:
        assert connection.execute("select name from students").fetchall() == [("test student",)]
    assert manual.exists()
    assert len(os.listdir(backup_env)) < len(stale)


def test_damaged_backup_is_removed_and_reported_as_failed(backup_env, monkeypatch):
    monkeypatch.setattr(backup, "_sqlite_backup_is_sound", lambda path: False)

    assert backup.do_backup() is None
    assert os.listdir(backup_env) == []


def test_pre_migration_backup_is_reused_while_recent(backup_env):
    first = backup.backup_before_migration("20261021_01")

    assert os.path.basename(first).startswith("crm_before_20261021_01_")
    assert backup.backup_before_migration("20261021_01") == first
    assert len(os.listdir(backup_env)) == 1


def test_pre_migration_backup_is_taken_again_when_the_last_one_is_old(backup_env):
    backup_env.mkdir()
    old_stamp = datetime.now() - backup.PRE_MIGRATION_MIN_INTERVAL - timedelta(minutes=1)
    old = backup_env / f"crm_before_20261021_01_{old_stamp.strftime('%Y%m%d_%H%M%S')}.db"
    old.write_bytes(b"old")

    created = backup.backup_before_migration("20261021_01")

    assert created != str(old)
    assert len(os.listdir(backup_env)) == 2


@pytest.mark.parametrize(
    ("revision", "expected"),
    [("20261021_01", "20261021_01"), ("head", None), (None, None)],
)
def test_pending_upgrade_is_the_revision_behind_head(tmp_path, monkeypatch, revision, expected):
    monkeypatch.chdir(ROOT)
    cfg = Config(os.path.join(ROOT, "alembic.ini"))
    if revision == "head":
        from alembic.script import ScriptDirectory

        revision = ScriptDirectory.from_config(cfg).get_current_head()
    path = tmp_path / "crm.db"
    create_database(path, revision)
    engine = create_engine(f"sqlite:///{path}")
    monkeypatch.setattr(database, "sync_engine", engine)

    try:
        assert database._pending_upgrade_from(cfg) == expected
    finally:
        engine.dispose()


def test_upgrade_is_refused_when_the_backup_before_it_fails(monkeypatch):
    from alembic import command

    upgrades = []
    monkeypatch.setattr(database, "_pending_upgrade_from", lambda cfg: "20261021_01")
    monkeypatch.setattr(database, "backup_before_migration", lambda revision: None)
    monkeypatch.setattr(command, "upgrade", lambda cfg, target: upgrades.append(target))

    with pytest.raises(RuntimeError, match="20261021_01"):
        database._run_alembic_upgrade_head()
    assert upgrades == []


def test_upgrade_runs_after_a_backup_and_without_one_when_current(monkeypatch):
    from alembic import command

    upgrades = []
    backups = []
    monkeypatch.setattr(command, "upgrade", lambda cfg, target: upgrades.append(target))
    monkeypatch.setattr(
        database, "backup_before_migration", lambda revision: backups.append(revision) or "path"
    )

    monkeypatch.setattr(database, "_pending_upgrade_from", lambda cfg: "20261021_01")
    database._run_alembic_upgrade_head()
    monkeypatch.setattr(database, "_pending_upgrade_from", lambda cfg: None)
    database._run_alembic_upgrade_head()

    assert upgrades == ["head", "head"]
    assert backups == ["20261021_01"]
