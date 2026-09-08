# 撤回 Manifest V2 后的深绘专项验证

2026-09-08；源码 HEAD：17337df0。

结论：本轮专项回归与本地完整任务验证通过，未发现撤回未提交 Manifest V2 实现破坏深绘原执行链路。深绘已提交的 Manifest、五份任务脚本以及原有后端处理逻辑均保留，不需要追加业务代码修复。

## 覆盖与结果

| 范围 | 验证结果 |
| --- | --- |
| 保留的真实深绘 Manifest | 原加载器读取成功；任务列表包含全部五项；五项启动检查通过（启动检查时截获后台业务启动） |
| 吊牌/洗唛/平铺图下载 | 对应 JS 测试通过；素材选择、款色隔离、后端 OCR 筛选与文件归档回归通过 |
| 服饰上新图包 | 对应 JS 测试通过；服饰标签处理、压缩和后处理回归通过 |
| 鞋品上新图包 | 对应 JS 测试通过；鞋品规则、模型共识、OCR、命名与重跑校验回归通过 |
| 上传深绘 | JS 测试覆盖任务初始化、批量搜索、选择商品、弹窗、执行模式及启动上传；未进行真实线上上传 |
| PDF 批量截图 | JS 与 Python 回归通过；另执行真实任务编排、本地 PDF 渲染、ZIP/Excel 生成和 SQLite 结果读回 |

- Python 深绘/OCR 专项：370 passed，5 subtests passed；无跳过项。存在已有 Pillow/SWIG 弃用提示。日志：python.log。
- 五份深绘 JS 测试：44 passed，无失败或跳过。日志：scripts.log。
- 原加载器、任务生命周期和 JSRunner：上一轮撤回后已有 115 项通过，本轮未再次修改对应代码。
- 保留的深绘包级验收脚本：JSON ok:true。
- git diff --check：通过。深绘及关键执行代码与 HEAD 比对无差异。

## 本地完整链路

local_pipeline_smoke.py 使用隔离的数据目录及两份生成的样例 PDF，执行原有 api_server._execute_task 和 JSRunner。浏览器传输边界由 Node VM 与 about:blank 标签页替身代替；真实执行深绘 PDF JS，未伪造脚本业务返回值。加载器、任务编排、PDF 渲染、ZIP、Excel 和 SQLite 都使用实际实现。

结果见 local-pipeline-result.json：

- 五项任务均被加载并通过启动检查。
- pdf_batch_screenshot 状态 done，records_count=2。
- ZIP 完整性检查通过，包含 yq(1).png 和 yq(2).png，两张均能解码为 800×800。
- Excel 实际两行数据，处理状态均为“截图完成”。

## 验证边界

当前原加载器保留任务、参数、触发与输出等既有字段，未使用的额外 V2 声明不会阻止深绘加载；执行仍通过原 JS 动作与专用后端调用完成。

本轮验证的是撤回后的源码、离线回归和本地文件处理链路。浏览器/远程接口及模型调用在测试中使用替身；未据此宣称真实网盘登录、线上页面、远端模型或正式上传已验证。未发起线上业务写入或部署。

## 复现

在仓库根目录、已安装项目 Python 依赖和 Node 的环境中运行：

```bash
PYTHONPATH=. venv/bin/python artifacts/shenhui-rollback-regression-20260908/local_pipeline_smoke.py
```

脚本在自身目录下生成隔离数据库、样例 PDF、截图包、结果表和 local-pipeline-result.json。数据库、日志与生成文件仅保留在本地，不纳入本次提交。
