# crawshrimp - Development Notes

## Phase 1 Status: COMPLETE

All core Python modules implemented:

```
core/
  models.py          Pydantic models (AdapterManifest, TaskRun, JSResult, ...)
  config.py          Global config (~/.crawshrimp/config.json)
  cdp_bridge.py      Chrome CDP connection manager
  js_runner.py       JS injection executor (timeout + auto-pagination)
  adapter_loader.py  Adapter install/scan/validate (dir + zip)
  scheduler.py       APScheduler (manual/interval/cron)
  data_sink.py       SQLite task state + Excel/JSON export
  notifier.py        DingTalk / Feishu / custom webhook
  api_server.py      FastAPI - all endpoints, full task pipeline

adapters/temu/
  manifest.yaml      Complete Temu adapter spec
  auth_check.js      Login state detection
  goods-data.js      Product data scraper (migrated + IIFE wrapped)
  reviews.js         Reviews scraper (migrated + IIFE wrapped)
  aftersales.js      After-sales scraper (migrated + IIFE wrapped)
  store-items.js     Store item listing (migrated + IIFE wrapped)
```

## Quick Dev Start

```bash
cd core
pip install -r requirements.txt
python api_server.py
# API running at http://localhost:18765
# Docs at http://localhost:18765/docs
```

## Adapter Dev Caveat

适配包开发时，底座运行的不是仓库里的源码目录，而是“已安装副本”：

- 默认路径：`~/.crawshrimp/adapters/<adapter_id>/`
- 如果设置了 `CRAWSHRIMP_DATA`：`$CRAWSHRIMP_DATA/adapters/<adapter_id>/`

`POST /adapters/install` 会把你的适配包目录复制到上面的执行目录。  
因此修改 `adapters/<id>/` 下的脚本后，必须重新安装；否则任务仍会执行旧代码。

建议固定使用下面的开发闭环：

```bash
# 改完源码后重新安装
curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path": "/absolute/path/to/repo/adapters/<adapter_id>"}'

# 验证源码目录和执行副本一致
diff -qr /absolute/path/to/repo/adapters/<adapter_id> ~/.crawshrimp/adapters/<adapter_id>
```

## Phase 2: Electron + Vue GUI

Next up:

1. `app/` scaffold - Electron main process (reuse temu-assistant shell)
2. Replace renderer with Vue 3 + Vite
3. 4 views: PlatformManager / TaskDashboard / DataExplorer / Settings
4. Full IPC bridge

Key reuse from temu-assistant:
- `electron-app/src/main.js` - Python process spawn, window management, portfinder
- `electron-app/scripts/after-pack.js` - python-build-standalone bundle hook
- `electron-app/build.yml` - electron-builder config (macOS DMG + Windows NSIS)

## Bundling Strategy (Open-box install)

Inherited from temu-assistant - users get a single installer, zero setup:

```
macOS:
  crawshrimp.dmg -> CrawShrimp.app
    Resources/
      python/bundle/    python-build-standalone 3.12 (arm64 or x64)
      python-scripts/   core/*.py + adapters/
      bb-browser/       CDP connector node module

Windows:
  crawshrimp-setup.exe -> NSIS installer
    (same structure under AppData)
```

CI triggers on `git tag vX.X.X` (same as temu-assistant).

## API Reference

See http://localhost:18765/docs when running locally.

Key endpoints:
```
GET  /health                              # chrome available + adapter count
GET  /adapters                            # list installed adapters
POST /adapters/install                    # {path} or {zip_base64}
DELETE /adapters/{id}                     # uninstall
PATCH /adapters/{id}/enable               # {enabled: bool}
GET  /tasks                               # all tasks with live status
POST /tasks/{adapter}/{task}/run          # trigger now (background)
GET  /tasks/{adapter}/{task}/status       # live + last run
GET  /tasks/{adapter}/{task}/logs         # live log lines
GET  /data/{adapter}/{task}/export        # ?format=excel|json
GET  /settings                            # read config
PUT  /settings                            # write config
GET  /settings/chrome-tabs               # list open Chrome tabs
```
