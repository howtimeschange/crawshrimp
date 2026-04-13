# API-First Fallback Playbook

Use this playbook when a page's UI is less trustworthy than its own request path.

Typical signals:

- the page shows false busy or false empty states
- a warning such as “Too many visitors” appears even though data still exists
- table rendering lags behind the page's own backend response
- UI pagination is much flakier than the underlying list API

## Target Output

Before calling an API-first path stable, you should have:

- a clear reason DOM-only collection is not trustworthy enough
- one verified way to discover the page-owned request path
- a mapping from visible filters to API payload fields
- conservative pacing and retry rules
- one end-to-end result that matches the requested scope

## 1. Decide DOM-First vs API-First Explicitly

Stay DOM-first when:

- the page renders stable rows
- filters read back correctly
- pagination is reliable
- warnings match the actual business result

Switch to API-first when:

- the UI often lies about busy or empty state
- the list API is more stable than the rendered table
- host, site, or page switches can still be restored through the DOM
- the page already owns a request client you can safely reuse

Use a mixed strategy when:

- API collects list rows
- DOM restores filters, scope, and context
- DOM remains the source for detail actions or final user-facing verification

## 2. Prove The UI Is Lying Before Re-Architecting

Look for evidence like:

- stale empty marker while old rows remain underneath
- warning banner with no real row refresh
- page number changed but row signature did not
- API response shows data while the table remains empty

Do not switch to API-first just because one click failed once.

## 3. Probe The Page-Owned Request Path

Candidate sources:

- page webpack runtime
- request helper modules
- temporary fetch or XHR capture during one manual query
- already-loaded client instances on `window`

Rules:

- prefer reusing the page's own authenticated request path
- do not invent a separate external client unless necessary
- keep this as a page-level experiment first

## 4. Keep Filter Semantics Identical

When moving list collection to API-first, preserve the same user-facing meaning:

- site or region
- time range or grain
- category path
- quick filter
- identifier search

The adapter should collect the same business slice the UI would have collected if the UI were stable.

## 5. Keep DOM For Scope And Readback

Even in API-first mode, the DOM still matters for:

- restoring site or region
- reading visible filter context
- resolving host-based scope
- proving the page is on the intended business screen
- opening detail drawers when needed

API-first should reduce UI fragility, not eliminate contextual readback discipline.

## 6. Separate Retry Types

Handle these differently:

- rate limit or anti-bot response
- network timeout
- temporary client lookup failure
- business no-data result
- stale DOM readback after a successful API response

Do not treat all API failures as identical retries.

## 7. Acceptance Checklist

Before calling the fallback stable, verify:

- rows match the requested scope
- pagination is monotonic and bounded
- retries are bounded
- rate-limit backoff is conservative
- the final output does not lose the last page
- DOM and API context do not drift apart

## When To Load This Playbook

Load this reference when:

- the rendered table is less reliable than the page's own requests
- busy or empty banners are frequently false
- the user sees data manually but automation keeps deciding there is none
- list scraping needs to survive throttling better than UI pagination can
