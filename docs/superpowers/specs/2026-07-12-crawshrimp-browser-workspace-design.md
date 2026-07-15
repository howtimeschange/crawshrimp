# 抓虾 Browser Workspace 方案（方案 A：CDP 投屏工作台）

| 项 | 内容 |
|---|---|
| 文档 ID | `crawshrimp-browser-workspace` |
| 版本 | **v1.1 审查修订** |
| 日期 | 2026-07-12 |
| 仓库 | `/Users/xingyicheng/Documents/crawshrimp` |
| 状态 | **方案 A 可进入 P0 Spike**；正式 P0/P1 合并受 §13/§16 门槛约束 |
| 关联 | [智能体 Runtime v1.3](./2026-07-12-crawshrimp-agent-runtime-design.md) |
| 读者 | 产品 / 工程 / 其他 AI agent |

### 一句话

> 在抓虾桌面内提供 **左对话（或任务控制）/ 右浏览器视口** 的工作台：执行路径仍是 **独立 CDP 浏览器（9222 专用实例，用户可接受重新登录）**；右侧通过 **CDP Screencast 实时投屏** 展示自动化过程，支持多任务绑定与切换观看，并与现有 Adapter / `js_runner` 兼容。

### 已锁定产品决策

| ID | 决策 | 锁定值 |
|---|---|---|
| B1 | 登录态 | **专用 CDP 浏览器实例**（非用户日常 Chrome）；用户 **重新登录** 可接受（与现状一致） |
| B2 | 实现路线 | **方案 A：外置/侧车受管 Chromium + 应用内 CDP 投屏**（不嵌系统 Chrome，不用 Electron WebContents 跑电商主路径） |
| B3 | 执行内核 | 继续 **CDP + `js_runner` + Adapter**，不重写脚本为 Playwright-only |
| B4 | 与智能体 | 可选绑定；Browser Workspace 也可服务「任务中心 / 脚本运行」非 Agent 场景 |

---

## 1. 背景与目标

### 1.1 现状痛点

- 浏览器在 **应用外**，用户难以实时看到脚本/Agent 在点什么。
- 依赖手动或受管方式拉起 `--remote-debugging-port=9222` 的专用实例（登录需重做，**已接受**）。
- 多任务时 tab 归属不清晰，易互踩，也缺少「每个任务一个视口焦点」的产品模型。

### 1.2 目标体验

```text
┌──────────────────┬────────────────────────────────────┐
│ 左：控制面        │ 右：Browser Viewport                 │
│ · 智能体对话      │ · 实时页面画面（Screencast）          │
│ · 或任务运行面板  │ · URL / 标题 / 绑定任务              │
│ · 任务切换条      │ · P1 聚焦真窗口 / P2 基础鼠标接管      │
│ · 审批确认卡      │ · 多任务静态缩略图切换                │
└──────────────────┴────────────────────────────────────┘
```

### 1.3 成功标准

| 标准 | 说明 |
|---|---|
| S1 看得见 | 任意现有 adapter 运行时，右侧能实时看到页面变化 |
| S2 不破坏执行 | 不改 Adapter 契约；仍 CDP 注入 |
| S3 专用登录 | 专用 profile/端口；引导用户在该浏览器内登录 |
| S4 可切换任务 | ≥2 个运行中任务可切换观看（并行执行策略见 §6） |
| S5 可关联 Agent | `scripts.run` / 任务实例显式绑定 `browser_binding_id` |

### 1.4 非目标（本方案 v1）

- 把用户 **日常 Chrome** 进程嵌进窗口
- 与系统 Chrome **共享** Default Profile（不强制；避免锁文件与隐私争议）
- 用 Electron `WebContents` 替换电商主运行时
- 无限并行（无并发上限）
- 完整远程浏览器云（云手机式）
- 方案 B「真 BrowserView 嵌 Chromium 活窗口」作为 v1 主路径（可作后续增强）

---

## 2. 总体架构

### 2.1 分层

