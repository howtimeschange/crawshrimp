# AI 生视频工作台：产品事实底稿

> 用途：作为后续正式 Spec 与 HTML 视觉锚点的事实来源。本文不代表功能已经实现，也不把实现建议视为已批准范围。

## 1. 信息分级

本文将信息严格分为三类：

- **接口事实**：来自现有代码或用户提供的两份接口文档，可直接追溯。
- **已批准产品决策**：来自本轮用户原始需求，可直接进入正式 Spec。
- **实现建议**：为了让产品与工程边界闭合而提出，仍需在正式 Spec 审核时确认。

主要来源：

- `/Users/xingyicheng/Downloads/HappyHorse接口文档与功能特性.md`
- `/Users/xingyicheng/Downloads/Seedance2.0接口文档与功能特性梳理.md`
- `app/src/renderer/App.vue`
- `app/src/renderer/views/AiImageWorkbench.vue`
- `app/src/renderer/views/AiVideoWorkflow.vue`
- `app/src/renderer/views/SettingsPage.vue`
- `core/api_server.py`
- `core/config.py`
- `integrations/seedanceCLI`
- `integrations/bailianCLI`

## 2. 已批准产品决策

以下内容已经在本轮需求与后续审核中明确，属于正式 Spec 和 HTML 视觉锚点必须遵守的产品合同。

### 2.1 命名与信息架构

1. 新增独立一级菜单 **AI 生视频**。
2. 原 **AI 视频** 一级菜单固定改名为 **AI 视频工作流**，继续承载巴拉五步业务流程。
3. 一级菜单顺序固定为：`AI 生图 / AI 生视频 / AI 视频工作流`。
4. 新页面路由视图固定为 `ai_video_generation`。
5. 新页面组件固定为 `AiVideoGenerationWorkbench.vue`。
6. Seedance 复用 `integrations/seedanceCLI`；HappyHorse 复用 `integrations/bailianCLI`，不复制 Provider API 实现。

### 2.2 产品范围与生成规则

1. **AI 生视频** 是纯粹的“Prompt + 按模型可选或必需的参考图 -> 生成视频”工作台，不复用巴拉五步工作流。
2. Prompt 在产品侧对四个模型模式都必填；即使 HappyHorse I2V 接口允许省略 Prompt，抓虾 UI 仍要求填写。
3. 首版固定支持四个模型模式：
   - Seedance 2.0：`doubao-seedance-2-0-260128`
   - HappyHorse T2V：`happyhorse-1.1-t2v`
   - HappyHorse I2V：`happyhorse-1.1-i2v`
   - HappyHorse R2V：`happyhorse-1.1-r2v`
4. 参数区必须随模型自适应，只显示该模型可用的图片、画幅、分辨率、时长、音频和水印控件。
5. 一次点击 **生成视频** 只创建一个 Job、一个 Run，并生成一个视频；多模型或多版本对比通过 **复制为新任务** 再提交，失败重试创建新的 Run。
6. 首版不做批量生成、Prompt 库、视频剪辑、自动发布、云端素材协作、视频参考或音频参考输入。

### 2.3 四模型输入与默认值

| 模型模式 | Prompt | 图片 | ratio | resolution | duration | audio | watermark |
|---|---|---|---|---|---:|---|---|
| Seedance 2.0 | 必填 | `0-4` 张参考图 | 默认 `9:16`，支持 `16:9`、`9:16`、`1:1`、`3:4`、`4:3`、`21:9`、`adaptive` | 默认 `720p` | 默认 5 秒，产品校验 `4-15` 秒 | 默认开，可关闭 | 默认关 |
| HappyHorse T2V | 必填 | `0` 张，上传区隐藏 | 默认 `16:9`，使用 HappyHorse 枚举 | 默认 `720P` | 默认 5 秒，产品校验 `3-15` 秒 | 不支持，控件隐藏 | 默认关 |
| HappyHorse I2V | 产品侧必填 | 必须且只能 `1` 张首帧图 | 控件隐藏且不提交，画幅跟随首帧 | 默认 `720P` | 默认 5 秒，产品校验 `3-15` 秒 | 不支持，控件隐藏 | 默认关 |
| HappyHorse R2V | 必填 | 必须 `1-9` 张有序参考图 | 默认 `9:16`，使用 HappyHorse 枚举 | 默认 `720P` | 默认 5 秒，产品校验 `3-15` 秒 | 不支持，控件隐藏 | 默认关 |

