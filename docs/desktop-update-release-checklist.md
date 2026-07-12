# Desktop Update Release Checklist

This checklist is the required evidence record before claiming desktop updater release readiness. Keep blank values as `PENDING`; do not fill them from assumptions or DMG-only manual installs.

## Release Identity

- Release scope (`PATCH` / `MINOR` / `MAJOR`): `PENDING`
- Version selection rationale: `PENDING`
- Target version selected under the [release versioning policy](release-versioning.md): `PENDING`
- Source commit: `PENDING`
- Old version under test: `PENDING`
- New version under test: `PENDING`
- GitHub main build run ID: `PENDING`
- GitHub tag build run ID: `PENDING`
- Formal release URL: `PENDING`
- Rolling `desktop-latest` release URL: `PENDING`
- Cloudflare R2 update source (`https://updates.crawshrimp.com/`): `PENDING`
- Formal build marked with `crawshrimpUpdateTestBuild`: `NO`

## Test Build Feed

The signed packaged E2E flow uses two non-formal test builds only. Build the old and new versions with the marker; do not reuse these artifacts for a formal release.

```bash
cd app
npm run build:win -- --publish never -c.extraMetadata.crawshrimpUpdateTestBuild=true
npm run build:mac -- --publish never -c.extraMetadata.crawshrimpUpdateTestBuild=true
cd ..
```

Start the local feed from the directory containing the generated `latest.yml` or `latest-mac.yml` and referenced assets:

```bash
node app/scripts/validate-update-artifacts.js /path/to/update-artifacts
node app/scripts/update-e2e-server.js --root /path/to/update-artifacts --port 40123
curl -fsS http://127.0.0.1:40123/health
CRAWSHRIMP_UPDATE_E2E_URL=http://127.0.0.1:40123/ /Applications/抓虾.app/Contents/MacOS/抓虾
```

Windows E2E launch:

```powershell
$env:CRAWSHRIMP_UPDATE_E2E_URL = "http://127.0.0.1:40123/"
& "$env:LOCALAPPDATA\Programs\crawshrimp\抓虾.exe"
```

Rules:

- The E2E URL must be plain HTTP on `127.0.0.1` or `localhost`.
- Public hosts, HTTPS, credentials, non-HTTP schemes, invalid URLs, and production metadata are rejected.
- Formal `vX.Y.Z` builds must never include `-c.extraMetadata.crawshrimpUpdateTestBuild=true`.

## Asset Evidence

Record the exact asset names and SHA512 readback from update metadata.

```bash
grep -E 'url:|sha512:' /path/to/update-artifacts/latest*.yml
shasum -a 512 /path/to/update-artifacts/<asset>
```

| Platform | Metadata | Asset name | SHA512 from metadata | SHA512 recomputed | Status |
|---|---|---|---|---|---|
| Windows x64 | `latest.yml` | `PENDING` | `PENDING` | `PENDING` | `PENDING` |
| macOS ARM | `latest-mac.yml` | `PENDING` | `PENDING` | `PENDING` | `PENDING` |
| macOS Intel | `latest-mac.yml` | `PENDING` | `PENDING` | `PENDING` | `PENDING` |

Cloudflare readback (must match the formal-release metadata byte-for-byte before GitHub publication):

```bash
curl -fsS https://updates.crawshrimp.com/latest-mac.yml -o /tmp/latest-mac.yml
curl -fsS https://updates.crawshrimp.com/latest.yml -o /tmp/latest.yml
```

## Signing And Notarization Evidence

macOS ARM:

- `codesign --verify --deep --strict --verbose=2 /Applications/抓虾.app`: `PENDING`
- Team ID readback: `PENDING`
- `spctl --assess --type execute --verbose=4 /Applications/抓虾.app`: `PENDING`
- `stapler validate /Applications/抓虾.app`: `PENDING`

macOS Intel:

- `codesign --verify --deep --strict --verbose=2 /Applications/抓虾.app`: `PENDING`
- Team ID readback: `PENDING`
- `spctl --assess --type execute --verbose=4 /Applications/抓虾.app`: `PENDING`
- `stapler validate /Applications/抓虾.app`: `PENDING`

Windows x64:

