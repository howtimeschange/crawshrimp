# 抓虾任务中心与巴拉-AI测图任务实例设计

## 背景

抓虾当前的主要模型是“脚本定义 + 单次运行”。`task_runs` 已经能记录一次脚本运行的状态、输出文件和错误，但它缺少业务任务层：用户不能新建一个可命名、可回看、可复制、可归档的任务实例，也不能把配置、进度、审批批次、输出产物和多次运行记录绑定到同一个业务任务。

本设计以 `巴拉-AI测图全链路` 作为第一个接入脚本，引入通用任务实例模型，并把原来的 `抓虾市场` 一级 tab 替换为新的 `任务中心`。

## 目标

1. 替换 `抓虾市场` 为 `任务中心`，支持查看当前任务、待处理任务和历史任务。
2. 新增通用任务实例模型，保留现有 `task_runs` 作为底层运行记录。
3. 首批接入 `tmall-ops-assistant / tmall_ai_image_test_chain`。
4. 支持从任务中心新建 `AI 测图任务`，打开独立实例化的配置和进度界面。
5. 修复当前任务页布局：主操作区可滚动，日志和输出文件可折叠、可最小化。
6. 新增任务中心内的定时任务能力，首个适配 `巴拉-AI测图数据抓取导出`，支持提前配置导出目录和钉钉通知模板后无人值守执行。

## 非目标

1. 不一次性改造所有脚本为任务实例模式。
2. 不引入远程账号、多人协作、权限或云同步。
3. 不删除现有“我的脚本”入口；老脚本仍可按现有方式运行。
4. 不改变安装版 app，本阶段只在开发环境源码中实现。

## 总体方案

采用“两层模型”：

- 脚本定义：来自 adapter manifest，例如 `巴拉-AI测图全链路`。
- 任务实例：用户创建的业务任务，例如“2026Q1 鞋品测图 208326100202”。
- 运行记录：一次实例可能执行多次，底层仍写入现有 `task_runs`。
- 任务产物：Excel、原图目录、AI 图目录、审批批次、天猫任务 ID、日志引用。

`任务中心` 是任务实例的入口。`我的脚本` 仍然保留，适合一次性工具和未接入实例模型的脚本。

## SQLite 数据模型

现有表继续保留：

```sql
task_runs (
  id,
  adapter_id,
  task_id,
  status,
  started_at,
  finished_at,
  records_count,
  error,
  output_files
)
```

新增表：

```sql
task_instances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_uid TEXT NOT NULL UNIQUE,
  adapter_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  current_step TEXT NOT NULL DEFAULT 'config',
  params_json TEXT NOT NULL DEFAULT '{}',
  summary_json TEXT NOT NULL DEFAULT '{}',
  approval_batch_id TEXT,
  approval_token TEXT,
  export_dir TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_id INTEGER,
  FOREIGN KEY(last_run_id) REFERENCES task_runs(id)
)
```

```sql
task_instance_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_uid TEXT NOT NULL,
  run_id INTEGER NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'main',
  created_at TEXT NOT NULL,
  UNIQUE(instance_uid, run_id),
  FOREIGN KEY(run_id) REFERENCES task_runs(id)
)
```

```sql
task_instance_artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_uid TEXT NOT NULL,
  kind TEXT NOT NULL,
  label TEXT,
  path TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
)
```

```sql
task_instance_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instance_uid TEXT NOT NULL,
  event_type TEXT NOT NULL,
  message TEXT NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
)
```

新增定时任务定义表：

