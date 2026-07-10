# 领域基础与生产快照迁移 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish versioned Alembic migrations, create the employment/assignment/work-item/handover/outcome schema, and prove an idempotent backfill against a verified production SQLite snapshot without changing runtime business behavior.

**Architecture:** Keep the existing schema as revision `20260711_01`, stamp verified existing databases to that baseline, then add new domain tables in `20260711_02` and execute the data backfill as `20260711_03`. Migration and audit run only against timestamped snapshot clones; the downloaded source snapshot remains immutable.

**Tech Stack:** Python 3.11, SQLAlchemy 2.0.23, Alembic 1.13.1, SQLite, pytest 9, PowerShell, SHA-256.

## Global Constraints

- Approved spec: `docs/superpowers/specs/2026-07-10-agent-lifecycle-assignment-work-items-redesign.md`.
- Do not write to the live server database in this plan.
- Keep `backups/server-audit/crm_server_audit_20260710_223750.db` immutable.
- Every migration test starts from a new copy under `backups/server-audit/working/` or pytest `tmp_path`.
- Existing databases are preflighted and stamped at `20260711_01`; they never execute baseline table creation.
- Empty databases execute `20260711_01` and must receive the complete current legacy schema.
- Do not remove legacy fields, tables, or startup migrations in this phase.
- Do not print names, phone numbers, note bodies, passwords, tokens, or system-config values.
- Use `.venv-win\Scripts\python.exe` for backend commands on this machine.
- `docs/` is ignored; add plan files with `git add -f` only.
- Preserve the three existing unstaged user deletions under `docs/superpowers/specs/`.

---

## File Structure

- Modify `requirements.txt`: pin Alembic.
- Create `app/migration_config.py`: pure migration URL resolution.
- Modify `alembic/env.py`: consume the resolved synchronous URL and SQLite batch mode.
- Create `alembic/versions/20260711_01_current_schema_baseline.py`: generated immutable legacy baseline.
- Create `scripts/prepare_alembic_baseline.py`: compatibility preflight and safe stamp command.
- Create `app/domain_models.py`: new domain enums and ORM tables.
- Modify `app/models.py`: add the outcome-reason projection and register domain metadata.
- Create `alembic/versions/20260711_02_domain_core_schema.py`: generated domain schema revision.
- Create `app/migration_data/domain_backfill_20260711.py`: immutable idempotent backfill and audit functions.
- Create `alembic/versions/20260711_03_backfill_domain_core.py`: invoke the frozen data migration.
- Create `scripts/audit_domain_backfill.py`: JSON audit command.
- Create `scripts/migrate_snapshot_clone.py`: copy, migrate, verify, and report a snapshot clone.
- Create `tests/test_migration_config.py`.
- Create `tests/test_alembic_migrations.py`.
- Create `tests/test_domain_models.py`.
- Create `tests/test_domain_backfill.py`.
- Create `tests/test_snapshot_clone_migration.py`.

---

### Task 1: Alembic Runtime and Deterministic URL Configuration

**Files:**
- Modify: `requirements.txt`
- Create: `app/migration_config.py`
- Modify: `alembic/env.py`
- Create: `tests/test_migration_config.py`

**Interfaces:**
- Produces: `resolve_sync_migration_url(database_url: str = "", database_path: str = "crm.db") -> str`.
- Produces: Alembic online/offline environments that use the same resolved URL and `render_as_batch=True` for SQLite.

- [ ] **Step 1: Write the failing URL tests**

Create `tests/test_migration_config.py`:

```python
from pathlib import Path

from app.migration_config import resolve_sync_migration_url


def test_resolve_sync_migration_url_uses_absolute_sqlite_path(tmp_path):
    db_path = tmp_path / "migration.db"
    result = resolve_sync_migration_url(database_path=str(db_path))
    assert result == f"sqlite:///{db_path.resolve().as_posix()}"


def test_resolve_sync_migration_url_converts_async_drivers():
    assert (
        resolve_sync_migration_url("sqlite+aiosqlite:///D:/crm.db")
        == "sqlite:///D:/crm.db"
    )
    assert (
        resolve_sync_migration_url("postgresql+asyncpg://u:p@db/crm")
        == "postgresql+psycopg2://u:p@db/crm"
    )


def test_resolve_sync_migration_url_escapes_no_values():
    url = resolve_sync_migration_url(database_path="data/百分比.db")
    assert Path(url.removeprefix("sqlite:///")).is_absolute()
```

- [ ] **Step 2: Run the test and confirm the missing module failure**

