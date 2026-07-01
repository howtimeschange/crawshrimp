# Crawshrimp Task Center Instances Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the placeholder market tab with a persistent task center and connect `巴拉-AI测图全链路` as the first task-instance workflow.

**Architecture:** Keep adapter manifests and existing `task_runs` as the low-level execution layer. Add a `task_instances` layer in SQLite and expose it through backend APIs and Electron IPC. Add a new `TaskCenter` view and a `TaskInstanceRunner` view, while keeping `TaskRunner` available for legacy one-off script runs.

**Tech Stack:** Vue 3 renderer, Electron preload/main IPC, FastAPI backend, SQLite via `core/data_sink.py`, existing Node and Python test suites.

---

## File Map

- Modify `app/src/renderer/views/TaskRunner.vue`: fix the current runner layout, add a bottom drawer for logs/output files, and keep this as the legacy single-run surface.
- Create `app/src/renderer/views/TaskOutputDrawer.vue`: reusable bottom drawer with `minimized`, `half`, and `expanded` states.
- Modify `app/src/renderer/views/TmallAiApprovalDrawer.vue`: keep embedded approval board compatible with the new scrollable main area.
- Modify `core/data_sink.py`: add task instance schema and CRUD helpers.
- Modify `core/api_server.py`: add task-instance REST APIs and update the run pipeline to associate a run with an instance.
- Modify `app/src/main.js` and `app/src/preload.js`: expose task-instance APIs to the renderer.
- Create `app/src/renderer/views/TaskCenter.vue`: replace the current market tab with current/pending/history task lists.
- Create `app/src/renderer/views/TaskInstanceRunner.vue`: instance-bound runner for `巴拉-AI测图全链路`.
- Modify `app/src/renderer/App.vue`: replace the `market` nav item with `task_center`, route task center and instance runner.
- Create or extend tests under `tests/` and `app/src/renderer/**/*.test.js`: cover schema, API, IPC, UI summaries, and task center behavior.

## Task 1: Fix Existing Runner Layout And Output Drawer

**Files:**
- Create: `app/src/renderer/views/TaskOutputDrawer.vue`
- Modify: `app/src/renderer/views/TaskRunner.vue`
- Test: `app/src/renderer/utils/taskOutputSummary.test.js`
- Create: `app/src/renderer/utils/taskOutputSummary.js`

- [ ] **Step 1: Add output summary utility test**

Create `app/src/renderer/utils/taskOutputSummary.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeOutputFiles } from './taskOutputSummary.js'

test('summarizeOutputFiles groups tables images directories and other files', () => {
  const summary = summarizeOutputFiles([
    '/tmp/result.xlsx',
    '/tmp/source/a.jpg',
    '/tmp/generated/b.png',
    '/tmp/export-folder',
    '/tmp/readme.txt',
  ])

  assert.equal(summary.total, 5)
  assert.equal(summary.tables, 1)
  assert.equal(summary.images, 2)
  assert.equal(summary.directories, 1)
  assert.equal(summary.others, 1)
  assert.equal(summary.label, '表格 1 个 / 图片 2 张 / 目录 1 个 / 其他 1 个')
})

test('summarizeOutputFiles returns empty label for no output files', () => {
  const summary = summarizeOutputFiles([])

  assert.equal(summary.total, 0)
  assert.equal(summary.label, '暂无输出文件')
})
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/app
node --test src/renderer/utils/taskOutputSummary.test.js
```

Expected: fails because `taskOutputSummary.js` does not exist.

- [ ] **Step 3: Add output summary utility**

Create `app/src/renderer/utils/taskOutputSummary.js`:

