# AI Image Loading State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show contextual, rotating Crawshrimp-themed loading cards for AI image runs and remove the generated-result parameter summary from the workspace header.

**Architecture:** Persist a compact input-image snapshot on each workbench run, then use a small renderer utility to resolve main-image, first-reference, or text-only loading contexts. `AiImageWorkbench.vue` owns the timer and presentation while the utility owns deterministic selection and copy rotation.

**Tech Stack:** Python 3, SQLite JSON summaries, Vue 3, JavaScript ES modules, Node test runner, Python unittest, Vite

## Global Constraints

- Work only in `/Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench` on `codex/cloud-approval-workbench`.
- Preserve AI 测图 execution through `core.one_xm_image.run_image_task_until_done()` and `core.api_server._run_one_xm_generation_row()`.
- Main image wins; when it is absent, the first reference image wins; text-only runs use the default Crawshrimp artwork.
- Loading copy rotates through seven approved Crawshrimp phrases without changing provider polling cadence.
- Remove only the workspace header summary; keep left-side next-run controls and task-record metadata.
- Preserve unrelated dirty cloud dashboard and Tmall manifest files.

---

### Task 1: Persist workbench input-image snapshots

**Files:**
- Modify: `core/ai_image_service.py:404-475, 624-710`
- Modify: `tests/test_ai_image_service.py`
- Modify: `tests/test_ai_image_workbench_batch.py`

**Interfaces:**
- Produces: `_workbench_input_snapshot(params: Mapping[str, Any]) -> dict[str, Any]`
- Produces persisted run field: `input_params.main_image_path` and `input_params.reference_image_paths`
- Preserves: AI 测图 methods and `core/one_xm_image.py`

- [ ] **Step 1: Write failing snapshot tests**

Add assertions to the existing single-run and batch-run tests:

```python
self.assertEqual(run["input_params"], {
    "main_image_path": "/tmp/main.png",
    "reference_image_paths": ["/tmp/ref-a.png", "/tmp/ref-b.png"],
})
```

For the batch test, set these paths in the job `params` before calling `submit_workbench_batch()` and assert all newly persisted runs carry the same snapshot.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
./venv/bin/python -m unittest \
  tests.test_ai_image_service.AiImageServiceTests.test_run_job_saves_remote_urls_without_blocking_on_local_downloads \
  tests.test_ai_image_workbench_batch.AiImageWorkbenchBatchTests.test_batch_submits_all_prompts_concurrently_and_persists_task_handles -v
```

Expected: FAIL because `input_params` is absent from run records.

- [ ] **Step 3: Implement the compact input snapshot**

Add the helper near `_normalized_edit_source`:

```python
def _workbench_input_snapshot(params: Mapping[str, Any]) -> dict[str, Any]:
    return {
        "main_image_path": _compact(params.get("main_image_path")),
        "reference_image_paths": _string_list(params.get("reference_image_paths")),
    }
```

Add this field to `_merge_run_summary()` and `submit_workbench_batch()` run records:

```python
"input_params": _workbench_input_snapshot(params),
```

- [ ] **Step 4: Run service tests and verify GREEN**

Run:

```bash
./venv/bin/python -m unittest tests.test_ai_image_service tests.test_ai_image_workbench_batch -v
```

Expected: all selected tests PASS.

- [ ] **Step 5: Commit Task 1**

```bash
git add core/ai_image_service.py tests/test_ai_image_service.py tests/test_ai_image_workbench_batch.py
git commit -m "feat(ai-image): persist loading input snapshots"
```

### Task 2: Resolve loading artwork and rotate Crawshrimp copy

**Files:**
- Create: `app/src/renderer/utils/aiImageLoadingState.mjs`
- Create: `tests/ai-image-loading-state.test.js`
- Modify: `app/src/renderer/views/AiImageWorkbench.vue:289-305, 930-1085, 1899-1930, 3609-3730`
- Modify: `tests/ai-image-workbench-async-batch.test.js`

**Interfaces:**
- Produces: `AI_IMAGE_LOADING_MESSAGES: string[]`
- Produces: `resolveLoadingPreviewContext(job, run, fallback) -> { previewPath: string, mode: 'input'|'text' }`
- Produces: `loadingMessageFor(tick, offset) -> string`
- Consumes: run `input_params` from Task 1 and existing `imagePreviewSrc()` / `refreshImagePreview()`.

- [ ] **Step 1: Write failing utility and component-contract tests**

Create `tests/ai-image-loading-state.test.js`:

```javascript
const assert = require('node:assert/strict')
const test = require('node:test')

