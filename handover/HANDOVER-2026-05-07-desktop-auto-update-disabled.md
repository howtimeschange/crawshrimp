# HANDOVER-2026-05-07-desktop-auto-update-disabled

## 背景

- macOS 桌面端 `electron-updater` / ShipIt 自动更新在正式 release 上报签名校验错误：
  `code has no resources but signature indicates they must be present`
- 本地构建产物可见 `Apple Development` 签名，但发布给 GitHub Release 的更新包不满足自动更新分发要求。
- 当前仓库和 CI 里也没有完整的 `Developer ID Application + notarization` 链路。

## 本次处理

- 暂时移除桌面端应用内自动更新逻辑，避免继续向用户暴露不稳定能力。
- 删除主进程 `electron-updater` / `updateService` 接线。
- 删除 `preload` 中的更新 IPC 暴露。
- 删除设置页“自动更新”面板和顶部更新提示入口。
- 构建配置不再产出 macOS `zip` / `latest-mac.yml`，Windows 也不再上传 `latest.yml` 元数据。
- CI / release 文案改为说明“自动更新元数据已关闭”。

## 恢复条件

- Apple Developer Program 发布证书就绪。
- CI 能安全导入 `Developer ID Application` 证书。
- macOS 构建启用 hardened runtime。
- notarization 与 staple 流程打通。
- 重新验证 GitHub Release 上真实 `zip` 更新包的 `codesign --verify` / ShipIt 安装链路。

## 回归检查

- `tests/desktop-auto-update-disabled.test.js` 约束仓库中不再暴露自动更新运行时和打包元数据。
