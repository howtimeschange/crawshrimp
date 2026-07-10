# AI 生图修改结果同队列展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将修改图 run 归并到来源图片的根队列，按生成顺序追加，同时保持大图父子分支与后端异步任务结构不变。

**Architecture:** 后端继续保存独立 run 和 `edit_source.result_key`。渲染层先从所有 run 构造卡片并解析父链，再通过纯函数把修改 run 投影到根队列；工作台只消费归并后的队列。找不到父图的数据保留为独立队列。

**Tech Stack:** Vue 3 Composition API、JavaScript ES modules、Node.js `node:test`、Python/FastAPI 现有 AI 图片服务、1XM 异步图片 API。

## Global Constraints

- 不改变 1XM 提交、轮询、重试和 AI 测图脚本接口。
- 多 Prompt 的各根 run 仍显示为独立队列。
- 大图模式继续只展示当前父子分支。
- 根 run 图片在前，修改结果按 run 创建顺序追加。
- 父图缺失或父链异常时保留独立队列。

---

### Task 1: 父子链队列归并纯函数

**Files:**
- Modify: `app/src/renderer/aiImageResultLineage.mjs`
- Test: `app/src/renderer/aiImageResultLineage.test.mjs`

**Interfaces:**
- Consumes: `resolveResultLineage(item, items)` 与 `resultIdentityCandidates(item)`。
- Produces: `groupResultQueuesByLineage(queues): Array<Queue>`，返回按根 run 分组、卡片顺序稳定、状态聚合后的新队列数组。

- [ ] **Step 1: 写失败测试**

新增用例构造两个根队列、连续修改、同根分支、生成中占位和丢失父图，断言：

```js
const grouped = groupResultQueuesByLineage([rootQueue, otherRootQueue, editOneQueue, editTwoQueue, branchQueue])
assert.equal(grouped.length, 2)
assert.deepEqual(grouped[0].items.map((item) => item.url), [root.url, editOne.url, editTwo.url, branch.url])
assert.deepEqual(grouped[0].items.map((item) => item.label), ['结果 1', '结果 2', '结果 3', '结果 4'])
assert.equal(grouped[0].prompt, rootQueue.prompt)
```

另测 `loading`/`failed` 修改占位进入根队列、状态聚合，以及父图缺失时维持独立队列。

- [ ] **Step 2: 验证测试按预期失败**

Run: `node --test app/src/renderer/aiImageResultLineage.test.mjs`

Expected: FAIL，提示 `groupResultQueuesByLineage` 未导出或断言不满足。

- [ ] **Step 3: 实现最小归并函数**

在 `aiImageResultLineage.mjs` 中：

```js
export function groupResultQueuesByLineage(queues = []) {
  const sourceQueues = normalizeQueues(queues)
  const allItems = sourceQueues.flatMap((queue) => queue.items)
  const itemQueueIndex = buildItemQueueIndex(sourceQueues)
  const groups = []
  const groupsByRootIndex = new Map()

  sourceQueues.forEach((queue, queueIndex) => {
    const rootIndex = resolveQueueRootIndex(queue, queueIndex, allItems, itemQueueIndex)
    const group = ensureQueueGroup(groups, groupsByRootIndex, sourceQueues, rootIndex, queue)
    if (queueIndex !== rootIndex) group.items.push(...queue.items)
    group.statuses.push(queue.status)
  })

  return groups.map(finalizeQueueGroup)
}
```

辅助函数必须复制输入、按 `resultIdentityCandidates` 建索引、用 `resolveResultLineage` 找根图、聚合状态，并只给非 loading/failed 卡片连续编号。

- [ ] **Step 4: 验证纯函数测试通过**

Run: `node --test app/src/renderer/aiImageResultLineage.test.mjs`

Expected: PASS，现有父子链用例与新增归并用例全部通过。

---

### Task 2: 工作台接入同队列投影

**Files:**
- Modify: `app/src/renderer/views/AiImageWorkbench.vue`
- Test: `tests/ai-image-workbench-navigation.test.js`

