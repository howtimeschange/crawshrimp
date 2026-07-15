# 巴拉 AI 视频工作流固定入口与前端设计

日期：2026-07-15

## 结论

新增抓虾一级菜单：`AI 视频`，放在 `AI 生图` 下方。这个入口不是新的黑盒脚本，也不替代现有原子能力，而是在前端串联已经落地的 `semir_video_material_prepare`、`bala_ai_face_background_generate`、`qn_img2video_batch`，并在生视频阶段接入软件管家、Seedance 和百炼 HappyHorse 三类 provider，给业务一个从找图到 AI 改图、审核、选模板/选模型、生视频、下载回显的分步工作流体验。

本入口只显示工作流界面，不显示通用脚本参数表。原来的 `巴拉 AI 视频助手` 适配器和原子脚本仍保留，方便单独调试、重跑和排障。

## 产品边界

### 本期目标

1. 在抓虾一级菜单新增 `AI 视频`，顺序放在 `AI 生图` 下面。
2. 页面采用抓虾现有 `AI 生图` / `TaskRunner` / AI 测图全链路的深色工具型视觉，不另造一套 UI 风格。
3. 第一步内置森马云盘找图能力，业务只需要输入款号，一行一个款。
4. 找图结果在页面内按款号回显，用户可人工勾选可用素材图。
5. 素材可进入四个 AI 图片动作：`AI 换脸`、`AI 换背景`、`AI 换装`、`AI 换姿势`。
6. AI 结果进入统一审核池，支持通过、驳回、重试重跑、继续进入视频阶段。
7. 视频阶段先创建视频任务，再提交生成；只有审核通过的图片可被选入任务，待审核图片只读展示并禁选，已驳回图片完全不进入视频素材库。
8. 视频模型 provider 需要同时支持软件管家页面生成、Seedance 2.0 API 和百炼 HappyHorse；HappyHorse 作为新视频模型接入，不放在 AI 改图阶段。
9. 结果页采用卡片式任务回显，展示整体进度条、单卡进度条、任务 ID、供应商、本地 MP4 路径和失败原因。

### 非目标

1. 本期不做 `ai_video_pool_import`。批量输入款号已经满足当前起步体验。
2. 本期不把软件管家智图/大森 AI 做成必接换脸 provider。AI 换脸/换背景走抓虾内置 GPT Image 生图能力，这是方案口径。
3. 本期不做自动发布、登记回写、效果回收，只在界面上预留后续阶段。
4. 本期不把 OpenCut 嵌成完整剪辑器。视频下载后可先保留人工剪映或后续自动剪辑出口。
5. 本期不在抓虾内重新实现 Seedance API 封装。Seedance CLI 作为项目级共享依赖放在 `integrations/seedanceCLI`，工作流通过该 CLI 调用 Ark 任务接口。
6. 本期不在抓虾内重新实现百炼 HappyHorse API 封装。HappyHorse 的百炼 CLI 已在 `/Users/xingyicheng/Documents/AI 视频` 跑通，迁移为 `integrations/bailianCLI` 共享能力后由工作流调用。
7. 本期不把 Ark / DashScope / 百炼 API Key 写进工作流源码、脚本参数、测试、文档或日志中；三类凭据都必须可在抓虾 `设置 -> AI 能力` 中统一配置，运行环境变量只作为兼容回退。

## 入口定义

入口由 `app/src/renderer/App.vue` 的一级导航直接承载：

| 字段 | 值 |
| --- | --- |
| `currentView` | `ai_video` |
| `label` | `AI 视频` |
| `position` | `AI 生图` 下方 |
| `component` | `AiVideoWorkflow.vue` |

前端选择 `AI 视频` 时，清空当前适配器脚本上下文并渲染 `AiVideoWorkflow.vue`。`巴拉 AI 视频助手` 仍作为原子能力集合存在：工作流页面后续通过任务运行 API 调用对应脚本，而不是让用户在二级脚本菜单里手动切换。

## 工作流步骤

### 1. 森马云盘找图

复用原子脚本：`semir_video_material_prepare`。

页面只展示必要字段：

| UI 字段 | 对应参数 | 默认值 |
| --- | --- | --- |
| 款号 | `item_codes` | 空，一行一个 |
| 云盘搜索根路径 | `cloud_path` | `巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/` |
| 工作区目录 | `export_folder` | 使用系统文件夹选择器；不显示可编辑路径文本框 |
| 导出包名称 | `package_name` | 留空按时间生成 |

