# Shopee Live Voucher DOM Findings

## 1. Context

- Site / adapter: `shopee-plus-v2`
- Page name: `创建新优惠券`
- URL: `https://seller.shopee.cn/portal/marketing/vouchers/new?usecase=6&cnsc_shop_id=1022808482`
- Account / store / site context: `新加坡 / balabala2023.sg`
- Business step under test: `usecase=6 直播优惠券 / 限定的主播优惠券创建`
- Test date: `2026-04-08`

## 2. Goal

- 确认 `usecase=6` 下两种券型的字段差异、可稳定交互路径和模板列。
- 确认“限定主播”选择是否需要单独脚本处理。

## 3. Page Snapshot

- 顶部固定区块：`优惠券类型 / 优惠券名称 / 优惠券领取期限`
- 公共规则区块：`奖励类型 / 折扣类型 | 优惠限额 / 最低消费金额 / 可使用总数 / 每个买家可用数量上限`
- 展示区块：`优惠券显示设置 / 优惠商品`
- 直播券和限定主播券共用同一个 URL，靠页面顶部的券型卡片切换。

## 4. Key DOM Findings

| Area | Selector / clue | Observation | Confidence |
|------|------------------|-------------|------------|
| 券型切换 | `优惠券类型` 下 `[role="button"]` | 两个卡片文本分别为 `直播优惠券`、`限定的主播优惠劵` | high |
| 券型选中态 | 卡片 class 含 `_1IhHco0kV36vRVyZz99aYL` | 该 class 出现在当前选中的券型卡片上 | medium |
| 日期控件 | `#startDate` / `#endDate` | React `DatePicker`，fiber props 上存在 `onChange` 和 `value` | high |
| 折扣类型 | `折扣类型 | 优惠限额` 下 select root | React props 上存在 `onChange + options`，适合注入而非裸 click | high |
| 主播弹窗 | `Add Streamers` modal | 搜索框 placeholder 为 `Search for streamers by their Shopee username`，按钮为 `Search / Add / 取消` | high |
| 商品范围 | `优惠商品` radio | `全部商品 / 特定的商品`，切到 `特定的商品` 后出现额外 `商品 -> 添加商品` 区块 | high |

## 5. Framework / Component Clues

- React clues:
  - 日期根节点沿 fiber 向上可找到 `DatePicker`，props 包含 `value` 和 `onChange`
  - `折扣类型` select 沿 fiber 可找到 `options=[{value:1,label:"扣除百分比"},{value:0,label:"折扣金额"}]`
  - `Shopee币回扣` 场景下 `折扣类型` options 收缩为仅 `扣除百分比`
- Vue clues:
  - 本页关键控件未观测到可直接依赖的 Vue 组件实例

## 6. Candidate Interaction Paths

| Priority | Method | Expected effect | Actual result |
|----------|--------|-----------------|---------------|
| 1 | React props / state injection | 直接设置日期、折扣类型 | 成功，且回读稳定 |
| 2 | 组件事件 | 单选 / checkbox / 搜索按钮触发页面状态变化 | 成功 |
| 3 | native DOM event | 文本输入可用 | 成功 |
| 4 | 纯 click 打开 select | 直播页折扣类型下拉不稳定 | 失败或无选项回读 |

## 7. Single-Control Experiment Log

### Control A: 券型切换

- Control type: 顶部卡片按钮
- Initial value: `限定的主播优惠劵`
- Target value: `直播优惠券`
- Method tried: click 卡片按钮
- Readback selector: 卡片 class + 预览文案
- Result: 成功
- Notes:
  - 切到直播券后，`添加主播` 区块消失
  - `优惠券显示设置` 文案改为 `仅在Shopee直播中显示`

### Control B: 日期

- Control type: React DatePicker
- Initial value: `2026-04-08 10:44 / 2026-04-08 11:44`
- Target value: 页面允许的任意时间
- Method tried: fiber props `onChange(date, formattedText)`
- Readback selector: `#startDate input` / `#endDate input`
- Result: `onChange` 可用
- Notes:
  - 结构与原 `voucher-create.js` 的 React 日期注入路径一致

### Control C: 折扣类型

- Control type: React Select
- Initial value: `折扣金额`
- Target value: `扣除百分比`
- Method tried: 读取 fiber props 中的 `options + onChange`
- Readback selector: `折扣类型 | 优惠限额` 表单项展示文本
- Result: 注入路径明确，裸 click 打开下拉不稳定
- Notes:
  - `Shopee币回扣` 下只剩 `扣除百分比`

### Control D: 限定主播

- Control type: Modal search + row select
- Initial value: `已选择0/15位主播`
- Target value: 添加主播用户名列表
- Method tried: 点击 `添加主播` 打开 modal，输入 username，点击 `Search`
- Readback selector: modal 文本、选中计数 `已选择x/15位主播`
- Result: modal 结构清晰，但本次未拿到有效主播搜索结果样本
- Notes:
  - `Add` 按钮禁用态主要体现在 class `disabled`，不能只看 DOM `disabled` 属性

## 8. Re-render / Timing Notes

- 切换券型后整块内容会重渲染，必须重新取节点。
- `限定的主播优惠券` 打开 modal 后，页面正文会同时出现 inline 区块和弹窗文案，回读时要避免误判。
- `特定的商品` 会新增一块 `商品 -> 添加商品` 区域，属于额外流程。

## 9. Success Signals

- 券型切换成功：
  - 直播券：预览文案含 `买家可为直播中添加的商品使用该优惠券`
  - 限定主播券：预览文案含 `买家需从限定主播的直播间添加商品`
- 主播选择成功：
  - 页面 / modal 选中计数 `已选择x/15位主播` 增加

## 10. Failure Signals

- 搜索不到主播时，modal 表格出现占位文案 `Search for streamers by their Shopee username`
- Add 按钮可能没有 `disabled` attribute，但 class 带 `disabled`
- 纯 click 打开折扣类型 select 时，不一定能拿到 options

## 11. Final Decision

- Best interaction path:
  - 券型切换用页面 click
  - 日期用 React `DatePicker.onChange`
  - 折扣类型用 React props `onChange`
  - 主播选择单独处理 modal 搜索和 row checkbox
- Why this path is preferred:
  - 和现有 `voucher-create.js` 的稳定路径一致，且避免了直播页 select 的 click 不稳定问题
- What should be written into the adapter:
  - 新建独立脚本 `live-voucher-create.js`
  - 新增 `主播用户名列表` 和 `优惠商品范围` 字段解析
  - 当前版本将 `优惠商品范围` 固定校验为 `全部商品`

## 12. Backups / Evidence

- Related adapter file: `adapters/shopee-plus-v2/live-voucher-create.js`
- Related manifest file: `adapters/shopee-plus-v2/manifest.yaml`
- Template builder: `adapters/shopee-plus-v2/tools/build_live_voucher_template.py`

## 13. Next Step

- write helper into adapter
