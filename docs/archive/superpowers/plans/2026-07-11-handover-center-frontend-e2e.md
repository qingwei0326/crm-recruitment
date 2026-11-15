# 离职交接中心与结果目录前端 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the four-state account UI, a complete handover center for partial and all-remaining transfers, and catalog-driven “已报名其他学校” controls across desktop/mobile flows.

**Architecture:** React Query hooks own server state and invalidation; pure adapters normalize API contracts; page components remain focused on rendering and commands. Mocked Playwright verifies UI routing, while a separate real-backend workflow uses a disposable synthetic database.

**Tech Stack:** React 18, React Router 6, TanStack Query 5, Axios, Vitest 4, Testing Library, Playwright 1.61, Tailwind CSS, lucide-react.

## Global Constraints

- Requires phase 2 safe handover and outcome APIs.
- Account management permission remains `account_manage`; no new permission key is introduced.
- Route: `/admin/handovers`; batch query state stays in the URL.
- Do not expose names or phones in test snapshots taken from production data.
- Do not use the production snapshot for mutable E2E tests.
- Use one frontend outcome catalog module; desktop/mobile components must not define separate reason arrays.
- “已报名其他学校” is terminal and visually unavailable for automatic reclaim.
- Preserve the current visual language, 8px-or-less card radii, and existing admin layout.
- Use lucide-react icons for transfer, refresh, filter, history, and warning actions.
- Set Vitest `maxWorkers: 8`, the locally verified stable value.
- Preserve unrelated worktree changes.

---

## File Structure

- Create `frontend/src/domain/handover.js`: pure contract adapters and idempotency helper.
- Create `frontend/src/domain/outcomeCatalog.js`: one fallback catalog and resolution helpers.
- Create `frontend/src/hooks/useHandovers.js`: React Query list/detail/preview/execute hooks.
- Create `frontend/src/hooks/useLeadOutcomeCatalog.js`.
- Create `frontend/src/pages/admin/HandoverCenter.jsx`.
- Create `frontend/src/pages/admin/handover/HandoverBatchList.jsx`.
- Create `frontend/src/pages/admin/handover/HandoverBatchDetail.jsx`.
- Create `frontend/src/pages/admin/handover/HandoverFilters.jsx`.
- Create `frontend/src/pages/admin/handover/HandoverStudentTable.jsx`.
- Create `frontend/src/pages/admin/handover/TransferPreviewDialog.jsx`.
- Create `frontend/src/pages/admin/agents/EmploymentStatusBadge.jsx`.
- Create `frontend/src/pages/admin/agents/EmploymentActions.jsx`.
- Modify `AgentManage.jsx`, `agentManageUtils.js`, `App.jsx`, and `AdminSidebar.jsx`.
- Modify operator result controls and invalid reclaim UI.
- Create focused Vitest suites and two Playwright workflow specs.

---

### Task 1: Handover Contract Adapters and React Query Hooks

**Files:**
- Create: `frontend/src/domain/handover.js`
- Create: `frontend/src/hooks/useHandovers.js`
- Create: `frontend/src/domain/__tests__/handover.test.js`
- Create: `frontend/src/hooks/__tests__/useHandovers.test.jsx`

**Interfaces:**
- Produces `normalizeHandoverBatch`, `normalizeHandoverDetail`, `normalizeTransferResult`, and `createIdempotencyKey`.
- Produces `useHandoverList`, `useHandoverDetail`, `usePreviewHandoverTransfer`, `useExecuteHandoverTransfer`, and `useStartHandover`.

- [ ] **Step 1: Write failing adapter tests**

Test exact normalized shapes:

```javascript
expect(normalizeHandoverBatch({
  id: 12,
  source_agent: { id: 7, name: '原话务员' },
  status: 'pending', version: 3,
  total_items: 9, remaining_items: 4, transferred_items: 5,
  initiated_at: '2026-07-11 01:00:00',
})).toEqual({
  id: 12,
  sourceAgent: { id: 7, name: '原话务员' },
  status: 'pending', version: 3,
  total: 9, remaining: 4, transferred: 5,
  initiatedAt: '2026-07-11 01:00:00',
});
```

