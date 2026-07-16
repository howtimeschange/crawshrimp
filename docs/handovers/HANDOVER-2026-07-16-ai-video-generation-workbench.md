# 交接：AI 生视频工作台落地

日期：2026-07-16  
范围：通用「AI 生视频」工作台（非巴拉五步「AI 视频工作流」）

## 1. 本轮结论

已在抓虾落地独立一级菜单 **AI 生视频**，完成：

- 前后端 job/run 异步链路（create → poll get → download archive）
- Seedance 2.0 + HappyHorse 1.1（按是否传图/数量自动选 t2v/i2v/r2v）
- 预估花费、poster 封面、本地媒体播放协议、左栏三段式布局
- 单元测试、真实 5s 冒烟（Seedance / HappyHorse 各 1 条）

原 **AI 视频** 菜单已改名为 **AI 视频工作流**（id 仍为 `ai_video`）。

## 2. 关键路径

| 层 | 路径 |
| --- | --- |
| Spec | `docs/superpowers/specs/2026-07-16-ai-video-generation-workbench-design.md` |
| 视觉锚点 | `docs/superpowers/specs/2026-07-16-ai-video-generation-workbench-design.html` |
| 前端页面 | `app/src/renderer/views/AiVideoGenerationWorkbench.vue` |
| 定价工具 | `app/src/renderer/utils/aiVideoPricing.mjs` |
| 后端服务 | `core/ai_video_generation_service.py` |
| 存储 | `core/data_sink.py`（`ai_video_jobs/assets/runs`） |
| HTTP | `core/api_server.py`（`/ai-video/*`） |
| IPC | `app/src/main.js` + `app/src/preload.js`（`ai-video:*`、`crawshrimp-media`） |
| 测试 | `tests/test_ai_video_generation_*.py`、`app/src/renderer/utils/aiVideoPricing.test.js` |

## 3. 产品行为摘要

### 导航

- 顺序：`AI 生图` → **`AI 生视频`** → **`AI 视频工作流`**
- 路由视图：`ai_video_generation`

### 模型

- UI 仅两档：**Seedance 2.0** / **HappyHorse 1.1**
- HappyHorse 模式由图片数量决定：
  - 0 张 → `happyhorse-1.1-t2v`（文生）
  - 1 张 → `happyhorse-1.1-i2v`（图生，隐藏比例）
  - 2–9 张 → `happyhorse-1.1-r2v`（参考生，可插入 `[Image n]`）
- Seedance：0–4 张 reference_image，可生成音频

### 参考图入口

- **本地上传**：系统文件多选
- **本地参考图库**：选文件夹扫描 jpg/png/webp，网格多选；路径记 localStorage

### 异步与归档

- `create` 只调 CLI `create`，禁止 wait/download
- worker `get` 轮询；成功后下载 `output.mp4` 并抽 `poster.jpg`
- poster：ffmpeg → macOS qlmanage+sips → 首张参考图回退
- list/get 会对缺 poster 的 completed 任务补抽

### 播放

- 详情页**不能**直接用 `file://` 播 MP4
- 使用自定义协议 `crawshrimp-media://` + Range 流
- 默认授权 `~/Downloads/抓虾AI生视频` 等；选输出目录时自动授权
- **改协议后必须完整重启 Electron**，热刷新不够

### 预估花费（前端快照，非实时账单）

- HappyHorse：720P `0.9 元/秒`，1080P `1.2 元/秒`
- Seedance：约 `1 元/秒`（720p 公开口径）
- UI 标明「以控制台结算为准」

### 左栏布局

- 顶：模型选择（固定）
- 中：Prompt / 参考图 / 参数 / 输出目录（可滚动）
- 底：payload + 预估花费 + 重置/生成（固定）

## 4. API / IPC 一览

