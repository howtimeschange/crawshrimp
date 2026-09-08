# Crawshrimp：8 项审查问题修复记录

日期：2026-09-08。修复基于当前 `main` 工作区，保留已有 Manifest v2、SDK 和产品文档的未提交改动。本次交付范围为本地源码；没有推送、发布或重启运行中的应用。提交信息以 Git 日志为准。

## 修复结果

| 原问题 | 已实现的修复 | 回归验证 |
| --- | --- | --- |
| 相同请求重复生图 | 在同一任务锁内重新检查最新 request ID，再登记批次；重复调用返回已有批次 | 强制两个请求同时通过初始检查，验证 Provider 仅收到 1 次创建，数据库仅保留 1 条 run |
| 轮询断网被判永久失败 | 查询异常保留远端任务句柄与当前状态，记录经过脱敏的查询错误，按 5–60 秒退避查询；主动刷新也能恢复原任务 | 模拟连续断网再恢复，确认拿到原任务结果，未创建新任务 |
| 安装失败丢失旧 Adapter | 先暂存并校验新版本，再备份旧目录、切换安装和原子更新元数据；失败恢复旧目录。拒绝源/目标重叠 | 分别注入复制、校验、目录切换和元数据写入故障，检查旧文件与元数据完整；检查 copy/link 安装及 link 转 copy |
| 定时任务无法停止 | 与手动任务共用任务句柄、运行控制、锁和清理流程；调度器等待任务及取消收尾完成 | Manifest 和持久化计划两条路径均验证暂停、继续、停止、清理等待、退出及控制释放 |
| 旧定时器继续执行 | 注册新 manifest 前清除该 Adapter 原有 job 和回调，再按当前声明注册 | 手动化、删除任务、增加必填参数、缺失 cron 四种情况均清除旧 job，其他 Adapter 不受影响 |
| 仿冒域名绕过检查 | API 和浏览器会话共用 URL 解析器；检查协议、真实主机、端口，再匹配路径。Temu 兼容分支也遵守这些规则 | 检查仿冒域名、userinfo、非默认端口、端口 0、协议变化、畸形 URL；保留合法 Temu 区域页面兼容 |
| 重启后任务实例仍运行 | 同一 SQLite 事务更新当前运行记录和关联实例；保留已有摘要与完成时间，不覆盖新一代运行或已完成实例 | 检查状态一致、重复清理幂等、旧 run 不覆盖新状态；也修复旧版本遗留的“run 已停止、实例仍运行”记录 |
| 13 项生命周期测试报错 | 更新所有受影响的 FakeRunner 和独立模拟函数，显式支持新增的重试控制参数 | 原先失败的取消、导出、页面恢复等用例重新执行并通过 |

## 主要代码入口

- [生图并发去重](/Users/xingyicheng/Documents/crawshrimp/core/ai_image_service.py:1278)
- [查询故障处理](/Users/xingyicheng/Documents/crawshrimp/core/ai_image_service.py:1008)
- [Adapter 安装与回滚](/Users/xingyicheng/Documents/crawshrimp/core/adapter_loader.py:346)
- [统一定时执行控制](/Users/xingyicheng/Documents/crawshrimp/core/api_server.py:12975)
- [定时器重新注册](/Users/xingyicheng/Documents/crawshrimp/core/scheduler.py:116)
- [统一页面匹配](/Users/xingyicheng/Documents/crawshrimp/core/url_matching.py:6)
- [重启状态修复](/Users/xingyicheng/Documents/crawshrimp/core/data_sink.py:2300)
- [新增回归测试](/Users/xingyicheng/Documents/crawshrimp/tests/test_review_regressions.py)

新增 39 项回归测试。生图使用模拟 Provider，安装和状态测试使用临时目录及 SQLite，不触发真实业务提交或付费生成。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `PYTHONPATH=. venv/bin/python -m pytest tests -q -rs` | 1250 通过、1 跳过，另有 49 个 subtest 通过；跳过项因 Amazon 标签样例文件不存在 |
| `npm --prefix app test` | 467 通过 |
| `node --test tests/*.test.js` | 1292 通过 |
| `npm --prefix cloud/approval-workbench run check` | 类型检查通过；237 测试通过；构建通过 |
| `node --test cloud/one-xm-proxy/test/*.test.mjs` | 9 通过 |
| `npm --prefix app run vite:build` | 通过；仍有原有的 chunk 大小警告 |
| 最后一次 URL/任务控制相关定向验证 | 111 通过 |
| 独立提交快照（排除原有 Manifest v2 改动） | 146 通过，另有 8 个 subtest 通过 |
| Python 语法检查、`git diff --check` | 通过 |

测试隔离修正：首次新增安装测试只替换了 data_root，而 Adapter 子目录走独立路径选择，导致生成的 `review-demo` 测试包短暂落入默认运行目录。已核对其 pytest 临时来源，精确清除测试包和对应元数据并确认不存在；随后通过显式 CRAWSHRIMP_DATA 和禁止回退修正隔离，重新验证。未改动其他已安装 Adapter。

修复目前存在于源码工作区。尚未验证打包后的 macOS/Windows 安装器或真实 Provider/业务平台；本地测试通过不代表已部署或已在运行中的应用生效。
