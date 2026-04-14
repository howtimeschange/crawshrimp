# RFC: 在 crawshrimp 中引入标准化 `probe` 链路

## 1. 目标

`crawshrimp probe` 的目标不是再做一套新的浏览器自动化运行时，而是把当前仓库里已经在人工完成的这段工作正式产品化：

- 连接当前 Chrome CDP 会话
- 对 live 页面做安全探查
- 抓取 DOM / 容器 / 控件 / 网络 / 框架线索
- 判断这条链路更适合 `DOM-first`、`API-first` 还是 `mixed`
- 把结果沉淀成 **机器可读 bundle** + **人类可读 note 草稿**
- 让 AI 和工程师都能在同一份探查产物上继续写 adapter

当前仓库已经有：

- `core/cdp_bridge.py`：CDP 连接与 tab 管理
- `core/js_runner.py`：JS 注入、CDP click、请求捕获、下载 artifact
- `core/api_server.py`：任务执行、日志、live 状态
- `adapters/*/notes/*.md`：人工整理后的 DOM findings
- `skills/web-automation-skill`：页面探查与单控件实验方法
- `skills/crawshrimp-adapter-skill`：adapter phase/shared/live/progress 工程化方法

缺的是中间这层标准化探查产物。

---

## 2. 非目标

v1 明确不做这些事：

- 不引入第二套 Chrome 扩展、daemon 或浏览器桥
- 不直接自动生成完整 adapter 并宣称可上线
- 不做无白名单的盲点按钮 fuzz
- 不把 probe 绑进 `manifest.yaml` 作为外部契约字段
- 不替代 `web-automation-skill` 的 DOM Lab 和单控件闭环实验
- 不替代 `crawshrimp-adapter-skill` 的 phase/shared/live/recovery 设计

`probe` 是侦察层，不是最终工程层。

---

## 3. 从 OpenCLI 借什么，不借什么

### 3.1 直接借用的精华机制

来自 OpenCLI，值得保留到 crawshrimp 的有：

1. **复用真实登录态**
   - 直接复用当前 Chrome 会话，不重复登录，不转移凭据。

2. **探查结果必须结构化落盘**
   - 不能只留下聊天记录或零散截图。
   - 至少要有机器可读 JSON bundle，供 AI 继续消费。

3. **同时看 DOM 和 Network**
   - 页面问题先分流成 DOM、API、混合三类，而不是默认只写 DOM 自动化。

4. **框架 / store 指纹**
   - 识别 React / Vue / Next / Nuxt / Pinia / Vuex。
   - 给 AI 一个更接近“页面真实运行机制”的线索面。

5. **策略判断**
   - 对每个候选链路输出：
     - 页面交互策略：`dom_first` / `api_first` / `mixed`
     - 鉴权线索：`public` / `cookie` / `header` / `store_action` / `unclear`

6. **探查产物先于脚本**
   - 先形成 bundle 和 note 草稿，再决定是否回写 adapter。

### 3.2 要改造后再借用的机制

1. **交互触发**
   - OpenCLI 有 blind clickable fuzz。
   - crawshrimp 里必须改成：
     - 文本白名单
     - selector 白名单
     - profile 声明的安全控件
   - 默认只允许：
     - tab / capsule / filter
     - expand / detail / pagination
     - 非 destructive drawer / modal 打开动作

2. **能力推断**
   - OpenCLI 推的是“可复用 CLI capability”。
   - crawshrimp 要推的是“adapter 设计线索”：
     - phase 候选
     - readback selector
     - transition evidence
     - API fallback 候选
     - runtime action 候选（capture click request / download / restore）

3. **结果产物**
   - OpenCLI 输出 `manifest/endpoints/capabilities/auth`。
   - crawshrimp 应输出更贴近当前工程的 bundle：
     - `manifest`
     - `page_map`
     - `dom`
     - `network`
     - `endpoints`
     - `framework`
     - `strategy`
     - `recommendations`
     - `report.md`

