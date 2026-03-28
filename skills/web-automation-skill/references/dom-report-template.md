# DOM Experiment Report Template

Use this template after a DOM Lab session. Keep it short, factual, and evidence-driven.

## 1. Context

- Site / adapter:
- Page name:
- URL:
- Account / store / site context:
- Business step under test:
- Test date:

## 2. Goal

- What exact interaction are we trying to prove?
- What counts as success on this page?

Example:

- Set voucher start/end time to exact minute
- Switch discount type from default to target option
- Make dependent amount input appear and accept the expected value

## 3. Page Snapshot

- Key heading / title:
- Main form region:
- Current visible values:
- Critical screenshots:

## 4. Key DOM Findings

Record only the selectors and observations that matter.

| Area | Selector / clue | Observation | Confidence |
|------|------------------|-------------|------------|
| Trigger | `.eds-react-select` | Root contains trigger and portal text | high |
| Display value | `.eds-react-select__inner` | Safer readback target than root text | high |
| Popup root | `.eds-react-popover` | Renders at body tail | high |

## 5. Framework / Component Clues

- React clues:
  - fiber / props:
  - event handler names:
  - candidate state path:
- Vue clues:
  - component instance:
  - `modelValue` / `props`:
  - candidate update method:

## 6. Candidate Interaction Paths

List attempts in priority order.

| Priority | Method | Expected effect | Actual result |
|----------|--------|-----------------|---------------|
| 1 | state injection | direct value update | |
| 2 | component event | trigger bound state change | |
| 3 | native DOM event | input/change/click | |
| 4 | CDP click | visual click fallback | |

## 7. Single-Control Experiment Log

For each important control, record one mini closed loop.

### Control A

- Control type:
- Initial value:
- Target value:
- Method tried:
- Readback selector:
- Result:
- Notes:

### Control B

- Control type:
- Initial value:
- Target value:
- Method tried:
- Readback selector:
- Result:
- Notes:

## 8. Re-render / Timing Notes

- Does the node get replaced after interaction?
- Does a dependent field appear later?
- Does the popup render in a portal?
- Does the displayed text lag behind the state update?

## 9. Success Signals

Record only signals that really indicate business success.

- URL change:
- Toast / message:
- Inline success card / title:
- Button text:
- Server-driven table refresh:

## 10. Failure Signals

- Validation red text:
- Business-rule rejection text:
- Login redirect:
- Anti-bot / environment error:
- Script-level exception:

## 11. Final Decision

- Best interaction path:
- Why this path is preferred:
- What should be written into the adapter:
- What should remain as fallback only:

## 12. Backups / Evidence

- Saved screenshot paths:
- Saved JSON / DOM report paths:
- Backed-up helper file:
- Related adapter file:

## 13. Next Step

Pick exactly one:

- write helper into adapter
- finish page-level closed loop
- run single-row regression
- run multi-row regression
- stop and wait for business cleanup / account / network fix
