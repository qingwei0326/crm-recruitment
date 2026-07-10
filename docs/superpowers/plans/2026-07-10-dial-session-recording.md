# Dial Session Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every dial attempt carry a stable `dial_log_id`, persist its lifecycle, complete it from every supported result path, and separate legacy missing durations from current pending sessions.

**Architecture:** Extend `DialLog` with a string lifecycle state and migrate existing rows idempotently at application startup. Return the existing row ID from phone reveal, update duration by that exact ID, and centralize browser session persistence in one frontend module. Preserve existing response fields for compatibility while moving dashboards and scoring to explicit lifecycle fields.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, SQLite/PostgreSQL-compatible startup migrations, React 18, Axios, Vitest, Testing Library, Playwright.

## Global Constraints

- Do not deploy to or mutate the server during this plan.
- Do not invent or backfill historical duration values.
- Existing zero-duration rows become `legacy_missing`; existing positive-duration rows become `completed`.
- New phone reveals create `pending` sessions and successful duration writes mark them `completed`.
- Keep old phone and duration clients working when they omit `dial_log_id`.
- Do not add dependencies.
- Do not include the user's three pre-existing deleted design documents in any commit.
- Treat recorded seconds as dial workflow elapsed time, not carrier call duration.

---

## File Map

**Create:**

- `app/dial_recording.py`: lifecycle constants shared by models, migrations, routers, and reports.
- `frontend/src/dialSession.js`: the only module that reads, writes, completes, or clears `pendingDial`.
- `frontend/src/__tests__/dialSession.test.js`: unit coverage for persistent session behavior.

**Modify:**

- `app/models.py`: add `DialLog.recording_state`.
- `app/database.py`: add the idempotent startup migration.
- `app/routers/students_phone.py`: return/reuse `dial_log_id` and update an exact row.
- `app/routers/admin_governance.py`: state-aware data quality metrics and correct CST month boundary.
- `app/routers/admin_users.py`: state-aware agent score-preview metrics.
- `app/routers/stats_agents.py`: state-aware personal/monthly call metrics.
- `app/routers/operation_logs.py`: state-aware call-volume summary and rows.
- `app/agent_score.py`: only pending current sessions trigger recording-quality warnings.
- `frontend/src/hooks/useDialFlow.js`: persist the returned session ID and reuse matching pending sessions.
- `frontend/src/hooks/useAgentDial.js`: use the shared session module for the workbench flow.
- `frontend/src/components/MobileDialResult.jsx`: await completion and retain failed sessions.
- `frontend/src/pages/mobile/MobileStudentDetail.jsx`: finish a matching session after direct status updates.
- `frontend/src/components/StudentTimeline.jsx`: render pending and legacy labels explicitly.
- `frontend/src/pages/admin/AdminMobileDash.jsx`: split pending from legacy.
- `frontend/src/pages/admin/SystemSettings.jsx`: split pending from legacy and update ranking copy.
- `frontend/src/pages/admin/CallVolumeQuery.jsx`: show lifecycle totals and row labels.
- `frontend/src/pages/admin/AgentScorePreview.jsx`: display current pending sessions.
- `frontend/src/pages/agent/desktop/AgentStatsSummary.jsx`: split current pending from historical legacy.
- Existing backend, frontend, and Playwright test files listed in each task.

---

### Task 1: Add Dial Recording Lifecycle And Idempotent Migration

**Files:**

- Create: `app/dial_recording.py`
- Modify: `app/models.py:511-520`
- Modify: `app/database.py:42-62`
- Test: `tests/test_database_indexes.py`

**Interfaces:**

- Produces: `DIAL_RECORDING_PENDING`, `DIAL_RECORDING_COMPLETED`, `DIAL_RECORDING_LEGACY_MISSING` string constants.
- Produces: `_migrate_dial_recording_state(sync_connection) -> None`.
- Produces: `DialLog.recording_state: str` with default `pending`.

- [ ] **Step 1: Write the failing migration tests**

Add an isolated legacy-table test so the test does not mutate the normal test schema:

