# AI Image Batch Per-Prompt Count Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the batch-generation dialog independent model settings and let every GPT Prompt request 1–8 images while Nano Banana remains fixed at one.

**Architecture:** Extend the existing batch Prompt request with `count`, persist it as `requested_count` on the corresponding workbench run, and pass it to GPT-Image-2 as `n` without expanding a Prompt into multiple provider tasks. Add a small renderer utility for count normalization, batch totals, settings snapshots, and loading-slot counts; `AiImageWorkbench.vue` owns the independent dialog state and UI while the backend remains the trust boundary.

**Tech Stack:** Python 3, FastAPI/Pydantic, Vue 3, JavaScript ES modules, Node test runner, Python unittest, SQLite JSON summaries, Vite

## Global Constraints

- Work only in `/Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench` on `codex/cloud-approval-workbench`.
- Preserve unrelated dirty cloud dashboard and Tmall manifest/test files.
- Opening the batch dialog copies outside model settings once; later batch edits must not mutate the outside “下次生成参数” form.
- The frontend limit remains 20 Prompt cards; the backend API safety limit remains 100 Prompt items.
- GPT Prompt counts are integers from 1 through 8; Nano Banana Prompt counts are always 1.
- One Prompt creates one workbench run and one 1XM task.
- The backend submits all Prompt tasks concurrently and lets 1XM own its processing queue.
- Keep `task_id`, `poll_url`, `poll_after`, request idempotency, and local-backend polling behavior unchanged.
- Do not modify AI 测图 execution through `core.one_xm_image.run_image_task_until_done()` or `core.api_server._run_one_xm_generation_row()`.

---

### Task 1: Carry per-Prompt counts through the API and asynchronous provider runs

**Files:**
- Modify: `core/api_server.py:5281-5289`
- Modify: `core/ai_image_service.py:499-529, 575-770`
- Test: `tests/test_ai_image_api.py`
- Test: `tests/test_ai_image_workbench_batch.py`

**Interfaces:**
- Consumes: batch Prompt items shaped as `{title: str, prompt: str, count: int}`
- Produces: `_normalized_batch_requested_count(source: Mapping[str, Any], model: str) -> int`
- Produces: `_workbench_run_patch(..., requested_count: int = 1) -> dict[str, Any]`
- Produces persisted run field: `requested_count: int`
- Preserves: one provider task per Prompt and `request_uid` deduplication

- [ ] **Step 1: Write failing API and mixed-GPT-count tests**

In `tests/test_ai_image_api.py`, import Pydantic's validation error and extend the existing batch API contract:

```python
from pydantic import ValidationError
```

```python
api_server.AiImageBatchPromptRequest(title="A", prompt="one", count=3),
api_server.AiImageBatchPromptRequest(title="B", prompt="two", count=2),
```

```python
submit.assert_called_once_with(
    job["job_uid"],
    [
        {"title": "A", "prompt": "one", "count": 3},
        {"title": "B", "prompt": "two", "count": 2},
    ],
    request_uid="request-api-1",
)
```

Add explicit typed-boundary coverage:

```python
def test_batch_prompt_request_defaults_and_rejects_malformed_count(self):
    self.assertEqual(api_server.AiImageBatchPromptRequest(prompt="one").count, 1)
    self.assertEqual(api_server.AiImageBatchPromptRequest(prompt="two", count=4).count, 4)
    with self.assertRaises(ValidationError):
        api_server.AiImageBatchPromptRequest(prompt="bad", count="not-a-number")
```

Update `test_batch_submits_all_prompts_concurrently_and_persists_task_handles` to submit different counts and assert one provider request per Prompt with matching `n`:

```python
result = ai_image_service.submit_workbench_batch(
    self.job["job_uid"],
    [
        {"title": "A", "prompt": "one", "count": 3},
        {"title": "B", "prompt": "two", "count": 2},
        {"title": "C", "prompt": "three", "count": 1},
    ],
    request_uid="request-1",
    settings=self._settings(),
    client_factory=lambda *_args, **_kwargs: client,
    poll_submitter=lambda fn, *args, **kwargs: poll_submissions.append((fn, args, kwargs)),
)

payloads_by_prompt = {
    payload["prompt"]: payload
    for payload, _idempotency_key in client.created_payloads
}
self.assertEqual(payloads_by_prompt["one"]["n"], 3)
self.assertEqual(payloads_by_prompt["two"]["n"], 2)
self.assertEqual(payloads_by_prompt["three"]["n"], 1)
self.assertEqual([run["requested_count"] for run in result["runs"]], [3, 2, 1])
self.assertEqual(len(result["runs"]), 3)
```

- [ ] **Step 2: Write failing backend tests for normalization, Nano, and result capping**

Add these cases to `AiImageWorkbenchBatchTests`:

```python
def test_batch_normalizes_gpt_counts_without_expanding_prompt_runs(self):
    client = FakeWorkbenchClient()
    result = ai_image_service.submit_workbench_batch(
        self.job["job_uid"],
        [
            {"prompt": "missing"},
            {"prompt": "zero", "count": 0},
            {"prompt": "large", "count": 99},
        ],
        request_uid="request-count-normalization",
        settings=self._settings(),
        client_factory=lambda *_args, **_kwargs: client,
        poll_submitter=lambda *_args, **_kwargs: None,
    )
    self.assertEqual([run["requested_count"] for run in result["runs"]], [1, 1, 8])
    self.assertEqual(len(client.created_payloads), 3)

def test_nano_batch_forces_one_image_and_omits_n(self):
    data_sink.update_ai_image_job(self.job["job_uid"], {
        "model_key": "gemini-3.1-flash-image-preview",
        "params": {
            "ratio": "1:1",
            "size": "2K",
            "quality": "2K",
            "n": 8,
        },
    })
    client = FakeWorkbenchClient()
    result = ai_image_service.submit_workbench_batch(
        self.job["job_uid"],
        [{"prompt": "nano", "count": 8}],
        request_uid="request-nano-count",
        settings={
            "base_url": "https://api.example/v1",
            ai_image_service.GEMINI_FLASH_CONFIG_ID: "unit-nano-key",
        },
        client_factory=lambda *_args, **_kwargs: client,
        poll_submitter=lambda *_args, **_kwargs: None,
    )
    payload = client.created_payloads[0][0]
    self.assertNotIn("n", payload)
    self.assertEqual(result["runs"][0]["requested_count"], 1)
```

Extend `test_poll_workbench_run_honors_poll_after_and_persists_completion` so the run has `requested_count: 2`, the success payload returns three URLs, and only the first two persist:

```python
"requested_count": 2,
```

```python
{"id": "task-one", "status": "succeeded", "data": [
    {"url": "https://img.example/task-one-a.png"},
    {"url": "https://img.example/task-one-b.png"},
    {"url": "https://img.example/task-one-extra.png"},
]},
```

```python
self.assertEqual(run["image_urls"], [
    "https://img.example/task-one-a.png",
    "https://img.example/task-one-b.png",
])
```

- [ ] **Step 3: Run backend tests and verify RED**

Run:

```bash
./venv/bin/python -m unittest tests.test_ai_image_api tests.test_ai_image_workbench_batch -v
```

Expected: FAIL because the API model has no `count`, Prompt counts are discarded, runs have no `requested_count`, GPT payloads always use `n: 1`, and poll results are not capped per run.

- [ ] **Step 4: Extend the API model and add backend count normalization**

Change the Prompt request model in `core/api_server.py`:

```python
class AiImageBatchPromptRequest(BaseModel):
    title: str = ""
    prompt: str = ""
    count: int = 1
```

Add this helper near `_requested_image_count()` in `core/ai_image_service.py`:

```python
def _normalized_batch_requested_count(source: Mapping[str, Any], model: str) -> int:
    if _compact(model) in NANO_BANANA_MODELS:
        return 1
    return _requested_image_count({"n": source.get("count")}, default=1, max_count=8)
```

Load the job before normalizing Prompt items, derive its model, and preserve each normalized count:

```python
job = data_sink.get_ai_image_job(job_uid)
if not job:
    raise ValueError(f"AI image job not found: {job_uid}")
model = _compact(job.get("model_key") or _params(job).get("model") or "gpt-image-2")

normalized_prompts: list[dict[str, Any]] = []
for index, item in enumerate(prompts or []):
    source = item if isinstance(item, Mapping) else {"prompt": item}
    prompt = _compact(source.get("prompt"))
    if prompt:
        normalized_prompts.append({
            "title": _compact(source.get("title")) or f"Prompt {index + 1}",
            "prompt": prompt,
            "count": _normalized_batch_requested_count(source, model),
        })
```

Keep the existing empty/100-item checks after normalization and remove the later duplicate job lookup.

- [ ] **Step 5: Persist requested counts and send model-correct provider payloads**

Add the field to each new batch run:

```python
"requested_count": prompt_item["count"],
```

Extend `_workbench_run_patch()` so completed URLs are capped at the requested count:

```python
def _workbench_run_patch(
    task: Mapping[str, Any],
    *,
    fallback_status: str = "queued",
    requested_count: int = 1,
) -> dict[str, Any]:
    # existing status and handle normalization
    if provider_status in SUCCESS_STATUSES:
        patch.update({
            "status": "completed",
            "image_urls": extract_image_urls(task)[:max(1, int(requested_count or 1))],
            "error": "",
        })
```

Build the per-run create payload without creating extra tasks:

```python
def create_one(run: Mapping[str, Any]) -> tuple[str, dict[str, Any]]:
    payload = {**base_payload, "prompt": run["prompt"]}
    if model in NANO_BANANA_MODELS:
        payload.pop("n", None)
    else:
        payload["n"] = int(run.get("requested_count") or 1)
    task = client.create_task(
        payload,
        idempotency_key=f"ai_image_{job_uid}_{run['run_uid']}",
        timeout=30,
        request_retries=3,
    )
    return _compact(run.get("run_uid")), dict(task or {})
```

Pass the count both after create and during polling:

```python
patch = _workbench_run_patch(
    task,
    requested_count=int(run.get("requested_count") or 1),
)
```

```python
patch = _workbench_run_patch(
    current,
    fallback_status=_compact(run.get("provider_status")) or "queued",
    requested_count=int(run.get("requested_count") or 1),
)
```

- [ ] **Step 6: Run backend tests and verify GREEN**

Run:

```bash
./venv/bin/python -m unittest tests.test_ai_image_api tests.test_ai_image_service tests.test_ai_image_workbench_batch -v
```

Expected: all selected tests PASS; batch submission still creates one provider task per Prompt and schedules one poller per active run.

- [ ] **Step 7: Commit backend count support**

```bash
git add core/api_server.py core/ai_image_service.py tests/test_ai_image_api.py tests/test_ai_image_workbench_batch.py
git commit -m "feat(ai-image): support per-prompt batch counts"
```

### Task 2: Add focused renderer helpers for batch state and totals

**Files:**
- Create: `app/src/renderer/utils/aiImageBatchGeneration.mjs`
- Create: `tests/ai-image-batch-generation.test.js`

**Interfaces:**
- Produces: `normalizeBatchPromptCount(value, options?) -> number`
- Produces: `summarizeBatchPrompts(cards, options?) -> { promptCount: number, totalImages: number }`
- Produces: `batchSettingsFromForm(snapshot) -> { modelId, ratio, size, quality, format }`
- Produces: `loadingSlotIndexes(run) -> number[]`
- Consumed by: Task 3's `AiImageWorkbench.vue` state, submission, summaries, and loading placeholders

