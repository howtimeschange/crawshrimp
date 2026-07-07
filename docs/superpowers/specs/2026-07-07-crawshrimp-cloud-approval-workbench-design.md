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
7. 独立网页引入账号管理和 RBAC 权限体系；账号只允许管理员创建或邀请，不开放公众注册。

## 非目标

1. V1 不做纯云端网盘找图；森马云盘素材发现仍由抓虾本地完成。
2. V1 不把天猫登录态、Cookie 或店铺后台权限上传到云端。
3. V1 不把所有抓虾脚本改造成云端平台；只接入 `tmall_ai_image_test_chain`。
4. V1 做单团队 RBAC，但不做跨品牌多租户、组织层级、计费或额度扣减。
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
- Cloudflare Access：可作为外围访问保护；应用自身仍维护账号、角色和权限。
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

### 注册与鉴权

任务机不能自动加入可调度池，必须由网页管理员签发注册 token。推荐流程：

1. 管理员进入云端 `任务机管理`。
2. 创建注册 token，填写机器名称、负责人、允许能力、有效期和是否需要二次审批。
3. 云端只展示一次明文 token，并只保存 token hash。
4. 负责人在抓虾客户端设置页配置云端 API URL 和注册 token。
5. 抓虾用注册 token 调用注册接口，提交本机生成的 `machine_fingerprint`、应用版本、能力清单和本地机器名。
6. 云端校验 token 未过期、未使用、能力范围匹配后，创建 `machine_id` 和长期 `machine_token`。
7. 抓虾把 `machine_id` 和 `machine_token` 保存到本机安全存储；注册 token 立即作废。
8. 如果 token 策略为 `require_approval`，机器进入 `pending_approval`，管理员确认后才能领取任务。

机器 token 与用户 session 完全分离：

- 用户 session 用于登录网页、审批、创建任务和管理任务机。
- 机器 token 只允许调用机器协议 API，例如心跳、领取任务、续约、回传进度和上传结果。
- 机器 token 不能访问审批页面、账号管理、Prompt 管理或任何管理后台 API。
- 机器 token 可由管理员撤销或轮换；撤销后该机器下次心跳即被拒绝并停止领取新任务。
- 网页上选择任务机，本质是给云端任务绑定 `assigned_machine_id`；网页不会直接调用本机端口。

注册信息：

- `machine_id`：首次启动生成并持久化。
- `machine_name`：用户可读名称。
- `user`：当前登录用户或配置的负责人。
- `app_version`：抓虾版本。
- `capabilities`：支持的任务类型，例如 `tmall_ai_image_test_chain`、`regenerate_ai_image`、`submit_tmall_material_test`。
- `health`：在线、忙碌、离线、需要登录、配置缺失。
- `auth_status`：未注册、待审批、已启用、已停用、已吊销、注册 token 过期。
- `last_seen_at`：最后心跳时间。
- `current_job_id`：当前任务。

机器注册状态机：

```text
token_issued
  -> token_expired
  -> token_revoked
  -> claimed_pending_approval

claimed_pending_approval
  -> active
  -> rejected

active
  -> disabled
  -> revoked

disabled
  -> active
  -> revoked
```

健康状态机：

```text
offline
  -> online_idle

online_idle
  -> online_busy
  -> needs_login
  -> config_missing
  -> version_blocked

online_busy
  -> online_idle
```

其中 `auth_status` 决定机器是否被允许进入调度池，`health` 决定机器当前是否适合领取某类任务。只有 `auth_status=active` 且 `health` 属于 `online_idle` 或允许并发的 `online_busy` 时，任务队列才会把任务派给它。

任务租约：

- 任务机领取任务后获得租约。
- 租约有过期时间，任务机需续约。
- 用户取消任务后，云端标记为 `cancel_requested`；任务机在安全检查点停止。
- 任务机异常离线后，任务回到可重试状态。
- 上传创建任务默认不自动换机重试，避免重复创建；需要用户手动确认后重试。

### 两端交互协议

网页端、云端和任务机之间不做点对点调用，全部通过云端任务队列交互：

1. 网页用户完成审批并点击提交。
2. 云端校验用户权限、批次状态和机器可用性。
3. 云端创建 `dispatch_jobs`，写入任务类型、批次、上传计划、目标机器、幂等键和租约策略。
4. 任务机通过心跳或长轮询发现可领取任务。
5. 任务机调用 claim 接口领取任务，云端原子写入 `lease_id`、`lease_expires_at` 和 `assigned_machine_id`。
6. 任务机执行任务，周期性续约并回传进度。
7. 任务机把结果文件上传到对象存储，并调用 complete 或 fail 接口。
8. 云端合并结果，更新批次、款式、图片和数据看板。
9. 网页通过轮询或 SSE 看到任务状态变化。