```js
function cleanPath(value) {
  return String(value || '').trim()
}

function isImagePath(path) {
  return /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(cleanPath(path))
}

function isTablePath(path) {
  return /\.(xlsx|xlsm|xls|csv)$/i.test(cleanPath(path))
}

function isDirectoryLike(path) {
  const value = cleanPath(path)
  if (!value) return false
  const basename = value.split(/[\\/]/).pop() || ''
  return !/\.[^./\\]+$/.test(basename)
}

function buildLabel(summary) {
  if (!summary.total) return '暂无输出文件'
  const parts = []
  if (summary.tables) parts.push(`表格 ${summary.tables} 个`)
  if (summary.images) parts.push(`图片 ${summary.images} 张`)
  if (summary.directories) parts.push(`目录 ${summary.directories} 个`)
  if (summary.others) parts.push(`其他 ${summary.others} 个`)
  return parts.join(' / ')
}

export function summarizeOutputFiles(files = []) {
  const summary = {
    total: 0,
    tables: 0,
    images: 0,
    directories: 0,
    others: 0,
    label: '',
  }

  for (const item of files || []) {
    const path = cleanPath(item)
    if (!path) continue
    summary.total += 1
    if (isTablePath(path)) summary.tables += 1
    else if (isImagePath(path)) summary.images += 1
    else if (isDirectoryLike(path)) summary.directories += 1
    else summary.others += 1
  }

  summary.label = buildLabel(summary)
  return summary
}
```

- [ ] **Step 4: Run utility test and app test suite**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/app
node --test src/renderer/utils/taskOutputSummary.test.js
npm test
```

Expected: both pass.

- [ ] **Step 5: Create reusable bottom drawer component**

Create `app/src/renderer/views/TaskOutputDrawer.vue` with props:

```vue
<template>
  <section :class="['task-output-drawer', drawerState]">
    <header class="task-output-head">
      <div class="task-output-tabs" role="tablist">
        <button
          type="button"
          :class="{ active: activeTab === 'logs' }"
          role="tab"
          :aria-selected="activeTab === 'logs'"
          @click="activeTab = 'logs'"
        >
          运行日志
        </button>
        <button
          type="button"
          :class="{ active: activeTab === 'files' }"
          role="tab"
          :aria-selected="activeTab === 'files'"
          @click="activeTab = 'files'"
        >
          输出文件
          <span>{{ outputSummary.label }}</span>
        </button>
      </div>
      <div class="task-output-actions">
        <button type="button" @click="$emit('clear-logs')">清空</button>
        <button type="button" @click="drawerState = 'minimized'">最小化</button>
        <button type="button" @click="drawerState = 'half'">半高</button>
        <button type="button" @click="drawerState = 'expanded'">展开</button>
      </div>
    </header>

    <div v-if="drawerState !== 'minimized'" class="task-output-body">
      <div v-show="activeTab === 'logs'" ref="logBodyEl" class="task-output-log">
        <div v-if="!logs.length" class="task-output-empty">暂无运行日志</div>
        <div v-for="(line, index) in logs" :key="index" :class="['log-line', logClass(line)]">{{ line }}</div>
      </div>
      <div v-show="activeTab === 'files'" class="task-output-files">
        <div class="task-output-summary">{{ outputSummary.label }}</div>
        <div v-if="!files.length" class="task-output-empty">暂无输出文件</div>
        <div v-for="file in files" :key="file" class="task-output-file-row">
          <span>{{ fileName(file) }}</span>
          <button type="button" @click="$emit('open-file', file)">打开</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { summarizeOutputFiles } from '../utils/taskOutputSummary'

const props = defineProps({
  logs: { type: Array, default: () => [] },
  files: { type: Array, default: () => [] },
  logClass: { type: Function, default: () => '' },
})

defineEmits(['clear-logs', 'open-file'])

const activeTab = ref('logs')
const drawerState = ref('half')
const logBodyEl = ref(null)
const outputSummary = computed(() => summarizeOutputFiles(props.files))

function fileName(path) {
  return String(path || '').split('/').pop().split('\\').pop()
}

watch(() => props.logs.length, () => {
  nextTick(() => {
    if (logBodyEl.value) logBodyEl.value.scrollTop = logBodyEl.value.scrollHeight
  })
})
</script>
```

Paste this scoped CSS in the same file:

```css
.task-output-drawer {
  flex: 0 0 auto;
  min-height: 42px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--bg2);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.task-output-drawer.minimized { height: 42px; }
