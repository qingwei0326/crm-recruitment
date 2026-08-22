# Agent Workflow and AI Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the agent workflow independent of device recording and call-analysis AI while keeping the administrator AI assistant available and permission-scoped.

**Architecture:** The agent records a structured call result, intent level, stage, note, and follow-up through the existing APIs. Remove the agent-facing `AiPanel`, transcript input, analysis status, and AI badge from both desktop and mobile trees. Keep legacy AI columns in `calls` for schema compatibility but stop exposing them in agent responses and stop writing new analysis data. Administrator AI routes and configuration remain unchanged except that any assignment tool they invoke must use the capacity boundary from the dynamic assignment plan.

**Tech Stack:** FastAPI, SQLAlchemy async ORM, React 18, Vite, Vitest, Testing Library, Playwright, pytest.

**Spec:** `docs/superpowers/specs/2026-08-22-admissions-efficiency-design.md`

## Global Constraints

- 话务员侧只保留结构化拨打结果、意向/阶段、备注和下一步跟进，不依赖录音或 AI。
- A call can be completed without a recording, transcript, or AI result.
- The agent sequence is dial -> structured result -> intent/stage -> note -> next action/follow-up.
- Do not use AI to parse or rewrite agent notes in this phase.
- 保留管理员 AI 助手配置和路由，并继续置于管理员权限下。
- Keep legacy `Call.recording_path`, `transcript`, `ai_intent`, `ai_reasons`, `ai_summary`, `ai_confidence), and `analyzed_at` columns until a separate migration decision; they must not be required by the agent workflow.
- Do not remove ordinary notes, follow-ups, status, stage, or intent APIs.
- Preserve the existing user-side changes in agent hooks/pages and reconcile them with this plan instead of reverting them.

## File Map

- Modify `app/routers/calls.py`: remove/disable the agent transcript-analysis entry point and stop exposing analysis fields in agent call payloads.
- Modify `tests/test_ai_analyzer.py` and add `tests/test_agent_ai_boundary.py`: verify admin-only AI behavior and agent denial/no transcript path.
- Modify `frontend/src/pages/agent/AgentWork.jsx`, `AgentWorkDesktop.jsx`, `AgentWorkMobile.jsx`, `desktop/StudentTable.jsx`, and `desktop/StudentDetailDrawer.jsx`: remove AI props, buttons, badges, and panels.
- Delete `frontend/src/pages/agent/AiPanel.jsx` after all imports and tests are removed.
- Modify `frontend/src/hooks/useAgentDetail.js`, `useAgentWorkState.js`, `useDialFlow.js`, `useAgentDial.js`, and related tests: remove AI state/actions and keep structured result flow.
- Modify `frontend/src/pages/agent/shared/DialButton.jsx` only if its result contract still mentions recording.
- Modify `tests/e2e/mobile-dial-result.spec.js`, `tests/e2e/admissions-workflow.spec.js`, and agent unit tests to assert the device-independent workflow.
- Keep `app/assistant_config_service.py`, `app/routers/admin_assistant.py`, `frontend/src/pages/admin/settings/AssistantSettings.jsx`, and administrator assistant tests unless a capacity tool boundary requires a narrow change.

### Task 1: Remove the Agent Call-Analysis API Boundary

**Files:**
- Modify: `app/routers/calls.py`
- Modify: `tests/test_ai_analyzer.py`
- Create: `tests/test_agent_ai_boundary.py`

**Interfaces:**
- Agent call payloads contain structured call metadata but no transcript-analysis controls or AI result fields.
- Administrator AI configuration and assistant endpoints remain reachable only through their existing administrator permission checks.

- [ ] **Step 1: Add failing API boundary tests**

Create `tests/test_agent_ai_boundary.py` with these checks:

```python
async def test_agent_cannot_submit_transcript_for_ai_analysis(client, agent_headers, sample_student):
    response = await client.post(
        "/api/calls/analyze",
        headers=agent_headers,
        json={"student_id": sample_student.id, "transcript": "家长想了解课程"},
    )
    assert response.status_code in {404, 403}