```text
┌─────────────────────────────────────────────────────────────┐
│  Renderer：WorkspaceLayout                                  │
│   ├── LeftPane: AgentWorkbench | TaskRunner | Script run    │
│   └── RightPane: BrowserViewport + SessionStrip             │
└───────────────────────────┬─────────────────────────────────┘
                            │ IPC
                            ▼
┌─────────────────────────────────────────────────────────────┐
│  Electron Main（媒体面；非绑定权威）                           │
│   ├── ScreencastPump（CDP 帧 → MessagePort → renderer）      │
│   ├── ManagedBrowserLauncher（拉起专用 Chrome/Chromium）     │
│   └── InputRelay（P2：持有效 control lease 才接收）            │
└───────────────┬─────────────────────────────┬───────────────┘
                │ 本地 CDP HTTP/WS              │ HTTP + Token
                ▼                               ▼
┌───────────────────────────┐     ┌───────────────────────────┐
│  Managed Browser Process  │     │  Python Gateway / Core    │
│  --remote-debugging-port  │     │  cdp_bridge / js_runner   │
│  --user-data-dir=专用目录  │     │  Binding/Lease/任务权威    │
└───────────────────────────┘     └───────────────────────────┘
```

### 2.2 原则

| 原则 | 说明 |
|---|---|
| **控制面与画面面分离** | 执行权威仍在 Python 任务引擎；画面只是观察与可选人工输入 |
| **CDP 是唯一控制协议** | Adapter 不感知「是否在投屏」 |
| **运行显式绑定** | 每个 Run 原子绑定一个 `browser_binding_id`；`target_id/tab_id` 是内部诊断字段，不作为跨层主键 |
| **专用 Profile** | 与用户日常浏览器隔离；数据在 `CRAWSHRIMP_DATA/chrome-profile`（或现有受管路径） |
| **可插拔 Runtime** | v1 = ManagedExternal + Screencast；未来可换真内嵌视口而不改 Adapter |
| **单一权威** | Gateway/SQLite 掌 Run↔Target binding 与 control lease；Main 只掌短生命周期帧订阅和输入转发 |

---

## 3. 核心概念

> v1.0 把「浏览器进程、任务 tab、UI 正在观看谁」都叫 Session，容易产生双权威和串 tab。
> v1.1 拆成 Runtime、Binding、WatchSubscription 三层。

### 3.1 ManagedBrowserRuntime（进程/Profile）

```text
ManagedBrowserRuntime {
  id: string                    // br_xxx
  kind: "managed"              // v1 产品路径仅 managed
  profile_id: string            // v1 = default
  runtime_generation: string    // 每次浏览器进程重启变化
  status: starting|ready|degraded|stopped
  created_at, last_heartbeat_at

  // server-only ephemeral：cdp_base_url, profile_path, pid
}
```

`cdp_base_url`、`profile_path`、`webSocketDebuggerUrl` 不返回 Renderer、不写业务事件；浏览器重启后
`runtime_generation` 改变，旧 Binding 全部失效，不能只凭相同 `target_id` 自动续接。

### 3.2 BrowserBinding（一个 Run 的权威 Target 绑定）

```text
BrowserBinding {
  id: string                    // bb_xxx，对外唯一引用
  runtime_id: string
  runtime_generation: string
  target_id: string             // CDP target id，内部字段
  target_generation: integer    // target 重建时递增
  run_uid: string               // 一个活动 run 对应一个主 binding
  instance_uid?: string
  adapter_id: string
  task_id: string
  site_scope: string            // 显式 manifest 值；缺省按独占处理
  state: allocating|bound|paused|human_controlled|released|invalid
  lease_epoch: integer
  created_at, released_at?
}
```

约束：

- `(runtime_id, runtime_generation, target_id)` 在活动 Binding 中唯一；同一 Target 不得同时给两个 Run。
- `run_uid` 在后台任务创建前同步生成。先在事务中写 Run + `allocating` Binding + 初始事件，再创建/认领
  外部 CDP Target，以 compare-and-set 把 Binding 置为 `bound`；只有 `bound` 后才调度后台任务并返回。
  外部 Target 不能假装包含在 SQLite 事务里，失败必须执行 owner-aware 补偿并把 Run 标成 failed。
- `ws_url` 每次使用时按 `target_id` 重新解析，不持久化。
- 并行运行后禁止再用「URL 只有一个匹配」找回目标；URL 只用于绑定前校验。
- 任务自己创建的 popup/download child target 必须登记 owner binding；清理只能关闭自己拥有的 child target。

