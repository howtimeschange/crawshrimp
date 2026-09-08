# Crawshrimp 仓库级 Code Review

后续状态：本报告记录审查时的问题；对应源码修复与验证见[修复记录](/Users/xingyicheng/Documents/crawshrimp/artifacts/code-review-fixes-2026-09-08.md)。下文行号及测试结果保留为审查时快照。

审查日期：2026-09-08。基线：`main`，HEAD `a427f3f5`（`fix: retry transient PLM CDP disconnects`），包括当前未提交的 Manifest v2、加载器、API 和 SDK 改动。以下问题针对当前工作区，不代表全部由这些未提交改动引入。

审查覆盖本地 API 鉴权与任务生命周期、Adapter 安装与声明校验、调度、SQLite 持久化、生图/视频执行与恢复、Chrome 页面选择、Electron IPC/导航、云端审批权限与租约、1XM 代理，并运行仓库测试与构建。业务 Adapter 以测试和关键调用链抽查覆盖，未逐行审阅所有业务脚本及第三方 vendor 文件。未运行真实平台写入、付费生成或生产部署。

发现 8 项可行动问题，其中 3 项 P1、5 项 P2。前 7 项已用临时目录、临时 SQLite 或模拟执行器复现；第 8 项来自实际测试失败。未修改业务代码。

## 1. [P1] 相同请求 ID 的并发生图没有实现幂等

位置：[core/ai_image_service.py:1270](/Users/xingyicheng/Documents/crawshrimp/core/ai_image_service.py:1270)，加锁写入位于同文件 1335 行附近。

`submit_workbench_batch` 从初始 job 快照检查 `request_uid`，但检查发生在 `_workbench_job_lock` 之外。两个相同请求都能先通过检查，随后各自生成随机 `batch_uid/run_uid`；进入锁后仅追加队列，没有重新检查请求 ID。FastAPI 的同步 batch-run 路由允许这种线程并发。

复现：两个线程提交相同 job 和 `request_uid`，模拟 Provider 收到 **2 次创建请求、2 个不同幂等键**，SQLite 保存 **2 条 run**。Provider 侧也无法按不同键去重，网络重发或并发调用可能重复生成和计费。

建议：在同一临界区内检查最新状态并预留请求；最好以数据库唯一键约束 job/request ID。后续重试复用同一批次和 Provider 幂等键。

## 2. [P1] 轮询网络故障被当成远端生图失败，恢复后无法获取原结果

位置：[core/ai_image_service.py:1050](/Users/xingyicheng/Documents/crawshrimp/core/ai_image_service.py:1050)。关联：`refresh_workbench_run_once` 1108 行附近、`retry_workbench_run`。

`get_task` 的短重试耗尽后，即使抛出 `RetryableOneXMImageError`，这里仍将本地 run 和 Provider 状态都写成 `failed` 并退出。远端任务可能一直正常运行。刷新函数又跳过全部 failed run；用户点击重试会创建新的远端任务。

复现：模拟轮询暂时不可达，run 变为 `failed`；恢复 Provider 后调用指定 run 的刷新，Provider 查询次数仍是 **0**。

影响：已付费生成的结果不再被自动取回，用户重试还可能再次计费。建议区分“状态暂时未知”和“Provider 已确认失败”，保留任务 ID、按退避继续查询，避免将传输异常写为 Provider 终态。

## 3. [P1] Adapter 安装先删除旧目录，更新失败会丢失可用版本

位置：[core/adapter_loader.py:379](/Users/xingyicheng/Documents/crawshrimp/core/adapter_loader.py:379)。

安装直接删除目标目录，再 `copytree` 或创建符号链接，没有暂存目录和回滚。复制遇到磁盘空间、权限或文件读取错误时，旧版本已经消失。若用户选择当前已安装目录作为安装来源，`src == dest`，代码会先删除来源，再抛 `FileNotFoundError`。

复现：模拟 copytree 报磁盘错误后，旧安装目录不存在；对已安装目录执行重新安装，同样删除来源并失败。

建议：拒绝或安全处理源/目标相同及包含关系；在同级临时目录完成复制与校验后切换，保留可回滚旧目录，最后更新内存和安装元数据。

## 4. [P2] 定时触发的任务没有停止/暂停控制

位置：[core/api_server.py:12974](/Users/xingyicheng/Documents/crawshrimp/core/api_server.py:12974) 和 [core/api_server.py:13019](/Users/xingyicheng/Documents/crawshrimp/core/api_server.py:13019)。

Manifest 调度与持久化任务计划都直接调用 `_execute_task(..., run_control=None)`，没有像手动运行一样建立 `_run_controls` 和 task handle。暂停、继续、停止接口却必须找到这些控制对象才接受操作。

复现：模拟一个已经开始执行的定时任务，调用停止方法返回 **409“任务当前未在运行，无法停止”**，执行协程仍然存活。

建议：让调度入口复用统一的可控任务启动/清理流程，保持调度器等待任务完成的语义；同步注册任务级和实例级控制，验证暂停、停止及部分结果保存。