Run:

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_migration_config.py -q
```

Expected: collection fails with `ModuleNotFoundError: No module named 'app.migration_config'`.

- [ ] **Step 3: Add the pinned migration dependency**

Append to `requirements.txt`:

```text
alembic==1.13.1
```

Install it in the existing environment:

```powershell
.venv-win\Scripts\python.exe -m pip install alembic==1.13.1
```

Expected: `Successfully installed alembic-1.13.1` or `Requirement already satisfied`.

- [ ] **Step 4: Implement URL resolution**

Create `app/migration_config.py`:

```python
from pathlib import Path


def resolve_sync_migration_url(
    database_url: str = "",
    database_path: str = "crm.db",
) -> str:
    if database_url:
        return (
            database_url.replace("sqlite+aiosqlite://", "sqlite://", 1)
            .replace("postgresql+asyncpg://", "postgresql+psycopg2://", 1)
        )
    path = Path(database_path).expanduser().resolve()
    return f"sqlite:///{path.as_posix()}"
```

- [ ] **Step 5: Replace `alembic/env.py` URL setup**

Keep its migration functions, but replace ad hoc imports and URL lookup with:

```python
import os
import sys
from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.database import Base
from app.migration_config import resolve_sync_migration_url
from app import models as _models  # noqa: E402,F401

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata
migration_url = resolve_sync_migration_url(
    os.getenv("DATABASE_URL", ""),
    os.getenv("DATABASE_PATH", "crm.db"),
)
config.set_main_option("sqlalchemy.url", migration_url.replace("%", "%%"))
```

In both online and offline `context.configure` calls add:

```python
compare_type=True,
render_as_batch=migration_url.startswith("sqlite:"),
```

In offline mode use `migration_url` instead of `config.get_main_option("sqlalchemy.url")`.

- [ ] **Step 6: Run tests and the CLI version check**

Run:

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_migration_config.py -q
.venv-win\Scripts\alembic.exe --version
```

Expected: `3 passed`; Alembic reports `1.13.1`.

- [ ] **Step 7: Commit**

```powershell
git add requirements.txt app/migration_config.py alembic/env.py tests/test_migration_config.py
git commit -m "build: establish alembic runtime"
```

---

### Task 2: Immutable Current-Schema Baseline

**Files:**
- Create: `alembic/versions/20260711_01_current_schema_baseline.py`
- Create: `tests/test_alembic_migrations.py`

**Interfaces:**
- Produces revision ID `20260711_01` with no parent.
- Empty DB: `alembic upgrade 20260711_01` creates the current legacy schema.
- Existing DB: later preflight stamps this revision without running `upgrade()`.

- [ ] **Step 1: Write the failing empty-database migration test**

Create `tests/test_alembic_migrations.py`:

```python
import os
import subprocess
from pathlib import Path

from sqlalchemy import create_engine, inspect


LEGACY_TABLES = {
    "agents", "calls", "campus_visit_tasks", "dial_logs",
    "enrollment_records", "follow_up_assignments", "follow_ups",
    "home_visit_tasks", "lead_view_logs", "login_attempts", "notes",
    "operation_logs", "students", "system_configs", "tasks",
    "today_tasks", "users", "visits",
}


def run_alembic(db_path: Path, *args: str) -> subprocess.CompletedProcess[str]:
    env = os.environ.copy()
    env.update(
        DATABASE_PATH=str(db_path),
        SECRET_KEY="migration-test-secret",
        APP_ENV="development",
    )
    return subprocess.run(
        [str(Path(".venv-win/Scripts/alembic.exe")), *args],
        cwd=Path(__file__).resolve().parents[1],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )


def test_empty_database_upgrades_to_current_schema_baseline(tmp_path):
    db_path = tmp_path / "empty.db"
    result = run_alembic(db_path, "upgrade", "20260711_01")
    assert result.returncode == 0, result.stderr

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    inspector = inspect(engine)
    assert LEGACY_TABLES <= set(inspector.get_table_names())
    assert "recording_state" in {
        col["name"] for col in inspector.get_columns("dial_logs")
    }
    assert "status_detail" in {
        col["name"] for col in inspector.get_columns("students")
    }
```

- [ ] **Step 2: Confirm the missing revision failure**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_alembic_migrations.py -q
```

Expected: failure containing `Can't locate revision identified by '20260711_01'`.

- [ ] **Step 3: Generate the explicit baseline from an empty database**