### 3.3 WatchSubscription（UI 画面订阅）

```text
WatchSubscription {
  id: string                    // bw_xxx，Main 内存态
  binding_id: string
  renderer_id: string
  frame_seq: integer
  viewport_revision: integer
  mode: "observe" | "control"
  started_at, last_frame_at
}
```

UI 右侧始终只显示一个 `focused_binding_id`。它只决定「看谁」，不得改变任何 Run 的执行 Target。
`browser.observe`、`scripts.run` 和审批截图都必须使用显式 Binding，严禁回落到 UI focused tab。

---

## 4. 浏览器运行时（登录与进程）

### 4.1 Managed Browser（主路径）

与现网一致并产品化：

```text
启动参数（示意）:
  --remote-debugging-port=<port>
  --remote-debugging-address=127.0.0.1
  --user-data-dir=<CRAWSHRIMP_DATA>/browser-profiles/default
  --no-first-run
  --disable-background-networking 等（按现有 managedChrome 策略收敛）
```

| 项 | 建议 |
|---|---|
| 端口 | P0 固定受管 9222；被非受管进程占用时 fail closed + 修复提示。动态端口留 P2，避免现有全局 bridge 缓存串实例 |
| Profile | 持久化；升级应用不删 |
| 生命周期 | 应用启动可选「自动拉起」；退出可配置「保留浏览器 / 一并退出」 |
| 健康检查 | 沿用 `chrome.health` / 现有修复 Chrome 逻辑 |

### 4.2 登录体验

1. 首次：右侧视口显示「浏览器未就绪 / 未登录」引导。
2. 点击「打开抓虾浏览器」→ 拉起 managed 实例（可另窗显示真 Chrome，**同时**应用内开始投屏）。
3. 用户在该实例中完成各站点登录（**接受重新登录**）。
4. 登录态落在专用 profile，下次自动恢复。

**说明：** v1 允许「真 Chrome 窗口 + 应用内投屏」双显示，降低「只能看糊画面不能用开发者工具」的抵触；高级选项可「仅投屏、最小化真窗口」。

### 4.3 Attached 模式（开发兼容，不进 P0 产品面）

用户自行开启的 9222 可能就是日常 Chrome，与 B1「不碰用户日常 Chrome」冲突。P0 UI 只接受通过
PID + profile path + port 三项身份校验的 managed runtime；`attached` 仅保留开发/诊断入口，默认关闭，
不得获得人工控制 lease。

---

## 5. 实时画面：CDP Screencast

### 5.1 协议

对聚焦 tab：

```text
Page.startScreencast({
  format: "jpeg",
  quality: 40-70,          // 可配置
  maxWidth: 1280,
  maxHeight: 720,
  everyNthFrame: 1
})
→ Page.screencastFrame { data, metadata, sessionId }
→ Page.screencastFrameAck
Page.stopScreencast
```

### 5.2 数据路径（锁定：Electron Main 媒体面）

```text
Electron Main 的独立持久 CDP WS
  → Page.screencastFrame(base64 jpeg)
  → 立即 Ack；队列只保留最新 1 帧
  → base64 decode 一次
  → MessageChannelMain / transferable ArrayBuffer
  → Renderer createImageBitmap → canvas
```

不推荐 Python 推帧：它会让高频 base64 帧穿过 FastAPI/JSON/IPC，多一次复制，并把任务权威进程变成
媒体服务器。Python/Gateway 只提供 Binding/lease 元数据；Main 只处理画面，不获得任务完成权威。

实现约束：

- ScreencastPump 使用独立持久 CDP 连接，与 `js_runner` 的命令连接并存；必须通过 Spike 验证多客户端互不干扰。
- Ack 不等待 Renderer 绘制；慢消费者丢旧帧，内存队列硬上限 1。
- CDP 输出是 JPEG 帧，Renderer 用 canvas/ImageBitmap；不为使用 `<video>` 做转码。
- 普通帧只在内存流转，不写 SQLite/日志/审计。审批证据走 §9 的显式截图链。

### 5.3 性能策略