隐藏并固定的技术参数：

| 参数 | 固定值 |
| --- | --- |
| `mode` | `new` |
| `folder_scan_depth` | `2` |
| `duplicate_mode` | `first_per_hash` |
| `download_concurrency` | `8` |
| `max_image_mb` | `20` |

结果回显：

- 森马云盘下载组件支持明确的展开/收起，收起后释放右侧选图面积；执行任务默认在新的浏览器页面打开，不依赖当前页是否已打开目标页面。
- 选中的工作区是整个五步流程的根目录。找图只扫描该工作区内本次新建的款号素材目录；第四步默认输出目录继承同一工作区，也必须通过系统文件夹选择器修改。
- 找图与下载分别展示两条进度：找款进度、下载进度；任何一条失败都要显示款号级原因，不能静默停住。
- 顶部使用款号 tab，一次只渲染一个款号；款号 tab 与图片类型 tab 分占独立行，不能错位或混排。
- 当前款号内使用 `模拍图 / 细节图` tab，默认只显示模拍图，用户明确切换后才显示细节图。
- 模拍图默认不选中。点击图片卡片只切换选中态；鼠标移入后显示放大镜，点击放大镜才打开全尺寸原图。
- 列表使用每批 20 张的渐进渲染和 480px WebP 缩略图；当前批次立即请求并异步解码，滚动时不能因低优先级懒加载出现长时间白屏。
- 图片卡片显示来源文件夹、文件名、大小、处理动作。
- 用户可批量勾选，只有被选中的图进入 AI 图片动作。
- 缺图、文件夹命中不明确、压缩失败要保留行级原因，不阻塞其他款号继续。

### 2. AI 图片动作

复用原子脚本：`bala_ai_face_background_generate`。

第二步不是纯参数表，而是一个按款号组织的图片工作台。整体布局参考 `AI 生图`：左侧是 AI 动作和参数面板，右侧主内容区按款号分割，每个款号模块支持展开/收起。右侧每个款号内部采用类似 `AI 生图` 结果队列的心智：每张原图固定在一行最左侧，后面串联该原图的多个 AI 修改版本。

图片工作台要求：

- 原图卡来自第一步已选模拍图，作为源图，不和 AI 结果混在同一层级。
- 一个原图可以有多个版本：换脸版本、换背景版本、换装版本、换姿势版本、重跑版本。
- 版本卡展示动作、Prompt/模特摘要、生成状态、进度和明确选中态；这里的选中只表示“本次要操作的输入图”，支持多选批量生成，不承担挑选或送审语义。
- AI 改图只负责生图和改图；所有原图与未删除的 AI 结果自动进入审核，由第三步统一决定保留或驳回。
- AI 结果可在工作台删除。点击删除必须先展示明确的二次确认弹窗；确认后真实删除工作区内对应的本地图片文件，并同步从 AI 工作台、审核池和视频素材池移除。删除只允许作用于用户通过系统选择器授权的工作区根目录内的普通图片文件，禁止删除工作区本身、工作区外路径、目录、符号链接和非图片文件，且不提供撤销。
- 细节图与已下载素材统一放入左侧 `本地素材库`，供换装、细节参考和视频补充镜头复用，不再放在右侧队列底部。
- 左侧不再用款号列表；款号分组只存在于右侧主内容区。
- `AI 换脸`、`AI 换背景`、`AI 换装`、`AI 换姿势` 的动作选择、Prompt、模特库入口、换装上传入口和生图按钮都放在左侧功能区。
- 左侧工具区拥有独立滚动条，底部 `开始生图` 固定可见；每个手风琴收起后只占标题行高度，不被布局拉伸到整屏。
- 左侧动作选择采用四宫格展示，当前动作必须有明确选中态；左侧同时展示本次选中的输入图数量和批量操作范围。
- 主动作按钮文案为 `开始生图`，不是 `创建 AI 改图任务`。
- AI 换姿势通过项目公共 Prompt 库选择姿势 Prompt；AI 换装既支持本地上传，也支持从 `本地素材库` 选择已经下载的服装/细节图。
- 点击主图可进入与 `AI 生图` 一致的大图修改模式：支持 Prompt、换脸/换装/换背景/换姿势工具、生成历史缩略图和精确标注；标注只作用于当前单图，批量选择仍由外层工作台负责。

