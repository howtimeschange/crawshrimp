# G0 报告：1XM Chat Completions + Tool Calling 实测

| 项 | 内容 |
|---|---|
| 日期 | 2026-07-12 |
| Base URL | `https://api.1xm.ai/v1` |
| 认证 | `Authorization: Bearer <key>`（**key 不写入本文档**） |
| 结论 | **Go（有条件）** — 标准 tools / tool result 回传可用；`tool_choice` 指定函数时格式与 OpenAI SDK 默认**不兼容**，需适配 |
| 关联 | `2026-07-12-crawshrimp-agent-runtime-design.md` v1.3；本文保留原始协议探测，并入后续独立 Pi Worker Spike 校准 |

---

## 1. 总表

| 用例 | 结果 | 说明 |
|---|---|---|
| GET `/v1/models` | **Pass** | HTTP 200，返回 7 个模型 |
| 明文 chat（无 tools） | **Pass** | `gpt-5.4-mini` / `gpt-5.5-openai-compact` 正常 |
| 单轮 Tool Call（`tool_choice=auto`） | **Pass** | 4 个候选模型均 `finish_reason=tool_calls` |
| 单次 Tool Call 回传 + `role=tool` + `tool_call_id` | **Pass** | 3 个模型收到工具结果后产出中文总结；这是协议两请求，不等于严格的两个连续工具动作 |
| 多工具选择 | **Pass** | 要求检查 Chrome 时均选 `chrome_health` 而非 `scripts_search` |
| `tool_choice=required` | **Pass** | 强制产生 tool call |
| `tool_choice=none` | **Pass** | 纯文本，无 tool |
| OpenAI 标准指定函数 `{"type":"function","function":{"name":…}}` | **Fail / 不兼容** | HTTP 400：`Missing required parameter: 'tool_choice.name'` |
| 1XM 扁平指定函数 `{"type":"function","name":…}` | **Pass** | 可强制指定 tool |
| 错误 Key | **Pass（预期失败）** | HTTP 401「无效的令牌」 |

---

## 2. 可用模型（本次账户）

`GET /v1/models` 返回（id）：

- `gpt-5.5-openai-compact`
- `gpt-5.4-mini`
- `gpt-5.4`
- `gpt-5.6-terra`
- `gpt-5.6-luna`
- `gpt-5.5`
- `gpt-5.6-sol`

本次 Tool Calling 实测通过：

| model | 单轮 tools | tool result 回传 | 多工具选择 |
|---|---|---|---|
| `gpt-5.4-mini` | Pass | Pass | Pass |
| `gpt-5.5-openai-compact` | Pass | Pass | Pass |
| `gpt-5.5` | Pass | Pass | Pass |
| `gpt-5.4` | Pass（单轮） | 未跑回传 | 未跑 |

**产品策略（已确认）**：上表模型**全部对用户开放选择**，不在客户端锁死单一模型。

**默认值校准**：原 G0 曾建议 `gpt-5.4-mini`；独立严格序列 Spike 后，当前默认候选改为
`gpt-5.6-terra`（5/5）。默认模型是发布配置，不是永久架构锁；全部模型仍可选。

---

## 3. 协议细节（实现必须遵守）

### 3.1 正常 Tool Call 响应形状（OpenAI 兼容）

```json
{
  "finish_reason": "tool_calls",
  "message": {
    "role": "assistant",
    "content": "",
    "tool_calls": [
      {
        "id": "call_…",
        "type": "function",
        "function": {
          "name": "scripts_search",
          "arguments": "{\"limit\":3,\"query\":\"temu\"}"
        },
        "index": 0
      }
    ]
  }
}
```

- `arguments` 为 **JSON 字符串**（非对象）。
- `id` 稳定，第二轮 `tool_call_id` 必须原样回传。

### 3.2 Tool result 回传请求的 messages 形态（已验证）

```text
system
user
assistant { content, tool_calls: [...] }
tool { tool_call_id, content: "<tool result json string>" }
```

后续请求中模型能基于 tool 结果生成中文答复。这个用例只要求总结，不要求再调用第二个工具，
所以不能据此推导复杂工作流遵循率。

### 3.3 `tool_choice` 兼容性（关键差异）

| 格式 | 1XM 结果 |
|---|---|
| `"auto"` / `"required"` / `"none"` | OK |
| `{"type":"function","function":{"name":"chrome_health"}}` **（OpenAI 官方）** | **400** `tool_choice.name` missing |
| `{"type":"function","name":"chrome_health"}` **（扁平 name）** | **OK** |
| `{"name":"chrome_health"}` | 400 missing `tool_choice.type` |

**对 Pi / openai SDK 的含义**：

