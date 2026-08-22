# Season Archive and Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Provide a super-admin-only closeout flow that exports and backs up the current season, verifies both artifacts, then safely removes student business data while retaining system configuration and administrator AI settings.

**Architecture:** Add a durable SeasonCleanupRun record and a service with four phases: prepare, verify, confirm, execute. Reuse the existing SQLite Backup API and backup directory, add a readable ZIP export with CSV files and manifest counts, and execute deletes in an explicit foreign-key-safe order. The run record stores hashes, counts, status, and failure summaries without storing student payloads, so the closeout itself remains auditable after business data is removed.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, Alembic, SQLite Backup API, Python csv/zipfile/hashlib, React 18, Vite, Vitest, Testing Library, pytest, Playwright.

**Spec:** docs/superpowers/specs/2026-08-22-admissions-efficiency-design.md

## Global Constraints

- 超级管理员是唯一可以准备、校验、确认和执行招生季清理的角色。
- Only a super-admin can prepare, verify, confirm, or execute a season cleanup.
- The exact confirmation string is 确认清理招生季:{season_key}; a missing or mismatched string never deletes data.
- Backup SHA-256, export SHA-256, SQLite integrity, archive readability, and row-count checks must pass before the execute endpoint is enabled.
- A verification failure leaves the run in failed status and keeps all business data untouched.
- The cleanup must be idempotence-aware: an already cleaned run returns its recorded result and never runs deletes again.
- Student business tables are deleted in dependency order; users, permissions, system configs, catalogs, employment state, and administrator AI configuration remain.
- Retain `assistant_configs`; export and remove `assistant_sessions`, `assistant_runs`, `assistant_messages`, and `assistant_tool_calls` because they can contain season-specific student context.
- Student-associated operation logs are removed or reduced to non-student summaries; system-level login/config/cleanup audit rows remain.
- Backup and export artifacts are stored outside the public frontend directory and never contain .env, API keys, SSH tokens, or tunnel credentials.
- Existing scheduled backups and manual backup endpoints continue working.

## File Map

- Modify app/domain_models.py: add SeasonCleanupStatus and SeasonCleanupRun.
- Create alembic/versions/20260822_01_season_cleanup.py: create the durable cleanup-run table.
- Create app/services/season_cleanup_service.py: snapshot, export, backup, verify, delete order, and result reporting.
- Modify app/backup.py: expose a returnable database-backup artifact while preserving scheduler behavior.
- Create app/routers/admin_season_cleanup.py: super-admin API and artifact download.
- Modify app/main.py: include the router.
- Create tests/test_season_cleanup.py and modify tests/test_alembic_migrations.py.
- Create frontend/src/pages/admin/SeasonClose.jsx and its test.
- Modify frontend/src/App.jsx, frontend/src/pages/admin/SystemSettings.jsx, and admin navigation metadata.
- Create tests/e2e/season-close.spec.js.

### Task 1: Add the Durable Cleanup Run Model and Migration

**Files:**
- Modify: app/domain_models.py
- Create: alembic/versions/20260822_01_season_cleanup.py
- Create: tests/test_season_cleanup.py
- Modify: tests/test_alembic_migrations.py

**Interfaces:**
- Produce SeasonCleanupStatus values prepared, verified, confirmed, cleaned, and failed.
- Produce SeasonCleanupRun fields id, season_key, status, backup_path, export_path, backup_sha256, export_sha256, snapshot_counts_json, verification_json, failure_message, operator_id, confirmed_at, executed_at, created_at, and updated_at.
- The run record must not contain student name, phone, note, transcript, or other business payload.

- [ ] **Step 1: Write failing model and migration tests**

Add a test that runs the current Alembic upgrade against a temporary SQLite database and asserts table season_cleanup_runs exists with columns season_key, status, backup_sha256, export_sha256, snapshot_counts_json, verification_json, operator_id, confirmed_at, executed_at, and failure_message. Add a model test that creates one prepared run and reloads it through the async session.

- [ ] **Step 2: Run migration tests and verify they fail**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_alembic_migrations.py tests/test_season_cleanup.py -q
~~~

Expected: the table and model are absent.

- [ ] **Step 3: Implement the enum, model, and migration**

Add the enum/model to app/domain_models.py with a foreign key from operator_id to users.id and indexes on season_key, status, and created_at. Use Text JSON columns for counts and verification so the model works on SQLite and PostgreSQL.

Create alembic revision 20260822_01_season_cleanup.py with down_revision 20260726_01. The upgrade creates season_cleanup_runs and the downgrade drops only that table.

- [ ] **Step 4: Run migration/model tests**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_alembic_migrations.py tests/test_season_cleanup.py -q
~~~

