# Crawshrimp Skill

面向 AI agent 的网页自动化运行层。它把抓虾项目里的网页观察、CDP 执行、多阶段运行、网络捕获、下载、证据记录和流程沉淀能力抽成一个独立 skill，让 agent 不只是“写脚本”，而是能像操作者一样理解页面、执行小步动作、验证结果，并把跑通的流程沉淀成可复用资产。

## 这个项目能做什么

`crawshrimp-skill` 适合让 AI agent 处理真实浏览器里的网页任务：

- 观察页面：读取 URL、标题、可见文本、按钮、输入框、表格、弹窗、抽屉、危险操作线索、资源请求和框架/store 线索。
- 默认复用用户浏览器：所有网页任务优先连接用户已经打开的 `http://127.0.0.1:9222` CDP 浏览器，复用真实登录态、当前 tab 和页面上下文。
- API 优先操作：先寻找页面自有 API、前端模块、action wrapper 或已观察到的请求路径；点按、输入、坐标和 DOM 操作主要作为 fallback、触发观察或 UI 验证手段。
- 安全操作：执行 API 调用、点击、输入、选择、等待、导航、上传、文件选择器上传、下载等动作，每一步都能记录原因和证据。
- 处理企业表单：在编辑配额、百分比、角色分配、审批配置等业务表单前，先读取业务规则、可用额度、校验状态和保存语义。
- 捕获网络：支持 passive、click、url、wheel 请求捕获，支持 matcher、`min_matches`、`settle_ms`、响应体捕获和 endpoint 分析。
- 运行抓虾式多阶段脚本：兼容 phase/shared 模式，支持 `cdp_clicks`、`capture_*`、`download_urls`、`download_clicks`、`next_phase`、`complete` 等 runtime action。
- 管理 adapter 和知识：扫描/安装 adapter manifest，持久化 enable 状态和安装元数据；从 notes/probe bundle 生成可搜索 knowledge cards。
- 生成 probe bundle：输出 DOM、framework、network、endpoints、strategy、recommendations 和 report，并在写盘前自动脱敏。
- 管理下载产物：并发 URL 下载、browser-session 临时 tab 下载、点击下载、文件名匹配、`min_bytes`/`expected_size` 校验和 per-item 错误记录。
- 沉淀复用流程：从 evidence journal 生成 `workflow.md`、`commands.json`、`run_workflow.py`、可选 `SKILL.md` 和 adapter draft 包。

最终效果：agent 可以从“用户已经打开的 9222 浏览器页面”开始，逐步摸清页面结构和接口线索，优先通过页面自有 API 安全地完成读取、筛选、翻页、打开详情、导出、上传、下载、保存等任务，并把成功路线变成下次可以直接复跑或改造成 adapter 的材料。

## 能力补齐状态

这一版补齐了上轮能力矩阵里适合在 skill repo 内落地的缺口：

- Adapter registry：新增 `registry_state.json`，保存启用状态、安装模式、来源路径、安装版本和安装时间。
- Auth check：必须看到 `meta.logged_in` 或首条 `data.logged_in` 为真，避免 `success: true` 但未登录的误判。
- Knowledge service：对 notes/probe 源文件做 fingerprint，搜索前自动重建过期索引。
- Probe bundle：内部强制 redaction，原始 cookie/token/header/body 不会落盘到 `network.json`。
- Snapshot：`web_operator.py snapshot` 可独立输出 DOM、framework/store 和 network 线索。
- Phase runner：优先 async CDP backend，完成或异常后清理 `sessionStorage` 和 `window.__CRAWSHRIMP_*` 参数。
- Downloads：URL 下载异常按 item 失败返回；点击下载支持空文件/大小不符校验。
- Upload：file input 和 file chooser 上传都会在触发 CDP 前校验本地文件存在。
- Workflow replay：保留并复放 clicks、wheels、matchers、files、expected-file、timeout。
- Adapter draft：`distill --include-adapter-draft` 生成可审查的 `manifest.yaml`、JS 草稿和说明。
- Enterprise form workflow：新增企业表单操作参考，要求读取业务规则、规划百分比/配额更新顺序，并通过刷新后的 UI 与应用/API readback 做双重验证。
- Browser execution：补充全任务 9222 默认入口、API 优先操作面、页面自有 API/模块包装器使用边界，以及“不导出 cookie/token/auth header”的凭证安全规则。
- Quick validation：新增结构校验和单元测试，确保 9222 全局默认、API 优先、企业表单参考文档与 `SKILL.md` 关键术语不会被后续改动漏掉。