- [ ] **Step 1: Write failing utility tests**

Create `tests/ai-image-batch-generation.test.js`:

```javascript
const assert = require('node:assert/strict')
const test = require('node:test')

test('batch Prompt counts default and clamp to the GPT 1-8 range', async () => {
  const { normalizeBatchPromptCount } = await import('../app/src/renderer/utils/aiImageBatchGeneration.mjs')
  assert.equal(normalizeBatchPromptCount(undefined), 1)
  assert.equal(normalizeBatchPromptCount(0), 1)
  assert.equal(normalizeBatchPromptCount(4), 4)
  assert.equal(normalizeBatchPromptCount(99), 8)
  assert.equal(normalizeBatchPromptCount(7, { forceSingle: true }), 1)
})

test('batch summary ignores empty Prompts and totals normalized images', async () => {
  const { summarizeBatchPrompts } = await import('../app/src/renderer/utils/aiImageBatchGeneration.mjs')
  assert.deepEqual(summarizeBatchPrompts([
    { prompt: 'one', count: 3 },
    { prompt: '  ', count: 8 },
    { prompt: 'two', count: 2 },
  ]), { promptCount: 2, totalImages: 5 })
  assert.deepEqual(summarizeBatchPrompts([
    { prompt: 'one', count: 8 },
  ], { forceSingle: true }), { promptCount: 1, totalImages: 1 })
})

test('batch settings snapshot is a detached copy of outside settings', async () => {
  const { batchSettingsFromForm } = await import('../app/src/renderer/utils/aiImageBatchGeneration.mjs')
  const outside = { modelId: 'gpt-image-2-4k', ratio: '3:4', size: '2448x3264', quality: 'high', format: 'png' }
  const batch = batchSettingsFromForm(outside)
  batch.modelId = 'gpt-image-2'
  assert.equal(outside.modelId, 'gpt-image-2-4k')
  assert.deepEqual(Object.keys(batch), ['modelId', 'ratio', 'size', 'quality', 'format'])
})

test('queued multi-image runs expose one loading slot per requested image', async () => {
  const { loadingSlotIndexes } = await import('../app/src/renderer/utils/aiImageBatchGeneration.mjs')
  assert.deepEqual(loadingSlotIndexes({ status: 'queued', requested_count: 3 }), [0, 1, 2])
  assert.deepEqual(loadingSlotIndexes({ status: 'running' }), [0])
  assert.deepEqual(loadingSlotIndexes({ status: 'completed', requested_count: 3 }), [])
})
```

- [ ] **Step 2: Run utility tests and verify RED**

Run:

```bash
node --test tests/ai-image-batch-generation.test.js
```

Expected: FAIL because `aiImageBatchGeneration.mjs` does not exist.

- [ ] **Step 3: Implement the utility**

Create `app/src/renderer/utils/aiImageBatchGeneration.mjs`:

```javascript
const text = (value) => String(value || '').trim()

export function normalizeBatchPromptCount(value, options = {}) {
  if (options.forceSingle) return 1
  const parsed = Number.parseInt(String(value ?? 1), 10)
  if (!Number.isFinite(parsed)) return 1
  return Math.max(1, Math.min(8, parsed))
}

export function summarizeBatchPrompts(cards = [], options = {}) {
  return (Array.isArray(cards) ? cards : []).reduce((summary, card) => {
    if (!text(card?.prompt)) return summary
    summary.promptCount += 1
    summary.totalImages += normalizeBatchPromptCount(card?.count, options)
    return summary
  }, { promptCount: 0, totalImages: 0 })
}

export function batchSettingsFromForm(snapshot = {}) {
  return {
    modelId: text(snapshot.modelId),
    ratio: text(snapshot.ratio) || '1:1',
    size: text(snapshot.size),
    quality: text(snapshot.quality) || 'auto',
    format: text(snapshot.format) || 'png',
  }
}

export function loadingSlotIndexes(run = {}) {
  const status = text(run.status).toLowerCase()
  if (!['queued', 'running'].includes(status)) return []
  const count = normalizeBatchPromptCount(run.requested_count)
  return Array.from({ length: count }, (_, index) => index)
}
```

