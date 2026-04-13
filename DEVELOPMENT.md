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

## Task Progress UI Contract

前端进度条的配置已经收口到一个地方：

- 规则入口：`app/src/renderer/utils/taskProgress.js`
- 任务白名单：`TASK_PROGRESS_RULES`
- 规则解析：`resolveTaskProgressConfig(...)`
- 任务详情页摘要：`buildTaskRunnerProgressSummary(...)`
- 侧边栏 / 脚本列表摘要：`buildTaskOverviewProgress(...)`

当前约束：

- 默认所有任务都走 `classic` 进度，不影响历史脚本
- `enhanced` 只对白名单任务生效
- 当前白名单包含 `temu / goods_traffic_list`、`temu / goods_traffic_detail`

`enhanced` 适用场景：

- 任务是大批量、多行、长耗时执行，用户需要更强的过程可见性
- 除了总进度，还存在“当前条目内部”的二级进度，例如弹窗翻页、站点切换、维度组合遍历
- 在部分阶段拿不到稳定 `total / percent`，但 `records` 和上下文字段仍能持续推进
- 脚本能稳定补充 `batch_no / total_batches / current_store / current_buyer_id / phase` 这类上下文

不建议这样做：

- 在视图组件里手写 `adapter_id === ... && task_id === ...`
- 为了显示百分比伪造 `total_rows`
- 把增强样式直接改成全局默认

扩展到新任务时，建议按这个顺序走：

1. 先确认脚本 live 字段来源稳定：`records` 单调增长，`shared` 元数据不会乱跳。
2. 先只接标准进度字段：`total_rows / current_exec_no / current_row_no / current_buyer_id / current_store / batch_no / total_batches`。
3. 确认 `classic` UI 已可用后，再判断是否真的需要 `enhanced`。
4. 需要 `enhanced` 时，只在 `TASK_PROGRESS_RULES` 里新增一条精确到 `adapterId + taskId` 的规则。
5. 如果需要新的展示字段，优先改 `taskProgress.js` 的汇总函数，不要在 `App.vue` / `ScriptList.vue` / `TaskRunner.vue` 各写一套。
6. 跑一次前端构建验证：`npm --prefix app run vite:build`

后端 live 字段来源：

- `core/api_server.py` 会从 `shared.total_rows / current_exec_no / current_row_no / batch_no / total_batches / current_buyer_id / current_store` 组装 `live`
- `live.completed` / `live.records` 来自执行器当前累计产出条数
- `live.progress_text` 是后端根据 `current/total` 自动生成的，不需要脚本手填
- 前端页面只消费底座下发的 `live`，不会直接从 adapter 脚本读 UI 配置

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
