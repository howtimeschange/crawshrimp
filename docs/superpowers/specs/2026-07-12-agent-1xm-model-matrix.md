# 1XM 全模型 Tool Calling 协议矩阵（2026-07-12）
| 项 | 内容 |
|---|---|
| Base URL | `https://api.1xm.ai/v1` |
| Key | **不写入文档**（环境变量注入） |
| 测试 | T1 明文 chat / T2 单轮 tool / T3 tool result 回传 + tool_call_id / T4 多工具选择 |

> **范围声明：** 本矩阵验证 OpenAI-compatible 消息形状、tool 选择与一次 tool result 回传。
> T3 的第二次 HTTP 请求要求模型总结第一个工具的结果，并未要求模型再调用第二个工具。
> 因此下文 `ALL=✅` 表示「四个协议用例通过」，**不表示严格多步业务工作流可靠**。

## 汇总

| model | T1 plain | T2 single tool | T3 two-round | T4 chrome select | ALL | 约总耗时 |
|---|---|---|---|---|---|---|
| `gpt-5.5` | ✅ | ✅ | ✅ | ✅ | ✅ | 9.2s |
| `gpt-5.4-mini` | ✅ | ✅ | ✅ | ✅ | ✅ | 10.7s |
| `gpt-5.6-luna` | ✅ | ✅ | ✅ | ✅ | ✅ | 9.2s |
| `gpt-5.6-terra` | ✅ | ✅ | ✅ | ✅ | ✅ | 11.8s |
| `gpt-5.6-sol` | ✅ | ✅ | ✅ | ✅ | ✅ | 9.7s |
| `gpt-5.4` | ✅ | ✅ | ✅ | ✅ | ✅ | 10.7s |
| `gpt-5.5-openai-compact` | ✅ | ✅ | ✅ | ✅ | ✅ | 9.8s |

## 独立严格多步序列校准

后续 Pi Worker Spike 使用不同且更严格的断言：

```text
scripts_search
  → opaque search_token
  → later model turn
  → scripts_inspect(search_token)
  → exact VERIFIED_TWO_ROUND marker
```

| model | 严格成功 / 尝试 | 结果 |
|---|---:|---|
| `gpt-5.6-terra` | 5 / 5 | 当前最佳默认候选 |
| `gpt-5.6-luna` | 1 / 1 | 通过，样本少 |
| `gpt-5.5` | 1 / 1 | 通过，样本少 |
| `gpt-5.4-mini` | 3 / 4 | 一次跳过第二个 tool |
| `gpt-5.4` | 0 / 1 | 跳过 inspect，并错误宣称完成 |

这不否定下方原始 T1–T4 数据；两组测试回答不同问题：

- T1–T4：该模型/API 能否正确表达 Tool Calling 协议；
- strict sequence：该模型是否仅靠提示词就会稳定遵循多个必要工具状态。

架构结论是后者不能依赖模型保证。Runtime 必须用 opaque token、allowed-next-tool、Gateway 完成态
拒绝跳步；当前默认候选为 `gpt-5.6-terra`，但默认值应由发布回归配置，不永久锁死。

## 明细

### `gpt-5.5`

**T1 明文 chat**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 1.82,
  "content": "pong",
  "err": null,
  "usage": {
    "prompt_tokens": 1452,
    "completion_tokens": 5,
    "total_tokens": 1457
  }
}
```

**T2 单轮 Tool Call**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.33,
  "finish": "tool_calls",
  "names": [
    "scripts_search"
  ],
  "call_id": "call_0EA6C8X4oTC4iHbRtfzGVQ0G",
  "args": {
    "limit": 3,
    "query": "temu"
  },
  "args_json_ok": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1534,
    "completion_tokens": 24,
    "total_tokens": 1558
  }
}
```

**T3 两轮回传**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.44,
  "finish": "stop",
  "content": "关键词 temu 的脚本任务名包括：商品数据导出、商品流量列表。",
  "more_tools": false,
  "mentions_tasks": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1646,
    "completion_tokens": 23,
    "total_tokens": 1669
  }
}
```

**T4 选择 chrome_health**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.58,
  "names": [
    "chrome_health"
  ],
  "finish": "tool_calls",
  "err": null
}
```

