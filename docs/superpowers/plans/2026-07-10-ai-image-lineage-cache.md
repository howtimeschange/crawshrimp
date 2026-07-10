# AI Image Lineage and Local Result Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI image lightboxes follow the selected image's parent branch, keep generated task metadata stable while editing the next run, and cache successful remote result images locally for local-first reopening.

**Architecture:** Store a compact `edit_source` parent pointer on each generated run and resolve ancestry with a small pure renderer helper. Extend the existing materialize service into a deterministic cache that persists `summary.result_cache`, then make the renderer choose cached/local files before remote URLs and queue background caching after a successful remote load.

**Tech Stack:** Vue 3 renderer, Electron IPC/preload bridge, Python 3 service helpers, SQLite JSON summaries, Node built-in test runner, Python `unittest`.

## Global Constraints

- Work only in `/Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench` on `codex/cloud-approval-workbench`.
- Preserve unrelated dirty files and stage only files listed in each task.
- Do not add database tables or migrations; persist new metadata inside existing `summary_json`.
- Old runs without `edit_source` must show only the selected image rather than guessed task history.
- Cached/local preview order is `result_cache` path, run `output_files` path, then remote URL.
- A missing or corrupt local cache must fall back to remote and be rebuilt.
- Do not change 1XM model selection, billing, polling, or export-directory behavior.

---

### Task 1: Pure parent-chain resolver

**Files:**
- Create: `app/src/renderer/aiImageResultLineage.js`
- Create: `app/src/renderer/aiImageResultLineage.test.js`

**Interfaces:**
- Consumes: result items shaped as `{ url, path, prompt, editSource }`.
- Produces: `resultIdentityCandidates(item)`, `buildResultIndex(items)`, `resolveResultLineage(item, items)`, and `promptChainFromLineage(items)`.

- [ ] **Step 1: Write the failing branch-lineage tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  promptChainFromLineage,
  resolveResultLineage,
} from './aiImageResultLineage.js'

const image = (url, prompt, parent = '') => ({
  url,
  prompt,
  editSource: parent ? { result_key: parent } : null,
})

test('resolves only ancestors on the current edit branch', () => {
  const one = image('https://img/1.png', 'one')
  const two = image('https://img/2.png', 'two', one.url)
  const three = image('https://img/3.png', 'three', two.url)
  const four = image('https://img/4.png', 'four', one.url)
  const all = [one, two, three, four]

  assert.deepEqual(resolveResultLineage(three, all).map((item) => item.url), [one.url, two.url, three.url])
  assert.deepEqual(resolveResultLineage(four, all).map((item) => item.url), [one.url, four.url])
})

test('does not guess ancestors for legacy items and stops cycles', () => {
  const legacy = image('https://img/legacy.png', 'legacy')
  const a = image('https://img/a.png', 'a', 'https://img/b.png')
  const b = image('https://img/b.png', 'b', 'https://img/a.png')

  assert.deepEqual(resolveResultLineage(legacy, [legacy]).map((item) => item.url), [legacy.url])
  assert.deepEqual(resolveResultLineage(a, [a, b]).map((item) => item.url), [b.url, a.url])
})

