# Temu 活动数据脚本验收通过记录

时间：2026-04-13  
范围：`temu/activity_data` 跨站点参数保持、分页续跑、真实 UI 回归

## 本轮结论

`Temu 运营助手 -> 后台-活动数据` 已完成本地前后端开发环境启动后的真实回归验证，可作为当前可交付版本。

本轮不是只跑单元测试，而是包含：

- 本地后端服务启动
- 本地 Vite / Electron 开发环境启动
- 真实 Temu 页面运行
- 导出 Excel 结果校验

## 关键修复

### 1. `activity-data.js`

文件：

- `/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/activity-data.js`

核心修复：

- 把用户请求参数固化进 `shared`
  - `requestedOuterSites`
  - `requestedActivityType`
  - `requestedActivityTheme`
  - `requestedSpuIdQuery`
  - `requestedStatDateRange`
- 所有 `next_phase / cdp_clicks / reload_page / complete` 都统一回写合并后的 `shared`
- 移除跨站点切换后过严的筛选面板稳定性拦截，避免美区误失败

### 2. `js_runner.py`

文件：

- `/Users/xingyicheng/lobsterai/project/crawshrimp/core/js_runner.py`

核心修复：

- 翻页续跑时保留上一页 `shared`
- 修复原先进入下一页后 `shared = {}` 被重置的问题

这也是此前出现以下问题的根因：

- 后续站点丢失用户设定的时间范围
- 站点切换后参数回退到页面默认值
- 多站点结果不稳定

## 回归测试

通过的自动化测试：

- `node --test tests/temu-activity-data-regression.test.js`
- `python3 -m unittest tests.test_js_runner`

新增 / 更新测试文件：

- `/Users/xingyicheng/lobsterai/project/crawshrimp/tests/temu-activity-data-regression.test.js`
- `/Users/xingyicheng/lobsterai/project/crawshrimp/tests/test_js_runner.py`

## 真实 UI 验证

本轮真实 UI 验证使用：

- 前端：`http://127.0.0.1:5173`
- 后端：`http://127.0.0.1:18765`
- Electron 开发壳：本地 `app` 开发环境

真实运行任务：

- `Temu 运营助手 -> 后台-活动数据`

本轮由 UI 发起的最终成功运行：

- 运行时间：`2026-04-13 10:33:11` 到 `2026-04-13 10:34:27`
- 记录数：`1228`
- 导出文件：
  - `/Users/xingyicheng/.crawshrimp/data/temu/activity_data/Temu_活动数据_20260413-103426.xlsx`

用户确认本轮 UI 设置的统计日期范围为：

- `2026-03-01 ~ 2026-03-31`

导出校验结果：

- 站点：
  - `全球 553`
  - `美国 122`
  - `欧区 553`
- `统计日期范围` 唯一值：
  - `2026-03-01 ~ 2026-03-31`
- 分页：
  - `全球 1-6 页`
  - `美国 1-2 页`
  - `欧区 1-6 页`
- 同站点 `SPU` 去重校验：
  - `1228 / 1228` 全唯一

## 当前判断

当前版本已满足：

- 三个区域都能抓取
- 用户设定的统计时间可落到最终导出
- 美区不再只抓第一页
- 多站点翻页过程中参数不会丢失
- 最终导出无同站点 SPU 重复

可作为本轮活动数据脚本的验收版本。
