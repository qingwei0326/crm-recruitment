# 统一工作项读取切换与开发库验收 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut agent/admin queues and operational statistics over to the unified domain model, expose assignment history in timelines, replace startup schema mutation with revision checks, and finish acceptance on a migrated fresh server snapshot used as the local development database.

**Architecture:** A new read service returns one stable work-item contract. Legacy and domain reads run in parity tests and optional shadow audit before frontends switch; old endpoints remain for one release cycle. Deployment runs Alembic explicitly, and application startup refuses an out-of-date schema instead of mutating it.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, React Query, React, Vitest, Playwright, Alembic, SQLite, PowerShell.

## Global Constraints

- Requires all prior phase acceptance gates.
- Do not delete legacy tables or fields in this plan.
- Current responsibility comes from `student_assignments` and `work_items`.
- Historical activity comes from original call/note/source creator fields.
- Enrollment performance comes from `EnrollmentRecord.attributed_agent_id`.
- Old work-item endpoints remain available for one release cycle and at least 7 calendar days.
- The local root `crm.db` is replaced only after a timestamped local backup, stopped local services, and successful snapshot-clone migration/audit.
- Never replace or write the immutable downloaded server snapshot.
- No production deployment or database write is authorized by this plan.
- Use `.venv-win\Scripts\python.exe` and frontend `maxWorkers=8`.

---

## File Structure

- Create `app/work_item_query.py`.
- Create `app/routers/work_items.py`.
- Modify `app/main.py`.
- Create `tests/test_work_item_query.py` and `tests/test_work_item_contract_parity.py`.
- Create `frontend/src/domain/workItems.js` and `frontend/src/hooks/useWorkItems.js`.
- Modify agent desktop/mobile data hooks and views.
- Modify `AdminWorkCenter.jsx` and tests.
- Extend student timeline API and component with assignment history.
- Modify operational statistics to read current responsibility from new models.
- Create `app/database_version.py` and tests.
- Modify deploy/release scripts to run Alembic and consistency audit.
- Create final snapshot acceptance and Playwright checks.

---

### Task 1: Stable Unified Work-Item Read API

**Files:**
- Create: `app/work_item_query.py`
- Create: `app/routers/work_items.py`
- Modify: `app/main.py`
- Create: `tests/test_work_item_query.py`

**Interfaces:**
- `async query_work_items(db, current_user, filters: WorkItemFilters) -> dict`.
- `GET /api/work-items?queue=&status=&priority=&overdue=&agent_id=&page=&page_size=`.
- Agent scope is always current owner; admins may filter any owner.

- [ ] **Step 1: Write failing contract tests**

Assert each item returns:

```python
{
    "id": 41,
    "kind": "scheduled_follow_up",
    "queue": "follow_up",
    "status": "open",
    "priority": "high",
    "student_id": 7,
    "student_name": "合成学生",
    "region": "测试区",
    "school_name": "测试学校",
    "current_owner": {"id": 12, "name": "接手员工"},
    "creator": {"id": 9, "name": "原员工"},
    "due_at": "2026-07-11 03:00:00",
    "overdue": True,
    "source": {"type": "follow_up", "id": 3},
    "student": {
        "status": "待回访", "status_detail": "", "intent_level": "A", "stage": "有意向"
    },
    "target_url": "/agent?student=7",
}
```

Cover pagination, queue aliases, admin filtering, agent isolation, blocked states hidden from agents, completed filtering, invalid queue 422, and zero/empty pages.

- [ ] **Step 2: Implement filter dataclass and query**

```python
@dataclass(frozen=True)
class WorkItemFilters:
    queue: str = "all"
    status: str = "open"
    priority: str = ""
    overdue: bool | None = None
    agent_id: int | None = None
    page: int = 1
    page_size: int = 100
```

Use SQL joins and pagination, not Python loading of all rows. Compute overdue against `utcnow()`. Map kinds to queues in one constant. For agent users force `owner_agent_id=current_user.id` and `status=open` regardless of supplied `agent_id`.

- [ ] **Step 3: Add router validation and registration**

Page size range is 1-200. `agent_id` is honored only for admins. Use current `Response.ok` envelope and existing authentication.

