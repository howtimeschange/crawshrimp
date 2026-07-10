# AI Image Workbench Cloud And Local Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the independent Crawshrimp `AI 生图` workbench from the July 3 plan and rewrite the Cloudflare approval workbench `AI 生图` page into the same option-3 generation workbench experience.

**Architecture:** The local Electron app owns local file selection, local output folders, 1XM API-key configuration, and direct 1XM execution through `core/one_xm_image.py`. The Cloudflare app owns shared online generation requests, Worker-held 1XM credentials, R2-hosted assets, prompt-library selection, RBAC, and task-machine dispatch only for local-dependent upload/data-crawl steps. Both surfaces use the same option-3 visual structure: compact top parameter ribbon, left Prompt/material panel, central result grid/canvas/log workspace, and right history drawer.

**2026-07-09 update:** The earlier cloud-generation plan to dispatch `generate_ai_image` to task machines has been superseded. Cloud online generation now uses `POST /api/ai-image-batches/{batch_uid}/generate-direct` plus `POST /api/ai-image-batches/{batch_uid}/generation-requests/{request_uid}/poll`; the Worker calls 1XM `/images/tasks` directly and never exposes API keys to the browser.

**Tech Stack:** Python FastAPI, SQLite, Electron IPC/preload, Vue 3 renderer, Cloudflare Workers, D1, R2, TypeScript, Vitest, Node `node:test`, Python `unittest`.

## Global Constraints

- Visual anchor: use `docs/superpowers/assets/ai-image-workbench-option-3-visual-anchor.png` as the primary UI reference.
- Local `AI 生图` screen: do not show the global Crawshrimp left menu/sidebar while `AI 生图` is open.
- Cloud `AI 生图` screen: do not render another batch-list page; use the option-3 generation workbench layout inside the existing top-tab shell.
- Workbench layout: top title/header, horizontal parameter ribbon, left Prompt/material panel, central batch result grid, right history drawer.
- Subtitle copy: `支持主图、参考图、Prompt、自定义尺寸和多模型生成`.
- Default output folder examples: macOS/Linux `~/Downloads/抓虾导出/AI生图`; Windows `%USERPROFILE%\Downloads\抓虾导出\AI生图`.
- Key behavior: GPT Image 2 uses `ai.1xm.gpt_image_2k_key` / `ai.1xm.gpt_image_4k_key`; Gemini models use separate Gemini key fields.
- Missing key CTA: show `去设置 1XM Key` locally and jump directly to Settings panel `1XM 图片模型`.
- Cloud generation must not expose API keys in D1 rows, R2 objects, job payloads, audit logs, or browser-visible state.
- Cloud online generation should call 1XM directly from the Cloudflare Worker through `/generate-direct`, persist pending upstream task state in `ai_generation_requests`, and append completed images to the batch from R2.

---

## File Structure

- Local backend:
  - `core/config.py`: add Gemini image key defaults.
  - `core/data_sink.py`: add `ai_image_jobs`, `ai_image_assets`, `ai_image_canvases` tables and CRUD helpers.
  - `core/ai_image_service.py`: model metadata, key selection, output path handling, 1XM payload building, run/save-as helpers.
  - `core/api_server.py`: expose `/ai-image/*` routes for local workbench.
- Local renderer:
  - `app/src/renderer/App.vue`: add `AI 生图` route and focus mode.
  - `app/src/renderer/views/SettingsPage.vue`: rename `1XM 图片模型`, add Gemini keys, support focus panel.
  - `app/src/renderer/views/AiImageWorkbench.vue`: local option-3 workbench.
  - `app/src/renderer/utils/aiImageModels.js`: model defaults and key-status helpers.
  - `app/src/renderer/utils/aiImageCanvas.js`: lightweight canvas document helpers.
  - `app/src/main.js`, `app/src/preload.js`, `app/src/renderer/utils/devCsBridge.js`: expose AI image APIs.
- Cloud worker:
  - `cloud/approval-workbench/src/worker/batch-routes.ts`: keep batch-scoped generation route, extend payload validation for model/size/quality/count and resource roles.
  - `cloud/approval-workbench/src/worker/asset-routes.ts`: keep manual asset/R2 upload flow for selected images.
  - `cloud/approval-workbench/src/worker/index.ts`: route any new cloud online-generation endpoints only if batch-scoped routes cannot satisfy the UI.
