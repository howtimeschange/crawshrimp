# 交接文档：temu-live-photos-status-filter

> 创建时间：2026-04-09T11:30:00+08:00 | 预计下次继续：随时 | 项目：crawshrimp
> 相关页面：`https://agentseller.temu.com/govern/compliant-live-photos`

## 任务目标

在 Temu `商品实拍图洗唛合规` 任务里补一条“商品状态”筛选能力：

- 让用户在本地 UI 中选择要处理的 `商品状态`
- 默认只勾选 `在售中`
- 支持多选
- 执行脚本时，真正把该筛选项带到 Temu live 页面里再处理商品
- 同时保留前面已经完成的多图上传能力：
  - 服装主体标签图
  - 服装外包装标签图
  - 鞋品主体标签图
  - 鞋品外包装标签图
  - 每类最多 5 张

## 当前状态

- 进度：80%
- 状态：进行中，存在 1 个未收口的 live 稳定性问题

## 已完成

- 已新增 Temu 任务 `compliant_live_photos_label`，并接入 manifest。
- 已完成本地 UI 的 `file_images` 多图上传能力，支持多选和 `max` 截断。
- 已把 Temu 任务改成“用户传哪些图就传哪些图”，鞋品主体入口已保留。
- 已补 Temu live 页面登录判定，避免 `auth_check.js` 在合规页误报未登录。
- 已新增 `goods_statuses` 参数：
  - 类型：`checkbox`
  - 默认值：`['在售中']`
  - 允许值：`在售中 / 未发布到站点 / 已下架 / 已终止 / 已删除`
- 已在 live DOM 上完成单控件实验，确认：
  - `商品状态` 是 `rocket-select` 多选控件
  - 可通过真实 CDP 点击打开下拉
  - 可点击选项 `在售中 / 已下架 / ...`
  - 可点击 tag 的 remove 图标去掉已选状态
  - 可再次点击 selector 收起下拉
- 已把“商品状态筛选”接入主状态机：
  - `ensure_target -> apply_goods_status_filter -> submit_goods_status_filter_query -> wait_goods_status_filter_query -> switch_scope`

## 关键改动文件

- `/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/manifest.yaml`
  - 新增任务 `compliant_live_photos_label`
  - 新增参数 `goods_statuses`
  - 保留四类标签图上传入口
- `/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/compliant-live-photos-label.js`
  - 主状态机
  - 商品状态筛选 phase
  - 多图上传与抽屉按钮稳定性修复
- `/Users/xingyicheng/lobsterai/project/crawshrimp/app/src/renderer/views/TaskRunner.vue`
  - `file_images` UI、多图摘要、参数序列化
- `/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/auth_check.js`
  - Temu 合规页登录信号补充

## 已验证

### 1. 静态检查

- `node --check adapters/temu/compliant-live-photos-label.js` 通过
- `cd app && npm run vite:build` 通过

### 2. 多图上传主链路

已在当前店铺上做过真实闭环，成功导出结果：

- `/Users/xingyicheng/.crawshrimp/data/temu/compliant_live_photos_label/Temu_商品实拍图洗唛合规_20260409-110649.xlsx`

该次结果为：

- SPU `2080656981`
- 快速筛选：`待传图`
- 处理结果：`已提交`
- 原因：`已上传标签图并申请深度识别`

### 3. 商品状态控件单控件实验

已在 live 页确认以下动作是可行的：

- 从空值选中 `在售中 + 已下架`
- 读回选中 tag，结果正确
- 点击 `已下架` 的 remove 图标后，读回仅剩 `在售中`

也就是说，页面控件本身是可以被稳定驱动的。

## 最近几次真实任务结果

### 成功

- `run_id=257`
  - 输出：`/Users/xingyicheng/.crawshrimp/data/temu/compliant_live_photos_label/Temu_商品实拍图洗唛合规_20260409-110649.xlsx`
  - 结果：成功提交

### 带 `goods_statuses=['在售中']` 的第一次真实回归

- `run_id=258`
  - 输出：`/Users/xingyicheng/.crawshrimp/data/temu/compliant_live_photos_label/Temu_商品实拍图洗唛合规_20260409-112106.xlsx`
  - 结果：有记录，但该条为 `跳过`
  - 原因：`当前页未找到目标商品行，可能已被其他操作更新`

这说明状态筛选 phase 接入后，流程至少跑到了挑行阶段，但存在列表刷新后的竞态。

### 后续两次更严格回归

- `run_id=259`
- `run_id=260`

结果都报错：

- `Temu 商品实拍图列表加载超时，请确认页面已登录且可正常打开`

但现场 DOM 明确显示页面已加载，只是当前页面是：

- `商品状态 = 在售中, 已下架`
- `暂无数据`
- `总共0条数据`

所以这个报错不是登录问题，而是 `ensure_target` 的 ready 判定仍然有盲区。

