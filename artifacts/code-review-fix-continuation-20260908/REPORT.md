# Code Review 续审：5 项问题修复记录

日期：2026-09-08。基于 `main@6968cc22`，本次交付为本地 Git 提交，实际 SHA 以 Git 日志为准。未推送、部署或重启用户正在使用的应用。

## 修复结果

| 问题 | 当前行为 | 验证 |
| --- | --- | --- |
| 页面上下文销毁重放写入阶段 | navigation、transport 和 timeout 的阶段重放都要求显式只读契约；普通写入保留“结果待核实”提示 | 4 种导航错误分别验证写入只执行 1 次、只读允许恢复；原有 PLM 与阶段测试通过 |
| 生图回执丢失后换键重复提交 | 网络提交前持久化代次、幂等键和提交时间；明确 HTTP 拒绝与回执未知分开。未知结果禁止手动重试，UI 显示“提交结果待核实”并隐藏重试按钮 | 模拟首次已接受但回执丢失，远端创建数保持 1；自动重试中的回执丢失同样禁止再次换键；明确拒绝仍可正常重试 |
| 云端取消/续租失败只在整批结束检查 | ContextVar 隔离检查，逐款和浏览器操作前检查；天猫上传/创建/上线脚本内部通过 CDP binding 在每次后续请求前向主进程检查。续租与错误发布受同一锁保护 | 并发取消和租约错误均阻止后续写入；真实隔离 Electron 执行实际天猫脚本，第一张上传回执保留、第二张没有发送 |
| 旧生图响应覆盖 completed | 状态更新校验代次、task_id、poll_url 与请求快照；拒绝旧响应及普通终态回退。重试先原子登记新代次，再发送请求 | 强制旧 running 响应晚于 completed；旧任务响应不能覆盖新句柄；两个并发手动重试仅创建 1 个新任务 |
| 生图重启后不再查询远端 | 生命周期启动有界查询恢复，按 job/run 去重 poller；停止时中断等待。恢复扫描不受 UI 历史列表 500 条上限影响，无句柄的孤儿提交转为结果未知 | 两个独立 Python 进程复用临时 SQLite：前进程提交并退出，后进程启动 worker 取回同一 task_id；本地假 Provider 总 POST 数为 1 |

恢复验证还发现并修复了相关的相对轮询地址问题：`/images/tasks/id` 之前会再次被加上 `/images/tasks/`。现在完整 URL、相对路径、裸 task_id 都能正确查询。

## 代码入口

- [执行器重放控制与浏览器内检查](/Users/xingyicheng/Documents/crawshrimp/core/js_runner.py:487)
- [上下文隔离的执行检查](/Users/xingyicheng/Documents/crawshrimp/core/execution_checkpoint.py)
- [生图提交登记、状态竞争控制](/Users/xingyicheng/Documents/crawshrimp/core/ai_image_service.py:976)
- [生图重启恢复](/Users/xingyicheng/Documents/crawshrimp/core/ai_image_service.py:1312)
- [云端租约与取消检查](/Users/xingyicheng/Documents/crawshrimp/core/cloud_job_executors.py:427)
- [新增 25 项回归用例](/Users/xingyicheng/Documents/crawshrimp/tests/test_review_continuation_regressions.py)

## 验证结果

下表详细日志保留在本地同目录，不纳入本次 Git 提交；验证摘要、回归测试和 Electron 冒烟脚本随修复提交。

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Python 全套 | 1268 passed、1 skipped，另 49 subtests passed | [python-final.log](./python-final.log) |
| 执行器、云任务、生图与天猫链路定向回归 | 154 passed，另 4 subtests passed | [focused-final.log](./focused-final.log) |
| 根目录 Node/Adapter 全套 | 1301 passed | [node.log](./node.log) |
| Electron/桌面模块测试 | 474 passed | [app.log](./app.log) |
| 桌面 Vite 构建 | 通过，有既有大 chunk 警告 | [build.log](./build.log) |
| 实际天猫脚本 + 隔离 Electron/CDP | 第一条回执保留，后续请求被阻止 | [checkpoint-electron-final.log](./checkpoint-electron-final.log) |
| 最后一次天猫 Node 定向检查 | 182 passed | [tmall-final.log](./tmall-final.log) |
| `git diff --check` | 通过 | 终端读回 |

Python 使用独立 CRAWSHRIMP_DATA、禁用回退和临时 SQLite。重启测试的 Provider 是本机临时 HTTP 服务；Electron 使用临时用户目录和隐藏窗口，平台请求由页面内测试替身处理，没有打开或操作用户 Chrome，也没有真正上传到天猫或调用付费生图。

第一次真实浏览器测试暴露了 Runtime binding 需要先启用 Runtime domain 的问题，修正后已验证。全套组合测试也检查出了测试间停止事件残留，以及续租响应到错误发布之间的并发窗口；分别补齐测试隔离和生产同步边界。上表最终验证覆盖这些修正。

当前未知提交会保持可见的待核实记录，不会尝试猜测远端是否已创建任务；查不到句柄时需要人工核实 Provider。没有做 Windows 原生安装器、真实业务平台或付费 Provider 验收。本次不包含对历史线上数据的自动回填。
