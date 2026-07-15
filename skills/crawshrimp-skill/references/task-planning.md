# Task Planning

## Goal First

Start from the user's requested outcome, not from a script shape.

Plan each webpage task as:

1. current page evidence from the user's `http://127.0.0.1:9222` browser
2. page-owned API/request path to inspect or use first
3. next safe question to answer
4. one API-first action or read
5. expected API/application and UI readback
6. fallback DOM action only if the API path is unavailable, unsafe, or unverifiable

## Task Families

- `read`: collect page-owned API evidence and visible data without changing state.
- `operate`: use page-owned APIs first, or fallback UI controls, to change local page state such as filters, tabs, pagination, form fields, or downloads.
- `flow`: move through multiple pages, drawers, dialogs, or repeated detail states.

## Replanning

Replan when:

- the page URL, active dialog, or result region changes unexpectedly
- a selector no longer exists after re-render
- a table signature or row count does not change after a filter or page turn
- a file, request, or success message does not appear

The next step after failed readback is normally `observe`, not another larger script.