### 3.3 明确不借的机制

1. **自动生成完整适配器作为主路径**
   - crawshrimp 的难点主要在：
     - 顽固控件
     - phase 重入
     - `shared` carry
     - 恢复
     - 下载 artifact
     - live 进度协议
   - 这些都不是 OpenCLI 自动生成主链路的强项。

2. **把“可拿到 JSON”视作任务完成**
   - crawshrimp 经常还要处理：
     - 导出触发
     - 多站点切换
     - 抽屉分页
     - 任务历史页取件
     - live 批量执行

---

## 4. 建议的仓库落点

### 4.1 核心模块

建议新增这些模块：

```text
core/
  browser_session.py      # 从 api_server 抽出 tab 解析 / auth / runner 构建
  probe_models.py         # ProbeRequest / ProbeBundle / ProbeFinding 等模型
  probe_service.py        # probe 主流程
  probe_analyzer.py       # DOM / network / endpoint / strategy 分析
  probe_profiles.py       # 读取 adapter 侧 probe profile（可选）
```

### 4.2 API 面

```text
core/api_server.py
  POST /probe/run
  GET  /probe/{probe_id}
  GET  /probe/{probe_id}/logs
  GET  /probe/{probe_id}/bundle
  POST /probe/{probe_id}/materialize-note
```

### 4.3 前端面

v1 建议直接挂在现有任务页，而不是另起一套路由：

```text
app/src/renderer/views/TaskRunner.vue
app/src/renderer/components/ProbePanel.vue
app/src/renderer/components/ProbeResultDrawer.vue
app/src/renderer/utils/probeClient.js
```

理由：

- probe 的入口天然依附某个 adapter/task/page
- 需要复用现有 `current_tab_id`
- 需要顺手把结果喂回当前开发任务

### 4.4 技能与文档面

```text
skills/web-automation-skill/references/crawshrimp-probe-workflow.md
skills/crawshrimp-adapter-skill/references/probe-to-adapter.md
RFC-crawshrimp-probe.md
```

### 4.5 测试面

```text
tests/test_probe_service.py
tests/test_probe_analyzer.py
```

---

## 5. 与现有运行时的关系

### 5.1 必须复用的现有能力

`probe` 必须直接复用这些现有能力：

- `core.cdp_bridge.get_bridge()`
- `core.js_runner.JSRunner.evaluate_with_reconnect()`
- `core.js_runner.JSRunner.cdp_mouse_click()`
- `core.js_runner.JSRunner.capture_click_requests()`
- `core.js_runner.JSRunner.capture_url_requests()`
- `core.js_runner.JSRunner.runtime_output_files`

这意味着：

- 不需要第二套浏览器运行时
- 不需要 Playwright / Puppeteer sidecar
- 不需要重新发明下载和请求捕获

### 5.2 建议先抽公共浏览器会话层

现在 `_execute_task()` 里已经包含：

- `mode=current/new` tab 选择
- current tab 校验
- entry_url 解析
- auth 检测与登录等待
- `JSRunner` 构建

probe 如果直接照抄，会让 `api_server.py` 继续膨胀。建议先抽成：

```python
# core/browser_session.py
resolve_target_tab(...)
build_runner_for_tab(...)
ensure_auth_if_needed(...)
```

这样：

- 正式任务执行和 probe 共用同一套 tab/auth 判断
- current/new 行为保持一致
- profile 只需要关心 probe 特有逻辑

---

## 6. Probe Profile 设计

`probe` 不应通过 `manifest.yaml` 暴露给普通用户；它更像开发期资产。

建议用约定目录承载：

```text
adapters/<adapter_id>/probe/
  <task_id>.json
  common.json
```

v1 不需要 schema 绑死到 manifest；按约定查找即可。

### 6.1 `probe profile` 的职责

- 定义安全入口 URL 或 URL 前缀
- 定义当前页 / 新页策略默认值
- 定义安全点击白名单
- 定义优先捕获的 network matcher
- 定义重点扫描的 DOM 区域
- 定义该任务更关心的探查产物

