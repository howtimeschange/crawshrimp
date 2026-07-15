# Safety

## Default Boundary

Safe actions are reversible, local, or read-only: observe, inspect page-owned API paths, call read-only application APIs, click harmless controls, type into local fields, select filters, paginate, download, and wait.

Caution actions need extra context: upload, cross-account navigation, long-running batch actions, API calls with unclear side effects, and ambiguous confirmation dialogs.

Dangerous actions require explicit user confirmation naming the target and consequence:

- submit
- publish
- send
- delete
- pay
- purchase
- confirm
- bulk modify
- save/update API calls that persist external state
- publish/export/send API calls with external effects
- any irreversible external effect

## Context Checks

Before operating, identify account, store, workspace, or environment when it is visible. If the context is unclear and the task could affect real state, stop.

Do not turn a filled form into a submitted form or equivalent save API call without a separate confirmation.