```powershell
New-Item -ItemType Directory -Path alembic\versions -Force
$env:DATABASE_PATH=(Join-Path $env:TEMP 'crm-alembic-baseline-empty.db')
$env:SECRET_KEY='migration-generation-only'
Remove-Item -LiteralPath $env:DATABASE_PATH -Force -ErrorAction SilentlyContinue
.venv-win\Scripts\alembic.exe revision --autogenerate --rev-id 20260711_01 -m "current schema baseline"
```

Expected: `alembic/versions/20260711_01_current_schema_baseline.py` contains explicit `op.create_table` and `op.create_index` calls for every table in `LEGACY_TABLES`; `down_revision = None`.

- [ ] **Step 4: Review and freeze the generated migration**

Run:

```powershell
Select-String -LiteralPath alembic\versions\20260711_01_current_schema_baseline.py -Pattern 'from app|Base.metadata|create_all'
```

Expected: no matches. The baseline must not import live ORM metadata.

- [ ] **Step 5: Run the migration test**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_alembic_migrations.py -q
```

Expected: `1 passed`.

- [ ] **Step 6: Commit**

```powershell
git add alembic/versions/20260711_01_current_schema_baseline.py tests/test_alembic_migrations.py
git commit -m "db: add current schema baseline"
```

---

### Task 3: Existing-Database Preflight and Safe Stamp

**Files:**
- Create: `scripts/prepare_alembic_baseline.py`
- Create: `app/legacy_schema_compat.py`
- Modify: `tests/test_alembic_migrations.py`

**Interfaces:**
- Produces CLI: `python scripts/prepare_alembic_baseline.py --database PATH [--apply]`.
- Dry run is read-only and returns nonzero when compatibility columns are missing.
- `--apply` runs current compatibility migration, validates integrity, and stamps exactly `20260711_01`.

- [ ] **Step 1: Add failing stamp tests**

Append to `tests/test_alembic_migrations.py`:

```python
import sqlite3
import sys

