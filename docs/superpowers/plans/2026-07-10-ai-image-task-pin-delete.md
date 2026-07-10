# AI 生图任务置顶与删除实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 AI 生图任务记录增加持久化置顶、安全删除、二次确认和任务缓存清理，同时保护用户下载或另存的图片文件。

**Architecture:** SQLite 保存 `pinned_at` 并负责稳定排序；AI 图片服务在任务锁内校验运行状态、限定缓存根目录并清理文件，再由数据层事务级联删除记录。FastAPI、Electron IPC、preload 和浏览器开发桥接暴露一致接口，Vue 工作台使用独立卡片操作和可访问确认弹窗更新本地状态。

**Tech Stack:** Python 3、SQLite、FastAPI、Electron IPC、Vue 3 Composition API、Node test runner、Python unittest。

## Global Constraints

- 排队中或生成中的任务禁止删除，不取消 1XM 上游任务。
- 只允许删除 `runtime_paths.child_dir("ai-image-cache")` 内的文件。
- `output_dir`、默认下载目录、用户另存目录、上传主图和参考图不得删除。
- 后置顶的任务排在先置顶任务之前；取消置顶不改变普通任务的 `updated_at` 顺序。
- 删除必须经过应用内二次确认弹窗。
- 不新增第三方依赖，不修改 AI 测图脚本。

---

### Task 1: 数据层置顶排序与事务删除

**Files:**
- Modify: `core/data_sink.py`
- Test: `tests/test_ai_image_data_sink.py`

**Interfaces:**
- Produces: `set_ai_image_job_pinned(job_uid: str, pinned: bool) -> dict`
- Produces: `delete_ai_image_job(job_uid: str) -> bool`
- Produces: `list_ai_image_jobs()` 返回 `pinned_at` 并按置顶时间排序。

- [ ] **Step 1: Write the failing data-sink tests**

```python
def test_pinned_jobs_sort_by_latest_pin_without_touching_updated_at(self):
    first = data_sink.create_ai_image_job({"title": "first"})
    second = data_sink.create_ai_image_job({"title": "second"})
    first_updated_at = first["updated_at"]
    data_sink.set_ai_image_job_pinned(first["job_uid"], True)
    data_sink.set_ai_image_job_pinned(second["job_uid"], True)
    listed = data_sink.list_ai_image_jobs()
    self.assertEqual([item["job_uid"] for item in listed[:2]], [second["job_uid"], first["job_uid"]])
    self.assertEqual(data_sink.get_ai_image_job(first["job_uid"])["updated_at"], first_updated_at)
    data_sink.set_ai_image_job_pinned(second["job_uid"], False)
    self.assertEqual(data_sink.list_ai_image_jobs()[0]["job_uid"], first["job_uid"])

def test_delete_job_cascades_assets_and_canvases(self):
    job = data_sink.create_ai_image_job({"title": "delete me"})
    data_sink.create_ai_image_asset({"job_uid": job["job_uid"], "path": "/tmp/result.png"})
    data_sink.create_ai_image_canvas({"job_uid": job["job_uid"], "canvas": {"nodes": []}})
    self.assertTrue(data_sink.delete_ai_image_job(job["job_uid"]))
    self.assertIsNone(data_sink.get_ai_image_job(job["job_uid"]))
    self.assertEqual(data_sink.list_ai_image_assets(job["job_uid"]), [])
    self.assertEqual(data_sink.list_ai_image_canvases(job["job_uid"]), [])
```

- [ ] **Step 2: Run the data-sink tests and verify RED**

Run: `python3 -m unittest tests.test_ai_image_data_sink -v`

Expected: failures because `pinned_at`, `set_ai_image_job_pinned`, and `delete_ai_image_job` do not exist.

- [ ] **Step 3: Add the column, ordering, pin mutation, and transactional delete**

```python
_ensure_column(conn, "ai_image_jobs", "pinned_at", "TEXT NOT NULL DEFAULT ''")

def set_ai_image_job_pinned(job_uid: str, pinned: bool) -> dict:
    uid = str(job_uid or "").strip()
    pinned_at = _now_iso() if bool(pinned) else ""
    with _get_conn() as conn:
        conn.execute("UPDATE ai_image_jobs SET pinned_at=? WHERE job_uid=?", (pinned_at, uid))
        conn.commit()
    return get_ai_image_job(uid) or {}

def delete_ai_image_job(job_uid: str) -> bool:
    uid = str(job_uid or "").strip()
    with _get_conn() as conn:
        found = conn.execute("SELECT 1 FROM ai_image_jobs WHERE job_uid=?", (uid,)).fetchone()
        if not found:
            return False
        conn.execute("DELETE FROM ai_image_assets WHERE job_uid=?", (uid,))
        conn.execute("DELETE FROM ai_image_canvases WHERE job_uid=?", (uid,))
        conn.execute("DELETE FROM ai_image_jobs WHERE job_uid=?", (uid,))
        conn.commit()
    return True
```