### 6.2 建议字段

```json
{
  "entry_url": "https://agentseller.temu.com/main/flux-analysis-full",
  "tab_match_prefixes": [
    "https://agentseller.temu.com/main/flux-analysis-full"
  ],
  "safe_click_labels": ["近7日", "近30日", "本周", "本月", "查看详情"],
  "safe_click_selectors": [
    "[data-testid=\"beast-core-button-link\"]",
    "[role=\"tab\"]",
    "[class*=\"Drawer_\"] button"
  ],
  "network_matchers": [
    { "url_contains": "/api/", "method": "GET" },
    { "url_contains": "/query", "method": "POST" }
  ],
  "focus_areas": [
    "filters",
    "drawer",
    "pagination",
    "download"
  ],
  "preferred_strategy": "mixed",
  "note_name": "goods-traffic-detail-dom-findings"
}
```

### 6.3 设计约束

- profile 只描述 probe 行为，不描述最终业务逻辑
- 不放任务 UI 文案
- 不放 live 进度策略
- 不让 manifest 依赖它

---

## 7. Probe Bundle 设计

### 7.1 落盘位置

本地运行时产物建议放：

```text
~/.crawshrimp/probes/<adapter_id>/<task_id>/<probe_id>/
```

其中 `probe_id` 推荐：

```text
2026-04-14T16-25-30Z-current-tab
```

原因：

- 不污染正式 run artifact
- 不和业务导出混在一起
- 便于 AI 或工程师单独回看 probe 历史

### 7.2 Bundle 文件结构

```text
manifest.json
page-map.json
dom.json
network.json
endpoints.json
framework.json
strategy.json
recommendations.json
report.md
screenshots/          # 可选
raw/                  # 可选：保存原始 capture 结果
```

### 7.3 关键文件语义

#### `manifest.json`

记录：

- `adapter_id`
- `task_id`
- `probe_id`
- `target_url`
- `final_url`
- `mode`
- `tab_id`
- `started_at`
- `finished_at`
- `profile_name`

#### `page-map.json`

记录页面状态图：

- list / drawer / modal / confirm / success
- 进入条件
- 退出条件
- 成功信号
- 失败信号

#### `dom.json`

记录：

- active container
- visible headings / tabs / inputs / selects / buttons
- 值回读目标
- portal / drawer / modal root
- 关键 text anchor / `data-testid` / class clue

#### `network.json`

记录原始请求捕获：

- request url / method / status
- response body preview
- headers / response headers
- 点击前后触发链路

#### `endpoints.json`

在 `network.json` 基础上去噪、归并并标注：

- endpoint pattern
- query params
- item path
- detected fields
- auth indicators
- candidate purpose

#### `framework.json`

记录：

- React / Vue / Next / Nuxt
- Pinia / Vuex
- store id / action 名 / state keys

#### `strategy.json`

输出两个判断：

```json
{
  "page_strategy": "mixed",
  "auth_strategy": "cookie",
  "confidence": "medium",
  "reasons": [
    "列表筛选走 DOM 更稳",
    "详情数据有可重放 JSON 接口",
    "导出文件仍需 runtime capture"
  ]
}
```

#### `recommendations.json`

不是“生成脚本”，而是给 adapter 工程提供建议：

- phase 边界候选
- readback selector
- transition evidence
- current context restore clue
- API fallback 候选
- runtime action 候选

#### `report.md`

按仓库现有 DOM report 风格生成 starter note，供人工补充后落到：

```text
adapters/<adapter_id>/notes/<task>-dom-findings-YYYY-MM-DD.md
```

---

## 8. 执行流程

### 8.1 请求输入

建议 `ProbeRequest` 至少包含：

```json
{
  "adapter_id": "temu",
  "task_id": "goods_traffic_detail",
  "goal": "识别详情抽屉的切换信号与可复用接口",
  "mode": "current",
  "current_tab_id": "ABC123",
  "profile": "goods_traffic_detail",
  "safe_auto": true,
  "capture_response_body": true,
  "materialize_note": true
}
```