## 5. [P2] 任务改为手动后，旧定时器仍在自动执行

位置：[core/scheduler.py:128](/Users/xingyicheng/Documents/crawshrimp/core/scheduler.py:128)。

`register_adapter` 只在注册新的 interval/cron job 时删除同名旧 job。任务变为 manual、增加无默认值的必填参数，或者从新 manifest 中移除时，旧 job 都不会被清理。安装接口会直接再次调用该函数。

复现：先注册一个 interval 任务，再以相同 adapter/task ID 注册 manual 版本，调度器仍保留 **1 个 interval job**。

影响适用 interval/cron 的自定义 Adapter；本次未在随仓 manifest 中发现这两类触发器。建议按 adapter 对完整任务集合做调度差异更新，删除已取消、不再自动执行或不再满足运行条件的 job。

## 6. [P2] 页面域名校验可被字符串前缀绕过

位置：[core/api_server.py:1797](/Users/xingyicheng/Documents/crawshrimp/core/api_server.py:1797) 和 [core/browser_session.py:31](/Users/xingyicheng/Documents/crawshrimp/core/browser_session.py:31)。

URL 尚未解析就用 `url.startswith(prefix)` 返回成功。当配置前缀是不带尾斜杠的站点 origin 时，`https://agentseller.temu.com.attacker.invalid` 会被认为匹配 `https://agentseller.temu.com`。后面的 hostname 比较没有机会执行。Temu 默认入口确实存在这种配置形式。

复现：API 和 browser_session 两份匹配实现对此均返回 **True**。

影响条件：浏览器中存在这种页面并被当前页面/probe 选择流程使用。脚本及注入的任务参数可能进入错误页面；这不是远程无条件执行漏洞。建议统一 URL 匹配实现，先验证协议、主机和端口，再比较路径，保留必要的显式 Temu 区域域名规则。

## 7. [P2] 重启清理只更新运行记录，任务实例永久显示运行中

位置：[core/data_sink.py:2303](/Users/xingyicheng/Documents/crawshrimp/core/data_sink.py:2303)。启动调用位于 `core/api_server.py:9151`。

`stop_orphaned_active_runs` 仅更新 `task_runs`，没有同步关联 `task_instances` 的 status、summary 和完成时间。常规停止路径会同步这些字段，但进程崩溃不会经过该路径。

复现：创建 running 实例及关联 running run，执行启动清理后，run 为 **stopped**，实例仍为 **running**。任务中心依赖实例状态，会继续把它统计为活跃任务，而实际 worker 已不存在。

建议：事务内同步受影响的当前实例，记录重启原因和终态；通过 last_run_id 等关系限制更新范围，避免旧 run 覆盖实例的新运行状态。

## 8. [P2] Runner 接口变更使生命周期回归测试提前退出

位置：[tests/test_api_task_lifecycle.py:1625](/Users/xingyicheng/Documents/crawshrimp/tests/test_api_task_lifecycle.py:1625)，同文件多处 FakeRunner 存在相同签名。调用方：[core/api_server.py:8722](/Users/xingyicheng/Documents/crawshrimp/core/api_server.py:8722)。

生产调用现在传入 `retry_transient_cdp_errors`，但测试替身只接受 `script_path/params/control_hook`。因此 12 项用例直接抛 TypeError，另 1 项取消收尾测试因为没有进入目标路径而断言失败。这不能作为生产 JSRunner 存在相同错误的证据，因为真实实现已经支持该参数。

建议：更新或集中维护 FakeRunner 的接口，使取消、导出、跳转恢复等用例重新执行其实际断言；不要简单跳过这些测试。桌面构建 CI 会运行 Python 测试，因此当前基线无法通过完整测试门禁。

## 验证记录

测试与复现只使用本地测试数据、模拟 Provider 和临时目录。结果以本次实际命令输出为准；不会将本地通过解释为平台提交或 Provider 结果已验证。

| 检查 | 结果 |
| --- | --- |
| Electron/renderer：`npm --prefix app test` | 467 通过 |
| Adapter JavaScript：`node --test tests/*.test.js` | 1292 通过 |
| 云端审批台：`npm --prefix cloud/approval-workbench run check` | 类型检查通过；237 测试通过；构建通过 |
| 1XM 代理：`node --test cloud/one-xm-proxy/test/*.test.mjs` | 9 通过 |
| 桌面前端：`npm --prefix app run vite:build` | 通过，有 chunk 大小警告 |
| Python unittest discover | 1045 项：1031 通过、12 error、1 failure、1 skipped |
| Python pytest（CI 同类入口）：`PYTHONPATH=. venv/bin/python -m pytest tests -q` | 1198 通过、13 失败、1 跳过；另有 49 个 subtest 通过。失败均在生命周期测试，根因见第 8 项 |
| `git diff --check` | 通过 |

原有 11 个已跟踪文件的未提交改动保持原状。未提交 Git、推送或部署。本次仅新增本审查报告。