四个能力解耦展示为动作 tab/segmented control：

| 动作 | 关键输入 | 输出 |
| --- | --- | --- |
| `AI 换脸` | 已选素材图、模特库图片、补充要求 | 换脸候选图 |
| `AI 换背景` | 已选素材图、背景 Prompt、补充要求 | 换背景候选图 |
| `AI 换装` | 模特图、服装图、搭配参考图、同款不同色参考图 | 换装候选图 |
| `AI 换姿势` | 已选素材图、姿势 Prompt、补充要求 | 换姿势候选图 |

模特素材库不是主页面常驻区域，只作为 `AI 换脸` 里的功能菜单和弹窗。用户点“选择模特”时打开弹窗，选中后回填到当前款号/当前动作参数。非换脸动作不展示模特库。

`AI 换脸` 不再使用下拉框选择模特，改为弹窗素材库。用户只看到 `年龄段 + 性别` 两个业务筛选维度，不展示 `66 / 73 / 100 / 140` 等底层目录编号；选择后在工具区回显所选模特照片。

弹窗要求：

- 左侧为年龄段和性别筛选。
- 中间为模型图片宫格，展示真实模特素材图、表情/角度名称。
- 右侧为已选模型队列，可设置每张源图匹配一个或多个模特。
- 选择后写入 `model_ref_ids`，而不是让用户手写 `100女/标准.jpg`。

### 3. AI 结果审核池

复用现有审核批次模型，并吸收 AI 测图工作流的界面逻辑。

审核状态：

- `pending`：待审核。
- `approved`：通过，可进入视频阶段。
- `rejected`：驳回，不进入后续。
- `retry_requested`：需要按原参数或修改参数重跑。

界面能力：

- 点击任意 AI 图直接打开大图预览。
- 按款号、动作类型、模特分组、生成状态筛选。
- 批量通过、批量驳回、单图重试、同参数重跑、改 Prompt 重跑。
- 支持在审核池中为单个款号新增图片：可以上传本地图，也可以回到 `AI 换脸`、`AI 换背景`、`AI 换装`、`AI 换姿势` 继续补图。
- 新增图片默认回到当前款号的审核池，不需要业务重新从第一步开始。
- 不再设置右侧“审核预览”固定面板，页面宽度优先留给卡片式审核池。
- 底部操作栏固定在当前审核页底部，承载“返回 AI 改图”和“输出到视频任务”等下一步动作。
- 审核池全量承接第二步的原图和未删除 AI 结果，原图与 AI 图都支持通过/驳回。
- 通过图片进入 `approved_image_refs`；待审核图片只读展示但不能选入视频任务，已驳回图片不进入第四步素材库。

### 4. 视频生成

复用原子脚本：`qn_img2video_batch`。

视频阶段引入“视频任务”概念，不再默认把图片直接拿去生成。每个款号可创建一个或多个视频任务，任务内选择素材图、填写 Prompt、选择生成供应商和生成方式，再进入预检、提交、轮询和下载。

主页面不按款号直接铺配置表，而是展示已创建的视频任务队列。顶部提供 `新增视频任务`、批量预检并生成、只下载已完成视频、查看结果进度和默认输出目录。

视频任务创建规则：

- 点击 `新增视频任务` 打开弹窗；素材库按第一步找过图的款号平铺，用户在款号卡片上直接选择，不使用款号下拉。
- 弹窗内选择 `生成供应商/方式`、`Prompt`、`输出目录` 和图片素材；输出目录必须是系统文件夹选择器，默认继承第一步工作区。
- 一个款号可以重复创建多条任务，例如同一款同时创建“软件管家领口模板视频”、“Seedance 场景视频”和“HappyHorse 参考生视频”。
- 每个款号卡片展示原始模拍图、细节素材和 AI 结果，并打上业务标签：`模拍`、`素材`、`AI 换脸`、`AI 换装`、`AI 换背景`、`AI 换姿势`、`已审核`。
- 只有 `approved` 图片可选择；`pending` / `retry_requested` 可见但禁选，`rejected` 完全排除。
- 页面顶部是当前 tab 内的批量工具条，一行展示批量预检、下载已完成、查看结果进度、默认输出目录等动作，不再放左侧按钮栏。
- 每个视频任务独立保存 `prompt`、`provider`、`template_id`、`selected_image_refs` 和输出目录。
- 批量执行时按视频任务拆分队列，避免款号多时素材混在同一个任务里。
- 删除面向用户的“成片拆分”配置；一条视频任务就是用户本次自由组合的一组图片。软件管家内部需要兼容参数时固定传 `all_images_one_video`。