- [ ] **Step 4: Run tests and commit**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_work_item_query.py -q
.venv-win\Scripts\python.exe -m ruff check app/work_item_query.py app/routers/work_items.py tests/test_work_item_query.py
git add app/work_item_query.py app/routers/work_items.py app/main.py tests/test_work_item_query.py
git commit -m "feat: expose unified work item queries"
```

Expected: tests and Ruff pass.

---

### Task 2: Legacy/Domain Contract Parity and Shadow Audit

**Files:**
- Create: `tests/test_work_item_contract_parity.py`
- Modify: `app/domain_consistency.py`
- Modify: `scripts/audit_domain_consistency.py`

**Interfaces:**
- Produces aggregate comparison by owner and queue between legacy builders and domain queries.
- Audit keys: `legacy_domain_queue_count_mismatches` and `legacy_domain_student_set_mismatches`.

- [ ] **Step 1: Write failing parity cases**

Seed every open/terminal source type, a reassigned student, a blocked handover, and one historical creator different from current owner. Assert domain and legacy operational student sets/counts agree after canonical queue mapping, except the intentionally fixed handover ownership case which must agree with the approved current-owner semantics.

- [ ] **Step 2: Implement aggregate-only parity helpers**

Do not include names/phones. Return queue, owner ID, legacy count, domain count, missing student IDs, and extra student IDs only in local test/debug mode; production CLI defaults to counts only.

- [ ] **Step 3: Run parity against the migrated snapshot clone**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_work_item_contract_parity.py -q
$workingClone = Get-ChildItem .\backups\server-audit\working\crm_domain_*.db -File |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
if (-not $workingClone) { throw 'No migrated working clone found; complete phase 1 Task 6 first.' }
$env:DATABASE_PATH=$workingClone.FullName
.venv-win\Scripts\python.exe scripts\audit_domain_consistency.py --database $env:DATABASE_PATH --expect-revision 20260711_03
```

Expected: tests pass and audit JSON has all mismatch counts at `0`.

- [ ] **Step 4: Commit**

```powershell
git add tests/test_work_item_contract_parity.py app/domain_consistency.py scripts/audit_domain_consistency.py
git commit -m "test: prove work item read parity"
```

---

### Task 3: Agent Desktop and Mobile Read Cutover

**Files:**
- Create: `frontend/src/domain/workItems.js`
- Create: `frontend/src/hooks/useWorkItems.js`
- Modify: `frontend/src/hooks/useAgentTasksQuery.js`
- Modify: `frontend/src/hooks/useAgentWork.js`
- Modify: `frontend/src/hooks/useTodayTasks.js`
- Modify: `frontend/src/pages/agent/AgentWorkDesktop.jsx`
- Modify: `frontend/src/pages/agent/AgentWorkMobile.jsx`
- Modify: `frontend/src/pages/mobile/MobileHome.jsx`
- Create/modify related tests.

**Interfaces:**
- Produces `normalizeWorkItem(item)` and `workItemStudent(item)`.
- Produces `useWorkItems(filters)` with query key `['work-items', filters]`.

- [ ] **Step 1: Write failing adapter/hook tests**

Assert normalized work items preserve item ID separately from student ID, current owner and creator, status/detail/intent/stage, due/overdue, and source. Assert filters serialize through Axios `params`, not hand-built query strings.

- [ ] **Step 2: Implement adapters and hook**

`workItemStudent` returns the existing student shape plus `_work_item` metadata so current table/detail components can migrate without changing student IDs.

- [ ] **Step 3: Switch queue reads**

- Today/pending view requests `queue=lead_contact`.
- Handled/following requests relevant open kinds and keeps current UI status filters client-visible.
- Mobile counts derive from returned `by_queue` summary, not reducer decrement guesses.
- Mutations invalidate `['work-items']` in addition to existing keys during the compatibility cycle.

- [ ] **Step 4: Update tests**

Replace endpoint expectations but preserve UI behavior tests for filtering, paging, dial completion, follow-up, empty state, and offline cache. Add creator/current-owner distinction assertions.

- [ ] **Step 5: Run tests and commit**

