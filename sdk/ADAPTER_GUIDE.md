# 抓虾适配包开发指南

> 阅读本文档后，你（或 AI）应该能独立开发一个可运行的适配包。

---

## 目录

1. [核心概念](#1-核心概念)
2. [5 分钟上手](#2-5-分钟上手)
3. [manifest.yaml 完整参考](#3-manifestyaml-完整参考)
4. [JS 脚本协议](#4-js-脚本协议)
5. [内置变量与工具](#5-内置变量与工具)
6. [参数类型](#6-参数类型)
7. [分页机制](#7-分页机制)
8. [认证检查](#8-认证检查)
9. [输出与通知](#9-输出与通知)
10. [真实示例：JD 价格导出](#10-真实示例jd-价格导出)
11. [真实示例：Temu 商品数据（含分页）](#11-真实示例temu-商品数据含分页)
12. [常见问题](#12-常见问题)
13. [底座 HTTP API 参考](#13-底座-http-api-参考)

---

## 1. 核心概念

```
┌─────────────────────────────────────────────────────┐
│                   crawshrimp 底座                    │
│                                                      │
│  Electron GUI  ←→  FastAPI (18765)  ←→  cdp_bridge  │
│                          │                   │       │
│                      js_runner           Chrome      │
│                          │           (CDP port 9222) │
│                    adapter_loader                    │
└─────────────────────────────────────────────────────┘
          ↑
    你只需要写这部分
          ↓
┌──────────────────────┐
│   适配包 (Adapter)   │
│                      │
│  manifest.yaml       │  声明元数据、任务、参数、输出
│  *.js 脚本           │  在目标页面执行的抓取逻辑
│  auth_check.js       │  （可选）检查登录状态
│  icon.png            │  （可选）适配包图标
└──────────────────────┘
```

**你不需要关心：**
- Chrome 如何连接（底座通过 CDP websocket 直连）
- JS 如何注入（底座调用 `Runtime.evaluate`）
- 数据如何存储（底座写 Excel / JSON / SQLite）
- 通知如何发送（底座调用钉钉 / Feishu API）
- 分页如何循环（底座检测 `meta.has_more`，自动翻页）

**你只需要关心：**
- 目标页面上有什么 DOM 元素
- 如何读取数据
- 如何判断"还有下一页"

---

## 2. 5 分钟上手

### 第一步：创建目录

```
my-adapter/
  manifest.yaml
  scrape.js
```

### 第二步：写 manifest.yaml

```yaml
id: my-adapter           # 唯一 ID，小写+连字符
name: 示例适配包
version: 1.0.0
author: yourname
description: "这是一个示例适配包"
entry_url: https://example.com   # 用于匹配 Chrome tab

tasks:
  - id: scrape_table
    name: 抓取表格
    script: scrape.js
    trigger:
      type: manual
    output:
      - type: excel
        filename: "结果_{date}.xlsx"
```

### 第三步：写 scrape.js

```js
;(async () => {
  const data = []

  document.querySelectorAll('table tbody tr').forEach(row => {
    const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim())
    if (cells.length >= 2) {
      data.push({
        '名称': cells[0],
        '价格': cells[1],
      })
    }
  })

  return {
    success: true,
    data,                    // 必须是对象数组
    meta: { has_more: false }
  }
})()
```

### 第四步：安装

```bash
# 方式一：GUI 安装
# 打开抓虾 → 我的脚本 → 安装适配包 → 选择文件夹

# 方式二：API 安装
curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path": "/absolute/path/to/my-adapter"}'
```

### 第五步：运行

1. 在 Chrome 里打开目标网站（确保已登录）
2. 打开抓虾 GUI → 选择你的适配包 → 点击任务 → 运行

---

## 3. manifest.yaml 完整参考

```yaml
# ── 适配包基本信息 ─────────────────────────────────
id: my-adapter               # 必填。唯一 ID，小写字母+数字+连字符
name: 我的适配包              # 必填。GUI 显示名
version: 1.0.0               # 可选。语义化版本
author: yourname             # 可选
description: "一句话介绍"    # 可选

entry_url: https://example.com
# 必填。用于匹配 Chrome tab。
# 底座会找 URL 以此开头的 tab 来注入脚本。
# 如果有多个 tab，使用最近激活的那个。

# ── 认证检查（可选）────────────────────────────────
auth:
  check_script: auth_check.js   # 返回 { data: [{ logged_in: bool }] }
  login_url: https://example.com/login  # 未登录时打开此页面

# ── 任务列表 ────────────────────────────────────────
tasks:
  - id: task_id             # 必填。任务 ID，在适配包内唯一
    name: 任务名称           # 必填
    description: "说明文字"  # 可选
    script: task.js         # 必填。相对于适配包目录的 JS 文件路径

    # ── 参数（可选）──────────────────────────────
    params:
      - id: param_id
        type: text           # 见"参数类型"章节
        label: 参数名称
        default: ""
        required: false
        hint: "提示文字"

    # ── 触发方式（可选，默认 manual）──────────────
    trigger:
      type: manual           # manual | interval | cron
      interval_minutes: 60   # type=interval 时有效
      cron: "0 9 * * 1-5"   # type=cron 时有效（标准 5 段 cron）

    # ── 输出（可选）──────────────────────────────
    output:
      - type: excel          # excel | json | sqlite | notify
        filename: "结果_{date}.xlsx"   # 支持 {date} {datetime} {adapter_id} {task_id}
      - type: notify
        channel: dingtalk    # dingtalk | feishu | webhook
        condition: "data.length > 0"  # 可选，满足条件才发送
```

---

## 4. JS 脚本协议

### 必须遵守的格式

每个脚本**必须**是一个 async IIFE（立即执行异步函数），**必须**返回一个对象：

```js
;(async () => {
  // 你的逻辑...
  return {
    success: true,   // bool，必填
    data: [...],     // 对象数组，成功时必填
    meta: {
      has_more: false  // bool，必填（true 触发自动翻页）
    }
  }
})()
```

失败时：

```js
;(async () => {
  return {
    success: false,
    error: '描述失败原因的字符串'
  }
})()
```

### 关键规则

| 规则 | 说明 |
|------|------|
| **必须是 async IIFE** | `js_runner` 用 `await Runtime.evaluate()` 执行，非 async 无法使用 `await` |
| **data 必须是数组** | 每个元素是一个扁平对象，key 就是 Excel 的列名 |
| **不要修改 DOM 状态** | 脚本不应该提交表单、触发非读取操作（除非任务本来就是操作类） |
| **不依赖全局变量** | 每次注入都是独立 evaluate，上次执行的变量不会保留（除非挂在 `window` 上） |

### 多 Phase 状态机（操作类任务）

对于需要依次完成多个交互步骤的任务（如表单填写、店铺切换、日期选择），使用 **多 Phase 状态机**。

底座会重复注入同一脚本，通过 `window.__CRAWSHRIMP_PHASE__` 区分当前阶段，脚本返回 `action: "next_phase"` / `action: "cdp_clicks"` / `action: "complete"` 来驱动状态机。

#### 推荐的 Phase 粒度（最佳实践）

推荐按**业务步骤**拆 phase，而不是按“字段 / 按钮 / 单次点击”拆 phase。经验上，下面这种粒度更稳：

- `ensure_auth` / `ensure_store`
- `open_form`
- `fill_form`
- `submit`
- `post_submit`

不建议把“填日期”“点月份箭头”“切下拉框”“点确认按钮”都拆成独立 phase。字段级 phase 会让脚本在重渲染、弹层消失、节点失效时变得很脆弱，也更难处理多门店、多行循环。

```
底座注入脚本 (phase="init")
  ↓
返回 { action: "next_phase", next_phase: "fill_form" }
  ↓
底座注入脚本 (phase="fill_form")
  ↓
返回 { action: "cdp_clicks", clicks: [{x,y}, ...], next_phase: "submit", sleep_ms: 500 }
  ↓
底座执行 CDP 坐标点击
  ↓
底座注入脚本 (phase="submit")
  ↓
返回 { action: "complete", data: [...] }  ← 本行完成，继续下一行
```

#### `action` 值说明

| action | 说明 |
|--------|------|
| `next_phase` | 切换到 `meta.next_phase` 指定的 phase，立刻重新注入脚本 |
| `cdp_clicks` | 用 CDP 真实鼠标依次点击 `meta.clicks` 里的坐标，点完后等 `meta.sleep_ms`（ms），再切换到 `meta.next_phase` |
| `complete` | 本行（row）处理完毕，数据写入 `meta.result`；底座继续处理下一行 |

#### Phase 状态机脚本骨架

```js
;(async () => {
  // 底座注入当前 phase
  const phase  = window.__CRAWSHRIMP_PHASE__  || 'init'
  // 底座注入参数（含批量行数据，见 file_excel 章节）
  const params  = window.__CRAWSHRIMP_PARAMS__ || {}
  // 跨 phase 共享状态（挂 window，不会被清除）
  const shared  = window.__CRAWSHRIMP_SHARED__ = window.__CRAWSHRIMP_SHARED__ || {}

  // 辅助：返回 next_phase 并带等待时间
  function nextPhase(name, sleepMs, newShared) {
    window.__CRAWSHRIMP_SHARED__ = newShared ?? shared
    return { action: 'next_phase', next_phase: name, meta: { sleep_ms: sleepMs || 0 } }
  }

  // 辅助：返回 cdp_clicks
  function cdpClicks(clicks, nextPhaseName, sleepMs) {
    return { action: 'cdp_clicks', clicks, next_phase: nextPhaseName, meta: { sleep_ms: sleepMs || 300 } }
  }

  try {
    if (phase === 'init') {
      // 初始化：导航、校验、准备
      // ...
      return nextPhase('fill_form', 800)
    }

    if (phase === 'fill_form') {
      // 填写表单
      // ...
      // 获取提交按钮坐标
      const btn = document.querySelector('.submit-btn')
      const r   = btn.getBoundingClientRect()
      return cdpClicks([{ x: Math.round(r.left + r.width/2), y: Math.round(r.top + r.height/2) }], 'post_submit', 1000)
    }

    if (phase === 'post_submit') {
      // 等待成功，收集结果
      const result = { '执行状态': '成功', '错误原因': '' }
      return { action: 'complete', data: [result] }
    }

  } catch (e) {
    // phase 失败，记录错误原因并结束本行
    return { action: 'complete', data: [{ '执行状态': '失败', '错误原因': e.message }] }
  }
})()
```

#### `window.__CRAWSHRIMP_PHASE__` 的值

底座在每次注入前设置：
- 第一次执行：`"main"`（兼容旧脚本）或 `"init"`（新脚本自行处理 `"main"` 分支）
- 后续由脚本 `next_phase` 字段控制

#### cdp_clicks 参数格式

```js
{
  action: 'cdp_clicks',
  clicks: [
    { x: 320, y: 480 },  // 相对于 viewport 的坐标，单位 px
    { x: 400, y: 480 },
  ],
  next_phase: 'submit',     // 点完后切换到哪个 phase
  meta: {
    sleep_ms: 500           // 所有坐标点完后统一等待时长（ms）
  }
}
```

坐标获取建议用 `getBoundingClientRect()`：

```js
function coord(el) {
  const r = el.getBoundingClientRect()
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
}
```

#### 前端框架页面的交互优先级（最佳实践）

对于 React / Vue 驱动的后台页面，推荐按下面顺序尝试交互：

1. **组件状态注入 / 组件事件调用**
2. **组件内部真实 click 事件**
3. **原生 DOM click / input / change**
4. **CDP 坐标点击**

如果某个控件可以通过 `onChange`、`modelValue`、Fiber props、Vue component instance 等方式稳定改值，优先使用注入方案；只有在状态注入不可达时，再退回 DOM 点击或 CDP 坐标点击。

#### DOM 探查 + 单页闭环开发流程（最佳实践）

对于新站点、新业务流程、顽固表单控件，推荐先走一遍 **DOM Lab**，不要一上来就直接跑整表任务。

推荐顺序：

1. **先开 live 页面，再探查 DOM**
   - 打开真实页面，确认页面 URL、当前店铺/账号、关键入口是否正确。
   - 记录关键截图、主要表单区域、`data-testid`、文本锚点、组件类名。

2. **先做页面级 DOM 体检**
   - 抓取关键区域的 DOM 结构、显示文本、可见输入框、按钮、下拉、日期控件。
   - 判断它是原生控件、React 组件、Vue 组件，还是带 portal 的弹层组件。

3. **对顽固控件做“最小实验”**
   - 不要一口气跑完整任务。
   - 先只验证一个控件能不能稳定改值，例如：
     - 日期能不能写到输入框并回读正确
     - 下拉能不能切到目标值
     - radio / checkbox 能不能切换后触发依赖字段出现

4. **找到真正能改状态的方法**
   - 优先顺序：状态注入 → 组件事件 → 原生 DOM 事件 → CDP 坐标点击。
   - 每次尝试后都要**回读当前展示值**，不要只看点击动作是否执行。

5. **先完成单页闭环，再回写 adapter**
   - 在一个页面上完成“填值 → 回读 → 提交 → 识别成功/失败信号”的完整闭环。
   - 单页没跑通前，不建议反复跑多门店 / 多行 Excel 批量任务。

6. **把已验证成功的关键方法单独备份**
   - 比如把“日期注入”“下拉切换”另存为保底 helper 或备份文件。
   - 后续大重构时，至少还有一份可验证成功的方案可回退。

7. **最后再做整任务回归**
   - 页面级闭环通过后，再做：
     - 单券型回归
     - 多券型回归
     - 多门店回归
     - 异常场景回归（重复时间、权限不足、登录失效等）

建议产出物：

- DOM 报告（关键 selector / 文本 / data-testid / 组件实例线索）
- 关键步骤截图
- 已验证有效的交互路径说明
- 成功信号与失败信号清单

这套流程适合所有“操作类适配包”，尤其适合日期、下拉、级联表单、Portal 弹层、React / Vue 后台页面。

#### 提交前校验红字检测（最佳实践）

表单类脚本在 `submit` phase 点确认前，应先扫描页面上的校验错误，避免无效点击：

```js
if (phase === 'submit') {
  // 扫描页面已有校验错误（如"结束时间不能超过开始时间后的3个月"）
  const preErrors = [...document.querySelectorAll(
    '.form-item__help, .form-item__extra, [class*="error-msg"]'
  )].filter(el => el.offsetParent !== null)
    .map(el => el.textContent.trim())
    .filter(Boolean)

  if (preErrors.length > 0) {
    // 直接记录失败，不点确认
    return { action: 'complete', data: [{ '执行状态': '失败', '错误原因': `校验错误：${preErrors.join(' | ')}` }] }
  }
  // 无错误，继续点确认...
}
```

#### 成功信号不要只看跳转（最佳实践）

很多后台页面提交成功后，不一定立刻跳转。建议同时检查以下信号：

- URL 已切到成功页 / 列表页
- Toast / Message 成功提示
- 页内成功卡片、成功标题、`返回列表页面` / `查看详情` 等按钮或文案

如果只认跳转，容易把“已成功但仍停留在当前页”的情况误判为失败。

#### 字段填写独立 try-catch（最佳实践）

`form_fill` 类 phase 里，每个字段的填写应独立 try-catch，避免单个字段失败阻断后续字段：

```js
if (phase === 'form_fill') {
  const warnings = []

  try { await setDiscountType(row['折扣类型']) }
  catch (e) { warnings.push(`折扣类型：${e.message}`) }

  try { await fillAmount(row['金额']) }
  catch (e) { warnings.push(`金额：${e.message}`) }

  if (warnings.length > 0) console.warn(`[FORM] 字段警告：${warnings.join(' | ')}`)
  return nextPhase('submit', 300)
}
```

#### 动态字段与重渲染（最佳实践）

- 某个字段切换后会触发后续字段出现 / 消失时，必须先等待依赖字段真正渲染出来，再继续填写。
- 组件发生重渲染后，**重新获取 DOM 节点**，不要复用旧引用。
- 对下拉、日期、radio 等组件，回读时优先读取当前展示区的值，而不是容器全文本，避免把 portal / 弹层里的文本也算进去。

这类问题在 Vue / React 的 Select、DatePicker、依赖型表单区块里非常常见。

---

## 5. 内置变量与工具

底座在执行脚本前，会向页面注入以下变量：

### `window.__CRAWSHRIMP_PARAMS__`

包含任务运行时的所有参数值，格式是 `{ [param_id]: value }`。

```js
const params = window.__CRAWSHRIMP_PARAMS__ || {}
const keyword = params.keyword || ''
const threshold = params.threshold || 50
```

### `window.__CRAWSHRIMP_PAGE__`

当前页码，从 `1` 开始，每次分页 +1。

```js
const page = window.__CRAWSHRIMP_PAGE__ || 1
if (page === 1) {
  // 第一页：做初始化（导航、设置筛选条件等）
} else {
  // 后续页：直接抓当前页内容
}
```

### `window.__CRAWSHRIMP_STATE__`（自定义状态）

如果你需要跨页传递状态，可以把数据挂在 `window` 上任意自定义变量。底座不会清除 window 变量，只要 tab 不刷新，变量就存在。

```js
// 第 1 页初始化
window.__MY_ADAPTER_STATE__ = { collected: [], region_idx: 0 }

// 第 N 页读取
const state = window.__MY_ADAPTER_STATE__ || { collected: [], region_idx: 0 }
```

> ⚠️ 注意：如果任务跨越了页面导航（`location.href = ...`），window 变量会丢失。

---

## 6. 参数类型

manifest 里 `params[].type` 支持以下类型：

| type | 说明 | 示例 |
|------|------|------|
| `text` | 单行文本输入 | 关键词、URL |
| `number` | 数字输入（可设 min/max） | 阈值、页数 |
| `radio` | 单选（横向按钮组） | 模式选择 |
| `select` | 下拉选择 | 时间范围 |
| `checkbox` | 多选（复选框组） | 地区、类别 |
| `date_range` | 日期区间（开始日期 + 结束日期） | 自定义时间段 |
| `file_excel` | Excel/CSV 文件选择器（底座读取后注入 rows） | 批量任务用的 SKU 列表 |

### text 示例

```yaml
- id: shop_url
  type: text
  label: 店铺链接
  placeholder: "例: https://mall.jd.com/index-xxx.html"
  hint: 填写京东店铺主页地址
  required: true
```

### select 示例（含自定义日期联动）

```yaml
- id: time_range
  type: select
  label: 时间区间
  default: ""
  options:
    - value: ""
      label: 默认
    - value: "近7日"
      label: 近 7 日
    - value: "自定义"
      label: 自定义日期
  hint: 选「自定义日期」后将出现日期选择器
```

> 当用户选了「自定义」时，GUI 自动显示日期区间选择器，params 注入 `custom_range: { start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }`

### checkbox 示例

```yaml
- id: regions
  type: checkbox
  label: 地区
  options:
    - value: "全球"
      label: 全球
    - value: "美国"
      label: 美国
    - value: "欧区"
      label: 欧区
```

脚本里读取（数组）：

```js
const regions = params.regions || ['全球', '美国', '欧区']  // 未选时默认全部
```

### file_excel 示例

```yaml
- id: sku_list
  type: file_excel
  label: SKU 列表文件
  hint: 选择包含 SKU ID 的 Excel/CSV 文件
```

脚本里读取：

```js
const file = params.sku_list
// file.headers → ['SKU ID', '商品名称', ...]
// file.rows    → [{ 'SKU ID': '123', '商品名称': '...' }, ...]
//
// ⚠️ 底座会自动过滤全空行（所有单元格为空的行）
// Excel 表格格式区域可能延伸到数据行之外，不必担心读到空行
const skuIds = file.rows.map(row => row['SKU ID'])
```

**批量操作模式**：`file_excel` 结合多 Phase 状态机，实现逐行自动化（如批量创建优惠券）。底座将每行数据通过 `window.__CRAWSHRIMP_PARAMS__` 注入，脚本完成一行后返回 `action: "complete"`，底座自动推进到下一行。
```

---

## 7. 分页机制

底座的分页逻辑：

```
执行脚本 (page=1)
  ↓
检查返回值
  ↓
meta.has_more === true ?
  ├── 是 → page+1 → 再次注入同一脚本 → 循环
  └── 否 → 停止，合并所有 data，写文件
```

### 简单翻页（按钮点击）

适用于有「下一页」按钮的场景：

```js
;(async () => {
  const data = []

  // 抓当前页
  document.querySelectorAll('.item').forEach(el => {
    data.push({ name: el.querySelector('.name')?.textContent.trim() })
  })

  // 判断是否有下一页
  const nextBtn = document.querySelector('.pagination .next:not(.disabled)')
  if (nextBtn) {
    nextBtn.click()
    await new Promise(r => setTimeout(r, 2000))  // 等待加载
  }

  return {
    success: true,
    data,
    meta: { has_more: !!nextBtn }
  }
})()
```

### 跨页导航（location.href）

适用于需要改 URL 才能翻页的场景（如 JD 商品列表）：

```js
;(async () => {
  const page = window.__CRAWSHRIMP_PAGE__ || 1

  if (page === 1) {
    // 第一页：导航到列表
    location.href = 'https://example.com/list?page=1'
    await new Promise(r => setTimeout(r, 3000))
  }

  // 等目标元素出现
  for (let i = 0; i < 20; i++) {
    if (document.querySelectorAll('.item').length > 0) break
    await new Promise(r => setTimeout(r, 500))
  }

  // 抓当前页...
  const data = []
  document.querySelectorAll('.item').forEach(el => {
    data.push({ name: el.textContent.trim() })
  })

  // 找下一页链接
  const nextLink = document.querySelector('a.next-page')
  const hasMore = !!nextLink

  if (hasMore) {
    location.href = nextLink.href  // 提前导航，下次执行时页面已加载
    await new Promise(r => setTimeout(r, 1000))
  }

  return { success: true, data, meta: { has_more: hasMore } }
})()
```

### 跨地区 / 多维度循环（复杂分页）

适用于需要切换选项卡、地区或筛选维度的场景（如 Temu 售后多地区）：

```js
;(async () => {
  const REGIONS = ['全球', '美国', '欧区']
  const params = window.__CRAWSHRIMP_PARAMS__ || {}
  const targetRegions = params.regions?.length ? params.regions : REGIONS

  // 跨页状态持久化（挂在 window 上，只要 tab 不刷新就存在）
  if (!window.__MY_STATE__) {
    window.__MY_STATE__ = { regionIdx: 0, pageInRegion: 1 }
  }
  const state = window.__MY_STATE__

  const region = targetRegions[state.regionIdx]

  // 1. 切换到当前地区（点 DOM）
  // ...

  // 2. 抓当前页数据
  const pageData = []
  document.querySelectorAll('.row').forEach(row => {
    pageData.push({ region, value: row.textContent.trim() })
  })

  // 3. 判断当前地区是否还有下一页
  const hasNextPage = !!document.querySelector('.next-page:not(.disabled)')
  if (hasNextPage) {
    document.querySelector('.next-page').click()
    await new Promise(r => setTimeout(r, 1500))
    state.pageInRegion++
    return { success: true, data: pageData, meta: { has_more: true } }
  }

  // 4. 当前地区抓完，切到下一个地区
  state.regionIdx++
  state.pageInRegion = 1
  const hasMoreRegion = state.regionIdx < targetRegions.length
  if (!hasMoreRegion) {
    window.__MY_STATE__ = null  // 清理，方便下次重新开始
  }

  return { success: true, data: pageData, meta: { has_more: hasMoreRegion } }
})()
```

---

## 8. 认证检查

可选，但推荐加上。底座会在脚本执行前调用 `auth_check.js`，如果返回未登录，GUI 提示用户去登录。

```js
// auth_check.js
;(async () => {
  // 方法一：检查特定 DOM 元素
  const isLoggedIn = document.querySelector('.user-nickname') !== null

  // 方法二：检查 cookie
  // const isLoggedIn = document.cookie.includes('user_id=')

  // 方法三：检查 localStorage
  // const isLoggedIn = !!localStorage.getItem('auth_token')

  return {
    success: true,
    data: [{ logged_in: isLoggedIn }],
    meta: { has_more: false }
  }
})()
```

在 manifest.yaml 里声明：

```yaml
auth:
  check_script: auth_check.js
  login_url: https://example.com/login
```

底座行为：
- `logged_in: false` → GUI 提示用户去登录，可选自动打开 `login_url`
- 未声明 `auth` → 底座不做检查，直接执行脚本

#### `current` 模式最佳实践

- `current` 模式应绑定用户真实当前 tab，而不是“随便找一个 URL 匹配的 tab”。
- `current` 模式也应执行 `auth_check.js`，不要因为 URL 看起来对就跳过登录检查。
- 如果当前浏览器里同时开了多个同平台页面，优先要求前端把当前 tab id 传给后端，而不是在后端猜测。

这样可以显著降低“跑错页”“半登录态误执行”“多标签页串线”的风险。

#### 本地开发地址一致性（最佳实践）

如果项目使用 Electron + Vite，开发环境里的地址要统一：

- Vite `server.host`
- Electron `loadURL(...)`
- `wait-on` 或其他启动探活脚本

建议统一使用 `127.0.0.1`，避免一部分走 `localhost`、一部分走 IPv4 / IPv6，导致前端明明启动了但 Electron 仍然连不上。

#### 业务失败 vs 脚本失败（最佳实践）

像“时间区间重复”“平台规则不允许创建”“已有活动冲突”这类情况，通常属于**业务规则拒绝**，不是脚本崩溃。

建议：

- 在结果 Excel 里把它们写成业务失败原因
- 不要把这类错误都归结为 timeout / exception
- 批量任务里让后续行继续执行

这样结果更利于运营人员理解和处理。

---

## 9. 输出与通知

### Excel 输出

```yaml
output:
  - type: excel
    filename: "数据_{date}.xlsx"
    # {date}     → YYYY-MM-DD
    # {datetime} → YYYYMMDD_HHmmss
    # {adapter_id} → 适配包 ID
    # {task_id}  → 任务 ID
```

data 数组里每个对象的 key 就是列名，多轮分页的 data 会合并到同一个 sheet。

### 通知（钉钉 / Feishu）

```yaml
output:
  - type: notify
    channel: dingtalk          # dingtalk | feishu | webhook
    condition: "data.length > 0"  # 可选，JS 真值表达式
```

`condition` 支持的变量：
- `data.length` — 本次抓取的总行数
- 任何 `meta` 里返回的字段（如 `violations_count`）

自定义通知内容，在 meta 里加字段：

```js
return {
  success: true,
  data: violations,
  meta: {
    has_more: false,
    violations_count: violations.length,
    notify_title: `破价预警 ${violations.length} 个 SKU`,
    notify_body: violations.map(v => `${v['SKU ID']}: ${v['折扣']}`).join('\n'),
  }
}
```

---

## 10. 真实示例：JD 价格导出

完整文件：[`adapters/jd/price-export.js`](../adapters/jd/price-export.js)

### 核心思路

1. **第 1 页**：从 `params.shop_url` 解析 shop_id，构造 `advance_search` URL，导航并等待
2. **每页**：分段滚动触发懒加载 → 读 `li.jSubObject` + `span.jdNum` → 用 `p.3.cn` API 补查空价格
3. **翻页**：找 `a[text=下一页]`，如果存在则提前 `location.href` 导航，返回 `has_more: true`

```js
;(async () => {
  const params  = window.__CRAWSHRIMP_PARAMS__ || {}
  const page    = window.__CRAWSHRIMP_PAGE__ || 1
  const shopUrl = params.shop_url || ''

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

  // 第一页：解析并导航
  if (page === 1) {
    const shopId = shopUrl.match(/index-(\d+)/)?.[1]
    if (!shopId) return { success: false, error: '无法解析店铺 ID，请检查 URL 格式' }

    if (!location.href.includes('advance_search')) {
      location.href = `https://mall.jd.com/advance_search-${shopId}-${shopId}-${shopId}-0-0-0-1-1-60.html`
      await sleep(5000)
    }
  }

  // 等商品加载（最多 20 秒）
  for (let i = 0; i < 25; i++) {
    if (document.querySelectorAll('li.jSubObject').length > 0) { await sleep(3000); break }
    await sleep(800)
  }

  // 滚动触发懒加载
  const h = document.body.scrollHeight
  for (let i = 1; i <= 8; i++) { window.scrollTo(0, h / 8 * i); await sleep(200) }
  window.scrollTo(0, 0); await sleep(800)

  // 读取商品数据
  const items = []
  document.querySelectorAll('li.jSubObject').forEach(li => {
    const el = li.querySelector('span.jdNum')
    if (!el) return
    const skuId    = el.getAttribute('jdprice') || ''
    const price    = el.innerText.trim().replace(/[^0-9.]/g, '') || null
    const prePrice = (el.getAttribute('preprice') || '').replace(/[^0-9.]/g, '') || null
    const name     = li.querySelector('.jDesc a')?.innerText.trim() || ''
    items.push({ skuId, name, price, originalPrice: prePrice })
  })

  // 用 p.3.cn API 补查价格为空的 SKU
  const missing = items.filter(i => !i.price).map(i => i.skuId)
  if (missing.length > 0) {
    const priceMap = await new Promise(resolve => {
      const map = {}
      const xhr = new XMLHttpRequest()
      xhr.open('GET', `https://p.3.cn/prices/mgets?skuIds=${missing.map(id => 'J_' + id).join(',')}&type=1&area=1_72_2799_0`, true)
      xhr.timeout = 8000
      xhr.onload  = () => { try { JSON.parse(xhr.responseText).forEach(r => { map[r.id.replace('J_', '')] = { price: r.p, orig: r.op || r.m } }) } catch(e) {} resolve(map) }
      xhr.onerror = xhr.ontimeout = () => resolve(map)
      xhr.send()
    })
    items.forEach(i => { if (!i.price && priceMap[i.skuId]) { i.price = priceMap[i.skuId].price; i.originalPrice = i.originalPrice || priceMap[i.skuId].orig } })
  }

  // 找下一页
  const nextLink = [...document.querySelectorAll('a')].find(a => a.innerText.trim() === '下一页')
  if (nextLink) { location.href = nextLink.href; await sleep(1000) }

  const data = items.map(i => ({
    'SKU ID':   i.skuId,
    '商品名称': i.name,
    '页面价':   i.price ? parseFloat(i.price) : '',
    '吊牌价':   i.originalPrice ? parseFloat(i.originalPrice) : '',
  }))

  return { success: true, data, meta: { has_more: !!nextLink, count: items.length } }
})()
```

---

## 11. 真实示例：Temu 商品数据（含时间筛选 + 分页）

完整文件：[`adapters/temu/goods-data.js`](../adapters/temu/goods-data.js)

### 核心挑战

Temu 商家后台使用 Beast 组件库，**选择器带版本哈希后缀**，不能用 `table tr`。必须用 `[class*="TB_tr_"]` 前缀匹配。

### 关键选择器速查

| 选择器前缀（用 `[class*="..."]` 匹配） | 对应元素 |
|---------------------------------------|---------|
| `TB_tr_` | 表格行 |
| `TB_td_` | 表格单元格 |
| `PGT_next_` | 下一页按钮 |
| `PGT_disabled_` | 禁用的翻页按钮（到末页时出现） |
| `PGT_totalText_` | 总条数文本 |
| `ST_selector_` | Beast Select 容器（下拉选择组件） |
| `RPR_outerPickerWrapper` | 日期选择器外层 |
| `RPR_input_` | 日期输入框 |

### 时间筛选

```js
// 点击 Beast Select 下拉
const sel = document.querySelector('[class*="ST_selector_"]')
sel?.click()
await new Promise(r => setTimeout(r, 300))

// 找选项并点击
const option = [...document.querySelectorAll('[class*="ST_option_"]')]
  .find(el => el.textContent.trim() === '近7日')
option?.click()
await new Promise(r => setTimeout(r, 500))
```

### 分页

```js
const nextBtn  = document.querySelector('[class*="PGT_next_"]')
const disabled = document.querySelector('[class*="PGT_disabled_"]')
const hasMore  = !!nextBtn && !disabled

if (hasMore) {
  const signature = document.querySelector('[class*="TB_tr_"]')?.textContent
  nextBtn.click()
  // 等内容变化
  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 500))
    if (document.querySelector('[class*="TB_tr_"]')?.textContent !== signature) break
  }
}
```

---

## 12. 常见问题

**Q：脚本执行后什么都没返回？**

1. 确认 Chrome 以 `--remote-debugging-port=9222` 启动
2. 确认目标网站 tab 是活跃的（底座找 URL 前缀匹配的 tab）
3. 先在 DevTools Console 测试脚本（见下方调试技巧）

**Q：数据只有第一页？**

检查 `meta.has_more` 是否返回 `true`。只有 `has_more: true` 底座才会继续调用。

**Q：跨页导航后页面还没加载就抓取了？**

在脚本开头等待目标元素：

```js
async function waitFor(selector, timeout = 15000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (document.querySelector(selector)) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}
await waitFor('li.jSubObject')
```

**Q：如何在 DevTools 里调试脚本？**

```js
// 粘贴到 DevTools Console，执行前先设置模拟参数
window.__CRAWSHRIMP_PARAMS__ = { shop_url: 'https://mall.jd.com/index-xxx.html' }
window.__CRAWSHRIMP_PAGE__ = 1

// 然后粘贴你的 async IIFE 并执行
// 在 Console 里可以实时看到返回值
```

**Q：`entry_url` 应该填什么？**

填目标网站 URL 的公共前缀，底座找所有以此**开头**的 tab：

```yaml
# ✅ 匹配 agentseller.temu.com 下的所有页面
entry_url: https://agentseller.temu.com

# ✅ 匹配京东商城
entry_url: https://mall.jd.com

# ❌ 过于宽泛（可能误匹配其他 tab）
entry_url: https://www.temu.com
```

**Q：`file_excel` 参数如何使用？**

底座自动读取 Excel/CSV 文件并注入 rows：

```js
const file = window.__CRAWSHRIMP_PARAMS__.sku_list
// file.headers → ['SKU', '名称', '价格']
// file.rows    → [{ 'SKU': '123', '名称': 'xxx', '价格': '99' }, ...]

for (const row of file.rows) {
  const skuId = row['SKU']
  // 用 skuId 做后续操作...
}
```

---

## 13. 底座 HTTP API 参考

底座 FastAPI 服务运行在 `http://127.0.0.1:18765`，适配开发阶段可直接调用调试。

### 任务管理

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/adapters` | 列出所有已安装适配包 |
| `POST` | `/adapters/install` | 安装适配包（`{"path": "/abs/path"}` 或 zip） |
| `DELETE` | `/adapters/{adapter_id}` | 卸载适配包 |
| `GET` | `/tasks` | 列出所有任务 |
| `POST` | `/tasks/{adapter_id}/{task_id}/run` | 运行任务（body 为 params JSON） |
| `GET` | `/tasks/{adapter_id}/{task_id}/status` | 查询任务运行状态 |
| `GET` | `/tasks/{adapter_id}/{task_id}/logs` | 获取任务日志（完整历史，含多轮运行分隔线） |
| `DELETE` | `/tasks/{adapter_id}/{task_id}/logs` | 清空该任务的日志 |

### 日志接口说明

- **GET /logs**：返回 `{ "logs": ["line1", "line2", ...] }`，包含所有历史运行记录
- 每次新运行时，底座自动在末尾追加分隔线 `─── 新运行 HH:MM:SS ───`，不覆盖历史
- **DELETE /logs**：清空该任务日志（在内存中，进程重启后自动清空）

```bash
# 查看任务日志
curl http://127.0.0.1:18765/tasks/shopee-plus-v2/voucher_batch_create/logs

# 清空任务日志
curl -X DELETE http://127.0.0.1:18765/tasks/shopee-plus-v2/voucher_batch_create/logs

# 运行任务（传 file_excel 参数）
curl -X POST http://127.0.0.1:18765/tasks/shopee-plus-v2/voucher_batch_create/run \
  -H 'Content-Type: application/json' \
  -d '{"input_file": {"path": "/Users/me/vouchers.xlsx"}}'
```

### Excel 文件读取

| 方法 | 路径 | 说明 |
|------|------|------|
| `POST` | `/read-excel` | 读取 Excel/CSV 文件，返回 headers + rows |

```bash
curl -X POST http://127.0.0.1:18765/read-excel \
  -H 'Content-Type: application/json' \
  -d '{"path": "/Users/me/data.xlsx", "header_row": 1}'
```

返回：

```json
{
  "headers": ["列A", "列B"],
  "rows": [
    { "列A": "val1", "列B": "val2" }
  ],
  "total": 1
}
```

> **注意**：底座会自动过滤全空行，不会把 Excel 格式区域延伸出的空白行返回给调用方。

### 数据查询

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/data/{adapter_id}/{task_id}` | 查询历史运行结果 |
| `GET` | `/data/{adapter_id}/{task_id}/export` | 导出结果文件 |

---

## 参见

- [`adapters/temu/`](../adapters/temu/) — Temu 完整适配包（4 个任务）
- [`adapters/jd/`](../adapters/jd/) — JD 价格监控适配包（2 个任务）
- [`sdk/manifest.schema.json`](manifest.schema.json) — manifest.yaml 的 JSON Schema
- [SPEC.md](../SPEC.md) — 系统架构规范