- [ ] **Step 4: Run utility tests and verify GREEN**

Run:

```bash
node --test tests/ai-image-batch-generation.test.js
```

Expected: 4 tests PASS.

- [ ] **Step 5: Commit the renderer helper**

```bash
git add app/src/renderer/utils/aiImageBatchGeneration.mjs tests/ai-image-batch-generation.test.js
git commit -m "feat(ai-image): add batch count helpers"
```

### Task 3: Build the independent batch settings UI and per-card counts

**Files:**
- Modify: `app/src/renderer/views/AiImageWorkbench.vue:398-570, 795-1035, 1279-1299, 1640-1820, 2260-2315, 3289-3488`
- Modify: `tests/ai-image-workbench-async-batch.test.js`
- Consume: `app/src/renderer/utils/aiImageBatchGeneration.mjs`

**Interfaces:**
- Consumes: Task 1 Prompt contract `{title, prompt, count}` and run `requested_count`
- Consumes: Task 2 helpers `normalizeBatchPromptCount`, `summarizeBatchPrompts`, `batchSettingsFromForm`, `loadingSlotIndexes`
- Preserves: one frontend batch API call and local-job polling

- [ ] **Step 1: Write failing component-contract tests**

Extend `tests/ai-image-workbench-async-batch.test.js`:

```javascript
test('batch dialog owns independent model settings and per-Prompt counts', () => {
  assert.match(workbench, /本次批量生成参数/)
  assert.match(workbench, /v-model="batchGenerationDialog\.modelId"/)
  assert.match(workbench, /v-model="batchGenerationDialog\.ratio"/)
  assert.match(workbench, /v-model="batchGenerationDialog\.size"/)
  assert.match(workbench, /v-model="batchGenerationDialog\.quality"/)
  assert.match(workbench, /v-model="batchGenerationDialog\.format"/)
  assert.match(workbench, /v-model\.number="card\.count"/)
  assert.match(workbench, /:max="batchNanoBanana \? 1 : 8"/)
  assert.match(workbench, /:disabled="batchGenerationDialog\.submitting \|\| batchNanoBanana"/)
  assert.match(workbench, /batchSettingsFromForm\(snapshot\)/)
})

test('batch summary and submission carry per-Prompt image counts', () => {
  assert.match(workbench, /summarizeBatchPrompts/)
  assert.match(workbench, /预计生成 \{\{ batchPromptStats\.totalImages \}\} 张图/)
  const body = functionBody('submitBatchGeneration', 'generate')
  assert.match(body, /count: normalizeBatchPromptCount\(card\.count/)
  assert.match(body, /modelId: batchGenerationDialog\.modelId/)
  assert.doesNotMatch(body, /count: 1,\n\s*}/)
})

test('persisted batch runs render requested loading slots', () => {
  assert.match(workbench, /loadingSlotIndexes\(run\)/)
  assert.match(workbench, /loadingSlotIndexes\(run\)\.map/)
  assert.match(workbench, /requested_count/)
})
```

- [ ] **Step 2: Run component tests and verify RED**

Run:

```bash
node --test tests/ai-image-batch-generation.test.js tests/ai-image-workbench-async-batch.test.js
```

Expected: utility tests PASS and new component-contract tests FAIL because the dialog still reads outside form settings, cards have no count field, and persisted runs render one loading placeholder.

- [ ] **Step 3: Add independent batch state and model-specific computed values**

Import Task 2's helpers:

```javascript
import {
  batchSettingsFromForm,
  loadingSlotIndexes,
  normalizeBatchPromptCount,
  summarizeBatchPrompts,
} from '../utils/aiImageBatchGeneration.mjs'
```

