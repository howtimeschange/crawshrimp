# Bala AI Video Workflow Code Review Handoff

Date: 2026-07-15

Workspace: `/Users/xingyicheng/Documents/crawshrimp`

## Source Specs

- `docs/superpowers/specs/2026-07-14-bala-ai-video-automation-workflow.md`
- `docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.md`
- `docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-design-review.md`
- `docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.html`

The implementation keeps the spec boundaries: five explicit stages, review before video generation, one style code with multiple independently created video tasks, three providers, shared provider CLIs, credentials sourced only from `设置 -> AI 能力`, and no implementation identifiers in the operator UI.

## Delivered Implementation

### Material workspace

- The first step opens the Semir cloud-drive task in a new browser page by default and waits for a newly created run instead of silently binding an old run.
- The workspace directory uses the native folder picker and is shared with the video output default.
- Search and download use separate progress bars.
- Downloaded assets are restored from the selected workspace, grouped by style-code tabs, and split into model/detail tabs.
- Only one style and one asset type render at a time; model photos are the default view and no asset is selected by default.
- The style tabs, source tabs, and independently scrolling image area occupy separate grid rows.
- Cards use lazy 480px WebP thumbnails; the magnifier opens the original image. Pagination limits the initial DOM/image count.

### AI image and review

- Face, background, outfit, and pose edits use the existing AI image job capability.
- AI generation waits for a new run and cannot reuse the previous task result.
- The real model library, review persistence, approve/reject/retry actions, review restoration, and video handoff are connected.
- Model, template, source, and video asset cards have keyboard selection and `aria-pressed` state.

### Explicit video tasks

- Video generation remains an explicit `新增视频任务` flow. One style code can own multiple tasks.
- Entering the video step directly restores the latest review batch and rebuilds the style asset pool before the task dialog opens.
- The task output directory is a folder picker, not a text path field.
- Image selection and original-image preview are separate controls.
- QN/software-manager launches wait for a new task run and preserve every injected file when different paths share the same basename.
- Seedance and HappyHorse are invoked through `integrations/seedanceCLI` and `integrations/bailianCLI`; the application layer only builds payloads, invokes the CLI, parses status, and archives the result.
- Packaged desktop builds copy both shared integrations and run them with the bundled Electron executable in Node mode, without requiring a system Node installation.
- Provider subprocesses have an outer timeout and are killed on timeout. Local provider inputs reject unsupported, oversized, or invalid image files.

### Operator UI and recovery

- The main UI does not display script IDs, integration paths, or provider credential variable names.
- Long-running stages expose running, partial, failed, done, progress, reason, and retry states.
- All custom dialogs have dialog semantics, Escape close, focus containment, and inert background behavior.
- Video result counts use live task data; failed cards show the concrete failure reason.

## Real Integration Evidence

Style code: `208326102205`

- Material search/download: completed with 127 local assets (48 model photos and 79 detail photos).
- AI image edit and review: completed; the approved AI result was restored into the video asset pool.
- AI image task IDs:
  - Background: `0d546dbb6576483e88d404e02947661b`
  - Face: `73472428e5cd4d27bc9781f6bcc6274c`
  - Outfit: `aabfe5b0bdb244e785b0a7e6f33b45db`
  - Pose: `35fa6ff0cec04700b88434d4c7080aa5`
  - Precise single-image edit: `3b0dcbcb310d49f0a45aa1ef826ecdee`
- QN/software-manager: run ID `22` ended as `error`. The live `9222` tab is currently `https://loginmyseller.taobao.com/`, and the task failed with `生意管家页面加载超时，请保留已登录页面后重试` before a verifiable upload/generation task was created. No QN provider task ID or MP4 is claimed.
- Seedance: the real-person image request hit the provider privacy guard and was safely retried as a text-only original-person task.
  - Task ID: `cgt-20260716015202-rpz94`
  - MP4: `/Users/xingyicheng/Downloads/巴拉AI视频素材/208326102205-20260715-live/208326102205_seedance_20260716-015202.mp4`