Expected: all selected tests pass.

- [ ] **Step 5: Commit the model boundary**

~~~powershell
git add app/domain_models.py alembic/versions/20260822_01_season_cleanup.py tests/test_alembic_migrations.py tests/test_season_cleanup.py
git commit -m "feat: add season cleanup run model"
~~~

### Task 2: Implement Backup, Readable Export, and Verification

**Files:**
- Modify: app/backup.py
- Create: app/services/season_cleanup_service.py
- Modify: tests/test_season_cleanup.py

**Interfaces:**
- Produce BackupArtifact(path: Path, sha256: str, size: int, integrity_check: str).
- Produce ExportArtifact(path: Path, sha256: str, size: int, table_counts: dict[str, int]).
- Produce async create_season_backup(db, season_key) and async export_current_season(db, season_key).
- Produce async verify_season_artifacts(backup: BackupArtifact, export: ExportArtifact, expected_counts: dict[str, int]) -> dict.

- [ ] **Step 1: Add failing artifact tests**

Create a temporary SQLite database containing one student, one call, one note, one follow-up, one assignment, one work item, and one operation log. Assert that the export contains UTF-8 CSV files for students, calls, notes, follow_ups, student_assignments, work_items, and operation_logs plus manifest.json. Assert manifest counts equal the database snapshot and that the backup passes PRAGMA integrity_check and PRAGMA quick_check.

Add a failure test that changes the expected count after export and asserts verification returns ok=False with a count mismatch and does not mark any cleanup run executable.

- [ ] **Step 2: Run artifact tests and verify they fail**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_season_cleanup.py -q
~~~

Expected: artifact classes and season export functions do not exist.

- [ ] **Step 3: Extend the existing backup module**

Refactor the SQLite Backup API path in app/backup.py into a returnable helper that accepts a destination path, runs sqlite3.Connection.backup, closes both connections, computes SHA-256, and reports integrity_check/quick_check. Keep do_backup, do_backup_async, pruning, optional encryption, and scheduler behavior unchanged for existing callers.

In season_cleanup_service.py, define explicit table groups:

~~~python
SEASON_EXPORT_TABLES = (
    "students", "calls", "notes", "follow_ups", "lead_view_logs",
    "visits", "home_visit_tasks", "campus_visit_tasks",
    "enrollment_records", "dial_logs", "student_assignments",
    "work_items", "personal_groups", "personal_group_memberships",
    "handover_batches", "handover_transfers", "handover_items",
    "operation_logs", "assistant_sessions", "assistant_runs",
    "assistant_messages", "assistant_tool_calls",
)
~~~

Export each table as a UTF-8 CSV inside a ZIP named with the season key and timestamp. Write manifest.json with season_key, generated_at, table names, row counts, file names, archive SHA-256 placeholder, and schema version. The archive must be created under BACKUP_DIR or a configured private archive subdirectory, never frontend/dist.

Use standard library csv, zipfile, hashlib, sqlite3, and pathlib. Do not import pandas or include credentials.

- [ ] **Step 4: Implement verification**

Compute SHA-256 for both artifacts. Open the backup with sqlite3 in read-only mode and require both integrity_check and quick_check to equal ok. Open the ZIP, require manifest.json and every listed table file, parse CSV headers/rows, and compare each manifest count with expected pre-export counts. Return a structured report:

~~~python
{
    "ok": True,
    "backup": {"sha256": "...", "size": 123, "integrity_check": "ok", "quick_check": "ok"},
    "export": {"sha256": "...", "size": 456, "manifest_counts_match": True},
    "count_mismatches": [],
}
~~~

- [ ] **Step 5: Run artifact and backup regression tests**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_season_cleanup.py tests/test_sqlite_online_backup.py -q
~~~

Expected: all selected tests pass and existing online-backup behavior remains green.

- [ ] **Step 6: Commit artifact services**

~~~powershell
git add app/backup.py app/services/season_cleanup_service.py tests/test_season_cleanup.py
git commit -m "feat: export and verify season close artifacts"
~~~

### Task 3: Implement Safe Cleanup and API State Machine

**Files:**
- Modify: app/services/season_cleanup_service.py
- Create: app/routers/admin_season_cleanup.py
- Modify: app/main.py
- Modify: tests/test_season_cleanup.py

**Interfaces:**
- Produce async prepare_season_close(db, season_key, operator) -> SeasonCleanupRun.
- Produce async verify_season_close(db, run_id, operator) -> SeasonCleanupRun.
- Produce async execute_season_close(db, run_id, operator, confirmation) -> dict.
- Produce GET /api/admin/season-cleanup/preflight?season_key=...
- Produce POST /api/admin/season-cleanup/prepare.
- Produce POST /api/admin/season-cleanup/{run_id}/verify.
- Produce POST /api/admin/season-cleanup/{run_id}/execute.
- Produce GET /api/admin/season-cleanup/{run_id}/artifact/{kind} for private backup/export download.