| 策略 | 说明 |
|---|---|
| 单路高清 | 仅 **focused Binding** 投屏；切走即 stop，后台使用最后一帧静态缩略图，P0/P1 不保留 1fps 流 |
| 自适应质量 | CPU/带宽高时降 quality / 分辨率 |
| 运行关联 | 新任务可提示切换观看，但不得强制抢走用户当前 focus |
| 上限 | 全局严格 1 路 Screencast；帧队列 1；并行任务不等于并行投屏 |
| 默认参数 | JPEG quality 55、1280×720 起步；以 Spike 数据调整，不承诺固定 FPS |

### 5.4 人工接管（P2；P0/P1 先观察 + 聚焦真窗口）

```text
Viewport 鼠标/键盘
  → IPC
  → CDP Input.dispatchMouseEvent / dispatchKeyEvent
  → 页面响应（用户可见）
```

P0/P1：Viewport 只读；「人工处理」会先暂停任务，再聚焦真实 managed Chrome 窗口。这样登录、中文 IME、
复制粘贴、文件选择器和验证码仍是原生体验。

P2 才开放 canvas 基础输入，并采用严格切换：

```text
request takeover
  → Gateway 请求 pause
  → 等待状态 = paused 且 inflight_cdp_commands = 0
  → 签发 binding_id + lease_epoch + expiry 的 control lease
  → Main 才接收输入
  → release/expire lease
  → 显式 snapshot + target/site revalidate
  → 用户选择 resume
```

每个输入事件携带 `binding_id + lease_epoch + frame_seq + viewport_revision`；切换 Binding、页面 resize、DPR/
缩放变化或旧帧坐标均拒绝。坐标换算必须覆盖 canvas letterbox、CSS 尺寸、frame metadata、pageScaleFactor、
scroll offset；P2 首批只做 mouse/wheel，键盘/中文 IME/剪贴板/拖拽另设门槛。

人工接管是用户直接操作网页，无法语义上阻止用户点击提交；正确表述是「Agent 审批和自动化暂停，人工行为
明确标记并审计」，不能宣称人工输入仍受 Agent 业务审批拦截。

---

## 6. 多任务并行

### 6.1 绑定模型

```text
TaskRun / AgentTurn
  └── run_uid
  └── browser_binding_id
```

- `POST run` 必须同步返回 `run_uid + browser_binding_id`，UI 不再 sleep 后读取「latest run」。
- 默认给并行 Run 新建并独占一个 Target；只有显式选择的空闲、未绑定 tab 才可复用。
- `current_tab_id` 只作为绑定前的人类选择输入；一旦 Binding 建立，执行、观察和投屏都只认 Binding。
- Agent 路径禁止使用 focused tab 或 URL 模糊匹配作为执行回退。
- 分配采用持久化 saga：事务写 `allocating` → 创建/认领 Target → 唯一约束/CAS 置 `bound` → 调度任务；
  失败时只关闭自己刚创建且仍归自己所有的 Target，并持久化失败原因。

### 6.2 并行策略（v1）

| 项 | 建议默认 |
|---|---|
| 最大并行任务 | P1 固定 **2**；真实资源与兼容性数据通过后再开放设置 |
| 隔离级别 | **Tab 级**（同 managed profile，多 tab） |
| 同 site/profile 写操作互斥 | **默认强制开启**；未声明并行安全的旧 Adapter 按 exclusive 处理 |
| 视口 | 单主视口 + 任务条切换 |
| 双视口并排 | 非 v1 |

Tab 隔离对现有 Adapter **不自动成立**。正式标记 `parallel_safe` 前必须审计：

- 全局枚举/按 URL 找 tab；
- `Page.bringToFront`（需要 runtime foreground lock）；
- file chooser、下载目录和 popup；
- 「运行期间出现的新 tab」清理逻辑；
- 跨 target evaluate/capture。

现有 `JSRunner` 的 transient-tab 清理会扫描全局 tab，并可能关闭另一个并行 Run 新开的页面；必须改为
owner Binding 的 child-target 集合，禁止用全局 baseline 差集直接关闭。需要 `Page.bringToFront`、原生文件选择器
或其它前台依赖的步骤，统一获取 `runtime_foreground_lock`，即使两个任务属于不同域。

Adapter/Task manifest 增加显式声明（名称仅示意）：

```yaml
browser_concurrency:
  mode: read_safe | exclusive
  site_scope: temu-seller
  requires_foreground: false
```

缺省值为 `exclusive`，禁止按 task 名称推断只读并自动放宽。