### 8.2 主流程

#### Step 1. 解析浏览器上下文

- 复用 `current/new` 逻辑
- 校验当前 tab 是否命中 `entry_url` / `tab_match_prefixes`
- 按需要执行 auth check

#### Step 2. 基础页面指纹

执行只读 DOM sweep，产出：

- 当前 URL / title
- heading / breadcrumb
- active container
- visible inputs / buttons / tabs / selects
- 文本锚点
- portal / drawer / modal root

#### Step 3. 框架与 store 指纹

借 OpenCLI 的思路，注入轻量脚本收集：

- React / Vue / Next / Nuxt
- Pinia / Vuex
- store/action/state key

#### Step 4. 被动 network capture

补一个 `JSRunner.capture_passive_requests()`：

- 不导航
- 不点击
- 对当前页面做短时观察
- 把当前 settle 期内的请求拉下来

原因：

- 目前 `capture_url_requests()` 和 `capture_click_requests()` 很好用
- 但 probe 还需要“只观察当前页自然刷新”的能力

#### Step 5. 安全交互触发

只执行 profile 或请求里声明的安全触发：

- tab
- capsule
- `查看详情`
- 分页
- 过滤器展开

每次触发都做：

1. 触发前 DOM snapshot
2. `capture_click_requests()`
3. 触发后 DOM snapshot
4. 提取 transition evidence

默认不点：

- 提交
- 创建
- 删除
- 确认不可回滚动作

#### Step 6. endpoint 去噪与归并

`probe_analyzer.py` 负责：

- 去掉图片 / css / js / telemetry
- 合并相同 pattern
- 提取 query param
- 识别数组路径
- 识别字段角色
- 标注认证线索

#### Step 7. 策略判断

输出：

- `page_strategy`
  - `dom_first`
  - `api_first`
  - `mixed`
- `auth_strategy`
  - `public`
  - `cookie`
  - `header`
  - `store_action`
  - `unclear`

判断原则：

- 如果 UI 控件稳定、接口不稳定，偏 `dom_first`
- 如果接口稳定、UI 只是触发器，偏 `api_first`
- 如果列表靠 DOM，详情或导出靠 API / runtime capture，归 `mixed`

#### Step 8. 生成 recommendations

输出适合 adapter 工程的建议：

- 推荐 phase 边界
- 推荐 `shared` carry 字段
- 推荐 readback selector
- 推荐 success/failure signals
- 推荐 recovery evidence
- 推荐 `capture_click_requests` / `download_urls` 等 runtime action 触发点

#### Step 9. 生成 note 草稿

把 bundle 摘要渲染成 markdown starter note，遵循当前仓库已有 note 风格，不另起格式体系。

---

## 9. 分析器设计

### 9.1 DOM 分析器

`probe_analyzer.py` 中的 DOM 侧建议拆成：

- `extract_active_containers()`
- `extract_visible_controls()`
- `extract_display_values()`
- `detect_modal_drawer_roots()`
- `build_page_state_map()`

输出必须强调：

- 当前哪个容器是 active 的
- 哪些 selector 更适合回读显示值
- 哪些节点在重渲染后必须重查

### 9.2 网络分析器

建议沿着 OpenCLI 的 endpoint 分析思路，但输出改成 crawshrimp 语义：

- `normalize_request()`
- `dedupe_endpoints()`
- `find_array_path()`
- `detect_field_roles()`
- `classify_auth_indicators()`
- `recommend_runtime_action()`

新增一个 crawshrimp 特有判断：

- `recommend_runtime_action()`
  - `none`
  - `capture_click_requests`
  - `capture_url_requests`
  - `download_urls`
  - `browser_download_watch`

这能把现有 `JSRunner` 的 runtime action 能力直接暴露给 probe 结论。

### 9.3 策略分析器