- Cloud renderer:
  - `cloud/approval-workbench/src/app/views/OnlineGenerationView.vue`: rewrite to option-3 workbench layout with prompt-library selection, resource cards, result grid, direct cloud generation history, and automatic request polling.
  - `cloud/approval-workbench/src/app/App.vue`: keep top tabs and existing `AI 生图` route; no inner sidebar.
- Tests:
  - Python: `tests/test_ai_settings_config.py`, `tests/test_ai_image_data_sink.py`, `tests/test_ai_image_service.py`, `tests/test_ai_image_api.py`.
  - Local Node: `tests/ai-image-workbench-navigation.test.js`, `tests/ai-image-ipc-bridge.test.js`, `app/src/renderer/utils/aiImageModels.test.js`, `app/src/renderer/utils/aiImageCanvas.test.js`.
  - Cloud Vitest: `cloud/approval-workbench/src/tests/review.test.ts`, `cloud/approval-workbench/src/tests/ui-contract.test.ts`, plus a new/extended `cloud/approval-workbench/src/tests/online-generation.test.ts` if needed.

---

## Task 1: Local Settings And Focus Workbench Shell

**Files:**
- Modify: `core/config.py`
- Modify: `tests/test_ai_settings_config.py`
- Modify: `app/src/renderer/App.vue`
- Modify: `app/src/renderer/views/SettingsPage.vue`
- Create: `app/src/renderer/views/AiImageWorkbench.vue`
- Create: `tests/ai-image-workbench-navigation.test.js`

**Interfaces:**
- Produces route id: `ai_image`
- Produces settings focus event: `openSettingsPanel('ai-1xm')`
- Produces settings keys: `ai.1xm.gemini_3_1_flash_image_preview_key`, `ai.1xm.gemini_3_pro_image_preview_key`

- [ ] Write failing backend config tests for GPT Image 2 and Gemini keys.
- [ ] Run `python -m unittest tests.test_ai_settings_config -v` and verify Gemini-key assertions fail.
- [ ] Add Gemini key defaults to `core/config.py`.
- [ ] Write failing static renderer tests for route order, no-sidebar focus mode, option-3 shell classes, subtitle copy, and `1XM 图片模型`.
- [ ] Run `node --test tests/ai-image-workbench-navigation.test.js` and verify it fails before UI changes.
- [ ] Add `AI 生图` route after `任务中心` and before `数据文件`.
- [ ] Hide the global sidebar for `currentView === 'ai_image'`.
- [ ] Update Settings to accept `focusPanelId`, rename `1XM GPT-Image-2` to `1XM 图片模型`, and add Gemini key fields.
- [ ] Create `AiImageWorkbench.vue` as an option-3 shell with `aiw-param-ribbon`, `aiw-prompt-panel`, `aiw-results-grid`, `aiw-history-drawer`, `aiw-generate-footer`, subtitle copy, and `去设置 1XM Key`.
- [ ] Run `python -m unittest tests.test_ai_settings_config -v`, `node --test tests/ai-image-workbench-navigation.test.js`, and `cd app && npm test`.
- [ ] Commit `feat(ai-image): add local workbench shell and model settings`.

## Task 2: Local Persistence, Service, API, And IPC

**Files:**
- Modify: `core/data_sink.py`
- Create: `tests/test_ai_image_data_sink.py`
- Create: `core/ai_image_service.py`
- Create: `tests/test_ai_image_service.py`
- Modify: `core/api_server.py`
- Create: `tests/test_ai_image_api.py`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Modify: `app/src/renderer/utils/devCsBridge.js`
- Create: `tests/ai-image-ipc-bridge.test.js`

**Interfaces:**
- Produces tables: `ai_image_jobs`, `ai_image_assets`, `ai_image_canvases`
- Produces service functions: `default_output_dir`, `select_model_key`, `build_one_xm_payload`, `run_job_with_one_xm`, `copy_assets_to_directory`
- Produces local APIs: `GET/POST /ai-image/jobs`, `GET/PATCH /ai-image/jobs/{job_uid}`, `POST /ai-image/jobs/{job_uid}/run`, `POST /ai-image/jobs/{job_uid}/save-as`, `POST /ai-image/assets`, `POST /ai-image/canvases`
- Produces renderer methods: `window.cs.listAiImageJobs`, `createAiImageJob`, `getAiImageJob`, `updateAiImageJob`, `runAiImageJob`, `saveAsAiImageJob`, `createAiImageAsset`, `createAiImageCanvas`