## 当前阻塞 / 卡点

- **卡点 1：`ensure_target` 的 ready 判定仍会误报**
  - 现象：页面已加载，且 `#goodsStatusList`、quick filter、`暂无数据` 都在，但脚本仍停在 `ensure_target`
  - 当前错误：`Temu 商品实拍图列表加载超时，请确认页面已登录且可正常打开`
  - 初步判断：
    - `waitForTargetReady()` 里三项子条件有至少一项没有命中真实 DOM
    - 最需要继续排查的是：
      - `findQuickFilterTab(...)`
      - `findVisibleButtonByText('查询', ...)`
      - `getGoodsStatusSelect()`

- **卡点 2：状态筛选 phase 的“覆盖页面现有状态”尚未完成最终闭环验证**
  - 目标行为：如果页面上已有 `在售中 + 已下架`，而参数只给 `['在售中']`，脚本应先移除 `已下架`
  - 单控件实验已证明 remove 是可行的
  - 但整条任务链里还没有拿到一个“最终页面只剩 `在售中` 并顺利处理商品”的成功证据

## 探索中的发现

- Temu `商品状态` 控件是：
  - `#goodsStatusList`
  - 外层是 `.rocket-select.rocket-select-multiple`
- 下拉弹层里的可点选项是：
  - `.rocket-select-dropdown .rocket-select-item-option`
- 已选状态 tag 可通过：
  - `.rocket-select-selection-item-content`
  - `.rocket-select-selection-item-remove`
  来读和移除
- 关闭下拉不必找页面空白处，再点一次 selector 本身就能关
- 当前 live 页面 body 里能看到：
  - `商品状态 在售中, 已下架`
  - `暂无数据`
  - `总共0条数据`

## 踩过的坑

- `修改` 场景下，Temu 的 `标签图 (x/y)` 数字不一定会增加，但文件注入可能已经生效。
  - 所以不能再把“缩略图数量变化”作为唯一成功判据。
- `auth_check.js` 旧规则会把合规页误判成未登录。
  - 已通过增加 `合规中心 / 商品实拍图 / 深度识别 / 上传并识别` 等信号修复。
- `商品状态` 下拉必须用真实 CDP 点击。
  - 单纯合成事件不稳定。

## 接下来最应该做

1. **把 `waitForTargetReady()` 的三项判定逐项打日志**
   - 文件：`/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/compliant-live-photos-label.js`
   - 在 `ensure_target` 临时打印：
     - `!!getGoodsStatusSelect()`
     - `!!findVisibleButtonByText('查询', ...)`
     - `QUICK_FILTERS.map(label => !!findQuickFilterTab(label))`
   - 目标：确认到底是哪一项在当前 `0 条数据` 页面下失效

2. **如果 `findQuickFilterTab()` 不稳，放宽匹配**
   - 当前 body 里能看到组合文本 `待传图 4 图中标签有异常 5.7k`
   - 说明 visible 节点结构和最初记录 DOM 时有差异
   - 可能需要额外增加：
     - 更小的宽度范围
     - 父子节点候选
     - 文本拆分匹配

3. **如果 `findVisibleButtonByText('查询')` 不稳，单独为查询按钮写定位函数**
   - 当前页面原文里是 `查 询`
   - 虽然 `compact()` 理论上能处理，但需要实测确认
   - 可以按筛选区附近按钮来定向找，而不是全页通用找按钮

4. **ready 判定修好后，再复跑“严格回归”**
   - 先把页面故意设成 `在售中 + 已下架`
   - 再跑：
     - `goods_statuses=['在售中']`
     - `max_products=1`
   - 验证点：
     - 页面筛选最终只剩 `在售中`
     - 任务能成功越过 `ensure_target`
     - Excel 结果不再是 `跳过`

5. **最后再启动前端 Electron dev**
   - 本轮用户中途切到了 handover 输出，所以前端 `npm run dev` 还没正式拉起
   - 后端 API 当前仍可访问：`http://127.0.0.1:18765`

## 运行 / 测试方式

```bash
cd /Users/xingyicheng/lobsterai/project/crawshrimp

# 后端
bash dev.sh

# 前端（Vite + Electron）
cd app && npm run dev
```

当前后端状态接口：

- `http://127.0.0.1:18765/tasks/temu/compliant_live_photos_label/status`
- `http://127.0.0.1:18765/tasks/temu/compliant_live_photos_label/logs`

## 接手检查清单

- [ ] 读完本交接文档
- [ ] 打开当前 Temu live 页面，看一眼商品状态控件是否仍是 `在售中 + 已下架`
- [ ] 在 `ensure_target` 临时打出 ready 子条件日志
- [ ] 修掉 ready 判定后，重新跑严格回归
- [ ] 最后再拉起 `cd app && npm run dev` 给 UI 自测

---

*本交接文档由人工整理生成*
