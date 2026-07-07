# 抓虾 AI 测图云端审批闭环设计

## 背景

抓虾当前已经能在本地完成 `巴拉-AI测图全链路`：从森马云盘找图、按 Prompt 库生成 AI 图、落本地审批批次，到人工确认后上传并创建天猫测图任务。这个链路的关键依赖仍然在本地：网盘访问、Chrome 登录态、1XM Key、本地文件处理和天猫后台操作。

本设计不把这些能力一次性搬到云端，而是在现有抓虾链路上增加一个云端协同层：抓虾本地负责找图和首次生图，生成结果同步到云端审批看板；用户在云端完成审批、重生图和提交；最终上传创建动作由用户选中的在线抓虾任务机执行，并把执行结果回传云端。

## 目标

1. 云端维护统一 Prompt 库，抓虾本地 AI 测图任务从云端读取 Prompt 模板和版本。
2. 抓虾本地完成网盘找图、首次生图和批次打包后，把款式、源图、AI 图、Prompt、运行日志摘要同步到云端。
3. 云端提供多人可访问的审批看板，支持单图确认、舍弃、Prompt 修改、新增主图/参考图、单图重生图和批量重生图。
4. 重生图任务由云端派发给抓虾任务机执行，新图追加回同一云端审批批次。
5. 审批完成后，用户选择一台在线任务机下发上传创建任务；任务机使用本机天猫登录态执行，并回传任务创建结果、失败原因和详情链接。
6. 审批批次全程可追溯：每张图绑定原始 Prompt、模板版本、参考图来源、生成任务、审批状态和上传结果。

## 非目标

1. V1 不做纯云端网盘找图；森马云盘素材发现仍由抓虾本地完成。
2. V1 不把天猫登录态、Cookie 或店铺后台权限上传到云端。
3. V1 不把所有抓虾脚本改造成云端平台；只接入 `tmall_ai_image_test_chain`。
4. V1 不做复杂组织权限、计费、额度扣减或跨品牌多租户隔离；先支持一个内部团队的可控使用。
5. V1 不要求重生图必须由云端服务器直接调用 1XM；重生图优先由任务机执行。

## 总体架构

采用“三层闭环”：

1. 抓虾本地执行层：
   - 继续负责森马云盘找图、1XM 首次生图、重生图、天猫上传和测图任务创建。
   - 启动后注册为云端任务机，定时心跳，主动拉取或接收云端任务。
   - 所有与登录态相关的动作都在本机完成。

2. 云端控制层：
   - 保存 Prompt 库、任务批次、图片资产索引、审批状态、任务机状态和执行结果。
   - 提供审批看板、数据看板和任务机派发接口。
   - 管理任务租约、取消、重试、超时和结果合并。

3. 云端资产层：
   - 存储源图、参考图、AI 图、执行证据表格、日志摘要和上传结果 JSON。
   - 图片以对象存储保存，数据库只存元数据和对象 key。

推荐 V1 基础设施：

- Cloudflare Pages：审批看板和管理前端。
- Cloudflare Workers 或 IDC FastAPI：云端 API。
- R2：图片、表格、日志和 JSON 资产。
- D1 或 IDC Postgres：任务、审批、Prompt 和任务机状态。
- Queues 或数据库任务表：异步任务派发。
- Cloudflare Access：内部登录入口。
- Cloudflare Tunnel：当 API 或数据库放在 IDC 时，对外提供受控入口。

如果 D1 的关系查询或后台任务能力不够用，V1 可采用 Cloudflare Pages + Workers 作为入口，核心 API 和 Postgres 放 IDC；抓虾任务机仍只需要主动连接云端 API。

## 端到端流程

### 1. Prompt 库准备

用户在云端维护 Prompt 库：

- Prompt 分为 `裂变图`、`创意拍摄` 两类方案。
- 每类方案包含多个模板分组，例如上装、下装、鞋品、连衣裙。
- 每个模板有名称、描述内容、默认尺寸、格式、质量、优先级、适用品类、适用性别、启用状态和版本号。
- Prompt 发布后生成不可变版本；运行中的任务记录使用的版本，不被后续编辑覆盖。

抓虾创建 AI 测图任务时，从云端选择 Prompt 库版本。若本机离线或云端不可用，任务不启动首次生图，避免使用过期本地模板造成追溯断层。

### 2. 本地找图和首次生图

抓虾本地执行 `巴拉-AI测图全链路`：

