# Verification

## Structured Checks

The high-level operator supports these reusable checks:

- `text`: body text contains the target string
- `url`: current URL contains the target string
- `selector-exists`: a selector exists on the current page
- `table-rows-min`: a table selector has at least the requested number of rows
- `file-exists`: a downloaded file exists and has nonzero size

Use raw JavaScript expressions only when these checks cannot describe the evidence.

## Completion Standard

Completion means evidence proves the requested outcome:

- extracted rows include visible or request-backed source context
- filters and page state read back correctly
- downloads have path, filename, and nonzero bytes
- multi-step flows record transition evidence

Clicking a button is never completion by itself.
