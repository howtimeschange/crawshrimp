# Action Primitives

## General Rule

Each action must have:

- precondition: why it is valid now
- action: one browser operation
- expected result: what should change
- readback: how to verify the result
- fallback: what to do if it fails

## Safe Actions

| Action | Use for | Required readback |
| --- | --- | --- |
| `click` | tabs, filters, menus, detail links, non-final buttons | visible state changed, menu opened, detail displayed |
| `type` | search boxes and safe form fields | field value matches intended value |
| `select` | dropdowns, radios, checkboxes | selected label or checked state matches |
| `paginate` | next/previous/page-size changes | row signature or page number changed |
| `download` | exports and file links | file exists and matches expected type/scope |
| `upload` | attaching local files to file inputs | selected file count or upload-ready state matches |
| `wait` | async loading, report generation, download completion | explicit busy-to-ready or artifact evidence |
| `navigate` | opening known safe pages | URL/title/page model matches target |

## Caution Actions

Uploads, batch actions, cross-account switching, and ambiguous confirmation dialogs need a stated reason and a check that the next step is not dangerous. Uploading a file is not permission to submit or publish it.

## Dangerous Actions

Never perform these without explicit user confirmation:

- submit
- publish
- send
- delete
- pay
- purchase
- confirm
- bulk modify
- any action with real external side effects

Confirmation must name the exact target and consequence. A generic "go ahead" is not enough when the page indicates irreversible impact.

## Retry Rules

- Re-query the current page state before retrying.
- Retry the smallest failing action.
- Do not refresh as the first fallback.
- Stop after repeated ambiguous failures and report the evidence.
