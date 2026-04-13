# Export Guards And Final Validation

Use this note when adapter correctness is judged by the exported file, not just by whether the script finished.

## 1. Add a final export guard

If duplicates are business-critical, add one more dedupe guard right before the sink writes the final file.

This is a safety net for:

- retry races
- repeated last-page collection
- drawer reopen after partial success
- scope recovery that re-enters the same logical target

Rule:

- in-run dedupe reduces waste
- export-time dedupe prevents bad files from landing
- both are useful; neither replaces the other

## 2. Build dedupe keys from business identity

Good dedupe keys are made from stable business fields, for example:

- `SPU + 国家 + 粒度 + 日期 + 站点`
- `外层站点 + 列表页码 + SPU`
- `订单号 + 店铺 + 账期`

Avoid keys made only from:

- display text
- row index
- transient DOM order
- timestamps added by the crawler itself

## 3. Validate export against the requested scope

Before you call the export “good”, check:

- output file exists
- every requested site appears
- every requested time range label is preserved
- row counts are plausible by scope
- duplicate business keys are zero
- the last page was not skipped
- error rows and data rows are not mixed accidentally

## 4. Treat scope drift as a correctness bug

Typical scope-drift bugs:

- requested `今日`, exported `昨日`
- switched to next site but reused previous site's filters
- current outer site label differs from current host
- one site silently missing from the final file

These should fail validation even if the script technically completed.

## 5. Suggested acceptance checklist for multi-scope exports

For site or time-range matrix runs:

- task status is `done`
- export file exists
- all requested outer scopes are present
- per-row scope labels match the requested labels
- duplicate keys are zero
- row counts by scope are internally consistent

## 6. Commit-time habit

If the task touches export logic, keep one small script-level regression plus one exported-file acceptance check.

The regression proves the logic.

The acceptance check proves the user gets the right file.
