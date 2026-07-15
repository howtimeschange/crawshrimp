# Page Observation

## Minimum Page Model

Capture enough state for another agent to understand the page without seeing it:

- URL and title.
- Visible headings and important text.
- Forms, inputs, selects, checkboxes, radios, buttons, tabs, menus, and dialogs.
- Tables, lists, cards, result counts, pagination, and empty/busy/error states.
- Downloads, upload controls, and generated artifacts.
- Network clues, frontend modules, stores, action wrappers, and page-owned API paths.

## Unknown Page Routine

1. Connect to the user's `http://127.0.0.1:9222` browser and read the current page before acting.
2. Identify the user's target object: table, product, order, file, dialog, report, or form.
3. Identify the page-owned API/request path that reads or mutates the target object.
4. Identify safe controls and dangerous controls separately.
5. Find success signals before acting.
6. Find failure and blocking signals before acting.
7. Act only after the page model explains why the API path or fallback UI action is safe and useful.

## Dynamic Page Rules

- Re-observe after navigation, re-render, popover open/close, filter changes, pagination, downloads, or errors.
- Scope observations to the active dialog, drawer, tab, frame, or page region.
- Prefer page-owned API paths over DOM actions; if falling back to DOM, prefer stable labels and roles over brittle CSS selectors.
- Treat stale rows, false loading states, and empty states as evidence problems, not immediate conclusions.

## Useful Evidence

- "The filter chip now says Last 7 days."
- "The results table has 43 rows and the first row changed from X to Y."
- "The detail drawer title matches order 123."
- "A file named report.csv appeared and has nonzero size."
- "The visible warning says this action cannot be undone."