### 6.3 SessionStrip（任务条）

每个运行中绑定显示：

- 任务名 / adapter
- 状态点（running/paused）
- 最后一帧静态缩略图
- 点击 → focus + 切换全帧 screencast

---

## 7. UI 信息架构

### 7.1 入口

| 入口 | 行为 |
|---|---|
| 智能体页 | 默认左右分栏；右为 Browser Workspace |
| 任务运行 / TaskRunner | 可「打开工作台」或内嵌同一 Viewport 组件 |
| 设置 | 浏览器 profile、投屏质量、退出是否杀浏览器；并发上限在 P2 数据充分后开放 |

### 7.2 布局

```text
[可选顶栏：浏览器就绪 · 登录提示 · 打开真窗口]

┌─ 左 40% ─────────┬─ 右 60% ─────────────────────────┐
│ 对话 / 任务表单   │ SessionStrip（多任务）              │
│ 进度 / 日志 / 审批│ URL 条 + 观察 / 人工处理（P2 接管）  │
│                  │ Viewport canvas                     │
│                  │ 状态：投屏中 · 延迟 · tab 标题       │
└──────────────────┴────────────────────────────────────┘
```

分栏比例可拖拽；小窗宽时允许「仅浏览器 / 仅控制」切换。

### 7.3 空态与错误

| 状态 | UI |
|---|---|
| 浏览器未启动 | CTA：启动抓虾浏览器 |
| CDP 不可达 | 沿用「修复 Chrome 连接」 |
| 未登录目标站 | 文案引导在右侧/真窗口登录；Agent observe 可提示 |
| 投屏断开 | 自动重连；失败显示最后一帧 + 错误 |
| 并发已满 | 拒绝新 run 或排队，明确提示 |

---

## 8. 与现有模块的衔接

| 现有 | 变化 |
|---|---|
| `cdp_bridge.py` | 支持多 bridge 实例或按 `cdp_base_url` 缓存；tab 级 API 保持 |
| `js_runner.py` | **必须改并行安全边界**：只操作 Binding target/owned child targets；治理 bringToFront、下载与 popup 清理 |
| `managedChrome.js` / 桌面启动 | 产品化「抓虾浏览器」生命周期；端口写入状态 |
| `api_server` 任务 run | 同步创建 `run_uid + browser_binding_id` 并返回；原子认领 target，向后兼容旧 `current_tab_id` 输入 |
| `data_sink` | 新增 runtime/binding/lease 表或等价模型；活动 target/run 唯一约束；浏览器重启批量 invalidate |
| 智能体 tools `chrome.*` / `browser.observe` | Agent 必须针对 **run-bound Binding**；focused 仅供人类 UI |
| `runtime_install_guard` | 更新 drain 时停 screencast、拒新 Binding/WatchSubscription |

### 8.1 API 草案（Python / 桌面）

```text
# Gateway：权威元数据（无帧流）
POST   /browser/runtime/ensure
GET    /browser/runtime
POST   /browser/bindings                  # 内部：分配 target + 绑定 run
GET    /browser/bindings/{binding_id}
POST   /browser/bindings/{binding_id}/release
POST   /browser/bindings/{binding_id}/takeover/request
POST   /browser/bindings/{binding_id}/takeover/release

# Electron preload：媒体面
browser.startWatch(bindingId)             # 返回 MessagePort；只传当前订阅二进制帧
browser.stopWatch(subscriptionId)
browser.focusManagedWindow(bindingId)
browser.sendInput(controlHandle, input)    # P2；Main 本地校验已建立的 lease/epoch，禁止每个 mousemove 回源
```

不再保留「Main 或 Python 二选一」：Main 负责媒体面，Gateway 负责 Binding/lease，避免双实现和双权威。

### 8.2 前端 API（preload）

```text
browser.ensureRuntime()
browser.listBindings()
browser.startWatch(bindingId)       // MessagePort
browser.stopWatch(subscriptionId)
browser.requestTakeover(bindingId)  // P2
browser.releaseTakeover(bindingId)  // P2
browser.openRealWindow(bindingId)   // 聚焦该 target 对应真 Chrome 窗口
```

Renderer 只获得 `binding_id, run_uid, url, title, state, frame metadata`；不得获得 CDP 地址、WS URL、PID 或
profile 绝对路径。所有 preload 方法继续使用可信 sender 校验。