```python
from sqlalchemy import create_engine, inspect

from app.database import _migrate_dial_recording_state


def test_dial_recording_state_migration_classifies_existing_rows_and_is_idempotent():
    engine = create_engine("sqlite://")
    with engine.begin() as conn:
        conn.exec_driver_sql(
            "CREATE TABLE dial_logs ("
            "id INTEGER PRIMARY KEY, duration_seconds INTEGER DEFAULT 0)"
        )
        conn.exec_driver_sql(
            "INSERT INTO dial_logs (id, duration_seconds) VALUES (1, 0), (2, 45)"
        )
        _migrate_dial_recording_state(conn)
        _migrate_dial_recording_state(conn)

        rows = conn.exec_driver_sql(
            "SELECT id, recording_state FROM dial_logs ORDER BY id"
        ).all()

    assert rows == [(1, "legacy_missing"), (2, "completed")]
    assert "recording_state" in {
        column["name"] for column in inspect(engine).get_columns("dial_logs")
    }
    assert "ix_dial_logs_recording_state" in {
        index["name"] for index in inspect(engine).get_indexes("dial_logs")
    }
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
\.venv-win\Scripts\python.exe -m pytest tests/test_database_indexes.py -q
```

Expected: collection fails because `_migrate_dial_recording_state` does not exist.

- [ ] **Step 3: Add constants, model column, and migration**

Create `app/dial_recording.py`:

```python
DIAL_RECORDING_PENDING = "pending"
DIAL_RECORDING_COMPLETED = "completed"
DIAL_RECORDING_LEGACY_MISSING = "legacy_missing"

DIAL_RECORDING_STATES = frozenset(
    {
        DIAL_RECORDING_PENDING,
        DIAL_RECORDING_COMPLETED,
        DIAL_RECORDING_LEGACY_MISSING,
    }
)
```

Add to `DialLog`:

```python
from app.dial_recording import DIAL_RECORDING_PENDING

recording_state = Column(
    String(24),
    nullable=False,
    default=DIAL_RECORDING_PENDING,
    server_default=DIAL_RECORDING_PENDING,
    index=True,
)
```

Register and implement the startup migration in `app/database.py`:

```python
from app.dial_recording import (
    DIAL_RECORDING_COMPLETED,
    DIAL_RECORDING_LEGACY_MISSING,
    DIAL_RECORDING_PENDING,
)


def _migrate_dial_recording_state(sync_connection):
    inspector = inspect(sync_connection)
    if "dial_logs" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("dial_logs")}
    if "recording_state" not in columns:
        if DB_ENGINE == "postgresql":
            sync_connection.execute(
                text(
                    "ALTER TABLE dial_logs ADD COLUMN IF NOT EXISTS recording_state "
                    "VARCHAR(24) NOT NULL DEFAULT 'pending'"
                )
            )
        else:
            sync_connection.execute(
                text(
                    "ALTER TABLE dial_logs ADD COLUMN recording_state "
                    "VARCHAR(24) NOT NULL DEFAULT 'pending'"
                )
            )
        sync_connection.execute(
            text(
                "UPDATE dial_logs SET recording_state = CASE "
                "WHEN COALESCE(duration_seconds, 0) > 0 THEN :completed "
                "ELSE :legacy_missing END"
            ),
            {
                "completed": DIAL_RECORDING_COMPLETED,
                "legacy_missing": DIAL_RECORDING_LEGACY_MISSING,
            },
        )
    sync_connection.execute(
        text(
            "CREATE INDEX IF NOT EXISTS ix_dial_logs_recording_state "
            "ON dial_logs(recording_state)"
        )
    )
```

Call `_migrate_dial_recording_state` from `init_db()` after `Base.metadata.create_all`.

- [ ] **Step 4: Run migration and model tests**

Run:

```powershell
\.venv-win\Scripts\python.exe -m pytest tests/test_database_indexes.py -q
\.venv-win\Scripts\python.exe -m pytest tests/test_call_volume.py -q
```

Expected: both commands pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add app/dial_recording.py app/models.py app/database.py tests/test_database_indexes.py
git commit -m "feat: add dial recording lifecycle"
```

---

### Task 2: Bind Phone Reveal And Duration Updates To An Exact Dial Log

**Files:**

- Modify: `app/routers/students_phone.py:28-168`
- Test: `tests/test_students.py:784-823`
- Test: `tests/test_edge_cases.py:228-273`

**Interfaces:**

- `GET /api/students/phone/{student_id}?dial_log_id=<optional>` returns `data.dial_log_id`.
- `PUT /api/students/dial-duration` accepts optional `dial_log_id` and marks the selected row completed.
- Explicit invalid IDs never fall back to a different row.

- [ ] **Step 1: Write failing phone-session tests**

Extend the existing phone tests with these assertions:

```python
first = await client.get(f"/api/students/phone/{student.id}", headers=agent_headers)
dial_log_id = first.json()["data"]["dial_log_id"]
assert isinstance(dial_log_id, int)