- 若 Pi 或 SDK 发出标准 nested `tool_choice.function.name`，对 1XM 会 400。
- Spike 下一阶段必须验证：Pi → 1XM 是否改写 `tool_choice`，或抓虾侧是否包一层 provider adapter 做字段展平。
- 日常 `auto` / 不强制指定函数时，**不受影响**（Agent 主路径可用）。

### 3.4 其它观察

- 部分模型返回 `completion_tokens_details.reasoning_tokens`（有推理 token 计数）。
- 明文 chat 的 `prompt_tokens` 偏高（约 1.4k），疑似网关侧有固定前缀/缓存字段；实现时以 `usage` 为准做预算，勿假设裸 prompt 很短。
- 错误鉴权：401，中文「无效的令牌」。

---

## 4. 对架构 v1.3 的影响

| 项 | 结论 |
|---|---|
| G0「1XM 是否支持 tools」 | **支持**，主路径可继续 |
| 「不做假 JSON tool 降级」 | 仍正确；本账户模型原生 tools 可用 |
| pi-agent-core + 1XM | **核心可行性已通过**：Pi Core、严格 tool 序列、审批/恢复/SQLite 与 CJS 打包已有独立证据；生产 IPC/stream 契约仍属 G1 |
| 默认仅 `auto` tool_choice | 可规避 1XM 与 OpenAI nested 差异；强制指定 tool 时用扁平格式 |

### 4.1 独立严格序列校准

独立 Spike 使用真正的多工具状态：

```text
scripts_search → opaque token → later model turn → scripts_inspect(token) → exact marker
```

| model | 成功 / 尝试 | 观察 |
|---|---:|---|
| `gpt-5.6-terra` | 5 / 5 | 当前最佳候选 |
| `gpt-5.6-luna` | 1 / 1 | 通过，样本少 |
| `gpt-5.5` | 1 / 1 | 通过，样本少 |
| `gpt-5.4-mini` | 3 / 4 | 一次跳过 inspect |
| `gpt-5.4` | 0 / 1 | 跳过 inspect 并错误宣称完成 |

最终 terra 验证为 3 个模型 turn、37 个持久化事件，只注册/发送 `scripts_search` 与
`scripts_inspect`，实际按序调用二者并得到精确 `VERIFIED_TWO_ROUND` 标记。

**结论：Tool Calling 可用；工作流正确性必须由 Runtime 状态机、opaque 引用和 Gateway 完成态强制。**

### 4.2 Pi Worker 独立 Spike 摘要

- 确定性测试 12/12：审批暂停/批准/拒绝/过期、single-use 与 canonical args hash 均通过；
- Abort 写入可恢复 checkpoint；真实子 Worker exit code 23 后，supervisor 把 running checkpoint 恢复为 interrupted；
- SQLite close/reopen 后事件与 checkpoint 仍在；
- 注册和上游 payload 均无 shell/read/write/edit 工具；
- macOS 开发与打包启动通过；CJS Worker bundle 通过，ESM 单文件 ASAR 路径失败并弃用；
- Windows x64 仅交叉打包通过，真实 Windows 运行仍是发布门槛。

---

## 5. 安全提醒（必须处理）

本次验证使用了用户在聊天中提供的 API Key。

1. **该 Key 已出现在对话记录中，视为已泄露风险。**
2. 请在 1XM 控制台 **轮换/作废** 该 Key，换发新 Key 仅存本地环境变量或系统钥匙串。
3. 本报告 **未** 保存 Key；仓库内不应提交任何 `sk-` 明文。
4. 后续 Spike 使用：`export CRAWSHRIMP_AGENT_1XM_KEY=...` 或本地 `.env`（gitignore）。

---

## 6. Go / No-Go

| 判定 | **M0 Go；M1 合并与桌面发布有分级门槛** |
|---|---|
| 可进入 | Gateway/Worker M0 正式实现 |
| 阻塞 M1 合并 | 多 Provider 切换与凭证隔离、指定函数 `tool_choice` Pi 适配、生产 IPC/stream 契约 |
| 阻塞桌面发布 | 真实 Windows 启动、签名/安装器/自动更新、许可证与生产构建回归 |
| 不可宣称 | 仅凭 7 模型 T1–T4 协议矩阵就宣称多步工作流可靠或 Windows Ready |

---

## 7. 建议的默认配置草稿（无密钥）

```json
{
  "agent": {
    "onexm": {
      "base_url": "https://api.1xm.ai/v1",
      "model": "gpt-5.6-terra",
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
    }
  }
}
```

设置页：下拉 = `preferred_models` ∪ 刷新后的 `/v1/models`；当前默认候选 `gpt-5.6-terra`，按发布回归可更新。

---

*实测脚本为临时 Python/curl，未入库。*