async def test_agent_call_detail_does_not_expose_analysis_fields(
    client, agent_headers, sample_student
):
    response = await client.get(
        f"/api/students/{sample_student.id}/detail",
        headers=agent_headers,
    )
    assert response.status_code == 200
    calls = response.json()["data"]["calls"]
    assert all("transcript" not in item for item in calls)
    assert all("ai_summary" not in item for item in calls)
    assert all("ai_intent" not in item for item in calls)
    assert all("ai_confidence" not in item for item in calls)
```

Keep a separate administrator test proving that `/api/admin/assistant/config` still loads for a super-admin and that administrator assistant tool calls are unaffected.

- [ ] **Step 2: Run the boundary tests and verify they fail**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_agent_ai_boundary.py tests/test_ai_analyzer.py -q
```

Expected: the agent transcript endpoint currently exists or detail payloads still include analysis fields.

- [ ] **Step 3: Remove the agent analysis route and response exposure**

In `app/routers/calls.py`, remove the agent-facing transcript analysis route or change it to return a deliberate 404/403 response that does not invoke the AI provider. Do not remove administrator assistant routes.

In the student detail call serializer, return only the fields needed for call history and structured work: call ID, student ID, agent ID/name, duration, dialed/created time, and recording state if it is still needed for an administrator-only data-quality report. Omit transcript and AI result fields from the agent detail response. Do not delete legacy database columns or old rows in this task.

Remove any call-analysis side effect from the ordinary dial-result endpoint. A successful call result updates the existing student status, status detail, intent, stage, note, and follow-up data only.