供应商选择：

| 供应商 | 入口 | 模板 | 说明 |
| --- | --- | --- | --- |
| `qn` | 软件管家页面生成 | 可选 | 复用 `qn_img2video_batch` 的上传、提交、轮询、下载链路 |
| `seedance` | Seedance 2.0 API | 不使用软件管家模板 | 复用 `integrations/seedanceCLI` 的 Node.js CLI |
| `happyhorse` | 百炼 HappyHorse 视频模型 | 不使用软件管家模板 | 复用 `integrations/bailianCLI` 的 Node.js CLI，支持文生、图生、参考生视频 |

软件管家模板库不是主页面常驻区域，只作为“选择模板”弹窗。模板是可选项，常见链路可以不选模板，直接把上一阶段审核通过的 AI 图上传到软件管家生成视频，再下载素材到本地。

模板选择来自本地模板目录：

| 本地资源 | 路径 |
| --- | --- |
| 模板目录 JSON | `/Users/xingyicheng/Downloads/巴拉AI视频模板库/template-catalog.json` |
| 模板目录 CSV | `/Users/xingyicheng/Downloads/巴拉AI视频模板库/template-catalog.csv` |
| 本地预览视频 | `/Users/xingyicheng/Downloads/巴拉AI视频模板库/模板预览/` |
| 本地封面 | `/Users/xingyicheng/Downloads/巴拉AI视频模板库/模板封面/` |

模板弹窗卡片展示：

- 模板标题。
- 描述；当软件管家返回空描述时，展示槽位说明。
- 比例、时长、模板类型。
- 本地预览视频。
- 模板 ID，方便排障和原子脚本复跑。

用户可为每个款号输入自定义 `prompt`。进入 live 生成前先做预检，预检通过后再调用 `qn_img2video_batch` 的 live 链路，按款号上传本地图、提交任务、轮询、下载视频。

#### Seedance 2.0 CLI 复用

Seedance 对接不在抓虾内重写 Ark API，先调用项目级共享依赖 `integrations/seedanceCLI`。该目录来自已验证的本地 Seedance CLI 项目，作为抓虾共用能力，不归属任何单个适配器。

| 项 | 路径 / 命令 |
| --- | --- |
| 项目共享目录 | `integrations/seedanceCLI` |
| CLI 入口 | `integrations/seedanceCLI/bin/seedance.js` |
| API 封装 | `integrations/seedanceCLI/src/ark-client.js` |
| 配置读取 | `integrations/seedanceCLI/src/config.js` |
| 提交并等待 | `npm --prefix integrations/seedanceCLI run seedance -- submit <payload.json> --wait --download outputs/result.mp4` |
| 查询任务 | `npm --prefix integrations/seedanceCLI run seedance -- get <task-id>` |
| 等待并下载 | `npm --prefix integrations/seedanceCLI run seedance -- wait <task-id> --download outputs/result.mp4` |

工作流实现时只需要负责生成 payload、调用 CLI、解析 stdout/stderr、登记任务 ID、轮询状态和复制本地 MP4 到当前款号输出目录。`ARK_API_KEY` 不写入源码，统一由 `AI 能力` 配置写入运行环境或 `.env.local`。

隐私边界：

- 如果上传包含真人/儿童真人脸的本地图片触发 `InputImageSensitiveContentDetected.PrivacyInformation`，不绕过平台保护。
- 失败后可提供“文字描述服装、场景和动作，生成原创人物版本”的重试模式。
- 成功后 `task.content.video_url` 通常 24 小时有效，必须及时下载并写入本地结果表。

#### 百炼 HappyHorse CLI 复用

HappyHorse 接入方式与 Seedance 保持一致：不把百炼 / DashScope API 逻辑散落在 `core/api_server.py` 或 `AiVideoWorkflow.vue` 里，而是把已在其他项目验证过的 CLI 能力迁移进仓库，作为生视频阶段的共享 provider。

迁移来源：