Update list ordering to:

```sql
ORDER BY
  CASE WHEN pinned_at <> '' THEN 0 ELSE 1 END,
  pinned_at DESC,
  updated_at DESC,
  id DESC
```

- [ ] **Step 4: Run the data-sink tests and verify GREEN**

Run: `python3 -m unittest tests.test_ai_image_data_sink -v`

Expected: all tests pass.

- [ ] **Step 5: Commit the data layer**

```bash
git add core/data_sink.py tests/test_ai_image_data_sink.py
git commit -m "feat(ai-image): persist task pin ordering"
```

### Task 2: 安全缓存清理与删除 API

**Files:**
- Modify: `core/ai_image_service.py`
- Modify: `core/api_server.py`
- Test: `tests/test_ai_image_service.py`
- Test: `tests/test_ai_image_api.py`

**Interfaces:**
- Consumes: `data_sink.set_ai_image_job_pinned` and `data_sink.delete_ai_image_job`.
- Produces: `delete_workbench_job(job_uid: str) -> dict` returning `ok`, `job_uid`, and `deleted_cache_files`.
- Produces: `PATCH /ai-image/jobs/{job_uid}/pin` and `DELETE /ai-image/jobs/{job_uid}`.

- [ ] **Step 1: Write failing service and API tests**

```python
def test_delete_workbench_job_removes_only_task_cache(self):
    job = data_sink.create_ai_image_job({"title": "cache delete"})
    cache_dir = runtime_paths.child_dir("ai-image-cache")
    cached = cache_dir / f"result-{job['job_uid'][:8]}-test.png"
    cached.write_bytes(PNG_BYTES)
    downloaded = self.root / "downloads" / "saved.png"
    downloaded.parent.mkdir()
    downloaded.write_bytes(PNG_BYTES)
    data_sink.update_ai_image_job(job["job_uid"], {
        "summary": {"result_cache": {"https://cdn.example/result.png": str(cached)}, "output_files": [str(downloaded)]},
    })
    result = ai_image_service.delete_workbench_job(job["job_uid"])
    self.assertEqual(result["deleted_cache_files"], 1)
    self.assertFalse(cached.exists())
    self.assertTrue(downloaded.exists())
    self.assertIsNone(data_sink.get_ai_image_job(job["job_uid"]))

def test_delete_workbench_job_rejects_active_runs(self):
    job = data_sink.create_ai_image_job({"status": "running", "summary": {"runs": [{"status": "running"}]}})
    with self.assertRaises(ai_image_service.ActiveAiImageJobError):
        ai_image_service.delete_workbench_job(job["job_uid"])
    self.assertIsNotNone(data_sink.get_ai_image_job(job["job_uid"]))
```

Add API route assertions for `PATCH /ai-image/jobs/{job_uid}/pin` and `DELETE /ai-image/jobs/{job_uid}`, including 404 and 409 responses.

- [ ] **Step 2: Run service and API tests and verify RED**

Run: `python3 -m unittest tests.test_ai_image_service tests.test_ai_image_api -v`

Expected: failures because the deletion service, pin request model, and routes are missing.

- [ ] **Step 3: Implement guarded cache deletion and API routes**

```python
class ActiveAiImageJobError(RuntimeError):
    pass

def delete_workbench_job(job_uid: str) -> dict:
    uid = _compact(job_uid)
    with _workbench_job_lock(uid):
        job = data_sink.get_ai_image_job(uid)
        if not job:
            raise ValueError(f"AI image job not found: {uid}")
        if _workbench_job_is_active(job):
            raise ActiveAiImageJobError("任务生成中，完成或失败后可删除")
        cache_files = _workbench_job_cache_files(job)
        failed = []
        deleted = 0
        for path in cache_files:
            try:
                path.unlink(missing_ok=True)
                deleted += 1
            except OSError as exc:
                failed.append(f"{path.name}: {exc}")
        if failed:
            raise RuntimeError("本地图片缓存清理失败，请稍后重试")
        if not data_sink.delete_ai_image_job(uid):
            raise ValueError(f"AI image job not found: {uid}")
        return {"ok": True, "job_uid": uid, "deleted_cache_files": deleted}
```