- [ ] **Step 4: Run backend tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_agent_ai_boundary.py tests/test_ai_analyzer.py tests/test_students.py tests/test_edge_cases.py -q
```

Expected: all selected tests pass, with agent access denied and administrator configuration still intact.

- [ ] **Step 5: Commit the API boundary**

```powershell
git add app/routers/calls.py tests/test_agent_ai_boundary.py tests/test_ai_analyzer.py
git commit -m "refactor: remove agent call analysis workflow"
```

### Task 2: Remove AI State and Components from Agent UI

**Files:**
- Modify: `frontend/src/pages/agent/AgentWork.jsx`
- Modify: `frontend/src/pages/agent/AgentWorkDesktop.jsx`
- Modify: `frontend/src/pages/agent/AgentWorkMobile.jsx`
- Modify: `frontend/src/pages/agent/desktop/StudentTable.jsx`
- Modify: `frontend/src/pages/agent/desktop/StudentDetailDrawer.jsx`
- Modify: `frontend/src/hooks/useAgentDetail.js`
- Modify: `frontend/src/hooks/useAgentWorkState.js`
- Delete: `frontend/src/pages/agent/AiPanel.jsx`
- Modify: existing agent unit tests

**Interfaces:**
- `useAgentDetail` returns `loadDetail`, `updateDetailField`, `addNote`, `addFollowUp`, and visit helpers; it no longer returns `openAiPanel` or `hasAnalysis`.
- `useAgentWorkState` contains no `ai` state, `SET_AI`, `TOGGLE_AI`, `SET_HAS_ANALYSIS`, or AI action creators.
- Desktop and mobile agent pages render no transcript input, AI analysis button, AI status badge, or analysis panel.

- [ ] **Step 1: Add failing component assertions**

In the existing agent page tests, render desktop and mobile work pages with a student and assert:

```jsx
expect(screen.queryByText("AI 通话分析")).not.toBeInTheDocument();
expect(screen.queryByText("通话转录文本")).not.toBeInTheDocument();
expect(screen.queryByText("AI分析状态")).not.toBeInTheDocument();
expect(screen.queryByRole("button", { name: /AI 分析/ })).not.toBeInTheDocument();
expect(screen.getByRole("button", { name: /写备注|添加备注/ })).toBeInTheDocument();
```

Update hook tests to assert the returned action object has no `openAiPanel` and the initial reducer state has no `ai` key.

- [ ] **Step 2: Run agent tests and verify they fail**

```powershell
cd frontend
npm test -- --run src/hooks/__tests__/useAgentWorkState.test.js src/hooks/__tests__/useAgentDial.test.js src/hooks/__tests__/useDialFlow.test.js src/pages/agent/desktop/__tests__/FilterPanel.test.jsx
```

Expected: current pages still import `AiPanel`, pass `onOpenAi`, and render AI analysis status.

- [ ] **Step 3: Remove AI props and state**

Delete `AiPanel.jsx` after removing every import. In `AgentWork.jsx`, remove `openAiPanel`, `showAi`, `activeStudent`, `setShowAi`, and `hasAnalysis` wiring. In desktop/mobile pages and `StudentTable.jsx`, remove AI button props and conditional panel rendering. In `StudentDetailDrawer.jsx`, remove the AI status block while keeping call history, notes, follow-ups, and admissions timelines.

In `useAgentDetail.js`, remove the `hasAnalysis` derivation from calls and remove `openAiPanel`. In `useAgentWorkState.js`, remove AI state/actions/reducer branches and keep detail close behavior independent of any AI panel.

- [ ] **Step 4: Run focused frontend tests**

```powershell
cd frontend
npm test -- --run src/hooks/__tests__/useAgentWorkState.test.js src/hooks/__tests__/useAgentDial.test.js src/hooks/__tests__/useDialFlow.test.js src/pages/agent/desktop/__tests__/FilterPanel.test.jsx src/pages/admin/__tests__/AdminWorkCenter.test.jsx
```

Expected: all selected tests pass and no agent test imports the deleted component.

- [ ] **Step 5: Commit the UI removal**

```powershell
git add frontend/src/pages/agent frontend/src/hooks frontend/src/hooks/__tests__
git commit -m "refactor: remove agent-facing ai controls"
```

### Task 3: Make the Structured Result Flow Explicit

**Files:**
- Modify: `frontend/src/hooks/useDialFlow.js`
- Modify: `frontend/src/hooks/useAgentDial.js`
- Modify: `frontend/src/pages/agent/AgentWorkDesktop.jsx`
- Modify: `frontend/src/pages/agent/AgentWorkMobile.jsx`
- Modify: `frontend/src/pages/agent/shared/DialButton.jsx`
- Modify: `tests/e2e/mobile-dial-result.spec.js`
- Modify: `tests/e2e/admissions-workflow.spec.js`
- Modify: existing hook tests

**Interfaces:**
- A completed dial result sends the existing structured payload; it does not contain transcript, recording upload, or AI flags.
- The result UI exposes status/status detail, intent, stage, note, and follow-up controls in the same completion path.
- A follow-up is represented by the existing `FollowUp` API; no new student history table is introduced.

- [ ] **Step 1: Add failing workflow assertions**

In `useDialFlow.test.js` and `useAgentDial.test.js`, assert the POST payload contains structured fields and excludes `transcript`, `recording_path`, `ai_intent`, and `ai_summary`:

```javascript
expect(api.post).toHaveBeenCalledWith(
  expect.stringContaining('/calls'),
  expect.objectContaining({
    status: '已联系',
    intent_level: 'A',
    stage: '有意向',
  }),
);
expect(api.post.mock.calls[0][1]).not.toHaveProperty('transcript');
expect(api.post.mock.calls[0][1]).not.toHaveProperty('recording_path');
```

In the mobile Playwright test, complete a call with no recording capability, add a note, set a follow-up date, and assert the student detail shows the structured result and follow-up.

- [ ] **Step 2: Run the workflow tests and verify they fail**

```powershell
cd frontend
npm test -- --run src/hooks/__tests__/useDialFlow.test.js src/hooks/__tests__/useAgentDial.test.js
cd ..
npx playwright test tests/e2e/mobile-dial-result.spec.js
```

Expected: payload/visible-state assertions fail where the old AI or recording path is still present.

- [ ] **Step 3: Implement the device-independent result path**

Keep the existing status normalization and canonical status policy. After the dial result is saved, keep the note editor and follow-up control available without waiting for an analysis response. Make the note action call `POST /api/notes` and the follow-up action call `POST /api/follow-ups` using the selected student and existing date format.

Remove any recording or AI fields from the frontend request construction. Use explicit loading/error states for the structured result save, note save, and follow-up save so one failed action does not falsely mark the others complete.

- [ ] **Step 4: Run frontend and browser tests**

```powershell
cd frontend
npm test -- --run src/hooks/__tests__/useDialFlow.test.js src/hooks/__tests__/useAgentDial.test.js src/hooks/__tests__/useTodayTasks.test.jsx
npm run build
cd ..
npx playwright test tests/e2e/mobile-dial-result.spec.js tests/e2e/admissions-workflow.spec.js
```

Expected: all selected tests pass and the build succeeds.

- [ ] **Step 5: Commit the structured workflow**

```powershell
git add frontend/src/hooks frontend/src/pages/agent tests/e2e/mobile-dial-result.spec.js tests/e2e/admissions-workflow.spec.js
git commit -m "feat: keep agent workflow structured without recording"
```

### Task 4: Verify Administrator AI Remains Available

**Files:**
- Modify: `app/assistant_tools.py` only if an assignment tool needs the Task 1 wrapper.
- Modify: `frontend/src/pages/admin/settings/AssistantSettings.jsx` only for regression copy or permission test changes.
- Modify: `tests/test_admin_assistant.py`
- Modify: `frontend/src/pages/admin/settings/__tests__/AssistantSettings.test.jsx`

**Interfaces:**
- Administrator assistant configuration remains at `/api/admin/assistant/config`.
- Administrator assistant tools remain administrator-only and assignment tools use the dynamic capacity wrapper.

- [ ] **Step 1: Add regression assertions**

Assert that a super-admin can load and update assistant configuration, while an agent receives 403 from the configuration route. Assert that an assistant assignment preview/execution returns capacity fields and cannot use a force reason unless the current user is super-admin.

- [ ] **Step 2: Run the regression tests**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_admin_assistant.py -q
cd frontend
npm test -- --run src/pages/admin/settings/__tests__/AssistantSettings.test.jsx
```