| 项 | 来源 |
| --- | --- |
| 当前完整项目 | `/Users/xingyicheng/Documents/AI 视频` |
| CLI 入口 | `/Users/xingyicheng/Documents/AI 视频/bin/bailian.js` |
| API 封装 | `/Users/xingyicheng/Documents/AI 视频/src/bailian-client.js` |
| 配置读取 | `/Users/xingyicheng/Documents/AI 视频/src/config.js` |
| 示例 payload | `/Users/xingyicheng/Documents/AI 视频/examples/happyhorse-t2v.json`、`happyhorse-i2v.json`、`happyhorse-r2v.json` |
| 单元测试 | `/Users/xingyicheng/Documents/AI 视频/test/bailian-client.test.js` |

迁移目标：

| 项 | 路径 / 命令 |
| --- | --- |
| 项目共享目录 | `integrations/bailianCLI` |
| CLI 入口 | `integrations/bailianCLI/bin/bailian.js` |
| API 封装 | `integrations/bailianCLI/src/bailian-client.js` |
| 配置读取 | `integrations/bailianCLI/src/config.js` |
| 示例 payload | `integrations/bailianCLI/examples/happyhorse-t2v.json`、`happyhorse-i2v.json`、`happyhorse-r2v.json` |
| 测试 | `npm --prefix integrations/bailianCLI test` |
| 提交并等待 | `npm --prefix integrations/bailianCLI run bailian -- submit <payload.json> --wait --download outputs/result.mp4` |
| 查询任务 | `npm --prefix integrations/bailianCLI run bailian -- get <task-id>` |
| 等待并下载 | `npm --prefix integrations/bailianCLI run bailian -- wait <task-id> --download outputs/result.mp4` |

`integrations/bailianCLI/package.json` 至少包含：

```json
{
  "type": "module",
  "engines": {
    "node": ">=18"
  },
  "scripts": {
    "test": "node --test test/*.test.js",
    "bailian": "node bin/bailian.js"
  },
  "bin": {
    "bailian": "./bin/bailian.js"
  }
}
```

该 CLI 没有 npm 依赖，Node 18+ 自带 `fetch` 即可运行。

配置来源：

| 环境变量 | 说明 |
| --- | --- |
| `DASHSCOPE_API_KEY` | 必填，百炼 / DashScope API Key；不能写入源码、测试 fixture 或文档真实值 |
| `BAILIAN_WORKSPACE_ID` | 生产建议配置，使用业务空间专属域名 |
| `BAILIAN_REGION` | 默认 `cn-beijing` |
| `BAILIAN_BASE_URL` | 可选，用于强制指定 endpoint，例如 `https://dashscope.aliyuncs.com` |

HappyHorse 三种模式：

| 模式 | 模型 | 输入规则 | 适用工作流 |
| --- | --- | --- | --- |
| 文生视频 | `happyhorse-1.1-t2v` | `input.prompt`，可设置 `ratio` | 无可用图或隐私安全重试时，生成原创人物/场景版本 |
| 图生视频 | `happyhorse-1.1-i2v` | 1 张 `first_frame`，不传 `ratio`，比例跟随首帧图 | 使用审核通过图片做首帧动效 |
| 参考生视频 | `happyhorse-1.1-r2v` | 1-9 张 `reference_image`，prompt 可用 `[Image 1]` 指代图片 | 使用模拍图、细节图、搭配图组合生成服装展示 |

典型 payload：

```json
{
  "model": "happyhorse-1.1-i2v",
  "input": {
    "prompt": "童装模特自然转身展示上衣版型，镜头平稳推进。",
    "media": [
      {
        "type": "first_frame",
        "url": "https://example.com/first-frame.png"
      }
    ]
  },
  "parameters": {
    "resolution": "720P",
    "duration": 5,
    "watermark": false
  }
}
```

工作流实现时只需要负责把视频任务转换成 HappyHorse payload、调用 CLI、解析创建结果里的 `output.task_id`、轮询 `output.task_status`、成功后读取 `output.video_url` 并下载到当前款号输出目录。`task_id` 和生成视频 URL 查询/下载有效期按 24 小时处理，成功后必须及时本地归档。

HappyHorse 失败恢复：