The cache collector must recursively inspect the job, assets, and canvases; resolve every candidate and keep it only when `candidate.is_relative_to(cache_root)`. It must also scan `cache_root` for filenames containing `-{job_uid[:8]}-`.

Expose:

```python
class AiImagePinRequest(BaseModel):
    pinned: bool

@app.patch("/ai-image/jobs/{job_uid}/pin")
def pin_ai_image_job(job_uid: str, req: AiImagePinRequest):
    job = data_sink.set_ai_image_job_pinned(job_uid, req.pinned)
    if not job:
        raise HTTPException(404, f"AI image job not found: {job_uid}")
    return job

@app.delete("/ai-image/jobs/{job_uid}")
def delete_ai_image_job(job_uid: str):
    try:
        return ai_image_service.delete_workbench_job(job_uid)
    except ai_image_service.ActiveAiImageJobError as exc:
        raise HTTPException(409, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
```

- [ ] **Step 4: Run service and API tests and verify GREEN**

Run: `python3 -m unittest tests.test_ai_image_service tests.test_ai_image_api -v`

Expected: all tests pass.

- [ ] **Step 5: Commit service and API behavior**

```bash
git add core/ai_image_service.py core/api_server.py tests/test_ai_image_service.py tests/test_ai_image_api.py
git commit -m "feat(ai-image): safely delete task cache"
```

### Task 3: Electron and browser bridge contracts

**Files:**
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Modify: `app/src/renderer/utils/devCsBridge.js`
- Test: `tests/ai-image-ipc-bridge.test.js`

**Interfaces:**
- Produces: `window.cs.setAiImageJobPinned(uid, pinned)`.
- Produces: `window.cs.deleteAiImageJob(uid)`.

- [ ] **Step 1: Extend the failing IPC bridge contract test**

```javascript
assert.match(main, /secureHandle\('set-ai-image-job-pinned'/)
assert.match(main, /secureHandle\('delete-ai-image-job'/)
assert.match(preload, /setAiImageJobPinned:/)
assert.match(preload, /deleteAiImageJob:/)
assert.match(devBridge, /setAiImageJobPinned: \(uid, pinned\) => apiCall\('PATCH'/)
assert.match(devBridge, /deleteAiImageJob: \(uid\) => apiCall\('DELETE'/)
```

- [ ] **Step 2: Run the bridge test and verify RED**

Run: `node --test tests/ai-image-ipc-bridge.test.js`

Expected: missing handler and method assertions fail.

- [ ] **Step 3: Add matching main, preload, and dev bridge methods**

```javascript
secureHandle('set-ai-image-job-pinned', async (_, jobUid, pinned) =>
  apiCall('PATCH', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}/pin`, { pinned: Boolean(pinned) }))
secureHandle('delete-ai-image-job', async (_, jobUid) =>
  apiCall('DELETE', `/ai-image/jobs/${encodeURIComponent(String(jobUid || ''))}`))
```

Preload and dev bridge implementations must use the same route and body and must call `encodePathPart(uid)`.

- [ ] **Step 4: Run the bridge test and verify GREEN**

Run: `node --test tests/ai-image-ipc-bridge.test.js`

Expected: all bridge tests pass.

- [ ] **Step 5: Commit bridge behavior**

```bash
git add app/src/main.js app/src/preload.js app/src/renderer/utils/devCsBridge.js tests/ai-image-ipc-bridge.test.js
git commit -m "feat(ai-image): bridge task pin and delete"
```

### Task 4: 任务卡交互、确认弹窗和前端状态清理

**Files:**
- Modify: `app/src/renderer/views/AiImageWorkbench.vue`
- Test: `tests/ai-image-workbench-navigation.test.js`
- Test: `tests/ai-image-workbench-accessibility.test.js`

**Interfaces:**
- Consumes: `window.cs.setAiImageJobPinned` and `window.cs.deleteAiImageJob`.
- Produces: task card actions, `toggleTaskPinned(job)`, `openDeleteTaskDialog(job)`, `confirmDeleteTask()`, and accessible delete dialog state.

- [ ] **Step 1: Write failing workbench interaction tests**

```javascript
assert.match(workbench, /class="aiw-history-item"/)
assert.match(workbench, /class="aiw-history-select"/)
assert.match(workbench, /\{\{ job\.pinned_at \? '取消置顶' : '置顶' \}\}/)
assert.match(workbench, /@click\.stop="toggleTaskPinned\(job\)"/)
assert.match(workbench, /@click\.stop="openDeleteTaskDialog\(job, \$event\)"/)
assert.match(workbench, /role="dialog" aria-modal="true" aria-label="确认删除 AI 生图任务"/)
assert.match(workbench, /已下载或另存到本地文件夹的图片不受影响/)
assert.match(workbench, /window\.cs\.deleteAiImageJob/)
assert.doesNotMatch(taskCardBody, /<button[^>]*class="aiw-history-item"[\s\S]*<button/)
```

Accessibility tests must assert that the delete dialog participates in `activeWorkbenchDialog`, focus restoration, Escape handling, and background inert state.

- [ ] **Step 2: Run the workbench tests and verify RED**

Run: `node --test tests/ai-image-workbench-navigation.test.js tests/ai-image-workbench-accessibility.test.js`

Expected: task action and delete dialog assertions fail.

- [ ] **Step 3: Implement task cards and delete dialog**

Use an `article.aiw-history-item` with a child `button.aiw-history-select`, `button.aiw-history-pin`, and `button.aiw-history-delete`. Add:

```javascript
const deleteTaskDialog = reactive({ open: false, job: null, submitting: false, error: '' })