比 OpenCLI 更偏工程化：

- 不是只判断“最小可行鉴权”
- 还判断“最终 adapter 应该把哪一步留在 DOM、哪一步换到 API”

建议规则：

1. 同一链路既有稳定表头/抽屉切换证据，又有稳定 JSON 明细接口：
   - `page_strategy = mixed`

2. 页面主要难点是日期/下拉/弹窗，但接口不稳定或风控伪 200：
   - `page_strategy = dom_first`

3. 页面只是入口，真正数据由 fetch/XHR 返回且可重放：
   - `page_strategy = api_first`

---

## 10. 前端交互设计

v1 不建议做复杂的全局“探查中心”，先在任务页补一个开发入口即可。

### 10.1 TaskRunner 入口

在 [TaskRunner.vue](/Users/xingyicheng/lobsterai/project/crawshrimp/app/src/renderer/views/TaskRunner.vue) 增一个开发者入口：

- 主按钮：现有执行逻辑不变
- 次按钮：
  - `页面探查`
  - 打开 `ProbePanel`

### 10.2 ProbePanel 字段

- `mode`: current / new
- `goal`: 这轮要证明什么
- `profile`: 自动命中 / 手动指定
- `safe_auto`: 是否执行安全触发
- `current_tab_id`: 当前激活标签页
- `materialize_note`: 是否生成 note 草稿

### 10.3 ProbeResultDrawer

结果页至少显示：

- 页面指纹
- 主要 DOM 区域
- 主要 endpoint
- 策略判断
- 推荐 phase / recovery / runtime action
- note 草稿路径
- bundle 目录路径

---

## 11. 技能边界与接力

这是本 RFC 的关键部分。

### 11.1 `web-automation-skill` 负责什么

它仍然负责：

- live 页面 DOM Lab
- 单控件实验
- 交互路径验证
- success / failure signal 判定
- DOM report 的事实采集

它和 probe 的关系应是：

- **probe 是它的标准侦察入口**
- **DOM Lab 是 probe 之后的精细实验层**

建议使用顺序：

1. 先跑 `crawshrimp probe`
2. 看 bundle 判断页面是 `dom_first` / `api_first` / `mixed`
3. 如果控件仍不稳，再进入 DOM Lab 做单控件闭环
4. 用 probe 产物补全 DOM report

换句话说：

- `probe` 解决“先摸清地形”
- `web-automation-skill` 解决“把难控件真的打通”

### 11.2 `crawshrimp-adapter-skill` 负责什么

它仍然负责：

- phase 切分
- `shared` carry
- state restore
- runtime artifact
- export guard
- progress 协议
- regression 与运行时同步

它和 probe 的关系应是：

- **probe 提供输入**
- **adapter-skill 完成工程落地**

建议使用顺序：

1. 读取 probe bundle / note
2. 把 `page_map` 翻译成 phase
3. 把 `transition evidence` 翻译成等待与恢复条件
4. 把 `strategy` 翻译成 DOM/API mixed 设计
5. 把 `recommend_runtime_action` 翻译成 `JSRunner` action
6. 再做测试、安装、live 回归

### 11.3 两个 skill 的正式分工

建议明确成下面这张表：

| 问题类型 | 先用哪个 | probe 的作用 | 后续接力 |
|----------|----------|-------------|---------|
| 新页面完全未知 | `web-automation-skill` | 先产出基础 bundle | 再做 DOM Lab |
| 抽屉 / Portal / 顽固控件 | `web-automation-skill` | 先确定 active container 与候选接口 | 再做单控件闭环 |
| phase/shared/recovery 设计 | `crawshrimp-adapter-skill` | 提供 page state map 与 strategy | 回写 adapter |
| 导出 / runtime artifact / download | `crawshrimp-adapter-skill` | 提供 runtime action 候选 | 接入 `JSRunner` |
| AI 自己写脚本 | 两者串联 | probe 给机器可读上下文 | web skill 细化，adapter skill 工程化 |

---