test('loading preview prefers run main, then first reference, then text artwork', async () => {
  const { resolveLoadingPreviewContext } = await import('../app/src/renderer/utils/aiImageLoadingState.mjs')
  assert.deepEqual(resolveLoadingPreviewContext({}, {
    input_params: { main_image_path: '/main.png', reference_image_paths: ['/ref.png'] },
  }), { previewPath: '/main.png', mode: 'input' })
  assert.deepEqual(resolveLoadingPreviewContext({}, {
    input_params: { reference_image_paths: ['/ref.png', '/ref-b.png'] },
  }), { previewPath: '/ref.png', mode: 'input' })
  assert.deepEqual(resolveLoadingPreviewContext({}, {}), { previewPath: '', mode: 'text' })
})

test('loading copy cycles through all Crawshrimp phrases', async () => {
  const { AI_IMAGE_LOADING_MESSAGES, loadingMessageFor } = await import('../app/src/renderer/utils/aiImageLoadingState.mjs')
  assert.equal(AI_IMAGE_LOADING_MESSAGES.length, 7)
  assert.equal(loadingMessageFor(7, 0), AI_IMAGE_LOADING_MESSAGES[0])
  assert.equal(loadingMessageFor(0, 2), AI_IMAGE_LOADING_MESSAGES[2])
})
```

Extend the async component test to assert `.aiw-loading-source`, `.aiw-loading-default-art`, `loadingMessageTimer`, and timer cleanup exist.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/ai-image-loading-state.test.js tests/ai-image-workbench-async-batch.test.js
```

Expected: FAIL because the utility and contextual template do not exist.

- [ ] **Step 3: Implement the deterministic renderer utility**

Create `aiImageLoadingState.mjs`:

```javascript
export const AI_IMAGE_LOADING_MESSAGES = [
  '正在出海',
  '正在撒网',
  '正在寻找灵感海域',
  '正在捕捞画面',
  '正在收网',
  '正在挑选大虾',
  '正在满载返航',
]

const text = (value) => String(value || '').trim()
const paths = (value) => Array.isArray(value) ? value.map(text).filter(Boolean) : []

export function resolveLoadingPreviewContext(job = {}, run = {}, fallback = {}) {
  const runParams = run.input_params && typeof run.input_params === 'object' ? run.input_params : {}
  const jobParams = job.params && typeof job.params === 'object' ? job.params : {}
  const mainImagePath = text(runParams.main_image_path || jobParams.main_image_path || fallback.mainImagePath)
  const referenceImagePaths = paths(
    runParams.reference_image_paths?.length
      ? runParams.reference_image_paths
      : jobParams.reference_image_paths?.length
        ? jobParams.reference_image_paths
        : fallback.referenceImagePaths,
  )
  const previewPath = mainImagePath || referenceImagePaths[0] || ''
  return { previewPath, mode: previewPath ? 'input' : 'text' }
}

export function loadingMessageFor(tick = 0, offset = 0) {
  const index = Math.abs(Number(tick) + Number(offset)) % AI_IMAGE_LOADING_MESSAGES.length
  return AI_IMAGE_LOADING_MESSAGES[index]
}
```

- [ ] **Step 4: Wire loading contexts, previews, timer, and markup**

Import the utility, attach `loadingPreviewPath`, `loadingMode`, and `loadingMessageOffset` to temporary and persisted placeholders, and add:

```javascript
const loadingMessageTick = ref(0)
let loadingMessageTimer = null

function loadingMessage(item) {
  return loadingMessageFor(loadingMessageTick.value, item?.loadingMessageOffset || 0)
}

function loadingPreviewSrc(item) {
  return item?.loadingPreviewPath ? imagePreviewSrc(item.loadingPreviewPath) : ''
}
```

