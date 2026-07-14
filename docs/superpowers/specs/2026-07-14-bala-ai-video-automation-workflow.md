# 巴拉 AI 自制视频自动化工作流设计

日期：2026-07-14

## 结论

这条链路不应该做成一个从 Excel 到发布按钮的黑盒 RPA，而应该按抓虾现有模式拆成可恢复的任务链：导入规划、找款取图、素材预处理、AI 模特替换、图生视频、模板剪辑、发布预检、显式发布、效果回收。每个阶段输出结构化结果表和本地/云端产物，关键节点进入审批看板，最终发布必须保留 `plan` 和 `live` 两种模式。

原因很明确：短视频复盘显示 AI 自制数量已经高，但种草效率偏低。自动化的目标不是单纯放大产量，而是把人工 SOP 中“挑图、判断是否换脸、检查视频是否合理、禁用风险文案、登记结果”变成可批量执行、可回读、可抽检的质量链路。

## 输入资料摘要

### 钉钉爆款池

来源工作簿：`/Users/xingyicheng/Downloads/钉钉表格与文档抓取_2026-07-14.xlsx`

- `表格-爆款池`：361 行，字段包括 `产品季`、`产品线需求提前`、`AI自制批次`、`大货款号`、`ID`、`产品线图片`、`制作备注`、`产品线`、`年龄段`、`属性`、`尺码段`、`性别`、`品类`、`FAB` 等。
- `附件与图片`：367 条，其中表格产品线图片 359 条，文档图片 8 条。
- 批次分布：`后续补充` 129 条，其次第二批到第八批。
- `视频导购` 字段可作为本期任务初筛：`1-AI` 125 条，`0` 225 条，空 9 条，另有 `226已拍`、`126已拍` 各 1 条。
- 制作状态主要靠 `制作备注` 表达，348 条为空，少量为 `已上传`、`上传1条`、`上传2条`、`已制作`，适合做成可恢复队列而不是一次性全量执行。
- 品类集中在羽绒服、长裤、便服、长袖 T 恤、内衣等；产品线以中童、婴幼童、HOME、鞋品为主。后续 AI 模特选择和视频模板应按 `模特`、`年龄段`、`性别`、`品类` 做规则映射。
- 复盘文档表格显示 AI 自制 501 条、种草金额 2766，单条种草金额约 5.52；视觉自制 245 条、种草金额 19016，单条约 77.62。
- 复盘文档还显示直播切片单条种草金额约 43.32，自拍自制约 9.68，淘系直播切片约 6.67。AI 自制不是不能做，而是要补真实感、货品细节和发布后的效果回收。
- 后续目标中 AI 制作目标为 700 条，备注为每工作日产出 35 个；视觉二剪自制目标 100 条。

### AI 自制视频 SOP

来源工作簿：`/Users/xingyicheng/Downloads/AI自制视频SOP_操作流程.xlsx`

人工流程可以归纳为：

1. 在规划文件筛选批次，复制商品款号。
2. 到森马云盘搜索款号，下载模拍图文件夹和商品细节图文件夹。
3. 删除白底和非模拍图片，压缩到单张小于 20M。
4. 判断图片是否已是 AI 换脸图；未换脸则走软件管家或大森 AI 做 AI 模特替换。
5. 用软件管家 `img2video` 上传 3-4 张换脸图生成视频。
6. 检查视频是否合理：服装一致、人物动作无危险/歧义、手指正常；不合格视频剪辑或重新生成。
7. 剪映二剪：AI 模拍视频 + 商品细节 + 封面文字 + 衣服描述 + logo 结尾，关闭原声，注意配乐版权。
8. 千牛后台发布，文案需检查极限词、夸大、不良舆论、功能一致性、语病。
9. 钉钉登记作品信息，并把成品上传到森马云盘指定目录。

`Sheet2` 的 RPA 流程说明当前发布链路还依赖掌柜软件导出标题、钉钉 AI 标题生成文件、影刀程序 `淘系-内容创意-光合内容短视频批量上传`、运行结果文件和作品登记。抓虾后续要替代的不是单个上传按钮，而是“标题/文案生成 - 批量上传 - 运行结果回读 - 登记”的整段状态链。

### 截图流程图