- Installer path before update: `PENDING`
- Installer path after update: `PENDING`
- Unknown Publisher warning observed or Windows signing proof: `PENDING`

Suggested readback commands:

```bash
codesign -dv --verbose=4 /Applications/抓虾.app 2>&1 | grep -E 'Authority|TeamIdentifier'
spctl --assess --type execute --verbose=4 /Applications/抓虾.app
stapler validate /Applications/抓虾.app
curl -fsS http://127.0.0.1:18765/health
```

```powershell
Get-Item "$env:LOCALAPPDATA\Programs\crawshrimp\抓虾.exe" | Select-Object FullName,Length,LastWriteTime
Get-FileHash "$env:LOCALAPPDATA\crawshrimp\update-sentinel.txt" -Algorithm SHA256
Invoke-RestMethod http://127.0.0.1:18765/health
```

## In-Place Update Gates

For each platform below, seed a sentinel under the actual data directory, start a real task, download the update, prove the task blocks install, let the task finish, click `重启安装`, and verify the new version/backend/data after restart.

| Gate | Windows x64 | macOS ARM | macOS Intel |
|---|---|---|---|
| Previous signed version installed | `PENDING` | `PENDING` | `PENDING` |
| Local E2E feed URL used | `PENDING` | `PENDING` | `PENDING` |
| User-data sentinel path | `PENDING` | `PENDING` | `PENDING` |
| User-data checksum before | `PENDING` | `PENDING` | `PENDING` |
| Active-task blocker screenshot/log | `PENDING` | `PENDING` | `PENDING` |
| “普通退出未安装” proof | `PENDING` | `PENDING` | `PENDING` |
| “任务结束后仅提示重启安装” proof | `PENDING` | `PENDING` | `PENDING` |
| Clicked `重启安装` | `PENDING` | `PENDING` | `PENDING` |
| New version after restart | `PENDING` | `PENDING` | `PENDING` |
| Backend `/health` after restart | `PENDING` | `PENDING` | `PENDING` |
| User-data checksum after | `PENDING` | `PENDING` | `PENDING` |

Bridge gates:

- Windows bridge overlay over updater-disabled release, no uninstall: `PENDING`
- macOS bridge overlay from DMG over updater-disabled release, no uninstall: `PENDING`
- Sentinel survived bridge overlay: `PENDING`
- Manual bridge started on new version and backend healthy: `PENDING`

Windows runtime recovery gates:

- Deny writes to `%USERPROFILE%\.crawshrimp`, launch the installed app, and verify the backend adopts `%LOCALAPPDATA%\crawshrimp`: `PENDING`
- Confirm `desktop-config.json`, Settings, and `/health?probe=1` report the same adopted data directory: `PENDING`
- Force the owned Python backend to exit, click `修复核心服务`, and verify one replacement process plus a refreshed script list: `PENDING`
- Serve HTTP 404 on `127.0.0.1:9222`, click `修复 Chrome 连接`, and verify no extra Chrome process is spawned and the UI reports port occupation: `PENDING`
- Leave a verified managed Chrome process alive with CDP unavailable, click repair, and verify only that managed process is replaced: `PENDING`
- Double-launch the installed app and verify the existing window is focused with one Electron/backend process tree: `PENDING`
- Start manual bridge installation while the old app is open, verify the safety prompt, exit normally, click Retry, and complete the overlay: `PENDING`
- Repeat launch and bridge coverage with a Chinese Windows username and enterprise endpoint protection enabled: `PENDING`

Acceptance notes:

- Windows NSIS acceptance must prove in-place update of the existing install path.
- macOS acceptance must prove ZIP/ShipIt in-app update. DMG-only success is bridge/fallback evidence, not normal updater acceptance.
- macOS ARM and macOS Intel are separate gates.

## Rollback Or Unpublish

Use only after deciding the release must be withdrawn:

```bash
gh release edit vX.Y.Z --draft=true
gh release delete desktop-latest --cleanup-tag --yes
git push origin :refs/tags/desktop-latest
git tag -d desktop-latest || true
git fetch origin --tags
```

Rollback evidence:

- Command operator: `PENDING`
- Command timestamp: `PENDING`
- Reason: `PENDING`
- Release readback after rollback: `PENDING`
