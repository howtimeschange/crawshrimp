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

## Adapter Dev Loop

适配包开发现在推荐固定走这条闭环：

1. 目录 `link` 安装一次，让运行时直接指向源码目录
2. 用 `scripts/crawshrimp_dev_harness.py snapshot / knowledge / capture / eval / probe` 摸页面
3. 写 adapter 逻辑、phase/shared、回归测试
4. 只有在发包或验证用户态安装时，才切回默认 `copy` / ZIP

本地开发建议先执行：

```bash
curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path": "/absolute/path/to/repo/adapters/<adapter_id>", "install_mode": "link"}'

./venv/bin/python scripts/crawshrimp_dev_harness.py snapshot \
  --adapter <adapter_id> \
  --task <task_id>
```

`dev harness` 是新的标准开发入口：

- `snapshot`：看当前页面结构和知识命中
- `knowledge`：查 notes / probe 自动物化出的经验卡片
- `capture`：抓被动请求、点击请求或指定 URL 请求
- `eval`：在当前页直接跑临时 JS
- `probe`：只在需要结构化 bundle 时再用

知识索引默认写到：

- `~/.crawshrimp/knowledge/cards.json`
- `~/.crawshrimp/knowledge/skills/<adapter>/<task>.md`

如果你改的是 `adapters/<id>/notes/*.md` 或手工补了 probe 产物，可以运行：

```bash
./venv/bin/python scripts/crawshrimp_dev_harness.py rebuild-knowledge
```

### Runtime Truth

底座运行的不是仓库路径本身，而是“已安装运行时”：

- `link` 模式：`~/.crawshrimp/adapters/<adapter_id>` 是指向源码目录的符号链接
- `copy` 模式：底座会复制一份执行副本到 `~/.crawshrimp/adapters/<adapter_id>/`
- 如果设置了 `CRAWSHRIMP_DATA`：路径会变成 `$CRAWSHRIMP_DATA/adapters/<adapter_id>/`

这意味着：

- 本地开发优先使用 `link`
- 如果你刻意使用 `copy`，改完脚本后必须重新安装
- 出现“明明改了代码但运行结果还是旧的”时，先检查安装模式和运行时目录，不要先怀疑业务逻辑

`copy` 模式下的验证方式：

```bash
curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path": "/absolute/path/to/repo/adapters/<adapter_id>"}'

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
