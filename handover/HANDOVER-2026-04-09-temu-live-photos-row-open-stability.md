# 交接文档：Temu 商品实拍图洗唛合规 - 行打开稳定性与弹窗兼容

> 更新时间：2026-04-09 19:30 +08:00  
> 项目：`crawshrimp`  
> 页面：`https://agentseller.temu.com/govern/compliant-live-photos`

## 本次结论

这轮问题已经收口，根因不是“鞋品无法识别”，而是两个更底层的稳定性问题：

1. `open_row -> wait_drawer` 对“抽屉已打开”的判定过度依赖 `SPU` 文本，导致抽屉明明已经起来了，但脚本又回到 `pick_row`，看起来像“一条都没打开”。
2. 从一个快速筛选 tab 切到另一个 tab 时，表格存在短暂空窗；脚本之前把“渲染中”误判成“没有候选行”，所以会把 `仓库实收商品不合规` 这类 tab 里的 `重新上传` 行直接跳掉。

另外，页面上还有两个通用弹窗分支也已经兼容：

1. 列表点击 `上传 / 修改 / 重新上传` 后，若先弹资质弹窗，脚本会自动点 `先传图，稍后再传资质`。
2. 抽屉提交后，若弹识别异常弹窗，脚本会自动点 `保存实拍图，暂不处理异常`。

## 实际修复点

本次修改集中在 `adapters/temu/compliant-live-photos-label.js`。

### 1. 抽屉打开判定改为“业务控件优先”

旧逻辑的问题：

- 主要依赖 drawer 文本里出现当前 `SPU`
- Temu 抽屉刚打开时，常常先渲染上传区和按钮，`SPU` 文本稍后才出现
- 所以会出现“已点开抽屉，但脚本判定未打开”的假失败

新逻辑做法：

- 新增 `DRAWER_CANDIDATE_SELECTORS`
- 新增 `getOpenDrawer()` 候选打分
- 新增 `readDrawerState(spu)` 和 `drawerStateSummary(state)`
- `wait_drawer` 成功条件改为优先看：
  - 可见 drawer
  - `上传并识别`
  - `商品主体实拍图`
  - `商品外包装实拍图`
  - `input[type=file]`
- `SPU` 文本改为辅助信号，不再是唯一硬门槛

### 2. tab 切换后的空表格等待

旧逻辑的问题：

- 切到 `仓库实收商品不合规` 后，表格偶发先返回空
- `pick_row` 直接把空表当作“这个 scope 没有可处理行”

新逻辑做法：

- `pick_row` 中当 `getProductRows()` 为空时，会先 `waitForTable(1200)`
- 仅在等待后仍然为空时才增加 `scope_retry`
- 一旦找到候选行，会重置 `scope_retry`

这次用户反馈的“仓库实收商品不合规 tab 下都是要重传的，你一条都没有处理”就是这个点导致的，现已修复。

### 3. 新增两个弹窗分支

已补充的 phase：

- `accept_upload_later_dialog`
- `save_live_photos_without_fix`
- `wait_saved_live_photos`

对应页面行为：

- 资质拦截弹窗：点击 `先传图，稍后再传资质`
- 提交后异常弹窗：点击 `保存实拍图，暂不处理异常`

## 鞋品与服装链路说明

### 鞋品

鞋品分类不是这轮主阻塞，但仍保留并沿用之前的修复：

- `classifyProduct(name, rowText)` 使用商品名 + 行内全文联合判断
- 扩展了更完整的中英文鞋类关键词

### 服装

本次没有改动服装素材映射规则，服装仍然走原来的两路：

- `clothing_subject_label_images -> 商品主体实拍图 / 标签图`
- `clothing_package_label_images -> 商品外包装实拍图 / 标签图`

为了确认这轮稳定性改动没有伤到服装链路，已补自动化回归：

1. 非鞋品商品仍判定为 `clothing`
2. `prepare_upload` 阶段仍只注入 `clothing_*` 素材，不会串到 `shoe_*`

说明：

- 本轮 live 页面测试环境是一家鞋品商品较多的店铺，所以没有额外做服装店铺的 live 提交回归
- 但服装分流和上传字段映射已被单元测试覆盖，且这次修改未改变服装上传位选择逻辑

## 验证结果

### 1. 单元测试

文件：

- `tests/temu-compliant-live-photos-label.test.js`

当前通过数：

- `9` 条全部通过

覆盖点：

- 鞋品判定保持可用
- 服装判定保持可用
- tab 切换空表等待
- drawer 无 `SPU` 但已有上传控件时仍判定成功
- drawer 重试与失败诊断
- 资质拦截弹窗分支
- 提交后异常弹窗分支
- 服装素材仍注入正确上传位

执行命令：

```bash
node --check adapters/temu/compliant-live-photos-label.js
node --check tests/temu-compliant-live-photos-label.test.js
node --test tests/temu-compliant-live-photos-label.test.js
```

### 2. live 最小/批量验证

#### 图中标签有异常

已在 live 页面做过当前 scope 的定向验证，实际成功提交 `5` 条，且两个新弹窗分支都在真实页面命中过：

- `5206450833`：`已提交`
- `530510186`：`已提交`
- `3526671326`：`已提交`
- `6573113656`：`已提交`
- `2810724272`：`已提交`

其中命中统计：

- `accept_upload_later_dialog`: `1`
- `save_live_photos_without_fix`: `1`

#### 仓库实收商品不合规

在修复空表等待后，已重新实测该 tab 的两条 `重新上传` 任务，结果为 `2/2` 提交成功：

- `SPU 177386201`：`已提交`，原因 `已上传标签图并申请深度识别`
- `SPU 4702174880`：`已提交`，原因 `上传并识别已提交`

这说明“tab 下明明有待处理行但脚本一条都没动”的问题已经被修掉。

## 本次交付物

- `adapters/temu/compliant-live-photos-label.js`
- `tests/temu-compliant-live-photos-label.test.js`
- `handover/HANDOVER-2026-04-09-temu-live-photos-row-open-stability.md`

## 后续如果还要继续看

如果后面还有异常，优先排查顺序建议如下：

1. 是否是 Temu 页面 DOM 再次改版，导致 drawer / modal 选择器失效
2. 是否出现新的提交后弹窗文案
3. 是否是店铺权限或资质状态变化，而不是脚本逻辑问题

不要再优先回头怀疑：

- 鞋品分类
- `重新上传` 行识别
- 服装素材映射

这些点在 2026-04-09 这轮已经有代码和测试双重验证。