截图里的流程与 SOP 一致，但多了两个关键运营节点：

- `人为检测` 是强制闸口：视频服装、动作、手部、模特姿势有问题要重新生成，正确才进入千牛后台上传。
- 上传后还要并行做四件事：调用 AI 生成批量种草文案、用 RPA 批量发布、在多维表留存信息、把成品上传到森马云盘。最后用每日发布量看板和引导成交数据看板闭环。

## 现有抓虾能力复用点

### 可直接复用

- `adapters/semir-cloud-drive/batch-image-download.js`：已支持森马云盘按款号/SKC 搜索、下载、去重、打包。
- `adapters/semir-cloud-drive/batch-ai-generate.js`：已有云盘素材 + Prompt + AI 站点生图的分阶段执行模型，可复用其输入归一化和下载产物结构。
- `adapters/tmall-ops-assistant/tools/run_tmall_ai_image_test_chain.py`：已有 Excel 工作流、云盘找图、1XM 生图、审批看板、天猫素材任务创建、结果证据表、钉钉通知。
- `adapters/mop-ops-assistant/kol-material-img2video-batch.js`：已能读取 Excel 商品 ID/商家编码和素材图片，调用千牛素材中心展示视频接口逐行提交图生视频任务。
- `adapters/mop-ops-assistant/search-recommend-material-publish.js`：已有千牛素材发布的预检/live 双模式和素材根目录识别逻辑。
- `core/data_sink.py`、任务实例 API、审批看板、云同步路径：适合保存每个阶段的证据表、视频文件、图片文件、审批状态和重跑状态。

### 已有能力的缺口

- `kol-material-img2video-batch.js` 已能在千牛素材中心视频生产页使用 MTop 提交图生视频任务，接口包括 `mtop.taobao.qn.copilot.image.generate.video.submit`、模板列表、模板生成和商品素材读取；当前偏“提交任务”，还需要补齐任务轮询、生成记录识别、视频 URL 下载、本地归档和失败恢复。
- 森马云盘脚本已有 mount 解析、`/fengcloud/2/file/search` 搜索、文件 info 和 `download_urls` 下载能力；视频链路需要在此之上新增文件夹命名规则：优先最新 `已选` 模拍文件夹，细节图优先 `已写` 或款号命名文件夹。
- AI 生图脚本已有“云盘找素材 - 跳 AI 站点 - 生成 - 下载结果”的分阶段模型；换脸/换背景要另建 provider 层，分别适配软件管家智图、大森 AI，不要把童装视频逻辑塞回普通 AI 生图任务。

## MoneyPrinterTurbo / OpenCut 研究结论

### MoneyPrinterTurbo 可借鉴点

本地代码路径：`/Users/xingyicheng/Documents/MoneyPrinterTurbo/harry0703-MoneyPrinterTurbo`

MoneyPrinterTurbo 的核心价值不是它的素材站搜索，而是它的“分阶段视频工厂”模型：

- `app/services/task.py` 把视频生成拆成脚本、关键词、音频、字幕、素材、最终视频、可选发布，并支持 `stop_at` 在任一阶段停下。这和抓虾要做的可恢复队列很像。
- `app/services/video.py` 用 MoviePy + FFmpeg 做本地素材预处理、分段、转场、拼接、字幕、BGM、编码降级；其中图片转短视频的轻微缩放效果适合先替代剪映里的重复操作。
- `upload_post.py` 的自动发布只能作为“发布模块独立、配置开关、状态回读”的参考，不适合直接复用到千牛/光合，因为抓虾必须走平台登录态、商品挂载、发布预检和人工授权。

不建议直接借的部分：

- Pexels/Pixabay/Coverr 等公共素材搜索不符合森马云盘和商品一致性要求。
- 一键跨平台发布不适合本项目。淘系发布要保留 `plan/live` 双模式、商品 ID 回读、文案合规检查和发布后状态确认。

建议落地方式：在 `bala-ai-video-assistant` 里实现类似 `stop_at` 的阶段参数，例如 `pool_import`、`material_prepare`、`swap`、`img2video_submit`、`img2video_fetch`、`compose`、`publish_plan`、`publish_live`、`register`。每个阶段都输出 `stage_manifest.json` 和结果表，下一阶段只消费上阶段已确认产物。