1. 读取测图任务导入模板。
2. 按款号、商品 ID、品类、性别从云端 Prompt 库版本选择 Prompt。
3. 在森马云盘目录找主图和参考图。
4. 调用 1XM 生成 AI 图。
5. 生成本地审批批次和执行证据。
6. 同步云端批次。

同步到云端的内容包括：

- 批次信息：本地 run id、任务实例 UID、批次标题、创建人、创建机器、执行参数。
- 款式信息：款号、商品 ID、SKC、品类、性别、源图状态、缺失原因。
- 图片资产：主图、参考图、AI 图的对象存储 key、文件名、宽高、hash、来源路径摘要。
- Prompt 信息：模板 ID、模板版本、最终 Prompt、Prompt 字段名、提示词分组。
- 生成信息：1XM task id、轮询状态、生成耗时、错误原因、重试次数。

云端同步成功后，本地任务实例进入 `waiting_cloud_approval`，云端批次进入 `pending_review`。

### 3. 云端审批

云端审批看板按款式组织图片：

- 每款显示主图、参考图、AI 图、缺失提示词和生成失败原因。
- 单张 AI 图支持 `确认`、`舍弃`、`待定`。
- 舍弃图不会进入上传创建计划。
- 选中图片后可查看并编辑本次重生图 Prompt。
- 可新增主图或参考图；新增素材上传到云端资产层，并记录来源为 `manual_upload`。
- 可单图重生图。
- 可批量选择所有舍弃图或所有未完成款式，一键重生图。

流转规则：

- 单款至少有一张确认图，且不存在必须补充的缺失项时，款式状态为 `review_ready`。
- 单款全部 AI 图被舍弃且没有正在运行的重生图任务时，款式状态为 `needs_regeneration`。
- 全部款式均为 `review_ready` 或被标记为 `skip_upload` 后，批次状态为 `ready_to_submit`。
- 批次 `ready_to_submit` 后，用户才能选择任务机并下发上传创建任务。

兼容导出：

- V1 仍保留 `保存审核状态` 和 `导出明细`。
- 导出文件区分确认图、舍弃图、待重生图、跳过款式、缺失 Prompt。
- 导出是兜底能力，不再是主操作链路。

### 4. 重生图任务

云端不直接修改本地文件，而是创建 `regenerate_ai_image` 任务：

- 单图重生图：基于一张已有 AI 图或某款式新增生成一张图。
- 批量重生图：基于筛选规则创建多条子任务，例如所有舍弃图、所有无确认图款式、所有缺失 Prompt 后已补齐款式。

V1 默认派发给原始生成机器；如果原机器离线，用户可以选择其他具备 `tmall_ai_image_test_chain` 和 1XM 配置的任务机。任务机执行时从云端下载主图/参考图，调用本机 1XM Key 生图，再把新图和生成元数据上传回云端。新图状态默认为 `pending`，追加到原款式图片列表，不覆盖旧图。

重生图任务支持：

- 后台异步运行。
- 看板显示进度。
- 用户取消未开始或运行中的任务。
- 任务机心跳超时后释放租约，允许重试。
- 每张新图记录父图、父 Prompt、修改后 Prompt 和任务机。

### 5. 上传创建任务

用户在云端批次点击 `提交创建测图任务`：

1. 云端生成上传计划，只包含确认图。
2. 用户选择在线任务机。
3. 云端创建 `submit_tmall_material_test` 任务并绑定租约。
4. 任务机下载确认图和上传计划。
5. 任务机使用本机 9222 Chrome 会话和天猫登录态上传图片、创建测图任务。
6. 任务机持续回传进度、结果、失败原因和测图详情 URL。
7. 云端更新款式和批次状态。

结果状态：

- `submitted`：该款已成功创建测图任务。
- `submit_failed`：该款上传或创建失败。
- `submit_confirmed_by_readback`：提交调用异常，但通过天猫后台回读确认已上线。
- `partial_failed`：批次部分成功。
- `completed`：批次全部成功或跳过项均已确认处理。

## 任务机设计

任务机是安装抓虾的电脑。注册后云端可见，但云端不能主动访问本机内网端口；任务机通过出站连接与云端通讯。

注册信息：

- `machine_id`：首次启动生成并持久化。
- `machine_name`：用户可读名称。
- `user`：当前登录用户或配置的负责人。
- `app_version`：抓虾版本。
- `capabilities`：支持的任务类型，例如 `tmall_ai_image_test_chain`、`regenerate_ai_image`、`submit_tmall_material_test`。
- `health`：在线、忙碌、离线、需要登录、配置缺失。
- `last_seen_at`：最后心跳时间。
- `current_job_id`：当前任务。

任务租约：