- [ ] **Step 1: Add failing state and deletion tests**

Seed one row in every student business table listed in Task 2, plus a user, AgentEmployment, SystemConfig, LeadOutcomeReason, LoginAttempt, an assistant_configs row, and one row in each assistant session/run/message/tool-call table. Test this sequence:

~~~python
preflight = await client.get(
    "/api/admin/season-cleanup/preflight?season_key=2026",
    headers=super_admin_headers,
)
assert preflight.json()["data"]["ready_to_prepare"] is True

prepared = await client.post(
    "/api/admin/season-cleanup/prepare",
    headers=super_admin_headers,
    json={"season_key": "2026"},
)
run_id = prepared.json()["data"]["id"]

verified = await client.post(
    f"/api/admin/season-cleanup/{run_id}/verify",
    headers=super_admin_headers,
)
assert verified.json()["data"]["status"] == "verified"

missing_confirmation = await client.post(
    f"/api/admin/season-cleanup/{run_id}/execute",
    headers=super_admin_headers,
    json={"confirmation": "确认清理"},
)
assert missing_confirmation.status_code == 400
~~~

Then execute with confirmation 确认清理招生季:2026 and assert students, calls, notes, follow-ups, visits, enrollment, assignments, work items, handover business rows, assistant session/run/message/tool-call rows, and student-associated operation logs are gone. Assert users, permissions, system_configs, catalogs, employment state, login attempts, assistant_configs, and the cleanup run remain.

Add normal-admin and agent tests asserting every prepare/verify/execute/download endpoint returns 403.

- [ ] **Step 2: Run state tests and verify they fail**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_season_cleanup.py -q
~~~

Expected: endpoints and cleanup service do not exist.

- [ ] **Step 3: Implement prepare and verify endpoints**

All endpoints use require_super_admin. preflight returns table counts, latest existing run for the season, artifact directory, and whether a new preparation is allowed. prepare creates a new run with status prepared, snapshots counts, calls the backup/export functions, and stores only paths, hashes, sizes, and counts.

verify reloads the run, reruns artifact verification against the stored snapshot, stores verification_json, and changes status to verified only when every check passes. On any failure, set status failed, store a concise failure_message, and leave all business tables untouched.

Use Pydantic request models with season_key matching ^[0-9]{4}(-[A-Za-z0-9_-]+)?$ and confirmation as a non-empty string. Reject verify/execute for a run belonging to another season only through its run ID lookup; never accept a client-provided table list.

- [ ] **Step 4: Implement explicit deletion order and idempotence**

Require run status verified and exact confirmation 确认清理招生季:{season_key}. Delete in this order:

~~~text
personal_group_memberships
handover_items
work_items
dial_logs
calls
notes
follow_ups
lead_view_logs
visits
home_visit_tasks
campus_visit_tasks
enrollment_records
student_assignments
personal_groups
handover_transfers
handover_batches
assistant_tool_calls
assistant_messages
assistant_runs
assistant_sessions
student-associated operation_logs
students
~~~

Keep users, system_configs, lead_outcome_reasons, agent_employment, agent_employment_events, login_attempts, and season_cleanup_runs. Preserve system-level operation logs for login, configuration, cleanup preparation/verification/execution, and permission changes. Remove rows with target_student_id, business-action batch summaries, student payload in content, or student-associated batch IDs; write one non-student cleanup summary after deletion.

Perform deletion in one database transaction. On an exception, roll back all deletes, open a separate session to mark the run failed, and return an error with completed-table information only in the server log, not as a success response. If status is already cleaned, return its stored verification and counts without executing deletes again.

After deletion, run table counts and SQLite integrity checks. Mark cleaned only when expected business counts are zero and retained system checks pass.

- [ ] **Step 5: Run API and cleanup tests**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_season_cleanup.py tests/test_alembic_migrations.py tests/test_sqlite_online_backup.py -q
~~~

Expected: all selected tests pass, including failed verification blocking cleanup and repeated execute being idempotent.

- [ ] **Step 6: Commit the API/state machine**

~~~powershell
git add app/services/season_cleanup_service.py app/routers/admin_season_cleanup.py app/main.py tests/test_season_cleanup.py
git commit -m "feat: add verified season cleanup state machine"
~~~

### Task 4: Build the Super-Admin Closeout UI