### OpenCut 可借鉴点

本地代码路径：`/Users/xingyicheng/Documents/opencut-classic`

OpenCut 的价值在“可人工审核的时间线编辑器”，不是立刻做批量后端渲染：

- `apps/web/src/app/editor/[project_id]/page.tsx` 的编辑器布局是资产面板、预览、属性、时间线四块，很适合未来给运营做人工复核和微调。
- `apps/web/src/core/index.ts` 把播放、时间线、场景、项目、媒体、渲染、保存、音频、选择、剪贴板、诊断拆成 manager，这个模块边界适合作为抓虾后续“视频审核工作台”的参考。
- `apps/web/src/media/processing.ts` 会在导入时生成缩略图、读取视频元数据、检查浏览器存储；`services/storage/service.ts` 使用 IndexedDB 存项目元数据、OPFS 存项目媒体文件，适合前端本地编辑体验。
- `services/renderer/scene-builder.ts` 把 timeline 元素转成 VideoNode、ImageNode、TextNode 等渲染节点；`scene-exporter.ts` 用 CanvasSource/AudioBufferSource 逐帧导出 MP4/WebM。这证明“时间线 JSON - 渲染节点 - 导出”是可行路径。

本期不建议把 OpenCut 直接作为批量剪辑引擎：

- 它是浏览器本地编辑器，批量产线更需要稳定的后端/本地 CLI 渲染、失败重试和文件归档。
- 逐帧 Canvas 导出更适合人工编辑后的单条导出，面对几百条商品视频时，先用 FFmpeg/Remotion 风格模板批量渲染更稳。

建议落地方式：MVP 先用本地模板渲染生成标准成片，同时生成一份“OpenCut 风格时间线 JSON”作为审核草稿。等标准模板跑通后，再决定是嵌入 OpenCut 式编辑器，还是只保留简化版审核/重剪界面。

### 需要新增或扩展

- 钉钉爆款池导入器：把当前抓取工作簿或钉钉 API 实时抓取结果转成视频工作流行。
- AI 模特替换批处理：捕获并固化软件管家或大森 AI 的上传、生成、历史下载接口。
- 视频成片模板引擎：替代纯剪映手工操作，先支持标准模板成片；剪映保留为人工精修出口。
- 短视频发布适配器：替代影刀 RPA，抓取千牛/光合内容发布接口，先做预检，再在明确授权下 live 发布。
- 质量检测器：对换脸图和视频做机器预检，并把不可自动判断项放到审批看板。

## 建议新增适配器

建议新建 `adapters/bala-ai-video-assistant/`，不要硬塞进现有 AI 测图脚本。AI 测图关注商品图测试，AI 自制视频关注内容生产和发布，两者共享云盘、Prompt、审批、上传能力，但任务语义不同。

建议任务列表：

1. `ai_video_pool_import`
   - 输入：钉钉爆款池工作簿，或钉钉文档 URL + 9222 登录态。
   - 输出：`AI自制视频任务规划_{timestamp}.xlsx`。
   - 核心字段：`row_no`、`record_id`、`batch`、`style_code`、`item_id`、`category`、`gender`、`age_group`、`product_line`、`season`、`fab`、`source_image_url`、`status`。

2. `semir_video_material_prepare`
   - 输入：规划表。
   - 复用：森马云盘 mount/path 解析、searchFiles、download_urls。
   - 输出：每款的模拍图、细节图、候选图清单。
   - 规则：优先最新 `已选` 模拍文件夹，细节图优先 `已写` 或款号命名文件夹；过滤白底、非模拍、重复图；压缩超过阈值的图片。

3. `ai_model_swap_batch`
   - 输入：已筛选模拍图。
   - 页面：软件管家智图或大森 AI 换模特。
   - 输出：换脸图、失败原因、模型选择信息。
   - 安全边界：只允许授权 AI 模特库/品牌授权素材替换；不做指定真人身份换脸；儿童/童模素材必须保留人工审批。