second = await client.get(
    f"/api/students/phone/{student.id}",
    params={"dial_log_id": dial_log_id},
    headers=agent_headers,
)
assert second.json()["data"]["dial_log_id"] == dial_log_id
assert await db.scalar(
    select(func.count(DialLog.id)).where(
        DialLog.student_id == student.id,
        DialLog.agent_id == agent_user.id,
    )
) == 1
```

Add a second test that creates a pending row 90 seconds ago, calls without an ID, and asserts the same row is reused. Add a third test that marks the row completed and asserts a new phone reveal creates a new ID.

- [ ] **Step 2: Write failing exact-duration tests**

Add to `tests/test_edge_cases.py`:

```python
resp = await client.put(
    "/api/students/dial-duration",
    params={
        "student_id": sample_student.id,
        "dial_log_id": older.id,
        "duration_seconds": 73,
    },
    headers=admin_headers,
)
assert resp.json()["data"]["id"] == older.id
await db.refresh(older)
await db.refresh(latest)
assert older.duration_seconds == 73
assert older.recording_state == "completed"
assert latest.duration_seconds == 0
assert latest.recording_state == "pending"
```

Also add an ownership mismatch case and assert neither row changes.

- [ ] **Step 3: Run the focused tests and verify they fail**

```powershell
\.venv-win\Scripts\python.exe -m pytest tests/test_students.py -k "phone and dial" -q
\.venv-win\Scripts\python.exe -m pytest tests/test_edge_cases.py -k "dial_duration" -q
```

Expected: failures show missing `dial_log_id` and latest-row updates.

- [ ] **Step 4: Implement exact session lookup and response IDs**

Add the optional parameter and reusable query helpers:

```python
DIAL_PENDING_REUSE_SECONDS = 120


