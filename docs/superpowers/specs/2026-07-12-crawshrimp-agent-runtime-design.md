# 抓虾智能体完整方案（定稿）

| 项 | 内容 |
|---|---|
| 文档 ID | `crawshrimp-agent-runtime` |
| 版本 | **v1.3 审查定稿**（独立 Spike 证据校准） |
| 日期 | 2026-07-12 |
| 仓库 | `/Users/xingyicheng/Documents/crawshrimp` |
| 状态 | **架构与产品策略已定，Pi Core 可行性已通过**；可进入 M0，合并与发布仍受 §10.2 分级门槛约束 |
| 读者 | 产品 / 工程 / 其他 AI agent |

### 一句话

> 侧边栏「智能体」是运营编排入口：优先调用已有脚本与数据；必要时受控观察浏览器并蒸馏为 Adapter。
> **`pi-agent-core` + `pi-ai` 负责模型↔工具循环与多供应商路由**；**抓虾 Gateway 拥有权限、审批、会话、审计、凭证存储与任务生命周期**。
> **支持多家模型供应商**（参考 Pi 的 Provider / Models / API / Auth 分层）；**1XM 为默认首发，已验证 Tool Calling 协议，但多步工作流必须由 Runtime 强制状态机保证**。
> **Agent 工具面**为抓虾现网 API 的薄原语封装（scripts/data/chrome/browser/author），见 **§6**；场景扩展靠 adapter + Skill，不靠无限新 tool。

### 相关探测文档

