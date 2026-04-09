# Live-Page Probing Notes

Use this note when a page is dynamic, flaky, or full of portals / drawers / stacked modals.

## 1. Build a page state map

- List the visible states before coding: list page, filter page, drawer, modal, confirm dialog, success state.
- For each state, note:
  - the blocker
  - the expected transition
  - the signal that confirms the transition

## 2. Lock the active container first

- If the page has portals, drawers, or stacked modals, identify the active interactive container before searching for buttons.
- Prefer queries scoped to that container instead of global text search.

## 3. Treat candidates as provisional

- A row, button, or control is only provisional until the moment of execution.
- Re-query DOM nodes right before acting.
- If the node disappears, treat it as a re-render race and retry the current page rather than advancing.

## 4. Separate pagination from execution failure

- `No target on current page` means continue pagination / next scope.
- `Target existed but action failed` means retry the current page, refresh if needed, and restore the same business context.

## 5. Judge success with multiple signals

- Do not trust a single count or a single toast.
- Prefer a combination of:
  - count change
  - preview / thumbnail change
  - success class / status badge
  - success text or business confirmation

## 6. Refresh as a recovery step

- If the page freezes or loses state, refresh is allowed.
- Preserve the current filter, page, and target context before refresh.
- After refresh, restore the same business state before continuing.

## 7. Regress in a ladder

- Single control
- Single page
- Single row
- Small batch
- Full run

## 8. Classify failures explicitly

- Script failure
- Auth / session failure
- Environment issue
- Business-rule rejection
- Re-render race

## When to load this note

- Modal or drawer interactions keep failing
- A row disappears between query and click
- Pagination and current-page execution need different retry logic
- Success detection needs more than one UI signal
