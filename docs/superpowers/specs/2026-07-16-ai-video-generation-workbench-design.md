# AI 生视频工作台 Spec

日期：2026-07-16

## 结论

在抓虾新增一级菜单入口 `AI 生视频`，固定放在 `AI 生图` 和 `AI 视频工作流` 之间。现有面向巴拉五步链路的 `AI 视频` 入口必须改名为 `AI 视频工作流`，避免和新的通用生视频工作台混淆。最终一级菜单顺序固定为：

```text
AI 生图
AI 生视频
AI 视频工作流
```

`AI 生视频` 是一个通用、纯粹的“输入 Prompt + 参考图 -> 生成一个视频 -> 轮询 -> 下载归档”的工作台。页面布局参考现有 `AI 生图`：桌面端左侧为输入与参数栏，右侧为同级平铺任务卡片组成的结果与队列；窄屏切换为 `输入与参数 / 结果与队列` 两个 tab。右栏没有常驻主预览或当前选中任务区，点击任务卡片后在统一的居中详情 modal 中查看预览与完整信息。历史记录只作为右侧队列的筛选和抽屉，不做第三列。

底层 provider 不重写模型 API。Seedance 复用 `integrations/seedanceCLI`；HappyHorse 复用百炼/HappyHorse CLI 能力，迁移后归入 `integrations/bailianCLI`。adapter 的 `create` 只负责创建远端任务并立即返回 provider task id，后台再通过 `get` 轮询和下载归档；禁止在 create 路径追加 `--download` 或调用 `wait`。

## 背景

抓虾已有两类相邻能力：

1. `AI 生图`：左输入、右结果的通用 AI 图片工作台心智已经稳定。
2. `AI 视频工作流`：面向巴拉业务的五步工作流，强调找图、AI 改图、审核、视频任务和下载成片。

本需求补齐第三类能力：不绑定巴拉找图和审核链路，不进入生意管家模板，不要求先跑素材准备，而是让用户用 Prompt、参考图和模型参数快速生成单条视频。它服务于快速打样、模型对比、Prompt 调试、素材实验和 provider adapter 验证。

## 目标

1. 新增一级菜单 `AI 生视频`。
2. 将现有 `AI 视频` 菜单改名为 `AI 视频工作流`。
3. 构建独立页面 `AiVideoGenerationWorkbench.vue`。
4. 首版支持四个模型模式：
   - `seedance-2.0`
   - `happyhorse-1.1-t2v`
   - `happyhorse-1.1-i2v`
   - `happyhorse-1.1-r2v`
5. 一次点击 `生成视频` 只创建一个视频 Job；多变体、多版本、多模型对比通过 `复制为新任务` 或失败后的 `重试` 创建新 Job。
6. 支持 Prompt、参考图、模型参数、任务队列、状态轮询、下载归档、失败恢复和重启恢复。
7. 统一前后端 contract、HTTP routes、IPC 映射和 provider adapter contract。
8. 用逻辑数据表 `ai_video_jobs`、`ai_video_assets`、`ai_video_runs` 承载数据；Job 可编辑，Run 不可变。
9. 所有密钥、endpoint、轮询间隔、超时、raw JSON、seed、priority、tools、safety_identifier 都不出现在普通 UI 中。
10. 用户选择的 provider 与模型是强约束：配置缺失、额度不足或模型未开通时进入 `needs_config` 或 `failed`，系统不得静默切换到其他 provider、其他 HappyHorse 模式或其他模型。

## 非目标

1. 不替代 `AI 视频工作流`。
2. 不接入生意管家模板、不复用 `qn_img2video_batch`。
3. 不做视频剪辑、字幕、配音编辑、OpenCut 嵌入和自动发布。
4. 不做云端多用户协作、权限分组和审批流。
5. 不把 Ark、DashScope、百炼 API key 写入源码、示例 payload、前端状态或普通日志。
6. 不在页面暴露 provider endpoint、WorkspaceId、CLI 绝对路径、轮询间隔、任务超时、临时下载 URL。
7. 不支持绕过平台隐私、安全或内容审核限制。
8. 不把真实付费 provider 调用纳入 CI、常规自动化测试或日常验收硬门槛。

## 命名与 IA

| 项 | 定义 |
| --- | --- |
| 一级菜单名 | `AI 生视频` |
| 固定菜单顺序 | `AI 生图 / AI 生视频 / AI 视频工作流` |
| 路由视图 | `ai_video_generation` |
| 页面组件 | `AiVideoGenerationWorkbench.vue` |
| 后端服务名 | `aiVideoGenerationService` |
| HTTP route prefix | `/ai-video` |
| IPC namespace | `ai-video:*` |
| 数据表 | `ai_video_jobs`、`ai_video_assets`、`ai_video_runs` |
| provider 统一名 | `seedance`、`happyhorse` |

导航要求：

1. `AI 生图` 保持现有入口。
2. `AI 生视频` 是通用视频生成工作台。
3. 原 `AI 视频` 必须改名为 `AI 视频工作流`，继续承载巴拉找图、AI 改图、审核、生视频、结果下载的完整业务流程。

## 页面布局

### 应用壳与组件归属

HTML 视觉锚点必须把抓虾左侧一级菜单一并画出，用来说明新入口在完整应用中的位置和内容区可用宽度。该侧栏只是视觉锚点中的应用壳上下文，生产实现仍由 `app/src/renderer/App.vue` 统一承载；`AiVideoGenerationWorkbench.vue` 只渲染工作台内容，禁止在页面组件内复制第二套导航。

`App.vue` 的目标结构：

