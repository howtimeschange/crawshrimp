# AI 视频找图页运营台式组件优化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Improve the find-materials step of AI 视频工作流 with denser, clearer task and selection feedback while preserving its existing layout and behavior.

**Architecture:** Keep the existing `materials` template branch and reactive material state. Add a display-only material task stage derived from `materialTask.status`, add a compact stat strip using `materialGroups`, `materialSummary`, and `selectedMaterialCount`, then refine the existing component CSS rather than adding routes, modals, or API calls.

**Tech Stack:** Vue 3 Composition API, scoped CSS, Node built-in test runner, Vite, Electron.

## Global Constraints

- Preserve the existing two-column find-materials layout and the current workflow step order.
- Do not change backend APIs, persisted data, material-selection logic, or the review-to-video handoff boundary.
- Use existing dark tokens and orange as the primary action color; reserve green, amber, and red for state semantics.
- Keep keyboard material selection, focus indicators, and reduced-motion support intact.
- Do not stage the existing unrelated fourth-step changes in `balaAiVideoWorkflow.test.js` or `AiVideoWorkflow.vue` with this feature commit.

---

### Task 1: Lock the find-materials visual contract with a failing regression test

**Files:**
- Modify: `app/src/renderer/utils/balaAiVideoWorkflow.test.js:135-165`
- Test: `app/src/renderer/utils/balaAiVideoWorkflow.test.js`

**Interfaces:**
- Consumes: `AiVideoWorkflow.vue` source text.
- Produces: A regression contract for `materialTaskStage`, the material stat strip, and selected-material presentation hooks.

- [ ] **Step 1: Write the failing test**

Add this test immediately after the existing video-task bulk-selection test:

```js
test('find-materials page exposes operational state, aligned stats, and selected-card feedback', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /const materialTaskStage = computed/)
  assert.match(workflowSource, /class="aiv-material-task-state"/)
  assert.match(workflowSource, /class="aiv-material-stat-strip"/)
  assert.match(workflowSource, /class="aiv-material-stat"/)
  assert.match(workflowSource, /class="aiv-material-selection-summary"/)
})
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `node --test src/renderer/utils/balaAiVideoWorkflow.test.js`

Expected: FAIL in `find-materials page exposes operational state...` because the new material display hooks do not exist.

- [ ] **Step 3: Leave the red test unstaged until the implementation is green**

Keep the failing test in the worktree and do not stage it yet. The final implementation commit will use `git add -p` so its test hunk remains separate from the existing fourth-step test hunk.

### Task 2: Add display-only task stage and stat strip to the find-materials page

**Files:**
- Modify: `app/src/renderer/views/AiVideoWorkflow.vue:41-137,2106-2108`
- Test: `app/src/renderer/utils/balaAiVideoWorkflow.test.js`

**Interfaces:**
- Consumes: `materialTask.status`, `materialIsRunning`, `materialGroups`, `materialSummary`, and `selectedMaterialCount`.
- Produces: `materialTaskStage` with `{ id, label, detail }`, plus markup classes used by Task 3.

- [ ] **Step 1: Add the display-only stage computation**

Place this after `selectedMaterialCount`:

```js
const materialTaskStage = computed(() => {
  if (materialTask.error || materialTask.status === 'failed') {
    return { id: 'failed', label: '需要处理', detail: '找图失败，可查看提示后重试。' }
  }
  if (materialIsRunning.value) {
    return { id: 'running', label: '正在找图', detail: materialTask.message || '正在读取并规整素材。' }
  }
  if (materialGroups.length) {
    return { id: 'ready', label: '素材已就绪', detail: '可继续筛选素材并进入 AI 改图。' }
  }
  return { id: 'idle', label: '等待找图', detail: '输入款号后开始从云盘获取素材。' }
})
```

- [ ] **Step 2: Add the compact display components without moving the page regions**

In the left `.aiv-panel-head` title block, append:

```html
<span :class="['aiv-material-task-state', `is-${materialTaskStage.id}`]">
  <i aria-hidden="true"></i>{{ materialTaskStage.label }}