- 未配置 `DASHSCOPE_API_KEY`：视频任务停在 `needs_config`，提示去 `AI 能力` 或运行环境配置。
- 图生视频传入 `ratio`：前端预检直接拦截，提示“图生视频比例跟随首帧图”。
- 参考图超过 9 张：前端预检要求精简素材，不提交任务。
- 百炼任务失败或过期：保留 payload、task ID、失败原因和重试按钮；重试不得重复使用已过期视频 URL。
- 涉及真实儿童/真人图片时，仍必须遵守人工审核闸口；必要时切换到文生视频的原创人物/场景版本。

### 5. 视频结果回显

结果以款号为主键展示：

- 卡片式布局，不使用长列表作为主视图。
- 顶部展示整体进度条和完成数量。
- 单卡展示源图/供应商预览、模板标题 / 模板 ID、视频任务 ID、视频状态、单卡进度条、本地视频文件、失败原因。
- 卡片内提供预览、重新下载、打开文件、返回生成等局部动作。

本期只做到本地视频下载和回显。后续预留：

- 自动剪辑。
- 发布预检。
- live 发布。
- 登记回写。
- 效果回收。

## 数据契约

### MaterialSelection

```json
{
  "batch_id": "bala-material-20260715-001",
  "style_code": "208326102205",
  "source": "semir_video_material_prepare",
  "selected_images": [
    {
      "path": "/Users/.../01_模拍原图/example.jpg",
      "role": "model_photo",
      "folder_type": "已选",
      "file_size_mb": 3.2
    }
  ]
}
```

### AiImageJob

```json
{
  "operation_type": "face_swap",
  "source_images": ["/Users/.../source.jpg"],
  "model_ref_ids": ["model-library-item-id"],
  "background_prompt": "",
  "pose_prompt": "",
  "prompt_extra": "保留童装版型和颜色",
  "review_mode": "workspace_only"
}
```

### ReviewSelection

```json
{
  "review_batch_uid": "bala-ai-review-001",
  "style_code": "208326102205",
  "approved_image_refs": [
    {
      "path": "/Users/.../AI生成图/208326102205_001.png",
      "style_code": "208326102205",
      "operation_type": "face_swap",
      "source_image": "/Users/.../source.jpg"
    }
  ],
  "added_images": [
    {
      "source": "manual_upload",
      "path": "/Users/.../补充图/208326102205_extra.png",
      "status": "pending"
    }
  ]
}
```

### VideoJob

```json
{
  "style_code": "208326102205",
  "provider": "qn",
  "template_id": "",
  "template_title": "",
  "prompt": "上传本款审核通过 AI 图，由软件管家直接生成视频",
  "selected_image_refs": [
    {
      "path": "/Users/.../AI生成图/208326102205_001.png",
      "status": "approved",
      "kind": "ai_image"
    }
  ],
  "output_dir": "/Users/xingyicheng/Downloads/巴拉AI视频成片"
}
```

### SeedanceVideoJob

```json
{
  "style_code": "208326105214",
  "provider": "seedance",
  "seedance_cli_dir": "integrations/seedanceCLI",
  "payload_path": "integrations/seedanceCLI/outputs/payloads/208326105214.json",
  "command": "npm --prefix integrations/seedanceCLI run seedance -- submit outputs/payloads/208326105214.json --wait --download outputs/208326105214.mp4",
  "task_id": "cgt-20260715104619-5dvj4",
  "prompt": "马尔代夫海边，儿童自然走动，突出服装版型",
  "privacy_fallback": "text_only_original_person",
  "output_dir": "/Users/xingyicheng/Downloads/巴拉AI视频成片"
}
```

### HappyHorseVideoJob

```json
{
  "style_code": "208326102205",
  "provider": "happyhorse",
  "mode": "r2v",
  "bailian_cli_dir": "integrations/bailianCLI",
  "payload_path": "integrations/bailianCLI/outputs/payloads/208326102205.json",
  "command": "npm --prefix integrations/bailianCLI run bailian -- submit outputs/payloads/208326102205.json --wait --download outputs/208326102205.mp4",
  "task_id": "0385dc79-example",
  "model": "happyhorse-1.1-r2v",
  "prompt": "[Image 1]中的童装模特自然转身展示服装，[Image 2]展示面料细节，镜头真实流畅。",
  "media": [
    {
      "type": "reference_image",
      "url": "https://example.com/approved-model-image.png",
      "source_image_ref": "/Users/.../AI生成图/208326102205_001.png"
    }
  ],
  "parameters": {
    "resolution": "720P",
    "ratio": "3:4",
    "duration": 5,
    "watermark": false
  },
  "output_dir": "/Users/xingyicheng/Downloads/巴拉AI视频成片"
}
```

