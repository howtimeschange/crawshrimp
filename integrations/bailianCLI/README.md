# Bailian HappyHorse CLI

抓虾项目内共享的百炼 HappyHorse 异步视频任务能力。主应用只负责构造任务、调用 CLI、登记任务 ID 和归档下载结果；供应商 API 调用集中在本目录。

## 配置

通过进程环境或未跟踪的 `.env.local` 注入配置：

- `DASHSCOPE_API_KEY`：必填。
- `BAILIAN_WORKSPACE_ID`：可选，业务空间 endpoint 建议配置。
- `BAILIAN_REGION`：可选，默认 `cn-beijing`。
- `BAILIAN_BASE_URL`：可选，显式覆盖 endpoint。

不要把真实凭证写进仓库文件、示例 payload、测试或命令日志。

## 命令

```bash
npm --prefix integrations/bailianCLI test
npm --prefix integrations/bailianCLI run bailian -- create examples/happyhorse-t2v.json
npm --prefix integrations/bailianCLI run bailian -- submit examples/happyhorse-i2v.json --wait --download outputs/result.mp4
npm --prefix integrations/bailianCLI run bailian -- get <task-id>
npm --prefix integrations/bailianCLI run bailian -- wait <task-id> --download outputs/result.mp4
```

支持 `happyhorse-1.1-t2v`、`happyhorse-1.1-i2v`、`happyhorse-1.1-r2v`。图生视频只接受一张首帧图且不允许 `ratio`；参考生视频接受 1–9 张参考图。
