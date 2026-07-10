# Crawshrimp Desktop Auto-Update Design

## Goal

Add a production-safe desktop auto-update mechanism for Crawshrimp on macOS and Windows. The application checks the latest formal version after startup, lets the user explicitly start the download, waits for all interruptible work to finish, and installs only after the user explicitly chooses to restart.

The same application-shell change adds a persistent collapsible sidebar and a bottom footer that always displays the current version and, when relevant, the update action and progress.

## Decisions

- Use `electron-updater` with formal GitHub Releases.
- Only stable semantic `vX.Y.Z` tags are eligible for in-app updates.
- Keep `desktop-latest` as a manual-download and QA surface. It is never an in-app update channel.
- Check automatically after startup, but do not download automatically.
- Download only after the user clicks the update action.
- Never install automatically on ordinary application quit.
- Never force an update or block normal product use because an update exists.
- Never stop an active task merely to install an update.
- Require a second explicit user action, “重启安装”, after the update is downloaded and the runtime is idle.
- Keep the Windows updater usable before a Windows code-signing certificate is available.
- Require Developer ID signing, notarization, stapling, and a real ShipIt update test for macOS.
- Collapse the desktop sidebar from 168 px to an approximately 56 px icon rail and persist the user's choice.
- Preserve the existing narrow-screen bottom navigation instead of applying the desktop collapse behavior to it.

## Non-Goals

- No beta, prerelease, nightly, or `main`-branch in-app update channel.
- No forced minimum version or countdown-based installation.
- No background download before user consent.
- No automatic installation when the user closes Crawshrimp normally.
- No automatic downgrade.
- No staged rollout, cohort targeting, or custom update control plane.
- No Linux updater.
- No requirement to obtain a Windows code-signing certificate before the first updater release.
- No unrelated redesign of the navigation or application content pages.

## Context and Prior Implementation

Crawshrimp previously introduced `electron-updater` in the `v1.4.6` release line and removed it in the `v1.4.9` release line. The old implementation already had useful foundations: a main-process update state machine, explicit download and install IPC calls, progress rendering, and task-aware install deferral.

The old macOS update path failed because the ShipIt-delivered application did not have a complete Developer ID signing and notarization chain. The current release pipeline has since added Developer ID signing, hardened runtime, notarization, and stapling for macOS DMGs. Restoring auto-update must validate the ZIP-delivered `.app`, not infer success from a DMG-only validation.

The old task guard tracked a renderer-driven `activeTaskCount`. That is no longer authoritative because Crawshrimp now has regular adapter tasks, task-center instances, AI image work, cloud approval execution, file export, and background cleanup. The new design moves install readiness to the backend and treats unknown readiness as unsafe.

## Update Channels and Version Policy

### Stable channel

The packaged app consumes the GitHub `latest` channel for repository `howtimeschange/crawshrimp`. The feed is pinned in trusted main-process/build configuration; the renderer cannot supply or replace an update URL.

A release is eligible only when all of the following are true:

- Its tag matches `vX.Y.Z`.
- Its tag version exactly matches `app/package.json`.
- It is a published, non-draft, non-prerelease GitHub Release.
- It is marked as the repository's Latest release.
- All required platform assets and update metadata are present.

`allowPrerelease` and `allowDowngrade` remain disabled.

### `desktop-latest`

`desktop-latest` remains a rolling manual-download surface for operators and QA. It must be marked `latest=false`, and the application must never select it as its update feed. It may continue to expose DMGs and the Windows installer for manual testing, but it does not define the stable application update version.

### Bridge release

Installed Crawshrimp versions that do not contain the updater cannot discover the first updater-enabled release. Existing users therefore need one manual overlay installation of a bridge release:

- Windows users run the new NSIS installer over the current installation.
- macOS users open the new DMG and replace `抓虾.app` in Applications.

Neither platform requires an uninstall. Once the bridge release is installed, later stable releases use the in-app update path.

The bridge version number is chosen during release preparation and is not hard-coded into the update UI or service.

## Release Architecture

```text
vX.Y.Z tag
  -> test job
  -> macOS and Windows build jobs
     -> macOS signed/notarized app lineage
        -> arm64 DMG + ZIP
        -> x64 DMG + ZIP
        -> latest-mac.yml
     -> Windows NSIS x64
        -> EXE + blockmap
        -> latest.yml
  -> artifact contract validation
  -> draft versioned GitHub Release
  -> upload and read back every asset
  -> publish as the stable Latest release
```