Start a 2400 ms interval on mount that advances only when loading cards exist; clear it on unmount. Watch loading cards and call `refreshImagePreview()` for each non-empty loading preview path.

Replace the placeholder body with a blurred `<img class="aiw-loading-source">` for input mode, a CSS/SVG-like `<div class="aiw-loading-default-art">` for text mode, a sheen overlay, and a copy block containing `loadingMessage(item)` plus the queued/running status label.

- [ ] **Step 5: Implement visual states and reduced motion**

Use `filter: blur(18px) saturate(.72) brightness(.66)`, `transform: scale(1.12)`, an orange/navy overlay, and a static shrimp/ocean illustration for text mode. Under `prefers-reduced-motion`, disable source breathing, sheen travel, and copy transition animations.

- [ ] **Step 6: Run tests and verify GREEN**

Run:

```bash
node --test tests/ai-image-loading-state.test.js tests/ai-image-workbench-async-batch.test.js
```

Expected: all selected tests PASS.

- [ ] **Step 7: Commit Task 2**

```bash
git add app/src/renderer/utils/aiImageLoadingState.mjs app/src/renderer/views/AiImageWorkbench.vue tests/ai-image-loading-state.test.js tests/ai-image-workbench-async-batch.test.js
git commit -m "feat(ai-image): show contextual loading artwork"
```

### Task 3: Remove the workspace summary and validate the rendered UI

**Files:**
- Modify: `app/src/renderer/views/AiImageWorkbench.vue:205-215, 1028-1055`
- Modify: `tests/ai-image-workbench-navigation.test.js:560-590`

**Interfaces:**
- Removes: `generatedSummaryLine` and the workspace-header `<span>` that renders it.
- Preserves: persisted task title and task-record metadata.

- [ ] **Step 1: Update the structural test first**

Replace the generated-summary expectations with:

```javascript
assert.match(workbench, /任务：\{\{ persistedCurrentJob\?\.title \|\| form\.title \|\| '本次生成' \}\}/)
assert.doesNotMatch(workbench, /\{\{ generatedSummaryLine \}\}/)
assert.doesNotMatch(workbench, /const generatedSummaryLine = computed/)
assert.match(workbench, /<span>下次生成参数<\/span>/)
```

- [ ] **Step 2: Run the navigation test and verify RED**

Run:

```bash
node --test tests/ai-image-workbench-navigation.test.js
```

Expected: FAIL while the summary is still present.

- [ ] **Step 3: Remove only the generated header summary**

Delete:

```vue
<span>{{ generatedSummaryLine }}</span>
```

and remove `nextGenerationSummaryLine` / `generatedSummaryLine` if they have no remaining consumers.

- [ ] **Step 4: Run renderer regressions and build**

Run:

```bash
node --test tests/ai-image-loading-state.test.js tests/ai-image-workbench-async-batch.test.js tests/ai-image-workbench-navigation.test.js
```

Run from `app/`:

```bash
npm run vite:build
```

Expected: tests and build PASS.

- [ ] **Step 5: Verify backend and AI 测图 boundaries**

Run:

```bash
./venv/bin/python -m unittest tests.test_ai_image_service tests.test_ai_image_workbench_batch tests.test_one_xm_image_client tests.test_tmall_ai_image_chain_script -v
git diff --check
git diff c9a4047c..HEAD -- core/one_xm_image.py adapters/tmall-ops-assistant
```

Expected: tests PASS; `core/one_xm_image.py` has no diff; any adapter output is pre-existing unrelated work and is not staged.

- [ ] **Step 6: Validate in the live workbench**

At `http://127.0.0.1:5173`, reload the AI 生图 workbench and verify page identity, no framework overlay, no relevant console errors, the header summary is absent, and three injected/local fixture states render main-image blur, first-reference blur, and text-only default art. Capture screenshots outside the repo.

- [ ] **Step 7: Commit Task 3**

```bash
git add app/src/renderer/views/AiImageWorkbench.vue tests/ai-image-workbench-navigation.test.js
git commit -m "fix(ai-image): simplify result header"
```