---

## 9. 与智能体 v1.3 的集成

| 智能体概念 | Browser Workspace |
|---|---|
| Agent 会话 | 可记录最近使用的 `browser_binding_id`，但不拥有永久 focused tab |
| `scripts.search` | 不需要浏览器 Binding |
| `scripts.inspect` / `capability_ref` | 声明 browser requirement、site scope 和并行等级；不在此时隐式选择 focused tab |
| `scripts.run` | 执行前分配 Binding；审批票据绑定 exact args + `browser_binding_id + runtime_generation + target_generation` |
| 审批卡 | 对 bound target 显式 `Page.captureScreenshot`，保存 hash/URL/target generation/captured_at；最后一帧仅作 UI 预览 |
| `browser.observe` / C2 | Agent 必须显式传 `browser_binding_id` 或 `run_uid`；focused 仅供人类 Workspace |
| 多 Agent 会话 | 每会话可绑定不同 tab；并发受全局上限 |

**权威完成态仍在 Gateway 任务状态**，不以「模型说做完了」或「画面看起来好了」为准。

推荐顺序：

```text
search_token → capability_ref
  → allocate BrowserBinding
  → exact args + binding + fresh screenshot（若需审批）
  → approval consume
  → run(binding_id)
```

这样可以防止「在 A tab 看截图并批准，实际换到 B tab 执行」。

---

## 10. 安全与隐私

| 项 | 要求 |
|---|---|
| Profile 隔离 | 专用目录；不默认碰用户 Chrome |
| CDP 暴露面 | 显式绑定 `127.0.0.1`；承认本地 CDP 无应用层鉴权，不把 9222 暴露到局域网 |
| Profile 权限 | 目录尽力设为当前用户可读写（POSIX 0700/Windows 用户 ACL）；升级不放宽 |
| 投屏范围 | 仅用户启动的抓虾浏览器页面 |
| Runtime 身份 | 启动/恢复/投屏/输入前校验 managed PID + profile + port + runtime_generation |
| 帧数据 | Main→可信 Renderer 的内存 MessagePort；默认不落盘、不进日志/SQLite、不上云 |
| 接管模式 | P2 control lease + epoch + expiry + safe pause；Renderer 不能仅凭 focused 状态发输入 |
| 凭证 | 登录 Cookie 在 Chromium profile；Agent 不得 export cookie tool（v1） |
| 多任务 | 活动 target 唯一 Binding；禁止未绑定 tab 的全局注入/关闭/URL 模糊找回 |
| Renderer 暴露 | 不下发 CDP/WS URL、profile path、PID；preload 持续校验 trusted sender |
| 输入审计 | 记录 takeover 起止、事件类型/数量和 binding；不记录原始键入内容/密码 |

审批截图是唯一按需持久化图像：写入受控 artifact，绑定 hash、URL、binding/target generation 与时间；
过期或 Binding 改变时审批失效。

---

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 投屏 CPU/发热 | 单路全帧 + 自适应质量 |
| 画面延迟导致误判 | 显示延迟；关键操作用日志+状态双确认 |
| 真窗口与投屏双开困惑 | 设置「投屏优先 / 窗口优先」；文档说明 |
| 并行互踩 | 活动 Binding 唯一约束 + owned child targets + 默认同 site 写锁 + foreground lock |
| CDP 断线 | 任务可继续（若 WS 仅 screencast）；控制 WS 断开则任务失败策略明确 |
| 体积/再分发 Chromium | 优先系统 Chrome 路径 + 专用 profile；可选捆绑 Chrome for Testing 后期再定 |
| 慢 Renderer 导致堆帧 | Main 立即 Ack、queue=1、丢旧帧、MessagePort 二进制传输 |
| 浏览器重启后串旧 target | runtime_generation 变化即 invalidate 全部旧 Binding，禁止自动续接写操作 |
| 本机其它进程连接 9222 | loopback + managed 身份校验 + 不向 Renderer 暴露端点；更强本机对抗不在 v1 威胁模型 |

---

## 12. 分阶段交付

### P0 — 看得见（MVP）

