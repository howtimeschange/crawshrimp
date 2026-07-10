# AI Image Provider Contract and Async Batch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align AI 生图工作台的 GPT-Image-2 / Nano Banana 异步请求参数，并让同一任务下的 N 条 Prompt 全量提交给 1XM 后通过持久化轮询逐条更新结果。

**Architecture:** 保留 AI 测图脚本现有 `run_image_task_until_done()` 链路不变；AI 生图工作台在 `ai_image_service` 中新增专用 payload builder、批量创建方法、run 原位更新方法和后台轮询方法。FastAPI、Electron IPC 与 Vue 只连接新工作台接口；前端每秒读取本地任务，后端按 1XM 的 `poll_after` 查询供应商。

**Tech Stack:** Python 3、FastAPI、SQLite JSON summary、`ThreadPoolExecutor`、Electron IPC、Vue 3、Node test runner、Python unittest

## Global Constraints

- 工作目录固定为 `/Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench`，分支固定为 `codex/cloud-approval-workbench`。
- 前端单批最多 20 条 Prompt；后端接口接受 1–100 条。
- 批次内全部任务都提交给 1XM，不建立本地 5 路生成队列；1XM 自己负责执行并发。
- 后端轮询必须使用 1XM 返回的 `poll_after`，默认 5 秒；前端 1 秒轮询只访问本地后端。
- `core.one_xm_image.run_image_task_until_done()`、`core.api_server._run_one_xm_generation_row()` 和 AI 测图脚本的补偿/并发/导出语义不得改变。
- 不修改或提交当前 worktree 中既有的 cloud hardening、Prompt Library guard 等无关脏文件。

---

### Task 1: Model-specific workbench provider payloads

**Files:**
- Modify: `core/ai_image_service.py`
- Modify: `app/src/renderer/utils/aiImageModels.js`
- Test: `tests/test_ai_image_service.py`
- Create: `tests/ai-image-provider-contract.test.js`

**Interfaces:**
- Produces: `build_workbench_one_xm_payload(job, assets=None, file_to_data_url_fn=...) -> dict`
- Produces: `isNanoBananaModel(modelIdOrKey) -> boolean`
- Produces: `sizeOptionsForModel(modelId, ratio) -> string[]`
- Produces: `qualityOptionsForModel(modelId) -> string[]`
- Preserves: `build_one_xm_payload(...)` as a compatibility wrapper for workbench callers/tests.

- [ ] **Step 1: Write failing Python provider-contract tests**

```python
def test_gpt_workbench_payload_keeps_official_4k_and_normalizes_fields(self):
    payload = ai_image_service.build_workbench_one_xm_payload({
        "model_key": "gpt-image-2",
        "prompt": "poster",
        "params": {"size": "3840x2160", "ratio": "16:9", "quality": "standard", "response_format": "jpg", "n": 2},
    })
    self.assertEqual(payload["size"], "3840x2160")
    self.assertEqual(payload["quality"], "medium")
    self.assertEqual(payload["output_format"], "jpeg")
    self.assertEqual(payload["n"], 2)
    self.assertNotIn("ratio", payload)

def test_nano_workbench_payload_uses_ratio_and_resolution_without_openai_fields(self):
    payload = ai_image_service.build_workbench_one_xm_payload({
        "model_key": "gemini-3-pro-image-preview",
        "prompt": "poster",
        "params": {"size": "4K", "ratio": "16:9", "quality": "high", "response_format": "png", "n": 4},
    })
    self.assertEqual(payload, {
        "model": "gemini-3-pro-image-preview",
        "prompt": "poster",
        "size": "16:9",
        "quality": "4K",
    })
```

- [ ] **Step 2: Run Python tests and verify RED**

Run: `./venv/bin/python -m unittest tests.test_ai_image_service.AiImageServiceTests.test_gpt_workbench_payload_keeps_official_4k_and_normalizes_fields tests.test_ai_image_service.AiImageServiceTests.test_nano_workbench_payload_uses_ratio_and_resolution_without_openai_fields -v`

Expected: FAIL because `build_workbench_one_xm_payload` does not exist.

- [ ] **Step 3: Write failing renderer model-contract tests**