1. `navItems` 在 `AI 生图` 后新增 `{ id: 'ai_video_generation', label: 'AI 生视频' }`。
2. 现有 `{ id: 'ai_video', label: 'AI 视频' }` 只改展示文案为 `AI 视频工作流`，内部 id 保持 `ai_video`，避免影响现有五步工作流状态。
3. `layout-ai-image` 的判定范围加入 `currentView === 'ai_video_generation'`，从而复用 AI 工作台的应用壳响应式规则。
4. 桌面应用壳侧栏展开宽度为 `168px`，收起宽度为 `56px`；工作台的 360-380px 左栏是在侧栏之外的内容区内部计算。
5. `760px` 以下沿用现有 AI 工作台规则，把一级菜单变为底部横向导航；页面内部仍使用 `输入与参数 / 结果与队列` tab。

视觉锚点中不得再在页面标题区重复绘制 `AI 生图 / AI 生视频 / AI 视频工作流` 三按钮导航；入口关系只由应用壳侧栏表达。

### 桌面端

适用宽度：`>= 1060px`。

| 区域 | 规则 |
| --- | --- |
| 左栏 | 宽度约 360-380px，承载模型、Prompt、参考图、参数、主按钮，内部独立滚动 |
| 右栏 | 只承载同级平铺任务卡片网格，覆盖当前队列、运行中任务、已完成结果和失败恢复 |
| 历史 | 作为右侧队列筛选和抽屉打开，不做第三列 |
| 主按钮 | 左栏底部固定，文案 `生成视频` |

桌面端不得出现三栏布局，也不得出现“上方大预览 / 当前选中任务详情 + 下方卡片”的 master-detail 布局。任务详情、视频播放器、完整 Prompt、参数、状态、归档信息和相关操作统一通过居中 modal 进入；历史、日志和脱敏 provider 摘要通过抽屉或弹层进入，raw JSON 不进入任何 UI。

### 窄屏端

适用宽度：`< 1060px`。

页面切换为两个 tab：

```text
输入与参数
结果与队列
```

规则：

1. 默认打开 `输入与参数`。
2. 创建 Job 后自动切换到 `结果与队列`。
3. 主按钮固定在 `输入与参数` tab 底部，但不得遮挡表单校验信息。
4. 任务卡片使用与桌面端相同的居中详情 modal；modal 支持 Escape、遮罩和关闭按钮关闭，并在关闭后把焦点交还触发卡片或 `查看详情` 按钮。
5. 历史记录仍是抽屉，不新增独立列。

### 结果卡片、详情与历史交互

1. 右侧队列支持按 `全部 / 排队 / 生成中 / 下载归档 / 已完成 / 待配置 / 失败 / 已取消 / 已过期` 筛选，筛选值严格映射 public normalized status。
2. 右栏只有一个同级平铺任务卡片网格，不维护常驻当前选中态，不显示主预览、详情 inspector 或上下分区。
3. 卡片列数固定为：宽屏 `>=1181px` 三列，中屏 `1060-1180px` 两列，移动与窄屏 `<1060px` 一列。
4. 整张任务卡片支持鼠标 click 和键盘 Enter / Space 打开同一个居中详情 modal；卡片内同时提供明确的 `查看详情` 操作。
5. 卡片内的 `重试`、`复制为新任务`、`重新归档`、`打开文件`、`日志` 等独立操作必须阻止卡片点击事件冒泡，执行自身动作时不得同时打开详情。
6. 排队、生成中、下载归档、已完成、待配置、失败、已取消和已过期等全部可见状态都可以打开详情；没有视频结果时，播放器区域显示对应阶段或错误占位，不伪造可播放内容。
7. 详情 modal 包含视频播放器或状态占位、完整 Prompt、模型与公开参数、normalized/provider 状态、归档信息、脱敏错误和当前状态允许的操作。
8. modal 支持关闭按钮、点击遮罩和 Escape 关闭；关闭后焦点回到原卡片或原 `查看详情` 按钮。首版不提供 `上一条 / 下一条` 任务切换。
9. 创建 Job 后，新任务卡片置于网格顶部；`<1060px` 时自动切到 `结果与队列` tab，但任何宽度下都不自动打开详情 modal。
10. 历史抽屉展示最近 Job，不复制常驻第三列；点击历史项时先关闭抽屉，再为该 Job 打开同一个详情 modal。
11. provider 未返回真实进度时只展示阶段和已等待时长，不显示虚构百分比；只有 provider 明确返回可验证进度时才显示百分比。

## 用户流程

### 创建单个视频

1. 用户进入 `AI 生视频`。
2. 选择模型，默认 `Seedance 2.0`。
3. 输入 Prompt。
4. 按模型要求添加参考图：
   - Seedance v1：0-4 张。
   - HappyHorse T2V：0 张。
   - HappyHorse I2V：必须 1 张首帧图。
   - HappyHorse R2V：必须 1-9 张参考图。
5. 设置 UI 可见参数：比例、时长、分辨率、水印、Seedance 音频开关。
6. 点击 `生成视频`。
7. 前端创建 1 个 `ai_video_jobs` 记录和 1 个不可变 `ai_video_runs` 记录，并把新任务卡片插入网格顶部；窄屏自动切到 `结果与队列`，但不自动打开详情 modal。
8. 后端调用 adapter `create`，远端创建成功后保存 provider task id。
9. 后台轮询 `get`，provider 完成后下载 MP4。
10. 本地 MP4 写入成功后 Job 状态变为 `completed`，网格卡片与已打开的该任务详情同步刷新。

### 变体与重试

1. 同一个点击不能创建多个视频。
2. 同 Prompt 多模型对比必须通过复制当前 Job 后再次点击生成。
3. 失败任务可 `重试`，重试会创建新的 Run；原 Run 保持不可变。
4. 已完成任务可 `复制为新任务`，复制后生成新的可编辑 Job 草稿，不复用 provider task id。
5. 模型不可用、凭据缺失或 provider 拒绝时保留用户当前选择，不得自动改投其他模型或 provider。

