# 抓虾自动更新下载检查 · 2026-10-10

检查时间：13:40–13:48（Asia/Shanghai）。本次只读检查线上与已安装客户端，没有改动 Cloudflare 配置、更新对象或应用代码。

结论：更新源仍可用；确认存在客户端默认多段 Range 与 Cloudflare R2 的兼容问题，以及客户端缺少可靠下载超时的问题。截图的 0% 不能证明没有下载；本机临时 ZIP 曾增长，但 UI 仍为 0%。尚无本次主进程下载错误日志，不能将该现场的全部症状归因于 HTTP 400。

| 检查项 | 结果 |
| --- | --- |
| 实际安装客户端 | /Applications/抓虾.app，v2.5.7，electron-updater 6.8.9 |
| 更新源 | https://updates.crawshrimp.com/ |
| R2 bucket | crawshrimp-desktop-updates，APAC，Standard |
| R2 自定义域名 | enabled=true，ownership=active，ssl=active，TLS 1.2 |
| 域名状态 | crawshrimp.com active，未暂停 |
| Worker routes | updates.crawshrimp.com 无 Worker 路由覆盖 |
| latest-mac.yml / latest.yml / latest-release.json | HTTP 200，v2.5.11，no-cache / must-revalidate |
| R2 与 GitHub 元数据 | 两个 latest YAML 的 SHA256 一致 |
| v2.5.11 CI | https://github.com/howtimeschange/crawshrimp/actions/runs/36520726473，R2 上传和验证成功 |
| mac ARM ZIP | 636,713,722 bytes；普通 GET 200，单段 Range 206 |
| mac Intel ZIP | 663,171,885 bytes；对象存在，单段 Range 可返回 206 |
| Windows x64 / ARM64 | 对象存在，单段 Range 206 |
| ZIP / blockmap 对象缓存 | immutable；大 ZIP 实测 cf-cache-status: BYPASS |
| 多段 Range | bytes=0-1023,2048-3071，curl 与隔离 ElectronHttpExecutor，代理及直连均返回 Cloudflare HTTP 400 |

隔离 Electron 网络复现（electron 43.1.0 / electron-updater 6.8.9）：系统代理单段 206 / 597ms，多段 400 / 1145ms；直连单段 206 / 599ms，多段 400 / 366ms。脚本使用独立 session 与临时 userData，首段数据后即 abort，未触碰当前应用缓存。

客户端证据：

- 实际安装应用和仓库的 app/src/updateService.js 在 generic feed 配置中均未设置 useMultipleRangeRequest: false。electron-updater 因此默认启用多段 Range。
- 当前本地 blockmap 对比生成 1,056 个差分操作，第一批中有 487 个下载段。默认路径会发多段 Range 请求。
- MacUpdater 差分失败后会尝试完整 ZIP 下载；不能仅凭差分 400 判定完整下载源失效。
- 点击下载先将 progress 置为 null，侧栏将其显示为 0%。检查期间 pending ZIP 曾从 0 增至 4,844,290、6,291,456 bytes；UI 仍显示 0%。随后 pending 文件已消失；没有执行缓存清理，也没有成功安装证据。
- 系统代理为本机 Clash；当时 updates 请求通过 Japan-Tokyo-AWS。单次直连完整 GET 探测在主动截断前收到约 21.3 MB / 10 秒，因此源站能持续发送文件。探测的 curl timeout 是诊断人为设置的上限，不是 Cloudflare 故障。
- builder-util-runtime 的超时依赖 ClientRequest 的 socket 事件；隔离 Electron 复现中，2 秒配置超时在 3.5 秒后仍未拒绝，也没有 socket 事件。
- 更新器内部日志未接入 desktop.log，主进程 stdout/stderr 为 /dev/null，缺少当前这次下载失败的原始错误。

建议修复顺序：

1. 对 R2 generic feed 设置 useMultipleRangeRequest: false，保留单段差分下载。
2. 增加应用层无进度超时、取消与重试逻辑，并记录更新器错误、回退和进度日志。
3. 区分准备差分、实际下载、回退完整下载、失败等状态，避免缺少进度时长期固定显示 0%。
4. 若仍有大文件下载速度问题，再评估安装包体积与 CDN 缓存；现有 ZIP 的 BYPASS 是性能线索，未证明它是此次卡住的原因。

临时升级入口：https://github.com/howtimeschange/crawshrimp/releases/tag/v2.5.11

权限边界：现有 Wrangler OAuth 可读取 R2 域名、bucket、域名状态和 Worker 路由；DNS 记录、WAF/rulesets、Page Rules 和部分 zone settings API 返回 403，因此没有声称已排除全部安全规则。

后续按用户要求完成了本地修复与回归，详见 [FIX-REGRESSION.md](FIX-REGRESSION.md)。上面的“只读检查”描述对应原始排查阶段。
