# Batch Flow Hardening

Use this note when a task is not just “click one page”, but a **batch flow**:

- list page + drawer / detail page
- pagination inside a modal or drawer
- site / store / grain / tab switching
- large row counts where retries, recovery, and progress discipline matter

This note complements:

- [dom-lab-playbook.md](dom-lab-playbook.md) for the default DOM workflow
- [live-page-probing-notes.md](live-page-probing-notes.md) for dynamic containers and re-render races

## Target Output

Before calling a batch flow “stable”, you should have:

- a DOM map for every critical page state
- a verified readback signal for each important action
- a recovery plan that preserves the current business context
- a regression ladder result from single control to multi-row

## 1. Start With a Full DOM Sweep

Before writing loops, inspect the whole flow, not just the first control.

Map at least these states:

- list page idle
- list page busy / timeout / empty
- active drawer or modal
- drawer busy / timeout / empty
- pagination controls
- page-size controls
- site / store / tab / grain switch controls
- success and failure signals after submit or page turn

Capture for each state:

- the active container
- stable text anchors
- visible values
- candidate selectors
- the signal that confirms a transition finished
- the signal that means “same page but different data”

For list/detail tasks, a partial DOM probe is usually worse than none. If you only understand the list page, the batch loop will be blind the moment a drawer opens or the page re-renders.

## 2. Make Readback Mandatory

Do not advance because a click or input “probably worked”.

For every important action, define the readback that proves it worked:

- search target:
  - read back filter value
  - confirm result list changed or target row appears
  - if the page shows busy or empty states, confirm the result evidence is fresh rather than stale
- open drawer:
  - confirm active drawer exists
  - confirm drawer title or target id matches expectation
- switch site / grain / tab:
  - confirm displayed value changed
  - confirm content changed for the new selection
- change page size:
  - confirm page-size control displays the new size
  - confirm row count or page content updates
- paginate:
  - confirm page number changed
  - confirm page signature changed
- close drawer:
  - confirm drawer disappears
  - confirm list page becomes active again

If an action does not have a reliable readback, it is not production-ready yet.

## 3. Preserve Explicit Scope Choices

If the user explicitly chose scope, write that scope into stable state and keep restoring from it.

Typical scope values:

- site or region
- store or tab
- grain or time range
- category or filter path
- identifier search value

Rules:

- preserve explicit choices before the first switch
- on retry or refresh, restore from saved scope, not whatever the DOM happens to show now
- when host, URL, and page chips disagree, prefer the most durable source of truth first

Lost scope is a correctness bug, not just a UX annoyance.

## 4. Re-Query After Every Re-Render

Assume these transitions invalidate old nodes:

- drawer open / close
- select open / close
- site switch
- tab switch
- pagination
- table refresh
- error banner or timeout overlay appearance

Rules:

- re-query nodes right before using them
- scope queries to the active container
- if a node disappears mid-step, treat it as a re-render race
- retry the current business step before advancing the batch cursor

Never build a batch loop on top of node references captured before the previous transition finished.

## 5. Use Layered Recovery

Recovery should preserve business context as long as possible.

Preferred order:

1. retry the current target in the same page state
2. restore the current page state without leaving the flow
3. refresh the page and restore the same business context
4. fail the current row only after the above paths are exhausted

Examples:

- busy or timeout after searching:
  - retry the same target search first
  - only refresh if repeated re-query still fails
- drawer busy after opening detail:
  - try to recover inside the drawer or close and reopen the same target
  - do not immediately refresh the whole page
- page-size or site switch did not stick:
  - reopen the control and read back again
  - do not assume the next page can proceed safely

Refresh is allowed, but it should be a recovery step, not the default reaction.

## 6. Handle False Busy And False Empty States

Some pages show busy or empty overlays that do not reflect the real data state.

Common symptoms:

- a “Too many visitors” banner appears but the underlying list still has real data
- an empty state remains visible from the previous query
- page number changed but row content did not
- the warning disappears without any real result refresh

Rules:

- treat `busy` or `empty` as provisional until you verify freshness
- compare row signature, active container state, host, or page signature before concluding no data
- if the page-owned request path is more trustworthy than the rendered table, switch to API-first collection
- do not convert a stale warning banner into a hard no-data result

## 7. Preserve Context Across Recovery

When recovering, keep enough state to resume the same business target:

- current row or target id
- current store / site / tab / grain
- current page number inside the detail flow
- current batch index inside the row
- reason for the current recovery attempt

The goal is not just “make the page work again”. The goal is “resume the same row without skipping or duplicating work”.

## 8. Separate Discovery Logic From Batch Traversal

A robust flow usually has two layers:

- discovery layer:
  - find the active container
  - locate controls
  - verify state transitions
- batch layer:
  - advance row cursor
  - advance site / page / batch cursor
  - emit progress
  - invoke recovery when discovery fails

Do not mix DOM probing experiments directly into row traversal loops. First prove the page contract, then wire it into the batch cursor.

## 9. Respect The Last-Page Rule

For list or drawer pagination, the last page is a common place to lose data.

Safe order:

1. verify the current page is ready
2. collect the current page rows into memory
3. confirm there is no next page
4. only then close the drawer or advance the outer cursor

Do not close the current view first and assume the final page was already captured.

## 10. Regression Ladder

Run regression in this order:

1. single control
2. single page
3. single row
4. small batch in one account or store
5. multi-row or multi-store batch
6. large-batch soak run

What to check:

- Single control:
  - the control changes and the value can be read back
- Single page:
  - one full page-level closed loop works
- Single row:
  - one full business target works with all internal page turns or site switches
- Small batch:
  - row cursor, recovery path, and progress stay consistent
- Multi-row / multi-store:
  - no skipped rows, duplicated rows, or cross-context leakage
- Large-batch soak:
  - retries do not explode
  - refresh frequency stays bounded
  - request frequency stays bounded
  - cooldown and backoff actually trigger when the platform pushes back
  - progress remains monotonic

Do not jump from “one target worked” to “thousands of rows are stable”.

## 11. Failure Signals To Classify Explicitly

Keep these categories separate:

- script failure
- re-render race
- auth or session failure
- environment or network issue
- platform throttling or anti-bot response
- business-rule rejection

This prevents the common mistake of fixing every failure with more clicking or more refreshes.

## 12. Common Anti-Patterns

Avoid these patterns:

- writing batch logic before the detail page is fully understood
- treating click success as state success
- treating a busy or empty banner as hard truth without checking freshness
- keeping old node references across page transitions
- using refresh as the first recovery step
- closing the current view before the last page is stored
- increasing the batch cursor before the current row is truly complete
- relying on fixed sleep where a readback signal exists

## When To Load This Note

Load this note when:

- a task has list/detail or list/drawer traversal
- pagination inside the detail view is flaky
- site or store switching causes lost state
- the page sometimes returns timeout / busy banners
- the task will run over tens, hundreds, or thousands of rows
