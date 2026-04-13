# JS Runner And Regression Patterns

Use this note when proving a crawshrimp adapter fix before install, or when deciding whether a change also needs backend runner coverage.

## 1. Default Test Stack

For most adapter changes, think in layers:

1. `node --check` for syntax
2. targeted Node regression for the changed adapter behavior
3. Python runner tests if protocol or backend mapping changed
4. frontend build if shared UI files changed
5. runtime install and live smoke

This order catches cheap mistakes first.

## 2. What A Good Adapter Regression Should Assert

A useful adapter regression should assert the behavior that was broken, not just “script returned something”.

Good assertions usually include:

- `meta.action`
- `meta.next_phase` or the returned phase transition
- `meta.shared` fields that must survive the step
- `sleep_ms` when pacing or recovery timing matters
- captured `data` rows or dedupe outcome when export correctness matters

For bugfixes, prefer asserting the exact recovery branch:

- same-row retry vs next-row advance
- re-query vs refresh
- reopen drawer vs fail row
- preserve current scope vs drift to next scope

## 3. Prefer Narrow Fixtures

The best regression fixture is the smallest DOM/state setup that reproduces the bug.

Use fake DOM and VM execution to isolate:

- busy list after search
- drawer busy after open
- page-size dropdown fails to open
- site switch only echoes the current value
- last page captured before close

Smaller fixtures are easier to keep stable than full-page snapshots.

## 4. When To Add Python Runner Coverage

Add or update Python tests when the change affects:

- how `meta.action` is interpreted
- how `meta.shared` becomes `live`
- runtime output files or artifact handling
- stop/pause/export behavior in the runner
- cross-phase execution semantics

Typical touchpoints:

- `core/js_runner.py`
- `core/api_server.py`
- `core/data_sink.py`

If you only changed adapter-local DOM logic, a targeted Node regression is often enough.

## 5. Runner-Facing Bug Patterns Worth Encoding

These regressions tend to pay off repeatedly:

- busy page should retry current target, not advance cursor
- refresh recovery should preserve `shared` context
- `current_exec_no` should not increase during same-row retries
- `batch_no / total_batches` should stay coherent across detail retries
- drawer recovery should not lose the target id or current scope
- final export should not contain duplicates after retries

If a bug happened once in live use, assume it can happen again and encode it.

## 6. Shared Progress And Recovery Tests

When a task uses live progress:

- assert the script writes stable `shared` fields
- assert retries keep the same row identity
- assert second-level progress stays within the current item

When a task uses recovery:

- assert recovery preserves current site, time, page, target, and batch context
- assert refresh is not the first branch unless that is the intended contract

## 7. Regression Naming And Scope

Good test names describe the contract:

- `prepare_query retries targeted SPU search before any reload`
- `after_open_detail busy drawer routes to recover_detail_query`
- `collect_detail_combo does not skip a site when precheck echoes current value`

Good scope:

- one changed task's regression file
- plus sibling task regressions only if they share the changed helper or protocol

Do not turn every adapter bugfix into a whole-suite test run unless the changed surface is actually shared.

## 8. Live Regression Still Matters

Passing tests do not remove the need for a live check.

After test green:

1. sync runtime
2. run the smallest live ladder that exercises the changed path
3. inspect the output file if export correctness is part of the fix

Tests prove logic. Live checks prove the installed runtime and real page still agree.
