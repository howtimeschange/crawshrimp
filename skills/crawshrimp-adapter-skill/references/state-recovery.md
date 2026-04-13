# Adapter State Recovery

Use this note when crawshrimp adapters need to survive retries, reloads, host switches, or flaky page states.

## 1. Classify the failure before you recover

Do not send every failure into the same retry branch.

Use these buckets:

- Auth or session failure
- Environment failure: timeout, page freeze, disconnected bridge
- Rate limit or traffic control
- Re-render race: node disappeared, drawer rebuilt, popup root replaced
- No target on current page or scope
- Business-rule rejection: the target exists but the site rejected the operation

Each bucket needs a different recovery path.

## 2. Preserve explicit user choices once

If the user explicitly picked any of these, write them to `shared` early and keep reusing them:

- outer sites
- time range label
- time dimension value
- category path or category leaf ID
- quick filter
- product identifier query

Rule:

- Downstream phases should restore from `shared`.
- DOM is only for readback and verification, not the long-term source of truth.

## 3. Site switching should not depend on fragile button state alone

When possible, resolve current site from durable signals:

- host name
- URL
- stable page context

Use button highlights only as a secondary hint.

Why:

- after cross-host navigation, button state may lag
- the page may re-render before the selected state is visible
- some sites reuse the same page but different hosts represent different outer scopes

## 4. Wait for real state transition, not just visual optimism

A good wait condition proves the page actually refreshed.

Candidate evidence:

- page number changed
- row signature changed
- visible row count changed
- busy or empty marker changed under the same active container
- host changed after a cross-site switch
- selected time capsule matches the requested label

Weak evidence:

- input value changed
- button looked clicked
- popup is still open
- one warning text disappeared

## 5. Separate pagination from current-scope execution failure

Interpretation rules:

- `No target on current page` means continue pagination or move to next scope.
- `Target existed but action failed` means stay on the same scope, retry, refresh if needed, and restore the same context.

Do not advance site or page just because one interaction failed.

## 6. API-first is justified when DOM is lying

Prefer an API-first path when:

- the page frequently shows a false busy warning
- the page says “Too many visitors” but data still exists
- the list table is less reliable than the page's own request client
- UI pagination is far less stable than backend pagination

If you move to API-first:

- keep the same user-facing filters and scope semantics
- keep conservative request pacing
- classify timeout and rate-limit retries separately

## 7. Recovery ladder

Default order:

1. Re-query current DOM nodes.
2. Retry the current phase with the same `shared`.
3. Re-open the current drawer or popup and restore the same context.
4. Reload the page and restore site, time range, page, and current target.
5. Only then escalate to switching scope or failing the row.

## 8. Last-page rule

Do not close a drawer or advance outer scope until the current page's data is already captured in memory.

The safe order is:

1. verify the page is ready
2. extract rows
3. append rows
4. verify there is no next page
5. close drawer or advance scope