```powershell
cd frontend
npm test -- --run src/hooks/__tests__/useAgentWorkState.test.js src/hooks/__tests__/useTodayTasks.test.jsx src/pages/agent/desktop/__tests__/HandledView.test.jsx src/pages/mobile/__tests__/MobileHome.test.jsx
git add src/domain/workItems.js src/hooks/useWorkItems.js src/hooks/useAgentTasksQuery.js src/hooks/useAgentWork.js src/hooks/useTodayTasks.js src/pages/agent/AgentWorkDesktop.jsx src/pages/agent/AgentWorkMobile.jsx src/pages/mobile/MobileHome.jsx src/hooks/__tests__/useAgentWorkState.test.js src/hooks/__tests__/useTodayTasks.test.jsx src/pages/agent/desktop/__tests__/HandledView.test.jsx src/pages/mobile/__tests__/MobileHome.test.jsx
git commit -m "refactor: read agent queues from work items"
```

Expected: selected tests pass.

---

### Task 4: Admin Work Center Read Cutover

**Files:**
- Modify: `frontend/src/pages/admin/AdminWorkCenter.jsx`
- Modify: `frontend/src/pages/admin/AdminWorkflowComponents.jsx`
- Modify: `frontend/src/pages/admin/__tests__/AdminWorkCenter.test.jsx`
- Modify: `tests/e2e/admin-work-center-stale-a.spec.js`

**Interfaces:**
- Admin center reads `/work-items` and keeps stale-A as an explicit separate governance signal until modeled later.

- [ ] **Step 1: Write failing API/render tests**

Assert one request loads all domain queues, current owner and creator are distinguishable, completing help/follow-up invalidates work-item data, and blocked handover items link to the handover center for admins.

- [ ] **Step 2: Replace legacy work-item request**

Change `/admissions/work-items` to `/work-items`. Keep stale-A `Promise.allSettled` behavior. Map `kind`/`queue` through the shared frontend adapter and use `item.id` for stable rows.

- [ ] **Step 3: Run tests and commit**

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/AdminWorkCenter.test.jsx
cd ..
npx playwright test tests/e2e/admin-work-center-stale-a.spec.js
git add frontend/src/pages/admin/AdminWorkCenter.jsx frontend/src/pages/admin/AdminWorkflowComponents.jsx frontend/src/pages/admin/__tests__/AdminWorkCenter.test.jsx tests/e2e/admin-work-center-stale-a.spec.js
git commit -m "refactor: unify admin work center reads"
```

Expected: unit and Playwright tests pass.

---

### Task 5: Assignment History Timeline and Attribution-Safe Reports

**Files:**
- Modify: `app/routers/students_query.py`
- Modify: `app/routers/stats_agents.py`
- Modify: `app/routers/stats_enrollment.py`
- Modify: `app/routers/admissions_work_items.py`
- Modify: `frontend/src/components/StudentTimeline.jsx`
- Modify: `frontend/src/components/__tests__/StudentTimeline.test.jsx`
- Create: `tests/test_assignment_history_reporting.py`

**Interfaces:**
- Student timeline adds `assignment_history` events with old/new owner and reason.
- Operational workload uses active assignment/work-item owner.
- Historical calls/notes use actor; enrollment reports use attributed agent.

- [ ] **Step 1: Write failing backend attribution tests**

Create a student assigned from agent A to B. Seed A call/note/enrollment attribution and a B open work item. Assert:

- B owns current workload;
- A retains call/note/enrollment totals;
- assignment history reports A -> B once;
- inactive A remains visible in historical report ranges with data.

- [ ] **Step 2: Implement assignment history payload**

Return events:

```python
{
    "id": assignment.id,
    "type": "assignment",
    "occurred_at": assignment.started_at,
    "from_agent": {"id": previous.agent_id, "name": previous_name} if previous else None,
    "to_agent": {"id": assignment.agent_id, "name": current_name},
    "reason": assignment.start_reason,
    "handover_batch_id": assignment.handover_batch_id,
}
```

Never infer historical attribution from current `Student.assigned_to`.

- [ ] **Step 3: Render transfer events**

`StudentTimeline` adds kind `assignment_history`, uses `ArrowRightLeft`, title “员工交接” for handover reasons and “负责人变更” otherwise, and shows both names without replacing call/note actor labels.

- [ ] **Step 4: Run tests and commit**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_assignment_history_reporting.py tests/test_stats_reports.py tests/test_admissions_work_items.py -q
cd frontend
npm test -- --run src/components/__tests__/StudentTimeline.test.jsx
cd ..
git add app/routers/students_query.py app/routers/stats_agents.py app/routers/stats_enrollment.py app/routers/admissions_work_items.py frontend/src/components/StudentTimeline.jsx frontend/src/components/__tests__/StudentTimeline.test.jsx tests/test_assignment_history_reporting.py
git commit -m "fix: separate workload from historical attribution"
```

