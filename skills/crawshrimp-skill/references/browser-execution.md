# Browser Execution Layer

## Default Entry

Use `scripts/web_operator.py` for agent-facing work. It exposes the five protocol verbs:

- `observe`: get a normalized page model
- `act`: run one safe browser action
- `verify`: evaluate completion evidence
- `journal`: create or write an evidence journal
- `distill`: turn the journal into workflow or adapter draft notes

For every webpage task, default to the user's already-open Chrome CDP endpoint:

```bash
python3 scripts/web_operator.py observe --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com --task "inspect current page" --journal run.json
python3 scripts/browser_executor.py cdp --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com observe
python3 scripts/browser_executor.py cdp --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com eval --script "document.title"
```

If this lands on a login page or unexpected host, check the 9222 tab list and target host before asking the user to authenticate. A fresh browser, in-app browser, or extension path often lacks the cookies, runtime state, and active page context that the user already prepared.

## 9222 Connection-Refused Recovery

Run this recovery only after the task is classified and the existing endpoint was tried. Probe both `/json/version` and `/json` with a short bounded request. Treat the endpoint as ready only when `/json/version` returns a JSON object with a nonempty `Browser` field and `/json` returns a JSON array.

Prefer the bundled helper for the complete safe recovery loop:

```bash
python3 scripts/ensure_cdp_browser.py --cdp-url http://127.0.0.1:9222 --timeout-seconds 30
```

| Probe result | Required behavior |
| --- | --- |
| Both endpoints report **connection refused** | Re-probe once immediately. If still refused, proactively launch one dedicated Chrome on 9222, wait for both endpoints to be ready, and resume the original `observe`. Do not ask the user to start Chrome. |
| Either endpoint times out, returns HTTP 404/non-200, malformed JSON, or partial CDP data | Do not launch or kill anything. Report the port/instance diagnostic; it may be an occupied non-CDP port or an unhealthy Chrome. |
| CDP is healthy, but login/tab/host is wrong | Do not launch another browser. Resolve the tab/session mismatch through normal observation or ask the user to log in only when needed. |

The automatic recovery is only for a confirmed connection refused state. It is not a generic retry mechanism. Never use `pkill`, close an unknown Chrome, take over a listener, use the default Chrome profile, export credentials, or add permissive remote-origin/web-security flags.

On macOS, use a dedicated skill-owned profile and bind the debug server to loopback:

```bash
mkdir -p "$HOME/.crawshrimp-skill/chrome-profile"
nohup "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.crawshrimp-skill/chrome-profile" \
  --no-first-run \
  --no-default-browser-check \
  --new-window about:blank \
  >"$HOME/.crawshrimp-skill/chrome-9222.log" 2>&1 &
```

On other systems, locate Chrome or Chromium and keep the same `--remote-debugging-address=127.0.0.1`, `--remote-debugging-port=9222`, and isolated `--user-data-dir` arguments. Before launching, re-probe so a concurrently recovered endpoint is reused; launch at most once for one recovery event.

Wait no more than 30 seconds, then confirm both endpoint shapes before retrying the exact original command:

```bash
curl --noproxy '*' -fsS --connect-timeout 1 --max-time 2 \
  http://127.0.0.1:9222/json/version
curl --noproxy '*' -fsS --connect-timeout 1 --max-time 2 \
  http://127.0.0.1:9222/json
```

Record a sanitized journal entry for the probe result, dedicated profile ownership, launch attempt, and ready/failure evidence. A ready new browser can still be unauthenticated; if it reaches a login page, ask the user to authenticate in that visible dedicated browser, then continue. Do not copy cookies or tokens from any other profile.

## API-First Operation

After observation, prefer the page's own API or request path over manual clicking:

- frontend modules, stores, route actions, or request wrappers already loaded by the page
- observed API endpoints and payload shapes from capture output
- in-page `fetch` that runs inside the current page context
- direct file/export/download URLs that can be verified without brittle UI steps

DOM clicks and coordinate actions are fallback surfaces. Use them when the API path is unavailable, unsafe, unverifiable, or when a visible interaction is the user's actual target. UI is still valuable for readback and verification after an API-first action.

## High-Level Operator

Start from the 9222 browser, then use:

```bash
python3 scripts/web_operator.py observe --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com --task "read report" --journal run.json
python3 scripts/browser_executor.py cdp --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com capture --capture-mode passive --matches-json '[{"url_contains":"/api/"}]' --include-response-body
python3 scripts/browser_executor.py cdp --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com eval --script "document.title"
python3 scripts/web_operator.py verify --url-prefix https://example.com --expression "document.body.innerText.includes('sku123')" --evidence "SKU filter is visible" --journal run.json
python3 scripts/web_operator.py verify --check table-rows-min --target table --minimum 1 --evidence "table has rows" --journal run.json
python3 scripts/web_operator.py verify --check file-exists --target report.csv --download-dir ~/Downloads --evidence "report file exists" --journal run.json
python3 scripts/web_operator.py distill --journal run.json --output workflow.md
python3 scripts/web_operator.py distill --journal run.json --output-dir reusable-workflow --name sku-report --include-skill
```

If the API path cannot solve the task safely, use fallback UI actions one at a time:

```bash
python3 scripts/web_operator.py act click --url-prefix https://example.com --selector "button.export" --reason "fallback: open export menu after API path was unavailable" --journal run.json
python3 scripts/web_operator.py act type --url-prefix https://example.com --selector "input.search" --value "sku123" --reason "fallback: visible search is the available control" --journal run.json
python3 scripts/web_operator.py act download --url-prefix https://example.com --selector "a.export" --expected-file report.csv --download-dir ~/Downloads --reason "fallback: download URL was not exposed" --journal run.json
```

The operator uses `Runtime.evaluate` for DOM snapshots, page-context API calls, DOM actions, and verification checks. It intentionally runs one small action at a time so the agent can re-observe or verify before continuing.

When `--journal` points to an existing file, `observe`, `act`, and `verify` load it and append the next evidence item instead of replacing the route.

Download actions snapshot the download directory before clicking and then wait for a new nonempty file. Upload actions use the backend's CDP file-input primitive.

## Low-Level CDP

Use `scripts/browser_executor.py` for primitive access:

```bash
python3 scripts/browser_executor.py cdp --cdp-url http://127.0.0.1:9222 --url-prefix https://example.com observe
python3 scripts/browser_executor.py cdp --tab-id <tab-id> eval --script "document.title"
python3 scripts/browser_executor.py cdp --tab-id <tab-id> click --x 120 --y 240
python3 scripts/browser_executor.py cdp --tab-id <tab-id> navigate --url https://example.com/report
python3 scripts/browser_executor.py cdp --tab-id <tab-id> capture --capture-mode passive --matches-json '[{"url_contains":"/api/"}]'
```

Low-level CDP actions map to:

- `Runtime.evaluate` for `eval`
- `Input.dispatchMouseEvent` for `click`
- `Page.navigate` for `navigate`
- `DOM.setFileInputFiles` for `upload`
- `Network.responseReceived` for `capture`

Direct CDP observe currently returns tab-level metadata. Use `eval` with page-model snippets when you need deeper DOM or accessibility structure.

The higher-level `web_operator.py observe` runs a DOM snapshot and is usually better for page modeling. Use low-level direct CDP observe when choosing a tab or debugging the endpoint itself.

## Safety Rules

- Browser execution is not permission to perform dangerous actions.
- Prefer the page-owned API/request path before manual page clicking, while keeping credentials inside page context.
- Coordinate clicks are less self-explanatory than selector or role clicks; journal why the coordinate is safe.
- For submit, publish, send, delete, pay, purchase, confirm, or bulk modify, stop and request explicit user confirmation before calling the backend.
- For enterprise form save/submit, require explicit authorization naming the change unless the user's instruction already gives that authorization.
- Do not read cookies, localStorage, sessionStorage, auth headers, tokens, or secrets just because CDP makes them accessible.
- When an explicitly authorized task uses the page's own API or in-page `fetch`, keep session credentials inside page context and never print, persist, journal, or reuse them outside the current browser session. Log sanitized endpoint, payload shape, and response status instead.
- After each backend action, re-observe or run a verification eval before continuing.

## Failure Handling

- If CDP reports multiple matching tabs, ask for `--tab-id`.
- If both CDP health endpoints specifically report connection refused, follow the dedicated Chrome recovery above instead of asking the user to start Chrome.
- If 9222 times out, returns 404/non-CDP data, or is only partially healthy, do not start or terminate a browser; preserve the diagnostic and report the blocker.
- If a page re-renders after an action, discard stale control assumptions and observe again.