- [ ] Write failing SQLite CRUD tests for job, asset, canvas.
- [ ] Run `python -m unittest tests.test_ai_image_data_sink -v` and verify helper/table failures.
- [ ] Add schema and CRUD helpers.
- [ ] Write failing pure service tests for default output folders, key selection, missing-key errors, payload image ordering, download, save-as, and no key/data-url leakage.
- [ ] Run `python -m unittest tests.test_ai_image_service -v` and verify module/function failures.
- [ ] Add `core/ai_image_service.py` using existing `core/one_xm_image.py`.
- [ ] Write failing API tests for job CRUD, asset/canvas creation, run with fake service, and save-as.
- [ ] Run `python -m unittest tests.test_ai_image_api -v` and verify route/model failures.
- [ ] Add FastAPI request models and `/ai-image/*` endpoints.
- [ ] Write failing IPC/dev-bridge static tests.
- [ ] Add Electron main/preload/dev bridge methods with HTTP fallback.
- [ ] Run `python -m unittest tests.test_ai_image_data_sink tests.test_ai_image_service tests.test_ai_image_api -v`, `node --test tests/ai-image-ipc-bridge.test.js`, and `cd app && npm test`.
- [ ] Commit `feat(ai-image): add local generation backend and bridges`.

## Task 3: Local Functional Option-3 Workbench UI And Canvas

**Files:**
- Create: `app/src/renderer/utils/aiImageModels.js`
- Create: `app/src/renderer/utils/aiImageModels.test.js`
- Create: `app/src/renderer/utils/aiImageCanvas.js`
- Create: `app/src/renderer/utils/aiImageCanvas.test.js`
- Modify: `app/src/renderer/views/AiImageWorkbench.vue`

**Interfaces:**
- Consumes `window.cs.*AiImage*` methods from Task 2.
- Produces model helper functions: `AI_IMAGE_MODELS`, `defaultAiImageForm`, `missingKeyForModel`, `outputDirHint`.
- Produces canvas helper functions: `createCanvasDocument`, `insertImageNode`, `selectedNodesAsReferences`.

- [ ] Write failing `aiImageModels` tests for model ids, defaults, key detection, and Windows-compatible output hint.
- [ ] Run `cd app && node --test src/renderer/utils/aiImageModels.test.js` and verify missing module failure.
- [ ] Implement `aiImageModels.js`.
- [ ] Write failing `aiImageCanvas` tests for document creation, image insertion, and selected reference extraction.
- [ ] Run `cd app && node --test src/renderer/utils/aiImageCanvas.test.js` and verify missing module failure.
- [ ] Implement `aiImageCanvas.js`.
- [ ] Replace the shell with functional option-3 UI: top parameter ribbon, prompt/material panel, central results grid/canvas/log mode, right history drawer, fixed generate footer, result selection, save-as, set-as-main, add-reference, send-to-canvas.
- [ ] Ensure missing local key calls `emit('open-settings', 'ai-1xm')` and does not call 1XM.
- [ ] Run `cd app && node --test src/renderer/utils/aiImageModels.test.js src/renderer/utils/aiImageCanvas.test.js && npm test && npm run vite:build`.
- [ ] Commit `feat(ai-image): build local option-3 generation UI`.

## Task 4: Cloud Worker Generation Contract

**Files:**
- Modify: `cloud/approval-workbench/src/worker/batch-routes.ts`
- Modify: `cloud/approval-workbench/src/tests/review.test.ts`
- Optionally create: `cloud/approval-workbench/src/tests/online-generation.test.ts`

**Interfaces:**
- Consumes existing `POST /api/ai-image-batches/:batch_uid/generate`.
- Produces an `ai_generation_requests` row with `model`, `size`, `quality`, `output_format`, `count`, `source_asset_uid`, `reference_asset_uids`, `prompt_text`, `prompt_template_version_id`, `style_id`, upstream 1XM task state, and result asset ids.
- Preserves task-machine dispatch only for upload/data-crawl workflows; cloud online generation must not create `dispatch_jobs`.