## 前端布局

静态视觉锚点文件：

`docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.html`

设计审查报告：

`docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-design-review.md`

### 2026-07-15 设计审查回写

本轮用 `impeccable critique` 对 `AiVideoWorkflow.vue` 和静态视觉锚点做了完整设计审查。结论是：页面方向正确，已经符合抓虾暗色运营工作台和巴拉 AI 视频业务主线，但仍偏“流程原型”，还没达到批量生产级运营台。

设计健康分为 `22/40`，没有命中确定性 AI slop 视觉反模式；主要扣分来自长任务状态、失败恢复、批量防错、弹窗可访问性和视觉层级。

后续设计与实现必须优先补齐五类问题：

1. 长任务状态：找图、生图、提交、轮询、下载都要有 `queued / running / partial / failed / done` 状态、款号级进度和失败重试范围。
2. 决策降噪：每个步骤只保留一个主动作；AI 改图和生视频不要同时暴露过多同权重按钮。
3. 弹窗可访问性：图片预览、模特库、模板库、视频任务创建必须对齐 AI 生图页面的 `role=dialog`、`aria-modal`、focus trap、Escape 关闭和背景 inert。
4. 状态色分工：橙色只承担主动作和当前步骤；选中态、通过、待审、失败、重跑必须有独立文字/图标表达。
5. 边界状态产品化：无素材、部分成功、AI 生成失败、Seedance 隐私拦截、API key 未配置、软件管家上传/轮询/下载失败、视频 URL 过期都要有“原因 + 下一步动作”。

布局要求：

- 保留抓虾标题栏、一级菜单和深色工作区。
- `AI 视频` 是一级菜单，位于 `AI 生图` 下面。
- 页面顶部为 5 步 stepper：`找图`、`AI 改图`、`审核`、`生视频`、`结果`。
- Stepper 必须可切换；每次只显示一个步骤的主体内容，不把 5 步挤在同一屏。
- 第一屏以“找图下载 + 素材回显”为主，不放营销 hero。
- `AI 改图` 左侧必须是动作/参数功能区；款号分组必须放在右侧主内容区，且每个款号支持展开/收起。
- `AI 改图` 的主图区域必须呈现“原图 -> 多版本 AI 结果队列”，不能把原图和结果图混成同级平铺。
- `AI 改图` 左侧工具区独立滚动，动作手风琴收起后只保留标题行，底部主动作固定可见；`本地素材库` 同时服务换装和细节参考。
- `AI 改图` 大图模式必须复用 AI 生图的编辑心智，支持 Prompt、四类工具、历史缩略图和精确标注。
- `审核` 主体参考 AI 测图审核界面：顶部筛选和批量操作，按款号分组的 AI 图卡片，支持通过、舍弃、重跑和新增图片；点击图片查看大图，不保留右侧审核预览面板。
- `生视频` 主体必须展示视频任务队列；用户通过 `新增视频任务` 弹窗选择素材图、填写 Prompt、选择生成方式、款号和供应商。
- `生视频` 顶部批量动作必须在当前 tab 页面内横向展示，不使用左侧按钮栏。
- `生视频` 只允许选择审核通过图片；待审核/需重跑图片只读禁选，已驳回图片不进入素材库。
- `生视频` 同一款号可以创建多条视频任务；每条任务可选 `软件管家页面生成`、`Seedance 2.0 API` 或 `百炼 HappyHorse`；Ark / DashScope / 百炼 Key 只显示配置状态，不在页面内明文填写。
- `Seedance 2.0 API` 调用项目级共享依赖 `integrations/seedanceCLI`，不引用用户目录里的外部临时项目。
- `百炼 HappyHorse` 调用项目级共享依赖 `integrations/bailianCLI`，不引用用户目录里的外部临时项目。
- `结果` 主体必须为卡片式布局，包含整体进度条和单卡片进度条。
- 表单、按钮、卡片、表格使用现有抓虾色板：`#141418`、`#1c1c22`、`#242430`、`#2e2e3a`、`#FF6B2B`。
- 控件密度接近 `TaskRunner`，卡片圆角不超过 8px。
- 模特库和模板库弹窗都必须用真实缩略图/视频做选择，而不是纯文字下拉。

## 实施顺序

