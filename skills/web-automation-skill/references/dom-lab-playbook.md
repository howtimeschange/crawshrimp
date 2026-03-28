# DOM Lab Playbook

This playbook is the default workflow for building or repairing a new web automation flow.

## Target Output

Before you call a task “stable”, you should have:

- a DOM report for the key page
- screenshots of the critical controls
- at least one verified interaction path per stubborn control
- a page-level closed loop result
- a clear success signal and failure signal list

## Step 1: Freeze the Real Page Under Test

Work against a real page first.

Capture:

- current URL
- current account / store / site context
- page title or key heading
- whether the current page is already in the correct business state

Do not start from a guessed DOM model.

## Step 2: Build a DOM Report

Inspect the critical region and collect:

- text anchors
- `data-testid`
- visible inputs, buttons, radios, checkboxes
- select / date-picker structure
- portal popover roots
- framework clues:
  - React props / fiber
  - Vue component instance / `modelValue`
  - custom event handlers

Recommended output shape:

- page name
- key selectors
- visible values
- candidate success signals
- candidate error signals
- notes about re-render or delayed fields

## Step 3: Run Single-Control Experiments

For each stubborn control, validate it in isolation.

Examples:

- write one date value and read it back
- switch one select value and confirm the trigger text changed
- toggle one radio and confirm the dependent field appears
- type into one input and confirm the real displayed value matches expectation

Do not test the whole task until these controls are proven.

## Step 4: Choose the Interaction Path

Use this priority:

1. state injection
2. component event
3. native DOM events
4. CDP click

Interpretation:

- If a React or Vue component can be changed through state or component event, prefer that.
- If the page re-renders and CDP clicks are timing-sensitive, do not treat click success as state success.
- Always confirm the **resulting value on screen**, not just the action call.

## Step 5: Complete a Page-Level Closed Loop

Before writing adapter batch logic, prove one full page flow:

1. fill all required fields
2. read back critical fields
3. submit
4. detect one of:
   - success
   - business-rule rejection
   - auth/session break
   - script failure

If this page-level loop does not pass, do not move on to Excel or multi-store batch runs.

## Step 6: Write Back Into the Adapter

When moving from experiment to adapter:

- keep phases coarse:
  - `ensure_context`
  - `open_form`
  - `fill_usecase_form`
  - `submit`
  - `post_submit`
- avoid field-level phase explosion
- wrap stubborn controls into dedicated helpers
- keep readback on critical fields only
- preserve a backup of proven injection methods

## Step 7: Regression Ladder

Run regression in this order:

1. single control
2. single page
3. single row / single usecase
4. multiple rows in same store/account
5. multiple stores/accounts
6. error-path validation

Do not jump directly from “one field works” to “whole workbook is stable”.

## Failure Taxonomy

Classify failures before fixing:

- **Script failure**
  - wrong selector
  - stale node
  - bad phase transition
  - readback mismatch
- **Business failure**
  - duplicate date range
  - policy limit
  - invalid combination
- **Auth/session failure**
  - redirected login
  - expired session
  - wrong current tab
- **Environment failure**
  - proxy / VPN
  - CDP connection issue
  - anti-bot or network instability

This distinction prevents over-fixing code for non-code problems.

## Recommended Artifacts

Useful artifact naming:

- `/tmp/<site>_dom_report.json`
- `/tmp/<site>_shots/`
- `<adapter>/date-injection-backup.js`
- `<adapter>/notes/<usecase>-dom-findings.md`

The exact path can vary, but the habit should stay the same: keep evidence of what actually worked.