Add fields to `batchGenerationDialog`:

```javascript
modelId: '',
ratio: '1:1',
size: '',
quality: 'auto',
format: 'png',
```

Add computed values:

```javascript
const batchActiveModel = computed(() => getAiImageModel(batchGenerationDialog.modelId || form.modelId))
const batchNanoBanana = computed(() => isNanoBananaModel(batchActiveModel.value.id))
const batchSizeOptions = computed(() => sizeOptionsForModel(batchActiveModel.value.id, batchGenerationDialog.ratio))
const batchQualityOptions = computed(() => qualityOptionsForModel(batchActiveModel.value.id))
const batchMissingKey = computed(() => missingKeyForModel(batchActiveModel.value.id, settings.value))
const batchPromptStats = computed(() => summarizeBatchPrompts(batchPromptCards.value, {
  forceSingle: batchNanoBanana.value,
}))
const batchPromptCount = computed(() => batchPromptStats.value.promptCount)
```

Initialize the detached snapshot when the dialog opens:

```javascript
Object.assign(batchGenerationDialog, batchSettingsFromForm(snapshot))
```

Add batch-only synchronization methods:

```javascript
function syncBatchModelDefaults() {
  const model = batchActiveModel.value
  batchGenerationDialog.size = sizeForModel(model.id, batchGenerationDialog.ratio, model.size)
  if (batchNanoBanana.value) {
    batchGenerationDialog.prompts.forEach((card) => { card.count = 1 })
    return
  }
  if (!batchQualityOptions.value.includes(batchGenerationDialog.quality)) {
    batchGenerationDialog.quality = batchQualityOptions.value[0] || 'auto'
  }
  syncBatchRatioFromSize()
}

function syncBatchSizeFromRatio() {
  batchGenerationDialog.size = sizeForModel(
    batchActiveModel.value.id,
    batchGenerationDialog.ratio,
    batchGenerationDialog.size,
  )
}

function syncBatchRatioFromSize() {
  if (batchNanoBanana.value) return
  batchGenerationDialog.ratio = ratioForSize(batchGenerationDialog.size, batchGenerationDialog.ratio)
}
```

- [ ] **Step 4: Add the left-side settings section and per-card count controls**

Below the reference-image section, render “本次批量生成参数” with the same model/ratio/size/quality/format rules as the outside form. Use batch-only bindings and handlers:

```vue
<section class="aiw-batch-source-box aiw-batch-settings-box">
  <div class="aiw-panel-head"><span>本次批量生成参数</span></div>
  <div class="aiw-batch-settings-grid">
    <label class="aiw-field aiw-field-wide">
      <span>模型</span>
      <select v-model="batchGenerationDialog.modelId" :disabled="batchGenerationDialog.submitting" @change="syncBatchModelDefaults">
        <option v-for="model in AI_IMAGE_MODELS" :key="model.id" :value="model.id">{{ model.label }}</option>
      </select>
    </label>
    <label class="aiw-field">
      <span>比例</span>
      <select v-model="batchGenerationDialog.ratio" :disabled="batchGenerationDialog.submitting" @change="syncBatchSizeFromRatio">
        <option v-for="ratio in AI_IMAGE_RATIOS" :key="ratio" :value="ratio">{{ ratio }}</option>
      </select>
    </label>
    <label class="aiw-field">
      <span>{{ batchNanoBanana ? '分辨率' : '尺寸' }}</span>
      <select v-model="batchGenerationDialog.size" :disabled="batchGenerationDialog.submitting" @change="syncBatchRatioFromSize">
        <option v-for="size in batchSizeOptions" :key="size" :value="size">{{ size }}</option>
      </select>
    </label>
    <label v-if="!batchNanoBanana" class="aiw-field">
      <span>质量</span>
      <select v-model="batchGenerationDialog.quality" :disabled="batchGenerationDialog.submitting">
        <option v-for="quality in batchQualityOptions" :key="quality" :value="quality">{{ quality }}</option>
      </select>
    </label>
    <label v-if="!batchNanoBanana" class="aiw-field">
      <span>格式</span>
      <select v-model="batchGenerationDialog.format" :disabled="batchGenerationDialog.submitting">
        <option v-for="format in AI_IMAGE_FORMATS" :key="format" :value="format">{{ format.toUpperCase() }}</option>
      </select>
    </label>
    <div class="aiw-key-status aiw-field-wide" :class="{ missing: Boolean(batchMissingKey) }">
      <span>Key 状态</span>
      <strong>{{ batchMissingKey ? '未配置' : '可生成' }}</strong>
    </div>
  </div>
</section>
```