### 编辑规则

1. `draft`、`needs_config`、`failed`、`expired` 状态的 Job 可以编辑输入参数。
2. `queued`、`running`、`downloading` 状态的 Job 不可编辑输入参数。
3. `completed` 状态的 Job 不可直接编辑；只能复制为新任务。
4. Run 一旦创建不可修改；修正参数必须创建新 Run。

## 四模型参数矩阵

| 字段 | Seedance 2.0 | HappyHorse T2V | HappyHorse I2V | HappyHorse R2V |
| --- | --- | --- | --- | --- |
| provider | `seedance` | `happyhorse` | `happyhorse` | `happyhorse` |
| model | `doubao-seedance-2-0-260128` | `happyhorse-1.1-t2v` | `happyhorse-1.1-i2v` | `happyhorse-1.1-r2v` |
| Prompt | 必填 | 必填 | 产品侧必填 | 必填 |
| 图片数量 | 0-4 张 | 0 张 | 1 张 | 1-9 张 |
| 图片角色 | `reference_image` | 不适用 | `first_frame` | `reference_image` |
| 视频参考 | v1 UI 隐藏 | 不支持 | 不支持 | 不支持 |
| 音频参考 | v1 UI 隐藏 | 不支持 | 不支持 | 不支持 |
| 生成音频 | UI 可见，默认开 | 不支持 | 不支持 | 不支持 |
| ratio | 默认 `9:16` | 默认 `16:9` | UI 隐藏且不提交 | 默认 `9:16` |
| resolution | 默认 `720p` | 默认 `720P` | 默认 `720P` | 默认 `720P` |
| duration | 默认 5 秒 | 默认 5 秒 | 默认 5 秒 | 默认 5 秒 |
| watermark | 默认关 | 默认关 | 默认关 | 默认关 |
| seed | UI 隐藏，不提交 | UI 隐藏，不提交 | UI 隐藏，不提交 | UI 隐藏，不提交 |
| raw JSON | UI 隐藏 | UI 隐藏 | UI 隐藏 | UI 隐藏 |
| priority | UI 隐藏，不提交 | 不支持 | 不支持 | 不支持 |
| tools | UI 隐藏，不提交 | 不支持 | 不支持 | 不支持 |
| safety_identifier | 后端注入 | 不支持 | 不支持 | 不支持 |

Seedance ratio 枚举：

```text
16:9, 9:16, 1:1, 3:4, 4:3, 21:9, adaptive
```

HappyHorse ratio 枚举：

```text
16:9, 9:16, 1:1, 4:3, 3:4, 4:5, 5:4, 9:21, 21:9
```

## UI 可见参数

| 参数 | Seedance | HappyHorse T2V | HappyHorse I2V | HappyHorse R2V |
| --- | --- | --- | --- | --- |
| 模型 | 可见 | 可见 | 可见 | 可见 |
| Prompt | 可见 | 可见 | 可见 | 可见 |
| 参考图 | 可见，0-4 | 隐藏 | 可见，1 张 | 可见，1-9 |
| ratio | 可见 | 可见 | 隐藏 | 可见 |
| resolution | 可见 | 可见 | 可见 | 可见 |
| duration | 可见 | 可见 | 可见 | 可见 |
| generate_audio | 可见，默认开 | 隐藏 | 隐藏 | 隐藏 |
| watermark | 可见，默认关 | 可见，默认关 | 可见，默认关 | 可见，默认关 |
| 输出目录 | 可见，用系统文件夹选择器 | 可见 | 可见 | 可见 |

UI 必须隐藏：

```text
seed
raw JSON
priority
tools
safety_identifier
API key
endpoint
WorkspaceId
poll interval
timeout
provider video URL
CLI path
```

`safety_identifier` 由后端按安装实例或本地用户生成稳定 hash，并只进入 Seedance payload。前端不展示、不编辑、不记录明文。

## 默认值

| 模型 | 默认 ratio | 默认 resolution | 默认 duration | 默认 audio | 默认 watermark |
| --- | --- | --- | ---: | --- | --- |
| Seedance 2.0 | `9:16` | `720p` | 5 | 开 | 关 |
| HappyHorse T2V | `16:9` | `720P` | 5 | 不支持 | 关 |
| HappyHorse I2V | 不提交 | `720P` | 5 | 不支持 | 关 |
| HappyHorse R2V | `9:16` | `720P` | 5 | 不支持 | 关 |

其他默认：

| 字段 | 默认值 |
| --- | --- |
| 默认模型 | `seedance-2.0` |
| output_dir | `~/Downloads/抓虾AI生视频`，后端展开为绝对路径 |
| Job title | Prompt 前 24 个可见字符 + 创建时间 |
| 历史筛选 | 默认显示最近 50 个 Job |

## 验证规则

通用规则：

1. Prompt 去除首尾空白后不能为空。
2. Prompt 产品侧最大 4000 字符，超过时禁止提交。
3. 图片格式仅允许 JPEG、JPG、PNG、WEBP。
4. 单图大小不超过 20MB。
5. 输出目录必须由系统文件夹选择器授权。
6. 本地归档只能写入授权目录或该目录下的任务归档子目录。
7. 一次 `生成视频` 请求只能包含一个 Job。

Seedance 规则：

1. 抓虾 v1 图片数量为 0-4 张。
2. `duration` 必须是 4-15 的整数。
3. `ratio` 必须属于 Seedance 枚举。
4. `generate_audio` 默认 `true`，用户可关闭。
5. 疑似真人或儿童真人脸被 provider 拦截时，不提供绕过入口；展示改用商品图和原创人物描述的安全重试建议。

HappyHorse T2V 规则：