**Interfaces:**
- Consumes: `groupResultQueuesByLineage(queues)`。
- Produces: `collectResultQueues(job)` 返回归并后的根队列；`applyLightboxEditResult` 通过 `runUid` 精确找到新修改结果。

- [ ] **Step 1: 写失败合同测试**

在导航测试中断言：

```js
assert.match(workbench, /groupResultQueuesByLineage/)
assert.match(queueBody, /return groupResultQueuesByLineage\(queues\)\.reverse\(\)/)
assert.match(placeholderBody, /editSource: run\?\.edit_source \|\| null/)
assert.match(applyBody, /item\?\.runUid \|\| item\?\.run_uid/)
```

同时断言 `applyLightboxEditResult` 不再依赖子 run 自己的队列 key。

- [ ] **Step 2: 验证合同测试按预期失败**

Run: `node --test tests/ai-image-workbench-navigation.test.js`

Expected: FAIL，缺少队列归并调用与占位卡父链元数据。

- [ ] **Step 3: 接入归并函数并修正结果定位**

修改工作台：

```js
import {
  groupResultQueuesByLineage,
  promptChainFromLineage,
  resolveResultLineage,
} from '../aiImageResultLineage.mjs'
```

`workbenchRunPlaceholders` 的 loading/failed 对象增加：

```js
editSource: run?.edit_source || null,
```

`collectResultQueues` 在完成所有卡片的 `historyItems` 和 `promptChain` 后返回：

```js
return groupResultQueuesByLineage(queues).reverse()
```

`applyLightboxEditResult` 在所有归并队列卡片中按 `runUid` 找结果：

```js
const result = queues
  .flatMap((queue) => queue.items || [])
  .find((item) => String(item?.runUid || item?.run_uid || '') === String(runUid || '')) || null
```

- [ ] **Step 4: 验证工作台测试通过**

Run: `node --test tests/ai-image-workbench-navigation.test.js`

Expected: PASS，全部工作台测试通过。

---

### Task 3: 自动化回归与真实 1XM 验收

**Files:**
- Modify only if a discovered regression requires a TDD fix.
- Verify: `app/src/renderer/views/AiImageWorkbench.vue`
- Verify: local app at `http://127.0.0.1:5173/`

**Interfaces:**
- Consumes: 当前 worktree 的 Vite/Electron 开发桥接与已配置 1XM keys。
- Produces: 可复核的 QA 任务、真实图片结果、页面队列和大图分支证据。

- [ ] **Step 1: 运行自动化回归**

Run:

```bash
node --test app/src/renderer/aiImageResultLineage.test.mjs
node --test tests/ai-image-workbench-navigation.test.js
cd app && npm test
cd app && npm run vite:build
```

Expected: 全部测试 PASS，Vite build exit 0。

- [ ] **Step 2: 真实生成原图并连续修改**

在独立任务 `Codex QA 修改图同队列 20260710` 中使用 GPT Image 2K：

1. 文字生成一张主体清晰、背景简单的测试图。
2. 基于结果 1 修改一次颜色或局部元素。
3. 基于修改结果继续第二次修改。

Expected: 结果墙只有一个队列，卡片按“原图、修改 1、修改 2”顺序排列并统一编号；刷新后不拆组。

- [ ] **Step 3: 验证兄弟分支与任务切换**

回到原图再发起一次不同修改，形成兄弟分支；切换到另一个任务再切回 QA 任务。

Expected: 结果墙仍为一个根队列并按生成顺序追加；打开分支结果的大图只显示“原图 → 当前分支”，连续修改的大图显示“原图 → 修改 1 → 修改 2”。

- [ ] **Step 4: 检查最终差异并提交**

Run:

```bash
git diff --check
git status --short --branch
git diff -- app/src/renderer/aiImageResultLineage.mjs app/src/renderer/aiImageResultLineage.test.mjs app/src/renderer/views/AiImageWorkbench.vue tests/ai-image-workbench-navigation.test.js
```

只暂存本功能文件并创建本地 commit，不推送、不合并。