Assert malformed numeric values normalize to `0`, missing lists become `[]`, and generated idempotency keys match `/^handover-[0-9]+-[0-9a-f-]+$/`.

- [ ] **Step 2: Implement pure adapters**

`createIdempotencyKey(batchId)` uses `crypto.randomUUID()` when available and a timestamp/random fallback in tests. Adapters must not read React state or call APIs.

- [ ] **Step 3: Write failing hook tests**

Mock `api.get/post`; assert query keys and exact paths:

```javascript
['handovers', filters]
['handover', batchId, filters]
GET /admin/handovers
GET /admin/handovers/12
POST /admin/handovers/12/preview-transfer
POST /admin/handovers/12/transfers
POST /admin/users/7/offboarding/start
```

Assert successful mutation invalidates `['handovers']`, `['handover', 12]`, and `['admin-users']`.

- [ ] **Step 4: Implement hooks**

Mutation input shapes are fixed:

```javascript
preview.mutateAsync({ batchId, mode, studentIds })
execute.mutateAsync({
  batchId,
  targetAgentId,
  mode,
  studentIds,
  expectedVersion,
  idempotencyKey,
})
start.mutateAsync({ userId, expectedVersion, idempotencyKey })
```

Do not generate a new key on retry after an unknown network result; the caller retains the request object until a definitive response.

- [ ] **Step 5: Run tests and commit**

```powershell
cd frontend
npm test -- --run src/domain/__tests__/handover.test.js src/hooks/__tests__/useHandovers.test.jsx
git add src/domain/handover.js src/hooks/useHandovers.js src/domain/__tests__/handover.test.js src/hooks/__tests__/useHandovers.test.jsx
git commit -m "feat: add handover client contracts"
```

Expected: selected tests pass and commit succeeds.

---

### Task 2: Four-State Account Management and Safe Offboarding Entry

**Files:**
- Create: `frontend/src/pages/admin/agents/EmploymentStatusBadge.jsx`
- Create: `frontend/src/pages/admin/agents/EmploymentActions.jsx`
- Modify: `frontend/src/pages/admin/agentManageUtils.js`
- Modify: `frontend/src/pages/admin/AgentManage.jsx`
- Modify: `frontend/src/pages/admin/__tests__/AgentManage.test.jsx`
- Create: `frontend/src/pages/admin/agents/__tests__/EmploymentActions.test.jsx`

**Interfaces:**
- Produces `employmentLabel(status)` and `employmentTone(status)`.
- `EmploymentActions` emits suspend, resume, start-handover, and open-batch commands.

- [ ] **Step 1: Write failing status/action tests**

Assert labels:

```javascript
active -> 在职
suspended -> 暂停
handover_pending -> 待交接
offboarded -> 已离职
```

Assert only `active` shows “暂停”和“办理离职”, `suspended` shows “恢复”, `handover_pending` shows “打开交接批次”, and `offboarded` has no state-changing command.

- [ ] **Step 2: Implement status utilities and components**

Use `UserCheck`, `PauseCircle`, `ArrowRightLeft`, and `UserX` icons with tooltips. Buttons use the existing confirm dialog; start-handover confirmation states explicitly that progress is preserved and the account is disabled immediately.

- [ ] **Step 3: Replace AgentManage's boolean filter**

Change status filter keys to `active`, `suspended`, `handover_pending`, `offboarded`, and `all`. Continue deriving a fallback status from `is_active` only when an old response lacks `employment_status`.

Remove the old confirmation text that says nonterminal progress will reset. After start succeeds, navigate with `` `/admin/handovers?batch=${batchId}` ``.