1. 不允许携带图片。
2. `duration` 必须是 3-15 的整数。
3. `ratio` 必须属于 HappyHorse 枚举，默认 `16:9`。

HappyHorse I2V 规则：

1. 必须且只能 1 张图片。
2. 图片宽高均不小于 300px。
3. 宽高比必须在 `1:2.5` 到 `2.5:1` 之间。
4. 不允许提交 `ratio`。

HappyHorse R2V 规则：

1. 必须 1-9 张图片。
2. 每张图片短边不低于 400px。
3. Prompt 中建议包含 `[Image 1]`、`[Image 2]` 等引用；未引用时允许提交，但必须展示弱提示。
4. `ratio` 必须属于 HappyHorse 枚举，默认 `9:16`。

## 数据模型

数据使用逻辑表名描述，具体落地可映射到 SQLite、JSONL 或现有任务数据库。无论物理存储如何，业务语义必须保持一致。

### `ai_video_jobs`

Job 是用户可见、可复制、可编辑的工作台记录。

```ts
type AiVideoPublicStatus =
  | 'draft'
  | 'queued'
  | 'running'
  | 'downloading'
  | 'completed'
  | 'needs_config'
  | 'failed'
  | 'cancelled'
  | 'expired';

interface AiVideoJob {
  id: string;
  requestUid: string;
  title: string;
  status: AiVideoPublicStatus;
  provider: 'seedance' | 'happyhorse';
  model: 'doubao-seedance-2-0-260128' | 'happyhorse-1.1-t2v' | 'happyhorse-1.1-i2v' | 'happyhorse-1.1-r2v';
  prompt: string;
  parameters: AiVideoPublicParameters;
  currentRunId?: string;
  outputDir: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}
```

### `ai_video_assets`

Asset 是 Job 引用的输入素材。Job 编辑时可以增删素材；已创建 Run 的素材快照不能被修改。

```ts
interface AiVideoAsset {
  id: string;
  jobId: string;
  kind: 'image';
  role: 'reference_image' | 'first_frame';
  sourceType: 'local_file' | 'asset_library' | 'remote_url';
  originalName: string;
  localPath?: string;
  remoteUrl?: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
  sortOrder: number;
  createdAt: string;
}
```

`requestUid` 在 `ai_video_jobs` 上具有唯一约束，用于吸收双击、IPC 重试和 HTTP 超时重试。相同 `requestUid` 的重复创建请求返回第一次创建的同一个 Job/Run，不得再次调用 provider。

### `ai_video_runs`

Run 是一次不可变执行记录。任何提交到 provider 的动作都必须先写 Run，再调用 adapter。Run 创建后不得修改输入快照，只能追加状态、provider task id、日志和输出信息。

```ts
interface AiVideoRun {
  id: string;
  requestUid: string;
  jobId: string;
  status: AiVideoPublicStatus;
  provider: 'seedance' | 'happyhorse';
  model: string;
  inputSnapshot: {
    prompt: string;
    assets: AiVideoAsset[];
    parameters: AiVideoPublicParameters;
  };
  providerTaskId?: string;
  providerStatus?: string;
  archiveStatus: 'none' | 'pending_archive' | 'archived' | 'archive_failed';
  output?: AiVideoOutput;
  error?: AiVideoError;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  completedAt?: string;
}
```

### Public Parameters

```ts
interface AiVideoPublicParameters {
  ratio?: string;
  resolution: '480p' | '720p' | '1080p' | '720P' | '1080P';
  duration: number;
  watermark: boolean;
  generateAudio?: boolean;
}
```

### Output

```ts
interface AiVideoOutput {
  localVideoPath?: string;
  localPosterPath?: string;
  archiveDir: string;
  fileName?: string;
  sizeBytes?: number;
  durationSeconds?: number;
  usage?: Record<string, string | number | boolean>;
}
```

### Error

```ts
interface AiVideoError {
  code: string;
  message: string;
  providerCode?: string;
  providerMessage?: string;
  retryable: boolean;
  safeSuggestion: string;
  occurredAt: string;
}
```

## HTTP Routes 与 IPC 映射

后端能力统一抽象为 generic `/ai-video/*` routes。Electron renderer 默认走 IPC，IPC handler 内部调用同一服务层；如果未来暴露 HTTP，本 contract 保持一致。

| HTTP route | IPC channel | 用途 |
| --- | --- | --- |
| `GET /ai-video/config` | `ai-video:get-config` | 读取 provider、模型、默认值、凭据配置状态 |
| `POST /ai-video/validate` | `ai-video:validate` | 校验当前输入，不创建 Job |
| `POST /ai-video/jobs` | `ai-video:create-job` | 创建 1 个 Job 和 1 个 Run，并排队提交 |
| `GET /ai-video/jobs` | `ai-video:list-jobs` | 列出 Job，支持状态、provider、时间筛选 |
| `GET /ai-video/jobs/:jobId` | `ai-video:get-job` | 读取 Job、assets、runs 汇总 |
| `PATCH /ai-video/jobs/:jobId` | `ai-video:update-job` | 仅允许编辑可编辑状态的 Job |
| `POST /ai-video/jobs/:jobId/duplicate` | `ai-video:duplicate-job` | 复制为新 Job 草稿 |
| `POST /ai-video/jobs/:jobId/retry` | `ai-video:retry-job` | 基于当前 Job 创建新 Run |
| `DELETE /ai-video/jobs/:jobId` | `ai-video:delete-job-record` | 删除/隐藏记录，不默认删除用户 MP4 |
| `GET /ai-video/runs/:runId` | `ai-video:get-run` | 读取不可变 Run 详情 |
| `POST /ai-video/runs/:runId/archive` | `ai-video:retry-archive` | provider 已成功但归档失败时重新下载 |
| `GET /ai-video/events` | `ai-video:subscribe-events` | 订阅任务事件；Electron 可用 event emitter 实现 |