Create cards with `count: normalizeBatchPromptCount(values.count)` and add this control above the card actions:

```vue
<label class="aiw-batch-count-field">
  <span>生成张数</span>
  <input
    v-model.number="card.count"
    type="number"
    min="1"
    :max="batchNanoBanana ? 1 : 8"
    :disabled="batchGenerationDialog.submitting || batchNanoBanana"
  />
  <small v-if="batchNanoBanana">Nano Banana 每个任务固定生成 1 张</small>
</label>
```

Replace fixed-one-image copy with:

```vue
<span>{{ batchPromptStats.promptCount }} 条 Prompt，预计生成 {{ batchPromptStats.totalImages }} 张图</span>
```

- [ ] **Step 5: Submit the batch snapshot and card counts without mutating the outside form**

Build `batchSnapshot` from batch-dialog fields:

```javascript
const batchSnapshot = {
  ...snapshot,
  titlePrefix: batchGenerationDialog.titlePrefix || snapshot.title || nextTaskTitle(),
  mainImagePath: batchGenerationDialog.mainImagePath,
  referenceImagePaths: [...batchGenerationDialog.referenceImagePaths],
  modelId: batchGenerationDialog.modelId,
  ratio: batchGenerationDialog.ratio,
  size: batchGenerationDialog.size,
  quality: batchGenerationDialog.quality,
  format: batchGenerationDialog.format,
}
```

In `buildBatchJobPayload()`, remove the forced `count: 1`, normalize the card count, and put it in shared params:

```javascript
const requestedCount = normalizeBatchPromptCount(card.count, { forceSingle: isNanoBananaModel(model.id) })
const params = {
  // existing advanced/shared fields
  n: requestedCount,
  // existing model/image fields
}
```

Before submission, use `batchMissingKey` instead of the outside `activeMissingKey`. Send counts in the one existing API call:

```javascript
prompts: promptCards.map((card, index) => ({
  title: card.title || `Prompt ${index + 1}`,
  prompt: card.prompt,
  count: normalizeBatchPromptCount(card.count, { forceSingle: batchNanoBanana.value }),
})),
```

Update success logs to include both values:

```javascript
logs.value.push(`批量任务已提交：${batchPromptStats.value.promptCount} 条 Prompt，预计 ${batchPromptStats.value.totalImages} 张图`)
```

- [ ] **Step 6: Render one loading card per persisted requested image**

Replace the single active placeholder with an array-producing helper:

```javascript
function workbenchRunPlaceholders(job, run, index) {
  const status = String(run?.status || '').toLowerCase()
  if (['queued', 'running'].includes(status)) {
    const loadingContext = resolveLoadingPreviewContext(job, run)
    return loadingSlotIndexes(run).map((slotIndex) => ({
      key: `${run.run_uid || run.task_id || index}-loading-${slotIndex + 1}`,
      label: `${status === 'queued' ? '排队中' : '生成中'} ${slotIndex + 1}`,
      prompt: run.prompt || '',
      jobUid: job?.job_uid || '',
      runUid: run.run_uid || '',
      requested_count: Number(run.requested_count || 1),
      loadingPreviewPath: loadingContext.previewPath,
      loadingMode: loadingContext.mode,
      loadingMessageOffset: index + slotIndex,
      loading: true,
    }))
  }
  if (status === 'failed') {
    return [{
      key: `${run.run_uid || run.task_id || index}-failed`,
      label: '生成失败',
      prompt: run.prompt || '',
      error: run.error || '1XM 任务执行失败',
      jobUid: job?.job_uid || '',
      runUid: run.run_uid || '',
      failed: true,
    }]
  }
  return []
}
```

