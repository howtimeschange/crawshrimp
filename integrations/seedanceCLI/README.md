# Seedance 2.0 Ark API Integration

这个仓库封装了火山方舟 Seedance 2.0 的异步视频生成任务接口：

- 创建任务：`POST https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks`
- 查询任务：`GET https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/{id}`
- 成功状态：`status === "succeeded"`，视频地址在 `content.video_url`

也支持兼容网关地址直接配置到 `/api/v3`，例如森马豆包视频网关：

```bash
SEEDANCE_API_KEY='your_runtime_key' \
SEEDANCE_BASE_URL='https://ai-aigw.semir.com/doubao-seedance/api/v3' \
npm run seedance -- submit examples/seedance2-delivery-rider.json \
  --wait --download outputs/seedance2-delivery-rider.mp4
```

## 配置

复制 `.env.example` 为 `.env.local`，填入方舟或兼容网关 API Key：

```bash
cp .env.example .env.local
```

`.env.local` 已被 `.gitignore` 忽略，不会进仓库。

## 使用

提交示例任务：

```bash
npm run seedance -- submit examples/seedance2-tea.json
```

生成 5 秒外卖员送餐视频：

```bash
npm run seedance -- submit examples/seedance2-delivery-rider.json --wait --download outputs/seedance2-delivery-rider.mp4
```

提交并等待结果：

```bash
npm run seedance -- submit examples/seedance2-tea.json --wait
```

提交、等待并下载视频：

```bash
npm run seedance -- submit examples/seedance2-tea.json --wait --download outputs/tea.mp4
```

查询任务：

```bash
npm run seedance -- get cgt-2026****
```

等待已有任务完成：

```bash
npm run seedance -- wait cgt-2026**** --interval 5 --timeout 1800
```

## Payload

示例 payload 放在 `examples/seedance2-tea.json`，对应接口文档里的多模态参考视频生成：文本、参考图、参考视频、参考音频、`generate_audio`、`ratio`、`duration`、`watermark` 等字段都会原样发送给 Ark API。

Seedance 2.0 系列常用状态：

- `queued`：排队中
- `running`：运行中
- `succeeded`：成功
- `failed`：失败
- `cancelled`：取消
- `expired`：超时

文档说明任务记录仅支持查询最近 7 天，生成视频 URL 有效期为 24 小时，拿到后建议及时下载或转存。