- [ ] Write failing/extended cloud tests proving generation route accepts model/size/quality/output_format/count and rejects unsafe or unsupported values.
- [ ] Write a failing test proving direct cloud generation does not create `dispatch_jobs`, does not expose API keys, and can continue polling pending 1XM tasks.
- [ ] Run `cd cloud/approval-workbench && npm test -- src/tests/review.test.ts` or the new focused test and verify failures.
- [ ] Extend `createGenerationJob` validation and payload construction without breaking existing batch review generation.
- [ ] Run `cd cloud/approval-workbench && npm test -- src/tests/review.test.ts src/tests/online-generation.test.ts`.
- [ ] Commit `feat(cloud): extend online generation job contract`.

## Task 5: Cloud Option-3 AI Generation Workbench UI

**Files:**
- Modify: `cloud/approval-workbench/src/app/views/OnlineGenerationView.vue`
- Modify: `cloud/approval-workbench/src/tests/ui-contract.test.ts`
- Optionally create: `cloud/approval-workbench/src/tests/online-generation-ui.test.ts`

**Interfaces:**
- Consumes `GET /api/ai-image-batches`, `GET /api/ai-image-batches/:batch_uid`, `GET /api/admin/machines`, `GET /api/prompt-libraries`, `GET /api/prompt-libraries/:id/resolved`, `POST /api/ai-image-batches/:batch_uid/generate`.
- Produces visible classes: `cloud-aiw-param-ribbon`, `cloud-aiw-prompt-panel`, `cloud-aiw-results-grid`, `cloud-aiw-history-drawer`, `cloud-aiw-generate-footer`.
- Produces subtitle copy: `支持主图、参考图、Prompt、自定义尺寸和多模型生成`.

- [ ] Write failing UI contract tests proving the cloud `AI 生图` page is not a batch-list-plus-side-form layout and includes option-3 classes/copy.
- [ ] Run `cd cloud/approval-workbench && npm test -- src/tests/ui-contract.test.ts` and verify failures.
- [ ] Rewrite `OnlineGenerationView.vue` into the option-3 layout: top parameter ribbon, batch/style selector, model/size/quality/format/count, prompt-library and template selector, source/reference resource cards with thumbnails, central result grid from existing AI assets/jobs, right history drawer from generation jobs, and machine picker.
- [ ] Keep the existing top tabs in `App.vue`; do not add an inner sidebar.
- [ ] Ensure submit calls the extended generation contract from Task 4.
- [ ] Run `cd cloud/approval-workbench && npm run check`.
- [ ] Commit `feat(cloud): redesign online generation workbench`.

## Task 6: Integrated Validation

**Files:**
- Modify only if validation reveals concrete defects in touched files.

- [ ] Run local Python focused tests: `python -m unittest tests.test_ai_settings_config tests.test_ai_image_data_sink tests.test_ai_image_service tests.test_ai_image_api tests.test_one_xm_image_client -v`.
- [ ] Run local Node focused tests: `node --test tests/ai-image-workbench-navigation.test.js tests/ai-image-ipc-bridge.test.js`.
- [ ] Run local renderer tests/build: `cd app && node --test src/renderer/utils/aiImageModels.test.js src/renderer/utils/aiImageCanvas.test.js && npm test && npm run vite:build`.
- [ ] Run cloud tests/build: `cd cloud/approval-workbench && npm run check`.
- [ ] Start/reuse local services and verify `http://127.0.0.1:5173` local app shows no global sidebar on `AI 生图`.
- [ ] Verify `http://127.0.0.1:8787/?embed=1` cloud app `AI 生图` tab shows option-3 workbench and existing batch assets/jobs.
- [ ] Run `git diff --check`.
- [ ] Commit final validation fixes with `feat(ai-image): complete local and cloud workbench validation` if needed.

## Self-Review Result

- Spec coverage: The old July 2/3 local spec is covered by Tasks 1-3 and the cloud extension requested on July 8 is covered by Tasks 4-5.
- Boundary check: Local API keys stay local for the desktop workbench; cloud generation uses Worker-held 1XM secrets, stores only redacted request/upstream state, and does not expose secrets to D1 rows, R2 objects, audit logs, or browser-visible state.
- UI consistency: Both local and cloud surfaces reuse the same option-3 structure and copy while respecting their shells.
- Test plan: Every production slice has a failing-test-first path and targeted verification command.