async def _get_reusable_dial_log(
    db: AsyncSession,
    *,
    student_id: int,
    agent_id: int,
    dial_log_id: int | None,
) -> DialLog | None:
    if dial_log_id is not None:
        result = await db.execute(
            select(DialLog).where(
                DialLog.id == dial_log_id,
                DialLog.student_id == student_id,
                DialLog.agent_id == agent_id,
                DialLog.recording_state == DIAL_RECORDING_PENDING,
            )
        )
        dial_log = result.scalar_one_or_none()
        if dial_log is None:
            raise HTTPException(status_code=400, detail="拨号会话无效或已完成")
        return dial_log

    reuse_since = utcnow() - timedelta(seconds=DIAL_PENDING_REUSE_SECONDS)
    result = await db.execute(
        select(DialLog)
        .where(
            DialLog.student_id == student_id,
            DialLog.agent_id == agent_id,
            DialLog.recording_state == DIAL_RECORDING_PENDING,
            DialLog.dialed_at >= reuse_since,
        )
        .order_by(DialLog.dialed_at.desc(), DialLog.id.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
```

Create new rows with `recording_state=DIAL_RECORDING_PENDING`, call `await db.flush()` before building the response, and include `dial_log_id` in every success response, including the existing three-second duplicate branch.

Update the duration query:

```python
if dial_log_id is not None:
    query = select(DialLog).where(
        DialLog.id == dial_log_id,
        DialLog.student_id == student_id,
        DialLog.agent_id == current_user.id,
    )
else:
    query = (
        select(DialLog)
        .where(DialLog.student_id == student_id, DialLog.agent_id == current_user.id)
        .order_by(DialLog.dialed_at.desc(), DialLog.id.desc())
        .limit(1)
    )

dial_log.duration_seconds = duration_seconds
dial_log.recording_state = DIAL_RECORDING_COMPLETED
```

- [ ] **Step 5: Run phone and duration tests**

```powershell
\.venv-win\Scripts\python.exe -m pytest tests/test_students.py -k "phone or call_result" -q
\.venv-win\Scripts\python.exe -m pytest tests/test_edge_cases.py -k "dial_duration" -q
```

Expected: all selected tests pass, including old no-ID behavior.

- [ ] **Step 6: Commit Task 2**

```powershell
git add app/routers/students_phone.py tests/test_students.py tests/test_edge_cases.py
git commit -m "fix: bind duration to exact dial session"
```

---

### Task 3: Make Backend Reports And Scoring State-Aware

**Files:**

- Modify: `app/routers/admin_governance.py:204-375`
- Modify: `app/routers/admin_users.py:321-421`
- Modify: `app/routers/stats_agents.py:47-148`
- Modify: `app/routers/operation_logs.py:298-368`
- Modify: `app/agent_score.py:159-218`
- Test: `tests/test_admin.py:1080-1134`
- Test: `tests/test_call_volume.py:8-123, 512-542`
- Test: existing agent-score assertions in `tests/test_admin.py:250-300`

**Interfaces:**

- Compatibility: existing `recorded_calls` and `unrecorded_calls` remain.
- New fields: `pending_dial_sessions`, `legacy_missing_duration`, and `completed_dial_sessions` at summary level.
- Agent variants use `today_...` and `month_...` prefixes.
- Scoring consumes `today_pending_dial_sessions`, not combined legacy totals.

- [ ] **Step 1: Write failing state-aware report tests**

Create one row per state and assert both new and compatibility fields:

```python
assert data["calls"]["today"] == {
    "total_calls": 3,
    "recorded_calls": 1,
    "unrecorded_calls": 2,
    "completed_dial_sessions": 1,
    "pending_dial_sessions": 1,
    "legacy_missing_duration": 1,
}
```

For call volume, assert every row returns `recording_state`, and the summary contains all three lifecycle counts. For agent stats, assert `today_pending_dial_sessions` and `today_legacy_missing_duration` are separate.

Add a score-preview case where an agent has only `legacy_missing` rows and assert `unrecorded_call_duration` is absent; then add one pending row and assert the signal is present.

- [ ] **Step 2: Add a CST month-boundary regression test**

Monkeypatch the governance module's date helpers so July 1 CST is included:

```python
monkeypatch.setattr(admin_governance, "today_cst_as_utc", lambda: datetime(2026, 7, 9, 16))
monkeypatch.setattr(admin_governance, "month_start_cst_as_utc", lambda: datetime(2026, 6, 30, 16))
```

Insert a row at `2026-06-30 16:30 UTC` and assert it is included in July month totals.

- [ ] **Step 3: Run focused report tests and verify they fail**

```powershell
\.venv-win\Scripts\python.exe -m pytest tests/test_admin.py -k "data_quality or score_preview" -q
\.venv-win\Scripts\python.exe -m pytest tests/test_call_volume.py -q
```

Expected: failures show missing lifecycle fields and incorrect scoring input.

- [ ] **Step 4: Implement lifecycle counts and month boundary fix**

Use explicit state clauses:

```python
completed_clause = DialLog.recording_state == DIAL_RECORDING_COMPLETED
pending_clause = DialLog.recording_state == DIAL_RECORDING_PENDING
legacy_clause = DialLog.recording_state == DIAL_RECORDING_LEGACY_MISSING
unrecorded_clause = or_(pending_clause, legacy_clause)
```

In `admin_governance.py`, replace:

```python
month_start = today.replace(day=1)
```

with:

```python
month_start = month_start_cst_as_utc()
```

Return the explicit counts while keeping `unrecorded_calls = pending + legacy`. Apply the same clauses to personal stats, score-preview metrics, and call-volume summaries. Add `recording_state` to each call-volume row. Base the data-quality top-level warning state on current pending sessions, not `legacy_missing`, so historical debt remains visible without making system health permanently yellow.

Change `_build_signals` to read:

```python
today_pending_dial_sessions = _as_int(metrics.get("today_pending_dial_sessions"))
if today_pending_dial_sessions > 0:
    pending_ratio = today_pending_dial_sessions / today_calls if today_calls else 1
    signals.append(
        {
            "key": "unrecorded_call_duration",
            "severity": "warning" if today_calls >= 5 and pending_ratio >= 0.5 else "info",
            "label": f"{today_pending_dial_sessions} 通待完成记录",
            "count": today_pending_dial_sessions,
        }
    )
```

- [ ] **Step 5: Run backend reporting tests**

```powershell
\.venv-win\Scripts\python.exe -m pytest tests/test_admin.py -k "data_quality or score_preview" -q
\.venv-win\Scripts\python.exe -m pytest tests/test_call_volume.py -q
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit Task 3**

```powershell
git add app/routers/admin_governance.py app/routers/admin_users.py app/routers/stats_agents.py app/routers/operation_logs.py app/agent_score.py tests/test_admin.py tests/test_call_volume.py
git commit -m "fix: separate pending and legacy dial metrics"
```

---

### Task 4: Centralize Frontend Pending Dial Sessions

**Files:**

- Create: `frontend/src/dialSession.js`
- Create: `frontend/src/__tests__/dialSession.test.js`
- Modify: `frontend/src/hooks/useDialFlow.js`
- Modify: `frontend/src/hooks/useAgentDial.js`
- Test: `frontend/src/hooks/__tests__/useDialFlow.test.js`
- Test: `frontend/src/hooks/__tests__/useAgentDial.test.js`

**Interfaces:**

- `readPendingDial() -> object | null`
- `savePendingDial(session) -> boolean`
- `clearPendingDial(dialLogId?) -> boolean`
- `completePendingDial(studentId, fallbackSession?) -> Promise<{ completed: boolean, reason?: string }>`

- [ ] **Step 1: Write failing shared-module tests**

Cover persistence, exact request parameters, no-op on another student, one-second minimum, successful clear, and failed-request retention:

```javascript
savePendingDial({
  studentId: 42,
  studentName: '张三',
  dialLogId: 9001,
  dialStartedAt: Date.now() - 30_000,
});

await completePendingDial(42);

expect(api.put).toHaveBeenCalledWith('/students/dial-duration', null, {
  params: {
    student_id: 42,
    dial_log_id: 9001,
    duration_seconds: expect.any(Number),
  },
});
expect(readPendingDial()).toBeNull();
```

Reject `api.put` in a second test and assert `readPendingDial()` still returns the session.

- [ ] **Step 2: Run the module test and verify it fails**

```powershell
npm --prefix frontend test -- --run src/__tests__/dialSession.test.js
```

Expected: module import fails because `dialSession.js` does not exist.

- [ ] **Step 3: Implement the shared session module**

```javascript
import api from './api';

const PENDING_DIAL_KEY = 'pendingDial';

export function readPendingDial() {
  try {
    const raw = sessionStorage.getItem(PENDING_DIAL_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function savePendingDial(session) {
  try {
    sessionStorage.setItem(PENDING_DIAL_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function clearPendingDial(dialLogId) {
  const current = readPendingDial();
  if (!current) return false;
  if (dialLogId != null && current.dialLogId !== dialLogId) return false;
  try {
    sessionStorage.removeItem(PENDING_DIAL_KEY);
    return true;
  } catch {
    return false;
  }
}

export async function completePendingDial(studentId, fallbackSession = null) {
  const pending = readPendingDial() || fallbackSession;
  if (!pending || Number(pending.studentId) !== Number(studentId)) {
    return { completed: false, reason: 'no_match' };
  }
  if (!pending.dialStartedAt) return { completed: false, reason: 'missing_start' };

  const durationSeconds = Math.max(
    1,
    Math.round((Date.now() - pending.dialStartedAt) / 1000),
  );
  const params = { student_id: Number(studentId), duration_seconds: durationSeconds };
  if (pending.dialLogId != null) params.dial_log_id = pending.dialLogId;
  await api.put('/students/dial-duration', null, { params });
  clearPendingDial(pending.dialLogId);
  return { completed: true };
}
```

- [ ] **Step 4: Update both dial initiation hooks**

Before phone reveal, read a matching session and pass its ID:

```javascript
const existing = readPendingDial();
const params = existing?.studentId === studentId && existing?.dialLogId
  ? { dial_log_id: existing.dialLogId }
  : undefined;
const response = await api.get(`/students/phone/${studentId}`, { params });
const dialLogId = response.data?.data?.dial_log_id;
savePendingDial({ studentId, studentName, dialLogId, dialStartedAt: Date.now() });
```

In both pending-load effects, stop removing `pendingDial` when the modal opens. Replace direct `sessionStorage` reads with `readPendingDial()`.

- [ ] **Step 5: Update and run hook tests**

Update mocked phone responses to include `dial_log_id: 9001`. Assert saved sessions contain `dialLogId`, repeated requests send it, and loading a pending modal no longer clears storage.

```powershell
npm --prefix frontend test -- --run src/__tests__/dialSession.test.js src/hooks/__tests__/useDialFlow.test.js src/hooks/__tests__/useAgentDial.test.js
```

Expected: all selected tests pass.

- [ ] **Step 6: Commit Task 4**

```powershell
git add frontend/src/dialSession.js frontend/src/__tests__/dialSession.test.js frontend/src/hooks/useDialFlow.js frontend/src/hooks/useAgentDial.js frontend/src/hooks/__tests__/useDialFlow.test.js frontend/src/hooks/__tests__/useAgentDial.test.js
git commit -m "feat: persist exact dial sessions in frontend"
```

---

### Task 5: Complete Sessions From Every Result Path

**Files:**

- Modify: `frontend/src/components/MobileDialResult.jsx`
- Modify: `frontend/src/pages/mobile/MobileStudentDetail.jsx`
- Modify: `frontend/src/hooks/useAgentDial.js`
- Test: `frontend/src/components/__tests__/MobileDialResult.test.jsx`
- Test: `frontend/src/pages/mobile/__tests__/MobileStudentDetail.test.jsx`
- Test: `frontend/src/hooks/__tests__/useAgentDial.test.js`
- Test: `tests/e2e/mobile-dial-result.spec.js`
- Test: `tests/e2e/operator-invalid.spec.js`

**Interfaces:**

- Every successful result path awaits `completePendingDial(studentId, modal)`.
- Closing the mobile result sheet completes duration but does not change student status.
- A failed duration request leaves the stored session available for retry.

- [ ] **Step 1: Write failing component and detail-page tests**

Update fixtures to include `dialLogId: 9001`. Add assertions that status selection and close send that ID and clear storage only on success.

For mobile detail, stop mocking the session module and assert direct status completion:

```javascript
sessionStorage.setItem('pendingDial', JSON.stringify({
  studentId: 42,
  studentName: '张三',
  dialLogId: 9001,
  dialStartedAt: Date.now() - 20_000,
}));

fireEvent.click(await screen.findByRole('button', { name: '空号' }));

await waitFor(() => {
  expect(api.put).toHaveBeenCalledWith('/students/dial-duration', null, {
    params: {
      student_id: 42,
      dial_log_id: 9001,
      duration_seconds: expect.any(Number),
    },
  });
});
```

- [ ] **Step 2: Run focused tests and verify they fail**

```powershell
npm --prefix frontend test -- --run src/components/__tests__/MobileDialResult.test.jsx src/pages/mobile/__tests__/MobileStudentDetail.test.jsx src/hooks/__tests__/useAgentDial.test.js
```

Expected: tests fail because completion is still fire-and-forget or missing from detail.

- [ ] **Step 3: Replace local duration writers with the shared helper**

In `MobileDialResult`, make the once-only ref hold a promise:

```javascript
const callRecordPromiseRef = useRef(null);

const recordCallOnce = () => {
  if (!callRecordPromiseRef.current) {
    callRecordPromiseRef.current = completePendingDial(pending.studentId, pending);
  }
  return callRecordPromiseRef.current;
};
```

Await it before closing after status, intent, follow-up, and close-button paths. On failure, keep the session and show `状态已保存，通话记录待同步` when the business update already succeeded.

In `useAgentDial`, replace `recordDialDurationOnce` with an awaited wrapper around `completePendingDial`. Do not unlock or close the modal until the completion promise settles; if it rejects, show a retryable toast and keep the modal/session.

- [ ] **Step 4: Complete a matching session after direct detail status updates**

Make `runWorkflowUpdate` return a boolean, then complete only after a successful status write:

```javascript
const saved = await runWorkflowUpdate(
  () => api.put(`/students/${student.id}`, payloadForOperatorResult(status)),
  '联系状态已更新',
  (updated) => patchStudent(/* existing patch */),
);
if (!saved) return;
try {
  await completePendingDial(student.id);
} catch {
  showToast('状态已保存，通话记录待同步');
}
```

Return `true` only for `r.data.code === 0`; return `false` for API errors.

- [ ] **Step 5: Update Playwright assertions**

Add `dialLogId` to both existing pending session fixtures. Capture the duration request URL and assert `dial_log_id=9001`, then assert `sessionStorage.getItem('pendingDial')` is null after completion.

Add a mobile-detail case that starts with a pending session, updates `空号`, and observes the exact duration request without using the return-sheet buttons.

- [ ] **Step 6: Run frontend unit tests for all completion paths**

```powershell
npm --prefix frontend test -- --run src/components/__tests__/MobileDialResult.test.jsx src/pages/mobile/__tests__/MobileStudentDetail.test.jsx src/hooks/__tests__/useAgentDial.test.js
```

Expected: all selected tests pass.

- [ ] **Step 7: Commit Task 5**

```powershell
git add frontend/src/components/MobileDialResult.jsx frontend/src/pages/mobile/MobileStudentDetail.jsx frontend/src/hooks/useAgentDial.js frontend/src/components/__tests__/MobileDialResult.test.jsx frontend/src/pages/mobile/__tests__/MobileStudentDetail.test.jsx frontend/src/hooks/__tests__/useAgentDial.test.js tests/e2e/mobile-dial-result.spec.js tests/e2e/operator-invalid.spec.js
git commit -m "fix: complete dial sessions from every result path"
```

---

### Task 6: Update All User-Facing Recording Labels And Metrics

**Files:**

- Modify: `frontend/src/components/StudentTimeline.jsx`
- Modify: `frontend/src/pages/admin/AdminMobileDash.jsx`
- Modify: `frontend/src/pages/admin/SystemSettings.jsx`
- Modify: `frontend/src/pages/admin/CallVolumeQuery.jsx`
- Modify: `frontend/src/pages/admin/AgentScorePreview.jsx`
- Modify: `frontend/src/pages/agent/desktop/AgentStatsSummary.jsx`
- Test: corresponding existing `__tests__` files for each component/page.

**Interfaces:**

- Visible labels: `待完成`, `历史未回填`, `已完成`.
- Compatibility `unrecorded_calls` may be read only as a fallback when new fields are absent.
- The UI calls duration values `拨号流程耗时` where context could imply carrier duration.

- [ ] **Step 1: Update fixtures and write failing label tests**

Use fixtures containing both explicit states:

```javascript
today: {
  total_calls: 12,
  recorded_calls: 9,
  completed_dial_sessions: 9,
  pending_dial_sessions: 1,
  legacy_missing_duration: 2,
  unrecorded_calls: 3,
}
```

Assert both labels appear and that legacy values do not use warning styling intended for current pending sessions.

For `StudentTimeline`, pass one pending and one legacy call and assert their labels differ.

- [ ] **Step 2: Run the affected frontend tests and verify they fail**

```powershell
npm --prefix frontend test -- --run src/components/__tests__/StudentTimeline.test.jsx src/pages/admin/__tests__/AdminMobileDash.test.jsx src/pages/admin/__tests__/SystemSettings.test.jsx src/pages/admin/__tests__/CallVolumeQuery.test.jsx src/pages/admin/__tests__/AgentScorePreview.test.jsx src/pages/agent/desktop/__tests__/AgentStatsSummary.test.jsx
```

Expected: failures show the old combined “未记录” labels.

- [ ] **Step 3: Implement explicit display fields with compatibility fallbacks**

Use the explicit fields first:

```javascript
const pendingCalls = Number(today.pending_dial_sessions ?? 0);
const legacyMissing = Number(today.legacy_missing_duration ?? 0);
const compatibilityUnrecorded = Number(today.unrecorded_calls ?? 0);
const fallbackPending = today.pending_dial_sessions == null
  ? compatibilityUnrecorded
  : pendingCalls;
```

Render current pending values with warning tone and legacy values with neutral tone. In call-volume rows and student timelines, derive the label from `recording_state`; only fall back to `duration_seconds > 0` for old API payloads.

Update copy from “平均有效时长” to “平均流程耗时” and from “未记录时长排行” to “待完成拨号排行”.

- [ ] **Step 4: Run the affected frontend tests**

```powershell
npm --prefix frontend test -- --run src/components/__tests__/StudentTimeline.test.jsx src/pages/admin/__tests__/AdminMobileDash.test.jsx src/pages/admin/__tests__/SystemSettings.test.jsx src/pages/admin/__tests__/CallVolumeQuery.test.jsx src/pages/admin/__tests__/AgentScorePreview.test.jsx src/pages/agent/desktop/__tests__/AgentStatsSummary.test.jsx
```

Expected: all selected tests pass.

- [ ] **Step 5: Commit Task 6**

```powershell
git add frontend/src/components/StudentTimeline.jsx frontend/src/pages/admin/AdminMobileDash.jsx frontend/src/pages/admin/SystemSettings.jsx frontend/src/pages/admin/CallVolumeQuery.jsx frontend/src/pages/admin/AgentScorePreview.jsx frontend/src/pages/agent/desktop/AgentStatsSummary.jsx frontend/src/components/__tests__/StudentTimeline.test.jsx frontend/src/pages/admin/__tests__/AdminMobileDash.test.jsx frontend/src/pages/admin/__tests__/SystemSettings.test.jsx frontend/src/pages/admin/__tests__/CallVolumeQuery.test.jsx frontend/src/pages/admin/__tests__/AgentScorePreview.test.jsx frontend/src/pages/agent/desktop/__tests__/AgentStatsSummary.test.jsx
git commit -m "fix: clarify dial recording states in UI"
```

---

### Task 7: Run Full Local Migration, Regression, Build, And Browser Verification

**Files:**

- Verify only; no production files should be created.
- Temporary local database copy: `$env:TEMP\crm-dial-session-verification.db`.

**Interfaces:**

- Produces local evidence that schema migration, backend tests, frontend tests, build, and browser flows all pass.
- Must not connect to or mutate the remote server.

- [ ] **Step 1: Verify the migration on a disposable local database copy**

```powershell
$source = (Resolve-Path '.\crm.db').Path
$target = Join-Path $env:TEMP 'crm-dial-session-verification.db'
Copy-Item -LiteralPath $source -Destination $target -Force
$env:DATABASE_PATH = $target
\.venv-win\Scripts\python.exe -c "import asyncio; from app.database import init_db; asyncio.run(init_db())"
\.venv-win\Scripts\python.exe -c "import os,sqlite3; c=sqlite3.connect(os.environ['DATABASE_PATH']); print(c.execute('select recording_state,count(*) from dial_logs group by recording_state order by recording_state').fetchall())"
```

Expected: migration completes and prints only `completed` and `legacy_missing` for historical rows. Delete only the verified temp path after checking it resolves under `$env:TEMP`.

- [ ] **Step 2: Run the full backend quality gates**

```powershell
\.venv-win\Scripts\python.exe -m pytest -q
\.venv-win\Scripts\python.exe -m ruff check app tests
\.venv-win\Scripts\python.exe -m pip check
```

Expected: zero failures and zero Ruff errors.

- [ ] **Step 3: Run the full frontend quality gates**

```powershell
npm --prefix frontend test
npm --prefix frontend run lint
npm --prefix frontend run build
npm --prefix frontend audit --omit=dev
```

Expected: all Vitest tests pass, ESLint exits 0, Vite production build exits 0, and the production dependency audit reports no vulnerabilities.

- [ ] **Step 4: Start local services only**

Start the backend against the disposable database and the frontend on unused local ports. Do not reuse the server tunnel and do not set a public host.

```powershell
$env:DATABASE_PATH = (Join-Path $env:TEMP 'crm-dial-session-verification.db')
Start-Process -FilePath '.\.venv-win\Scripts\python.exe' -ArgumentList @('-m','uvicorn','app.main:app','--host','127.0.0.1','--port','18000') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden
Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c','npm --prefix frontend run dev -- --host 127.0.0.1 --port 15173') -WorkingDirectory (Get-Location).Path -WindowStyle Hidden
```

- [ ] **Step 5: Run Playwright dial-session flows**

```powershell
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:15173'
npx playwright test tests/e2e/mobile-dial-result.spec.js tests/e2e/operator-invalid.spec.js
```

Expected: both result-modal and direct-detail exact-ID scenarios pass.

- [ ] **Step 6: Inspect the local UI at desktop and mobile widths**

Use the browser skill against `http://127.0.0.1:15173` and verify:

- No overlap or clipped labels at 390x844 and 1280x720.
- “待完成” and “历史未回填” are visually distinct.
- Closing the result sheet sends one duration request and clears the stored session.
- Navigating to student detail and updating status sends the exact `dial_log_id`.

- [ ] **Step 7: Verify the final diff and workspace boundaries**

```powershell
git status --short
git diff --check
git diff --stat ff2b50d..HEAD
```

Expected: no database, log, environment, build output, screenshot, or remote configuration files are tracked. The three user-deleted design files remain untouched and outside all implementation commits.

- [ ] **Step 8: Stop local verification services and report results**

Stop only the processes started on ports 18000 and 15173. Report exact test totals, build result, migration state counts, Playwright result, and the local URL used. Do not deploy until the user gives a separate explicit instruction.