```javascript
test('GPT sizes obey provider geometry and Nano exposes resolution tiers', async () => {
  assert.deepEqual(sizeOptionsForModel('gpt-image-4k', '16:9'), ['3840x2160'])
  assert.deepEqual(sizeOptionsForModel('gemini-3-pro-image-preview', '16:9'), ['1K', '2K', '4K'])
  assert.deepEqual(qualityOptionsForModel('gpt-image-2k'), ['auto', 'high', 'medium', 'low'])
  assert.equal(isNanoBananaModel('gemini-3.1-flash-image-preview'), true)
})
```

- [ ] **Step 4: Run renderer test and verify RED**

Run: `node --test tests/ai-image-provider-contract.test.js`

Expected: FAIL because the model-specific helpers do not exist.

- [ ] **Step 5: Implement model-specific builders and UI option helpers**

Implement GPT validation for max edge 3840, 16-pixel multiples, aspect ratio <= 3, and total pixels 655360–8294400. Map legacy `standard` to `medium`, map `jpg` to `jpeg`, and omit `ratio`. For Nano map `params.ratio` to `size`, map `params.size`/legacy pixels to `1K|2K|4K`, omit `n/ratio/output_format`, and keep `image` data URLs.

Replace 4K option rows with legal maxima: `2880x2880`, `2448x3264`, `3264x2448`, `2560x3200`, `3504x2336`, `2336x3504`, `3840x2160`, `2160x3840`; replace invalid HD rows with `2048x1152` and `1152x2048`.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run: `./venv/bin/python -m unittest tests.test_ai_image_service -v`

Run: `node --test tests/ai-image-provider-contract.test.js app/src/renderer/utils/aiImageModels.test.js`

Expected: all selected tests PASS.

- [ ] **Step 7: Commit Task 1**

```bash
git add core/ai_image_service.py app/src/renderer/utils/aiImageModels.js tests/test_ai_image_service.py tests/ai-image-provider-contract.test.js
git commit -m "fix(ai-image): align 1xm model parameters"
```

### Task 2: Workbench-only batch submission and poll persistence

**Files:**
- Modify: `core/ai_image_service.py`
- Create: `tests/test_ai_image_workbench_batch.py`
- Verify unchanged: `core/one_xm_image.py`
- Verify unchanged: `core/api_server.py::_run_one_xm_generation_row`

**Interfaces:**
- Produces: `submit_workbench_batch(job_uid, prompts, request_uid, settings=None, client_factory=OneXMImageClient, executor_factory=ThreadPoolExecutor, poll_submitter=None) -> dict`
- Produces: `poll_workbench_run(job_uid, run_uid, client, sleep_fn=time.sleep) -> dict`
- Produces persisted run fields: `run_uid`, `batch_uid`, `batch_index`, `request_uid`, `task_id`, `poll_url`, `poll_after`, `provider_status`, `status`, `image_urls`, `error`.

- [ ] **Step 1: Write failing tests for N runs in one job and provider-owned concurrency**

```python
def test_batch_submits_all_prompts_to_provider_and_persists_task_handles(self):
    result = ai_image_service.submit_workbench_batch(
        self.job_uid,
        [{"title": "A", "prompt": "one"}, {"title": "B", "prompt": "two"}, {"title": "C", "prompt": "three"}],
        request_uid="request-1",
        settings={"2k": "key", "base_url": "https://api.example"},
        client_factory=self.fake_client_factory,
        poll_submitter=self.capture_poll_submission,
    )
    self.assertEqual(len(self.created_payloads), 3)
    self.assertEqual(len(result["job"]["summary"]["runs"]), 3)
    self.assertTrue(all(run["task_id"] and run["poll_url"] for run in result["runs"]))
```

Also cover 100 accepted, 101 rejected, same `request_uid` deduped, one create failure not blocking siblings, and out-of-order run updates retaining `batch_index` order.

- [ ] **Step 2: Run batch tests and verify RED**

Run: `./venv/bin/python -m unittest tests.test_ai_image_workbench_batch -v`

Expected: FAIL because the workbench batch methods do not exist.

- [ ] **Step 3: Implement per-job locked run mutation and concurrent task creation**

Use a lock registry keyed by `job_uid`. Prewrite all queued runs once, submit all create calls with `max_workers=min(len(runs), 100)`, update each run by `run_uid`, and aggregate top-level status/image URLs without replacing `result_cache` or older runs.