所有响应统一 envelope：

```ts
type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: string; message: string; detail?: string } };
```

关键请求：

```ts
interface AiVideoAssetInput {
  role: 'reference_image' | 'first_frame';
  sourceType: 'local_file' | 'asset_library' | 'remote_url';
  fileToken?: string;
  assetLibraryId?: string;
  remoteUrl?: string;
  sortOrder: number;
}

interface CreateAiVideoJobRequest {
  requestUid: string;
  provider: 'seedance' | 'happyhorse';
  model: string;
  prompt: string;
  assets: AiVideoAssetInput[];
  parameters: AiVideoPublicParameters;
  outputDir: string;
}

interface CreateAiVideoJobResponse {
  job: AiVideoJob;
  run: AiVideoRun;
}

interface RetryAiVideoJobRequest {
  requestUid: string;
}

interface RetryArchiveResponse {
  job: AiVideoJob;
  run: AiVideoRun;
}
```

创建事务要求：

1. 系统文件选择器返回受控 `fileToken`，renderer 不直接拼任意绝对路径。
2. `POST /ai-video/jobs` 在一个本地事务内写入 Job、Assets 与首个 Run 的输入快照，提交事务后才允许 worker 调用 provider。
3. Job 更新请求可替换尚未执行的素材集合；已有 Run 的 `inputSnapshot.assets` 不随 Job 编辑变化。
4. `requestUid` 必填并唯一；初次创建时同时写入 Job 与首 Run，重复请求只读回既有 Job/Run，实现本地创建幂等。
5. `POST /ai-video/jobs/:jobId/retry` 使用新的 Run `requestUid`；同一重试请求被重复投递时只返回既有 Run，不得再次调用 provider。

## Provider Adapter Contract

### 统一接口

```ts
interface AiVideoProviderAdapter {
  id: 'seedance' | 'happyhorse';
  validate(input: NormalizedAiVideoInput): Promise<ValidationResult>;
  buildPayload(input: NormalizedAiVideoInput): Promise<ProviderPayload>;
  create(payload: ProviderPayload, context: ProviderExecutionContext): Promise<ProviderCreateResult>;
  get(providerTaskId: string, context: ProviderExecutionContext): Promise<ProviderTaskSnapshot>;
  download(snapshot: ProviderTaskSnapshot, targetPath: string, context: ProviderExecutionContext): Promise<ProviderDownloadResult>;
}

interface ProviderCreateResult {
  providerTaskId: string;
  rawStatus?: string;
  redactedResponse: unknown;
}
```

硬性规则：

1. `create` 必须只创建远端任务并立即返回 provider task id。
2. `create` 路径禁止调用 `wait`。
3. `create` 路径禁止追加 `--download`。
4. provider task id 保存成功后，Job 才能从本地 `queued` 进入 `running`。
5. 轮询只能由后台 worker 调用 `get` 完成。
6. provider 成功后才能进入 `downloading` 并调用 `download`。
7. unknown submit result 不能自动重复提交，必须进入 `failed`，提示用户人工确认后复制或重试。
8. adapter 不得根据错误或配置状态改写 `provider` / `model`；任何降级或换模都必须由用户明确重新选择并创建新 Job。

### Seedance Adapter

边界：

1. 不在抓虾内重写 Ark API。
2. `create` 使用 `npm --prefix integrations/seedanceCLI run seedance -- create <payload.json>`。
3. `get` 使用 `npm --prefix integrations/seedanceCLI run seedance -- get <providerTaskId>`。
4. `download` 使用 provider 成功快照中的视频 URL 下载到归档路径；下载动作不在 create 命令内发生。
5. 运行 CLI 时只注入从 `设置 -> AI 能力` 读取到的 `ARK_API_KEY` 和必要环境，不继承 shell 中同名凭据。

Seedance payload 映射：

```json
{
  "model": "doubao-seedance-2-0-260128",
  "content": [
    { "type": "text", "text": "<prompt>" },
    {
      "type": "image_url",
      "image_url": { "url": "<url-or-data-uri>" },
      "role": "reference_image"
    }
  ],
  "generate_audio": true,
  "ratio": "9:16",
  "duration": 5,
  "resolution": "720p",
  "watermark": false,
  "safety_identifier": "<backend-injected-hash>"
}
```

### HappyHorse Adapter

边界：

1. 不在抓虾内直接拼 DashScope HTTP 请求。
2. 使用迁移后的 `integrations/bailianCLI`。
3. `create` 使用 `npm --prefix integrations/bailianCLI run bailian -- create <payload.json>`。
4. `get` 使用 `npm --prefix integrations/bailianCLI run bailian -- get <providerTaskId>`。
5. `download` 使用 provider 成功快照中的 `output.video_url` 下载到归档路径；下载动作不在 create 命令内发生。
6. 运行 CLI 时只注入从 `设置 -> AI 能力` 读取到的 `DASHSCOPE_API_KEY`、`BAILIAN_REGION`、`BAILIAN_WORKSPACE_ID` 或 `BAILIAN_BASE_URL`。
7. `X-DashScope-Async: enable` 由 CLI adapter 保证，工作台不暴露该参数。

HappyHorse T2V payload：

```json
{
  "model": "happyhorse-1.1-t2v",
  "input": { "prompt": "<prompt>" },
  "parameters": {
    "resolution": "720P",
    "ratio": "16:9",
    "duration": 5,
    "watermark": false
  }
}
```

HappyHorse I2V payload：

```json
{
  "model": "happyhorse-1.1-i2v",
  "input": {
    "prompt": "<prompt>",
    "media": [
      { "type": "first_frame", "url": "<url-or-base64>" }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "duration": 5,
    "watermark": false
  }
}
```

