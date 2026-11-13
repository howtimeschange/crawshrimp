# 巴拉鞋品图包命名复测

2026-11-13，本地代码修改与导出复测已完成。

## 代码现状与修改

- 入口为 `adapters/shenhui-new-arrival/prepare-shoe-upload-package.js`，后端由 `core/api_server.py` 调用鞋品图包整理。
- 实际文件名由 `core/shenhui_shoe_packaging.py` 的 `output_filename()` 生成，`build_output_assignments()` 生成路径，`prepare_shoe_packages()` 写入图片与结果报告。

| 位置 | 修改前 | 修改后 |
| --- | --- | --- |
| 款号根目录 | tmz (1)～(5).jpg | yz (1)～(5).jpg |
| 各颜色目录 | wpz (1)～(4).jpg | yw (1)～(4).jpg |
| 各颜色目录 | wpz (15)、(16).jpg | yw (5)、(6).jpg |

内部选图槽位继续使用 tmz/wpz，输出文件名前缀映射为 yz/yw。成品文件识别同时支持新旧前缀，供原图保留流程判断。

## 示例复测

使用本地真实原图和历史已验证选图、OCR 结果，分别调用修改前后 `prepare_shoe_packages()` 完整导出。此次复测覆盖命名与导出流程。

| 款号 | 品类 | 文件数 | 改名数 |
| --- | --- | --- | --- |
| 204426146028 | 婴童 | 46 | 11 |
| 204426146120 | 婴童 | 44 | 11 |
| 204426141119 | 休闲 | 46 | 11 |
| 204426140134 | 运动 | 119 | 23 |
| 204426140035 | 运动 | 47 | 11 |
| 204426140041 | 运动 | 86 | 17 |

- 合计 6 款、9 个款色组，每版 388 个文件，其中 84 个文件完成前缀改名。
- 388 对文件 SHA256 全部一致，修改后全部图片完整解码通过。
- 两版结果报告逐行核对款号、颜色、来源文件、规则槽位及下载结果，通过。
- 修改后图包的文件名检查通过，全部目标文件与对照清单逐一匹配。

## 回归验证

- 修改前鞋品打包模块 193 passed，9 subtests passed。
- 修改后鞋品打包模块 194 passed，24 subtests passed。
- 鞋品相关 Python 回归 621 passed，129 subtests passed。
- 前端采集脚本回归 7 passed。
- 最终命名专项 2 passed，15 subtests passed。

## 文件

- [修改前图包](before/)
- [修改后图包](after/)
- [逐文件前后对比](comparison.csv)
- [结构化核验结果](summary.json)
- [复测脚本](retest.py)

正式源码 `9411fdd50` 已同步至 GitHub，v2.5.16 发布完成。main 与标签构建均成功，正式 Release、desktop-latest 和 R2 更新源已核验。

## 序号修正复测

按用户确认，原序号 15、16 对应新序号 5、6，颜色目录输出 yw (1)～(6).jpg。前一版结果保存在 after/，最终结果与新增对比证据保存在 revision-2/。

最终复测覆盖 6 款、9 个款色组，388 对文件 SHA256 一致。相对前一版，共 18 个文件由 yw (15)/(16) 改为 yw (5)/(6)。鞋品回归 621 passed、129 subtests passed。

- [最终图包](revision-2/after/)
- [原始命名至最终命名对比](revision-2/comparison.csv)
- [15/16 至 5/6 对比](revision-2/numbering-comparison.csv)
