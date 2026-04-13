# Regression Checklist Before Install And Commit

Use this checklist before saying a crawshrimp adapter change is ready.

## 1. Script-level checks

- `node --check adapters/<adapter_id>/<task-script>.js`
- run targeted Node tests for the changed task
- if `js_runner` behavior changed, run the matching Python tests
- if the bugfix changed a recovery branch, assert the exact `meta.action`, `next_phase`, and preserved `meta.shared` fields

Examples:

```bash
node --check adapters/temu/goods-traffic-list.js
node --test tests/temu-activity-data-regression.test.js
venv/bin/python -m unittest tests.test_js_runner -v
```

## 2. Frontend checks

If any shared UI file changed:

- run `npm --prefix app run vite:build`
- verify the target task UI
- verify at least one unrelated task UI did not regress

## 3. Runtime sync checks

Remember that crawshrimp runs the installed adapter copy, not the repo source.

After changing adapter files:

```bash
curl -sS -x '' -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path":"/absolute/path/to/repo/adapters/<adapter_id>"}'
```

If needed, compare source and runtime copy:

```bash
shasum -a 256 \
  /absolute/path/to/repo/adapters/<adapter_id>/<task-script>.js \
  ~/.crawshrimp/adapters/<adapter_id>/<task-script>.js
```

If backend Python files or renderer files changed, adapter install alone is not enough. Verify the running backend/frontend surface is current before trusting live results.

## 4. Live regression ladder

Run the smallest useful ladder:

1. single control
2. single page
3. single row
4. single scope
5. multi-scope regression
6. long-run or soak test if rate limit or recovery changed

Do not jump straight to full-run if the lower rungs are still red.

## 5. Export acceptance

Check the produced file, not just the task status.

Minimum checks:

- file exists
- row count is plausible
- requested scopes are all present
- duplicate business keys are zero
- final page data exists

## 6. Staging discipline

Before commit:

- inspect `git status --short`
- stage only files that belong to this task
- keep shared frontend or docs out of the commit if another active session is touching sibling tasks
- verify `git diff --cached --stat`
- keep skill or notes updates separate from repo code commits unless they are intentionally part of the deliverable

## 7. Commit message discipline

Keep the subject scoped to the changed adapter or surface area.

Examples:

- `fix(temu): stabilize goods traffic list collection`
- `fix(temu): harden goods traffic detail export dedupe`
- `feat(ui): whitelist enhanced progress for goods traffic list`