HappyHorse R2V payload：

```json
{
  "model": "happyhorse-1.1-r2v",
  "input": {
    "prompt": "<prompt-with-image-references>",
    "media": [
      { "type": "reference_image", "url": "<url-or-base64>" }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "ratio": "9:16",
    "duration": 5,
    "watermark": false
  }
}
```

## 异步状态机

对外 public normalized 状态固定为：

```text
draft
queued
running
downloading
completed
needs_config
failed
cancelled
expired
```

状态转换：

```text
draft -> queued
needs_config -> draft
queued -> running
running -> downloading
downloading -> completed
queued -> cancelled
queued -> needs_config
queued -> failed
running -> failed
running -> expired
downloading -> failed
failed -> queued 创建新 Run；旧 Run 保持 failed
expired -> draft 通过复制创建新 Job；旧 Job/Run 保持 expired
completed -> draft 通过复制创建新 Job；旧 Job/Run 保持 completed
```

provider 状态映射：

| public 状态 | Seedance | HappyHorse |
| --- | --- | --- |
| `queued` | create 尚未调用或等待提交 | create 尚未调用或等待提交 |
| `running` | `queued` / `running` | `PENDING` / `RUNNING` |
| `downloading` | `succeeded` 且本地归档未完成 | `SUCCEEDED` 且本地归档未完成 |
| `completed` | 本地 MP4 已写入成功 | 本地 MP4 已写入成功 |
| `failed` | `failed` 或 unknown submit result | `FAILED` 或 unknown submit result |
| `cancelled` | 本地 queued 未提交时用户取消，或 provider 明确返回 cancelled | 本地 queued 未提交时用户取消，或 provider 明确返回 CANCELED |
| `expired` | `expired` 或超过恢复窗口 | `UNKNOWN` 且超过恢复窗口 |

轮询规则：

1. 轮询间隔、超时、并发限制由后端配置，UI 隐藏。
2. provider 提交成功并保存 task id 后，后台 worker 周期性调用 adapter `get`。
3. provider 成功但下载失败时，Run 状态为 `failed`，`archiveStatus` 为 `archive_failed`，UI 显示 `待归档`，提供 `重新归档`。
4. 只有本地 MP4 成功写入并完成原子 rename，Job 才能进入 `completed`。
5. 已提交或运行中的 provider 任务不能在 UI 中假装取消；如 provider 没有取消能力，只能展示运行中并允许复制为新任务。
6. provider 没有返回进度字段时，worker 不推导、不估算、不按轮询次数生成百分比。

## 重启恢复

持久化位置：

| 内容 | 位置 |
| --- | --- |
| Job / Asset / Run | 现有任务数据库或应用数据目录下 `ai-video-generation/*.jsonl` |
| 任务归档目录 | `<outputRoot>/<yyyy-mm-dd>/<jobId>/<runId>/` |
| 规范化请求 | `request.normalized.json` |
| 脱敏 provider 请求 | `request.provider.redacted.json` |
| 脱敏 provider 响应 | `response.provider.redacted.json` |
| 日志 | `events.jsonl` |
| 输出视频 | `output.mp4` |
| 封面 | `poster.jpg` |

恢复规则：

1. 重启后只凭已保存的 provider task id 恢复远端任务。
2. 已有 provider task id 的 Run 调用 adapter `get` 查询状态。
3. provider 已成功但本地 MP4 不存在时，进入 `downloading` 并执行归档。
4. provider 已成功但下载失败时，UI 显示 `待归档`，用户可点 `重新归档`。
5. 没有 provider task id 的 `queued` Run 可以继续提交，因为还没有远端副作用。
6. 没有 provider task id 但已经进入提交中的未知结果，必须标记 `failed`，错误码 `UNKNOWN_SUBMIT_RESULT`。
7. unknown submit result 绝不自动重复提交，避免重复扣费和重复生成。
8. 超过 provider 查询有效期且无法确认结果的 Run 标记 `expired`，保留复制为新任务入口。
9. 恢复动作必须写入 `events.jsonl`。

## 下载归档

默认归档根目录为 `~/Downloads/抓虾AI生视频`。文件命名：

```text
<createdAt>-<provider>-<modelShort>-<jobIdShort>-<runIdShort>.mp4
```

归档目录结构：

```text
抓虾AI生视频/
  2026-07-16/
    avj_20260716_143022_x7k9/
      avr_20260716_143030_m2q8/
        request.normalized.json
        request.provider.redacted.json
        response.provider.redacted.json
        events.jsonl
        input/
          image-01.jpg
        output.mp4
        poster.jpg
```

下载规则：

1. provider 视频 URL 有效期短，成功后立即归档。
2. 下载写入临时文件 `output.mp4.part`，完成校验后原子 rename。
3. 已存在完整 `output.mp4` 时不重复下载，除非用户点 `重新归档`。
4. 下载失败不删除已有成功文件。
5. provider 成功但下载失败时，UI 文案为 `待归档`，主操作为 `重新归档`。
6. 前端普通视图只展示文件名、任务目录按钮和状态，不展示完整个人路径。

## 删除、取消与记录保留

1. `draft`、`needs_config`、`failed`、`expired`、`completed` 的 Job 可以删除记录。
2. `queued` 且尚未调用 provider create 的 Job 可以取消并标记 `cancelled`。
3. provider 已提交、已保存 task id、运行中或下载中的 Job 不允许删除记录，不提供取消按钮。
4. 如果 provider 自身返回 cancelled，Job 可映射为 `cancelled`，但 UI 不能声称用户主动取消了远端任务。
5. 删除记录默认只隐藏或软删除 Job / Run 记录，不删除用户 MP4。
6. 如果后续提供删除本地 MP4 的能力，必须单独按钮、二次确认，并限制在任务归档目录内。