def test_prepare_baseline_stamps_existing_schema(tmp_path):
    db_path = tmp_path / "existing.db"
    created = run_alembic(db_path, "upgrade", "20260711_01")
    assert created.returncode == 0, created.stderr
    with sqlite3.connect(db_path) as conn:
        conn.execute("drop table alembic_version")
        conn.commit()

    env = os.environ.copy()
    env["SECRET_KEY"] = "migration-test-secret"
    result = subprocess.run(
        [sys.executable, "scripts/prepare_alembic_baseline.py", "--database", str(db_path), "--apply"],
        cwd=Path(__file__).resolve().parents[1], env=env,
        text=True, capture_output=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    with sqlite3.connect(db_path) as conn:
        assert conn.execute("pragma quick_check").fetchone()[0] == "ok"
        assert conn.execute("select version_num from alembic_version").fetchone()[0] == "20260711_01"


def test_prepare_baseline_rejects_missing_required_table(tmp_path):
    db_path = tmp_path / "broken.db"
    sqlite3.connect(db_path).execute("create table users (id integer primary key)").connection.close()
    result = subprocess.run(
        [sys.executable, "scripts/prepare_alembic_baseline.py", "--database", str(db_path)],
        cwd=Path(__file__).resolve().parents[1],
        text=True, capture_output=True, check=False,
    )
    assert result.returncode == 2
    assert "missing_tables" in result.stdout
```

- [ ] **Step 2: Confirm the missing script failure**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_alembic_migrations.py -q
```

Expected: the two new tests fail because the script does not exist.

- [ ] **Step 3: Implement the preflight command**

Create `scripts/prepare_alembic_baseline.py` with these exact behaviors:

```python
import argparse
import json
import os
import sqlite3
import sys
from pathlib import Path

BASELINE = "20260711_01"
REQUIRED_TABLES = {
    "agents", "calls", "campus_visit_tasks", "dial_logs",
    "enrollment_records", "follow_up_assignments", "follow_ups",
    "home_visit_tasks", "lead_view_logs", "login_attempts", "notes",
    "operation_logs", "students", "system_configs", "tasks",
    "today_tasks", "users", "visits",
}
REQUIRED = {
    "users": {"id", "is_active", "token_version"},
    "students": {"id", "assigned_to", "status", "status_detail", "stage", "intent_level"},
    "dial_logs": {"id", "student_id", "agent_id", "recording_state"},
    "operation_logs": {"id", "action", "batch_id"},
    "follow_ups": {"id", "student_id", "agent_id", "is_completed"},
    "home_visit_tasks": {"id", "student_id", "creator_agent_id", "status"},
    "campus_visit_tasks": {"id", "student_id", "creator_user_id", "status"},
    "enrollment_records": {"id", "student_id", "attributed_agent_id", "settlement_status"},
}


def inspect_schema(path: Path) -> dict:
    with sqlite3.connect(path) as conn:
        tables = {row[0] for row in conn.execute("select name from sqlite_master where type='table'")}
        missing_tables = sorted(REQUIRED_TABLES - tables)
        missing_columns = {}
        for table, required in REQUIRED.items():
            if table not in tables:
                continue
            actual = {row[1] for row in conn.execute(f'pragma table_info("{table}")')}
            missing = sorted(required - actual)
            if missing:
                missing_columns[table] = missing
        return {
            "quick_check": conn.execute("pragma quick_check").fetchone()[0],
            "foreign_key_violations": len(conn.execute("pragma foreign_key_check").fetchall()),
            "missing_tables": missing_tables,
            "missing_columns": missing_columns,
        }


def apply_compatibility(path: Path) -> None:
    os.environ["DATABASE_PATH"] = str(path.resolve())
    os.environ.setdefault("SECRET_KEY", "baseline-preflight-only")
    from sqlalchemy import create_engine
    from app.legacy_schema_compat import run_legacy_schema_compatibility
    engine = create_engine(f"sqlite:///{path.resolve().as_posix()}")
    with engine.begin() as connection:
        run_legacy_schema_compatibility(connection)


def stamp(path: Path) -> None:
    from alembic import command
    from alembic.config import Config
    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", f"sqlite:///{path.resolve().as_posix()}")
    command.stamp(cfg, BASELINE)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database", required=True, type=Path)
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()
    if not args.database.is_file():
        print(json.dumps({"error": "database_not_found"}))
        return 2
    report = inspect_schema(args.database)
    if args.apply and (report["missing_columns"] or report["missing_tables"]):
        apply_compatibility(args.database)
        report = inspect_schema(args.database)
    valid = (
        report["quick_check"] == "ok"
        and report["foreign_key_violations"] == 0
        and not report["missing_tables"]
        and not report["missing_columns"]
    )
    if args.apply and valid:
        stamp(args.database)
        report["stamped_revision"] = BASELINE
    print(json.dumps(report, ensure_ascii=False, sort_keys=True))
    return 0 if valid else 2


if __name__ == "__main__":
    raise SystemExit(main())
```

Create `app/legacy_schema_compat.py` with one public function:

```python
from app.database import (
    _drop_legacy_student_phone_column,
    _drop_message_templates_table,
    _ensure_student_indexes,
    _migrate_admissions_workflow_tables,
    _migrate_dial_recording_state,
    _migrate_follow_up_columns,
    _migrate_legacy_student_stage_values,
    _migrate_legacy_student_status_values,
    _migrate_operation_log_batch_id,
    _migrate_operation_log_nullable,
    _migrate_student_phone_normalization,
    _migrate_student_status_detail,
    _migrate_user_device_tracking,
    _migrate_user_must_change_password,
    _migrate_user_operation_permissions,
    _migrate_user_page_permissions,
    _migrate_user_super_admin,
    _migrate_user_token_version,
)


def run_legacy_schema_compatibility(connection) -> None:
    for migration in (
        _drop_legacy_student_phone_column,
        _migrate_student_phone_normalization,
        _migrate_follow_up_columns,
        _drop_message_templates_table,
        _ensure_student_indexes,
        _migrate_user_token_version,
        _migrate_user_device_tracking,
        _migrate_user_must_change_password,
        _migrate_user_super_admin,
        _migrate_user_page_permissions,
        _migrate_user_operation_permissions,
        _migrate_operation_log_nullable,
        _migrate_operation_log_batch_id,
        _migrate_dial_recording_state,
        _migrate_student_status_detail,
        _migrate_legacy_student_status_values,
        _migrate_legacy_student_stage_values,
        _migrate_admissions_workflow_tables,
    ):
        migration(connection)
```

This function deliberately does not call `Base.metadata.create_all`; otherwise domain tables added after the baseline would be created before Alembic revision `20260711_02` runs.

- [ ] **Step 4: Run tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_alembic_migrations.py -q
```

Expected: all migration tests pass.

- [ ] **Step 5: Commit**

```powershell
git add app/legacy_schema_compat.py scripts/prepare_alembic_baseline.py tests/test_alembic_migrations.py
git commit -m "db: add safe baseline preflight"
```

---

### Task 4: Domain ORM Schema and Revision

**Files:**
- Create: `app/domain_models.py`
- Modify: `app/models.py`
- Create: `alembic/versions/20260711_02_domain_core_schema.py`
- Create: `tests/test_domain_models.py`

**Interfaces:**
- Produces enums and models named exactly `EmploymentStatus`, `WorkItemKind`, `WorkItemStatus`, `HandoverBatchStatus`, `HandoverItemStatus`, `HandoverTransferMode`, `HandoverTransferStatus`, `AgentEmployment`, `AgentEmploymentEvent`, `StudentAssignment`, `WorkItem`, `HandoverBatch`, `HandoverItem`, `HandoverTransfer`, `LeadOutcomeReason`.
- Adds `Student.outcome_reason_code: str | None` compatibility projection.

- [ ] **Step 1: Write failing metadata tests**

Create `tests/test_domain_models.py`:

```python
from sqlalchemy import inspect

from app.database import Base, sync_engine
from app.domain_models import EmploymentStatus, WorkItemKind, WorkItemStatus


def test_domain_tables_are_registered_and_created():
    Base.metadata.drop_all(sync_engine)
    Base.metadata.create_all(sync_engine)
    tables = set(inspect(sync_engine).get_table_names())
    assert {
        "agent_employment", "agent_employment_events", "student_assignments",
        "work_items", "handover_batches", "handover_items",
        "handover_transfers", "lead_outcome_reasons",
    } <= tables


def test_domain_enum_values_are_stable():
    assert [value.value for value in EmploymentStatus] == [
        "active", "suspended", "handover_pending", "offboarded"
    ]
    assert WorkItemKind.lead_contact.value == "lead_contact"
    assert WorkItemStatus.blocked_handover.value == "blocked_handover"


def test_students_have_outcome_reason_projection():
    Base.metadata.drop_all(sync_engine)
    Base.metadata.create_all(sync_engine)
    columns = {col["name"] for col in inspect(sync_engine).get_columns("students")}
    assert "outcome_reason_code" in columns
```

- [ ] **Step 2: Confirm missing-model failures**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_domain_models.py -q
```

Expected: import fails for `app.domain_models`.

- [ ] **Step 3: Create the domain model module**

Implement all fields and constraints from the approved spec. Use these exact enum values and index names:

```python
class EmploymentStatus(enum.StrEnum):
    active = "active"
    suspended = "suspended"
    handover_pending = "handover_pending"
    offboarded = "offboarded"

class WorkItemKind(enum.StrEnum):
    lead_contact = "lead_contact"
    scheduled_follow_up = "scheduled_follow_up"
    home_visit = "home_visit"
    campus_visit = "campus_visit"
    enrollment_settlement = "enrollment_settlement"
    help_request = "help_request"

class WorkItemStatus(enum.StrEnum):
    open = "open"
    blocked_suspension = "blocked_suspension"
    blocked_handover = "blocked_handover"
    completed = "completed"
    cancelled = "cancelled"
```

Use `SAEnum(EnumType, native_enum=False)` for every new enum so SQLite and PostgreSQL share stored string values. Define these mandatory database constraints:

```python
Index(
    "uq_student_assignments_active_student",
    "student_id",
    unique=True,
    sqlite_where=text("ended_at IS NULL"),
    postgresql_where=text("ended_at IS NULL"),
)
Index(
    "uq_handover_batches_active_source",
    "source_agent_id",
    unique=True,
    sqlite_where=text("status IN ('pending', 'in_progress')"),
    postgresql_where=text("status IN ('pending', 'in_progress')"),
)
UniqueConstraint("kind", "source_type", "source_id", name="uq_work_items_source")
UniqueConstraint("handover_batch_id", "student_id", name="uq_handover_items_student")
UniqueConstraint("idempotency_key", name="uq_handover_batches_idempotency")
UniqueConstraint("idempotency_key", name="uq_handover_transfers_idempotency")
```

Use the exact columns listed in the approved spec. All foreign keys point to existing integer IDs without cascade deletion. Timestamps use `func.now()` and naive UTC, matching existing models.

Implement this exact field matrix (all `id` columns are autoincrement integer primary keys unless noted):

| Model | Required columns | Nullable columns |
|---|---|---|
| `AgentEmployment` | `user_id` (PK/FK), `status`, `version`, `status_changed_at` | `offboarding_started_at`, `offboarded_at`, `updated_by` |
| `AgentEmploymentEvent` | `id`, `user_id`, `from_status`, `to_status`, `reason`, `created_at` | `operator_id`, `handover_batch_id` |
| `StudentAssignment` | `id`, `student_id`, `agent_id`, `started_at`, `start_reason`, `created_at`, `updated_at` | `ended_at`, `end_reason`, `started_by`, `ended_by`, `handover_batch_id`, `previous_assignment_id` |
| `WorkItem` | `id`, `student_id`, `kind`, `status`, `priority`, `source_type`, `source_id`, `version`, `created_at`, `updated_at` | `owner_agent_id`, `creator_user_id`, `due_at`, `completed_at`, `handover_batch_id` |
| `HandoverBatch` | `id`, `source_agent_id`, `status`, `version`, `total_items`, `remaining_items`, `transferred_items`, `initiated_by`, `initiated_at`, `idempotency_key` | `completed_by`, `completed_at` |
| `HandoverItem` | `id`, `handover_batch_id`, `student_id`, `source_assignment_id`, `status`, `conflict_code`, `conflict_message`, `created_at`, `updated_at` | `target_agent_id`, `transfer_id`, `transferred_at` |
| `HandoverTransfer` | `id`, `handover_batch_id`, `target_agent_id`, `mode`, `status`, `requested_count`, `transferred_count`, `conflict_count`, `operator_id`, `expected_batch_version`, `idempotency_key`, `created_at` | `completed_at` |
| `LeadOutcomeReason` | `code` (string PK), `label`, `terminal`, `reclaimable`, `active`, `sort_order` | none |

Conflict strings default to empty, count/version defaults are `0` except versions start at `1`, booleans match the approved catalog, and `priority` defaults to `medium`. Nullable fields default to `None`.

At the end of `app/models.py`, register the module:

```python
from app import domain_models as domain_models  # noqa: E402,F401
```

Add to `Student`:

```python
outcome_reason_code = Column(String(64), nullable=True)
```

- [ ] **Step 4: Run model tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_domain_models.py -q
```

Expected: `3 passed`.

- [ ] **Step 5: Generate and inspect revision `20260711_02`**

Create a fresh baseline DB, then autogenerate only the domain delta:

```powershell
$env:DATABASE_PATH=(Join-Path $env:TEMP 'crm-domain-schema.db')
$env:SECRET_KEY='migration-generation-only'
Remove-Item -LiteralPath $env:DATABASE_PATH -Force -ErrorAction SilentlyContinue
.venv-win\Scripts\alembic.exe upgrade 20260711_01
.venv-win\Scripts\alembic.exe revision --autogenerate --rev-id 20260711_02 -m "domain core schema"
```

Expected: the revision creates exactly eight new tables, adds nullable `students.outcome_reason_code`, creates both partial unique indexes, and has `down_revision = "20260711_01"`.

- [ ] **Step 6: Extend the migration test and run it**

Add to `tests/test_alembic_migrations.py`:

```python
def test_empty_database_upgrades_to_domain_schema(tmp_path):
    db_path = tmp_path / "domain.db"
    result = run_alembic(db_path, "upgrade", "20260711_02")
    assert result.returncode == 0, result.stderr
    tables = set(inspect(create_engine(f"sqlite:///{db_path.as_posix()}")).get_table_names())
    assert "student_assignments" in tables
    assert "work_items" in tables
    assert "handover_batches" in tables
```

Run:

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_domain_models.py tests/test_alembic_migrations.py -q
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```powershell
git add app/domain_models.py app/models.py alembic/versions/20260711_02_domain_core_schema.py tests/test_domain_models.py tests/test_alembic_migrations.py
git commit -m "db: add ownership and work item schema"
```

---

### Task 5: Idempotent Domain Backfill and Audit

**Files:**
- Create: `app/migration_data/__init__.py`
- Create: `app/migration_data/domain_backfill_20260711.py`
- Create: `alembic/versions/20260711_03_backfill_domain_core.py`
- Create: `scripts/audit_domain_backfill.py`
- Create: `tests/test_domain_backfill.py`

**Interfaces:**
- Produces: `backfill_domain_core(session: sqlalchemy.orm.Session, now: datetime) -> dict[str, int]`.
- Produces: `audit_domain_core(session: sqlalchemy.orm.Session) -> dict[str, object]`.
- Backfill is idempotent through table constraints and existence checks.

- [ ] **Step 1: Write synthetic backfill tests**

Create `tests/test_domain_backfill.py` with fixtures covering one active agent, one audited inactive agent, one suspended inactive agent, assigned/unassigned/terminal students, one open and one completed follow-up, pending/completed home visits, and the legacy invalid reason `报好了`. Assert:

```python
report = backfill_domain_core(sync_session, now=datetime(2026, 7, 11, 0, 0, 0))
assert report["employment_created"] == 3
assert report["assignments_created"] == 3
assert report["lead_work_items_created"] == 1
assert report["source_work_items_created"] == 2
assert report["outcomes_mapped"] == 1

audit = audit_domain_core(sync_session)
assert audit["ok"] is True
assert audit["active_assignment_projection_mismatches"] == 0
assert audit["duplicate_active_assignments"] == 0
assert audit["duplicate_source_work_items"] == 0

second = backfill_domain_core(sync_session, now=datetime(2026, 7, 11, 0, 0, 1))
assert all(value == 0 for key, value in second.items() if key.endswith("_created"))
```

Also assert `报好了` maps to `enrolled_elsewhere`, blank invalid reasons map to `legacy_unspecified`, and completed source records create no open work item.

- [ ] **Step 2: Confirm missing backfill failure**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_domain_backfill.py -q
```

Expected: import failure for `app.migration_data.domain_backfill_20260711`.

- [ ] **Step 3: Implement the frozen backfill module**

Use SQLAlchemy `Session` bound to the migration connection. The module must:

```python
OUTCOME_ROWS = (
    ("phone_invalid", "空号", True, True, 10),
    ("high_score", "高分段", True, True, 20),
    ("no_intent", "无意向", True, True, 30),
    ("child_declined", "孩子不想读", True, True, 40),
    ("enrolled_elsewhere", "已报名其他学校", True, False, 50),
    ("legacy_unspecified", "历史未注明", True, True, 90),
    ("other", "其他", True, True, 100),
)
```

Apply these deterministic mappings:

```python
REASON_CODE_BY_TEXT = {
    "空号": "phone_invalid",
    "高分段": "high_score",
    "无意向": "no_intent",
    "孩子不想读": "child_declined",
    "报好了": "enrolled_elsewhere",
    "已报名其他学校": "enrolled_elsewhere",
    "其他": "other",
}
```

- Employment: active users become `active`; inactive users with a matching `离职用户` log and no nonterminal assignment become `offboarded`; remaining inactive users become `suspended`.
- Assignment `started_at`: `assigned_at`, else `created_at`, else supplied `now`; use `start_reason="legacy_backfill"`.
- Lead work items: one `lead_contact` item for each assigned nonterminal student. Owner is the current assignee; status is `open` for active employment, otherwise `blocked_suspension`.
- Source work items: create from incomplete follow-ups, nonterminal home/campus visits, unsettled enrollments, and `need_help=true`; use current student assignee when present, otherwise the source creator.
- Source keys: `("student", student.id)`, `("follow_up", follow_up.id)`, `("home_visit", task.id)`, `("campus_visit", task.id)`, `("enrollment", record.id)`, and `("help", student.id)`.
- Audit must calculate only counts and IDs; never include personal text.

Implement `audit_domain_core` with these keys:

```python
{
    "ok": bool,
    "users_without_employment": int,
    "duplicate_active_assignments": int,
    "active_assignment_projection_mismatches": int,
    "open_items_without_owner": int,
    "open_items_owned_by_inactive": int,
    "duplicate_source_work_items": int,
    "invalid_reasons_without_catalog_entry": int,
    "foreign_key_violations": int,
}
```

- [ ] **Step 4: Add revision `20260711_03`**

Create a revision with `down_revision = "20260711_02"`. Its `upgrade()` creates `Session(bind=op.get_bind())`, calls `backfill_domain_core(session, utcnow())`, and flushes. Its `downgrade()` deletes only rows in the eight new domain tables and clears `students.outcome_reason_code`; it never deletes legacy records.

- [ ] **Step 5: Add the audit CLI**

`scripts/audit_domain_backfill.py` accepts `--database PATH`, opens a synchronous SQLite session in read-only URI mode, prints `json.dumps(audit, sort_keys=True)`, and exits `0` only when `audit["ok"]` is true.

- [ ] **Step 6: Run focused tests twice**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_domain_backfill.py tests/test_alembic_migrations.py -q
.venv-win\Scripts\python.exe -m pytest tests/test_domain_backfill.py tests/test_alembic_migrations.py -q
```

Expected: both runs pass; the second run proves tests do not depend on residue.

- [ ] **Step 7: Commit**

```powershell
git add app/migration_data alembic/versions/20260711_03_backfill_domain_core.py scripts/audit_domain_backfill.py tests/test_domain_backfill.py tests/test_alembic_migrations.py
git commit -m "db: backfill domain ownership state"
```

---

### Task 6: Snapshot Clone Migration and Production-Data Proof

**Files:**
- Create: `scripts/migrate_snapshot_clone.py`
- Create: `tests/test_snapshot_clone_migration.py`
- Modify: `README.md`

**Interfaces:**
- CLI: `python scripts/migrate_snapshot_clone.py --source SOURCE --destination DESTINATION`.
- The command refuses identical paths, refuses destinations outside the repository, never mutates source, and emits a JSON report.

- [ ] **Step 1: Write the failing clone test**

Create a small baseline SQLite source in `tmp_path`, run the CLI, then assert:

```python
assert result.returncode == 0, result.stderr
report = json.loads(result.stdout)
assert report["source_sha256_before"] == report["source_sha256_after"]
assert report["destination_quick_check"] == "ok"
assert report["destination_revision"] == "20260711_03"
assert report["domain_audit"]["ok"] is True
assert source.read_bytes() == original_bytes
```

Add refusal tests for identical source/destination and a destination outside the repository.

- [ ] **Step 2: Confirm missing-script failures**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_snapshot_clone_migration.py -q
```

Expected: failures because the CLI is missing.

- [ ] **Step 3: Implement clone/migrate/verify**

The command must perform, in order:

1. Resolve source, destination, and repository root.
2. Verify source exists and destination is a distinct path under the repository.
3. Hash source with SHA-256.
4. Copy with `shutil.copy2`.
5. Run `prepare_alembic_baseline.py --database DEST --apply`.
6. Run `alembic upgrade head` with `DATABASE_PATH=DEST`.
7. Run `audit_domain_backfill.py --database DEST`.
8. Run `pragma quick_check` and `pragma foreign_key_check` against DEST.
9. Rehash source and fail if it changed.
10. Print one JSON object containing hashes, sizes, revision, duration, integrity, and domain audit.

All subprocesses use `sys.executable`; failures remove only the newly created destination after verifying it is inside the repository.

- [ ] **Step 4: Run tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_snapshot_clone_migration.py -q
```

Expected: all clone-safety tests pass.

- [ ] **Step 5: Pull a fresh online-consistent server snapshot**

Use a new timestamp. On the server, invoke Python's SQLite backup API into `/home/qingwei/crm/backups/`; do not copy the live file directly. Then run remote `sha256sum` and `quick_check`, download with `scp -P 30002`, and verify the local hash matches. Store it under `backups/server-audit/` and do not overwrite the 2026-07-10 snapshot.

- [ ] **Step 6: Migrate a working clone of the fresh snapshot**

```powershell
$fresh = Get-ChildItem .\backups\server-audit\crm_server_audit_*.db | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$destination = ".\backups\server-audit\working\crm_domain_$stamp.db"
New-Item -ItemType Directory -Path .\backups\server-audit\working -Force
.venv-win\Scripts\python.exe scripts\migrate_snapshot_clone.py --source $fresh.FullName --destination $destination
```

Expected JSON:

- matching source hashes before/after;
- `destination_revision` equals `20260711_03`;
- `destination_quick_check` equals `ok`;
- foreign-key violations equal `0`;
- `domain_audit.ok` equals `true`.

- [ ] **Step 7: Document the local database switch rule**

Add to `README.md`: the immutable snapshot path, working-clone command, `DATABASE_PATH` switch, and the rule that root `crm.db` is backed up and local services stopped before switching.

- [ ] **Step 8: Run phase verification**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_migration_config.py tests/test_alembic_migrations.py tests/test_domain_models.py tests/test_domain_backfill.py tests/test_snapshot_clone_migration.py -q
.venv-win\Scripts\python.exe -m ruff check app alembic scripts tests
git status --short
```

Expected: all phase tests pass; Ruff reports `All checks passed!`; only implementation files plus the three pre-existing spec deletions appear before commit.

- [ ] **Step 9: Commit**

```powershell
git add scripts/migrate_snapshot_clone.py tests/test_snapshot_clone_migration.py README.md
git commit -m "test: prove production snapshot migration"
```

---

## Phase Acceptance Gate

- Empty DB upgrades from no revision to `20260711_03`.
- Existing snapshot clone preflights, stamps, upgrades, backfills, and audits successfully.
- Original snapshot SHA-256 does not change.
- Re-running backfill creates no duplicate employment, assignment, work-item, or outcome rows.
- Runtime routes still use legacy fields; no user-visible behavior changes in this phase.
- Do not start the dual-write phase until this gate is reviewed.

## Self-Review Notes

- Spec coverage: migration baseline, new tables, outcome catalog, production snapshot clone, idempotent backfill, privacy, integrity, and rollback safety are covered.
- Placeholder scan: generated Alembic revisions use fixed revision IDs and deterministic commands; no unknown filenames or interfaces remain.
- Type consistency: revision IDs are `20260711_01 -> 20260711_02 -> 20260711_03`; all later phase plans consume these exact IDs and model names.
