# 自动更新下载修复与回归 · 2026-10-10

本地修复已完成，回归通过。原始排查记录见 [REPORT.md](REPORT.md)。Cloudflare/R2 配置和线上更新对象没有改动。

修复针对两项已复现的问题：generic 更新源默认多段 Range 请求与 R2 不兼容，以及 Electron 请求没有 socket 事件导致上游超时机制无效。单段差分下载仍然保留。

- generic feed 显式设置 `useMultipleRangeRequest: false`，GitHub 检查回退保留。
- 请求在等待响应头及接收数据期间，连续 120 秒没有数据会取消并返回可重试错误；收到数据重新计时，本地复制和校验阶段不计网络超时。
- 失败、退出时取消旧请求，等待下载调用结束后再允许新尝试；重复点击共用同一尝试，后台检查不会覆盖下载状态。
- 无进度时显示“准备下载”，真实进度 0% 仍显示 0%；更新器、错误和阶段进度写入 `desktop.log`。
- 手动重定向中旧请求的 abort 只清理计时器，避免破坏 GitHub 下载重定向。

最终验证结果：

| 验证 | 结果 |
| --- | --- |
| `cd app && npm test` | 526 通过；0 失败、0 跳过，47.3 秒 |
| `node --test tests/desktop-auto-update.test.js` | 24 通过；0 失败、0 跳过 |
| service / transport / updateDisplay 聚焦回归 | 46 通过 |
| `cd app && npm run vite:build` | 成功；保留已有 bundle 大小提示 |
| JavaScript 语法 / scoped `git diff --check` | 通过 |
| 隔离 Electron 本地网络回归 | 单段差分重建与完整下载 SHA512 通过，进度达到 100% |
| 隔离 Electron 超时与重试 | 首次静默请求取消并进入 error；迟到事件不覆盖状态；再次下载成功，进入 ready-to-install |
| 经生产 transport guard 的 HTTP 302 下载 | 跳转后完整下载与 SHA512 校验通过 |
| 线上 R2，系统代理 / 直连 | 单段均 206，多段均 400 |

本地差分回归的两个真实请求为 `bytes=4-7` 和 `bytes=12-15`，重建文件与期望内容一致。provider 参数从真实 `createUpdateService` 捕获，旧代码若没有禁用多段请求，此回归会失败。

线上复测对象为 `https://updates.crawshrimp.com/crawshrimp-v2.5.11-mac-arm64.zip`。系统代理和直连的单段请求均返回 `Content-Range: bytes 0-1023/636713722`；只接收首块数据后主动终止。四个请求没有超时或网络错误。该探测未下载整个安装包。

可复查证据：

- [Electron 本地网络回归 JSON](electron-local-final.json)
- [线上 Range 复测 JSON](electron-live-final.json)

完整测试与构建日志保留在本地同目录的 `app-tests-final.log`、`root-update-tests-final.log`、`focused-tests-final.log`、`renderer-build-final.log`，按仓库忽略规则不纳入 Git。

复跑入口为 `cd app && npm run test:update-download`，线上小请求探测为 `npm run test:update-download:live`。脚本使用独立临时 userData、session 和测试文件，不触碰已安装应用的更新缓存；无显示器的 Linux 环境需要 `xvfb-run`。

修复按用户要求保存为本地 Git commit，未推送或发布新版本，也没有替换 `/Applications/抓虾.app`。已安装的 v2.5.7 不会因工作区代码修改而自动获得修复；修复需要进入后续桌面构建并发布。本轮未执行签名安装包的真实升级安装或 Windows 原生安装验收，因此不声称已验证完整升级安装流程。