4. `qn_img2video_batch`
   - 输入：每款 3-4 张已确认 AI 模特图。
   - 复用：`mop-ops-assistant/kol-material-img2video-batch.js` 的 MTop 上传、商品解析、提交任务逻辑。
   - 输出：视频任务 ID、视频 URL/本地文件、生成状态。
   - 补充：需要新增轮询下载生成视频的阶段，目前脚本偏向提交任务和结果表。

5. `ai_video_compose_batch`
   - 输入：AI 视频片段、商品细节图、商品标题/FAB、品牌 logo、BGM。
   - 推荐实现：本地 `ffmpeg` 或 Remotion 模板渲染，避免依赖剪映桌面 UI。
   - 默认模板：开头封面文字 1.5-2 秒，AI 模拍动态 8-12 秒，商品细节 4-6 秒，卖点字幕 2-3 条，logo 结尾 1 秒。
   - 输出：成品视频、封面图、字幕/文案 JSON、剪辑审查结果。

6. `qn_short_video_publish`
   - 输入：成品视频、标题、文案、商品 ID、封面图、账号/达人信息。
   - 模式：`plan` 只校验；`live` 上传并发布。
   - 发布前必须检查：极限词、夸大描述、不良舆论、功能与商品详情一致、BGM 授权、视频尺寸/时长/码率、商品 ID 可访问。
   - 输出：发布 ID、发布 URL、千牛回读状态、失败原因。

7. `ai_video_result_register`
   - 输入：发布结果。
   - 动作：写回钉钉登记表、上传成品到森马云盘 `AI自制视频素材` 目录、生成日报/看板。
   - 安全边界：写回钉钉和上传云盘都属于外部状态变更，需显式 live 模式。

## 本期优先链路

本期应按“少碰外部状态、多拿确定收益”的顺序推进：

| 阶段 | 输入 | 自动化方式 | 输出 | 人工闸口 |
| --- | --- | --- | --- | --- |
| 批量找款 | 爆款池 361 条，先筛 `视频导购=1-AI` 的 125 条 | 导入 workbook 或钉钉 API | 任务队列、候选款表 | 确认本批次范围 |
| 批量找图 | 款号、商品 ID、云盘路径 | 森马云盘 API 搜索/下载 | 模拍图、细节图、缺图原因 | 抽检款号匹配 |
| 图片预处理 | 模拍图/细节图 | 本地压缩、过滤白底/非模拍、去重 | 可上传图片包 | 抽检图片质量 |
| AI 换脸/换背景 | 3-4 张候选模拍图 | 软件管家智图/大森 AI 页面 API | AI 模特图、模型信息 | 必审，选 3-4 张 |
| 图生视频 | 已审 AI 图 | 千牛软件管家 `img2video` MTop 提交和轮询 | 原始视频片段、本地归档 | 视频质量必审 |
| 自动剪辑 | 原始视频、细节图、FAB、logo、BGM | FFmpeg/Remotion 风格模板 | 标准成片、封面、时间线 JSON | 可重剪/重生 |
| 发布预检 | 成片、标题、文案、商品 ID | 千牛/光合接口预检 | 发布计划表 | 发布确认 |
| 自动上传/发布 | 已确认发布计划 | `live` 模式上传发布 | 发布 ID、后台回读、登记表 | 仅在明确授权后执行 |

## 数据状态机

每个款号建议维护统一状态：

- `planned`：从爆款池导入。
- `material_found` / `material_missing`：云盘找到或缺失。
- `prepared`：图片过滤和压缩完成。
- `swap_pending` / `swap_done` / `swap_failed`：AI 模特替换阶段。
- `swap_review_required`：需要人工看图。
- `video_submitted` / `video_generated` / `video_failed`：图生视频阶段。
- `compose_done` / `compose_failed`：模板剪辑阶段。
- `publish_prechecked` / `publish_blocked`：发布前校验。
- `published` / `publish_failed`：发布结果。
- `registered`：钉钉和云盘归档完成。

每个状态都应该能重跑，重跑按 `style_code + item_id + stage + input_hash` 做幂等，避免重复上传、重复发布。

## 质检规则

自动预检：

