# Download / Export Stability Playbook

Use this playbook when the automation goal is not just “click the button”, but “produce the correct downloaded artifact in the runtime output”.

Typical cases:

- export center pages
- task-history drawers
- multi-file exports
- cross-site or cross-region download buttons
- browser download succeeds but runtime artifact is missing
- exported file exists but content or filename is wrong

## Target Output

Before you call an export flow stable, you should have:

- one verified path from page action to final artifact
- clear separation between page-level success and runtime-level success
- a download verification checklist
- at least one failure-path note for duplicate clicks, stale history rows, and filename drift
- one real end-to-end run with final artifact paths

## 1. Separate Page Success from Runtime Success

Treat these as different checkpoints:

1. the page accepted the export action
2. the export task appeared in history
3. the correct history row became downloadable
4. the browser produced a downloaded file
5. the automation runtime moved and renamed the file
6. the final artifact content is valid

Do not stop at checkpoint 3 or 4.

“Browser shows a completed download” is not enough if the runtime artifact directory is still empty.

## 2. Build a Business-State Map for Export Flows

For export pages, capture the full state chain before coding:

- main page
- filter state
- export button
- export confirm modal
- export history drawer or table
- target row ready state
- download button
- transient auth / region-switch tab
- final downloaded file

For each state, note:

- entry signal
- exit action
- success signal
- common blocker

## 3. Layer the Logic by Responsibility

Keep export automation split across layers.

Adapter phase machine should own:

- filters and date range
- main-page buttons
- export-option modal choice
- export-history lookup
- row matching
- final summary rows

Runtime download watcher should own:

- temporary tabs
- region / auth confirmation popovers
- browser download directory monitoring
- file move / rename
- downloaded file fallback matching

Do not mix current-page business logic with transient-tab confirmation handling unless there is no alternative.

## 4. Capture Network Data as an Optimization, Not Always a Gate

Signed download URLs, request capture, or response-body parsing are useful, but they are not always stable enough to gate the whole flow.

Preferred rule:

- if captured data helps name or classify the download, keep it
- if capture fails but the real user-facing click can still complete the download, continue with click download
- only hard-fail on capture when the later download step truly cannot proceed without it

This is especially important for:

- cross-region download pages
- auth redirects
- temporary tabs with confirmation dialogs
- pages where the final file is generated only after additional browser-side state is established

## 5. Treat Download Matching as a Two-Stage Strategy

Prefer this order:

1. exact or regex match using the expected filename derived from the captured URL
2. fallback to any newly created expected file type after the click, such as any new `.xlsx`

Why:

- many sites append ` (1)` or ` (2)`
- some regions return different basenames than the originally captured URL
- exact-only matching creates false negatives after a successful browser download

Always record which matching strategy succeeded.

## 6. Keep Click Semantics Minimal

Do not “over-click”.

For export buttons:

- prefer one native click
- add fallback dispatch only if the first click path is known to fail
- avoid helper functions that fire multiple mouse / pointer / DOM click variants in one call

Repeated click synthesis can create:

- duplicate export tasks
- duplicate download jobs
- drawer re-renders at the wrong moment
- hard-to-debug race conditions

## 7. Re-Query History Rows Right Before Download

History drawers and tables re-render often.

Rules:

- match the target row by business identity, not by stale node reference
- re-query the row right before each download click
- keep tolerant date matching rules where the backend may use either `00:00:00` or `23:59:59`
- if multiple candidate rows exist, prefer the freshest row created after the export trigger

Do not assume the row you found 10 seconds earlier is still the same row you should click now.

## 8. Verify File Content, Not Just File Presence

A downloaded file can still be wrong.

Examples:

- HTML page saved as `.xlsx`
- login page saved as spreadsheet name
- empty shell file
- wrong region file under the expected name

Minimum validation for exported files:

- file exists in runtime artifact directory
- final filename matches the intended naming rule
- file type matches expectation
- if the file is supposed to be spreadsheet content, confirm it is a real spreadsheet container such as OOXML

For high-risk flows, add a lightweight content sanity check too.

## 9. Validate the Real Runtime Source of Truth

In adapter-based systems, the file you edited may not be the file the UI is executing.

Before claiming a fix is live:

- sync the adapter into the installed runtime location
- verify hashes or byte equality for the key script file
- run one real backend-triggered task, not just a page-level experiment

If the runtime source of truth differs from the workspace source, page debugging alone can mislead you.

## 10. Log by Business Phase, Not by DOM Detail

For export / download flows, logs should let you answer:

- did the export modal appear
- which option was selected
- did the history row appear
- which row was chosen
- which download plans were built
- which plans were capture-assisted versus click-only
- which file-matching strategy succeeded
- what final artifact paths were produced

If logs cannot show where the chain broke, the next investigation will be much slower than it needs to be.

## 11. Recommended Regression Ladder for Export Flows

Run verification in this order:

1. single export modal
2. single history-row match
3. single file download
4. multi-file download for one row
5. cross-region or cross-site confirmation handling
6. backend-triggered full run
7. final artifact validation

Do not jump from “button click works” directly to “adapter is stable”.

## Failure Taxonomy for Export Tasks

Classify failures precisely:

- page interaction failure
  - wrong button
  - stale drawer row
  - modal option not selected
- capture-only failure
  - expected request not observed
  - signed URL missing
  - response body missing or malformed
- browser download failure
  - click succeeded but no file landed
  - transient tab blocked by auth or confirmation
- runtime artifact failure
  - file downloaded but not moved
  - filename drift not handled
  - runtime watched the wrong directory
- content validity failure
  - HTML saved as spreadsheet
  - wrong file type
  - wrong region / wrong content
- runtime deployment failure
  - edited workspace file but UI executed old installed adapter

## Recommended Artifacts

Useful evidence for export / download debugging:

- `<adapter>/notes/<flow>-dom-findings.md`
- runtime output directory path for the successful run
- one list of raw browser download filenames
- one list of final renamed artifact filenames
- one short note describing why a capture step is hard-required or only optional

## When to Load This Playbook

Load this reference when:

- a page exports files through history rows or drawers
- cross-region or new-tab download flows are flaky
- browser downloads complete but runtime artifacts are missing
- filenames drift between regions or between capture and actual download
- you need to stabilize a multi-file export adapter instead of a simple form submission