.task-output-drawer.half { height: min(320px, 34vh); }
.task-output-drawer.expanded { height: min(560px, 58vh); }
.task-output-head {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 14px;
  border-bottom: 1px solid var(--border);
}
.task-output-tabs,
.task-output-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.task-output-tabs button,
.task-output-actions button {
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg3);
  color: var(--text2);
  padding: 6px 10px;
  font-size: 12px;
}
.task-output-tabs button.active {
  border-color: rgba(255, 106, 41, .48);
  color: var(--orange);
  background: rgba(255, 106, 41, .1);
}
.task-output-tabs span {
  margin-left: 8px;
  color: var(--text3);
}
.task-output-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
}
.task-output-log,
.task-output-files {
  height: 100%;
  overflow-y: auto;
  padding: 12px 16px;
}
.task-output-empty {
  color: var(--text3);
  text-align: center;
  padding: 28px 0;
}
.task-output-summary {
  color: var(--text2);
  font-size: 12px;
  margin-bottom: 10px;
}
.task-output-file-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 10px;
  align-items: center;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, .04);
}
.task-output-file-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}
```

- [ ] **Step 6: Integrate drawer into `TaskRunner.vue`**

Modify `TaskRunner.vue`:

```js
import TaskOutputDrawer from './TaskOutputDrawer.vue'
```

Replace the current large `.log-panel` block with:

```vue
<TaskOutputDrawer
  :logs="logs"
  :files="outputFiles"
  :log-class="logClass"
  @clear-logs="clearLogs"
  @open-file="openFile"
/>
```

Change the runner body structure so the active step content sits in a scrollable wrapper above the drawer:

```vue
<div class="runner-body">
  <div class="runner-main-scroll">
    <!-- params / approval / result sections stay here -->
  </div>
  <TaskOutputDrawer
    :logs="logs"
    :files="outputFiles"
    :log-class="logClass"
    @clear-logs="clearLogs"
    @open-file="openFile"
  />
</div>
```

Update CSS:

```css
.runner-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.runner-main-scroll {
  flex: 1;
  min-height: 360px;
  overflow-y: auto;
}
```

- [ ] **Step 7: Validate layout build**

Run:

```bash
cd /Users/xingyicheng/Documents/crawshrimp/app
npm run vite:build
npm test
```

Expected: build passes and all Node tests pass.

- [ ] **Step 8: Commit layout fix**

```bash
git add app/src/renderer/views/TaskOutputDrawer.vue app/src/renderer/views/TaskRunner.vue app/src/renderer/utils/taskOutputSummary.js app/src/renderer/utils/taskOutputSummary.test.js
git commit -m "fix(task-runner): add collapsible output drawer"
```

## Task 2: Add Task Instance Persistence

**Files:**
- Modify: `core/data_sink.py`
- Test: `tests/test_task_instances_data_sink.py`

- [ ] **Step 1: Write data-sink tests**

Create `tests/test_task_instances_data_sink.py`:

```python
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class TaskInstancesDataSinkTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=self.root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_create_and_get_task_instance(self):
        instance = data_sink.create_task_instance(
            adapter_id="tmall-ops-assistant",
            task_id="tmall_ai_image_test_chain",
            title="AI测图任务",
            params={"execute_mode": "approval_then_create"},
        )

        loaded = data_sink.get_task_instance(instance["instance_uid"])
        self.assertEqual(loaded["title"], "AI测图任务")
        self.assertEqual(loaded["status"], "draft")
        self.assertEqual(json.loads(loaded["params_json"])["execute_mode"], "approval_then_create")

    def test_link_run_and_artifact(self):
        instance = data_sink.create_task_instance("tmall-ops-assistant", "tmall_ai_image_test_chain", "AI测图任务", {})
        run_id = data_sink.begin_run("tmall-ops-assistant", "tmall_ai_image_test_chain")

        data_sink.link_task_instance_run(instance["instance_uid"], run_id, purpose="main")
        data_sink.add_task_instance_artifact(instance["instance_uid"], kind="excel", label="执行证据", path="/tmp/a.xlsx")

        detail = data_sink.get_task_instance_detail(instance["instance_uid"])
        self.assertEqual(detail["runs"][0]["run_id"], run_id)
        self.assertEqual(detail["artifacts"][0]["path"], "/tmp/a.xlsx")
        self.assertEqual(detail["last_run_id"], run_id)

    def test_list_task_instances_status_group(self):
        waiting = data_sink.create_task_instance("tmall-ops-assistant", "tmall_ai_image_test_chain", "待审批", {})
        done = data_sink.create_task_instance("tmall-ops-assistant", "tmall_ai_image_test_chain", "完成", {})
        data_sink.update_task_instance(waiting["instance_uid"], status="waiting_approval")
        data_sink.update_task_instance(done["instance_uid"], status="completed")

        pending = data_sink.list_task_instances(status_group="pending")
        history = data_sink.list_task_instances(status_group="history")

        self.assertEqual([row["title"] for row in pending], ["待审批"])
        self.assertEqual([row["title"] for row in history], ["完成"])


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
venv/bin/python -m unittest tests.test_task_instances_data_sink
```

Expected: fails because helper functions do not exist.

- [ ] **Step 3: Extend SQLite schema and helpers**

Modify `core/data_sink.py`:

- `init_db()` creates `task_instances`, `task_instance_runs`, `task_instance_artifacts`, and `task_instance_events`.
- Add helpers:

Add these helper functions with the exact names used by later tasks:

```python
def create_task_instance(adapter_id: str, task_id: str, title: str, params: Optional[Mapping[str, Any]] = None) -> dict:
    """Insert a draft task instance and return the inserted row."""