| 文档 | 内容 |
|---|---|
| [agent-g0-1xm-tools-report.md](./2026-07-12-agent-g0-1xm-tools-report.md) | 1XM tools 协议与 `tool_choice` 兼容性 |
| [agent-1xm-model-matrix.md](./2026-07-12-agent-1xm-model-matrix.md) | 1XM 7 模型 × 4 个协议用例全通过；附严格多步序列可靠性校准 |
| [Pi pi-ai README](https://github.com/earendil-works/pi/tree/main/packages/ai) | 多 Provider 实现参考 |

---

## 1. 背景与目标

### 1.1 为什么做

抓虾已有 Adapter、CDP、任务中心、AI 生图、云端审批。缺的是**自然语言编排层**。

### 1.2 成功长什么样

| 场景 | 用户 | 系统行为 |
|---|---|---|
| **A 执行** | 「导出 Temu 近 7 天流量」 | 搜索脚本 → 补参 → 确认（如需）→ 现有任务引擎 → 与任务中心一致 |
| **A 分析** | 「上次导出里哪几个 SKU 差」 | 只读 data tools；明细上模型受 egress 约束 |
| **B 编写** | 「这个新后台做成可复用导出脚本」 | observe → draft → 校验 → hash/diff 审批 → **copy 安装** → 可手跑 |
| **多供应商** | 在设置里配置 OpenAI / Anthropic / 1XM / 自定义中转 | 会话选择 `provider + model`，同一套 tools/审批 |

### 1.3 非目标（MVP）

- 嵌完整 Pi / Codex / Hermes **CLI 壳**作主界面
- 启用 Pi 内置 read / write / edit / bash
- 多租户云端多智能体
- 无确认的支付 / 批量提交 / 不可逆操作
- 替代「我的脚本 / 任务中心」权威运行面
- 复制 Pi monorepo 源码进抓虾
- MVP 一次启用 Pi 全部几十家内置 Provider（体积与测试不可控）——**抽象一次到位，首发供应商有限集合**

---

## 2. 锁定决策一览

| ID | 决策 | 锁定值 |
|---|---|---|
| D1 | 产品入口 | 侧边栏一级 **「智能体」** |
| D2 | 默认模式 | **`auto`**（脚本优先） |
| D3 | 模型供应商 | **多供应商架构**；抽象参考 Pi `pi-ai` |
| D3a | 默认供应商 | **1XM**（已验证 tools） |
| D3b | 模型标识 | **`(provider_id, model_id)`** 二元组，禁止只存裸 model 名 |
| D4 | 1XM 模型列表 | 已测 7 个**全部用户可选**；当前默认候选 `gpt-5.6-terra`，由发布回归配置决定，不作为永久架构锁 |
| D5 | 能力范围 | **A 调脚本/分析 + B 写 adapter** |
| D6 | Loop 引擎 | **`pi-agent-core` + `pi-ai`（精确钉版本）** |
| D7 | 不用 | `pi-coding-agent`、`pi-tui`、builtin 文件/shell 工具 |
| D8 | 权限归属 | **抓虾 Gateway**；Worker/Pi 不得直连 CDP/磁盘/shell |
| D9 | 进程模型 | **独立 Node Agent Worker** |
| D10 | 业务 tool 并发 | **顺序执行** |
| D11 | 安装策略 | Agent 产物 **copy + content hash**；禁 agent `link` |
| D12 | 存储 | **SQLite**；Turn **后台化** + 事件轮询 |
| D13 | 源码策略 | **npm 依赖 + 适配层**；不 copy Pi 源码 |
| D14 | 降级 parser | **不做**假 JSON tool 解析 |
| D15 | 凭证 | Gateway 持久化；GET 仅 masked；与 AI 生图 Key **分域** |
| D16 | Provider 注册 | **按需注册 / tree-shake**，禁止默认 `builtinModels()` 全量打包 |

---

## 3. 系统架构

### 3.1 总览

```text
┌──────────────────────────────────────────────────────────────┐
│  AgentWorkbench.vue                                          │
│  会话 · 确认卡 · 进度 · 【供应商 + 模型】选择 · 模式           │
└────────────────────────┬─────────────────────────────────────┘
                         │ IPC
                         ▼
┌──────────────────────────────────────────────────────────────┐
│  Electron Main：Worker 生命周期 · IPC · 不跑 loop             │
└───────────┬──────────────────────────────┬───────────────────┘
            │ spawn/RPC                      │ HTTP + API Token
            ▼                                ▼
┌───────────────────────────────┐  ┌─────────────────────────────┐
│  Node Agent Worker            │  │  FastAPI Gateway              │
│  pi-agent-core  Agent loop    │  │  Session/Turn/Event/Approval  │
│  pi-ai  Models collection     │─►│  Policy / Audit / Credentials│
│    ├── Provider: 1xm          │  │  Capability tools             │
│    ├── Provider: openai       │  │  scripts / data / browser /   │
│    ├── Provider: anthropic    │  │  author                       │
│    ├── Provider: openrouter…  │  └──────────────┬────────────────┘
│    └── Provider: custom-*     │                 ▼
│  beforeToolCall → Gateway     │    现有任务引擎 / CDP / data_sink
│  sequential tools only        │
└───────────────────────────────┘
```

### 3.2 分层职责

| 层 | 负责 | 不负责 |
|---|---|---|
| **UI** | 供应商/模型选择、对话、确认 | 明文 Key、直连模型 API |
| **Main** | Worker 启停 | loop / tool 副作用 |
| **pi-ai** | Provider 目录、鉴权解析、stream/complete、协议差异 compat | 业务权限 |
| **pi-agent-core** | tool 循环、Schema、事件、Abort/Steer、预算钩子 | CDP、任务队列、install |
| **Gateway** | 凭证存储、会话、审批、审计、真实 tool 执行 | 重复实现全部 LLM 协议 |

---

## 4. 多模型供应商设计（参考 Pi）

> 参考对象：[`@earendil-works/pi-ai`](https://github.com/earendil-works/pi/tree/main/packages/ai)
> **学其分层与概念，不 copy 源码；通过 npm 依赖使用。**

### 4.1 Pi 的核心抽象（必须对齐）

| 概念 | 含义 | 抓虾落点 |
|---|---|---|
| **API implementation** | 线协议：`openai-completions` / `openai-responses` / `anthropic-messages` 等 | 由 `pi-ai` 提供；1XM 走 `openai-completions` |
| **Provider** | 运行时单元：身份 + **auth** + **model catalog** + 绑定的 API | Worker 内 `createProvider` / 官方 factory |
| **Models collection** | 注册多个 Provider，按 `(provider, modelId)` 路由 | Worker 启动时根据 Gateway 配置 `setProvider` |
| **Model** | `id/name/api/provider/baseUrl/contextWindow/cost/input/reasoning/compat…` | 会话与 Turn 持久化 `provider_id + model_id` |
| **Auth / CredentialStore** | 每 Provider 独立凭证；stored > env；OAuth 可扩展 | **权威存储在 Gateway**（SQLite/加密文件）；注入 Worker 运行时 |
| **refreshModels** | 动态拉模型列表（中转站、Ollama） | Gateway API `POST /agent/providers/{id}/refresh-models` |
| **compat** | OpenAI 兼容差异开关 | 1XM 登记 compat（含 tool_choice 展平等） |
| **按需 factory** | `providers/openai` 等 subpath，避免全量 SDK | Worker **白名单注册**，禁止默认 `builtinModels()` |

Pi 原文要点（实现备忘）：

- *A provider owns its model catalog, its auth, and its stream behavior.*
- *Providers share API implementations (wire protocols).*
- *Only models that support tool calling are included for agentic workflows.*
- *`createProvider()` for any OpenAI/Anthropic-compatible endpoint.*
- *Custom proxies: override `compat` flags.*

### 4.2 抓虾侧数据模型

```text
ProviderConfig {
  id: string                 // "1xm" | "openai" | "anthropic" | "openrouter" | "custom_<uuid>"
  type: "builtin" | "openai_compatible" | "anthropic_compatible"
  display_name: string
  enabled: boolean
  base_url?: string          // 自定义/中转必填；builtin 可默认
  api_protocol: "openai-completions" | "openai-responses" | "anthropic-messages" | ...
  auth: {
    kind: "api_key" | "oauth" | "none"
    // 密钥密文只存服务端；API 只返回 configured + mask
  }
  compat?: {                 // 覆盖 pi-ai / 抓虾适配层
    tool_choice_style?: "openai_nested" | "flat_name"  // 1XM = flat_name
    supports_developer_role?: boolean
    supports_reasoning_effort?: boolean
    max_tokens_field?: "max_tokens" | "max_completion_tokens"
    // …可映射 pi-ai OpenAICompletionsCompat 子集
  }
  models_source: "static" | "list_endpoint" | "manual"
  static_models?: ModelInfo[]
  last_refreshed_at?: string
}

ModelRef {
  provider_id: string
  model_id: string
}

ModelInfo {
  id: string
  name?: string
  supports_tools?: boolean | "unknown"
  context_window?: number
  verified?: boolean           // 抓虾 G0/回归是否测过
}
```

**会话 / Turn 必须存 `ModelRef`，不要只存 `model: "gpt-4o"`。**

### 4.3 首发 Provider 集合（MVP 分波）

| 波次 | Provider | 说明 |
|---|---|---|
| **P0 必上** | **`1xm`** | 自定义 `openai-completions`；默认；7 模型已测 tools |
| **P0 必上** | **`openai_compatible`（用户自定义）** | 任意 Base URL + Key；手动模型列表或 `/v1/models` 刷新；用于其它中转 |
| **P1** | `openai`（官方） | pi-ai `openaiProvider` 或等价；需 tools 冒烟 |
| **P1** | `anthropic` | `anthropic-messages`；需 tools 冒烟 |
| **P1** | `openrouter` | 聚合；按需 |
| **P2** | deepseek / moonshot / minimax / groq / … | 按业务优先级加；每家至少 tools 冒烟清单 |
| **不做（默认）** | `builtinModels()` 全量 | 体积与供应链过大 |

1XM 作为 **一等公民 Provider**，不是「临时写死的唯一后端」：

```typescript
// Worker 概念示意（非最终代码）
const onexm = createProvider({
  id: '1xm',
  name: '1XM',
  baseUrl: 'https://api.1xm.ai/v1',
  auth: { apiKey: fromGatewayCredentials('1xm') },
  models: preferredOrRefreshedList,
  api: openAICompletionsApi(),
  // compat / 抓虾侧 tool_choice 展平适配
});
models.setProvider(onexm);
// 用户启用的其它 provider 同样 setProvider
```

### 4.4 1XM 探测结论（并入多供应商体系）

**Base：** `https://api.1xm.ai/v1`
**协议矩阵（T1–T4 全通过，可全部开放选择）：**

| model_id | 约 4 项总耗时 |
|---|---:|
| `gpt-5.5` | 9.2s |
| `gpt-5.4-mini` | 10.7s |
| `gpt-5.6-luna` | 9.2s |
| `gpt-5.6-terra` | 11.8s |
| `gpt-5.6-sol` | 9.7s |
| `gpt-5.4` | 10.7s |
| `gpt-5.5-openai-compact` | 9.8s |

**协议：**

- 标准 `tools` / `tool_calls` / 两轮 `tool` + `tool_call_id` ✅
- `tool_choice: auto|required|none` ✅
- OpenAI nested `tool_choice.function.name` ❌ → 须 **`{ type, name }` 扁平** 或主路径只用 `auto`
- 登记：`compat.tool_choice_style = "flat_name"`

**严格工作流校准（独立 Spike）：**

协议矩阵的 T3 是「一次 tool call 后回传结果并总结」，证明消息形状兼容；它不等于模型会可靠遵守
`search → inspect → final` 这种跨多个模型 turn 的业务状态机。独立 Spike 以 opaque token 强制后续必须
调用 `scripts.inspect`，观察到：

| model_id | 严格序列成功 / 尝试 | 结论 |
|---|---:|---|
| `gpt-5.6-terra` | 5 / 5 | 当前最佳默认候选 |
| `gpt-5.6-luna` | 1 / 1 | 通过，样本少 |
| `gpt-5.5` | 1 / 1 | 通过，样本少 |
| `gpt-5.4-mini` | 3 / 4 | 曾跳过第二个 tool |
| `gpt-5.4` | 0 / 1 | 跳过 inspect，并错误宣称完成 |

因此：

1. 「7 模型 T1–T4 全绿」只标记为 **Tool Calling 协议已验证**，不得标成「工作流可靠」。
2. 默认模型是可更新的运行配置；当前选 `gpt-5.6-terra`，发布前按固定回归集重测。
3. Runtime 必须校验允许的下一步、opaque capability token 与工具结果，模型文本不能推进权威状态。

### 4.5 凭证与设置 UX

**设置 → 智能体 → 模型供应商**

```text
[已启用供应商列表]
  1XM          已配置 · sk-…xxxx    [默认] [测试] [刷新模型] [编辑]
  OpenAI       未配置               [配置]
  Anthropic    未配置
  自定义中转    + 添加

[默认模型]
  供应商: 1XM ▼
  模型:   gpt-5.6-terra ▼  （来自该供应商 catalog；发布回归可更新默认值）
```

规则：

1. 每个 Provider **独立 API Key**（或 OAuth 后续）。
2. GET settings：**从不**返回完整 Key，仅 `configured` + mask。
3. **禁止** Agent Key 自动回落到 AI 生图 `ai.1xm.*` Key；可提供「从图片 Key 复制」显式操作。
4. 会话顶部可覆盖：供应商 + 模型。
5. 「测试连接」：最小 chat 或 `models.list` + 可选单轮 dummy tool（不强制写盘）。
6. 未配置任何可用供应商时，智能体页空态引导去设置。
7. Worker 只按本 Turn 的 `provider_id` 取得对应凭证；凭证不得进入 session/message/event/tool result。
8. HTTP 重定向不得把 `Authorization` 转发到不同 origin；自定义 Provider 的凭证必须绑定精确 origin。

### 4.6 Gateway 配置形状（示意）

```json
{
  "agent": {
    "enabled": false,
    "default_mode": "auto",
    "loop_engine": "pi_agent_core",
    "loop_engine_version": "0.80.6",
    "tool_execution": "sequential",
    "max_tool_rounds": 12,
    "default_model": {
      "provider_id": "1xm",
      "model_id": "gpt-5.6-terra"
    },
    "providers": {
      "1xm": {
        "type": "openai_compatible",
        "display_name": "1XM",
        "enabled": true,
        "base_url": "https://api.1xm.ai/v1",
        "api_protocol": "openai-completions",
        "auth_configured": true,
        "compat": {
          "tool_choice_style": "flat_name"
        },
        "models_source": "list_endpoint",
        "preferred_models": [
          "gpt-5.5",
          "gpt-5.4-mini",
          "gpt-5.6-luna",
          "gpt-5.6-terra",
          "gpt-5.6-sol",
          "gpt-5.4",
          "gpt-5.5-openai-compact"
        ],
        "allowed_base_urls": [
          "https://api.1xm.ai/v1",
          "https://1xm.ai/v1"
        ]
      },
      "openai": {
        "type": "builtin",
        "display_name": "OpenAI",
        "enabled": false,
        "api_protocol": "openai-responses",
        "auth_configured": false
      },
      "anthropic": {
        "type": "builtin",
        "display_name": "Anthropic",
        "enabled": false,
        "api_protocol": "anthropic-messages",
        "auth_configured": false
      }
    },
    "worker": {
      "entry": "agent-worker/index.js",
      "restart_max": 3
    }
  }
}
```

密钥本体存独立安全存储（如 `agent_credentials` 表加密字段或 OS keychain），**不进**上述 JSON 明文导出。

### 4.7 Worker 启动逻辑（概念）

```text
1. Gateway 下发：enabled provider 元数据；仅在 Turn 启动时把目标 Provider 的短生命周期 runtime credential 注入 Worker 内存
2. Worker:
     models = createModels({ credentials: memoryStoreFromGateway })
     for each enabled provider:
        if builtin: setProvider(openaiProvider() | …)
        if openai_compatible: setProvider(createProvider({ api: openAICompletionsApi(), … }))
     apply crawshrimpCompatAdapters (e.g. 1xm tool_choice flatten)
3. startTurn(modelRef, messages, toolSpecs):
     model = models.getModel(provider_id, model_id)
     agent.prompt… / stream via pi-agent-core
4. beforeToolCall → Gateway Policy
```

### 4.8 跨供应商会话

参考 Pi *cross-provider handoffs* 思想，MVP 简化：

- **允许**用户中途切换供应商/模型；新 Turn 用新 `ModelRef`。
- 历史 messages 以抓虾归一化格式存储；交给 pi-ai/context 转换时可能丢失部分 thinking 块——可接受。
- 切换 Provider 等于把所选历史上下文发送到新的 egress 目标；发送 business_detail 前重新执行 egress Policy，不能沿用旧 Provider 的会话授权。
- 不在 MVP 做复杂「成本最优自动路由」。

### 4.9 新供应商准入清单（工程规范）

任一新 Provider 合入前：

1. tools 单轮 + 两轮 `tool_call_id`
2. 中文指令选对 tool
3. 错误 Key / 401 形态
4. 若 `openai-completions`：核对 `tool_choice` / `max_tokens` / developer role
5. 登记 `supports_tools` 与 `verified`
6. 体积影响（是否新增大 SDK）
7. 文档：设置项与环境变量

---

## 5. 产品与交互（摘要）

### 5.1 导航

```text
智能体 · 我的脚本 · 任务中心 · AI 生图 · 数据文件 · 云端审批 · 设置
```

文案锁定 **「智能体」**。

### 5.2 模式

| 模式 | 行为 |
|---|---|
| **auto（默认）** | 脚本优先；无命中询问是否编写 |
| **执行** | 禁用 author 写副作用 |
| **编写** | observe/draft/validate/install（仍审批） |

### 5.3 模型选择器

- 两级：**供应商** → **模型**
- 显示 `verified` 标记（1XM 已测模型可标「已验证」）
- 刷新：仅对 `list_endpoint` 型 Provider 调用远端 `/models`

---

## 6. Capability 工具面（现网映射 + 安全）

设计原则（控制代码量）：

1. **少原语、多组合**：场景差异在 `adapters/*` 与 Skills，不在「一场景一 tool」。
2. **薄封装现有 API**：Agent tools 多数是对 `core/api_server.py` 已有路由的受控包装。
3. **数量纪律**：MVP 同时启用 **≤ 15** 个 tool；一年内硬上限 **≤ 25**（超限先合并/参数化）。
4. **不引入** Pi builtin `read` / `bash` / `edit` / `write`。

### 6.0 现网能力 → Agent 原语总览

```text
已有 HTTP / 模块                         Agent 原语（建议）
──────────────────────────────────────────────────────────
GET /adapters, GET /tasks                scripts.search / inspect
POST /tasks/{a}/{t}/run                  scripts.run（唯一业务执行入口）
GET  .../status, logs；POST pause|stop   scripts.get_run / control
GET /task-instances/*（可选）            run 参数带 instance_uid，或 scripts.instance_*
GET /data/{a}/{t}；POST /files/read-excel  data.list / preview / summarize
GET /settings/chrome-tabs；CDP           chrome.health / list_tabs
POST /dev-harness/*；probe/*；knowledge  browser.observe / knowledge / probe
POST /adapters/install；adapter_loader   author.draft / validate / install
/ai-image/*                              ai_image.*（二期可选）
/cloud-approval/*                        cloud.*（二期可选，风险高）
/task-schedules/*                        schedules.*（二期可选）
POST /data-sync/odps；files/delete       慎开
/runtime/update-drain                    不给 Agent（或仅 readiness 只读）
skills/*                                 上下文注入，不是 tool
```

当前约 **20 个 adapter 包**、任务数远多于 tool 数：靠 `scripts.*` 一张面吃掉全部脚本。

### 6.1 Capability Pack 与默认开关

> 本节使用 **C1–C4** 表示能力包，避免与「L2 审批」等风险/授权等级混淆。能力包不代表风险等级；
> 每次调用仍按 §6.8 双轴 risk 独立决策。

| 能力包 | 域 | 默认 |
|---|---|---|
| **C1 核心编排** | `scripts.*` `chrome.*` `data.*` | 全模式开启 |
| **C2 观察探页** | `browser.observe` `knowledge.search` | auto/编写开启 |
| **C3 编写安装** | `author.*` | **仅 Adapter 开发区 + 编写模式** |
| **C4 扩展** | `probe.*` `ai_image.*` `schedules.*` `cloud.*` `odps` `notify` | MVP 默认不注册 |

MVP 采用**按模式生成的工具白名单**，不是把所有可能工具一次性发给模型。最大集合恰好 15 个：

```text
scripts.search, scripts.inspect, scripts.run, scripts.get_run, scripts.control,
chrome.health, chrome.list_tabs,
data.list_outputs, data.preview_table, data.summarize_output,
browser.observe, knowledge.search,
author.draft_adapter, author.validate_adapter, author.install_adapter
```

`scripts.get_run` 以 `include_logs` + `tail_lines` 合并状态与日志读取。扩展 Tool 必须替换/合并现有 Tool，
或经架构评审提高上限，不能悄悄叠加。

| 模式 / 区域 | 注册集合 | 数量 |
|---|---|---:|
| 执行 | C1 | 10 |
| auto | C1 + C2 | 12 |
| 编写（仅 Adapter 开发区） | C1 + C2 + C3 | 15 |

文档中的 `scripts.search` 是内部 canonical ID；发送到 OpenAI-compatible API 时使用 wire-safe 名称
`scripts_search`（字母/数字/下划线），并维护版本化的一一映射。Policy、审批和审计绑定 canonical ID +
schema version，不能仅凭模型返回的 wire name 找执行函数。

### 6.2 C1 MVP 必给（A：执行编排）

| Tool | 背后现网能力 | 作用 | 风险 |
|---|---|---|---|
| `scripts.search` | `GET /adapters` + `GET /tasks` + 检索打分 | 按关键词找脚本 | 只读 |
| `scripts.inspect` | 同上 + manifest 参数 schema | 参数、说明、entry_url、risk | 只读 |
| `scripts.run` | `POST /tasks/{adapter}/{task}/run` | **唯一业务执行入口** | 按任务 risk，未标注默认偏严 |
| `scripts.get_run` | `GET .../status|logs`，`GET /tasks/active` | 状态 + 可选日志 tail | 只读 |
| `scripts.control` | `POST .../pause|resume|stop` | `action` 枚举控制；`stop` 按目标任务风险审批 | 控制 |
| `chrome.health` | CDP / 桌面探测 | 调试端口是否可用 | 只读 |
| `chrome.list_tabs` | `GET /settings/chrome-tabs` | 选 tab | 只读 |
| `data.list_outputs` | `GET /data/{adapter}/{task}` | 列出导出 | 只读 |
| `data.preview_table` | `POST /files/read-excel` + 路径白名单 | 预览表头/前 N 行 | 本地只读；**送入模型=外发** |
| `data.summarize_output` | 读表 + 轻量聚合（可薄服务） | 行数、字段、topK | 同 preview |

**实例任务：** 优先 `scripts.run` 增加可选 `instance_uid`，映射
`POST /task-instances/{uid}/run|pause|resume|stop` 与 status/logs；避免再拆一套并列 tool 名。

**核心模块：** `adapter_loader`、`scheduler`、`js_runner`、`data_sink`、`cdp_bridge`、`api_server` tasks/data 段。

### 6.3 C2 探页与知识（B 的观察面）

| Tool | 背后现网能力 | 作用 | 风险 |
|---|---|---|---|
| `browser.observe` | `POST /dev-harness/snapshot`（+ CDP 观察） | 当前页结构/可见信息/线索 | 只读；默认不点击/不导航 |
| `knowledge.search` | `GET /knowledge/search` | 历史经验卡片 | 只读 |
| `knowledge.rebuild` | `POST /knowledge/rebuild` | 重建索引 | 运维动作；MVP 不注册 |
| `probe.run` | `POST /probe/run` | 结构化探测 | C4；仅开发专用 profile |
| `probe.get_bundle` | `GET /probe/{id}` / `.../bundle` | 取探测结果 | C4；仅开发专用 profile |
| `browser.capture` | `POST /dev-harness/capture` | 抓请求/证据 | C4；仅开发专用 profile |
| `browser.eval` | `POST /dev-harness/eval` | 临时 JS | **默认不对运营 Agent 开放** |

**模块：** `dev_harness`、`probe_service`、`knowledge_service`、`cdp_bridge`、`browser_session`。
**Skills（非 tool）：** `crawshrimp-probe-skill`、`web-automation-skill` 作上下文注入。

### 6.4 C3 编写 / 安装

| Tool | 背后现网能力 | 作用 | 风险 |
|---|---|---|---|
| `author.draft_adapter` | artifacts 沙箱 + `sdk/template` | 生成 manifest + js 草稿 | `local_write`，仅隔离开发区 |
| `author.validate_adapter` | `adapter_loader` 校验 | **只做静态** schema/path/import/禁用 API 检查 | 低；不得借 validate 名义执行生成 JS |
| `author.install_adapter` | `POST /adapters/install` | **仅 copy + content hash，审批后** | `local_write`，必须审批 |
| `adapters.list` | `GET /adapters` | 已装列表 | MVP 不注册；复用 `scripts.search` |
| `adapters.set_enabled` | `PATCH /adapters/{id}/enable` | 启用/禁用 | MVP 不注册；后续按副作用审批 |
| `adapters.uninstall` | `DELETE /adapters/{id}` | 卸载 | MVP 不注册；后续按高 effect 风险审批 |

**禁止 Agent：** `install_mode=link`（人手开发可用，Agent 路径禁止）。
**Skill：** `crawshrimp-adapter-skill` 注入编写规范，不拆成多个 tool。

动态试跑必须是独立、显式的后续能力（例如 C4 `author.test_adapter`），运行在受控环境并按其真实副作用审批；
不得把动态执行藏进 `author.validate_adapter`。

### 6.5 C4 二期扩展（有 API，默认不对 Agent 全开）

| 域 | 现网 API | 建议 Tool | 说明 |
|---|---|---|---|
| 定时 | `/task-schedules/*` | `schedules.list/create/update/delete/run_now` | 用户常说「每天自动跑」再开 |
| 实例 | `/task-instances/*` | 优先并入 `scripts.run` 参数 | 避免 tool 膨胀 |
| AI 生图 | `/ai-image/jobs/*` 等 | `ai_image.list/create/run/get` | 细节留 UI；与 chat 模型供应商分离 |
| 云端审批 | `/cloud-approval/*` | `cloud.status`；sync/machine 慎开 | MVP 可不进 |
| 通知 | `POST /settings/test-notify` | `notify.test` | 可选 C4 |
| 设置 | `GET/PUT/PATCH /settings` | 仅脱敏只读；**patch 默认不对 Agent** | 防改密钥/全局配置 |
| ODPS | `POST /data-sync/odps` | `data.sync_odps` | C4，写数仓需审批 |
| 删文件 | `POST /files/delete` | 慎开 | 已有登记路径限制，仍按高 effect 风险审批 |
| 更新 drain | `/runtime/update-drain` | **不给 Agent** | 可读 `install-readiness` |

### 6.6 场景 → 工具组合（证明不必一场景一 tool）

| 用户说法 | 调用链 |
|---|---|
| 有哪些 Temu 脚本 | `scripts.search` |
| 跑某某导出 | `inspect` → `run` → `get_run` |
| 跑完了吗 / 日志 | `get_run` |
| 结果怎么样 | `list_outputs` → `preview` / `summarize` |
| Chrome 是否可用 | `chrome.health` + `list_tabs` |
| 这个新页面怎么抓 | `observe` → `knowledge.search` →（编写）`draft` |
| 装上草稿 | `validate` → 审批 hash → `install` |
| 每天 9 点跑 | （二期）`schedules.create` |
| 帮我生张图 | （二期）`ai_image.*` |

**20+ adapter 的业务差异**继续在 `adapters/<id>/*.js` + `manifest.yaml`，**不**为 Temu/天猫/Shopee 各注册专用 Agent tool。

### 6.7 模块落点（实现检索）

| 原语域 | 主要模块 / 路径 |
|---|---|
| scripts | `adapter_loader.py`、`scheduler.py`、`js_runner.py`、`api_server` tasks 段 |
| data | `data_sink.py`、`POST /files/read-excel`、`GET /data/...` |
| chrome / browser | `cdp_bridge.py`、`browser_session.py`、`dev_harness.py`、`probe_*.py`、`knowledge_service.py` |
| author | `adapter_loader.install_*`、`sdk/template`、artifacts 目录 |
| ai_image | `ai_image_service.py`、`one_xm_image.py` |
| cloud | `cloud_*.py` |
| 守卫 | `runtime_install_guard.py`（run 前检查，不必暴露为 tool） |

### 6.8 双轴 risk（安全）

- `effect_level`: `local_read` \| `local_write` \| `remote_mutate` \| `irreversible`
- `egress_level`: `none` \| `metadata` \| `business_summary` \| `business_detail` \| `sensitive_forbidden`
- 未在 manifest 声明 risk 的脚本：**默认 `remote_mutate`（需确认）**，禁止名称启发式自动降级

Manifest 扩展（向后兼容）：

```yaml
risk:
  effect_level: local_read
  egress_level: metadata
  capabilities: [export, upload, submit, pay, delete, message]
  requires_login: true
```

### 6.9 审批票据

绑定：`session_id, turn_id, tool_call_id, tool_name, canonical_args_hash, artifact_hash, risk, scope, expiry, nonce`
SQLite 事务内原子 consume；单次使用；换参/换 tool/换产物/过期均失效。
UI：仅本次 / 本会话同 tool 同 risk / 拒绝；**irreversible 仅 once**。

### 6.10 install 链（Agent 生成）

```text
draft（artifacts 沙箱）
  → 静态校验
  → （可选）动态受控试跑
  → content hash + diff
  → 用户审批 Diff + Hash
  → copy 安装为 runtime 不可变快照
  → 「我的脚本」可手跑
```

禁止：批准后 `link` 回可写 artifacts。

### 6.11 data 上模型

- 本地 `preview` / 打开文件：路径限 data root / 登记输出
- **送入 LLM**：单独 egress 策略、脱敏、行数上限
- 与「仅本地读」在 Policy 中区分

### 6.12 明确禁止作为 Agent 工具

| 禁止项 | 原因 |
|---|---|
| Pi builtin read / bash / edit / write | 通用高权限，与运营产品冲突 |
| 任意路径读盘 / 任意 shell | 爆炸半径 |
| `dev-harness/eval` 默认开放 | 任意页内 JS |
| `runtime/update-drain` | 更新安装控制面 |
| 未审批的 `settings` 写密钥 | 凭证安全 |
| 按平台拆分的场景 tool（如 `run_temu_xxx`） | 代码量爆炸；用 scripts + adapter 代替 |

---



## 7. 数据与 API

### 7.1 SQLite

`agent_sessions`（含 default ModelRef）
`agent_turns`（含本 turn 的 ModelRef）
`agent_events` / `agent_tool_calls` / `agent_approvals` / `agent_artifacts` / `agent_audit`
`agent_providers` / `agent_credentials`（或合并配置表）

SQLite 是 session、checkpoint、tool call、approval 与 audit 的**唯一事务权威源**。JSONL 只能作为诊断导出，
不得用于恢复审批或判断副作用是否执行。事件使用单调 `sequence`，状态迁移与事件追加在同一事务提交；
Worker 重启时只恢复 Gateway 标记为可恢复的 checkpoint。

### 7.2 Turn API

```text
POST /agent/sessions/{id}/turns     # body: content, mode?, model?: ModelRef
GET  /agent/turns/{id}
GET  /agent/turns/{id}/events?after=N
POST /agent/turns/{id}/cancel
POST /agent/approvals/{id}/decide
POST /agent/tools/execute           # Worker → Gateway
GET  /agent/providers
PUT  /agent/providers/{id}
POST /agent/providers/{id}/test
POST /agent/providers/{id}/refresh-models
POST /agent/providers/{id}/credentials   # 写入 Key，响应 masked
```

---

## 8. Worker 与适配层

### 8.1 依赖

```text
@earendil-works/pi-agent-core@0.80.6   # Spike 验证版本；升级须重跑契约/打包测试
@earendil-works/pi-ai@0.80.6
# 仅按需：providers/openai, anthropic, openrouter…
```

禁止依赖完整 `pi-coding-agent` 作为运行内核。

### 8.2 PiRuntimeAdapter

```text
configureProviders(providerRuntimeConfigs)
startTurn({ sessionId, turnId, model: ModelRef, messages, tools, budgets })
abortTurn(turnId)
onEvent(cb) → 归一化 CrawshrimpAgentEvent
dispose()
```

事件：`turn_start|turn_end|message_delta|tool_start|tool_end|approval_required|error|agent_end`

### 8.3 1XM / 兼容适配

在 Adapter 层统一处理：

- `tool_choice` 扁平化（1XM）
- 其它 Provider 保持 OpenAI/Anthropic 原生

业务代码不直接 if-else 各家协议。

### 8.4 Runtime 状态机与 opaque 引用

Runtime 不依赖提示词保证 `search → inspect → run`：

- `scripts.search` 返回绑定 `session_id + catalog_revision + expiry` 的 opaque `search_token`；
- `scripts.inspect` 消费/校验该 token，并返回绑定脚本版本与参数 schema 的 `capability_ref`；
- `scripts.run` 只接受 `capability_ref + exact args`，不得让模型凭 adapter/task 字符串绕过 inspect；
- 模型跳步、伪造 token 或在 tool result 之前宣称完成，只产生可审计错误，不推进权威状态；
- 副作用开始/完成状态由 Gateway 与现有任务引擎回写，模型文本不是完成凭据。

### 8.5 Electron 打包路径（Spike 已定）

- 支持路径：**minified CJS Worker bundle**。macOS 打包后 `.app` 已启动，Pi `Agent.prompt()` 可实例化。
- 拒绝路径：ESM 单文件 bundle 在 ASAR 内触发 `Dynamic require of "process" is not supported`。
- 体积基线：空 Electron 276 MB；CJS Worker 279 MB、ASAR 2.7 MB；原始 Pi 依赖树 344 MB、ASAR 增量约 68 MB。
- Windows x64 已交叉打包为 358 MB、ASAR 2.7 MB、无 native `.node` addon；**尚未证明真实 Windows 运行启动**。
- 正式构建须保留 MIT notices，并生成依赖与许可证清单。

---

## 9. Skills

复用 `skills/crawshrimp-adapter-skill`、`web-automation-skill`、`crawshrimp-probe-skill`。
Skill = 知识，不是执行器。

---

## 10. 实施路线

### 10.1 已完成

| 项 | 状态 |
|---|---|
| 产品形态 / Gateway 边界 / 审批与 risk | 定稿 |
| `pi-agent-core@0.80.6` + `pi-ai` loop 可行性 | **Go**；独立确定性测试 12/12 |
| 1XM 7 模型 T1–T4 协议矩阵 | **7/7 通过**；不等于多步工作流全可靠 |
| 严格两工具序列 | `gpt-5.6-terra` 5/5；Runtime 状态机要求已写入 §8.4 |
| 工具白名单 | 无 shell/read/write/edit 工具注册或发送上游 |
| 审批 | pause/approve/reject/expire、精确参数 hash、single-use 均通过 |
| 恢复 | Abort checkpoint、真实 Worker code 23 崩溃恢复、SQLite reopen 均通过 |
| Electron/macOS | 开发启动与打包 `.app` 启动通过；CJS bundle 路径确认 |
| Electron/Windows | x64 交叉打包通过；真实 Windows 启动未测 |
| 供应链 | 精确钉 `0.80.6`；fresh production audit 0 known vulnerabilities |
| 多供应商架构（本版） | **定稿** |

### 10.2 剩余门槛（按阶段阻塞）

大部分原「编码前 Spike」已经完成，不再把真实 Windows 启动错误地设为 M0 开发前置。剩余门槛分级：

| Gate | 最晚完成点 | 必须通过 |
|---|---|---|
| **G1 集成门槛** | M1 合并前 | 1XM + 一个 custom OpenAI-compatible 同时注册；按 `ModelRef` 切换各跑 tools；凭证不串用、不落事件；跨 Provider egress 重判 |
| **G1 集成门槛** | M1 合并前 | 1XM 指定函数 `tool_choice` 在 Pi/compat 路径展平且不 400；production stream/event 归一化与 backpressure 契约 |
| **G1 集成门槛** | M1 合并前 | Electron Main ↔ Worker ↔ Gateway IPC：版本握手、幂等 execute、断线、Abort、崩溃恢复、重复事件去重 |
| **G2 发布门槛** | 桌面版发布前 | 真实 Windows x64 冷启动、首轮 prompt/tool、Abort、崩溃恢复；不是仅交叉打包 |
| **G2 发布门槛** | 桌面版发布前 | macOS/Windows 签名、安装器、自动更新、升级中 Worker drain 与 SQLite migration |
| **G2 发布门槛** | 桌面版发布前 | 许可证清单、secret scan、生产依赖 audit、CJS bundle 体积预算回归 |

OpenAI/Anthropic 官方 Key 冒烟是对应 Provider 上线前门槛，不阻塞仅 1XM + custom compatible 的 M1。

### 10.3 正式里程碑

| 阶段 | 内容 |
|---|---|
| **M0** | Gateway + Provider/凭证 API + Worker 骨架 + 1XM 接通 |
| **M1** | A 域 tools + UI + **供应商/模型选择器** + 自定义 OpenAI 兼容 |
| **M1.5** | OpenAI / Anthropic 官方 Provider |
| **M2** | B 域 author 流水线 |
| **M3** | 更多聚合商、打磨、usage、灰度 enabled |

---

## 11. 安全清单

- [ ] 多 Provider 凭证隔离与 masked GET
- [ ] 凭证绑定 exact origin；跨 origin redirect 不携带 Authorization
- [ ] 自定义 base_url 使用显式网络 profile，防 DNS rebinding / link-local 访问
- [ ] 业务副作用仅 Gateway
- [ ] Approval 防换参
- [ ] copy install + hash
- [ ] sequential tools
- [ ] 依赖钉版本 + audit
- [ ] 聊天泄露过的 Key 已轮换

自定义 OpenAI 兼容的 base_url：**默认允许用户填**（中转刚需），但：

- `internet` profile：仅 HTTPS，解析后拒绝 private/link-local/metadata IP，并防重定向换 origin；
- `local` profile：用户显式启用，只允许 loopback/明确地址，用于 Ollama 等本地服务；
- 企业版可强制 allowlist；不能用一个「禁所有内网」规则同时假装支持本地 Provider。

---

## 12. 代码落点

| 区域 | 路径 |
|---|---|
| 本方案 | `docs/superpowers/specs/2026-07-12-crawshrimp-agent-runtime-design.md` |
| Gateway agent | `core/agent/**` |
| Provider 配置/凭证 | `core/agent/providers.py` 等 |
| Worker | `app/agent-worker/**`（pi-agent-core + pi-ai） |
| UI | `AgentWorkbench.vue` + 设置「模型供应商」 |
| 测试 | provider 契约测 + 1XM 矩阵脚本可回归 |

---

## 13. 风险

| 风险 | 缓解 |
|---|---|
| 全量 builtin Providers 体积爆炸 | 白名单注册 + tree-shake |
| 各家 tools 行为不一致 | 准入清单 + verified 标记 |
| 1XM tool_choice 差异 | compat + 适配层 |
| 自定义 base_url SSRF / DNS rebinding | internet/local profile + exact-origin credential binding |
| 凭证泄漏 | masked、分域、禁进 Git |
| 模型跳过必要工具并声称完成 | Runtime 状态机 + opaque capability_ref + Gateway 完成态 |
| ESM bundle 在 ASAR 失效 | 仅发布验证过的 CJS Worker bundle |

---

## 14. 开工门槛

1. **M0 可开工**：Pi Core、审批、恢复、SQLite、macOS 打包与 CJS 路径已有可行性证据。
2. **M1 不得合并**，直到 §10.2 G1 全绿。
3. **桌面版不得发布**，直到真实 Windows 启动与 §10.2 G2 全绿。
4. 默认 Provider=`1xm`；当前默认模型候选 `gpt-5.6-terra`，发布回归可更新，不写成永久锁。
5. 已在聊天中出现过的 Key 必须轮换；新 Key 只能进入安全存储。

---

## 15. 本轮架构审查结论

| 评审面 | 判定 | 结论 / 必改项 |
|---|---|---|
| Gateway / Pi 边界 | **同意** | Pi 只做 loop，Gateway 掌审批、状态和副作用；新增 Runtime 状态机，禁止模型文本推进业务状态 |
| §6 工具粒度 | **同意但收紧** | `scripts.control` 合并 pause/resume/stop，`scripts.get_run` 合并 status/logs；MVP 最大集合精确为 15，probe/rebuild/uninstall 不注册 |
| 多供应商 / 凭证 | **澄清后同意** | `(provider_id, model_id)` 正确；凭证还必须 exact-origin 绑定、按 Turn 注入、跨 Provider 重判 egress |
| 「7 模型全通过」 | **反对原表述** | 只能说协议矩阵 7/7；严格序列存在 5.4-mini 3/4、5.4 0/1，当前默认候选改为 terra |
| Spike 清单 | **反对继续称“全部编码前置”** | 基础可行性已完成；改为 G1 集成门槛与 G2 发布门槛，真实 Windows 仍是硬发布门槛 |
| Adapter 编写区 | **同意但收紧** | 仅隔离开发区；validate 只静态检查，动态执行必须独立工具和更高审批；install 仅 copy + hash |

---

## 附录 A · 系统提示（草案）

```text
你是抓虾智能体，在抓虾桌面应用内编排电商运营自动化。
1. 默认 auto：先 scripts.search；能复用则禁止直接编写自动化。
2. 业务执行必须通过 scripts.run；不得假装已成功。
3. 危险动作等待系统确认卡；不能口头宣布已确认。
4. 编写：observe → draft → validate → 用户审批 hash 后安装。
5. draft 只写 artifacts；不写任意路径或仓库 adapters 源码树。
6. 以工具返回值为唯一事实。
7. 一次一个可验证步骤；澄清最多 1–3 问。
8. 拒绝无关破坏性请求。
```

---

## 附录 B · 给其他 AI 的 Brief

```text
抓虾智能体：Gateway 掌权；pi-agent-core+pi-ai 做 loop 与多 Provider。
模型标识 (provider_id, model_id)。1XM 默认；7 模型协议矩阵通过，不代表工作流可靠。
学 Pi：Provider/Models/API/Auth/compat/refreshModels/按需注册；不 copy 源码；不用 coding-agent。
工具：少原语多组合；§6 映射 C1 scripts/data/chrome、C2 observe/knowledge、C3 author；MVP 精确 15。
禁：builtin 文件/bash、agent link install、假 tool 降级、一场景一 tool、全量 builtinModels()。
下一动作：M0 可开工；M1 前完成多 Provider/凭证/IPC G1，发布前完成真实 Windows 与安装更新 G2。
```

---

## 附录 C · 变更记录

| 版本 | 说明 |
|---|---|
| v0.1–v1.0 | 入口、Gateway、pi-core、1XM 单供应商、7 模型矩阵 |
| v1.1 | 多模型供应商：对齐 Pi Provider/Models/API/Auth；1XM 默认；ModelRef |
| v1.2 | §6 现网 Capability 映射：L1–L4 工具表、API/模块对照、场景组合、数量纪律、禁止项 |
| **v1.3** | **并入独立 Pi Worker Spike：严格序列可靠性、15-tool 精确集合、C1–C4 命名、SQLite/状态机、CJS 打包、G1/G2 门槛与评审结论** |

---

*权威设计输入。1XM 探测见 G0/matrix 文档。实现以 Gateway 强制安全边界为准。*