1. 新增本 spec 和 HTML 视觉锚点。
2. 在 `App.vue` 新增 `ai_video` 一级菜单和 `AiVideoWorkflow.vue` 挂载。
3. 新建 `AiVideoWorkflow.vue`，先实现本地状态机和可切换步骤布局。
4. Step 1 连接 `semir_video_material_prepare`，完成找图结果回显和图片选择。
5. Step 2 连接 `bala_ai_face_background_generate`，补视觉模特库弹窗。
6. Step 3 复用 `BalaAiImageReviewDrawer` 的审核数据，改成工作流内嵌审核池。
7. Step 4 读取本地 `template-catalog.json`，连接 `qn_img2video_batch` 的 plan/live。
8. Step 4 增加 Seedance provider，复用 `integrations/seedanceCLI` 做 submit/get/wait/download。
9. Step 4 增加 HappyHorse provider，把 `/Users/xingyicheng/Documents/AI 视频` 的 `bin/bailian.js`、`src/bailian-client.js`、`src/config.js`、`examples/happyhorse-*.json`、`test/bailian-client.test.js` 迁移到 `integrations/bailianCLI`，并在视频任务弹窗内提供文生、图生、参考生视频模式。
10. Step 5 做卡片式视频结果回显、整体进度、单卡进度、打开目录、导出结果表。

## 验收标准

1. 点击一级菜单 `AI 视频` 后只显示分步工作流，不出现通用参数表。
2. 第一步只需要款号、云盘路径、导出目录、包名四类业务字段，技术参数不可见但按默认值传入。
3. 找图结果可按款号看图和勾选，未选图不能进入 AI 生成。
4. 找图结果顶部以款号 tab 切换，一次只渲染一个款号；款号内以图片类型 tab 切换，默认只显示模拍图，明确切换后才显示细节图；点击放大镜可查看全尺寸大图。
5. AI 改图页左侧是独立滚动功能区，右侧按款号展示原图和多个 AI 版本；图片多选只代表本次批量操作，所有原图和未删除 AI 结果自动进入审核。
6. AI 换脸的模特选择为图片弹窗，只显示年龄段/性别筛选，选择后回显照片；AI 换姿势复用公共 Prompt 库，AI 换装可从本地素材库选图。
7. 审核页不显示右侧预览面板，点击卡片直接查看大图。
8. 视频模板卡片能展示标题、描述/槽位说明、本地预览视频。
9. 生视频页通过“新增视频任务”弹窗按款号平铺素材库，组织图片、Prompt、生成方式和供应商；一个款号可创建多条任务，且不再暴露“成片拆分”。
10. 视频任务只允许选择已审核图片，素材卡具有明确的来源动作和审核状态标签。
11. 软件管家模板不是必填；不选模板也能提交生成。
12. Seedance provider 能生成 payload、调用既有 CLI、登记任务 ID，并把成功视频下载到本地。
13. HappyHorse provider 能生成 t2v / i2v / r2v payload、调用 `integrations/bailianCLI`、登记 `output.task_id`，并把成功视频下载到本地。
14. HappyHorse 图生视频不允许传 `ratio`；参考生视频支持 1-9 张参考图；未配置 `DASHSCOPE_API_KEY` 时只显示配置状态和恢复动作，不提交 live 任务。
15. 视频生成完成后能以卡片显示本地 MP4 路径、进度和任务状态，并可从页面打开输出目录。
16. 第一、四步的目录都通过系统文件夹选择器设置并共享同一工作区；不得显示可编辑路径文本框或个人机器硬编码默认路径。
17. `设置 -> AI 能力` 可以保存并读取 GPT Image 2 4K、Seedance、HappyHorse 三类凭据配置；工作流只显示已配置/未配置状态，凭据值不出现在源码、测试、文档或日志中。

### 设计审查补充验收

1. 任一长任务运行时，用户能看到当前阶段、款号级进度、失败项数量和下一步可做动作。
2. 任一批量危险动作必须有确认或失败恢复路径；本地图片删除必须先确认，成功后不可撤销。
3. 任一弹窗必须可键盘打开、关闭、完成选择，并且焦点不会丢到背景页面。
4. 任一状态色不能只靠颜色表达；必须同时有文字或图标标签。
5. 任一实现/依赖名不能作为主界面核心文案，除非它位于日志、调试详情或模板 ID 等排障区域。
