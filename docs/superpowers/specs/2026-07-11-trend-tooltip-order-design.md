# Trend Tooltip Ordering Design

## Goal

Make the agent comparison chart easier to scan by ordering its tooltip rows by the call count at the currently hovered date.

## Scope

- Change only the tooltip in the `各话务员每日呼出量对比` chart.
- Sort visible tooltip entries by numeric value from highest to lowest.
- Place zero-value entries after every positive-value entry as a natural result of descending order.
- Preserve the existing series order for equal values.
- Leave the main trend chart, curve colors, checkbox legend, hidden-series behavior, table, and CSV export unchanged.

## Implementation

Use Recharts' `Tooltip.itemSorter` on the agent comparison chart. The sorter will return the negative numeric value for each tooltip item so Recharts presents larger values first without reordering the underlying `Line` components.

Keeping series definitions unchanged ensures that agent colors and the checkbox legend remain stable while the tooltip can reorder itself independently for each hovered date.

## Edge Cases

- Missing, null, or non-numeric tooltip values are treated as zero.
- Hidden curves do not appear in the tooltip and therefore do not participate in sorting.
- Equal values keep their existing deterministic series order.

## Verification

- Add a focused frontend regression test that passes mixed positive and zero tooltip values through the sorter and asserts descending order.
- Assert equal values retain stable order.
- Run the focused TrendReport test file, frontend lint, and production build.
- Verify the rendered chart tooltip at a date containing mixed values without interacting with the user's existing browser tabs.