- [ ] **Step 4: Implement polling that honors supplier `poll_after`**

The poller sleeps the current run's `poll_after`, calls `client.get_task(poll_url)`, persists `queued/running/succeeded/failed`, extracts `data[].url`, and stops at a terminal state. It must never call `run_image_task_until_done()`.

- [ ] **Step 5: Run batch tests and verify GREEN**

Run: `./venv/bin/python -m unittest tests.test_ai_image_workbench_batch -v`

Expected: all batch tests PASS.

- [ ] **Step 6: Prove AI 测图 behavior is unchanged**

Run: `./venv/bin/python -m unittest tests.test_one_xm_image_client tests.test_tmall_ai_image_chain_script -v`

Expected: existing create/poll/compensation and Tmall AI 测图 tests PASS without changing their production files.

- [ ] **Step 7: Commit Task 2**

```bash
git add core/ai_image_service.py tests/test_ai_image_workbench_batch.py
git commit -m "feat(ai-image): persist async batch runs"
```

### Task 3: Batch API and desktop bridges

**Files:**
- Modify: `core/api_server.py`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Modify: `app/src/renderer/utils/devCsBridge.js`
- Modify: `tests/test_ai_image_api.py`
- Modify: `tests/ai-image-ipc-bridge.test.js`

**Interfaces:**
- Produces: `POST /ai-image/jobs/{job_uid}/batch-run`
- Produces: `window.cs.batchRunAiImageJob(uid, payload)`

- [ ] **Step 1: Add failing API and bridge tests**

Test that `AiImageBatchRunRequest` accepts `request_uid` plus 1–100 prompt objects, the endpoint delegates to `submit_workbench_batch`, and main/preload/dev bridge expose `batchRunAiImageJob` without a 20-minute timeout.

- [ ] **Step 2: Run tests and verify RED**

Run: `./venv/bin/python -m unittest tests.test_ai_image_api -v`

Run: `node --test tests/ai-image-ipc-bridge.test.js`

Expected: FAIL because the route and bridge method are absent.

- [ ] **Step 3: Implement API validation and bridge plumbing**

Add nested prompt request models, translate service validation to HTTP 400, missing jobs to 404, and preserve the old `/run` endpoint. Add IPC fallback and dev bridge methods targeting `/batch-run`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `./venv/bin/python -m unittest tests.test_ai_image_api -v && node --test tests/ai-image-ipc-bridge.test.js`

Expected: both suites PASS.

- [ ] **Step 5: Commit Task 3**

```bash
git add core/api_server.py app/src/main.js app/src/preload.js app/src/renderer/utils/devCsBridge.js tests/test_ai_image_api.py tests/ai-image-ipc-bridge.test.js
git commit -m "feat(ai-image): expose async batch endpoint"
```

### Task 4: Workbench model controls, 20-Prompt cap, local polling, and queue cards

**Files:**
- Modify: `app/src/renderer/views/AiImageWorkbench.vue`
- Create: `tests/ai-image-workbench-async-batch.test.js`

**Interfaces:**
- Consumes: `window.cs.batchRunAiImageJob(uid, payload)`
- Consumes: model helpers from Task 1.
- Produces: 1-second local job polling while any run is `queued`/`running`.

- [ ] **Step 1: Write failing structural behavior tests**

Assert the workbench contains `MAX_BATCH_PROMPTS = 20`, disables both add buttons at the cap, updates the current job once, invokes `batchRunAiImageJob` once with N prompt records, closes the dialog after submission, and no longer creates/runs N independent jobs.

Also assert queued/running runs generate loading queue items, failed runs generate failure items, and a local polling timer is cleared on unmount.

- [ ] **Step 2: Run UI test and verify RED**

Run: `node --test tests/ai-image-workbench-async-batch.test.js`

Expected: FAIL against the current sequential loop.

- [ ] **Step 3: Implement model-aware controls**

For Nano show `1K/2K/4K` in the size/resolution selector, hide unsupported format/quality controls, and force one image per task. For GPT expose official quality/format values and legal size lists.

- [ ] **Step 4: Replace sequential batch loop**

Use `ensureCurrentTask()`, update that task with shared parameters, call `batchRunAiImageJob()` once, merge returned `job`, close the modal, and start local polling. Keep existing single `/run` and lightbox edit flows intact.