Expected: selected backend/frontend tests pass.

---

### Task 6: Explicit Database Revision Check and Deployment Migration

**Files:**
- Create: `app/database_version.py`
- Modify: `app/database.py`
- Modify: `app/main.py`
- Modify: `scripts/safe-ubuntu-deploy.sh`
- Modify: `deploy-update.ps1`
- Modify: `scripts/release-check.ps1`
- Create: `tests/test_database_version.py`

**Interfaces:**
- Produces `assert_database_revision(sync_engine, expected="20260711_03") -> None`.
- Production startup performs no DDL/data migration.

- [ ] **Step 1: Write failing revision tests**

Assert missing `alembic_version`, old version, and multiple version rows raise a startup error containing the exact expected/current revision; correct revision returns normally. Assert no startup code calls legacy migration helpers in production mode.

- [ ] **Step 2: Implement revision check**

```python
EXPECTED_DATABASE_REVISION = "20260711_03"

class DatabaseRevisionError(RuntimeError):
    pass

def assert_database_revision(engine, expected=EXPECTED_DATABASE_REVISION):
    inspector = inspect(engine)
    if "alembic_version" not in inspector.get_table_names():
        raise DatabaseRevisionError(
            f"数据库未建立版本标记，要求版本 {expected}；请先运行 alembic upgrade head"
        )
    with engine.connect() as connection:
        rows = connection.execute(
            text("select version_num from alembic_version")
        ).scalars().all()
    if len(rows) != 1:
        raise DatabaseRevisionError(
            f"数据库版本记录异常: {rows!r}；要求唯一版本 {expected}"
        )
    if rows[0] != expected:
        raise DatabaseRevisionError(
            f"数据库版本不匹配: 当前 {rows[0]}，要求 {expected}；请先运行 alembic upgrade head"
        )
```

Use SQLAlchemy inspection and a read-only select. Never stamp or upgrade from application startup.

- [ ] **Step 3: Change startup behavior**

`init_db()` may continue `Base.metadata.create_all` only when `DATABASE_PATH == ":memory:"` or `APP_ENV == "test"`. Normal lifespan calls `assert_database_revision(sync_engine)` before backup/schedulers.

Keep legacy migration functions in the repository for the compatibility script during this release; they are no longer called by normal startup.

- [ ] **Step 4: Run Alembic in deploy scripts**

After backup and before restart:

```bash
.venv-py312/bin/alembic upgrade head
.venv-py312/bin/python scripts/audit_domain_consistency.py --database crm.db --expect-revision 20260711_03
```

PowerShell deployment uses `.venv-win\Scripts\alembic.exe`. Abort restart on either nonzero result. Do not modify database before the deployment backup succeeds.