def get_task_instance(instance_uid: str) -> Optional[dict]:
    """Return one task instance row by uid."""

def get_task_instance_detail(instance_uid: str) -> dict:
    """Return one task instance plus parsed params, parsed summary, runs, artifacts, and events."""

def list_task_instances(status_group: str = "", adapter_id: str = "", task_id: str = "", keyword: str = "", limit: int = 100) -> list[dict]:
    """Return task instances filtered by status group and metadata."""

def update_task_instance(instance_uid: str, **fields) -> dict:
    """Update allowed task instance fields and return the updated row."""

def link_task_instance_run(instance_uid: str, run_id: int, purpose: str = "main") -> None:
    """Associate a task_runs row with a task instance."""

def add_task_instance_artifact(instance_uid: str, kind: str, label: str, path: str, meta: Optional[Mapping[str, Any]] = None) -> dict:
    """Insert an artifact row and return it."""

def add_task_instance_event(instance_uid: str, event_type: str, message: str, meta: Optional[Mapping[str, Any]] = None) -> dict:
    """Insert an event row and return it."""
```

Use `uuid.uuid4().hex` for `instance_uid`, ISO timestamps via `datetime.now().isoformat()`, and JSON encoding with `ensure_ascii=False`.

- [ ] **Step 4: Run data-sink tests**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
venv/bin/python -m unittest tests.test_task_instances_data_sink
```

Expected: pass.

- [ ] **Step 5: Commit persistence layer**

```bash
git add core/data_sink.py tests/test_task_instances_data_sink.py
git commit -m "feat(task-center): add task instance persistence"
```

## Task 3: Add Backend And IPC APIs

**Files:**
- Modify: `core/api_server.py`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Test: `tests/test_task_instances_api.py`

- [ ] **Step 1: Write API tests**

Create `tests/test_task_instances_api.py` using `TestClient`:

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from core import api_server, data_sink


class TaskInstancesApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()
        self.client = TestClient(api_server.app)

    def test_create_list_and_get_instance(self):
        created = self.client.post("/task-instances", json={
            "adapter_id": "tmall-ops-assistant",
            "task_id": "tmall_ai_image_test_chain",
            "title": "AI测图任务",
            "params": {"execute_mode": "approval_then_create"},
        }).json()

        self.assertTrue(created["instance_uid"])
        listed = self.client.get("/task-instances?status_group=current").json()
        self.assertEqual(listed["items"], [])

        detail = self.client.get(f"/task-instances/{created['instance_uid']}").json()
        self.assertEqual(detail["title"], "AI测图任务")
        self.assertEqual(detail["params"]["execute_mode"], "approval_then_create")

    def test_patch_archive_instance(self):
        created = self.client.post("/task-instances", json={
            "adapter_id": "tmall-ops-assistant",
            "task_id": "tmall_ai_image_test_chain",
            "title": "AI测图任务",
            "params": {},
        }).json()

        updated = self.client.patch(f"/task-instances/{created['instance_uid']}", json={
            "archived": True,
        }).json()

        self.assertEqual(updated["status"], "archived")
        self.assertEqual(updated["archived"], 1)