## 错误、安全与脱敏

错误分类：

| code | 场景 | 用户文案 |
| --- | --- | --- |
| `VALIDATION_FAILED` | 输入不满足模型要求 | 按提示修改 Prompt、图片或参数后重新提交 |
| `CREDENTIAL_MISSING` | provider 凭据未配置 | 到设置中的 AI 能力配置对应密钥 |
| `NEEDS_CONFIG` | provider 未启用或缺少必要配置 | 配置后可继续提交当前 Job |
| `UNKNOWN_SUBMIT_RESULT` | create 过程退出前未保存 provider task id | 为避免重复扣费，本次不会自动重提；请确认后复制为新任务 |
| `PROVIDER_REJECTED` | provider 拒绝请求 | 查看原因后调整素材或 Prompt |
| `PRIVACY_BLOCKED` | 真人/儿童真人脸等隐私拦截 | 不绕过平台保护，可改用商品图和原创人物描述重试 |
| `PROVIDER_TIMEOUT` | 长时间未完成 | 可稍后恢复查询或复制为新任务 |
| `DOWNLOAD_FAILED` | provider 成功但本地归档失败 | 当前视频待归档，可点击重新归档 |
| `ARCHIVE_WRITE_FAILED` | 本地目录不可写 | 重新选择有写入权限的输出目录 |

Seedance 错误映射：

| provider code | 本地 code | 恢复建议 |
| --- | --- | --- |
| `ModelNotOpen` | `NEEDS_CONFIG` | 保留 Seedance 选择，提示到设置或方舟控制台开通；不自动换模型 |
| `SetLimitExceeded` | `PROVIDER_REJECTED` | 展示额度或推理限制事实，稍后重试；不伪装为网络错误 |
| `InputImageSensitiveContentDetected.PrivacyInformation` | `PRIVACY_BLOCKED` | 改用商品图和原创虚构人物描述，不提供绕过入口 |
| `OutputVideoSensitiveContentDetected.PolicyViolation` | `PROVIDER_REJECTED` | 展示输出策略拦截，建议调整 Prompt 或素材 |

HappyHorse 文档未给出完整错误码表。adapter 必须保存经脱敏的真实 `code/message`，UI 以“百炼返回失败 + 原始错误摘要”展示；不得虚构审核类别或错误解释。

安全规则：

1. API key 只存在主进程内存和系统设置存储，不下发 renderer。
2. CLI stdout/stderr 入库前必须脱敏 `Authorization`、`ARK_API_KEY`、`DASHSCOPE_API_KEY`、签名 URL query、个人 home 路径。
3. raw provider request / response 不进入任何 UI；调试抽屉只展示脱敏摘要、状态事件和可读错误。
4. provider video URL 原文只用于归档流程，不进入前端普通状态。
5. 所有本地文件读取必须限制在用户选择的文件或授权目录内。
6. 归档写入禁止跟随符号链接跳出授权目录。
7. 失败日志默认展示摘要；完整日志只在调试抽屉展示，且仍为脱敏文本。

## 前端验收标准

1. 一级菜单顺序固定为 `AI 生图 / AI 生视频 / AI 视频工作流`。
2. 桌面端左栏宽度约 360-380px，右栏只有同级平铺任务卡片网格；没有第三列、常驻主预览、当前选中任务详情区或上下分区。
3. 卡片网格在 `>=1181px` 为三列、`1060-1180px` 为两列、`<1060px` 为一列。
4. `<1060px` 时页面切为 `输入与参数 / 结果与队列` tabs。
5. 整卡 click、Enter、Space 和卡内 `查看详情` 都打开同一个居中详情 modal；内部独立操作不会冒泡触发详情。
6. modal 展示播放器或状态占位、完整 Prompt、公开参数、状态、归档与允许的操作；不展示 raw JSON 或敏感配置。
7. 排队、生成中、下载归档、已完成、待配置、失败、已取消和已过期任务都能打开详情。
8. modal 可通过关闭按钮、遮罩和 Escape 关闭，并把焦点交还原触发点；首版没有上一条或下一条。
9. 创建任务后新卡片置顶，窄屏切到 `结果与队列`，但不自动打开 modal。
10. 历史记录通过抽屉进入；点击历史项先关闭抽屉，再打开同一个任务详情 modal。
11. 默认模型为 Seedance 2.0，默认参数为 9:16、720p、5 秒、音频开、水印关。
12. 切换到 HappyHorse T2V 后，默认 720P、5 秒、16:9、水印关。
13. 切换到 HappyHorse I2V 后，ratio 控件隐藏，必须 1 张图。
14. 切换到 HappyHorse R2V 后，默认 720P、5 秒、9:16、水印关，允许 1-9 张图。
15. UI 不展示 seed、raw JSON、priority、tools、safety_identifier、key、endpoint、poll、timeout。
16. 点击一次 `生成视频` 只创建一个 Job。
17. 失败任务可复制为新任务；已完成任务可复制为新任务。
18. provider 成功但下载失败时，任务卡和详情 modal 显示 `待归档` 和 `重新归档`。
19. provider 已提交或运行时，没有删除和假取消入口。
20. provider 没有真实进度时，所有运行态都只显示阶段文案和已等待时长，不显示百分比。
21. 缺少凭据或模型未开通时保留原 provider/model 并给出恢复入口，不发生静默换模。

## 后端验收标准

