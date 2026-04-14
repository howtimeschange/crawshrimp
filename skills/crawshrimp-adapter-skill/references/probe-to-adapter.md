# Probe To Adapter Translation

Use this note when a probe bundle already exists and the next question is how to convert that reconnaissance into a stable crawshrimp adapter design.

## 1. Start from the probe bundle, not from memory

Read these artifacts first:

- `page-map.json`
- `dom.json`
- `endpoints.json`
- `strategy.json`
- `recommendations.json`
- curated repo note under `adapters/<adapter_id>/notes/`

Treat the curated note as the human summary and the bundle as the raw evidence.

## 2. Translate page states into phases

`page-map.json` should drive phase boundaries.

Typical mapping:

- list page -> `prepare_scope`
- active row found -> `open_detail`
- drawer visible -> `collect_detail`
- export pending -> `trigger_export`
- task history / browser download -> `fetch_artifact`

Rules:

- one business state transition per phase
- do not mix “open drawer” and “collect all drawer pages” into the same unstable phase
- use the state map to define re-entry points after refresh or retry

## 3. Translate DOM evidence into readback and waits

From `dom.json`, choose:

- the display-value selector to read back after every important interaction
- the active container selector for scoped queries
- the row signature / table signature / drawer signature used as transition evidence

Do not wait on “click happened”.
Wait on a business-visible state change.

## 4. Translate network evidence into runtime actions

From `endpoints.json` and `recommendations.json`, decide whether the adapter should use:

- plain DOM flow
- `capture_click_requests`
- `capture_url_requests`
- `download_urls`
- mixed DOM + runtime capture

Rules:

- keep the user-facing page context in DOM when page state matters
- use runtime request capture when export or detail payloads are more reliable than visible DOM
- do not switch to API-first just because a JSON response exists once; it must fit recovery and auth reality

## 5. Translate strategy into adapter shape

If `strategy.json` says:

- `dom_first`
  - keep the main loop in DOM
  - use probe outputs to build stronger readback and recovery
- `api_first`
  - reduce UI work to navigation / auth / trigger only
  - move the real collection into replayable requests
- `mixed`
  - let DOM hold context and scope
  - let API or runtime capture hold the heavy payload / export / artifact step

## 6. Translate probe findings into `shared`

Probe usually exposes the real context keys you need to carry.

Common mappings:

- current site / region -> `current_store`
- current row / spu / buyer / item -> `current_buyer_id` or task-specific shared key
- current drawer scope / granularity / page -> task-specific shared keys
- total row count / batch count -> standard progress keys

Store explicit user choices once, then restore from `shared`.

## 7. Translate probe risks into recovery branches

Probe should reveal unstable points such as:

- portal popover disappears after re-render
- displayed value changes before table data changes
- export opens a transient tab
- same page has “no target” and “target failed” as different cases

Those findings should become explicit recovery branches, not comments.

## 8. Translate probe into regression cases

Every important probe conclusion should lead to at least one regression target:

- stable selector / container assumption
- transition evidence assumption
- runtime capture payload shape
- export artifact acceptance rule
- state restore after retry

If the probe changes the strategy, the regression surface probably changed too.