- [ ] **Step 4: Run tests and commit**

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/AgentManage.test.jsx src/pages/admin/agents/__tests__/EmploymentActions.test.jsx
git add src/pages/admin/AgentManage.jsx src/pages/admin/agentManageUtils.js src/pages/admin/agents
git commit -m "feat: show employee lifecycle states"
```

Expected: selected tests pass.

---

### Task 3: Handover Center List, Detail, Filters, and Selection

**Files:**
- Create: `frontend/src/pages/admin/HandoverCenter.jsx`
- Create: `frontend/src/pages/admin/handover/HandoverBatchList.jsx`
- Create: `frontend/src/pages/admin/handover/HandoverBatchDetail.jsx`
- Create: `frontend/src/pages/admin/handover/HandoverFilters.jsx`
- Create: `frontend/src/pages/admin/handover/HandoverStudentTable.jsx`
- Create: `frontend/src/pages/admin/__tests__/HandoverCenter.test.jsx`

**Interfaces:**
- URL query keys: `batch`, `status`, `region`, `school`, `intent`, `kind`, `overdue`, `q`, and `page`.
- Selection is cleared when batch or server-side filters change.

- [ ] **Step 1: Write failing page tests**

Mock hooks and assert:

- batch list renders remaining/total and source employee;
- selecting a batch writes `batch` to URL;
- filters write canonical query values and request the detail hook;
- loading, error, empty, completed, and conflict states render without layout shifts;
- selecting visible rows enables “转派所选”; pending count enables “全部接手”.

- [ ] **Step 2: Implement the page shell and list**

Use the existing admin layout/page header. Desktop uses a 280px batch sidebar and flexible detail pane; mobile stacks the batch selector above detail. No nested cards: list rows are bordered items, detail is an unframed page section.

- [ ] **Step 3: Implement filters and stable table**

Use native inputs/selects matching existing admin controls. The table has fixed columns for checkbox, student, school/region, status/detail, intent/stage, overdue, work-item kinds, and current action. Names are shown in the real UI but mocked tests use synthetic names.

Virtualize only after 100 rendered rows; keep row height stable at 52px.

- [ ] **Step 4: Run tests and commit**

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/HandoverCenter.test.jsx
git add src/pages/admin/HandoverCenter.jsx src/pages/admin/handover src/pages/admin/__tests__/HandoverCenter.test.jsx
git commit -m "feat: add handover center browsing"
```

Expected: page tests pass.

---

### Task 4: Preview, Partial Transfer, All-Remaining Transfer, and Conflict Recovery

**Files:**
- Create: `frontend/src/pages/admin/handover/TransferPreviewDialog.jsx`
- Modify: `frontend/src/pages/admin/HandoverCenter.jsx`
- Modify: `frontend/src/pages/admin/__tests__/HandoverCenter.test.jsx`
- Create: `frontend/src/pages/admin/handover/__tests__/TransferPreviewDialog.test.jsx`

**Interfaces:**
- Dialog accepts `{ preview, mode, targetAgent, submitting, onCancel, onConfirm }`.
- Execute request reuses the preview's batch version and the retained idempotency key.

- [ ] **Step 1: Write failing dialog tests**

Assert preview displays selected students, open work items, overdue, high intent, per-kind counts, target employee, and mode. Confirm is disabled without an active target or while submitting.

Assert HTTP 409 closes no data, refreshes the batch, clears stale selection, and shows “交接数据已变化，请重新确认”. Assert an unknown network error keeps the same idempotency key for retry.

- [ ] **Step 2: Implement preview-before-write**

Both commands must call preview first. The actual execute button is available only inside the preview dialog; no direct transfer occurs from the table toolbar.

- [ ] **Step 3: Implement success updates**

On selected transfer, show transferred/skipped counts, invalidate queries, and leave the batch open. On all-remaining completion, show completion state and return focus to the completed batch row. Provide a link with `` `/admin/audit-logs?batch_id=${transferId}` ``.

- [ ] **Step 4: Run tests and commit**

```powershell
cd frontend
npm test -- --run src/pages/admin/__tests__/HandoverCenter.test.jsx src/pages/admin/handover/__tests__/TransferPreviewDialog.test.jsx
git add src/pages/admin/HandoverCenter.jsx src/pages/admin/handover/TransferPreviewDialog.jsx src/pages/admin/__tests__/HandoverCenter.test.jsx src/pages/admin/handover/__tests__/TransferPreviewDialog.test.jsx
git commit -m "feat: execute reviewed employee handovers"
```