- [ ] **Step 5: Run tests and commit**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_database_version.py tests/test_config_env.py tests/test_database_indexes.py -q
.venv-win\Scripts\python.exe -m ruff check app scripts tests
git add app/database_version.py app/database.py app/main.py scripts/safe-ubuntu-deploy.sh deploy-update.ps1 scripts/release-check.ps1 tests/test_database_version.py
git commit -m "db: require explicit versioned migrations"
```

Expected: selected tests and Ruff pass.

---

### Task 7: Fresh Snapshot Final Migration and Local Development Database Switch

**Files:**
- Modify: `RELEASE-CHECKLIST.md`
- Create: `docs/runbooks/domain-migration-local-acceptance.md`
- Modify: E2E specs as required by final integrated behavior.

**Interfaces:**
- Final acceptance report contains aggregate counts, hashes, durations, revisions, test totals, and no PII.

- [ ] **Step 1: Pull and verify a fresh server snapshot**

Use the SQLite online backup API as in phase 1. Record remote/local SHA-256, size, UTC timestamp, `quick_check`, and foreign-key count. Keep the 2026-07-10 golden snapshot and every previous snapshot unchanged.

- [ ] **Step 2: Create and migrate a fresh working clone**

```powershell
$fresh = Get-ChildItem .\backups\server-audit\crm_server_audit_*.db | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$workDir = '.\backups\server-audit\working'
New-Item -ItemType Directory -Path $workDir -Force
$destination = Join-Path $workDir ("crm_domain_final_{0}.db" -f (Get-Date -Format 'yyyyMMdd_HHmmss'))
.venv-win\Scripts\python.exe scripts\migrate_snapshot_clone.py --source $fresh.FullName --destination $destination
```

Expected: revision `20260711_03`, quick check `ok`, zero FKs, and domain audit `ok=true`.

- [ ] **Step 3: Run every automated gate against disposable databases**

```powershell
.venv-win\Scripts\python.exe -m pytest -q
.venv-win\Scripts\python.exe -m ruff check app alembic scripts tests
cd frontend
npm test -- --reporter=dot
npm run lint
npm run build
cd ..
npx playwright test tests/e2e/handover-center.spec.js tests/e2e/handover-real-workflow.spec.js tests/e2e/admin-work-center-stale-a.spec.js
```

Expected: all backend tests, frontend tests, lint, build, and selected Playwright specs pass.

- [ ] **Step 4: Stop local services and back up root DB**

```powershell
.\stop.ps1
$localBackup = ".\backups\crm_local_before_domain_{0}.db" -f (Get-Date -Format 'yyyyMMdd_HHmmss')
Copy-Item -LiteralPath .\crm.db -Destination $localBackup
Get-FileHash -Algorithm SHA256 -LiteralPath .\crm.db,$localBackup
```

Expected: local service is stopped and both hashes match.

- [ ] **Step 5: Switch only the local development database**

```powershell
Copy-Item -LiteralPath $destination -Destination .\crm.db -Force
.\start.ps1
Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:8000/api/health' -TimeoutSec 10
```

Expected: health returns `code=0`, `db=ok`; application reports expected revision. Do not perform this copy while a local process has `crm.db` open.

- [ ] **Step 6: Browser acceptance on local migrated data**

Use the in-app browser/Playwright against localhost only. Verify admin login, account four-state filters, handover center empty/current states, work center queues, agent desktop/mobile queues, and “已报名其他学校”. Do not mutate real snapshot-derived students during visual inspection; mutation workflows remain on the synthetic E2E database.

- [ ] **Step 7: Document results and commit**

Write aggregate-only commands, expected outputs, rollback path (`stop -> restore $localBackup -> start`), and the local snapshot filename in the runbook. Update the release checklist with migration/audit gates.

```powershell
git add -f docs/runbooks/domain-migration-local-acceptance.md
git add RELEASE-CHECKLIST.md
git commit -m "docs: record domain migration acceptance"
```

---

## Program Acceptance Gate

- Fresh server snapshot is migrated on a clone with unchanged source hash.
- New/old operational queue parity is proven before read cutover.
- Agent/admin queues use unified work items and preserve existing workflows.
- Timelines and reports separate current responsibility from historical attribution.
- Application startup performs no production schema mutation.
- Local root DB is backed up and switched only after all automated gates pass.
- Local browser acceptance passes without mutating snapshot-derived student data.
- Production remains unchanged.

## Self-Review Notes

- Spec coverage: unified reads, parity, agent/admin cutover, history/report attribution, explicit migrations, fresh snapshot, local DB switch, and rollback are covered.
- Placeholder scan: current working-clone alias, revision, routes, commands, and acceptance assertions are explicit.
- Type consistency: API work-item fields match frontend adapters; all history/report tasks use phase-1 assignments and phase-2 services.