</span>
```

Below the right results header and before `.aiv-material-style-tabs`, add:

```html
<div class="aiv-material-stat-strip" aria-label="找图批次概览">
  <div class="aiv-material-stat"><strong>{{ materialGroups.length }}</strong><span>款号</span></div>
  <div class="aiv-material-stat"><strong>{{ materialSummary.modelCount + materialSummary.detailCount }}</strong><span>已回显素材</span></div>
  <div class="aiv-material-stat selected"><strong>{{ selectedMaterialCount }}</strong><span>已选择</span></div>
  <p class="aiv-material-selection-summary">{{ materialTaskStage.detail }}</p>
</div>
```

- [ ] **Step 3: Run the focused test to verify it passes**

Run: `node --test src/renderer/utils/balaAiVideoWorkflow.test.js`

Expected: PASS, including `find-materials page exposes operational state...`.

### Task 3: Polish existing find-materials components and confirm desktop behavior

**Files:**
- Modify: `app/src/renderer/views/AiVideoWorkflow.vue:7259-7338,7612-7726,7948-8135,9764-9820`
- Test: `app/src/renderer/utils/balaAiVideoWorkflow.test.js`

**Interfaces:**
- Consumes: Task 2 classes `aiv-material-task-state`, `aiv-material-stat-strip`, `aiv-material-stat`, and `aiv-material-selection-summary`.
- Produces: Component-level presentation only; no new events, model bindings, or network calls.

- [ ] **Step 1: Apply scoped CSS refinements**

First add this failing test after the Task 1 test:

```js
test('find-materials controls use visible selected and active feedback', async () => {
  const workflowSource = await readFile(new URL('../views/AiVideoWorkflow.vue', import.meta.url), 'utf8')

  assert.match(workflowSource, /\.aiv-material-task-state\.is-running\s*\{[\s\S]*?color:\s*#60a5fa/)
  assert.match(workflowSource, /\.aiv-thumb\.selected\s*\{[\s\S]*?box-shadow:/)
  assert.match(workflowSource, /\.aiv-material-style-tabs button\.active\s*\{[\s\S]*?box-shadow:/)
})
```

Run: `node --test src/renderer/utils/balaAiVideoWorkflow.test.js`

Expected: FAIL in `find-materials controls use visible selected and active feedback` because the new state treatment is not styled yet.

Then add scoped CSS that gives the task state a square status chip and applies semantic colors:

```css
.aiv-material-task-state { min-height:24px; padding:0 8px; border:1px solid var(--border); border-radius:6px; display:inline-flex; align-items:center; gap:6px; color:var(--text2); background:var(--bg3); font-size:11px; font-weight:750; }
.aiv-material-task-state i { width:7px; height:7px; border-radius:50%; background:currentColor; }
.aiv-material-task-state.is-running { border-color:rgba(96,165,250,.48); color:#60a5fa; background:rgba(96,165,250,.1); }
.aiv-material-task-state.is-ready { border-color:rgba(74,222,128,.48); color:var(--green); background:rgba(74,222,128,.1); }
.aiv-material-task-state.is-failed { border-color:rgba(248,113,113,.5); color:#f87171; background:rgba(248,113,113,.1); }
```

Add a three-column stat strip that collapses to one row at the existing 1180px breakpoint, then refine the existing style tabs, type switcher, progress card, and selected thumbnail styles with slightly stronger borders, inset focus rings, and 160–220ms color/transform transitions. Preserve the existing `.aiv-thumb` click and keyboard handlers.

- [ ] **Step 2: Run focused regression and build validation**

Run:

```bash
node --test src/renderer/utils/balaAiVideoWorkflow.test.js
npm run vite:build
git diff --check
```

Expected: the focused suite passes, Vite exits `0`, and `git diff --check` produces no output. The existing Vite chunk-size warning is acceptable if it is the only warning.

- [ ] **Step 3: Verify in the running Electron app**

Open `AI 视频工作流` → `找图` and verify:

1. The existing two-column layout remains intact.
2. The left title shows the derived material stage.
3. The right panel shows three aligned statistics and the stage explanation.
4. Selecting a material still toggles the existing selected state and makes its orange feedback visibly stronger.
5. Switching 款号、模拍图/细节图、只看已选素材, then entering AI 改图, still works.

- [ ] **Step 4: Commit the implementation without fourth-step changes**

Run:

```bash
git add -p app/src/renderer/views/AiVideoWorkflow.vue app/src/renderer/utils/balaAiVideoWorkflow.test.js
git commit -m "feat: polish AI video materials operations UI"
```

Expected: the commit contains only find-materials markup, styles, and its regression test; leave the earlier fourth-step hunks unstaged.