Expected: all selected tests pass.

- [ ] **Step 3: Commit only necessary assistant boundary changes**

```powershell
git add app/assistant_tools.py tests/test_admin_assistant.py frontend/src/pages/admin/settings/__tests__/AssistantSettings.test.jsx
git commit -m "test: preserve administrator assistant boundary"
```

### Task 5: Full Agent Regression

**Files:**
- No new source files; modify tests only if a verified regression is found.

**Interfaces:**
- Consume the API/UI contracts from Tasks 1-4.
- Produce verified absence of agent AI UI and verified availability of structured notes/follow-ups.

- [ ] **Step 1: Search for stale agent AI references**

Run:

```powershell
rg -n "AiPanel|openAiPanel|showAi|activeStudent|hasAnalysis|AI分析状态|通话转录文本|/calls/analyze|transcript" app frontend/src/pages/agent frontend/src/hooks tests
```

Expected: no active agent workflow reference remains. Legacy model columns and administrator-only tests may remain outside the agent paths.

- [ ] **Step 2: Run backend and frontend regression suites**

```powershell
.venv-win\Scripts\python.exe -m pytest tests/test_agent_ai_boundary.py tests/test_ai_analyzer.py tests/test_students.py tests/test_edge_cases.py tests/test_task_stats_contract.py -q
cd frontend
npm test -- --run src/hooks/__tests__/useAgentDial.test.js src/hooks/__tests__/useAgentWorkState.test.js src/hooks/__tests__/useDialFlow.test.js src/hooks/__tests__/useTodayTasks.test.jsx
npm run build
```

Expected: selected tests pass and Vite exits with code 0.

- [ ] **Step 3: Commit verified test adjustments**

```powershell
git status --short
git add tests frontend/src/hooks frontend/src/pages/agent app/routers/calls.py
git commit -m "test: verify device-independent agent workflow"
```

## Self-Review Notes

- The plan removes only agent-facing call AI, not administrator AI configuration or assistant tools.
- Legacy call columns are retained to avoid an unnecessary schema migration; no new agent request depends on them.
- Note and follow-up APIs remain human-controlled and are covered by both hook and browser tests.
