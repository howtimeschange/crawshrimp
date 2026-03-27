# Shopee+ 优惠券自动化 — 交接文档 2026-03-28

## 本次工作概述

对 `adapters/shopee-plus/voucher-create.js` 进行了完整重构（v2），修复了 4 个已知 Bug，并修复了 2 个客户端问题（Excel 空行误读、日志持久化）。

---

## 重构：状态机 v2（`voucher-create.js`）

### 设计原则

- Phase 以"人类操作步骤"为单位（不是"单次 CDP 点击"）
- 共 13 个 phase，每个 phase 语义清晰
- 失败明确报错，不允许静默跳过

### Phase 列表

| Phase | 说明 |
|---|---|
| `init` | 初始化，处理多行 row 分组/分配 |
| `nav_to_new` | 导航到创建页（按 voucherType 拼 URL） |
| `store_switch_open` | 打开店铺切换弹窗（CDP 点击） |
| `store_switch_search` | 输入店铺名搜索 |
| `store_switch_done` | 选中搜索结果确认切换 |
| `voucher_type_select` | 选择优惠券品类（商店/新买家/回购/关注礼） |
| `date_nav` | 日期面板月份导航（CDP 坐标点击） |
| `date_select` | 选择日期格（CDP 坐标点击） |
| `date_time_set` | 设置时分（批量打包箭头坐标，一次 cdp_clicks） |
| `date_done` | 确认日期面板 |
| `form_fill_rest` | 填写奖励/折扣类型、金额、限额等字段 |
| `submit` | 提交前扫描校验红字，无误则点确认 |
| `post_submit` | 等待成功跳转或检测提交错误 |

### Bug 修复

#### Bug 1：`store_switch` 无法打开弹窗
- 旧版：直接注入 JS 操作，弹窗不响应
- 新版：`store_switch_open` 阶段通过 `cdp_clicks` 坐标点击打开弹窗，再走 `store_switch_search` / `store_switch_done`

#### Bug 2：时间 UTC 偏移（-3h）
- 旧版：`setDateRangeJS` 里 `new Date(...+08:00).toISOString()` → UTC 字符串，Vue 组件按本地显示 -8h
- 现象：Excel 填 11:29，页面显示 08:29
- 修复：直接传本地时间字符串 `"2028-06-29 11:29:00"`，不经 UTC 转换

#### Bug 3：`form_fill_rest` 字段失败阻断后续字段
- 旧版：`setDiscountType` 等任何字段 throw 会导致后续字段全跳过
- 现象：折扣类型/优惠限额/最低消费/可使用总数全空，而提前显示/每个买家已填
- 修复：每个字段单独 try-catch，失败记 `[FORM_REST] 字段警告` warning，继续填下一字段

#### Bug 4：提交前未捕获页面校验红字
- 旧版：页面有"结束时间不能超过开始时间后的3个月"红字时，脚本仍点确认 → 超时失败，错误原因列为空
- 修复：`submit` 阶段提交前扫描 `.eds-react-form-item__extra`、`[class*=error-msg]` 等选择器，有红字则直接写入"错误原因"列并 finishRow，不再点确认

---

## 客户端修复（`core/api_server.py` + 前端）

### 问题 1：Excel 空行被误读为数据行

- 根因：`_read_local_excel` 用 openpyxl `iter_rows` 时，表格格式延伸到第 8 行（即使只有 1 行数据），产生 7 个全空行
- 修复：过滤全字段为空/None 的行

```python
# 跳过全空行（所有单元格都是 None 或空字符串）
if all(c is None or str(c).strip() == '' for c in raw):
    continue
```

### 问题 2：日志不保留、不隔离

**后端（`api_server.py`）**
- 旧版：每次运行 `_run_logs[jid] = []` 清空历史日志
- 新版：保留历史，新一轮运行追加分隔线 `─── 新运行 HH:MM:SS ───`
- 新增 `DELETE /tasks/{aid}/{tid}/logs` 接口支持前端手动清空

**前端（`TaskRunner.vue`）**
- 切换脚本时：不清空 `logs.value`，改为 load 该脚本历史日志
- 新建运行时：不清空日志（由后端分隔线区分）
- 清空按钮：同步调用后端 clear 接口，两边同步

**脚本隔离**：后端日志 key 为 `adapter_id::task_id`，不同脚本天然隔离。前端切换脚本时 load 对应 key 的日志，互不干扰。

---

## 文件变更清单

| 文件 | 变更类型 | 说明 |
|---|---|---|
| `adapters/shopee-plus/voucher-create.js` | 重构 + Bug修复 | v2 状态机，1308行 |
| `core/api_server.py` | Bug修复 | Excel空行过滤 + 日志追加 + clear接口 |
| `app/src/renderer/views/TaskRunner.vue` | Bug修复 | 日志持久化/隔离 |
| `app/src/main.js` | 功能新增 | clear-task-logs IPC handler |
| `app/src/preload.js` | 功能新增 | clearTaskLogs API 暴露 |

---

## 测试状态

- [ ] 单行测试：`semir2022.my`，商店优惠券，扣除百分比
- [ ] 时间设置验证（11:29 → 页面应显示 11:29，不再偏移）
- [ ] 折扣类型/优惠限额/最低消费金额字段填写
- [ ] 超过3个月结束时间：错误原因列应写入"表单校验错误：结束时间不能超过开始时间后的3个月"
- [ ] 日志切换脚本后保留，重新运行显示分隔线

---

## 运行方式

```bash
# 后端
cd /Users/xingyicheng/lobsterai/project/crawshrimp
NO_PROXY=localhost,127.0.0.1 PYTHONPATH=. venv/bin/python3 core/api_server.py

# Electron 前端
cd /Users/xingyicheng/lobsterai/project/crawshrimp/app
NO_PROXY=localhost,127.0.0.1 npm run dev

# Chrome CDP
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-dev-test
```

---

## 注意事项

1. **关注礼（usecase=999）** 走 `/follow-prize/new`，日期用 Vue `ctx.handleStartChange/handleEndChange`，本地时间字符串格式 `"YYYY-MM-DD HH:mm:00"`
2. **普通券（1/3/4）** 走 `/vouchers/new?usecase=X`，日期用 CDP 点击 React EDS 组件
3. **`[FORM_REST] 字段警告`** 出现时字段填写失败但流程不中断，需关注 warning 内容定位具体失败原因
4. **`[SUBMIT] 页面存在校验错误`** 出现时说明表单有校验红字被提前捕获，结果写入了错误原因列
5. Excel 优惠限额 `0.05` → 页面填 `5`（百分比自动转换，`discountLimitValue` 函数处理）