In `collectResultQueues()`, select actual results or all placeholders:

```javascript
const resultItems = collectResultCardsFromRun(job, run, index)
const placeholders = resultItems.length ? [] : workbenchRunPlaceholders(job, run, index)
return {
  // existing queue metadata
  items: resultItems.length ? resultItems : placeholders,
}
```

Update the existing structural test that names `workbenchRunPlaceholder` to expect `workbenchRunPlaceholders`.

- [ ] **Step 7: Style the new settings and count controls**

Extend the batch styles without changing the dialog's two-column structure:

```css
.aiw-batch-settings-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}

.aiw-batch-settings-grid .aiw-field-wide {
  grid-column: 1 / -1;
}

.aiw-batch-settings-grid select,
.aiw-batch-count-field input {
  width: 100%;
  min-width: 0;
}

.aiw-batch-prompt-card {
  grid-template-rows: auto minmax(130px, 1fr) auto auto;
}

.aiw-batch-count-field {
  display: grid;
  grid-template-columns: auto minmax(64px, 88px);
  align-items: center;
  gap: 6px 8px;
}

.aiw-batch-count-field small {
  grid-column: 1 / -1;
  color: var(--text2);
}
```

- [ ] **Step 8: Run renderer tests and build**

Run:

```bash
node --test \
  tests/ai-image-batch-generation.test.js \
  tests/ai-image-loading-state.test.js \
  tests/ai-image-workbench-async-batch.test.js

node --test --test-name-pattern="keeps generated task metadata" \
  tests/ai-image-workbench-navigation.test.js

cd app && npm run vite:build
```

Expected: all selected tests PASS and Vite exits 0. Existing Vite/Radix and chunk-size warnings are acceptable; compile errors are not.

- [ ] **Step 9: Run backend and AI 测图 regressions**

Run from the worktree root:

```bash
./venv/bin/python -m unittest \
  tests.test_ai_image_service \
  tests.test_ai_image_api \
  tests.test_ai_image_workbench_batch \
  tests.test_one_xm_image_client \
  tests.test_tmall_ai_image_chain_script -v

git diff --check
git diff 0db35a84..HEAD -- core/one_xm_image.py adapters/tmall-ops-assistant
```

Expected: Python tests PASS; `core/one_xm_image.py` has no task diff; adapter changes remain unrelated and unstaged.

- [ ] **Step 10: Validate the live dialog without submitting paid provider work**

Restart only the worktree Electron development process and open `http://127.0.0.1:5173`:

1. Open AI 生图 → 批量生成.
2. Confirm the left column shows model, ratio, size/resolution, quality, format, and Key status.
3. Change the batch model and size, close without submitting, and confirm the outside “下次生成参数” values did not change.
4. Reopen the dialog, select GPT, enter counts 3 and 2 on two valid Prompt cards, and confirm the summary says 2 Prompts / 5 images.
5. Select Nano Banana and confirm all card counts become 1 and are disabled.
6. Confirm there is no Vite error overlay and no relevant `AiImageWorkbench` console error.
7. Close the dialog without submitting to 1XM.

- [ ] **Step 11: Commit the batch dialog UI**

```bash
git add app/src/renderer/views/AiImageWorkbench.vue tests/ai-image-workbench-async-batch.test.js
git commit -m "feat(ai-image): configure counts per batch Prompt"
```