**Files:**
- Create: frontend/src/pages/admin/SeasonClose.jsx
- Create: frontend/src/pages/admin/__tests__/SeasonClose.test.jsx
- Modify: frontend/src/App.jsx
- Modify: frontend/src/pages/admin/SystemSettings.jsx
- Modify: frontend/src/adminPermissions.js only if a navigation label needs a non-permission constant.

**Interfaces:**
- Consume preflight, prepare, verify, execute, and artifact download endpoints.
- Protect the route in the UI by requiring user.is_super_admin; backend remains authoritative.
- Render states preflight, prepared, verifying, verified, failed, cleaned, and blocked.

- [ ] **Step 1: Add failing UI tests**

Mock the full API sequence and assert:

~~~jsx
expect(screen.getByRole("heading", { name: "招生季归档与清理" })).toBeInTheDocument();
expect(screen.getByText("清理前必须完成备份、导出和校验")).toBeInTheDocument();
expect(screen.queryByRole("button", { name: "执行清理" })).not.toBeInTheDocument();
~~~

After a verified response, assert that the confirmation input is shown, the exact phrase is required, the execute request contains that phrase, and the cleaned response shows retained configuration checks. Add a failure mock and assert execute is disabled.

- [ ] **Step 2: Run UI tests and verify they fail**

~~~powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SeasonClose.test.jsx src/__tests__/App.routes.test.jsx
~~~

Expected: the route and component do not exist.

- [ ] **Step 3: Implement the closeout page and navigation**

Create one focused page with season key input, preflight table counts, preparation button, artifact hashes/download links, verification report, and a confirmation input. Keep execute disabled unless status is verified and the input equals 确认清理招生季:{season_key}. Show failed verification reasons and never replace them with a generic success toast.

Add a lazy route /admin/season-close guarded by super-admin UI state. Add a compact link from the existing SystemSettings backup section; do not place a destructive action beside the ordinary 6-hour/manual backup button without the state gate.

- [ ] **Step 4: Run UI tests and build**

~~~powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/SeasonClose.test.jsx src/__tests__/App.routes.test.jsx src/pages/admin/__tests__/AssistantSettings.test.jsx
npm run build
~~~

Expected: all selected tests pass and Vite exits with code 0.

- [ ] **Step 5: Commit the closeout UI**

~~~powershell
git add frontend/src/pages/admin/SeasonClose.jsx frontend/src/pages/admin/__tests__/SeasonClose.test.jsx frontend/src/App.jsx frontend/src/pages/admin/SystemSettings.jsx
git commit -m "feat: add super-admin season closeout page"
~~~

### Task 5: Recovery and Production-Scale Verification

**Files:**
- Create: tests/e2e/season-close.spec.js
- Modify: tests/test_season_cleanup.py only for verified regression coverage.

**Interfaces:**
- Consume the full closeout state machine and UI.
- Produce evidence for backup/export/download, failed verification blocking, successful cleanup, retained configuration, and idempotent retry.

- [ ] **Step 1: Add browser smoke coverage**

Mock preflight, prepare, verify, and execute. Assert the page does not expose execute before verification, exposes the exact confirmation input after verification, downloads both artifact links, and shows a cleaned state after the final response. Add a second scenario where verify returns failed and assert the execute button remains disabled.

- [ ] **Step 2: Run service, migration, frontend, and browser checks**

~~~powershell
.venv-win\Scripts\python.exe -m pytest tests/test_season_cleanup.py tests/test_alembic_migrations.py tests/test_sqlite_online_backup.py -q
cd frontend
npm test -- --run src/pages/admin/__tests__/SeasonClose.test.jsx src/__tests__/App.routes.test.jsx
npm run build
cd ..
npx playwright test tests/e2e/season-close.spec.js
~~~

Expected: all selected tests pass, build succeeds, and Playwright reports the closeout scenarios as passing.

- [ ] **Step 3: Perform a non-production restore rehearsal**

Copy the generated database backup to a temporary SQLite path, open it read-only, run both integrity checks, and query the manifest counts against the backup. Run the cleanup against a disposable clone only, then verify the clone has zero student business rows while the original backup still contains the exported rows.

- [ ] **Step 4: Commit the recovery smoke test**

~~~powershell
git add tests/e2e/season-close.spec.js tests/test_season_cleanup.py
git commit -m "test: verify season close recovery and cleanup"
~~~

## Self-Review Notes

- The plan covers export, backup, hash, integrity, row-count verification, super-admin confirmation, dependency-safe deletion, student-associated log handling, retained configuration, failed verification blocking, idempotence, UI states, and restore rehearsal.
- No existing scheduled backup is repurposed for destructive cleanup.
- The cleanup run record and non-student summary log survive business-data deletion, while private artifacts remain outside frontend/static paths.