```

- [ ] **Step 2: Run API tests to verify failure**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
venv/bin/python -m unittest tests.test_task_instances_api
```

Expected: 404 for missing endpoints.

- [ ] **Step 3: Add FastAPI models and endpoints**

Modify `core/api_server.py`:

```python
class TaskInstanceCreateRequest(BaseModel):
    adapter_id: str
    task_id: str
    title: str
    params: dict = {}

class TaskInstancePatchRequest(BaseModel):
    title: Optional[str] = None
    status: Optional[str] = None
    current_step: Optional[str] = None
    params: Optional[dict] = None
    archived: Optional[bool] = None

@app.get("/task-instances")
def list_task_instances_endpoint(
    status_group: str = "",
    adapter_id: str = "",
    task_id: str = "",
    keyword: str = "",
    limit: int = 100,
):
    items = data_sink.list_task_instances(status_group=status_group, adapter_id=adapter_id, task_id=task_id, keyword=keyword, limit=limit)
    return {"items": [_serialize_task_instance(row) for row in items]}

@app.post("/task-instances")
def create_task_instance_endpoint(req: TaskInstanceCreateRequest):
    row = data_sink.create_task_instance(req.adapter_id, req.task_id, req.title, req.params)
    return _serialize_task_instance(row)

@app.get("/task-instances/{instance_uid}")
def get_task_instance_endpoint(instance_uid: str):
    detail = data_sink.get_task_instance_detail(instance_uid)
    if not detail:
        raise HTTPException(404, "Task instance not found")
    return _serialize_task_instance_detail(detail)

@app.patch("/task-instances/{instance_uid}")
def patch_task_instance_endpoint(instance_uid: str, req: TaskInstancePatchRequest):
    patch = req.model_dump(exclude_unset=True)
    if patch.get("archived") is True:
        patch["status"] = "archived"
    row = data_sink.update_task_instance(instance_uid, **patch)
    return _serialize_task_instance(row)
```

Return parsed `params` and `summary` objects in API responses, not only raw JSON strings.

- [ ] **Step 4: Add IPC bridge**

Modify `app/src/main.js`:

```js
secureHandle('list-task-instances', async (_, query = {}) => apiCall('GET', `/task-instances?${new URLSearchParams(query)}`))
secureHandle('create-task-instance', async (_, payload) => apiCall('POST', '/task-instances', payload))
secureHandle('get-task-instance', async (_, instanceUid) => apiCall('GET', `/task-instances/${encodeURIComponent(instanceUid)}`))
secureHandle('update-task-instance', async (_, instanceUid, payload) => apiCall('PATCH', `/task-instances/${encodeURIComponent(instanceUid)}`, payload))
```

Modify `app/src/preload.js`:

```js
listTaskInstances: (query) => ipcRenderer.invoke('list-task-instances', query),
createTaskInstance: (payload) => ipcRenderer.invoke('create-task-instance', payload),
getTaskInstance: (uid) => ipcRenderer.invoke('get-task-instance', uid),
updateTaskInstance: (uid, payload) => ipcRenderer.invoke('update-task-instance', uid, payload),
```

- [ ] **Step 5: Run API and packaging tests**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
venv/bin/python -m unittest tests.test_task_instances_api tests.test_task_instances_data_sink tests.test_api_task_lifecycle
cd app
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit API layer**

```bash
git add core/api_server.py app/src/main.js app/src/preload.js tests/test_task_instances_api.py
git commit -m "feat(task-center): expose task instance APIs"
```

## Task 4: Replace Market With Task Center

**Files:**
- Create: `app/src/renderer/views/TaskCenter.vue`
- Modify: `app/src/renderer/App.vue`
- Test: `tests/task-center-navigation.test.js`

- [ ] **Step 1: Add navigation test**