### `gpt-5.4-mini`

**T1 明文 chat**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 1.94,
  "content": "pong",
  "err": null,
  "usage": {
    "prompt_tokens": 1452,
    "completion_tokens": 18,
    "total_tokens": 1470,
    "completion_tokens_details": {
      "reasoning_tokens": 11
    },
    "prompt_tokens_details": {
      "cached_tokens": 1280
    }
  }
}
```

**T2 单轮 Tool Call**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.58,
  "finish": "tool_calls",
  "names": [
    "scripts_search"
  ],
  "call_id": "call_1JxROUKz7DfFbfyBPoij5nrG",
  "args": {
    "limit": 3,
    "query": "temu"
  },
  "args_json_ok": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1534,
    "completion_tokens": 49,
    "total_tokens": 1583,
    "completion_tokens_details": {
      "reasoning_tokens": 23
    }
  }
}
```

**T3 两轮回传**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 3.58,
  "finish": "stop",
  "content": "搜索到的 temu 脚本任务有：`商品数据导出` 和 `商品流量列表`。",
  "more_tools": false,
  "mentions_tasks": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1646,
    "completion_tokens": 58,
    "total_tokens": 1704,
    "completion_tokens_details": {
      "reasoning_tokens": 27
    }
  }
}
```

**T4 选择 chrome_health**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.62,
  "names": [
    "chrome_health"
  ],
  "finish": "tool_calls",
  "err": null
}
```

### `gpt-5.6-luna`

**T1 明文 chat**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.56,
  "content": "pong",
  "err": null,
  "usage": {
    "prompt_tokens": 1452,
    "completion_tokens": 5,
    "total_tokens": 1457
  }
}
```

**T2 单轮 Tool Call**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.39,
  "finish": "tool_calls",
  "names": [
    "scripts_search"
  ],
  "call_id": "call_a9xsHVQMj2KiduvjbbEmqcTq",
  "args": {
    "limit": 3,
    "query": "temu"
  },
  "args_json_ok": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1534,
    "completion_tokens": 36,
    "total_tokens": 1570,
    "completion_tokens_details": {
      "reasoning_tokens": 10
    }
  }
}
```

**T3 两轮回传**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.28,
  "finish": "stop",
  "content": "找到 2 个与 temu 相关的脚本：商品数据导出、商品流量列表。",
  "more_tools": false,
  "mentions_tasks": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1646,
    "completion_tokens": 26,
    "total_tokens": 1672
  }
}
```

**T4 选择 chrome_health**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.02,
  "names": [
    "chrome_health"
  ],
  "finish": "tool_calls",
  "err": null
}
```

### `gpt-5.6-terra`

**T1 明文 chat**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 4.02,
  "content": "pong",
  "err": null,
  "usage": {
    "prompt_tokens": 1452,
    "completion_tokens": 5,
    "total_tokens": 1457
  }
}
```

**T2 单轮 Tool Call**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.86,
  "finish": "tool_calls",
  "names": [
    "scripts_search"
  ],
  "call_id": "call_CsaRzw4B0dD9v6h4U5M1jXMm",
  "args": {
    "limit": 3,
    "query": "temu"
  },
  "args_json_ok": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1534,
    "completion_tokens": 37,
    "total_tokens": 1571,
    "completion_tokens_details": {
      "reasoning_tokens": 11
    }
  }
}
```

**T3 两轮回传**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.37,
  "finish": "stop",
  "content": "找到的任务：商品数据导出、商品流量列表。",
  "more_tools": false,
  "mentions_tasks": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1646,
    "completion_tokens": 18,
    "total_tokens": 1664
  }
}
```

**T4 选择 chrome_health**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.58,
  "names": [
    "chrome_health"
  ],
  "finish": "tool_calls",
  "err": null
}
```

### `gpt-5.6-sol`