- 任务机领取任务后获得租约。
- 租约有过期时间，任务机需续约。
- 用户取消任务后，云端标记为 `cancel_requested`；任务机在安全检查点停止。
- 任务机异常离线后，任务回到可重试状态。
- 上传创建任务默认不自动换机重试，避免重复创建；需要用户手动确认后重试。

## 云端数据模型

核心表：

```sql
prompt_libraries (
  id, name, scenario, status, created_at, updated_at
)
```

```sql
prompt_templates (
  id, library_id, group_name, field_name, prompt_text,
  size_label, output_format, quality,
  category_rules_json, gender_rules_json,
  priority_json, enabled, updated_at
)
```

```sql
prompt_template_versions (
  id, template_id, version_no, snapshot_json, created_at, created_by
)
```

```sql
ai_image_batches (
  id, batch_uid, local_instance_uid, local_run_id,
  title, status, prompt_library_id, prompt_version_set_json,
  source_machine_id, created_by, created_at, updated_at
)
```

```sql
ai_image_styles (
  id, batch_uid, style_code, item_id, skc_code,
  category, gender, status, missing_prompt_reason,
  source_summary_json, review_summary_json, submit_summary_json
)
```

```sql
ai_image_assets (
  id, asset_uid, batch_uid, style_id,
  kind, status, object_key, filename, content_hash,
  prompt_template_version_id, prompt_text,
  parent_asset_uid, generation_job_id,
  meta_json, created_at, updated_at
)
```

```sql
approval_events (
  id, batch_uid, style_id, asset_uid,
  event_type, actor, payload_json, created_at
)
```

```sql
task_machines (
  id, machine_id, machine_name, app_version,
  capabilities_json, health, current_job_id,
  last_seen_at, registered_at, updated_at
)
```

```sql
dispatch_jobs (
  id, job_uid, batch_uid, job_type, status,
  requested_by, assigned_machine_id, lease_expires_at,
  payload_json, result_json, created_at, updated_at
)
```

图片和表格正文不放数据库，统一存对象存储；数据库保存对象 key、hash 和业务元数据。

## 云端 API 边界

Prompt：

- `GET /api/prompt-libraries`
- `POST /api/prompt-libraries`
- `PATCH /api/prompt-templates/{id}`
- `POST /api/prompt-libraries/{id}/publish-version`
- `GET /api/prompt-libraries/{id}/resolved?category=&gender=`

批次同步：

- `POST /api/ai-image-batches`
- `POST /api/ai-image-batches/{batch_uid}/assets/presign`
- `POST /api/ai-image-batches/{batch_uid}/sync-complete`
- `GET /api/ai-image-batches/{batch_uid}`

审批：

- `PATCH /api/ai-image-assets/{asset_uid}/decision`
- `POST /api/ai-image-styles/{style_id}/manual-assets`
- `POST /api/ai-image-batches/{batch_uid}/regenerate`
- `POST /api/ai-image-batches/{batch_uid}/export-review-detail`
- `POST /api/ai-image-batches/{batch_uid}/mark-ready`

任务机：

- `POST /api/machines/register`
- `POST /api/machines/{machine_id}/heartbeat`
- `POST /api/machines/{machine_id}/jobs/claim`
- `POST /api/jobs/{job_uid}/renew`
- `POST /api/jobs/{job_uid}/progress`
- `POST /api/jobs/{job_uid}/complete`
- `POST /api/jobs/{job_uid}/fail`
- `POST /api/jobs/{job_uid}/cancel`

上传创建：

- `GET /api/ai-image-batches/{batch_uid}/submit-plan`
- `POST /api/ai-image-batches/{batch_uid}/submit`
- `GET /api/ai-image-batches/{batch_uid}/submit-result`

## 抓虾本地改造点

1. `tmall_ai_image_test_chain` 增加云端 Prompt 库读取。
2. 本地审批批次增加云端同步器，把 batch JSON、图片和证据文件上传到云端。
3. 抓虾设置页增加云端服务配置：API URL、登录令牌、机器名称、启用任务机。
4. 抓虾启动后注册任务机，展示在线状态、当前任务和最近错误。
5. 增加任务机执行器：
   - `regenerate_ai_image`
   - `submit_tmall_material_test`
6. Electron 内可内嵌云端审批页面；内嵌页与浏览器访问同一 URL 和同一份数据。

现有本地 `/tmall-ai-image-approval/api/{batch_id}` 能力保留，用于离线兜底和开发调试；云端审批是主入口。

## 数据看板 V1

数据看板不替代审批看板，只做批次级和任务机级的运行透明度：

