# 性能探查报告修复与复测

日期：2026-09-15。对应 [原始探查报告](REPORT.md) 的 R1–R5。本次本地提交仅包含性能修复、相关测试与复测记录，保留原有其他改动；未推送或发布。

## 修复内容

| 问题 | 实际改动 |
|---|---|
| R1 全量状态保存阻塞选择 | 将注册表读取、完整快照构建和 localStorage 序列化整体延后至最后一次变化后 600ms，合并连续操作。工作区切换、视图停用/卸载、beforeunload 同步刷新本机缓存；保留 manifest 保存和失败提示。 |
| R2 主线程同步遍历 | 新增 directoryScanWorker.js，通用目录和 AI 视频目录扫描移入 Worker。流式读取目录，默认最多枚举 100,000 项（硬上限 200,000，包含被过滤项）、默认 15 秒遍历预算、35 秒服务超时，最多并发 2 个扫描。通用 IPC 支持取消、新扫描替换旧扫描及窗口销毁取消。AI 视频文件的路径校验和元数据读取也在 Worker 完成。 |
| R3 缩略图积压 | 保持默认并发 2，等待队列上限 64；按路径、文件版本、尺寸、质量合并同一作用域中的在途请求。新增按窗口/视图代次取消，涵盖工作区、款号/来源/显示方式切换及视图退出；可见项优先。取消时也覆盖正在 stat 的请求。保留坏图拒绝，不再回退加载整张原图充当缩略图。 |
| R4 PDF 临时目录累积 | 返回自包含 data URL 页，清空临时 preview_path；渲染成功和失败均通过 finally 回收目录。界面框选与翻页使用 data URL，不依赖临时路径。清理超过 24 小时的旧预览目录；显式关闭 Worker 时等待已接受的渲染完成清理。 |
| R5 Windows 断言 | Windows rootIdentity 预期转为小写；保留其他平台大小写语义。 |

R1 合并后仍会执行一次完整快照，深度监听与大图库初始化成本仍存在。R3 保留每个独立解码任务一个 Python 子进程，未引入常驻解码服务；相同版本的并行请求已经合并，队列资源受到限制。

## 最终验证

### Windows ARM / 4 vCPU / 8GB，Electron 43.1.0 x64

沿用原报告的虚拟机和真实 Vue 组件探针，5,000 张合成图库，连续选择 30 次，间隔 200ms：

| 指标 | 原报告 | 本次最终复测 |
|---|---:|---:|
| 选择中位数 | 113.1ms | 73.0ms |
| 选择 p95 | 139.2ms | 87.6ms |
| 选择最大值 | 166.5ms | 93.7ms |
| 30 次选择新增完整状态写入 | 30 | 1 |
| Vue 错误 | 0 | 0 |

退出前主动触发 beforeunload，保存选中数量与界面均为 1。注入 localStorage 与 manifest 保存失败后，界面明确显示“恢复信息保存失败”。

20,000 文件最终扫描：1115.6ms，64 次定时心跳，最大心跳间隔 21.0ms；原报告该扫描期间心跳为 0。

Windows 定向测试 21/21 通过：含队列满时拒绝、重复合并、取消后新任务、坏图、真实 PNG/JPEG/WebP/GIF 解码、PDF 多页与资源边界、PDF 成功/失败回收、跨平台路径和目录扫描。最终目录流式读取改动又单独通过扫描回归。所有最终客体进程退出码已读回，均为 0。

### macOS 宿主

- 定向回归 144/144 通过；真实媒体/目录集成 3/3 通过；最终流式扫描回归另行通过。
- 最终组件探针：5,000 张、30 次选择，1× p95 36.3ms，4× p95 104.4ms；均合并成 1 次保存，恢复状态一致、失败提示可见。
- 原媒体探针重跑：5 次 PDF 成功、2 次资源限制拒绝，最终残留目录为 0（原报告为 5）；损坏图片明确拒绝。
- 完整应用 Vite 生产构建与探针构建通过；保留现有大包体积警告。main/preload 语法检查及 git diff --check 通过。

## 验收边界

这是源代码修复、真实模块测试和真实 Vue/Electron 组件实测。图库元数据、图片与 IPC 仍使用原报告合成夹具；Windows 仍为 ARM 转译、Session 0。没有将其等同 Intel i3 实机、完整客户端业务、发行包安装、真实大图同时解码或 8 小时耐久验收。4× 降速下仍超过 100ms，不能宣称所有低配场景已流畅。

PDF 框选继续使用完整的内存页图；正在执行的解码不强杀，完成后回收临时文件。进程被强制结束时产生的旧目录由后续预览的 24 小时清理处理。

## 证据

- [Windows 最终组件与失败反馈](evidence/final-ui-windows.log)
- [Windows 21 项测试](evidence/final-tests-windows.log)
- [Windows 最终扫描](evidence/final-scan-windows.log)、[最终扫描回归](evidence/final-scan-tests-windows.log)、[退出码](evidence/final-windows-exits.json)
- [宿主组件与失败反馈](evidence/fixed-ui.log)、[144 项回归](evidence/fixed-regression.log)
- [真实媒体集成](evidence/fixed-media-tests.log)、[PDF 重复预览探针](evidence/fixed-media.jsonl)
- [最终扫描](evidence/fixed-scan.jsonl)、[完整应用构建](evidence/fixed-app-build.log)

复跑入口：ui/build.mjs、ui/run-fixed.cjs、ui/run-final-windows.cjs、probe-fixed-scan.cjs；模块回归在 app/src/directoryScanWorker.test.js、localImageThumbnail.test.js、mediaPreview.integration.test.js、balaWorkspaceFiles.test.js。