**T1 明文 chat**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.11,
  "content": "pong",
  "err": null,
  "usage": {
    "prompt_tokens": 1452,
    "completion_tokens": 5,
    "total_tokens": 1457
  }
}
```

**T2 单轮 Tool Call**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.34,
  "finish": "tool_calls",
  "names": [
    "scripts_search"
  ],
  "call_id": "call_mJRg8oLKNovnai88h81tzJpR",
  "args": {
    "limit": 3,
    "query": "temu"
  },
  "args_json_ok": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1534,
    "completion_tokens": 24,
    "total_tokens": 1558
  }
}
```

**T3 两轮回传**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.35,
  "finish": "stop",
  "content": "搜索到 2 个任务：商品数据导出、商品流量列表。",
  "more_tools": false,
  "mentions_tasks": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1646,
    "completion_tokens": 21,
    "total_tokens": 1667
  }
}
```

**T4 选择 chrome_health**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.89,
  "names": [
    "chrome_health"
  ],
  "finish": "tool_calls",
  "err": null
}
```

### `gpt-5.4`

**T1 明文 chat**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.35,
  "content": "pong",
  "err": null,
  "usage": {
    "prompt_tokens": 1452,
    "completion_tokens": 5,
    "total_tokens": 1457
  }
}
```

**T2 单轮 Tool Call**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 3.14,
  "finish": "tool_calls",
  "names": [
    "scripts_search"
  ],
  "call_id": "call_yd92xR5kyqNbzvKFsUB5bBiO",
  "args": {
    "limit": 3,
    "query": "temu"
  },
  "args_json_ok": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1534,
    "completion_tokens": 37,
    "total_tokens": 1571,
    "completion_tokens_details": {
      "reasoning_tokens": 11
    }
  }
}
```

**T3 两轮回传**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.38,
  "finish": "stop",
  "content": "找到 2 个 `temu` 相关脚本，任务名分别是：商品数据导出、商品流量列表。",
  "more_tools": false,
  "mentions_tasks": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1646,
    "completion_tokens": 32,
    "total_tokens": 1678
  }
}
```

**T4 选择 chrome_health**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.84,
  "names": [
    "chrome_health"
  ],
  "finish": "tool_calls",
  "err": null
}
```

### `gpt-5.5-openai-compact`

**T1 明文 chat**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.21,
  "content": "pong",
  "err": null,
  "usage": {
    "prompt_tokens": 1452,
    "completion_tokens": 5,
    "total_tokens": 1457
  }
}
```

**T2 单轮 Tool Call**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.58,
  "finish": "tool_calls",
  "names": [
    "scripts_search"
  ],
  "call_id": "call_4EfcFTRX0QshdC77cFi9GimV",
  "args": {
    "limit": 3,
    "query": "temu"
  },
  "args_json_ok": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1534,
    "completion_tokens": 24,
    "total_tokens": 1558
  }
}
```

**T3 两轮回传**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.66,
  "finish": "stop",
  "content": "关键词 temu 下找到的任务名是：商品数据导出、商品流量列表。",
  "more_tools": false,
  "mentions_tasks": true,
  "err": null,
  "usage": {
    "prompt_tokens": 1646,
    "completion_tokens": 23,
    "total_tokens": 1669,
    "prompt_tokens_details": {
      "cached_tokens": 1536
    }
  }
}
```

**T4 选择 chrome_health**: `PASS`

```json
{
  "pass": true,
  "http": 200,
  "t": 2.32,
  "names": [
    "chrome_health"
  ],
  "finish": "tool_calls",
  "err": null
}
```

## 结论

- T1–T4 协议用例全项通过：`gpt-5.5`, `gpt-5.4-mini`, `gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`, `gpt-5.4`, `gpt-5.5-openai-compact`。
- 原始协议矩阵内存在失败：无。
- 严格多步序列并非全绿：见文首校准表；不得把两个结论混写成「所有模型的工作流均已验证」。
- 产品策略仍可全部开放给用户选择；UI 的 `verified` 应至少拆成 `protocol_verified` 与
  `workflow_profile`，当前默认候选为 `gpt-5.6-terra`。