仍然不包含完整抓虾桌面应用里的 GUI、任务队列、账号管理、平台内置 adapter 集合、数据导出 UI 或桌面发布流程。这些属于宿主应用层，不在本 skill 的边界内。

## AI Agent 使用手册

### 0. 启动环境

```bash
python3 -m venv .venv
. .venv/bin/activate
python3 -m pip install -r requirements.txt

/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/crawshrimp-skill-chrome
```

所有任务默认连接 `http://127.0.0.1:9222`。如果用户已经准备好了 Chrome/CDP 会话，优先复用该会话里的当前页面、登录态和前端运行上下文；看到登录页时，先检查 9222 里是否已有同域名的可用 tab，不要直接切到全新浏览器或要求用户重新登录。

### 1. 先判断任务类型

```bash
python3 scripts/web_agent_protocol.py classify "筛选近7天并下载导出文件"
python3 scripts/web_agent_protocol.py plan "筛选近7天并下载导出文件"
python3 scripts/web_agent_protocol.py journal-template "多页面收集详情证据" > run.json
```

任务分三类：

- `read`：读表格、搜索、摘取页面信息、总结内容。
- `operate`：筛选、翻页、打开详情、上传、下载、填写表单但不提交危险动作。
- `flow`：跨页面、多弹窗、多步骤、需要证据链和复用沉淀的流程。

### 2. 观察页面和运行环境

```bash
python3 scripts/web_operator.py observe \
  --cdp-url http://127.0.0.1:9222 \
  --url-prefix https://example.com \
  --task "下载订单报表" \
  --journal run.json

python3 scripts/web_operator.py snapshot \
  --cdp-url http://127.0.0.1:9222 \
  --url-prefix https://example.com \
  --task "下载订单报表" \
  --journal run.json
```

`observe` 给出规范化页面模型；`snapshot` 更适合 probe 前判断 framework、store 和 network 线索。

观察不是为了马上点按钮，而是为了找到稳定的页面自有 API 路径：前端模块、action wrapper、请求 endpoint、payload shape、分页/导出/下载路由和应用状态 readback。涉及配额、百分比总和、可用量、审批状态、发布状态的页面，不要先改字段；先把规则和保存语义写进 journal。

### 3. 小步执行动作

```bash
python3 scripts/web_operator.py act click \
  --url-prefix https://example.com \
  --selector "button.export" \
  --reason "打开导出菜单" \
  --journal run.json

python3 scripts/web_operator.py act upload \
  --url-prefix https://example.com \
  --selector "input[type=file]" \
  --file ./input.csv \
  --reason "上传导入文件" \
  --journal run.json

python3 scripts/web_operator.py act upload-chooser \
  --url-prefix https://example.com \
  --clicks-json '[{"x":120,"y":240}]' \
  --file ./input.csv \
  --reason "通过原生文件选择器上传" \
  --journal run.json

python3 scripts/web_operator.py act capture-wheel \
  --url-prefix https://example.com \
  --wheels-json '[{"x":640,"y":520,"delta_y":900}]' \
  --value '[{"url_contains":"/api/"}]' \
  --reason "捕获滚动懒加载请求" \
  --journal run.json

python3 scripts/web_operator.py act download \
  --url-prefix https://example.com \
  --selector "a.export" \
  --expected-file report.csv \
  --download-dir ~/Downloads \
  --reason "下载导出文件" \
  --journal run.json
```

原则：优先用页面自己的 API、模块函数、action wrapper 或 in-page `fetch` 解决任务；每次只做一个动作；页面跳转、弹窗出现、表格刷新、文件下载后都要重新观察或验证。

如果可通过页面自有 API 完成，就不要优先走点击、输入或坐标操作。使用 API 路径的前提是：请求属于当前页面应用，payload 结构来自页面代码、禁用态规则或已观察到的网络行为，并且 cookie、token、auth header、localStorage、sessionStorage 等凭证始终留在页面上下文内，不打印、不落盘、不写进 journal。只有当 API 路径不可得、不安全、无法验证，或用户明确要求人工可见交互时，才回落到 DOM/点按操作。

### 4. 验证结果

```bash
python3 scripts/web_operator.py verify \
  --url-prefix https://example.com \
  --check text \
  --target "Export" \
  --evidence "导出菜单已出现" \
  --journal run.json

python3 scripts/web_operator.py verify \
  --check file-exists \
  --target report.csv \
  --download-dir ~/Downloads \
  --evidence "导出文件已下载" \
  --journal run.json
```

支持的结构化验证：`text`、`url`、`selector-exists`、`table-rows-min`、`file-exists`。也可以用 `--expression` 写 JS 断言。

