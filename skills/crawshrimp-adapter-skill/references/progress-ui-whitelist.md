# Enhanced Progress UI Whitelist

Use this note when a crawshrimp task needs richer progress UI.

## 1. Default stance

Classic progress is the default.

Enhanced progress should be opt-in and task-scoped.

Do not change the whole app just because one task is long-running.

## 2. Good fit for enhanced progress

Enhanced progress is justified when all or most of these are true:

- the task runs long enough that users need intermediate confidence
- `records` can grow even when total percent is temporarily unknown
- the task has second-level progress such as batch, page, drawer combo, or scope traversal
- the task can supply meaningful context like current target, site, or phase

## 3. Current integration points

In crawshrimp, the shared frontend touchpoints are:

- `app/src/renderer/utils/taskProgress.js`
- `app/src/renderer/App.vue`
- `app/src/renderer/views/ScriptList.vue`
- `app/src/renderer/views/TaskRunner.vue`

Rules:

- Put task whitelist rules in `taskProgress.js`
- Keep components consuming summary builders, not hardcoded task IDs
- Reuse `resolveTaskProgressConfig(...)`
- Reuse `buildTaskOverviewProgress(...)`
- Reuse `buildTaskRunnerProgressSummary(...)`
- Do not add enhanced-progress switches to `manifest.yaml`
- Do not branch on `adapter_id === ... && task_id === ...` inside view components

## 4. Backend contract

Frontend should consume backend `live`, not derive progress directly from adapter internals.

The usual live source chain is:

- adapter writes `shared`
- backend maps `shared` into `live`
- frontend renders `live`

This keeps the UI decoupled from any one adapter script.

## 5. Rollout sequence

Recommended order:

1. Make the task correct with classic progress.
2. Confirm `shared` fields are stable.
3. Add a whitelist entry for exactly one `adapterId + taskId`.
4. Verify the target task in:
   - sidebar
   - script list card
   - task runner page
5. Verify another unrelated task did not change appearance.
6. Run `npm --prefix app run vite:build`.

Boundary reminder:

- classic remains the global default
- enhanced is a desktop whitelist policy
- adapter scripts should supply truthful `shared`, not frontend presentation rules

## 6. Shared-file caution

Progress UI files are shared across multiple tasks and sessions.

If another active branch or session is touching:

- `TaskRunner.vue`
- `taskProgress.js`
- shared docs for progress

do not bundle those changes into an unrelated adapter-only commit unless the boundary is clean.