The formal release is visible to clients only after every platform passes. A partial macOS or Windows build cannot publish an update.

### macOS artifact lineage

The updater uses ZIP, not DMG. Every macOS architecture follows a single app lineage:

1. Build the `.app` with hardened runtime and the existing entitlements.
2. Sign it with the configured Developer ID Application identity.
3. Notarize the signed app payload.
4. Staple the notarization ticket to the `.app`.
5. Produce both DMG and ZIP from that signed, notarized, stapled `.app`.
6. Perform the existing DMG notarization/stapling step where required.
7. Extract the final ZIP and verify the contained `.app` again.

The tag build fails if Apple signing or notarization credentials are missing. A formal update release cannot silently skip macOS signing or notarization.

Required macOS release assets are:

- `crawshrimp-v${version}-mac-arm64.dmg`
- `crawshrimp-v${version}-mac-arm64.zip`
- `crawshrimp-v${version}-mac-x64.dmg`
- `crawshrimp-v${version}-mac-x64.zip`
- `latest-mac.yml`
- Any ZIP blockmap files generated and referenced by Electron Builder

The CI contract validates `codesign --verify --deep --strict`, Team ID, Gatekeeper assessment, and stapling against the ZIP-extracted application. A real packaged ShipIt update remains a release acceptance requirement.

### Windows artifact lineage

Windows continues to use the existing per-user assisted NSIS configuration and stable application identity. Required release assets are:

- `crawshrimp-v${version}-win-x64.exe`
- `crawshrimp-v${version}-win-x64.exe.blockmap`
- `latest.yml`

The blockmap enables differential download when the previous installer is available in the updater cache. If differential download is unavailable, the updater falls back to downloading the complete installer.

Windows code signing is not a functional prerequisite. Before a certificate is available, the updater uses HTTPS plus the SHA512 value in `latest.yml` to reject corrupted or mismatched downloads. The package may still show Unknown Publisher or SmartScreen warnings.

When a Windows certificate becomes available:

- Sign the NSIS installer.
- Generate a stable `publisherName` in the packaged update configuration.
- Let `electron-updater` reject installers whose Authenticode signer does not match.
- Plan certificate rotation with an overlap that accepts the old and new publisher identities before removing the old identity.

The first signed release may be installed by an unsigned bridge app. Verification becomes authoritative for subsequent updates launched by the signed app.

## Client Components

### `UpdateService`

`UpdateService` runs only in the Electron main process and owns `electron-updater`. It is independent of the current renderer route and window lifecycle.

Its public state includes:

```text
status
currentVersion
latestVersion
releaseNotes
progress
error
blockers
lastCheckedAt
downloaded
```

Supported statuses are:

```text
idle
checking
up-to-date
available
downloading
downloaded
waiting-for-tasks
ready-to-install
installing
error
disabled
```

`disabled` is used for development builds and unsupported macOS install locations. The service configures:

```text
autoDownload = false
autoInstallOnAppQuit = false
allowPrerelease = false
allowDowngrade = false
```

The packaged app checks once approximately 15 seconds after the application and desktop services are ready. Manual retry remains available through the sidebar action and the settings surface. A failed startup check does not block application startup.

### `UpdateInstallCoordinator`

The install coordinator separates “downloaded” from “safe to install.” It:

- Queries backend install readiness after a download completes.
- Polls readiness while blockers exist.
- Changes the UI to `ready-to-install` only after the backend is idle.
- Sends one system notification when a waiting update becomes installable.
- Performs a final readiness check when the user clicks “重启安装”.
- Acquires a backend drain token before shutdown.
- Releases the drain token if installation is canceled before shutdown.
- Delegates managed-process cleanup to the lifecycle layer.
- Calls `quitAndInstall` only after cleanup succeeds.

It never requests that an active task stop merely to install an update.

### Backend install readiness

Add an authoritative runtime readiness contract rather than relying on renderer state. The conceptual endpoints are:

```text
GET    /runtime/install-readiness
POST   /runtime/update-drain
DELETE /runtime/update-drain
```

`GET /runtime/install-readiness` returns:

```json
{
  "ready": false,
  "blockers": [
    {
      "kind": "task",
      "id": "adapter::task",
      "label": "任务显示名称",
      "status": "running"
    }
  ],
  "checked_at": "ISO-8601 timestamp"
}
```