任务 payload 必须是声明式的业务计划，不是任意脚本。例如上传创建任务只包含批次、款式、确认图对象 key、目标平台和必要参数；任务机本地决定下载目录、临时文件路径和具体脚本入口。

### 任务队列与状态机

云端任务队列以 `dispatch_jobs` 为主表，支持任务类型：

- `sync_ai_image_batch`：本地生成后同步云端批次。
- `regenerate_ai_image`：重生图。
- `submit_tmall_material_test`：上传确认图并创建测图任务。
- `machine_health_check`：可选的机器自检任务。

任务状态：

```text
created
  -> queued
  -> leased
  -> running
  -> uploading_results
  -> succeeded
```

失败、取消和阻断状态：

```text
queued -> cancelled
leased -> lease_expired -> queued
running -> cancel_requested -> cancelled
running -> retryable_failed -> queued
running -> terminal_failed
running -> blocked_needs_login
running -> blocked_config_missing
```

调度规则：

- `queued` 任务只有在目标机器 active、能力匹配、健康状态允许、并发额度未满时才能被 claim。
- 指定机器任务只允许该机器领取；未指定机器任务可由符合能力的机器领取。
- `regenerate_ai_image` 可按最大重试次数自动重新排队，也可换机重试。
- `submit_tmall_material_test` 默认不自动换机重试，避免重复创建测图任务；失败后由 operator 手动确认重试策略。
- 每次 claim 都生成新的 `lease_id`，任务机续约和回传必须带当前 lease，避免旧进程误写结果。
- 每个任务要有 `idempotency_key`；同一批次同一操作重复点击时，云端返回已有任务，不创建重复任务。

队列实现可以先用数据库事务完成，等并发和吞吐增加后再接入 Cloudflare Queues 或 IDC 消息队列。无论底层队列是什么，`dispatch_jobs` 都必须作为业务事实表，方便网页查询、审计和失败恢复。

## 云端数据模型

核心表：

```sql
users (
  id, email, name, status,
  password_hash, last_login_at,
  created_by, created_at, updated_at
)
```

```sql
roles (
  id, role_key, name, description, built_in, created_at, updated_at
)
```

```sql
user_roles (
  id, user_id, role_id, assigned_by, assigned_at
)
```

```sql
role_permissions (
  id, role_id, permission_key, created_at
)
```

```sql
sessions (
  id, user_id, session_hash, expires_at, revoked_at, created_at
)
```

```sql
audit_logs (
  id, actor_user_id, actor_machine_id,
  action, resource_type, resource_id,
  payload_json, ip_address, user_agent, created_at
)
```

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
  id, machine_id, machine_name, owner_user_id,
  app_version, fingerprint_hash,
  capabilities_json, auth_status, health,
  current_job_id, last_seen_at, registered_at, updated_at
)
```

```sql
machine_enrollment_tokens (
  id, token_hash, label, owner_user_id,
  allowed_capabilities_json, require_approval,
  status, expires_at, used_by_machine_id,
  created_by, created_at, used_at, revoked_at
)
```

```sql
machine_tokens (
  id, machine_id, token_hash, token_version,
  status, issued_by, issued_at, last_used_at, revoked_at
)
```

```sql
dispatch_jobs (
  id, job_uid, batch_uid, job_type, status,
  requested_by, assigned_machine_id, required_capabilities_json,
  priority, attempt_count, max_attempts,
  idempotency_key, lease_id, lease_expires_at,
  payload_json, result_json, created_at, updated_at
)
```

```sql
dispatch_job_events (
  id, job_uid, machine_id, lease_id,
  event_type, message, payload_json, created_at
)
```

图片和表格正文不放数据库，统一存对象存储；数据库保存对象 key、hash 和业务元数据。

## 云端 API 边界

账号与权限：

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/admin/users`
- `POST /api/admin/users`
- `PATCH /api/admin/users/{user_id}`
- `POST /api/admin/users/{user_id}/reset-password`
- `GET /api/admin/roles`
- `PATCH /api/admin/users/{user_id}/roles`
- `GET /api/admin/audit-logs`
- `GET /api/admin/machine-enrollment-tokens`
- `POST /api/admin/machine-enrollment-tokens`
- `POST /api/admin/machine-enrollment-tokens/{token_id}/revoke`
- `GET /api/admin/machines`
- `PATCH /api/admin/machines/{machine_id}`
- `POST /api/admin/machines/{machine_id}/approve`
- `POST /api/admin/machines/{machine_id}/disable`
- `POST /api/admin/machines/{machine_id}/revoke`
- `POST /api/admin/machines/{machine_id}/rotate-token`

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