| HTTP | IPC |
| --- | --- |
| `GET /ai-video/config` | `ai-video:get-config` |
| `POST /ai-video/validate` | `ai-video:validate` |
| `POST /ai-video/jobs` | `ai-video:create-job` |
| `GET /ai-video/jobs` | `ai-video:list-jobs` |
| `GET /ai-video/jobs/:id` | `ai-video:get-job` |
| `PATCH /ai-video/jobs/:id` | `ai-video:update-job` |
| `POST .../duplicate` | `ai-video:duplicate-job` |
| `POST .../retry` | `ai-video:retry-job` |
| `DELETE ...` | `ai-video:delete-job-record` |
| `GET /ai-video/runs/:id` | `ai-video:get-run` |
| `POST /ai-video/runs/:id/archive` | `ai-video:retry-archive` |

媒体：

- `authorize-local-media-root`
- `get-local-media-url` → `crawshrimp-media://local/<payload>`

## 5. 凭据

- 设置 → AI 能力：`ai.video.seedance_api_key` / `ai.video.bailian_api_key` 等
- 冒烟时曾用数据目录：`.crawshrimp-dev-ai-video`（`CRAWSHRIMP_DATA`）

## 6. 验证命令

```bash
# 单元
./venv/bin/python -m pytest tests/test_ai_video_generation_service.py tests/test_ai_video_generation_api.py -q
node --test app/src/renderer/utils/aiVideoPricing.test.js
npm --prefix integrations/seedanceCLI test
npm --prefix integrations/bailianCLI test
npm --prefix app run vite:build

# 真实冒烟（付费，需凭据；示例）
CRAWSHRIMP_DATA=/path/to/data-with-keys PYTHONUNBUFFERED=1 ./venv/bin/python -u scripts/...  # 或直接调 service.create_job
```

真实冒烟结果目录示例：

`~/Downloads/抓虾AI生视频/smoke-2026-07-16/`

## 7. 已知限制 / 后续

1. poster 依赖本机 `ffmpeg` 或 macOS `qlmanage`；无则尝试参考图回退。
2. 预估价是文档快照，不是控制台实时价。
3. 本地参考图库是「用户选文件夹扫描」，未接巴拉款号素材库。
4. 详情播放依赖 `crawshrimp-media` 协议授权根目录。
5. 未做：批量生成、Prompt 库、云协作、视频/音频参考输入。
6. 改 main 协议后必须冷启动桌面端。

## 8. 启动 Prompt（给下一任 agent）

见同目录旁或本文件文末「启动 Prompt」一节；可直接复制使用。

---

## 启动 Prompt

```text
你在 crawshrimp 仓库继续「AI 生视频」工作台相关工作。

背景：
- Spec: docs/superpowers/specs/2026-07-16-ai-video-generation-workbench-design.md
- 视觉锚点: docs/superpowers/specs/2026-07-16-ai-video-generation-workbench-design.html
- 交接: docs/handovers/HANDOVER-2026-07-16-ai-video-generation-workbench.md
- 页面: app/src/renderer/views/AiVideoGenerationWorkbench.vue
- 后端: core/ai_video_generation_service.py
- 存储表: ai_video_jobs / ai_video_assets / ai_video_runs（data_sink）
- HTTP: /ai-video/* ；IPC: ai-video:*
- 本地视频播放: crawshrimp-media 协议（main.js），禁止依赖 file:// 播 MP4
- 模型 UI 仅 Seedance 2.0 / HappyHorse 1.1；HappyHorse 模式按 0/1/2-9 张图自动 t2v/i2v/r2v
- create 禁止 wait/--download；归档后抽 poster.jpg

约束：
1. 不要把通用生视频 job 混入巴拉 AI 视频工作流数据结构。
2. 不要在 UI 暴露 API key、endpoint、raw JSON、poll/timeout。
3. 不要静默切换 provider/model。
4. 改 Electron protocol/main 后提醒完整重启桌面端。
5. 真实付费 provider 调用不要塞进 CI。

请先阅读交接文档与当前 git 状态，确认本地可运行后再改代码；改完跑：
./venv/bin/python -m pytest tests/test_ai_video_generation_service.py tests/test_ai_video_generation_api.py -q
npm --prefix app run vite:build
```