Blockers cover all interruptible local execution:

- Regular adapter tasks
- Task-center instances
- AI image generation, editing, download, and persistence work
- Locally executed cloud-approval task-machine work
- File exports and finalization that must finish before process exit
- A scheduler job that is currently executing

The response exposes identifiers and user-readable labels, not task parameters or secrets.

`POST /runtime/update-drain` atomically succeeds only if no blockers exist. While the drain is active, new task starts and scheduler execution are rejected with a specific `update_pending` conflict. This closes the race between the final readiness check and process shutdown.

Drain state is process-local. A normal application restart starts with drain disabled. If the main process abandons installation while the backend remains alive, it explicitly releases the token.

If the main process cannot reach the backend or cannot prove readiness, installation fails closed. It must not interpret an error as an idle runtime.

### Lifecycle integration

The existing normal-quit behavior remains intact: when a user tries to quit with active tasks, Crawshrimp offers to keep running or explicitly stop tasks and exit.

The update-install path is distinct:

- It never offers to stop tasks for the update.
- It waits until readiness is true.
- After acquiring the drain token, it stops the managed Python backend and Crawshrimp-managed Chrome.
- It does not stop a foreign Chrome process that Crawshrimp does not own.
- It marks shutdown as updater-driven so `before-quit` does not reopen a normal quit dialog or recurse into a second shutdown.

## IPC and Trust Boundary

The preload bridge exposes only bounded updater operations:

```text
getUpdateStatus()
checkForUpdates()
downloadUpdate()
installDownloadedUpdate()
onUpdateStatus(callback)
```

The renderer cannot provide a URL, channel, tag, file path, or installer argument. All version comparison, download selection, integrity checking, and installation remain in the main process.

Every IPC handler uses the existing secure handler pattern. Renderer event subscriptions return a cleanup function so remounting a view cannot accumulate listeners.

## Sidebar and Update UX

### Desktop sidebar sizes

The desktop shell has two persistent widths:

- Expanded: 168 px
- Collapsed: approximately 56 px

The collapse control sits near the Crawshrimp logo in the title bar, outside the macOS traffic-light area. Because the title bar is draggable, the control explicitly uses `-webkit-app-region: no-drag`.

The renderer persists the preference under a Crawshrimp-specific local storage key. Toggling it changes the grid column and presentation classes only; it does not change routes or remount the active content view. Content receives the reclaimed width immediately.

In collapsed mode:

- Primary navigation remains visible as centered icons.
- Labels are visually hidden but remain available through tooltips and accessible names.
- The current route retains its active treatment.
- An open script task continues running and stays rendered.
- Switching between named tasks requires expanding the sidebar, avoiding ambiguous task abbreviations in the icon rail.

The current narrow-screen AI-image layout keeps its bottom navigation. The desktop collapsed preference is ignored while the narrow layout is active and resumes when desktop width returns.

### Version and update footer

The sidebar contains a footer outside the current first-level/second-level navigation branch, so it remains visible on every page.

Expanded presentation:

| State | Footer presentation |
| --- | --- |
| Up to date | `vX.Y.Z` |
| Available | `vX.Y.Z` and `更新` |
| Downloading | `下载 42%` |
| Waiting for work | `等待任务完成` |
| Ready | `重启安装` |
| Error | `更新失败 · 重试` |

Collapsed presentation:

| State | Footer presentation |
| --- | --- |
| Up to date | Compact major/minor version badge with full version tooltip |
| Available | Orange update icon with version tooltip |
| Downloading | Compact circular progress or percentage |
| Waiting for work | Waiting icon with blocker-count tooltip |
| Ready | Highlighted restart icon |
| Error | Update icon with an error indicator and retry tooltip |

The version comes from `app.getVersion()` through trusted main-process state. It is never hard-coded in the renderer.

### User flow

1. Packaged Crawshrimp starts normally.
2. Approximately 15 seconds after readiness, the main process checks the stable release.
3. If no update exists, the footer continues showing the current version.
4. If an update exists, the footer shows `更新` without opening a modal or starting a download.
5. Clicking `更新` is explicit download consent and starts the download immediately.
6. The user continues using Crawshrimp while progress is shown in the footer.
7. After download, the install coordinator checks runtime readiness.
8. If blockers exist, the footer shows `等待任务完成`; no task is stopped.
9. When blockers clear, the footer changes to `重启安装` and one system notification is sent.
10. Clicking `重启安装` runs the final readiness and drain sequence.
11. The platform updater replaces the application and restarts it.