- [ ] **Step 5: Render persistent loading/failure queues and poll local state**

Include queued/running runs even when `image_urls` is empty. Poll `getAiImageJob(job_uid)` every 1 second only while active runs exist; stop at all terminal states and on component unmount.

- [ ] **Step 6: Run UI tests and verify GREEN**

Run: `node --test tests/ai-image-workbench-async-batch.test.js app/src/renderer/utils/aiImageModels.test.js`

Expected: all selected tests PASS.

- [ ] **Step 7: Commit Task 4**

```bash
git add app/src/renderer/views/AiImageWorkbench.vue tests/ai-image-workbench-async-batch.test.js
git commit -m "feat(ai-image): show persistent async batch queues"
```

### Task 5: URL fallback and proactive local result cache

**Files:**
- Modify: `app/src/renderer/views/AiImageWorkbench.vue`
- Extend: `tests/ai-image-workbench-async-batch.test.js`

**Interfaces:**
- Produces preview order: ready local data URL -> remote URL -> placeholder.
- Produces proactive `materializeAiImageResult` call when a completed run first exposes a URL.

- [ ] **Step 1: Add failing preview regression tests**

Assert `resultPreviewSrc()` continues to the remote URL when a cached local path has no loaded data URL, and `watch(resultCards)` queues caching immediately instead of waiting for `<img @load>`.

- [ ] **Step 2: Run test and verify RED**

Run: `node --test tests/ai-image-workbench-async-batch.test.js`

Expected: FAIL because local pending currently returns an empty string and cache starts only on remote image load.

- [ ] **Step 3: Implement fallback and proactive cache queueing**

Remove the early empty return for an unread local path, preserve remote candidate fallback, and call `queueResultCache(card)` from the result-card watcher for URL-backed completed items. Keep URL de-duplication and the existing serialized cache promise.

- [ ] **Step 4: Run UI test and verify GREEN**

Run: `node --test tests/ai-image-workbench-async-batch.test.js`

Expected: PASS.

- [ ] **Step 5: Commit Task 5**

```bash
git add app/src/renderer/views/AiImageWorkbench.vue tests/ai-image-workbench-async-batch.test.js
git commit -m "fix(ai-image): fall back while caching previews"
```

### Task 6: Scoped validation and correct-client smoke test

**Files:**
- Verify only; no planned production edits.

- [ ] **Step 1: Inspect final diff and untouched AI 测图 boundary**

Run: `git diff --check 3bc65a3d..HEAD`

Run: `git diff 3bc65a3d..HEAD -- core/one_xm_image.py adapters/tmall-ops-assistant core/api_server.py | sed -n '1,260p'`

Expected: `core/one_xm_image.py` and Tmall adapter files have no changes; `core/api_server.py` changes are limited to the workbench route/models.

- [ ] **Step 2: Run Python suites**

Run: `./venv/bin/python -m unittest tests.test_ai_image_service tests.test_ai_image_workbench_batch tests.test_ai_image_api tests.test_one_xm_image_client tests.test_tmall_ai_image_chain_script -v`

Expected: all tests PASS.

- [ ] **Step 3: Run renderer and bridge tests**

Run: `node --test tests/ai-image-provider-contract.test.js tests/ai-image-workbench-async-batch.test.js tests/ai-image-ipc-bridge.test.js app/src/renderer/utils/aiImageModels.test.js`

Expected: all tests PASS.

- [ ] **Step 4: Run renderer build**

Run: `npm run vite:build`

Working directory: `app`

Expected: Vite build exits 0.

- [ ] **Step 5: Restart only the correct development Electron client**

Use `/Users/xingyicheng/Documents/crawshrimp/.worktrees/cloud-approval-workbench/app/node_modules/electron/dist/Electron.app`; do not start `/Applications/抓虾.app`.

- [ ] **Step 6: Verify a real 3-Prompt batch**

Confirm the modal closes after all three provider task creations return, the current job contains three runs with distinct `task_id/poll_url`, the sidebar does not gain three jobs, the UI updates each run through queued/running/completed, and completed URLs render then appear in `.crawshrimp-runtime/ai-image-cache`.

- [ ] **Step 7: Verify worktree scope**

Run: `git status --short --branch --untracked-files=all`

Expected: only the pre-existing unrelated dirty files remain; implementation files are committed.
