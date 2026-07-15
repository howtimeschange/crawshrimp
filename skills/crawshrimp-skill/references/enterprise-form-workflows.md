# Enterprise Form Workflows

Use this for logged-in enterprise/internal admin pages, product or AI-workflow settings, quotas, percentages, role allocations, approval forms, and other stateful business forms.

## Procedure

1. Connect to the user's prepared CDP browser first: `--cdp-url http://127.0.0.1:9222`. This is the default for all tasks, not an enterprise-only exception.
2. Observe the target host and tab. If a login page appears, check the 9222 session and matching tabs before asking the user to log in again.
3. Identify visible account, workspace, environment, record name, and whether the page is production-like.
4. Read business rules before editing: quota, "used", "remaining", "available", percentage total, validation text, disabled state, and save/submit semantics.
5. Map the fields and current values to the user's requested target values.
6. Choose the operation surface:
   - Prefer page-owned frontend API/module wrappers, actions, or observed request shapes already loaded by the app.
   - Use visible DOM controls only when the API path is unavailable, unsafe, unverifiable, or the visible interaction is itself required.
   - Keep credentials inside the existing page/session context; never print, persist, journal, or copy cookies, tokens, auth headers, localStorage, sessionStorage, or secrets.
7. Plan update ordering to avoid invalid intermediate states. For a capped total such as 100%, lower the oversized item before raising the others.
8. Fill or update fields one cluster at a time, with readback after each cluster.
9. Final save/submit requires explicit user authorization for the exact external effect. If the user already authorized it, proceed and record the authorization in the journal.
10. Double verification after saving: refresh or re-observe the visible UI, then use application/API readback when available.
11. Journal observations, rules, old/new values, action order, authorization, verification evidence, and reusable workflow notes.
12. Distill the successful workflow into `workflow.md` or a reusable package when it is likely to recur.

## API Wrapper Rule

Prefer the app's own in-page modules, actions, API wrapper functions, or observed request paths when they are exposed by the running frontend and can be verified safely. Treat them as the same application surface a user action would trigger.

For authorized saves or publishes, an in-page `fetch` or application wrapper may use the current browser session/token only inside page context. This is acceptable when the user explicitly authorized the external effect, the endpoint belongs to the app being operated, and the payload shape came from the page's code, disabled rules, or observed network behavior. It is not acceptable to export credentials, replay them from a separate script, or turn them into reusable secrets.

Useful evidence includes function names, request names, response status, sanitized payload shape, and returned business fields. Exclude secrets and account-sensitive identifiers unless the task requires them.

## Percentage Updates

For allocation forms with a total cap, avoid invalid intermediate states:

- If one item must go down and others go up, lower the large item first.
- If the UI validates on blur, blur and verify after each cluster.
- If the UI only validates on save, prepare all values, then read back the total before saving.
- Keep the target total explicit in the journal, such as `20 + 25 + 15 + 20 + 20 = 100`.

## Evidence Checklist

- CDP endpoint and matched URL/tab came from `http://127.0.0.1:9222`.
- Login/session status was checked in that browser before asking for authentication.
- Business rules and constraints were read before edits.
- Old and target values were recorded.
- Save/submit authorization was explicit.
- Visible UI after refresh shows the target state.
- Application/API readback confirms the persisted state when available.
- Journal can be distilled into a reusable workflow.