- 商品一致性：服装颜色、品类、主要图案不能明显偏离原图。
- 图片质量：清晰、无遮挡、非白底、文件小于平台阈值。
- 视频质量：时长 15-30 秒优先，画幅 9:16 或 3:4，人物动作无明显崩坏，手部/腿部不严重异常。
- 素材完整度：至少 3 张可用模拍/AI 图，至少 1 张细节图，有商品 ID。
- 文案合规：极限词、夸大承诺、敏感体型/性别表达、功能不一致。
- 授权合规：AI 模特脸、BGM、logo、字体、原始素材来源。

人工审批：

- 换脸图审批：选择可用的 3-4 张图。
- 视频审批：选择可发布视频或标记重剪/重生。
- 发布审批：确认账号、商品、标题、文案、封面、挂品关系。

## 分阶段实施

### MVP 1：规划 + 找款取图 + 证据表

先做 `ai_video_pool_import` 和 `semir_video_material_prepare`。这一步风险最低，能快速把 361 条爆款池变成可执行队列，并验证云盘路径、款号匹配、图片命名规则。输出本地图包和结果表，不触发 AI 生成和发布。

### MVP 2：AI 模特替换 + 审批看板

抓软件管家或大森 AI 的真实接口，固化上传、生成、历史下载。生成结果先进入审批看板，不自动进入视频生成。这个阶段要重点处理额度、失败重试、模型年龄/性别/朝向匹配。

### MVP 3：图生视频 + 视频下载

优先扩展现有 `kol_material_img2video_batch`：补齐任务轮询、视频下载、本地归档、失败恢复。先不做最终发布。

### MVP 4：模板剪辑

用本地视频模板替代剪映重复劳动。剪映只作为人工精修工具，自动化输出一版标准成品。模板参数从品类方法论表生成：痛点、卖点、必拍画面、穿搭场景、挂品目标。

### MVP 5：发布预检 + live 发布

先把影刀 RPA 的输入 Excel、掌柜导出标题、钉钉标题生成、千牛上传发布拆成 API-first 脚本。默认 `plan`，确认后 `live`。发布完成后回读千牛状态和前台/后台可见状态。

### MVP 6：效果回收闭环

复用 `tmall_material_test_data_export` 的思路，定时抓取每日发布量、查看、点击、引导成交数据，把效果反写到爆款池/数据看板。后续按品类、模板、AI 模特、视频结构评估转化。

## 开发文件建议

- `adapters/bala-ai-video-assistant/manifest.yaml`
- `adapters/bala-ai-video-assistant/ai-video-pool-import.js`
- `adapters/bala-ai-video-assistant/semir-video-material-prepare.js`
- `adapters/bala-ai-video-assistant/ai-model-swap-batch.js`
- `adapters/bala-ai-video-assistant/qn-img2video-batch.js`
- `adapters/bala-ai-video-assistant/ai-video-compose-batch.js`
- `adapters/bala-ai-video-assistant/qn-short-video-publish.js`
- `adapters/bala-ai-video-assistant/templates/ai-video-workflow-template.csv`
- `adapters/bala-ai-video-assistant/templates/ai-video-publish-template.csv`
- `tests/bala-ai-video-assistant.test.js`
- `tests/test_bala_ai_video_workflow.py`

## 验证标准

- 工作簿导入：能从爆款池字段生成完整队列，空状态和已上传状态可过滤。
- 云盘找图：随机抽样款号的本地图片与云盘搜索结果一致，缺图原因可解释。
- AI 模特替换：同一输入重跑不会重复提交已成功任务；失败记录能恢复。
- 图生视频：能回读任务 ID、下载视频，并把不可用视频标记为重生/二剪素材。
- 剪辑：输出视频时长、画幅、音轨、logo 结尾、字幕不溢出。
- 发布：`plan` 模式不产生外部发布；`live` 模式需要显式确认，并有后台回读证据。
- 结果：每批都有 Excel/JSON 证据表、素材目录、审批看板链接、失败重跑入口。

## 需要先确认的外部信息

- 软件管家智图和大森 AI 的登录态、额度、接口稳定性。
- 千牛/光合短视频发布接口是否能稳定用页面 MTop/API 复现影刀动作。
- 成品视频最终发布渠道：逛逛、商品短视频、主图短视频、搜推素材，还是多渠道同时发布。
- 森马云盘最终归档目录命名规范和是否需要按批次/品类/款号分层。
- BGM、AI 模特脸、童模原图的授权边界。
