# Bala AI Video Workflow Code Review Handoff

Date: 2026-07-15

Workspace: `/Users/xingyicheng/Documents/crawshrimp`

## Source Specs

- `docs/superpowers/specs/2026-07-14-bala-ai-video-automation-workflow.md`
- `docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.md`
- `docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-design-review.md`
- `docs/superpowers/specs/2026-07-15-bala-ai-video-workflow-entry-design.html`

The implementation keeps the spec boundaries: five explicit stages, review before video generation, one style code with multiple independently created video tasks, three providers, shared provider CLIs, runtime-only credentials, and no implementation identifiers in the operator UI.

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
- QN/software-manager: the authenticated 9222 page accepted the upload/business request path, but the account returned business code `30001` for insufficient points. No QN generation task ID or MP4 was produced in this run.
- Seedance: the real-person image request hit the provider privacy guard and was safely retried as a text-only original-person task.
  - Task ID: `cgt-20260715210351-472zp`
  - MP4: `/Users/xingyicheng/Downloads/巴拉AI视频素材/208326102205_seedance_20260715-210351.mp4`
- HappyHorse image-to-video:
  - Task ID: `44dabf10-8321-4f57-b682-293e97d568d2`
  - MP4: `/Users/xingyicheng/Downloads/巴拉AI视频素材/208326102205_happyhorse_i2v_20260715-211306.mp4`

The two local MP4 files were checked with media metadata. Seedance is about 8.05 seconds at 834x1112; HappyHorse is about 5.07 seconds at 832x1108. Both are H.264/AAC MP4 files.

## Provider Status

| Provider | Status | Evidence |
| --- | --- | --- |
| QN/software-manager | Real upload/request path reached; generation blocked by account points | 9222 authenticated page and business response `30001` |
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
- stale handoff documentation.

The final live UI readback verified:

- style-code tab, source-type tab, and image scroll area are separate and aligned;
- 480px thumbnails load, while original-image preview remains available;
- direct navigation to the video step restores one style with two candidate assets;
- the task dialog has a folder picker, two magnifier buttons, and two `aria-pressed` asset cards;
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