Create `tests/task-center-navigation.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

test('App navigation replaces market with task center', () => {
  const app = fs.readFileSync('app/src/renderer/App.vue', 'utf8')
  assert.match(app, /label: '任务中心'/)
  assert.match(app, /id: 'task_center'/)
  assert.doesNotMatch(app, /label: '抓虾市场'/)
})

test('TaskCenter exposes AI image task creation copy', () => {
  const view = fs.readFileSync('app/src/renderer/views/TaskCenter.vue', 'utf8')
  assert.match(view, /新增 AI 测图任务/)
  assert.match(view, /当前任务/)
  assert.match(view, /待处理/)
  assert.match(view, /历史任务/)
})
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
node --test tests/task-center-navigation.test.js
```

Expected: fails because view does not exist and nav still says `抓虾市场`.

- [ ] **Step 3: Create `TaskCenter.vue`**

Create a Vue component that:

- Calls `window.cs.listTaskInstances({ status_group: activeGroup, keyword })`.
- Shows tabs for `current`, `pending`, `history`.
- Has a `新增 AI 测图任务` button that calls `window.cs.createTaskInstance`.
- Emits `open-instance` with the returned `instance_uid`.

Core script shape:

```js
const activeGroup = ref('current')
const keyword = ref('')
const items = ref([])
const loading = ref(false)

async function loadInstances() {
  loading.value = true
  try {
    const result = await window.cs.listTaskInstances({ status_group: activeGroup.value, keyword: keyword.value })
    items.value = result.items || []
  } finally {
    loading.value = false
  }
}

async function createAiImageTask() {
  const result = await window.cs.createTaskInstance({
    adapter_id: 'tmall-ops-assistant',
    task_id: 'tmall_ai_image_test_chain',
    title: `AI测图任务 ${new Date().toLocaleString('zh-CN', { hour12: false })}`,
    params: {},
  })
  emit('open-instance', result.instance_uid)
}
```

- [ ] **Step 4: Wire App navigation**

Modify `App.vue`:

- Import `TaskCenter`.
- Replace nav item `{ id: 'market', icon: '🏪', label: '抓虾市场' }` with `{ id: 'task_center', icon: '📋', label: '任务中心' }`.
- Add `activeInstanceUid = ref('')`.
- Render `TaskCenter` when `currentView === 'task_center' && !activeInstanceUid`.
- Add handler `openTaskInstance(uid)` to set `activeInstanceUid`.

- [ ] **Step 5: Run UI tests and build**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
node --test tests/task-center-navigation.test.js
cd app
npm run vite:build
npm test
```

Expected: all pass.

- [ ] **Step 6: Commit task center shell**

```bash
git add app/src/renderer/views/TaskCenter.vue app/src/renderer/App.vue tests/task-center-navigation.test.js
git commit -m "feat(task-center): replace market tab"
```

## Task 5: Instance-Bound Runner For Bala AI Image Tests

**Files:**
- Create: `app/src/renderer/views/TaskInstanceRunner.vue`
- Modify: `app/src/renderer/App.vue`
- Modify: `core/api_server.py`
- Test: `tests/test_task_instance_run_api.py`

- [ ] **Step 1: Add run API test**

Create `tests/test_task_instance_run_api.py`:

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient

from core import api_server, data_sink


class TaskInstanceRunApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()
        self.client = TestClient(api_server.app)

    def test_run_instance_injects_instance_uid(self):
        created = self.client.post("/task-instances", json={
            "adapter_id": "tmall-ops-assistant",
            "task_id": "tmall_ai_image_test_chain",
            "title": "AI测图任务",
            "params": {"execute_mode": "approval_then_create"},
        }).json()

        with patch("core.api_server._run_task_background", new_callable=AsyncMock) as bg:
            result = self.client.post(f"/task-instances/{created['instance_uid']}/run").json()

        self.assertTrue(result["ok"])
        args = bg.call_args.args
        self.assertEqual(args[0], "tmall-ops-assistant")
        self.assertEqual(args[1], "tmall_ai_image_test_chain")
        self.assertEqual(args[2]["__task_instance_uid"], created["instance_uid"])
```