async function toggleTaskPinned(job) {
  const updated = await window.cs.setAiImageJobPinned(job.job_uid, !job.pinned_at)
  upsertJob(updated)
  await loadJobs()
}

async function confirmDeleteTask() {
  const job = deleteTaskDialog.job
  if (!job?.job_uid || deleteTaskDialog.submitting || hasActiveRuns(job)) return
  deleteTaskDialog.submitting = true
  try {
    const result = await window.cs.deleteAiImageJob(job.job_uid)
    await removeDeletedTaskState(job.job_uid)
    closeDeleteTaskDialog()
    announceStatus(`任务已删除，已清理 ${Number(result?.deleted_cache_files || 0)} 个缓存文件`)
  } catch (error) {
    deleteTaskDialog.error = deletionErrorMessage(error)
  } finally {
    deleteTaskDialog.submitting = false
  }
}
```

`removeDeletedTaskState(uid)` must remove the task draft and job, stop matching polling, clear matching preview/cache/session state, load the sorted job list, restore the first remaining task when the current task was deleted, and reset to `defaultAiImageForm` without creating a database row when no task remains.

Add responsive CSS that reserves card space for the two actions and keeps both actions reachable at narrow widths.

- [ ] **Step 4: Run the workbench tests and verify GREEN**

Run: `node --test tests/ai-image-workbench-navigation.test.js tests/ai-image-workbench-accessibility.test.js`

Expected: all workbench interaction and accessibility tests pass.

- [ ] **Step 5: Commit the frontend behavior**

```bash
git add app/src/renderer/views/AiImageWorkbench.vue tests/ai-image-workbench-navigation.test.js tests/ai-image-workbench-accessibility.test.js
git commit -m "feat(ai-image): add task pin and delete controls"
```

### Task 5: 回归与真实界面验收

**Files:**
- Modify: none unless a regression is found.

**Interfaces:**
- Consumes all previous tasks.
- Produces verified local behavior without submitting a paid 1XM request.

- [ ] **Step 1: Run focused and package regression tests**

```bash
python3 -m unittest tests.test_ai_image_data_sink tests.test_ai_image_service tests.test_ai_image_api -v
node --test tests/ai-image-*.test.js app/src/renderer/utils/aiImageAdvancedJson.test.js app/src/renderer/utils/aiImageOperatorMessages.test.js app/src/renderer/utils/dialogAccessibility.test.js
npm --prefix app test
npm --prefix app run vite:build
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 2: Verify the live workbench with a temporary draft task**

At `http://127.0.0.1:5173/`, create two temporary draft tasks without generating images. Pin the first and then the second, verify the second is first; cancel the second pin, verify the first remains first. Open delete on a temporary task, verify the complete warning copy, cancel once, reopen, confirm deletion, and verify the task disappears.

- [ ] **Step 3: Verify physical deletion boundaries**

Create a temporary task cache file under the real runtime `ai-image-cache` and a control file outside the cache root. Delete the temporary task through the UI or API, then verify the cache file is gone and the control file remains.

- [ ] **Step 4: Review final repository state**

Run: `git status --short --branch`

Expected: only intentional feature files are changed or all implementation commits are clean; pre-existing unrelated changes are preserved and reported.