- `POST /api/machines/enroll`
- `POST /api/machines/heartbeat`
- `POST /api/machines/jobs/claim`
- `POST /api/jobs/{job_uid}/renew`
- `POST /api/jobs/{job_uid}/progress`
- `POST /api/jobs/{job_uid}/complete`
- `POST /api/jobs/{job_uid}/fail`
- `POST /api/jobs/{job_uid}/cancel`

机器 API 鉴权规则：

- `POST /api/machines/enroll` 使用注册 token，只能换取一次长期机器 token。
- 其他 `/api/machines/*` 和机器侧 `/api/jobs/*` 接口使用机器 token。
- 机器 token 请求必须解析出唯一 `machine_id`，不能信任客户端传入的 path machine id。
- `renew`、`progress`、`complete`、`fail` 必须校验当前 `lease_id`。
- 用户侧取消任务使用用户 session；机器侧看到 `cancel_requested` 后执行安全停止并回传 `cancelled`。

上传创建：

- `GET /api/ai-image-batches/{batch_uid}/submit-plan`
- `POST /api/ai-image-batches/{batch_uid}/submit`
- `GET /api/ai-image-batches/{batch_uid}/submit-result`

## 抓虾本地改造点

1. `tmall_ai_image_test_chain` 增加云端 Prompt 库读取。
2. 本地审批批次增加云端同步器，把 batch JSON、图片和证据文件上传到云端。
3. 抓虾设置页增加云端服务配置：API URL、注册 token、机器名称、启用任务机。
4. 抓虾启动后注册任务机，展示在线状态、当前任务和最近错误。
5. 增加任务机执行器：
   - `regenerate_ai_image`
   - `submit_tmall_material_test`
6. Electron 内可内嵌云端审批页面；内嵌页与浏览器访问同一 URL 和同一份数据。

现有本地 `/tmall-ai-image-approval/api/{batch_id}` 能力保留，用于离线兜底和开发调试；云端审批是主入口。

## 账号与 RBAC

独立网页必须有应用级账号体系。V1 不开放注册入口，不支持匿名访问，不允许用户自行加入团队。

账号生命周期：

1. 首个管理员通过部署期 seed、命令行脚本或后台受控接口创建。
2. 管理员在后台创建账号或发送邀请。
3. 用户首次登录时设置密码或绑定企业身份源。
4. 管理员可停用账号、重置密码、调整角色和回收会话。
5. 离职或转岗用户停用后，历史审批和任务记录仍保留原操作者。

V1 角色：

- `super_admin`：系统初始化、角色配置、全部数据和安全设置。
- `admin`：创建账号、分配角色、管理任务机、查看审计日志。
- `prompt_manager`：维护 Prompt 库、发布 Prompt 版本、查看 Prompt 表现数据。
- `reviewer`：查看批次、确认/舍弃图片、编辑重生图 Prompt、发起重生图。
- `operator`：在审批完成后选择任务机并提交创建测图任务，处理失败重试。
- `machine_operator`：绑定和维护自己负责的任务机，查看机器任务和错误。
- `viewer`：只读查看批次、图片、数据看板和结果。

核心权限点：

| 权限 | super_admin | admin | prompt_manager | reviewer | operator | machine_operator | viewer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 管理账号和角色 | 是 | 是 | 否 | 否 | 否 | 否 | 否 |
| 管理 Prompt 库 | 是 | 是 | 是 | 否 | 否 | 否 | 否 |
| 查看审批批次 | 是 | 是 | 是 | 是 | 是 | 是 | 是 |
| 审批图片 | 是 | 是 | 否 | 是 | 否 | 否 | 否 |
| 发起重生图 | 是 | 是 | 否 | 是 | 是 | 否 | 否 |
| 提交创建测图任务 | 是 | 是 | 否 | 否 | 是 | 否 | 否 |
| 管理全部任务机 | 是 | 是 | 否 | 否 | 否 | 否 | 否 |
| 维护本人任务机 | 是 | 是 | 否 | 否 | 否 | 是 | 否 |
| 查看审计日志 | 是 | 是 | 否 | 否 | 否 | 否 | 否 |

权限判断在后端执行，前端只做显示层控制。所有会改变业务状态的操作必须记录 `actor_user_id`、角色、来源 IP、批次、资产或任务 ID。

任务机身份不等同于用户身份：

- 人类用户使用账号登录和 RBAC 授权。
- 任务机使用独立机器 token 注册、心跳和领取任务。
- 机器 token 只能调用机器协议 API，不能访问审批页面或管理 API。
- 管理员可以为任务机签发、轮换和撤销 token。
- 下发上传创建任务时，记录发起用户和执行机器两类主体。

## 数据看板 V1

数据看板不替代审批看板，只做批次级和任务机级的运行透明度：