- [ ] **Step 2: Run test to verify failure**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
venv/bin/python -m unittest tests.test_task_instance_run_api
```

Expected: fails because run endpoint is missing.

- [ ] **Step 3: Add instance run endpoint**

Modify `core/api_server.py`:

```python
@app.post("/task-instances/{instance_uid}/run")
async def run_task_instance(instance_uid: str):
    instance = data_sink.get_task_instance(instance_uid)
    if not instance:
        raise HTTPException(404, "Task instance not found")
    params = json.loads(instance.get("params_json") or "{}")
    params["__task_instance_uid"] = instance_uid
    data_sink.update_task_instance(instance_uid, status="running", current_step="config")
    return await run_task(instance["adapter_id"], instance["task_id"], params)
```

Extract this helper before adding the endpoint, then make both the existing task route and instance route use it:

```python
async def _start_task_run(adapter_id: str, task_id: str, params: Optional[dict] = None, runtime_options: Optional[dict] = None):
    adapter_loader.scan_all()
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    if not any(t.id == task_id for t in m.tasks):
        raise HTTPException(404, f"Task not found: {task_id}")

    jid = f"{adapter_id}::{task_id}"
    if _task_is_active(jid):
        raise HTTPException(409, "任务正在运行中，请先暂停/继续/停止当前任务")

    run_control = _build_run_control()
    task_handle = asyncio.create_task(_run_task_background(adapter_id, task_id, params or {}, runtime_options or {}, run_control))
    run_control["task"] = task_handle
    _run_controls[jid] = run_control
    return {"ok": True, "message": "Task started in background"}
```

- [ ] **Step 4: Associate run IDs with instances**

In `_execute_task`, after the existing `run_id = data_sink.begin_run(adapter_id, task_id)` line, read `instance_uid = str(run_params.get("__task_instance_uid") or "").strip()` and call:

```python
if instance_uid:
    data_sink.link_task_instance_run(instance_uid, run_id, purpose="main")
```

When a run finishes, update the instance status:

- approval board URL found: `waiting_approval`, current step `approval`
- done without approval: `completed`, current step `create`
- error: `failed`
- stopped: `stopped`

- [ ] **Step 5: Create `TaskInstanceRunner.vue`**

Implement:

- Loads instance via `window.cs.getTaskInstance(instanceUid)`.
- Reuses task manifest from `scriptGroups` to render params.
- Saves params with `window.cs.updateTaskInstance(instanceUid, { params })`.
- Runs with `window.cs.runTaskInstance(instanceUid)`.
- Shows the same three steps as the AI chain runner.
- Uses `TaskOutputDrawer` for instance logs/artifacts.

Add preload/main IPC:

```js
runTaskInstance: (uid) => ipcRenderer.invoke('run-task-instance', uid)
```

and:

```js
secureHandle('run-task-instance', async (_, uid) => apiCall('POST', `/task-instances/${encodeURIComponent(uid)}/run`, {}))
```

- [ ] **Step 6: Wire App instance route**

`App.vue`:

```vue
<TaskInstanceRunner
  v-else-if="currentView === 'task_center' && activeInstanceUid"
  :instance-uid="activeInstanceUid"
  @back="activeInstanceUid = ''"
/>
```

- [ ] **Step 7: Run full validation**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
venv/bin/python -m unittest tests.test_task_instances_data_sink tests.test_task_instances_api tests.test_task_instance_run_api tests.test_api_task_lifecycle
node --test tests/task-center-navigation.test.js
cd app
npm run vite:build
npm test
```

Expected: all pass.

- [ ] **Step 8: Commit instance runner**

```bash
git add core/api_server.py app/src/main.js app/src/preload.js app/src/renderer/App.vue app/src/renderer/views/TaskInstanceRunner.vue tests/test_task_instance_run_api.py
git commit -m "feat(task-center): run AI image task instances"
```

## Task 6: Approval, Artifacts, And History Readback

**Files:**
- Modify: `core/api_server.py`
- Modify: `app/src/renderer/views/TaskInstanceRunner.vue`
- Test: `tests/test_task_instance_artifacts.py`

- [ ] **Step 1: Add artifact sync test**

Create `tests/test_task_instance_artifacts.py`:

```python
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import data_sink


class TaskInstanceArtifactsTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        root = Path(self.tmp.name)
        patcher = patch("core.runtime_paths.data_root", return_value=root)
        patcher.start()
        self.addCleanup(patcher.stop)
        data_sink.init_db()

    def test_artifact_summary_counts_files(self):
        instance = data_sink.create_task_instance("tmall-ops-assistant", "tmall_ai_image_test_chain", "AI测图任务", {})
        data_sink.add_task_instance_artifact(instance["instance_uid"], "excel", "执行证据", "/tmp/a.xlsx")
        data_sink.add_task_instance_artifact(instance["instance_uid"], "image", "AI图", "/tmp/a.png")
        data_sink.add_task_instance_artifact(instance["instance_uid"], "directory", "导出目录", "/tmp/export")

        detail = data_sink.get_task_instance_detail(instance["instance_uid"])
        kinds = [row["kind"] for row in detail["artifacts"]]
        self.assertEqual(kinds, ["excel", "image", "directory"])
```

- [ ] **Step 2: Sync outputs into artifacts**

In `_execute_task` finish path, if `instance_uid` is present:

- For each output file, derive kind:
  - `.xlsx`, `.xls`, `.csv` -> `excel`
  - image extension -> `image`
  - no extension -> `directory`
  - otherwise `file`
- Call `data_sink.add_task_instance_artifact(instance_uid, kind=kind, label=Path(path).name, path=path, meta={"run_id": run_id})`.
- Store approval batch id/token when approval URL exists.

- [ ] **Step 3: Update approval submit endpoint**

When `/tmall-ai-image-approval/api/{batch_id}/submit` returns upload/create results, find matching instance by `approval_batch_id` and update:

- `status`: `completed` or `partial_failed`
- `current_step`: `create`
- `summary_json`: attempted/succeeded/failed counts

- [ ] **Step 4: Show history readback**

In `TaskInstanceRunner.vue`, show:

- Config values from `instance.params`
- Approval batch board when `approval_batch_id` exists
- Create result summary from `summary`
- Artifacts from `window.cs.getTaskInstance(instanceUid)`

- [ ] **Step 5: Validate and commit**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
venv/bin/python -m unittest tests.test_task_instance_artifacts tests.test_task_instances_data_sink tests.test_task_instances_api tests.test_task_instance_run_api tests.test_tmall_ai_image_approval_api
cd app
npm run vite:build
npm test
git add core/api_server.py core/data_sink.py app/src/renderer/views/TaskInstanceRunner.vue tests/test_task_instance_artifacts.py
git commit -m "feat(task-center): persist AI image task artifacts"
```

## Final Validation

- [ ] **Run backend and frontend suites**

```bash
cd /Users/xingyicheng/Documents/crawshrimp
venv/bin/python -m unittest tests.test_task_instances_data_sink tests.test_task_instances_api tests.test_task_instance_run_api tests.test_task_instance_artifacts tests.test_api_task_lifecycle tests.test_tmall_ai_image_chain_script tests.test_tmall_ai_image_approval_api tests.test_tmall_ops_manifest tests.test_tmall_ops_packaging
node --test tests/task-center-navigation.test.js tests/tmall-ops-assistant-task-dashboard.test.js tests/tmall-ops-assistant-ai-image-workflow.test.js tests/tmall-ops-assistant-material-test.test.js
cd app
npm run vite:build
npm test
```

- [ ] **Browser verification**

Open `http://127.0.0.1:5173/` in the dev environment and verify:

1. Sidebar shows `任务中心` instead of `抓虾市场`.
2. `新增 AI 测图任务` creates a new instance.
3. New instance opens with empty configuration.
4. Step content scrolls independently.
5. Bottom drawer switches between minimized, half, and expanded.
6. Output tab shows summary before details.

- [ ] **Commit browser polish**

If browser verification produces CSS or copy polish, commit those changes:

```bash
git add app/src/renderer/views/TaskCenter.vue app/src/renderer/views/TaskInstanceRunner.vue app/src/renderer/views/TaskOutputDrawer.vue app/src/renderer/App.vue
git commit -m "polish(task-center): verify task instance workflow"
```
