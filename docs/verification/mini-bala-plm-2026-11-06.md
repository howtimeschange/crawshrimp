# 迷你巴拉 PLM 尺码表导出验收

日期：2026-11-06（Asia/Shanghai）。适配包：`mini-bala-launch-assistant`，任务：`size_chart_downloader`。

## 实现范围

新增「迷你巴拉上新助手 → 迷你巴拉 PLM 尺码表批量导出」，沿用巴拉下载器参数结构、阶段选择、档差还原及 Excel 宽表/长表/错误表字段。

查询优先使用 `C8_Style_ProductCode` 精确匹配，成功无匹配才回退到款式名称并验证完整款号。重复款式不自动选取，分页重复报错。通过已确认的 Style URL 读取关联尺寸表，避免使用当前页面 URL 推断款式及递归父级链。网络异常、429、5xx 请求最多重试一次；单次请求 10 秒超时。

真实接口空结果为 `({Status:"Successful",NODES:"",HasMoreResults:"false",...})`。新脚本接受此格式，再运行名称兜底，不把它误报为接口故障。接口失败和空尺码表分别保留错误原因。

`core/api_server.py` 仅为新适配包加入既有 PLM 导出目录后处理与只读 CDP 恢复白名单；保留此前工作区已有的森马接入改动。本次未修改巴拉、森马及 PDF 下载脚本。没有推送或发布桌面新版本。

## 真实验收

在现有登录会话中使用项目 `core.js_runner.JSRunner.run_script_file` 运行新脚本全部 14 款，使用实际 `core.data_sink.export_excel` 和 `_finalize_plm_size_chart_downloader_outputs` 导出并复制到下载文件夹。未自行渲染或另做表格样式。

| 款号 | 结果 | 阶段 |
|---|---|---|
| 231127108201 | 成功 | 大货 |
| 231127103001 | 成功 | 大货 |
| 231127103002 | 成功 | 大货 |
| 236127133202 | 成功 | 大货 |
| 230127108201 | 成功 | 大货 |
| 230127121201 | 成功 | 大货 |
| 230127108202 | 成功 | 大货 |
| 230127103201 | 成功 | 大货 |
| 230127103202 | 成功 | 大货 |
| 236127137002 | 查询成功但当前账号可见范围内无匹配 | 未取得 |
| 236127137003 | 查询成功但当前账号可见范围内无匹配 | 未取得 |
| 236127137004 | 查询成功但当前账号可见范围内无匹配 | 未取得 |
| 236127137005 | 查询成功但当前账号可见范围内无匹配 | 未取得 |
| 236127137006 | 查询成功但当前账号可见范围内无匹配 | 未取得 |

结果：宽表 130 行，长表 707 行，错误表 5 行。837 条成功记录逐条与本次会话此前原下载器取得的 9 款数据比较（仅排除抓取时间），所有字段一致。此比较证明新旧输出一致，不构成对 PLM 原始业务数据的独立审计。

最终文件：`/Users/xingyicheng/Downloads/迷你巴拉PLM尺码表_大货_20261106-174425.xlsx`。已回读文件确认各页行数。

## 自动测试

- `node --test tests/mini-bala-size-chart-downloader.test.js tests/plm-size-chart-downloader.test.js tests/semir-size-chart-downloader.test.js`：27 项通过。
- `venv/bin/python -m pytest tests/test_mini_bala_manifest.py tests/test_plm_size_chart_export_dir.py tests/test_adapter_loader.py -q`：24 项通过。
- `node --check adapters/mini-bala-launch-assistant/size-chart-downloader.js`：通过。

覆盖产品编码查询、名称兜底、相似款号排除、重复款式、空结果、登录页、接口错误、瞬时重试、超时重试、分页、尺寸表归属、阶段回退、空尺码表拒绝、档差计算及原有巴拉/森马回归。通过实际 manifest 模型验证表单参数类型及 Excel 字段与原下载器一致。

## 当前边界

- 五款无匹配不等于款号不存在，不能确认是数据、权限还是其他业务对象问题。
- 之前旧脚本全批查不到的根因未确认，本次不声称已定位该历史问题。
- 当前运行的桌面程序是已打包旧后端，尚未升级。代码和源码运行已验证；新适配包的所选导出目录后处理需随本次后端改动一起部署，不能仅导入适配包就视作桌面版已完成更新。
