# Bala AI Video Workflow Code Review Handoff

Date: 2026-07-15

Workspace: `/Users/xingyicheng/Documents/crawshrimp`

## Original Spec References

The implementation and review should be checked against these source specs:

- `docs/superpowers/specs/2026-07-14-bala-ai-video-automation-workflow.md`
- `docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.md`
- `docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-design-review.md`
- `docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.html`

Key product rules from the specs:

- `AI 视频` is a first-level app entry below `AI 生图`.
- The workflow is a real five-step operator surface: material prepare -> AI image edit -> review -> explicit video task creation -> results.
- Material prepare starts from `semir_video_material_prepare` and groups results by style code.
- AI image editing reuses `bala_ai_face_background_generate`, keeps `AI 换脸 / AI 换背景 / AI 换装 / AI 换姿势` as separate actions, and sends generated assets into review.
- Video generation must be explicit `新增视频任务`; do not directly turn every image into a video.
- QN/software-manager video provider reuses `qn_img2video_batch`.
- Seedance provider must reuse `integrations/seedanceCLI`; do not reimplement Ark API inside the app.
- HappyHorse provider must reuse the migrated Bailian CLI from `integrations/bailianCLI`; do not reimplement DashScope / Bailian API inside the app.
- No API keys in source. GPT Image / Ark / Seedance / DashScope / Bailian credentials must come from AI capability config or environment.
- Main UI must not expose implementation identifiers such as script ids, `integrations/seedanceCLI`, `integrations/bailianCLI`, `ARK_API_KEY`, or `DASHSCOPE_API_KEY`.
- Long tasks need loading/progress/error/retry states.
- Modals need `role=dialog`, `aria-modal`, focus trap, Escape close, and background inert.

## Current Implementation Status

Implemented in this worktree:

- `AI 视频` first-level navigation entry and dedicated `AiVideoWorkflow.vue`.
- Five-step workflow shell with dark Crawshrimp workbench styling.
- Material step:
  - Batch style-code input.
  - Real `semir_video_material_prepare` task submit/poll/finalize path.
  - Material batch creation from task Excel output.
  - Style-code grouped material cards with expand/collapse, selection state, image preview, skipped/issue rows.
- AI edit step:
  - Four action tiles: face/background/outfit/pose.
  - Real model library API loading via `listBalaModelLibrary`.
  - Model picker modal with age/gender groups and real image thumbnails.
  - Real AI stage submit path through material selection export and `bala_ai_face_background_generate`.
  - Outfit references now wire `garment_images`, `outfit_reference_images`, and `variant_reference_images`.
  - Review batch URL parsing and review pool refresh.
- Review step:
  - Card-based review pool, status filters, approve/reject/rerun/refresh.
  - Persisted review decisions through backend review APIs.
  - Approved/pending/retry/source assets flow into the video task asset pool.
- Video task step:
  - Explicit `新增视频任务` modal.
  - Per-task style code, provider, group mode, prompt, output dir, optional template, selected images.
  - Images display approved/pending/retry/source state labels.
  - QN provider builds `qn_img2video_batch` params for `plan` and `live`.
  - Seedance provider calls backend bridge to `integrations/seedanceCLI`.
  - Template library loads real local catalog from `/Users/xingyicheng/Downloads/巴拉AI视频模板库`.
- Results step:
  - Card layout with progress, status, task id, local MP4 path, preview/open/retry actions.
- Backend/API additions:
  - Local software-manager template catalog loader and `/bala-ai-video-templates/api`.
  - Seedance request model, payload builder, CLI runner, and `/bala-ai-video-seedance/api/run`.
  - Electron/preload/dev bridge methods for templates and Seedance.
- Accessibility/design review items:
  - Custom modals now have dialog semantics, Escape close, focus trap, and background inert.
  - Main AI edit action text is `开始生图`.
  - Implementation terms are not exposed in the main operator UI.

Not yet completed:

- HappyHorse / 百炼 provider is now specified but not yet migrated into `integrations/bailianCLI` in this worktree.
- Full real external chain for style `208326102205` through software-manager upload/generation/download has not been completed in this session.
- Final code review has not yet been performed after the latest front-end patch.
- Final full test/build suite has not been rerun after the latest front-end patch.
- No local commit has been created yet.

## Runtime State At Handoff

The local development environment was started and smoke-tested:

- Backend: `http://127.0.0.1:18765`, data dir `.crawshrimp-dev-ai-video`
- Frontend Vite: `http://127.0.0.1:5173`, started from `app/`
- Electron app shell: running via `npm exec electron .`
- Dedicated CDP Chrome: `127.0.0.1:9222`

Important note: an earlier Vite instance was accidentally started from the repo root and returned `HTTP 404`. It was stopped and replaced with the correct `app/` Vite server.

Smoke evidence:

- `AI 视频工作流` page rendered in the app shell.
- Model library modal showed 70 real model thumbnails and the expected age/gender groups.
- Video task dialog showed both software-manager and Seedance providers.
- Modal background inert was true.
- 390px mobile viewport reported no horizontal overflow.
- Template API returned 26 templates, first template `641241_62536236_21`.

## Current Git State And Files

Tracked modified files:

- `app/src/main.js`
- `app/src/preload.js`
- `app/src/renderer/App.vue`
- `app/src/renderer/utils/balaAiVideoWorkflow.js`
- `app/src/renderer/utils/devCsBridge.js`
- `core/api_server.py`
- `tests/bala-ai-video-workflow-ui.test.js`
- `tests/test_bala_ai_video_assistant_packaging.py`

New relevant untracked files/directories:

- `app/src/renderer/views/AiVideoWorkflow.vue`
- `integrations/seedanceCLI/.env.example`
- `integrations/seedanceCLI/.gitignore`
- `integrations/seedanceCLI/README.md`
- `integrations/seedanceCLI/bin/seedance.js`
- `integrations/seedanceCLI/src/ark-client.js`
- `integrations/seedanceCLI/src/config.js`
- `integrations/seedanceCLI/test/ark-client.test.js`
- `integrations/seedanceCLI/examples/*.json`

Do not stage unrelated or runtime files:

- `.crawshrimp-dev-ai-video/`
- `.crawshrimp-dev-live-test/`
- `.crawshrimp-dev/`
- `tmp-tmall-packaging-*.csv`
- `integrations/.DS_Store`
- Unrelated untracked July 12 spec drafts unless the user explicitly asks for them.

## Validation Already Run

Latest after the most recent front-end patch:

```bash
node --test tests/bala-ai-video-workflow-ui.test.js
```

Result: pass, 14/14.

Earlier in this work sequence before the last front-end patch, the following were reported as passing and should be rerun after review/fixes:

```bash
python3 -m unittest tests.test_bala_ai_video_assistant_packaging
npm --prefix integrations/seedanceCLI test
npm --prefix app run vite:build
npm --prefix app test
```

## Code Review Checklist

Review focus areas:

1. Front-end workflow state:
   - `AiVideoWorkflow.vue` is large and should be reviewed for stale state, bad computed dependencies, duplicate actions, and accidental mock-only paths.
   - Verify material -> AI -> review -> video task data contracts.
   - Confirm all long actions have visible running/failed/retry paths.

2. Provider boundaries:
   - QN path should only call `qn_img2video_batch`.
   - Seedance path should only call `integrations/seedanceCLI`; no Ark API logic should be embedded directly into the app surface.
   - HappyHorse path should only call `integrations/bailianCLI`; no DashScope / Bailian API logic should be embedded directly into the app surface.
   - No API keys should appear in source, tests, fixtures, docs, logs, or summaries.

3. External side effects:
   - Code review should be read-only.
   - Live software-manager upload/generation/download for `208326102205` should happen only after review fixes and with current 9222/login state verified.

4. Accessibility and UI polish:
   - Verify all four modals have dialog semantics and focus behavior.
   - Check desktop and mobile overflow.
   - Check orange is limited to primary/current-step emphasis, with status labels carrying text.
   - Main UI should not show script ids or secret/config names.

5. Backend safety:
   - Review `_load_bala_video_template_catalog`, `_parse_seedance_cli_json_objects`, `_build_seedance_payload`, and `_run_seedance_cli`.
   - Confirm CLI stdout/stderr sanitization does not leak credentials.
   - Confirm local image handling for Seedance is acceptable for the CLI provider contract.

6. Tests:
   - Add or refine tests if review finds state-machine or parser edge cases.
   - Rerun all validation commands after fixes.

## Recommended Next-Agent Prompt

Use this prompt for the next agent:

```text
你接手的仓库是 /Users/xingyicheng/Documents/crawshrimp。

请先不要提交、不要开无关子任务。先读：
- docs/superpowers/specs/2026-07-14-bala-ai-video-automation-workflow.md
- docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.md
- docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-design-review.md
- docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.html
- docs/superpowers/plans/2026-07-15-bala-ai-video-workflow-codereview-handoff.md

然后做一次独立 code review，重点审查：
- app/src/renderer/views/AiVideoWorkflow.vue
- app/src/renderer/utils/balaAiVideoWorkflow.js
- core/api_server.py
- app/src/main.js
- app/src/preload.js
- app/src/renderer/utils/devCsBridge.js
- tests/bala-ai-video-workflow-ui.test.js
- tests/test_bala_ai_video_assistant_packaging.py
- integrations/seedanceCLI/

审查目标：
1. 对齐原 spec 和设计审查报告，确认 AI 视频工作流不是静态示意，而是真实接通五阶段能力。
2. 检查 material prepare -> AI 改图 -> review -> 新增视频任务 -> QN/Seedance/HappyHorse -> results 的状态、错误、重试、数据契约。
3. 确认 Seedance 只复用 integrations/seedanceCLI，不在 app/core 里重写 Ark API。
4. 确认 HappyHorse 只复用迁移后的 integrations/bailianCLI，不在 app/core 里重写 DashScope / Bailian API。
5. 确认没有 API key 或 secret 被写入源码、测试、文档或日志。
6. 确认主界面没有暴露 semir_video_material_prepare、integrations/seedanceCLI、integrations/bailianCLI、ARK_API_KEY、DASHSCOPE_API_KEY 等实现词。
7. 检查弹窗 role=dialog、aria-modal、Escape、focus trap、background inert 是否完整。
8. 检查真实模特库和本地软件管家模板库显示。
9. 检查 untracked runtime 目录、CSV、.DS_Store 不要被 stage。

当前运行态：
- 后端 http://127.0.0.1:18765
- Vite http://127.0.0.1:5173，从 app/ 目录启动
- Electron 应用壳已启动
- CDP Chrome 127.0.0.1:9222

先输出 review findings，按 P0/P1/P2 排序并引用具体文件/行。然后在主会话修复确认的问题。修复后至少跑：
- node --test tests/bala-ai-video-workflow-ui.test.js
- python3 -m unittest tests.test_bala_ai_video_assistant_packaging
- npm --prefix integrations/seedanceCLI test
- npm --prefix integrations/bailianCLI test （迁移 HappyHorse 后）
- npm --prefix app run vite:build
- npm --prefix app test

如果 review 和测试通过，再按用户前序要求继续用款号 208326102205 做真实全链路联调，到软件管家上传视频、生成并下载本地 MP4 为止。执行 live 前核对 9222 登录态和外部页面状态；不要把任何 API key 写入文件。
```