- HappyHorse image-to-video:
  - Task ID: `4a9890b4-191c-4359-86b9-83ba0adb0949`
  - MP4: `/Users/xingyicheng/Downloads/巴拉AI视频素材/208326102205-20260715-live/208326102205_happyhorse_i2v_20260716-015636.mp4`

The two local MP4 files were checked with filesystem and media metadata. Seedance is 2,541,250 bytes, 5.042 seconds, 834x1112; HappyHorse is 4,933,284 bytes, 5.075 seconds, 832x1108. Both are H.264/AAC MP4 files.

## Provider Status

| Provider | Status | Evidence |
| --- | --- | --- |
| QN/software-manager | Implementation connected; current real run blocked before upload by logged-out 9222 session | Run ID `22`, login-page observation, terminal error propagated to the UI |
| Seedance | Real provider connected | Real task ID and downloaded MP4 above |
| HappyHorse | Real provider connected | Real task ID and downloaded MP4 above |
| Automatic compose/publish/register | Plan only | Outside this MVP and not presented as connected |

## Code Review Closure

Three read-only review passes reported no P0. Confirmed P1/P2 findings were reproduced and fixed:

- stale AI/QN run binding;
- missing integrations in desktop packaging and reliance on system Node;
- same-basename QN upload collision;
- missing provider local-image validation and outer CLI timeout;
- incomplete card keyboard/ARIA behavior;
- video task text-path field and double-click preview;
- remote review-save failure incorrectly becoming approved;
- local precise-edit approval without a remote batch not being persisted;
- QN terminal and workbook-row failures being presented as success;
- dangerous click/download/paginate checks trusting the requested action instead of the matched control;
- sensitive query values in old journal observations, actions, verifications, and failures, including relative URLs embedded in prose;
- failed result cards exposing preview/download actions for nonexistent files;
- stale handoff documentation;
- provider credentials falling back to application startup environment variables instead of only `设置 -> AI 能力`;
- review-token-only video export granting an arbitrary local output-directory write surface without local API authentication;
- concurrent review decisions, deletion, refresh, and regeneration losing updates through non-atomic read/modify/write;
- pending-only styles entering the video stage without any approved asset;
- Seedance/HappyHorse plan mode reporting success without a real backend provider preflight;
- submitted tasks being able to create duplicate external runs, including the preflight-reset bypass after submission.

The final live UI readback verified:

- style-code tab, source-type tab, and image scroll area are separate and aligned;
- 480px thumbnails load, while original-image preview remains available;
- direct navigation to the video step restores one style with two candidate assets;
- the task dialog has a folder picker, two magnifier buttons, and two `aria-pressed` asset cards;
- the failed software-manager result card shows the concrete login blocker and only offers `返回生视频`;
- none of the forbidden implementation identifiers appear in any of the five visible steps.

## Validation Bundle

The delivery gate is:

```bash
node --test tests/bala-ai-video-workflow-ui.test.js
python3 -m unittest tests.test_bala_ai_video_assistant_packaging
npm --prefix integrations/seedanceCLI test
npm --prefix integrations/bailianCLI test
node --test tests/bala-ai-video-assistant-qn-img2video.test.js
npm --prefix app run vite:build
npm --prefix app test
python3 -m unittest tests.test_bala_ai_video_materials tests.test_bala_ai_video_review tests.test_ai_settings_config
git diff --check
```

Provider credentials are not stored in source, tests, documentation, fixtures, result summaries, or logs. The example environment files contain placeholders only.

Fresh delivery results:

- Workflow UI: 59/59 passed.
- Bala provider packaging: 29/29 passed.
- Bala review/security pytest bundle: 25/25 passed.
- Bala material/review/settings unittest bundle: 11/11 passed.
- Seedance CLI: 6/6 passed.
- HappyHorse CLI: 8/8 passed.
- QN/software-manager adapter: 13/13 passed.
- Desktop application tests: 244/244 passed.
- Crawshrimp skill tests: 75/75 passed.
- Vite production build: passed; only the existing large-chunk warning remains.
- Credential candidate scan: 0 files.
- `git diff --check`: passed.