| 交付 | 说明 |
|---|---|
| Workspace 左右分栏壳 | 任务运行页或智能体页其一先上 |
| Managed 浏览器就绪检测 | 复用现网 |
| Main 单 tab Screencast | 单路、MessagePort、queue=1、view-only |
| 最小 Binding | 手动/单 run 指定 target；媒体 focus 与执行 target 分离 |
| 空态/断线/修复入口 | |

**出口：** 跑 1 个真实 adapter，右侧稳定看到操作过程。

### P1 — 工作台化

| 交付 | 说明 |
|---|---|
| SessionStrip 多任务切换 | |
| 同步 `run_uid` + 原子 `browser_binding_id` | 禁 latest-run 轮询绑定 |
| 2 个已审计任务有限并行 | owned child targets + exclusive/site/foreground locks |
| 观察 +「暂停后聚焦真 Chrome」 | 不做 canvas 输入 |
| Agent C2 / scripts.run 显式 Binding | focused 不进入 Agent 权威路径 |
| 审批卡显式截图 | capture + hash + target generation，不复用最后帧 |
| 设置项 | 质量、退出策略；并发固定 2，暂不开放无限配置 |

**出口：** 2 个通过并行审计的任务可同时运行、切换观看，且负向测试证明不串 tab/不误关页面。

### P2 — 人工控制与并行增强

| 交付 | 说明 |
|---|---|
| control lease + safe pause | 仅 paused + CDP drain 后签发 |
| canvas mouse/wheel | stale frame/DPR/zoom/letterbox 校验 |
| 键盘/IME/剪贴板 | 单独兼容性门槛，通过前继续使用真 Chrome |
| 并发上限与排队 | 依据 P1 性能数据开放设置 |
| 静态缩略图 | 默认最后一帧；1fps 后台流需单独性能证明 |

### P3 — 可选增强

- 真内嵌视口实验（方案 B）
- 分屏双视口
- 操作录制回放

---

## 13. Spike 清单（开工前）

| ID | 验证项 | 通过标准 |
|---|---|---|
| BW-S1 | 现网 target `startScreencast` + Ack | 连续 30s；reload/navigation 仍出帧；无未确认帧堆积 |
| BW-S2 | Main→MessagePort→canvas | 二进制帧；queue=1；慢绘制时丢旧帧，10 分钟内存不单调增长 |
| BW-S3 | Screencast 与现有 `js_runner` 多客户端共存 | evaluate/click/network/file chooser 至少各一例；Pump 断开不导致任务 WS 失败 |
| BW-S4 | Pump/target/runtime 失效 | Pump 可重连；target close 明确 invalid；浏览器重启更换 generation，旧 Binding 不自动续写 |
| BW-S5 | 原子 Binding 与串 tab 负向测试 | 两任务相同 URL 并发；执行/observe/投屏始终命中各自 target；唯一约束拒绝双占 |
| BW-S6 | child-target 所有权 | Run A 新 tab 不被 Run B 的下载/popup 清理关闭；禁止全局 baseline 差集误删 |
| BW-S7 | 双任务切换观看 | 切换目标 <500ms 起流；只改变 WatchSubscription，不改变任一 Run target |
| BW-S8 | 后台/最小化/遮挡行为 | Chrome 前后台、最小化、锁屏恢复分别记录出帧/页面 timer；不靠猜测添加禁节流 flags |
| BW-S9 | 性能与长稳 | 30 分钟真实 Adapter；分别记录 Chrome/Main/Renderer CPU、RSS、帧率、丢帧；macOS + 真 Windows |
| BW-S10 | 并发锁 | 未声明任务默认 exclusive；同 site mutate 串行；foreground/file chooser 步骤持 runtime lock |
| BW-S11 | 接管 safe pause（P2 Gate） | 仅 paused + CDP drain 后发 lease；过期/旧 epoch/旧 frame 输入全部拒绝 |
| BW-S12 | 坐标与输入（P2 Gate） | DPR 1/2、缩放 80/100/125%、letterbox、滚轮；mouse 命中；IME 未过则保持禁用 |
| BW-S13 | 审批截图 | 从 exact Binding 显式 capture；hash/URL/generation/time 入票据；换 target 后旧审批失效 |
| BW-S14 | 安全负向 | Renderer 拿不到 CDP/WS/profile/PID；非 managed 9222 不可 watch/control；帧不落日志/SQLite |