- 批次概览：总款式数、已确认款式、需重生款式、已提交款式、失败款式。
- 生图质量漏斗：生成成功图数、确认图数、舍弃图数、重生图数、最终上传图数。
- Prompt 表现：按 Prompt 模板版本统计确认率、舍弃率和重生次数。
- 任务机表现：在线时长、领取任务数、成功数、失败数、平均耗时。
- 失败原因：缺主图、缺 Prompt、1XM 失败、上传失败、天猫创建失败、回读确认。

V1 数据看板只读展示，不提供跨批次自动优化 Prompt 的能力；Prompt 优化仍由用户在 Prompt 库中手动更新并发布新版本。

## 安全与权限

- 云端网页没有开放注册入口；所有账号必须由管理员创建、邀请或停用。
- 后端以 RBAC 权限点做强校验；前端菜单隐藏不能作为权限边界。
- 云端只保存图片资产、Prompt、审批状态和任务结果，不保存天猫 Cookie。
- 任务机只执行受支持的白名单任务类型，不执行云端传来的任意脚本。
- 任务机 token 与用户 session 分离，机器 token 不能访问管理后台或审批页面。
- 任务机注册 token 只能由管理员生成，明文只展示一次，服务端只保存 hash，并设置有效期和能力范围。
- 任务机长期 token 只保存在本机安全存储中；网页后台只显示机器状态，不展示长期 token。
- 任务 payload 不包含本地任意路径写入指令；下载和输出目录由抓虾本地安全策略决定。
- 上传创建任务必须用户显式选择已授权且健康状态可用的任务机并确认。
- 批次、Prompt、资产、任务机和管理 API 均需要登录或机器 token。
- 对象存储访问使用短期签名 URL 或后端代理，不暴露长期密钥。
- 所有审批和任务事件写入审计日志。

## 错误处理

- 云端 Prompt 库不可用：本地任务不启动首次生图，并提示用户恢复网络或选择离线兜底模式；V1 默认不开启离线兜底。
- 注册 token 过期或已使用：抓虾注册失败，网页后台显示 token 状态，管理员重新签发。
- 任务机 token 被撤销：任务机心跳被拒绝，客户端停止领取新任务并提示重新注册。
- 任务机未审批：机器可出现在后台列表，但不可被网页用户选择下发任务。
- 批次同步中断：抓虾保留本地 batch，同步器可继续上传缺失资产。
- 图片上传失败：批次状态为 `sync_partial`，审批看板显示缺失资产。
- 重生图任务机离线：任务变为 `retryable_failed`，用户可重新派发。
- 任务租约不匹配：云端拒绝旧进程回传，要求任务机重新拉取当前任务状态。
- 上传创建任务失败：失败款式保留确认图和错误原因，用户手动重试，默认不自动重复创建。
- 天猫回读确认已上线：记录为 `submit_confirmed_by_readback`，不视为失败。

## 分阶段交付

### Phase 0：账号、RBAC 和管理后台基础

- 应用级登录、退出、会话管理。
- 管理员创建账号、停用账号、分配角色。
- 内置角色和权限点。
- 审计日志。
- 任务机注册 token 签发、使用、过期和撤销。
- 任务机长期 token 签发、轮换和撤销。
- 机器待审批、启用、停用、吊销状态管理。

验收标准：

- 独立网页无注册入口，未登录用户不能访问业务页面。
- 管理员能创建 reviewer、operator、prompt_manager、machine_operator 和 viewer 账号。
- 非授权角色访问管理 API、Prompt 发布、审批提交或任务机管理时被拒绝。
- 未使用合法注册 token 的抓虾客户端不能成为任务机。
- 待审批、停用或吊销的机器不能领取任务，也不能出现在可下发机器列表中。

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
- 已授权任务机心跳、领取 `regenerate_ai_image` 任务。
- 新图追加回看板。

验收标准：

- 用户在云端舍弃若干图后，可一键重生图。
- 重生图由任务机后台执行，看板无需等待页面打开。
- 新生成图片追加到原款式下，旧图和决策历史保留。
- 同一重生图任务重复点击时，云端通过幂等键返回已有任务，不重复派发。

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
- 任务机注册 token 测试：过期、重复使用、能力不匹配、待审批、撤销。
- 任务队列状态机测试：claim 原子性、lease 续约、lease 过期、旧 lease 回传拒绝、幂等任务复用。
- `regenerate_ai_image` 和 `submit_tmall_material_test` 的 dry-run 测试。

云端：

- 登录、会话、账号创建、停用和角色分配测试。
- RBAC 权限矩阵测试，覆盖每个角色的允许和拒绝操作。
- 机器 token 与用户 session 隔离测试。
- 审计日志写入测试。
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