test('numbers prompts by branch depth', () => {
  const chain = [
    image('https://img/1.png', 'original'),
    image('https://img/2.png', 'edit one'),
    image('https://img/3.png', 'edit two'),
  ]
  assert.deepEqual(promptChainFromLineage(chain).map(({ label, prompt }) => ({ label, prompt })), [
    { label: '原图 Prompt', prompt: 'original' },
    { label: '修改 Prompt 1', prompt: 'edit one' },
    { label: '修改 Prompt 2', prompt: 'edit two' },
  ])
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test app/src/renderer/aiImageResultLineage.test.js`

Expected: FAIL because `aiImageResultLineage.js` does not exist.

- [ ] **Step 3: Implement the pure resolver**

```js
export function resultIdentityCandidates(item = {}) {
  return [item.url, item.path]
    .map((value) => String(value || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
}

export function buildResultIndex(items = []) {
  const index = new Map()
  for (const item of items) {
    for (const key of resultIdentityCandidates(item)) index.set(key, item)
  }
  return index
}

export function resolveResultLineage(item, items = []) {
  if (!item) return []
  const index = buildResultIndex(items)
  const visited = new Set(resultIdentityCandidates(item))
  const ancestors = []
  let parentKey = String(item.editSource?.result_key || '').trim()
  while (parentKey && !visited.has(parentKey)) {
    const parent = index.get(parentKey)
    if (!parent) break
    ancestors.unshift(parent)
    resultIdentityCandidates(parent).forEach((key) => visited.add(key))
    parentKey = String(parent.editSource?.result_key || '').trim()
  }
  return [...ancestors, item]
}

export function promptChainFromLineage(items = []) {
  return items.map((item, index) => ({
    key: `prompt-lineage-${index}`,
    label: index === 0 ? '原图 Prompt' : `修改 Prompt ${index}`,
    prompt: String(item?.prompt || '').trim(),
  }))
}
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `node --test app/src/renderer/aiImageResultLineage.test.js`

Expected: 3 tests pass.

- [ ] **Step 5: Commit the pure helper**

```bash
git add app/src/renderer/aiImageResultLineage.js app/src/renderer/aiImageResultLineage.test.js
git commit -m "feat(ai-image): resolve edit result branches"
```

---

### Task 2: Persist run parents and deterministic cache mappings

**Files:**
- Modify: `core/ai_image_service.py:306-367,449-479`
- Modify: `tests/test_ai_image_service.py:324-375,473-518`

**Interfaces:**
- Consumes: `params.edit_source = { job_uid, run_uid, result_key }` and known result URLs.
- Produces: run-level `edit_source`, top-level `summary.result_cache`, and idempotent `materialize_remote_image(job_uid, url)` paths.

- [ ] **Step 1: Write failing backend tests**

Add tests that update a job with `params.edit_source`, run it, and assert the new run contains the exact normalized parent pointer. Extend the materialize test to call the service twice and assert the downloader ran once, both paths match, and the refreshed job keeps its existing runs plus `summary.result_cache[url]`.

```python
    def test_run_job_persists_edit_source_on_the_new_run(self):
        job = data_sink.create_ai_image_job({
            "prompt": "edit prompt",
            "params": {
                "size": "1024x1024",
                "n": 1,
                "edit_source": {
                    "job_uid": "parent-job",
                    "run_uid": "parent-run",
                    "result_key": "https://cdn.example/parent.png",
                },
            },
        })
        ai_image_service.run_job_with_one_xm(
            job["job_uid"],
            settings={"2k": "key-2k", "4k": ""},
            runner=lambda *_args, **_kwargs: {
                "ok": True,
                "image_urls": ["https://cdn.example/child.png"],
            },
        )
        run = data_sink.get_ai_image_job(job["job_uid"])["summary"]["runs"][0]
        self.assertEqual(run["edit_source"], {
            "job_uid": "parent-job",
            "run_uid": "parent-run",
            "result_key": "https://cdn.example/parent.png",
        })
```

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `python -m unittest tests.test_ai_image_service.AiImageServiceTests.test_run_job_persists_edit_source_on_the_new_run tests.test_ai_image_service.AiImageServiceTests.test_materialize_remote_image_downloads_known_job_url_to_cache`

Expected: FAIL because run metadata and result-cache reuse are not implemented.

- [ ] **Step 3: Implement normalized run parent metadata**

Add `_normalized_edit_source(params)` and write its result into `run_record` only when `result_key` is non-empty.

```python
def _normalized_edit_source(params: Mapping[str, Any]) -> dict[str, str]:
    source = params.get("edit_source")
    if not isinstance(source, Mapping):
        return {}
    result = {
        "job_uid": _compact(source.get("job_uid")),
        "run_uid": _compact(source.get("run_uid")),
        "result_key": _compact(source.get("result_key")),
    }
    return result if result["result_key"] else {}
```

- [ ] **Step 4: Implement deterministic materialization and summary mapping**

Import `hashlib`. Build the target as `result-<job-prefix>-<url-sha256-prefix><suffix>`, reuse a valid target, otherwise download to a unique temporary path, validate, and replace the target. Before returning, re-read the job and merge `summary.result_cache[source_url] = target` without replacing `summary.runs`.

```python
cache_key = hashlib.sha256(source_url.encode("utf-8")).hexdigest()[:16]
target = cache_dir / f"result-{_compact(job_uid)[:8] or 'job'}-{cache_key}{suffix}"
if target.exists():
    try:
        _validate_downloaded_image(target)
    except Exception:
        target.unlink(missing_ok=True)
if not target.exists():
    temporary = cache_dir / f".{target.name}-{uuid4().hex[:8]}.tmp"
    try:
        downloader(source_url, temporary)
        _validate_downloaded_image(temporary)
        temporary.replace(target)
    finally:
        temporary.unlink(missing_ok=True)
latest_job = data_sink.get_ai_image_job(job_uid)
if latest_job:
    latest_summary = dict(latest_job.get("summary") or {})
    result_cache = dict(latest_summary.get("result_cache") or {})
    result_cache[source_url] = str(target)
    data_sink.update_ai_image_job(job_uid, {"summary": {**latest_summary, "result_cache": result_cache}})
```

- [ ] **Step 5: Run backend tests and verify GREEN**

Run: `python -m unittest tests.test_ai_image_service`

Expected: all AI image service tests pass.

- [ ] **Step 6: Commit backend behavior**

```bash
git add core/ai_image_service.py tests/test_ai_image_service.py
git commit -m "feat(ai-image): persist lineage and result cache"
```

---

### Task 3: Integrate branch lineage, stable task metadata, and local-first previews

**Files:**
- Modify: `app/src/renderer/views/AiImageWorkbench.vue:206-210,288-293,925-1009,1787-1873,1940-1988,2162-2279,2493-2530,2694-2737`
- Modify: `tests/ai-image-workbench-navigation.test.js:434-465,549-564,611-647`

**Interfaces:**
- Consumes: Task 1 lineage helpers and Task 2 `run.edit_source` / `summary.result_cache`.
- Produces: branch-scoped lightbox history, stable generated-summary copy, local-first preview selection, and queued background cache requests.

- [ ] **Step 1: Replace the old textual expectations with failing contracts**

Assert the workbench imports `resolveResultLineage` and `promptChainFromLineage`, carries `editSource: run.edit_source`, does not accumulate a task-wide `historyItems`, and passes `edit_source` in lightbox edit params. Assert the task header uses `generatedSummaryLine`, contains `任务：`, and does not build the generated summary from `activeModel` plus `form`. Assert preview candidates order cached/local before remote and all result/thumbnail images include `loading="lazy"` and `decoding="async"`.

```js
assert.match(workbench, /resolveResultLineage/)
assert.match(workbench, /promptChainFromLineage/)
assert.match(workbench, /editSource: run\?\.edit_source/)
assert.doesNotMatch(collectQueuesBody, /let historyItems = \[\]/)
assert.match(editBody, /edit_source: buildEditSource\(sourceItem\)/)
assert.match(workbench, /任务：\{\{ currentJob\?\.title/)
assert.match(workbench, /const generatedSummaryLine = computed/)
assert.doesNotMatch(generatedSummaryBody, /activeModel\.value|form\./)
assert.match(previewBody, /cachedResultPath\(item\?\.url/)
assert.ok(previewBody.indexOf('cachedResultPath') < previewBody.indexOf('item?.url'))
assert.match(workbench, /loading="lazy"/)
assert.match(workbench, /decoding="async"/)
```

- [ ] **Step 2: Run renderer contracts and verify RED**

Run: `node --test tests/ai-image-workbench-navigation.test.js app/src/renderer/aiImageResultLineage.test.js`

Expected: FAIL on missing integration and new header/cache contracts.

- [ ] **Step 3: Integrate branch lineage**

Import the pure helpers. Build all queue items first, attach `editSource`, then build a result index and assign each item only its resolved ancestors and branch Prompt chain. Keep in-memory placeholders compatible by preserving their existing branch metadata.

```js
const flatItems = queues.flatMap((queue) => queue.items)
for (const item of flatItems) {
  const lineage = resolveResultLineage(item, flatItems)
  item.historyItems = lineage.slice(0, -1)
  item.promptChain = promptChainFromLineage(lineage)
}
```

Add `buildEditSource(sourceItem)` and include it in the lightbox generation params.

- [ ] **Step 4: Separate generated metadata from the next-run form**

Replace `summaryLine` with `generatedSummaryLine`. For a selected persisted job, compute model, ratio, size, count, and status from `currentJob`; only use the form for a brand-new unsaved task.

```js
const generatedSummaryLine = computed(() => {
  const job = currentJob.value
  if (!job?.job_uid) return nextGenerationSummaryLine.value
  const params = job.params && typeof job.params === 'object' ? job.params : {}
  const size = params.size || '未设尺寸'
  const ratio = params.ratio || ratioForSize(size, '1:1')
  return `${job.model_key || 'gpt-image-2'} · ${ratio} · ${size} · ${normalizeImageCount(params.n)} 张 · ${job.status || 'draft'}`
})
```

- [ ] **Step 5: Implement local-first preview and background caching**

Maintain reactive `resultCachePaths`, `resultCachePending`, and a serialized cache promise. Merge persisted `summary.result_cache` when jobs load or restore. Preview candidates must be cached path, run path, then URL. When a remote image emits `load`, queue `materializeAiImageResult(jobUid, { url })`; on success update `resultCachePaths[url]` and refresh the local preview. If the local candidate fails, mark only that path failed so the next candidate is the remote URL.

```js
function resultPreviewCandidates(item) {
  return [cachedResultPath(item?.url), item?.path, item?.url]
    .map((value) => String(value || '').trim())
    .filter((value, index, values) => value && values.indexOf(value) === index)
}

function handleResultPreviewLoaded(item) {
  const activeKey = activeResultPreviewKey(item)
  if (activeKey !== String(item?.url || '').trim()) return
  queueResultCache(item)
}
```

Add `@load="handleResultPreviewLoaded(item)"`, `loading="lazy"`, and `decoding="async"` to result-card, task-record, and lightbox-strip images. Keep the active lightbox main image eager but set `decoding="async"`.

- [ ] **Step 6: Run renderer contracts and verify GREEN**

Run: `node --test tests/ai-image-workbench-navigation.test.js app/src/renderer/aiImageResultLineage.test.js`

Expected: all renderer and lineage tests pass.

- [ ] **Step 7: Run the renderer build**

Run: `npm --prefix app run vite:build`

Expected: Vite build exits 0 without Vue compile errors.

- [ ] **Step 8: Commit renderer integration**

```bash
git add app/src/renderer/views/AiImageWorkbench.vue tests/ai-image-workbench-navigation.test.js
git commit -m "fix(ai-image): scope edits and prefer local previews"
```

---

### Task 4: Scoped validation and live QA

**Files:**
- Verify only; no planned production file changes.

**Interfaces:**
- Consumes: completed Tasks 1–3.
- Produces: test, build, diff, runtime, and rendered-interaction evidence.

- [ ] **Step 1: Run the scoped automated bundle**

```bash
node --test app/src/renderer/aiImageResultLineage.test.js tests/ai-image-workbench-navigation.test.js
python -m unittest tests.test_ai_image_service
npm --prefix app run vite:build
git diff --check HEAD~3..HEAD
```

Expected: every command exits 0.

- [ ] **Step 2: Verify branch and commit scope**

Run: `git status --short --branch --untracked-files=all` and `git log -4 --oneline --decorate`.

Expected: only the user's pre-existing unrelated dirty files remain; implementation commits contain only the plan and AI image files.

- [ ] **Step 3: Verify the running service identity**

Confirm frontend `127.0.0.1:5173`, backend `127.0.0.1:18765`, and backend DB under this worktree's `.crawshrimp-runtime` before UI claims.

- [ ] **Step 4: Exercise the target UI flow**

Open the AI image workbench, select `AI 生图任务 6`, then verify:

1. The header task name and generated parameter summary remain stable while changing left-side model and size.
2. A remote-only result renders, then creates a deterministic file under `.crawshrimp-runtime/ai-image-cache`.
3. Re-entering the task uses the cached/local candidate before the remote URL.
4. A three-level edit branch shows three thumbnails and three Prompts; a sibling branch shows only the shared ancestor and sibling.
5. Console warnings/errors contain no new application failures.

- [ ] **Step 5: Record remaining limits**

Report that historical Task 6 runs lack `edit_source`, so they intentionally open as a single selected image until new edits create persisted parent pointers. Report any flow that could not be exercised without spending a real generation request.
