# Windows Runtime Self-Healing Design

## Goal

Make the Crawshrimp Windows desktop client recover predictably from an unwritable runtime directory, a failed or crashed Python backend, an unhealthy Chrome CDP endpoint, duplicate desktop instances, and manual/update installer shutdown conflicts.

## Scope

This change covers the Electron desktop runtime only. It does not migrate user data automatically, kill unknown processes, change the stable API/CDP default ports, or bypass the existing active-task shutdown guard.

## Backend recovery

The backend controller remains the owner of Python process readiness. It gains durable diagnostics (`state`, `lastError`, `launchAttempt`) and a reset-safe stop operation that clears failed in-flight state even when no child process remains.

Electron exposes a single-flight `restart-backend` IPC action. The action stops only the owned backend process tree, clears stale readiness state, reruns data-directory and port preflight, launches the backend, validates the launch identity, and returns a structured status snapshot. Concurrent button presses share the same recovery promise.

The Python backend may select a fallback data directory when `CRAWSHRIMP_ALLOW_DATA_FALLBACK=1`. If the health response has the current backend instance ID, owns its backend lock, and uses the expected scripts directory, Electron adopts the returned absolute writable data directory, persists it to `desktop-config.json`, and treats the backend as compatible. A different instance ID or scripts directory remains foreign and is never adopted.

## Chrome recovery

CDP health requires both `/json/version` and `/json` to return valid Chrome payloads. Probe results use stable kinds:

- `ready`
- `connection-refused`
- `timeout`
- `occupied-non-cdp`
- `partial-cdp`
- `invalid-cdp`

The launch action is single-flight. It never starts another browser when an unknown responder occupies port 9222. If the recorded managed Chrome process is alive, matches the dedicated profile and port, but CDP is unhealthy, Electron stops only that verified managed process before one clean relaunch. Chrome startup stderr is retained in the desktop log and included in the final diagnostic.

## User experience

The settings service panel exposes:

- backend lifecycle state and last startup error;
- resolved runtime data directory and fallback explanation;
- `修复核心服务` action;
- structured Chrome status and `修复 Chrome 连接` action;
- `打开诊断日志` action.

The script-list error action invokes backend recovery before reloading tasks. Raw stack traces remain available in the log but the primary UI uses concise Chinese messages.

## Installer and process lifecycle

The desktop process acquires Electron's single-instance lock before starting services. A second launch focuses the existing window and exits without spawning another backend or Chrome.

The existing task-aware in-app update flow remains authoritative. Manual bridge installation from updater-disabled releases still requires the old app to exit; the documentation must state that the NSIS “抓虾无法关闭” prompt is a safety block, not a clean-install error. The installer must not force-kill an unknown or task-running app.

## Testing

Automated tests cover:

- controller diagnostics and reset when the child already exited;
- explicit backend recovery single-flight behavior;
- adoption of an owned Python fallback data directory and rejection of foreign runtimes;
- all CDP probe classifications;
- no Chrome spawn for an unknown 9222 responder;
- verified managed-Chrome restart without duplicate launches;
- single-instance focus behavior;
- IPC/preload/renderer wiring and settings actions;
- current desktop tests, Python runtime-path tests, full app tests, root Node tests, and Vite production build.

Real Windows acceptance remains required for denied legacy ACLs, enterprise endpoint protection, manual bridge overlay, in-app update, Chinese usernames, and stale processes.