Expected: selected tests pass.

---

### Task 5: Route, Navigation, Permission, and Responsive Shell

**Files:**
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/components/AdminSidebar.jsx`
- Modify: `frontend/src/__tests__/App.routes.test.jsx`
- Modify: `frontend/src/components/__tests__/AdminSidebar.test.jsx`

**Interfaces:**
- Route `/admin/handovers` requires admin role and `ADMIN_PAGE_PERMISSIONS.accountManage`.

- [ ] **Step 1: Write failing route/sidebar tests**

Assert account managers see and can route to “离职交接”; admins without `account_manage` are redirected. Use a lazy-page mock consistent with existing route tests.

- [ ] **Step 2: Register route and nav item**

Use lazy import `./pages/admin/HandoverCenter`. Add `ArrowRightLeft` icon and place the item adjacent to account management, not under lead governance.

- [ ] **Step 3: Run tests and commit**

```powershell
cd frontend
npm test -- --run src/__tests__/App.routes.test.jsx src/components/__tests__/AdminSidebar.test.jsx
git add src/App.jsx src/components/AdminSidebar.jsx src/__tests__/App.routes.test.jsx src/components/__tests__/AdminSidebar.test.jsx
git commit -m "feat: route employee handover center"
```

Expected: selected tests pass.

---

### Task 6: Catalog-Driven Operator Outcomes Across Desktop and Mobile

**Files:**
- Create: `frontend/src/domain/outcomeCatalog.js`
- Create: `frontend/src/hooks/useLeadOutcomeCatalog.js`
- Modify: `frontend/src/operatorResultPolicy.js`
- Modify: `frontend/src/labels.js`
- Modify: `frontend/src/components/MobileDialResult.jsx`
- Modify: `frontend/src/pages/mobile/MobileStudentDetail.jsx`
- Modify: `frontend/src/pages/agent/agentWorkUtils.js`
- Modify: `frontend/src/pages/agent/desktop/DialResultModal.jsx`
- Modify: `frontend/src/pages/admin/InvalidStudentReclaim.jsx`
- Modify all related tests.

**Interfaces:**
- Produces one `FALLBACK_OUTCOME_CATALOG` containing fixed codes/labels/rules.
- Produces `useLeadOutcomeCatalog()` returning `{ results, byCode, isLoading }`.
- `payloadForOperatorResult(result)` accepts a catalog item or label and returns stable status/reason payload.

- [ ] **Step 1: Write failing catalog tests**

Assert fallback and server-normalized results contain `enrolled_elsewhere`; assert its payload is:

```javascript
{ status: '无效', invalid_reason: '已报名其他学校' }
```

Assert existing labels retain their current display status and styles. Assert invalid reclaim rows with `outcome_reason_code='enrolled_elsewhere'` have a disabled checkbox and explanatory tooltip.

- [ ] **Step 2: Implement the single catalog**

The fallback exists only for offline/startup resilience. When the API succeeds, server entries replace matching codes and active server ordering drives the UI. Components consume the hook; remove independent invalid-reason arrays from component modules.

- [ ] **Step 3: Update all result controls**

Desktop modal, mobile dial sheet, mobile detail, and quick-status buttons display the same ordered list. The new label must fit three-column mobile grids without shrinking type; allow two-line button text with fixed 56px minimum height.

- [ ] **Step 4: Protect invalid reclaim UI**

Hide the one-click reclaim command when all filtered records are non-reclaimable. Mixed batches exclude disabled rows client-side, while the backend remains the authority and rejects crafted requests.

- [ ] **Step 5: Run focused tests and commit**

```powershell
cd frontend
npm test -- --run src/__tests__/operatorResultPolicy.test.js src/__tests__/statusButtons.test.js src/components/__tests__/MobileDialResult.test.jsx src/pages/mobile/__tests__/MobileStudentDetail.test.jsx src/pages/admin/__tests__/InvalidStudentReclaim.test.jsx
git add src/domain/outcomeCatalog.js src/hooks/useLeadOutcomeCatalog.js src/operatorResultPolicy.js src/labels.js src/components/MobileDialResult.jsx src/pages/mobile/MobileStudentDetail.jsx src/pages/agent/agentWorkUtils.js src/pages/agent/desktop/DialResultModal.jsx src/pages/admin/InvalidStudentReclaim.jsx src/__tests__/operatorResultPolicy.test.js src/__tests__/statusButtons.test.js src/components/__tests__/MobileDialResult.test.jsx src/pages/mobile/__tests__/MobileStudentDetail.test.jsx src/pages/admin/__tests__/InvalidStudentReclaim.test.jsx
git commit -m "feat: add enrolled elsewhere outcome"
```

Expected: all selected tests pass.

---

### Task 7: Stable Test Concurrency and Handover E2E

**Files:**
- Modify: `frontend/vite.config.js`
- Create: `tests/e2e/handover-center.spec.js`
- Create: `tests/e2e/handover-real-workflow.spec.js`
- Create: `scripts/seed_handover_e2e.py`
- Modify: `RELEASE-CHECKLIST.md`

**Interfaces:**
- Mocked spec verifies routing/UI contract.
- Real spec uses a disposable synthetic SQLite database and real FastAPI endpoints.

- [ ] **Step 1: Pin Vitest workers and prove the full suite**

Change:

```javascript
maxWorkers: 8,
```

Run twice:

```powershell
cd frontend
npm test -- --reporter=dot
npm test -- --reporter=dot
```

Expected: `47 passed` files and `279` or more passed tests on both runs, with no timeout failures.

- [ ] **Step 2: Add mocked Playwright workflow**

Mock handover, active-agent, preview, and transfer APIs. Test: account page -> start offboarding -> handover center -> filter -> select urgent rows -> preview -> partial transfer -> all remaining -> completed state. Assert the exact request body retains `expected_version` and one idempotency key per mutation.

- [ ] **Step 3: Add synthetic real-backend seed command**

`scripts/seed_handover_e2e.py --database PATH` creates only synthetic admin/source/target users, students, follow-ups, home/campus tasks, and tokens. It refuses a database containing any user not prefixed `e2e_` and prints credentials only for the synthetic admin.

- [ ] **Step 4: Add real API/browser workflow**

Start FastAPI with a temp `DATABASE_PATH`, run Alembic `upgrade head`, seed it, and start Vite on 5173. The real spec logs in and repeats the complete flow, then asserts via API that history creators are unchanged and current assignments/work-item owners moved.

- [ ] **Step 5: Run the browser tests**

```powershell
npx playwright test tests/e2e/handover-center.spec.js tests/e2e/handover-real-workflow.spec.js
```

Expected: `2 passed`. The test database is under the workspace temp/test directory and is not the production snapshot or root `crm.db`.

- [ ] **Step 6: Run frontend gates and commit**

```powershell
cd frontend
npm run lint
npm run build
cd ..
git add frontend/vite.config.js tests/e2e/handover-center.spec.js tests/e2e/handover-real-workflow.spec.js scripts/seed_handover_e2e.py RELEASE-CHECKLIST.md
git commit -m "test: cover employee handover workflow"
```

Expected: lint/build pass and commit succeeds.

---

## Phase Acceptance Gate

- Four employee states are visible and actionable without `is_active` ambiguity.
- Starting offboarding never shows reset/recycle copy.
- Partial and all-remaining transfer require preview and handle conflicts/idempotent retry.
- All operator result surfaces show the same catalog, including “已报名其他学校”.
- Non-reclaimable invalid leads cannot be selected in the UI.
- Full frontend tests pass twice with 8 workers; lint, build, mocked E2E, and real synthetic E2E pass.

## Self-Review Notes

- Spec coverage: account lifecycle UI, handover list/detail/filter/preview/execute, conflict behavior, shared outcome catalog, responsive controls, and E2E are covered.
- Placeholder scan: route, query keys, hooks, mutation shapes, selectors, test DB safety, and verification commands are explicit.
- Type consistency: frontend adapters map the exact phase-2 API fields and preserve batch version/idempotency across preview and execute.