```sql
task_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  schedule_uid TEXT NOT NULL UNIQUE,
  adapter_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  title TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  frequency TEXT NOT NULL,
  time_of_day TEXT NOT NULL,
  weekday INTEGER,
  params_json TEXT NOT NULL DEFAULT '{}',
  notify_channel TEXT NOT NULL DEFAULT 'dingtalk',
  notify_template TEXT NOT NULL DEFAULT '',
  last_run_id INTEGER,
  last_instance_uid TEXT,
  last_status TEXT,
  last_error TEXT,
  last_triggered_at TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

定时任务只保存“计划定义”和“默认运行参数”。每次触发都会创建一个新的 `task_instances` 作为实际执行实例，并继续关联到底层 `task_runs`，因此历史回看、输出文件、失败原因不会覆盖定时计划本身。

## 状态模型

任务实例状态使用以下集合：

- `draft`：已新建，尚未执行。
- `running`：正在执行找图、生图或后台编排。
- `waiting_approval`：生图完成，等待人工审批。
- `creating`：已确认图片，正在上传或创建天猫测图任务。
- `completed`：创建完成且无阻断错误。
- `partial_failed`：部分创建成功，部分失败，需要复核。
- `failed`：执行失败，可查看错误并重试。
- `stopped`：用户停止或后端重启后自动停止。
- `archived`：用户归档。

任务中心的三个视图是状态筛选。`waiting_approval` 同时属于当前任务和待处理任务：它代表任务仍在生命周期中，也代表需要用户动作。

- 当前任务：`running`、`waiting_approval`、`creating`。
- 待处理：`waiting_approval`、`partial_failed`、`failed`。
- 历史任务：`completed`、`stopped`、`archived`。

## 后端 API

新增实例 API：

- `GET /task-instances`：列表，支持 `status_group`、`adapter_id`、`task_id`、`keyword`、`from`、`to`。
- `POST /task-instances`：创建实例，参数包含 `adapter_id`、`task_id`、`title`、`params`。
- `GET /task-instances/{instance_uid}`：实例详情，包含参数、最新进度、产物、关联 runs。
- `PATCH /task-instances/{instance_uid}`：保存标题、参数、当前步骤或归档状态。
- `POST /task-instances/{instance_uid}/run`：以实例参数启动脚本。
- `POST /task-instances/{instance_uid}/duplicate`：复制一个新实例。
- `GET /task-instances/{instance_uid}/logs`：返回该实例关联 runs 的日志。
- `GET /task-instances/{instance_uid}/artifacts`：返回该实例产物摘要和明细。

现有 `POST /tasks/{adapter_id}/{task_id}/run` 继续保留。实例运行 API 内部复用现有执行管线，但在运行参数中注入 `__task_instance_uid`，并在 run 创建后写入 `task_instance_runs`。

新增定时任务 API：

- `GET /task-schedules`：列表，支持 `adapter_id`、`task_id`、`enabled`、`keyword`。
- `POST /task-schedules`：创建定时任务，参数包含脚本、频次、时分、每周周几、默认运行参数、通知模板。
- `GET /task-schedules/{schedule_uid}`：定时任务详情。
- `PATCH /task-schedules/{schedule_uid}`：修改启停、频次、默认参数、通知模板。
- `DELETE /task-schedules/{schedule_uid}`：归档定时任务，并取消 APScheduler job。
- `POST /task-schedules/{schedule_uid}/run-now`：立刻按定时任务的保存参数触发一次后台执行。

后端启动时会读取所有启用且未归档的 `task_schedules`，注册到 APScheduler。启用/修改/归档定时任务时同步刷新对应 job。

## 巴拉-AI测图接入

`巴拉-AI测图全链路` 是首个实例化脚本：

1. 用户在任务中心点击 `新增 AI 测图任务`。
2. 后端创建 `task_instances`，状态为 `draft`。
3. 前端打开实例详情页，第一步显示全新的配置界面。
4. 点击执行后，实例状态变为 `running`，并绑定底层 `task_runs.id`。
5. 生图完成后，脚本输出审批批次；后端保存 `approval_batch_id`、`approval_token`，实例状态变为 `waiting_approval`。
6. 用户在第二步审批图片，审批数据继续写入现有审批批次 JSON，同时同步实例事件。
7. 用户提交确认图片后，状态变为 `creating`。
8. 创建完成后，根据真实上传/创建结果写为 `completed` 或 `partial_failed`。
9. 所有 Excel、原图、AI 图、本地导出目录和审批批次都写入 `task_instance_artifacts`。

审批批次仍可沿用现有 `/tmall-ai-image-approval/api/{batch_id}` 能力，但前端入口不再展示为外链，而是实例详情第二步中的内嵌看板。

## 定时任务接入

`巴拉-AI测图数据抓取导出` 是首个定时任务脚本：

1. 用户在任务中心点击 `新增数据抓取定时任务`。
2. 前端显示定时配置表单：任务名称、频次、时分、每周周几、本地导出目录、通知渠道、钉钉消息模板。
3. 频次支持：
   - `每天`：必须配置 `HH:mm`。
   - `每周`：必须配置周一到周日和 `HH:mm`。
4. 创建后后端保存到 `task_schedules`，并注册 APScheduler job。
5. 到点触发时，后端用保存的参数创建一个新的 `task_instances`，标题包含定时任务名称和触发时间。
6. 新实例执行 `tmall-ops-assistant / tmall_material_test_data_export`，默认采用全新页面模式、测试中任务、近 30 天累计口径、页大小 20。
7. 本地导出目录默认固化为用户下载目录下的 `抓虾导出/天猫运营助手/巴拉-AI测图数据抓取导出`；Windows 使用当前用户 home 下的 `Downloads` 路径，用户也可以显式改写。
8. 执行完成或失败后按保存的钉钉模板发送通知；通知失败只写事件和日志，不反向标记脚本运行失败。

通知模板支持以下变量：

- `{{schedule_title}}`
- `{{task_name}}`
- `{{status}}`
- `{{records}}`
- `{{run_id}}`
- `{{instance_uid}}`
- `{{output_files}}`
- `{{export_dir}}`
- `{{started_at}}`
- `{{finished_at}}`
- `{{error}}`

## 前端界面

### 一级导航

把 `抓虾市场` 替换为 `任务中心`。

`App.vue` 中保留 `currentView` 机制：

- `scripts`：我的脚本。
- `task_center`：任务中心，替代当前 `market`。
- `files`：数据文件。
- `settings`：设置。

### 任务中心

新增 `TaskCenter.vue`，包含：

- 顶部标题与 `新增 AI 测图任务` 按钮。
- 状态 tab：当前任务、待处理、历史任务。
- 筛选栏：脚本、状态、创建时间、关键词。
- 任务列表：标题、脚本名、状态、当前步骤、进度摘要、最近更新时间、主要操作。
- 空状态：提示先新建 AI 测图任务。
- 定时任务看板：展示启用状态、频次、下次运行、最近运行结果、导出目录、运行一次、编辑、归档。
- `新增数据抓取定时任务` 表单：内嵌在任务中心，不跳转到独立网页。

### 实例详情页

新增 `TaskInstanceRunner.vue`。初期从 `TaskRunner.vue` 复用参数渲染和进度展示逻辑，避免把实例模式继续塞进旧的单次脚本运行器。

页面结构：

1. 顶部：实例标题、状态、重新执行、复制任务、归档。
2. 步骤 tab：任务配置、生图进度 / 审批看板、创建结果。
3. 主操作区：只显示当前步骤内容，独立滚动，保留合理最小高度。
4. 底部抽屉：日志 / 输出文件。

底部抽屉状态：

- `minimized`：只显示一行摘要。
- `half`：约占页面下方 30% 高度。
- `expanded`：约占页面下方 55% 高度。

输出文件默认显示摘要：

- 表格数量。
- 图片数量。
- 目录数量。
- 最新导出目录。

点击 `输出文件` 后再显示文件明细和打开操作。

## 布局修复

现有 `巴拉-AI测图全链路` 页面先做低风险布局整理：

- `.runner-body` 改为纵向布局：步骤主区域占剩余空间，底部抽屉固定在底部。
- 当前步骤主区域 `overflow-y: auto`，避免配置项被压住。
- 日志与输出文件拆成一个底部 drawer，支持三态高度。
- 运行日志和输出文件不再同时大面积铺开。
- 输出文件列表默认折叠，只显示摘要和展开按钮。

这一步可先在现有 `TaskRunner.vue` 上完成，即使任务实例模型尚未落地，也能立即改善当前截图中的问题。

## 错误处理

- 任务实例 API 写 SQLite 失败时，前端提示“无法保存任务实例”，不触发脚本执行。
- 脚本执行成功但产物写入实例失败时，保留 `task_runs` 原始记录，并记录 `task_instance_events` 错误。
- 后端重启后，原有 active run 仍按当前逻辑标记 stopped；关联实例同步为 `stopped` 并保留错误原因。
- 审批批次找不到时，实例第二步显示可恢复错误，保留日志和文件入口。

## 测试计划

后端测试：

- 初始化 SQLite 时创建新表。
- 创建、列表、详情、更新、复制、归档任务实例。
- 实例运行时正确关联 `task_runs.id`。
- 后端重启停止 active run 时同步实例状态。
- 巴拉 AI 测图审批批次写回实例字段。
- 初始化 SQLite 时创建 `task_schedules`。
- 创建、修改、归档、查询定时任务。
- APScheduler 能按每天/每周配置注册 job。
- `run-now` 会创建任务实例，并把 `__task_schedule_uid` 和 `__task_instance_uid` 注入运行参数。
- 定时任务完成/失败后会更新最近运行状态，并按模板触发通知。

前端测试：

- 一级导航显示 `任务中心`，不再显示 `抓虾市场`。
- 任务中心三类列表和筛选能渲染。
- 新增 AI 测图任务后进入实例详情。
- 实例详情步骤 tab 只显示当前步骤。
- 底部日志 / 输出文件抽屉三态切换。
- 输出文件摘要按表格、图片、目录计数。
- 任务中心显示定时任务看板和 `新增数据抓取定时任务`。
- 定时任务表单能切换每天/每周，并显示对应的时分/周几字段。

端到端或浏览器检查：

- 5173 开发页可打开任务中心。
- 新增实例后显示空配置界面。
- 运行后实例状态从 `draft` 进入 `running`，再进入 `waiting_approval` 或最终状态。

## 实施阶段

### 阶段 1：布局修复

只改前端 `TaskRunner.vue` 和相关审批组件样式，完成主操作区滚动、日志/输出文件底部抽屉、三态收起展开。

### 阶段 2：后端任务实例模型

扩展 `core/data_sink.py`，新增实例表和 CRUD 方法；扩展 `core/api_server.py`，新增实例 API；扩展 desktop preload/main IPC。

### 阶段 3：任务中心页面

替换 `MarketPage` 为 `TaskCenter`，新增任务列表、筛选、新建 AI 测图任务入口。

### 阶段 4：巴拉 AI 测图实例详情

新增 `TaskInstanceRunner.vue`；把配置、审批、创建结果、日志、输出文件绑定到 `instance_uid`，旧 `TaskRunner.vue` 只保留脚本单次运行能力。

### 阶段 5：状态同步与回看

将审批批次、创建结果、产物文件写回实例；支持历史任务点进去回看配置、审批决策、创建结果和输出文件。

### 阶段 6：定时任务中心

新增 `task_schedules` 持久化、后端 API、APScheduler 动态注册、Electron/dev bridge 调用和任务中心 UI。首个定时任务固定接入 `巴拉-AI测图数据抓取导出`，每次触发生成新的任务实例，输出和通知都绑定到本次实例。

## 验收标准

1. `抓虾市场` 被替换为 `任务中心`。
2. 可从任务中心新增 `巴拉-AI测图任务`。
3. 新实例打开后是独立空配置页，不读取旧运行的配置状态。
4. 任务运行后能在任务中心看到状态变化。
5. 生图完成后实例进入待审批，并能在第二步内嵌审批。
6. 审批提交后创建结果显示在第三步。
7. 历史任务可回看配置、日志、输出文件和创建结果。
8. 当前 `task_runs` 历史记录仍可正常使用。
9. 任务中心可创建、启停、运行一次、归档 `巴拉-AI测图数据抓取导出` 定时任务。
10. 每天/每周定时配置会注册到本地调度器，到点自动创建任务实例并执行脚本。
11. 定时任务默认导出目录和钉钉消息模板持久保存，执行时无需用户再次输入。