状态变更后尽量使用双重验证：用应用/API readback、页面状态或稳定网络结果确认服务端已持久化；再刷新或重新观察可见 UI，确认目标值已经显示。百分比或配额类表单要在 journal 里记录旧值、新值、目标总和和更新顺序，例如先降低超额项，再提高其他项，避免中间状态触发总量上限。

### 5. 捕获网络和生成 probe bundle

低层 CDP 捕获：

```bash
python3 scripts/browser_executor.py cdp \
  --url-prefix https://example.com \
  capture \
  --capture-mode url \
  --url https://example.com/report \
  --matches-json '[{"url_contains":"/api/report","method":"GET"}]' \
  --min-matches 1 \
  --include-response-body
```

构建 probe bundle 时调用 `scripts/probe_bundle.py` 内的 `build_probe_bundle()`，它会生成：

- `manifest.json`
- `page-map.json`
- `dom.json`
- `framework.json`
- `network.json`
- `endpoints.json`
- `strategy.json`
- `recommendations.json`
- `report.md`

敏感字段会在写盘前脱敏。

### 6. 运行抓虾式 phase/shared 脚本

```bash
python3 scripts/phase_runner.py \
  --url-prefix https://example.com \
  --file adapters/demo/orders.js \
  --params-json '{"keyword":"sku"}' \
  --artifact-dir artifacts
```

脚本可返回这些 `meta.action`：

```text
cdp_clicks
inject_files
file_chooser_upload
capture_click_requests
capture_url_requests
capture_wheel_requests
download_urls
download_clicks
reload_page
next_phase
complete
abort
```

`download_urls` 可设置 `browser_session` / `browserSession`，用临时浏览器 tab 下载依赖登录态的文件。

### 7. 管理 adapter 和 knowledge

```bash
python3 scripts/adapter_registry.py --root adapters install --source ./adapter-draft --mode copy
python3 scripts/adapter_registry.py --root adapters scan
python3 scripts/adapter_registry.py --root adapters disable --adapter demo
python3 scripts/adapter_registry.py --root adapters enable --adapter demo
python3 scripts/adapter_registry.py --root adapters task --adapter demo --task orders

python3 scripts/knowledge_service.py \
  --adapters-root adapters \
  --probes-root probes \
  --data-root knowledge \
  rebuild

python3 scripts/knowledge_service.py \
  --data-root knowledge \
  search \
  --query "export drawer" \
  --adapter demo \
  --task orders
```

Adapter enable 状态和安装元数据保存在 `adapters/registry_state.json`。

### 8. 沉淀可复用流程

```bash
python3 scripts/web_operator.py distill \
  --journal run.json \
  --output-dir reusable-workflow \
  --name example-export \
  --include-skill

python3 scripts/workflow_builder.py \
  --journal run.json \
  --output-dir reusable-workflow \
  --name example-export \
  --include-skill \
  --include-adapter-draft
```

输出内容：

- `workflow.md`：给人看的流程说明和失败分支。
- `commands.json`：可复放动作和验证参数。
- `run_workflow.py`：可执行复跑脚本。
- `SKILL.md`：可选的 Codex skill 草稿。
- `adapter-draft/manifest.yaml`、`adapter-draft/*.js`、`adapter-draft/README.md`：可选 adapter 草稿包。

## 安全边界

默认只执行读取、可逆或低风险动作。遇到这些动作必须停下来向用户确认：

- submit / publish / send / delete
- pay / purchase / confirm
- bulk modify / 批量修改
- 任何会对外部系统产生不可逆影响的动作

填写表单不等于允许提交表单。提交、发布、删除、付款等动作必须单独确认。

保存、提交、发布和任何对外部系统产生影响的 API 调用都按危险动作处理，除非用户已经在当前对话里明确授权了具体变更。使用页面自有 API 或 in-page `fetch` 保存时，只记录脱敏后的 endpoint、payload 形状、响应状态和业务字段；不要读取、复制、复用或持久化任何凭证。

## 项目结构

```text
crawshrimp-skill/
  SKILL.md
  PLAN.md
  README.md
  agents/openai.yaml
  references/
    enterprise-form-workflows.md
  scripts/
    web_agent_protocol.py
    adapter_registry.py
    browser_executor.py
    knowledge_service.py
    probe_bundle.py
    phase_runner.py
    runtime_downloads.py
    web_operator.py
    workflow_builder.py
  tests/
    test_quick_validate.py
  quick_validate.py
```

## 验证

```bash
python3 -m unittest
python3 -m unittest discover -s tests
python3 quick_validate.py .
python3 -m compileall scripts tests quick_validate.py
```

当前测试覆盖协议、CDP backend、web operator、phase runner、runtime downloads、adapter registry、knowledge/probe 和 workflow builder。