1. `GET /ai-video/config` 与 `ai-video:get-config` 返回一致数据。
2. `POST /ai-video/validate` 与 `ai-video:validate` 对四模型执行一致校验。
3. `POST /ai-video/jobs` 一次只创建一个 Job 和一个 Run。
4. `POST /ai-video/jobs` 原子写入 Job、Assets、Run；相同 `requestUid` 重放时返回既有记录且不二次提交 provider。
5. `ai_video_jobs` 可编辑，`ai_video_runs` 输入快照不可变。
6. adapter `create` 只返回 provider task id，不调用 wait，不下载。
7. 后台 worker 只通过已保存 provider task id 调用 `get` 恢复和轮询。
8. unknown submit result 不自动重复提交。
9. provider 成功但归档失败时，Run 保留 provider task id，并允许 `retry-archive`。
10. provider 已提交或运行中的 Job 不允许删除记录或本地伪取消。
11. 删除记录默认不删除用户 MP4。
12. 日志中不出现 API key、Bearer token、完整签名 URL 和未脱敏 home path。
13. adapter 不静默切换 provider/model，不伪造进度百分比。

## 测试计划

单元测试：

1. 四模型参数 schema 校验。
2. 模型切换时隐藏字段从 public payload 中移除。
3. UI hidden 字段不可从 renderer request 注入：seed、raw JSON、priority、tools、safety_identifier、key、endpoint、poll、timeout。
4. Seedance v1 图片数量限制为 0-4。
5. HappyHorse I2V 禁止 ratio。
6. public normalized 状态只允许 `draft, queued, running, downloading, completed, needs_config, failed, cancelled, expired`。
7. Job 编辑权限和 Run 不可变约束。
8. 脱敏函数覆盖 token、URL query、home path。
9. 相同初次创建 `requestUid` 重放只产生一个 Job、一个首 Run 和一次 provider create；相同重试 `requestUid` 重放只产生一个新 Run 和一次 provider create。

集成测试：

1. mock Seedance CLI：create 立即返回 task id，后台 get running，再 get succeeded，再 download。
2. mock HappyHorse CLI：create 立即返回 task id，后台 get PENDING/RUNNING，再 get SUCCEEDED，再 download。
3. create 命令参数断言不包含 `--download`，不调用 wait。
4. unknown submit result 标记 `failed`，不自动重提。
5. 重启恢复只使用已保存 provider task id；无 task id 的未知提交结果不重提。
6. provider 成功但下载 403，Job 显示待归档，`retry-archive` 成功后进入 completed。
7. provider 已提交或运行时，删除记录接口返回阻断错误。
8. 删除 completed Job 记录默认不删除用户 MP4。
9. 输出目录无权限时返回 `ARCHIVE_WRITE_FAILED`。
10. provider 配置缺失或模型未开通时不发生 fallback，Job 保留原 provider/model。

前端组件测试：

1. 菜单顺序和 `AI 视频工作流` 改名正确。
2. `<1060px` tabs 切换正确。
3. 桌面端无第三列，历史抽屉可打开和关闭。
4. 点击一次 `生成视频` 只发起一次 create-job 请求。
5. 待归档任务显示 `重新归档`。
6. provider 运行中任务不显示删除和取消按钮。

手工冒烟：

真实付费 provider 生成只作为发布前手工冒烟，不属于 CI、日常自动化测试或常规验收硬门槛。执行条件必须同时满足：

1. 用户明确授权本次真实调用。
2. 对应 provider 凭据已在设置中配置。
3. 操作人员确认本次调用会产生费用或消耗额度。
4. 冒烟范围每个 provider 只跑最小可证明链路。

建议发布前冒烟：

1. Seedance 文生视频生成 1 条 5 秒 720p MP4 并归档。
2. HappyHorse T2V 生成 1 条 5 秒 720P MP4 并归档。
3. HappyHorse I2V 使用 1 张首帧图生成，payload 不含 ratio。
4. HappyHorse R2V 使用 2 张参考图生成，Prompt 使用 `[Image 1]`、`[Image 2]`。

## 迁移与复用边界

复用：

1. 复用 `AI 生图` 的双栏工作台布局、Prompt 输入习惯、上传控件和任务卡视觉；结果区改用本 Spec 固定的纯平铺卡片网格与统一详情 modal，不复用常驻主结果预览模式。
2. 复用 `integrations/seedanceCLI`，不在页面或后端重复实现 Ark API。
3. 复用 HappyHorse/Bailian CLI 能力，迁移为 `integrations/bailianCLI` 后统一由 adapter 调用。
4. 复用设置页的 AI 能力凭据来源；工作台只读配置状态。
5. 复用已有任务日志和本地归档目录选择能力。

隔离：

1. 不复用 `AI 视频工作流` 的找图、AI 改图、审核池、生意管家模板和 `qn_img2video_batch`。
2. 不让通用 `AI 生视频` Job 污染巴拉视频任务数据结构。
3. 不把 provider adapter 绑定到任一具体业务适配器目录。
4. 不把个人本地路径写死在生产代码；文档中的本机路径只作为迁移来源说明。
5. 不把 HappyHorse 文档中的旧版 `happyhorse-1.0-*` 暴露给首版 UI。

## 可执行验收命令

实现完成后至少执行：

```bash
npm --prefix integrations/seedanceCLI test
npm run test -- ai-video-generation
npm run vite:build
git diff --check
```

如果新增 `integrations/bailianCLI` 测试脚本，则同步执行：

```bash
npm --prefix integrations/bailianCLI test
```

验收通过条件：

1. 上述命令全部通过。
2. 四模型 mock 集成测试全部通过。
3. 本地运行应用后能打开 `AI 生视频`，完成 mock Job 创建、卡片置顶但不自动开 modal、mock provider task id 返回、后台 mock get 轮询、mock 下载归档，以及通过整卡 click / Enter / Space 打开并关闭任务详情 modal。
4. 脱敏快照中没有 API key、Bearer token、完整签名 URL 和未脱敏 home path。
5. 真实付费 provider 调用没有出现在 CI、常规自动化测试和默认验收命令中。
