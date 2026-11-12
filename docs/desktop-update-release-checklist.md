# Desktop Update Release Checklist

This checklist is the required evidence record before claiming desktop updater release readiness. Keep blank values as `PENDING`; do not fill them from assumptions or DMG-only manual installs.

## Release Identity · v2.5.15

- Release scope: `PATCH`
- Version selection rationale: 修复巴拉上新助手的吊牌洗唛匹配和桌面端 OCR 字库加载，改善现有批量任务的压缩进度、日志与导出体验。
- Target version: `v2.5.15`
- Update path under test: `v2.5.14` → `v2.5.15`
- Source commit: `24d34d54fc7306e8dc6f44ba6bc008b588831185`
- GitHub main 构建通过。[构建记录](https://github.com/howtimeschange/crawshrimp/actions/runs/43266408948)
- 正式标签的测试、Windows x64 / ARM64 构建和 macOS 签名公证通过。R2 分片上传连续两次返回 `InvalidPart`。[标签构建记录](https://github.com/howtimeschange/crawshrimp/actions/runs/43266408584)
- 恢复任务复用标签构建产物，改用单次 PUT 上传 R2。R2、正式 Release 和 `desktop-latest` 发布任务均通过。[发布恢复记录](https://github.com/howtimeschange/crawshrimp/actions/runs/43277751414)
- 正式 Release 和 `desktop-latest` 各有 12 个同名、同大小的资产，两个标签指向同一源码提交。[正式 Release](https://github.com/howtimeschange/crawshrimp/releases/tag/v2.5.15) · [desktop-latest](https://github.com/howtimeschange/crawshrimp/releases/tag/desktop-latest)
- R2 公开地址的 `latest-release.json` 返回 2.5.15。macOS 和 Windows 更新 YAML 与正式 Release 逐字节一致。四个安装包链接均可访问。[更新源](https://updates.crawshrimp.com/latest-release.json)
- Packaged update acceptance: `PENDING`
- 开发客户端复跑 101 款，补回全部 24 条确认漏匹配，导出 382 份素材。194 张平铺图与上一轮逐文件一致，Excel 与素材清单一致。

## Release Identity · v2.5.14

- Release scope (`PATCH` / `MINOR` / `MAJOR`): `PATCH`
- Version selection rationale: 新增森马与迷你巴拉上新适配器，覆盖素材采集、图包整理、检测报告与 PLM 尺码表导出，并调整巴拉助手名称；均为适配器级变更，未新增独立一级功能或改变产品架构，按 PATCH 升版。
- Target version selected under the [release versioning policy](release-versioning.md): `v2.5.14`
- Source commit: `c2371f4166a4cd671d12e09629ff01a1c8146d85`（v2.5.14 tag 构建源码）
- Old version under test: `v2.5.13`
- New version under test: `v2.5.14`
- GitHub main build run ID: [42560902674](https://github.com/howtimeschange/crawshrimp/actions/runs/42560902674)（success）
- GitHub tag build run ID: [42560902534](https://github.com/howtimeschange/crawshrimp/actions/runs/42560902534)（success，全部构建与发布任务通过）
- Formal release URL: https://github.com/howtimeschange/crawshrimp/releases/tag/v2.5.14（已发布，12 项资产）
- Rolling `desktop-latest` release URL: https://github.com/howtimeschange/crawshrimp/releases/tag/desktop-latest（12 项资产与正式 Release 名称、字节数一致，tag 指向本次源码提交）
- Cloudflare R2 update source (`https://updates.crawshrimp.com/`): `latest-release.json`、`latest.yml`、`latest-mac.yml` 均回读为 2.5.14；两个 YAML 与正式 GitHub Release 逐字节一致。
- Formal build marked with `crawshrimpUpdateTestBuild`: `NO`

## v2.5.14 Pre-release Validation（2026-11-09）

- 云端完整测试：桌面端 529 passed / 2 skipped，适配器 JavaScript 1,381 passed，Python 1,777 passed / 1 skipped / 160 subtests passed。
- 修复 runner 后 [main 42556195599](https://github.com/howtimeschange/crawshrimp/actions/runs/42556195599) 全部构建成功；[tag 42556195580](https://github.com/howtimeschange/crawshrimp/actions/runs/42556195580) 首次 macOS DMG 公证 Accepted 后，票据验证遇到 Apple CloudKit 网络中断（Error 68），仅重跑失败任务；attempt 2 应用公证 Accepted 后也遇到相同网络错误。
- 新增重试入口后同步现有公证命令断言，本地全量重跑桌面端 531 项、适配器 JavaScript 1,381 项通过；最终源码与 main/tag CI 均为 `c2371f4166a4cd671d12e09629ff01a1c8146d85`。
- 应用、DMG 及 ZIP 验证统一对 stapler 的明确网络错误最多重试 5 次，票据/签名错误直接失败，持续网络错误仍阻止发布。新增 4 项模拟断线、恢复及耗尽测试通过，9 项工作流测试通过，Shell 语法与 diff 检查通过。
- 首轮 main/tag CI 完整测试通过，但 macOS runner 分配失败：GitHub 于 2026-11-02 停用 macOS 14；改用官方支持的 `macos-15` ARM64 runner，保持 ARM64 / Intel 双架构打包。正式 Release 尚未发布，修复后重新运行 CI。
- `npm --prefix app test`：531 passed（含 4 项 stapler 网络重试测试）。
- `node --test tests/*.test.js`：1,381 passed。
- `PYTHONPATH=. .venv/bin/python -m pytest tests/test_mini_bala_manifest.py tests/test_mini_bala_packaging.py tests/test_mini_bala_recipes.py tests/test_mini_bala_reference_review.py tests/test_semir_launch_packaging.py tests/test_plm_size_chart_export_dir.py tests/test_adapter_loader.py -q`：43 passed。
- `npm --prefix app run vite:build`：passed，保留现有 chunk 体积提示。
- 应用与 lockfile 版本一致，`git diff --check` 通过。
- README 仅保留 v2.5.14 / v2.5.13 / v2.5.12 三个版本说明，历史 Release Notes 保留。
- macOS 双架构构建、签名、公证、ZIP 与更新资产验证均通过；Windows x64/ARM64 构建、架构与后端检查通过；GitHub/R2 发布成功。下方实际安装与跨版本更新验收未执行的项目继续保持 `PENDING`。

## v2.5.13 Pre-release Validation（2026-10-24）

- `npm --prefix app test`: 527 passed。
- `node --test tests/shenhui-new-arrival-batch-label-tile-download.test.js`: 24 passed。
- `PYTHONPATH=. venv/bin/python -m pytest tests/test_light_supply_label_download.py tests/test_label_tile_manifest.py tests/test_shenhui_shoe_verified_label.py tests/test_shenhui_shoe_label_first.py tests/test_shenhui_apparel_label_processing.py -q`: 117 passed。
- `npm --prefix app run vite:build`: passed；保留现有大体积 chunk 提示。
- 应用与 lockfile 版本一致，README 仅保留 v2.5.13 / v2.5.12 / v2.5.11 三个版本说明，历史 Release Notes 保留。
- 打包、签名、公证、GitHub/R2 发布结果以本次 CI 为准；下方实际安装与更新验收未执行的项目继续保持 `PENDING`。
- 首次 CI 在 macOS Intel 运行时安装中选中缺少 Intel wheel 的 PyMuPDF 2.0 并转为源码构建；将范围限定为 `>=1.24.0,<2.0.0`，PyPI 已核对上一版 CI 使用的 1.28.2 同时提供 Intel / ARM wheel。
- 使用隔离目录安装 PyMuPDF 1.28.2，重新运行上述五个 Python 测试文件及 `tests/test_shenhui_pdf_screenshot.py`：130 passed。

## Download Transport Regression

Before packaged acceptance, run the isolated Electron download regression:

```bash
cd app
npm run test:update-download
npm run test:update-download:live
```

The local run checks the service's single-range provider configuration against an R2-like server, differential reconstruction and full-download SHA512, request timeout/cancellation followed by a successful retry, and HTTP redirects. It uses temporary user data and files and does not install an update. On headless Linux it requires `xvfb-run`.

The live run records small single- and multi-range requests through the system proxy and direct connection. It aborts after the first data chunk; inspect HTTP status and `Content-Range`, including any proxy returning a full `200` response. A completed probe does not prove a full installer download or installation succeeded. These regressions do not replace the signed packaged acceptance below.

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
