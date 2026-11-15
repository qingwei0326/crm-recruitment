# Trend Tooltip Ordering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sort the agent-comparison tooltip by the hovered date's call count from highest to lowest while keeping curve colors and the checkbox legend stable.

**Architecture:** Add a numeric sort-key function at module scope in `TrendReport.jsx` and pass it only to the agent chart's Recharts `Tooltip.itemSorter`. Capture the actual tooltip prop in the existing component test so the regression test verifies both the ordering rule and that it is wired to the correct chart.

**Tech Stack:** React 18, Recharts 3.8, Vitest 4, Testing Library, ESLint, Vite

## Global Constraints

- Change only the tooltip in the `各话务员每日呼出量对比` chart.
- Sort visible entries by the currently hovered date's numeric value in descending order.
- Treat missing, null, and non-numeric values as zero.
- Preserve stable series order for equal values.
- Do not change the main chart, curve colors, checkbox legend, hidden-series behavior, table, or CSV export.
- Do not add dependencies.

---

### Task 1: Add and verify hovered-date tooltip ordering

**Files:**
- Modify: `frontend/src/pages/admin/TrendReport.jsx:64-68,278-284`
- Test: `frontend/src/pages/admin/__tests__/TrendReport.test.jsx:7,46-59,100-109,214-238`

**Interfaces:**
- Consumes: Recharts `Tooltip.itemSorter`, whose callback receives one tooltip payload item and returns a number or string sort key.
- Produces: `getAgentTooltipSortKey(item) -> number`, returning the negated finite numeric value or `0` for invalid values.

- [ ] **Step 1: Capture tooltip props and write the failing regression test**

Update the hoisted test state and `Tooltip` mock:

```jsx
const { toastError, tooltipProps } = vi.hoisted(() => ({
  toastError: vi.fn(),
  tooltipProps: [],
}));

// Inside the recharts mock:
Tooltip: (props) => {
  tooltipProps.push(props);
  return null;
},
```

Clear captured props in `beforeEach`, then add this test after the color-stability test:

```jsx
it('sorts the agent tooltip by the hovered date value descending', async () => {
  renderTrendReport({
    start: '2026-07-10',
    end: '2026-07-10',
    daily: [
      {
        date: '2026-07-10',
        calls: 13,
        enrolled: 0,
        agent_calls: { 零值: 0, 较低: 2, 最高: 9, 同值: 2 },
      },
    ],
  });
  await screen.findByText('各话务员每日呼出量对比');

  const agentTooltip = tooltipProps.find(({ itemSorter }) => typeof itemSorter === 'function');
  expect(agentTooltip).toBeDefined();

  const entries = [
    { name: '零值', value: 0 },
    { name: '较低', value: 2 },
    { name: '最高', value: 9 },
    { name: '同值', value: 2 },
    { name: '无效', value: 'not-a-number' },
  ];
  const { DefaultTooltipContent } = await vi.importActual('recharts');
  const { container } = render(
    <DefaultTooltipContent
      label="2026-07-10"
      payload={entries}
      itemSorter={agentTooltip.itemSorter}
    />,
  );
  const orderedNames = [...container.querySelectorAll('.recharts-tooltip-item-name')]
    .map((element) => element.textContent);

  expect(orderedNames).toEqual(['最高', '较低', '同值', '零值', '无效']);
  expect(agentTooltip.itemSorter({})).toBe(0);
  expect(agentTooltip.itemSorter({ value: null })).toBe(0);
});
```

- [ ] **Step 2: Run the focused test and confirm the red state**

Run from `frontend/`:

```powershell
npm test -- src/pages/admin/__tests__/TrendReport.test.jsx
```

Expected: exit code `1`; the new test fails because no tooltip receives a function-valued `itemSorter`.

- [ ] **Step 3: Add the minimal sorter and wire it only to the agent tooltip**

Add this function after `hasPositiveValue` in `TrendReport.jsx`:

```jsx
function getAgentTooltipSortKey(item) {
  const value = Number(item?.value);
  return Number.isFinite(value) ? -value : 0;
}
```

Pass it to the second tooltip only:

```jsx
<Tooltip
  itemSorter={getAgentTooltipSortKey}
  contentStyle={{
    backgroundColor: dark ? '#1f2937' : '#fff',
    border: 'none',
    borderRadius: '8px',
  }}
/>
```

- [ ] **Step 4: Run the focused test and confirm the green state**

Run from `frontend/`:

```powershell
npm test -- src/pages/admin/__tests__/TrendReport.test.jsx
```

Expected: exit code `0`; all tests in `TrendReport.test.jsx` pass.

- [ ] **Step 5: Run frontend quality gates**

Run from `frontend/`:

```powershell
npm run lint
npm run build
npm test
```

Expected: all three commands exit `0`; ESLint reports no errors, Vite creates `dist`, and Vitest reports zero failed tests.

- [ ] **Step 6: Verify the rendered behavior in an isolated app tab after release authorization**

After the user separately authorizes production release, open a new Browser Harness tab at the report URL already supplied by the user. Capture a screenshot, hover a date with mixed agent values, and capture a second screenshot. Confirm the tooltip is descending for that date, zero values are last, the checkbox legend remains in its original order, and moving to another date reorders only the tooltip rows.

Do not reuse, navigate, or close any tab that was already open before this verification.

- [ ] **Step 7: Commit the implementation**

```powershell
git add -- frontend/src/pages/admin/TrendReport.jsx frontend/src/pages/admin/__tests__/TrendReport.test.jsx
git commit -m "fix: sort trend tooltip by daily calls"
```

Expected: the commit contains exactly the component and its focused test; unrelated assignment changes remain unstaged.
