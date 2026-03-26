# crawshrimp SPEC v1

> Status: Draft | Date: 2026-03-26

---

## 1. Project Overview

crawshrimp is a universal web automation desktop app.

- Users install adapter packages; the core handles Chrome, scheduling, export, notifications
- Developers write adapters (JS scripts + manifest.yaml) to support new platforms
- Core: CDP connection, JS injection, task scheduling, data export, notifications
- Adapter: only "what to scrape / do on this page"

---

## 2. Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| GUI | Electron 29 + Vue 3 + Vite | Reuse temu-assistant Electron shell, replace renderer with Vue |
| Core | Python 3.12 + FastAPI | Reuse python-build-standalone bundle |
| Browser | CDP (bb-browser / websockets) | JS injection via Runtime.evaluate, no Playwright |
| Scheduler | APScheduler | manual / interval / cron triggers |
| Storage | SQLite (task state) + filesystem (data/logs) | Lightweight, no external deps |
| IPC | Electron <-> Python HTTP (FastAPI localhost:18765) | Electron spawns Python subprocess |
| Adapter install | Local directory path + zip file | v1 only, no cloud marketplace |

---

## 3. Directory Structure

```
crawshrimp/
  core/
    api_server.py        FastAPI entry, all endpoints
    cdp_bridge.py        CDP connection manager
    js_runner.py         JS injection executor (timeout/retry/pagination)
    adapter_loader.py    Adapter scan/load/validate/install
    scheduler.py         APScheduler task engine
    data_sink.py         Data persistence (Excel/JSON/SQLite)
    notifier.py          Notification push (DingTalk/Feishu/webhook)
    config.py            Global config read/write
    models.py            Pydantic data models
    requirements.txt
  app/
    src/
      main.js            Electron main process (spawn Python, window mgmt)
      preload.js         IPC bridge
      renderer/          Vue 3 app
        main.js
        App.vue
        views/
          PlatformManager.vue   adapter list/install/enable
          TaskDashboard.vue     task status + live logs
          DataExplorer.vue      data preview + export
          Settings.vue          Chrome path / notifications
    scripts/after-pack.js
    build.yml
    package.json
    vite.config.js
  adapters/
    temu/
      manifest.yaml
      auth_check.js
      goods-data.js
      reviews.js
      aftersales.js
      store-items.js
  sdk/
    ADAPTER_GUIDE.md
    manifest.schema.json
    template/
      manifest.yaml
      example-task.js
  .github/workflows/build.yml
```

---

## 4. Adapter Manifest Spec v1

```yaml
id: temu
name: Temu Seller Assistant
version: 1.0.0
author: howtimeschange
description: "Temu seller platform data collection"
entry_url: https://seller.temu.com

auth:
  check_script: auth_check.js     # returns {meta: {logged_in: bool}}
  login_url: https://seller.temu.com/login

tasks:
  - id: goods_data
    name: Product Data
    script: goods-data.js         # relative to manifest.yaml
    trigger:
      type: manual                # manual | interval | cron
      interval_minutes: 30
      cron: "0 9 * * *"
    output:
      - type: excel               # excel | json | sqlite | notify
        filename: "goods_{date}.xlsx"
      - type: notify
        channel: dingtalk         # dingtalk | feishu | webhook
        condition: "data.length > 0"
```

---

## 5. JS Script Protocol

```js
;(async () => {
  try {
    const data = []
    // scraping logic here
    return {
      success: true,
      data,             // required: array of plain objects
      meta: { has_more: false }  // optional pagination signal
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
})()
```

Core behavior: 60s timeout, auto-pagination on meta.has_more, errors logged (no crash).

Pagination: core injects `window.__CRAWSHRIMP_PAGE__` (1-indexed) before each call.

---

## 6. FastAPI Endpoints

```
GET  /health
GET  /adapters
POST /adapters/install          body: {path} or {zip_base64}
DEL  /adapters/{id}
PATCH /adapters/{id}/enable     body: {enabled: bool}
GET  /tasks
POST /tasks/{adapter_id}/{task_id}/run
GET  /tasks/{adapter_id}/{task_id}/status
GET  /tasks/{adapter_id}/{task_id}/logs
GET  /data/{adapter_id}/{task_id}
GET  /data/{adapter_id}/{task_id}/export?format=excel
GET  /settings
PUT  /settings
GET  /settings/chrome-tabs
```

---

## 7. GUI Views

**PlatformManager**: adapter list (name/version/status/task count), install from dir or zip, enable/disable/uninstall

**TaskDashboard**: all tasks across adapters, last run time, next run time, success/fail status, live log stream, manual trigger button

**DataExplorer**: filter by adapter/task/date, virtual-scroll table preview, export Excel/JSON

**Settings**: Chrome path, CDP port (default 9222), DingTalk/Feishu webhook URLs, data directory, auto-start

---

## 8. Code Reuse from temu-assistant

| Module | Source | Action |
|--------|--------|--------|
| CDP/JS injection | src/temu_utils.py | Extracted into cdp_bridge.py + js_runner.py |
| DingTalk notify | src/dingtalk.py | Generalized as notifier.py |
| Excel export | src/excel_writer.py | Interface generalized |
| Electron main | electron-app/src/main.js | Reuse Python Bundle + afterPack, replace renderer |
| Python Bundle CI | scripts/after-pack.js + build.yml | Direct reuse (python-build-standalone) |
| Temu JS scripts | adapters/temu/*.js | Reorganized per manifest spec |
| Scheduler | loop_worker.py | Rewritten as APScheduler multi-task |

---

## 9. Roadmap

**Phase 1 - Core skeleton (3 days)**
- core/ directory + FastAPI endpoint scaffolding
- cdp_bridge, js_runner, adapter_loader
- scheduler, data_sink, notifier

**Phase 2 - Electron + Vue GUI (4 days)**
- Electron main process (reuse temu-assistant shell, replace renderer with Vue 3 + Vite)
- 4 views: PlatformManager / TaskDashboard / DataExplorer / Settings
- Full Electron <-> FastAPI IPC

**Phase 3 - Temu adapter migration (2 days)**
- adapters/temu/manifest.yaml complete
- Migrate 4 JS scripts, end-to-end test

**Phase 4 - SDK & docs (1 day)**
- manifest.schema.json, template, ADAPTER_GUIDE.md

**Phase 5 - Build & CI (1 day)**
- Reuse temu-assistant build.yml + after-pack.js
- tag push -> macOS DMG + Windows NSIS

---

## 10. Future (out of scope for v1)

- Cloud adapter marketplace
- Multi-Chrome instance concurrency
- Adapter version management / auto-update
- Anti-bot library (adapters self-manage)