Spike 目录建议：`docs/superpowers/spikes/browser-workspace-screencast/` 或 throwaway 分支。

门槛分组：

- **允许 P0 开工：** BW-S1～S4 通过。
- **允许 P1 合并：** BW-S5～S10、S14 通过，且至少两个真实 Adapter 完成并行审计。
- **允许 P2 接管：** BW-S11～S12 通过；否则保持 view-only + 聚焦真 Chrome。
- **允许 Agent 审批截图上线：** BW-S13 通过。

---

## 14. 代码落点建议

| 区域 | 路径建议 |
|---|---|
| 本方案 | `docs/superpowers/specs/2026-07-12-crawshrimp-browser-workspace-design.md` |
| Main 媒体面 | `app/src/screencastPump.js` / `browserMediaPort.js`；不持久化 Binding |
| 受管浏览器 | 扩展现有 `managedChrome.js` |
| Python CDP 扩展 | 扩展现有 `core/cdp_bridge.py`、`core/browser_session.py`，增加 runtime/binding registry |
| 任务绑定 | `api_server` run 路径 + `data_sink` runtime/binding/lease 元数据；同步返回 `run_uid` |
| 并行安全 | `js_runner.py` owned child targets、foreground lock、下载/popup 清理 |
| UI | `app/src/renderer/views/BrowserWorkspace.vue`、`components/BrowserViewport.vue` |
| Preload | `browser.*` API |

---

## 15. 与方案 B 的边界（避免范围爬升）

| | 方案 A（本文） | 方案 B（后续可选） |
|---|---|---|
| 画面 | CDP jpeg 投屏 | 真嵌入浏览器控件 |
| 主路径 | 专用 9222 实例 | 同左或更深集成 |
| 复杂度 | 中 | 高 |
| Adapter | 零改契约 | 同左 |
| v1 | **做这个** | 不做 |

---

## 16. 开工门槛

1. 本文产品决策 B1–B4 无异议（已确认 B1/B2）。
2. 仅允许 P0 Spike：BW-S1～S4 通过后才进入正式 P0；P1/P2 按 §13 分级门槛。
3. 选定首屏入口：智能体页 **或** TaskRunner（建议 **TaskRunner/脚本运行先做**，智能体复用组件）。
4. 与 v1.3 Agent 的跨层字段冻结为 `browser_binding_id`；`target_id/tab_id` 仅内部诊断。
5. P1 前把 run 创建改为同步返回 `run_uid`，禁止 UI 通过 sleep + latest-run 推断当前运行。
6. P1 并行前完成现有 Adapter 的 tab/popup/download/bringToFront 审计；未审计默认 exclusive。

---

## 17. 评审简报（给其他 AI）

```text
抓虾 Browser Workspace v1.1：方案 A，Codex 桌面/自动化架构审查修订。
专用 CDP 浏览器（9222 + 独立 profile），用户重登可接受。
应用内左右分栏；Main 单路 CDP Screencast + MessagePort；执行仍 js_runner+Adapter。
Gateway 掌 BrowserBinding/lease；Main 只掌帧订阅。Agent 不得回落 focused tab。
多任务：run_uid 原子绑定 target；并发默认 2；未审计 Adapter exclusive；同 site mutate 默认串行。
P0/P1 view-only + 聚焦真 Chrome；P2 通过 safe-pause/坐标 Spike 后才开放 canvas 输入。
不做：嵌系统 Chrome、WebContents 跑电商主路径、v1 真双视口。
下一步：BW-S1～S4 → P0；BW-S5～S10/S14 → P1。
```

---

## 18. 变更记录

| 版本 | 说明 |
|---|---|
| v1.0 | 初稿：锁定专用 9222 重登；方案 A 投屏工作台；会话绑定；并行与分期；Spike 与落点 |
| **v1.1** | **Codex 架构审查：拆 Runtime/Binding/Watch；Main 媒体面、Gateway 单一权威；run_uid 原子绑定；并行/child-target/foreground 锁；P2 safe takeover；扩充 BW-S1～S14 门槛** |

---

*本文独立于智能体 Runtime，可单独排期；与 Agent 集成时以绑定字段与 Viewport 组件复用为主，不阻塞 P0「先看得见」。*