HappyHorse 可见 ratio 枚举固定为 `16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`4:5`、`5:4`、`9:21`、`21:9`；I2V 不显示该控件。上表是抓虾主动提交的产品默认值，与 Provider 文档的缺省值不是同一概念：抓虾会明确提交 `720P` 和关闭水印，不依赖 HappyHorse 文档中的 `1080P`、开启水印缺省值。

### 2.4 普通 UI 隐藏项

以下字段不进入普通 UI，不提供高级设置入口：

- `seed`
- raw JSON
- `priority`
- `tools`
- `safety_identifier`
- API key
- endpoint
- WorkspaceId
- poll interval
- timeout
- Provider 临时视频 URL
- CLI 路径

`safety_identifier` 仅由后端为 Seedance 注入稳定的脱敏标识，前端不展示、不编辑、不保存明文。密钥与 endpoint 继续由现有 **设置 -> AI 能力** 管理，不在工作台重复暴露。

### 2.5 布局与历史

1. HTML 视觉锚点必须展示抓虾应用壳的一级菜单，桌面展开宽度 `168px`、收起宽度 `56px`；`760px` 以下沿用现有 AI 工作台的底部横向导航。
2. 应用壳仍由 `App.vue` 负责，`AiVideoGenerationWorkbench.vue` 不得复制侧栏；视觉锚点展示侧栏只是为了明确整体布局。
3. 工作台内容区内的左栏固定为约 `360-380px`，承载模型、Prompt、参考图、参数和 **生成视频** 主按钮。
4. 右栏只承载同级平铺任务卡片网格，包括排队、生成、下载归档、已完成结果和失败恢复；没有常驻主预览、当前选中任务区或上下 master-detail 分区。
5. 卡片网格在宽屏 `>=1181px` 为三列、中屏 `1060-1180px` 为两列、移动与窄屏 `<1060px` 为一列。
6. 整卡 click、Enter、Space 或卡内 **查看详情** 打开同一个居中详情 modal；卡内独立操作阻止冒泡，不同时打开详情。
7. modal 包含播放器或状态占位、完整 Prompt、公开参数、状态与归档信息和可用操作；关闭按钮、遮罩和 Escape 均可关闭，关闭后焦点回收。首版没有上一条或下一条。
8. 排队、生成中、下载归档、已完成、待配置、失败、已取消和已过期任务都可以打开详情。
9. 创建 Job 后新卡片置顶但不自动打开 modal；`<1060px` 时固定切换到 **结果与队列** tab。
10. 历史记录只作为右侧队列筛选和抽屉，不做第三列；点击历史项先关闭抽屉，再打开同一个详情 modal。

### 2.6 持久化、状态与异步恢复

1. 使用通用逻辑实体 `ai_video_jobs`、`ai_video_assets`、`ai_video_runs`；Job 是用户可见记录，Asset 保存输入素材，Run 是不可变执行快照。
2. Public normalized 状态固定为：`draft`、`queued`、`running`、`downloading`、`completed`、`needs_config`、`failed`、`cancelled`、`expired`。
3. Adapter `create` 只创建远端任务并立即返回 Provider task ID，不调用 `wait`，也不附加 `--download`。
4. 后台 worker 通过 adapter `get` 轮询；Provider 完成后再单独下载并归档。
5. 只有本地 MP4 成功写入后，Job 才进入 `completed / 已完成`。
6. 应用重启后根据持久化的 Provider task ID 恢复轮询或下载；未知提交结果不得自动重提，避免重复生成与扣费。
7. Provider 已完成但本地下载失败时标记为待归档，并提供 **重新归档**。

## 3. 现有产品与代码事实

### 3.1 导航与页面现状

- 当前应用已经有一级菜单 **AI 生图** 与 **AI 视频**，对应证据位于 `app/src/renderer/App.vue:137-150`、`app/src/renderer/App.vue:244-253`。
- 当前 **AI 视频** 页面由 `AiVideoWorkflow.vue` 承载，是巴拉业务专用的五步流程，不是通用的 Prompt/参考图生视频工作台，证据位于 `app/src/renderer/views/AiVideoWorkflow.vue:1-29`、`app/src/renderer/views/AiVideoWorkflow.vue:1579-1585`。
- 后续产品决策已固定：原 **AI 视频** 入口改名为 **AI 视频工作流**，新 **AI 生视频** 作为并列的通用工作台，二者不互相替代。

### 3.2 AI 生图可复用的布局事实

- `AiImageWorkbench.vue:29-221` 是左侧输入区域。
- `AiImageWorkbench.vue:223-441` 是右侧结果与历史区域。
- `AiImageWorkbench.vue:3850-3864` 定义桌面双栏结构。
- `AiImageWorkbench.vue:4257-4305` 定义右侧主结果与约 `220-240px` 历史栏。
- `AiImageWorkbench.vue:5558-5599` 在 `1060px` 以下切换为“输入 / 结果”页签模式。
- 上述主结果与历史栏是现有 **AI 生图** 的实现事实；新 **AI 生视频** 只复用双栏交互语法和任务卡视觉，不继承常驻主结果、当前选中任务区或第三列历史栏。

### 3.3 Provider 复用边界

- Seedance 的共享实现目录是 `integrations/seedanceCLI`。
- HappyHorse 的现有共享实现目录实际名为 `integrations/bailianCLI`，CLI 命令名为 `bailian`；仓库中不存在同名的 `happyhorseCLI` 目录。
- 两个 Provider 的凭据设置已经存在：前端位于 `app/src/renderer/views/SettingsPage.vue:455-519`，后端配置位于 `core/config.py:22-37`。
- 当前后端 Provider 路由与函数带有 `bala-*` 领域命名。它们可作为实现参考，但不应直接视为通用 **AI 生视频** 的稳定产品契约。

### 3.4 任务与异步行为

- 当前视频任务仅保存在 `AiVideoWorkflow.vue` 的 localStorage 工作区快照中，未发现独立、通用的视频生成 job 表，相关代码位于 `AiVideoWorkflow.vue:1670-1780`。
- 当前后端即使收到 `wait=false`，仍会向 CLI 附加 `--download`；CLI 因下载动作进入等待，因此现状不是严格意义上的“创建后立即返回”。相关证据：
  - `core/api_server.py:6624-6633`
  - `integrations/seedanceCLI/bin/seedance.js:46-50`
  - `core/api_server.py:6820-6829`
  - `integrations/bailianCLI/bin/bailian.js:47-50`
- 新工作台已经批准采用严格异步任务体验：“创建任务”“轮询状态”“下载归档”必须拆开，并支持应用重启后的恢复。

## 4. HappyHorse 接口事实

以下内容来自 `/Users/xingyicheng/Downloads/HappyHorse接口文档与功能特性.md`。

### 4.1 模型与生成模式

| 模式 | 模型 ID | 输入结构 |
|---|---|---|
| 文生视频 | `happyhorse-1.1-t2v` | Prompt |
| 图生视频 | `happyhorse-1.1-i2v` | 1 张首帧图，Prompt 可选 |
| 参考生视频 | `happyhorse-1.1-r2v` | Prompt + 1-9 张参考图 |

来源：接口文档 `11-22`、`133-175`、`195-254`、`284-368`。

### 4.2 异步任务协议

- 创建请求必须包含请求头 `X-DashScope-Async: enable`。
- 创建成功后返回 `task_id`，客户端通过查询接口轮询任务状态。
- 状态包括 `PENDING`、`RUNNING`、`SUCCEEDED`、`FAILED`、`CANCELED`、`UNKNOWN`。
- 成功结果位于 `output.video_url`。
- 文档说明 `task_id` 查询有效期与视频下载 URL 通常约为 24 小时。

来源：接口文档 `65-114`。

### 4.3 公共参数

| 参数 | 类型 | 接口约束 |
|---|---|---|
| `resolution` | string | `720P`、`1080P`；文档默认 `1080P` |
| `duration` | integer | `3-15` 秒；文档默认 `5` 秒 |
| `watermark` | boolean | 文档默认 `true` |
| `seed` | integer | `0-2147483647` |

来源：接口文档 `159-175`、`226-254`、`320-343`。

### 4.4 文生视频 `happyhorse-1.1-t2v`

- Prompt 是核心文本输入。
- 可选画幅为：`16:9`、`9:16`、`1:1`、`4:3`、`3:4`、`4:5`、`5:4`、`9:21`、`21:9`。
- 可同时设置公共参数中的分辨率、时长、水印与随机种子。

来源：接口文档 `133-175`。

### 4.5 图生视频 `happyhorse-1.1-i2v`

- 必须输入且只能输入 1 张 `first_frame`。
- Prompt 可选。
- 不支持单独设置画幅比例，输出画幅跟随首帧图。
- 图片可使用公网 URL 或 Base64。
- 图片格式：JPEG、JPG、PNG、WEBP。
- 宽和高均不得小于 `300px`。
- 宽高比须位于 `1:2.5` 到 `2.5:1`。
- 单张图片不得超过 `20MB`。

来源：接口文档 `195-254`。

### 4.6 参考生视频 `happyhorse-1.1-r2v`

- Prompt 必填。
- 支持 `1-9` 张 `reference_image`。
- Prompt 通过 `[Image 1]`、`[Image 2]` 等标记引用图片，编号与 `media` 数组顺序一致。
- 参考图短边不得低于 `400px`。
- 单张图片不得超过 `20MB`。

来源：接口文档 `284-368`。

## 5. Seedance 接口事实

以下内容来自 `/Users/xingyicheng/Downloads/Seedance2.0接口文档与功能特性梳理.md`。

### 5.1 异步任务协议

- 创建任务：`POST /api/v3/contents/generations/tasks`。
- 查询任务：`GET /api/v3/contents/generations/tasks/{id}`。
- 状态包括 `queued`、`running`、`succeeded`、`failed`、`cancelled`、`expired`。
- 成功视频 URL 位于 `content.video_url`。
- 文档建议成功后立即下载，不把 Provider 临时 URL 当作长期资产地址。

来源：接口文档 `17-68`、`159-166`。

### 5.2 输入结构

`content` 是混合内容数组，文档列出的输入项包括：

| 输入 | 接口结构 | 文档用途 |
|---|---|---|
| 文本 | `type: "text"` | Prompt 与生成描述 |
| 图片 | `type: "image_url"`, `role: "reference_image"` | 人物、商品、场景、服装、风格等参考 |
| 视频 | `type: "video_url"`, `role: "reference_video"` | 动作、镜头、构图、节奏参考 |
| 音频 | `type: "audio_url"`, `role: "reference_audio"` | 音乐、音效、音色、节奏参考 |

- 图片可使用公网 URL。
- 用户提供的文档记录了 `data:image/...;base64,...` data URI 的实测用法。
- 视频和音频参考输入虽然是接口事实，但不属于本轮已批准的首版产品范围。

来源：接口文档 `72-113`。

### 5.3 参数

| 参数 | 文档描述 |
|---|---|
| `model` | 模型 ID |
| `content` | 文本、图片、视频、音频组成的混合输入数组 |
| `generate_audio` | 是否生成同步声音 |
| `ratio` | `16:9`、`9:16`、`1:1`、`3:4`、`4:3`、`21:9`、`adaptive` |
| `duration` | 文档描述支持约 `4-15` 秒 |
| `resolution` | 示例为 `480p`、`720p`、`1080p`，具体取决于模型与账号开通情况 |
| `watermark` | 是否添加水印 |
| `priority` | 任务优先级 |
| `tools` | 工具配置，例如联网搜索 |
| `safety_identifier` | 终端用户唯一标识，用于风控 |

来源：接口文档 `117-130`。

### 5.4 内容安全与文档实测结论

- 真人或儿童真人图片可能触发 `InputImageSensitiveContentDetected.PrivacyInformation`。
- 文档实测商品服装图可生成商品展示视频，也可生成原创童模试穿效果。
- 文档实测中，单款单图比多款多图更稳定。
- 这些是当前文档记录的实测现象，不代表对所有模型、账号或输入均有结果保证。

来源：接口文档 `227-260`、`298-308`。

## 6. Provider 能力差异

| 维度 | HappyHorse | Seedance |
|---|---|---|
| 模式表达 | 三个明确模型：T2V / I2V / R2V | 通过混合 `content` 表达文本和多模态参考 |
| 参考图 | I2V 固定 1 张首帧；R2V 1-9 张参考图 | 支持 `reference_image`，精确数量矩阵未在输入文档中列全 |
| Prompt | T2V、R2V 必填；I2V 可选 | 通过 `text` content 传入，输入文档未给出各模型必填矩阵 |
| 画幅 | T2V 有 9 种；I2V 跟随首帧 | 7 种，包括 `adaptive` |
| 时长 | 3-15 秒 | 文档描述约 4-15 秒，受模型能力影响 |
| 分辨率 | 720P、1080P | 文档示例 480p、720p、1080p，受模型与开通情况影响 |
| 同步声音 | 输入文档未列为公共参数 | `generate_audio` |
| 高级能力 | Seed、Watermark | Seedance 另有 Priority、Tools、Safety Identifier |
| 成功结果 | `output.video_url` | `content.video_url` |
| 任务状态 | 大写 DashScope 状态 | 小写 Ark 状态 |

## 7. 仍需实现时验证的接口边界

以下内容不改变第 2 节的已批准产品合同，但工程实现不能从接口文档中自行推断：

1. **Seedance 账号能力**：接口文档未给出模型、分辨率和输入限制的完整账号能力矩阵；首版 UI 仍固定为第 2.3 节的产品范围，adapter 接入时需验证当前账号是否支持。
2. **Seedance 素材限制**：接口文档未列全图片的完整格式、像素和大小限制；抓虾首版产品数量上限固定为 `0-4` 张，并使用通用图片校验与 Provider 返回的脱敏错误补足。
3. **HappyHorse 旧模型**：文档提到 1.0 旧模型，但首版只展示三个 `happyhorse-1.1-*` 模型，不暴露旧版。
4. **计费展示**：接口文档包含价格快照，但价格可能变化，普通 UI 不固化每秒价格。
5. **扩展能力**：批量生成、Prompt 库、视频编辑、自动发布、云端素材库、视频参考与音频参考不属于首版范围。
6. **隐藏参数**：`seed`、raw JSON、`priority`、`tools`、`safety_identifier`、密钥、endpoint、轮询和超时参数已经决定从普通 UI 隐藏，接口能力存在不构成后续默认暴露理由。

## 8. 实现建议

以下均为工程落地建议，不改变第 2 节已经批准的产品合同。

### 8.1 产品信息架构

- 通用 `/ai-video/*` 服务与现有 `bala-ai-video-*` 路由隔离，避免把巴拉业务语义带入 `AiVideoGenerationWorkbench.vue`。
- 使用一份模型配置注册表驱动可见字段、默认值、校验规则和 payload 映射，防止四套表单逐渐漂移。
- Renderer 只接收 Provider 的配置状态和脱敏摘要，不接收密钥、endpoint 或完整本地路径。

### 8.2 输入模式

- HappyHorse 使用明确模式：文生视频、首帧图生视频、参考图生视频。
- Seedance 首版以 Prompt + `0-4` 张参考图为主，视频、音频参考输入固定隐藏。
- 表单按模型动态显示：HappyHorse I2V 隐藏画幅并提示“跟随首帧”；R2V 提供图片顺序和 `[Image N]` 引用提示。
- 上传时在客户端先执行已知的格式、尺寸、比例、数量和大小校验，并在居中详情 modal 中保留脱敏后的 Provider 错误码与可读解释。

### 8.3 统一任务模型

- 在适配层把两套 Provider 状态映射为 `draft`、`queued`、`running`、`downloading`、`completed`、`needs_config`、`failed`、`cancelled`、`expired`。
- `ai_video_jobs`、`ai_video_assets`、`ai_video_runs` 的物理存储可映射到现有数据库或应用数据目录，但必须保持 Job 可编辑、Run 不可变和跨重启恢复的语义。
- 将“创建任务”“轮询任务”“下载结果”拆为独立操作，修正当前 `wait=false` 仍被 `--download` 阻塞的问题。
- Provider 完成后立即下载到本地受管目录，并让结果栏优先读取本地文件；远端 URL 只作为临时来源。

### 8.4 首版参数暴露

- 表单只展示已批准的模型、Prompt、参考图、画幅、时长、分辨率、同步声音、水印和输出目录。
- 仅在对应模型真实支持时显示控件；HappyHorse I2V 的 ratio 必须隐藏且不提交。
- Renderer 与普通请求 contract 均不提供 `seed`、raw JSON、`priority`、`tools` 或 `safety_identifier` 编辑字段；`safety_identifier` 只允许后端注入。
- UI 不展示写死的每秒价格，可在未来接入实时计费元数据后再设计费用提示。

### 8.5 失败与恢复

- 结果与队列的平铺卡片应持续更新排队、生成中、下载中、`completed / 已完成`、失败、取消和过期状态，而不是只显示一次请求结果；若该任务的详情 modal 已打开，modal 同步刷新但保持用户主动关闭。
- 失败态保留脱敏后的 Provider 错误码和可读解释，并提供 **重试**；已完成任务提供 **复制为新任务**。
- 对可能涉及真人隐私的 Seedance 参考图，在提交前显示简短风险提示；不要承诺绕过 Provider 的内容安全规则。