## 12. 与当前仓库 note 体系的关系

probe 不应替代人工 note；它应该给 note 提供起草材料。

建议形成双层产物：

### 12.1 机器层

`~/.crawshrimp/probes/...`

特点：

- 原始
- 完整
- 机器可消费
- 不进 git

### 12.2 仓库层

`adapters/<adapter_id>/notes/*.md`

特点：

- 面向交接和代码审阅
- 事实归纳过
- 只保留结论和关键证据
- 可以进入 git

这与当前 repo 的工作方式完全兼容，不需要推翻已有 note。

---

## 13. 分阶段实施

### Phase 1: 后端 + bundle + API

目标：

- 建立 probe 主流程
- 产出 bundle
- 暴露 API

改动：

- `core/browser_session.py`
- `core/probe_models.py`
- `core/probe_service.py`
- `core/probe_analyzer.py`
- `core/api_server.py`
- `tests/test_probe_service.py`
- `tests/test_probe_analyzer.py`

Done 标准：

- 给定 `adapter_id/task_id/current_tab_id`
- 能跑出 probe bundle
- 能输出 page strategy / auth strategy / recommendations

### Phase 2: TaskRunner 开发入口

目标：

- 在任务页可直接启动 probe
- 可查看结构化结果

改动：

- `TaskRunner.vue`
- `ProbePanel.vue`
- `ProbeResultDrawer.vue`

Done 标准：

- 开发者不离开任务页就能对当前业务页探查一次

### Phase 3: probe profile

目标：

- 让高频页面有可复用探查配置

改动：

- `adapters/<adapter>/probe/*.json`
- `core/probe_profiles.py`

Done 标准：

- Temu / Lazada / Shopee 至少各有 1 个 profile 跑通

### Phase 4: AI 消费 probe bundle

目标：

- 让未来的 Hermes / agent builder 优先读 probe bundle，而不是直接盲探页面

Done 标准：

- agent 能基于 bundle 回答“该写 DOM 还是 API，phase 怎么分”

---

## 14. 测试方案

### 14.1 单元测试

`tests/test_probe_analyzer.py`

覆盖：

- endpoint 去噪
- array path 识别
- field role 识别
- strategy 判断
- recommendation 生成

### 14.2 运行时模拟测试

`tests/test_probe_service.py`

沿用 [tests/test_js_runner.py](/Users/xingyicheng/lobsterai/project/crawshrimp/tests/test_js_runner.py) 的模式，mock：

- `evaluate_with_reconnect`
- `capture_click_requests`
- `capture_url_requests`

覆盖：

- current/new tab
- 被动 capture
- 安全点击 capture
- bundle 落盘
- note 草稿生成

### 14.3 非 CI live smoke

针对高价值页面做 smoke checklist：

- Temu `goods_traffic_detail`
- Temu `bill_center`
- Lazada `voucher_batch_create`
- Shopee `live_voucher_batch_create`

只验证：

- bundle 能生成
- `strategy.json` 合理
- `report.md` 有用

---

## 15. v1 验收标准

满足下面这些条件，说明 `crawshrimp probe` 设计成功：

1. 工程师第一次接新页面时，不再先手工散落抓 DOM / network / 截图。
2. AI 拿到的是统一 bundle，而不是零散聊天上下文。
3. `web-automation-skill` 和 `crawshrimp-adapter-skill` 的边界更清晰，而不是彼此重复。
4. probe 不引入新的浏览器运行时和契约污染。
5. repo 里的 `adapters/*/notes/*.md` 继续保留，但从“纯手工记忆”升级为“结构化 probe 结果的人工总结”。

---

## 16. 最后的设计判断

这个方案的核心不是“让 crawshrimp 自动写脚本”，而是：

> 先把 live 页面侦察标准化，再让 skill 和 AI 在同一份侦察结果上继续做精细实验与工程落地。

这正是 OpenCLI 最值得借的地方，也是最适合落到当前 crawshrimp 结构里的部分。