- 批次概览：总款式数、已确认款式、需重生款式、已提交款式、失败款式。
- 生图质量漏斗：生成成功图数、确认图数、舍弃图数、重生图数、最终上传图数。
- Prompt 表现：按 Prompt 模板版本统计确认率、舍弃率和重生次数。
- 任务机表现：在线时长、领取任务数、成功数、失败数、平均耗时。
- 失败原因：缺主图、缺 Prompt、1XM 失败、上传失败、天猫创建失败、回读确认。

V1 数据看板只读展示，不提供跨批次自动优化 Prompt 的能力；Prompt 优化仍由用户在 Prompt 库中手动更新并发布新版本。

## 安全与权限

- 云端只保存图片资产、Prompt、审批状态和任务结果，不保存天猫 Cookie。
- 任务机只执行受支持的白名单任务类型，不执行云端传来的任意脚本。
- 任务 payload 不包含本地任意路径写入指令；下载和输出目录由抓虾本地安全策略决定。
- 上传创建任务必须用户显式选择任务机并确认。
- 批次、Prompt 和资产 API 需要登录。
- 对象存储访问使用短期签名 URL 或后端代理，不暴露长期密钥。
- 所有审批和任务事件写入审计日志。

## 错误处理

- 云端 Prompt 库不可用：本地任务不启动首次生图，并提示用户恢复网络或选择离线兜底模式；V1 默认不开启离线兜底。
- 批次同步中断：抓虾保留本地 batch，同步器可继续上传缺失资产。
- 图片上传失败：批次状态为 `sync_partial`，审批看板显示缺失资产。
- 重生图任务机离线：任务变为 `retryable_failed`，用户可重新派发。
- 上传创建任务失败：失败款式保留确认图和错误原因，用户手动重试，默认不自动重复创建。
- 天猫回读确认已上线：记录为 `submit_confirmed_by_readback`，不视为失败。

## 分阶段交付

### Phase 1：云端 Prompt 库和批次同步

- 云端 Prompt 库 CRUD 和版本发布。
- 抓虾本地任务读取云端 Prompt 版本。
- 本地生成批次同步到云端。
- 云端审批看板只读展示图片、Prompt 和款式状态。

验收标准：

- 一次本地 AI 测图任务完成后，云端能看到同一批款式、源图、AI 图和 Prompt。
- 每张 AI 图能追溯到 Prompt 模板版本和本地 run id。

### Phase 2：云端审批和重生图

- 云端确认、舍弃、保存审批状态。
- 单图 Prompt 修改和重生图。
- 批量重生图。
- 任务机注册、心跳、领取 `regenerate_ai_image` 任务。
- 新图追加回看板。

验收标准：

- 用户在云端舍弃若干图后，可一键重生图。
- 重生图由任务机后台执行，看板无需等待页面打开。
- 新生成图片追加到原款式下，旧图和决策历史保留。

### Phase 3：任务机上传创建和结果回传

- 云端生成确认图上传计划。
- 用户选择任务机下发上传创建任务。
- 任务机执行天猫上传和测图任务创建。
- 云端展示进度、成功/失败、任务 ID 和详情链接。

验收标准：

- 全部款式审批完成后，云端可以下发提交任务。
- 任务机完成后，云端批次状态正确进入 `completed` 或 `partial_failed`。
- 失败款式可定位错误原因并手动重试。

## 测试策略

本地抓虾：

- Prompt 库解析和云端版本选择的单元测试。
- 批次同步器测试：断点续传、重复上传幂等、图片 hash 去重。
- 任务机协议测试：注册、心跳、领取、续约、取消、完成、失败。
- `regenerate_ai_image` 和 `submit_tmall_material_test` 的 dry-run 测试。

云端：

- Prompt 版本发布测试。
- 批次、款式、资产、审批状态的数据模型测试。
- 对象存储签名和上传完成回调测试。
- 批量重生图任务拆分测试。
- 上传计划只包含确认图的测试。

端到端：

- 本地生成一个小批次，同步到云端审批。
- 云端舍弃一张图，任务机重生图并追加。
- 云端确认图片，选择任务机提交，回传结果。
- 模拟任务机离线、任务取消、重复提交和部分失败。

## 成功指标

- 用户无需导出表格再导入，即可对舍弃图批量重生图。
- 多人通过云端看板看到同一批图片、Prompt 和审批状态。
- 上传创建前，云端能明确展示每款最终会上传哪些确认图。
- 任务机执行结果可追溯到机器、任务、款式和图片。
- 本地敏感登录态不离开任务机。
