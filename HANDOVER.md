# crawshrimp 项目交接文档

最后更新：2026-03-28 00:49 GMT+8

---

## 一、项目基本信息

**GitHub**: https://github.com/howtimeschange/crawshrimp
**本地路径**: `/Users/xingyicheng/lobsterai/project/crawshrimp`

### 技术栈
- **前端**: Electron + Vue3 + Vite（HMR 端口 5173）
- **后端**: Python FastAPI + APScheduler（端口 18765）
- **通信**: CDP（Chrome DevTools Protocol，端口 9222）+ WebSocket
- **数据导出**: openpyxl（Excel）

### 运行命令
```bash
# 后端（项目根目录）
cd /Users/xingyicheng/lobsterai/project/crawshrimp
PYTHONPATH=. venv/bin/python3 core/api_server.py

# Electron（app 目录）
cd /Users/xingyicheng/lobsterai/project/crawshrimp/app
npm run dev
```

**注意**: 所有 dev server 命令必须加 `NO_PROXY=localhost,127.0.0.1 no_proxy=localhost,127.0.0.1`，否则代理干扰 localhost。

**Chrome 用户数据-dir**: `/tmp/chrome-crawshrimp`
**CDP 端口**: 9222

---

## 二、已完成的重大改动（2026-03-28）

### 2.1 IPC 性能优化
- **前端** `TaskRunner.vue`：`file_excel` 参数只发送 `{ path }`，不再发送 rows/headers
- **后端** `api_server.py`：执行前自动读取 Excel 并注入 `rows` 和 `headers` 到脚本
- 解决了 Electron 进程间通信因大 JSON 数据卡死的问题

### 2.2 voucher-batch-create.js 日期选择重构
**核心问题**: Shopee 页面使用 React EDS 日期选择器，JS `click()` 对 React 合成事件无效，导致月份导航失灵。

**旧逻辑**: 所有 click 一次性发给 Python，navigation 用 JS `click()` 对 React 无效，确认按钮没点到就跳过了。

**新逻辑 — 6 阶段状态机**（pick_date_{kind}）：
```
open → nav（self-loop，每次 CDP click 1次箭头，重新检查 header）→ day → time → confirm → verify
```

- 月份导航全部改用 CDP click（真实鼠标事件）
- 添加 `[DATE]` 日志便于调试
- `pick_date_verify_end`: 日期验证失败直接 throw，不跳过继续
- 添加 `form_validate` 阶段：提交前校验折扣值/条件/上限/日期，失败即停止

### 2.3 DataFiles 页面布局重写
- `.df-root` 用 `position: fixed; top: 40px; left: 168px; right: 0; bottom: 0` 直接相对视口定位
- `.df-body` 用 `flex: 1 + overflow-y: auto` 独立滚动
- 完全脱离 grid/flex 继承链，解决滚动问题

### 2.4 TaskRunner.vue 日志面板滚动修复
- `.log-body` 加 `min-height: 0` 解决 Flexbox 场景下 `overflow-y: auto` 不生效

---

## 三、当前遗留问题（未解决）

### 3.1 voucher-batch-create.js — 日期面板确认按钮
**问题**: 日期面板中"确认"按钮可能不存在（点击日期格后面板自动关闭），或 EDS 版本升级后 class 名变化。

**现状**: `pick_date_confirm_{kind}` 阶段会查找确认按钮，找不到时点击空白处作为 fallback，但未经过实际页面验证。

**建议**:
1. 用真实 Shopee 页面测试，确认日期面板是否有独立确认按钮
2. 如果点击日期格后面板自动关闭，删除 confirm 阶段
3. 如果有确认按钮，验证 CDP click 是否有效

### 3.2 voucher-batch-create.js — Follow Prize（usecase 999）
**问题**: 关注礼优惠券（usecase 999）URL 路径为 `/follow-prize/new`，与其他三种优惠券不同，未经过实际测试。

**建议**: 用真实页面测试 usecase 999 的日期选择器行为是否与其他三种一致。

### 3.3 Shopee 日期选择器 DOM 结构
**问题**: 日期面板可能有隐藏的滚动容器，导致点击时页面发生意外滚动。

**建议**: 在页面上执行 JS 检测 `.picker-item` 内部是否有溢出滚动的子元素。

---

## 四、关键文件清单

| 文件 | 作用 |
|---|---|
| `adapters/shopee/voucher-batch-create.js` | 券批次创建脚本，核心逻辑 |
| `core/api_server.py` | FastAPI 服务，任务调度，Excel 读取 |
| `core/js_runner.py` | CDP WebSocket JS 注入执行 |
| `core/cdp_bridge.py` | Chrome CDP HTTP 封装（tab 管理、WebSocket URL） |
| `core/data_sink.py` | 数据落地，文件名渲染 |
| `core/task_repo.py` | 任务配置持久化 |
| `app/src/main.js` | Electron IPC handlers |
| `app/src/preload.js` | 暴露 window.cs API |
| `app/src/renderer/App.vue` | 主布局（grid + 侧边栏） |
| `app/src/renderer/views/TaskRunner.vue` | 任务执行 UI |
| `app/src/renderer/views/DataFiles.vue` | 数据文件浏览（已重写） |

---

## 五、Shopee 优惠券 usecase 分类

| 品类 | usecase | 创建页面 URL |
|---|---|---|
| 商店优惠券 | 1 | `/vouchers/new?usecase=1` |
| 新买家优惠券 | 3 | `/vouchers/new?usecase=3` |
| 回购买家优惠券 | 4 | `/vouchers/new?usecase=4` |
| 关注礼优惠券 | 999 | `/follow-prize/new`（独立路径）|

---

## 六、关键 DOM 选择器（EDS 日期选择器）

```
面板触发器（6 级 fallback）：
1. `.picker-item.{kind}-picker input.eds-react-input__input`
2. `input.eds-react-date-picker__input`
3. `#startDate`
4. `input`
5. `#startDate`
6. `.eds-react-date-picker input`（按 visibility 过滤）

面板内部：
- 月份导航箭头: `.eds-react-date-picker__header` 内的箭头按钮
- 日期 header: `.eds-react-date-picker__header`（提取文本判断当前月份/年份）
- 日格: `.eds-react-date-picker__table-cell`
- 时间选择: `.eds-react-time-picker__tp-scrollbar .time-box`
- 确认按钮: （待验证是否存在）
```

---

## 七、测试建议

1. **先测试 usecase 1（商店优惠券）**，最常用，逻辑最完整
2. 用 1 行 Excel 数据测试，观察 `[DATE]` 日志输出
3. 重点观察：月份导航是否正确、确认按钮是否被点击、日期值是否正确填入
4. 日期验证通过后再测试多行批量

---

*本文件由 AI 助手依据 2026-03-28 会话生成，供下次会话接手使用。*