The user may ignore the update indefinitely. There is no countdown, blocking modal, forced navigation, or automatic installation on ordinary quit.

## Platform Installation Behavior

### Windows

`electron-updater` downloads the NSIS installer, using the blockmap for differential download when possible. After the explicit restart action, Crawshrimp exits and NSIS updates the existing installation in place, then starts the new version.

The following installer identity and scope settings remain stable across versions:

- `appId: com.crawshrimp.app`
- Product name `抓虾`
- NSIS per-user installation (`perMachine: false`)
- Existing installer identity/registry location

Changing these values can make Windows treat a release as a different application and is outside this design.

Users do not uninstall before an update. A custom installation directory is retained by the existing NSIS installation record. The bridge release is also installed over the existing copy.

### macOS

Normal in-app updates do not download a DMG. `electron-updater` downloads the architecture-appropriate signed ZIP, and Squirrel.Mac/ShipIt replaces the current `.app` bundle before relaunching it.

Before enabling the update action, the client checks that it is a packaged application in a writable, supported installation location. An app running from a mounted DMG, an app-translocated path, Downloads, or another unsuitable read-only location does not attempt a ShipIt update. It instead explains that the user should install Crawshrimp in Applications and provides the manual DMG fallback.

The bridge release and manual recovery path still use DMG drag-and-replace.

### Data preservation

Program files and user data remain separate. The installer replaces the application bundle/install directory only.

Preserved runtime state includes:

- The configured `CRAWSHRIMP_DATA` directory
- Windows default data under `%LOCALAPPDATA%\crawshrimp`
- macOS default data under `~/Library/Application Support/crawshrimp`
- Adapter installations and metadata
- Task data, logs, and exports
- Desktop configuration
- API token and backend state files
- Crawshrimp-managed Chrome profile and login state

The managed Chrome process may close during the explicit restart installation, but its profile is preserved and reopened by the new application version. A running task prevents the update from reaching that shutdown point.

## Download and State Persistence

`electron-updater` owns the downloaded installer cache. Main-process update state may persist the target version and last known status for presentation, but a cached installer is trusted only after its current release metadata and checksum are revalidated.

If a user closes Crawshrimp normally after downloading but before installing:

- The updater does not install on exit.
- The next launch checks the release again.
- A still-valid cached artifact may be reused.
- A stale or mismatched artifact is discarded and downloaded again only after user confirmation.

## Failure Handling

All failures preserve the currently installed application whenever the platform updater has not begun replacement.

| Failure | Behavior |
| --- | --- |
| No network at startup | Keep the current version visible; allow later manual retry |
| Missing or malformed update metadata | Do not download; show a retryable check error |
| Partial GitHub Release | Prevent publication in CI; clients keep the current version |
| Interrupted download | Keep safe cache state and retry/resume when the user asks |
| Insufficient disk space | Stop before installation and report the required free space |
| SHA512 mismatch | Delete the cached artifact and reject installation |
| Windows publisher mismatch | Reject installation once publisher verification is configured |
| macOS signature, Team ID, or ShipIt validation failure | Keep the old app and expose the manual DMG fallback |
| Backend readiness unavailable | Refuse installation and offer retry |
| A task starts during the final check | Drain acquisition fails; return to waiting state |
| Cleanup or updater launch fails before quit | Release drain, keep Crawshrimp running, and retain the valid download |
| New application backend fails after update | Preserve data and surface recovery diagnostics on launch |

Update errors do not remove task data or reset the runtime directory.

## Rollback and Bad Release Response

Automatic downgrade remains disabled.

If a bad release is detected before most users install it:

1. Remove its Latest status or unpublish the Release so new clients stop discovering it.
2. Preserve incident evidence and asset hashes.
3. Publish a higher patch version with the fix.

If users already installed the bad release, recovery uses a higher version such as `vX.Y.(Z+1)`. A manual download link may be shown when the updater itself is affected, but the application still does not force installation.

## Testing Strategy

### Main-process unit tests

Cover:

- Release-note normalization and status snapshots
- Packaged versus development behavior
- Startup check without automatic download
- Explicit download and progress events
- Download failure and retry
- Downloaded-to-waiting and downloaded-to-ready transitions
- Unknown backend readiness failing closed
- Final readiness check and drain acquisition
- Task-start race returning to waiting
- Ordinary quit never installing
- Updater-driven quit avoiding lifecycle recursion
- Cleanup failure releasing drain

### Backend tests

Cover:

- Readiness with no blockers
- Blocker normalization for regular tasks and task instances
- AI image, cloud execution, export, and scheduler blockers
- No sensitive parameters in blocker responses
- Atomic drain acquisition
- New task and scheduler rejection during drain
- Drain release after cancellation
- Fresh process startup with drain disabled

### Renderer tests

Cover:

- Every expanded and collapsed update-footer state
- Version value supplied by the main process
- 168 px/56 px toggle and preference persistence
- Tooltips and accessible names in collapsed mode
- Active route preservation
- Active content view not remounting on collapse
- Secondary task view remaining intact while collapsed
- Narrow-screen bottom navigation ignoring desktop collapse preference
- IPC listener cleanup

### CI artifact contract tests

Cover:

- Tag and package version equality
- Required artifact names for each platform and architecture
- Every file referenced by `latest.yml` and `latest-mac.yml` exists
- Metadata SHA512 values match uploaded files
- Windows EXE and blockmap pairing
- macOS ZIP extraction followed by codesign, Team ID, Gatekeeper, and staple verification
- Formal macOS tag builds fail if signing/notarization configuration is absent
- Release remains unpublished until every artifact passes
- `desktop-latest` is not the GitHub Latest stable release

### Packaged end-to-end update tests

Use a local generic test feed to exercise two consecutive packaged test versions without exposing prereleases to production clients.

Windows acceptance flow:

1. Install the older NSIS package.
2. Seed a user-data sentinel and a custom data directory.
3. Discover and download the newer package.
4. Verify an active task blocks install without being stopped.
5. Finish the task and explicitly restart-install.
6. Verify the new version, original install path, and data sentinel.

macOS acceptance flow on both ARM and Intel:

1. Install the older signed application in Applications.
2. Seed a user-data sentinel.
3. Serve the newer signed ZIP through the test feed.
4. Verify an active task blocks installation.
5. Finish the task and explicitly restart-install through ShipIt.
6. Verify the new version, signature, Team ID, backend startup, and data sentinel.

The bridge release also receives a manual overlay test from the last updater-disabled version on Windows and macOS.

## Release Acceptance Criteria

The feature is ready to ship when all of the following are true:

- Startup check discovers only a newer formal stable release.
- `desktop-latest` cannot trigger an in-app update.
- No download starts before the user clicks the update action.
- Download progress survives navigation and sidebar collapse.
- Active work is never stopped to install an update.
- Unknown backend readiness prevents installation.
- Task completion changes the footer to `重启安装` but does not install automatically.
- Windows performs a real in-place NSIS update without uninstalling and preserves its data directory.
- macOS ARM and Intel perform real ShipIt ZIP updates and preserve their data directories.
- macOS ZIP-contained apps pass signature, Team ID, Gatekeeper, and notarization validation.
- Normal application quit never installs a downloaded update.
- The sidebar remains usable at 168 px and 56 px and does not remount active content.
- Network, metadata, checksum, signature, and lifecycle failures all leave the user on a usable installed version or an explicit manual recovery path.

## Expected File Boundaries

Implementation is expected to stay within focused units such as:

- `app/package.json` and `app/package-lock.json` for `electron-updater`
- `app/build.yml` for publish metadata and macOS ZIP targets
- `.github/workflows/build-desktop.yml` for artifact gates and release publication
- macOS signing/notarization scripts under `app/scripts/`
- `app/src/updateService.js` for updater state
- A focused install coordinator under `app/src/`
- `app/src/lifecycleController.js` for updater-driven shutdown integration
- `app/src/main.js` and `app/src/preload.js` for composition and bounded IPC
- A focused sidebar update-footer component or utility under `app/src/renderer/`
- `app/src/renderer/App.vue` for shell layout and collapse integration
- `core/api_server.py` plus a focused runtime-readiness service if needed
- Targeted Node, renderer, Python, workflow, signing, and packaged-update tests

Implementation should not reintroduce the old updater as one large main-process/UI patch. State, install readiness, lifecycle shutdown, and sidebar presentation remain independently testable units.
