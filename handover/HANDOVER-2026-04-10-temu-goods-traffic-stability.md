# Temu 商品流量链路稳定性修复总结

时间：2026-04-10  
范围：Temu 商品流量详情导入 / 抽屉抓取 / 分页去重 / 运行时回归

## 本轮目标

基于用户提供的 SPU 导入文件：

- `/Users/xingyicheng/Downloads/temu-goods-traffic-detail-spu-template.xlsx`

要做到：

1. 可以稳定读取 SPU 模板并逐条执行
2. 详情抽屉导出不再出现重复业务记录
3. 详情分页尽量固定到 `40` 条/页，减少来回翻页
4. `按日 / 按周 / 按月` 都能按照真实页面结构抓到数据
5. 最终导出前再做一层业务键去重兜底

## 关键根因

### 1. 详情页重复不是“导出重复写”，而是“翻页读到了旧页内容”

之前用户给出的异常文件里，同一业务键会出现在不同 `详情页码`。  
根因不是单纯 Excel 写了两次，而是详情页翻页后，页码变了，但表格内容没有真的更新。

本轮保留并继续使用了两层保护：

- 页码变化同时要求内容签名变化
- 页面指纹 + 行级业务键双重去重
- 导出前后端再按业务键做最终兜底

业务键：

- `外层站点 + SPU + 详情站点筛选 + 详情时间粒度 + 日期 + 站点`

### 2. `按周 / 按月` 并没有“站点筛选下拉”

真实 DOM 探针结论：

- `按日` 时抽屉内有两个 select
  - 站点筛选：`全部 / 加拿大 / 澳大利亚 / 日本 / 韩国`
  - 页容量：`10`
- `按周 / 按月` 时只剩一个 select
  - 页容量：`10`
  - 站点筛选控件直接消失

这意味着：

- `按周 / 按月` 不能再按国家站点循环点击
- 周/月数据应按页面真实展示抓取
- 当前页面实际只有 `站点=全部` 的周/月汇总行

### 3. 周/月阶段之前把“页容量下拉”误认成了“站点下拉”

因为周/月只剩一个数字型 select，旧逻辑把它当成站点下拉去点 `全部`，从而出现：

- `详情站点切换失败：全部`

## 代码改动

### 1. `goods-traffic-detail.js`

文件：

- `/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/goods-traffic-detail.js`

核心改动：

- 支持两种导入源：
  - 商品流量列表导出结果
  - SPU 单列导入模板
- 详情页分页增加 `40` 条/页切换逻辑
- 站点 select 与页容量 select 分离识别
  - 站点 select 只认“非数字型” select
  - 周/月没有站点 select 时，不再尝试切换站点
- 改为“按粒度建立真实站点矩阵”
  - 按日：`全部 + 4 国家`
  - 按周：`全部`
  - 按月：`全部`
- 详情粒度切换后会等待表格 ready，再继续读可用站点或翻页
- 周/月无站点控件时，直接按当前表格上下文抓取，不制造假异常

### 2. `manifest.yaml`

文件：

- `/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/manifest.yaml`

核心改动：

- `goods_traffic_detail` 新增 SPU 模板下载入口
- 新增 `detail_page_size` UI 参数，默认 `40`

### 3. 后端导出兜底

文件：

- `/Users/xingyicheng/lobsterai/project/crawshrimp/core/api_server.py`

已接入：

- `temu / goods_traffic_detail` 的导出前最终去重保险

## 模板与运行时

模板文件：

- `/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/templates/temu-goods-traffic-detail-spu-template.xlsx`

运行时验证使用的隔离后端：

- `http://127.0.0.1:18766`
- `CRAWSHRIMP_DATA=/tmp/crawshrimp-e2e`

这样做的原因：

- 避免旧后端进程继续读取旧 `core/models.py`
- 不污染默认运行时数据目录
- 可以确认本轮回归用的确实是最新 workspace 代码

## 真跑回归过程

### 第 1 轮

- 输出：`/tmp/crawshrimp-e2e` 之前的旧回归版本
- 结论：
  - 去重已生效
  - 暴露出 `按周` 切换时站点循环中断

### 第 2 轮

- 通过 live DOM probe 确认：
  - `按周 / 按月` 无站点 select
  - 只有页容量 select

### 第 3 轮

- 改成按粒度站点矩阵
- 暴露出最后一个问题：
  - 周/月阶段把页容量 select 当成站点 select

### 第 4 轮最终结果

最终成功输出：

- `/tmp/crawshrimp-e2e/data/temu/goods_traffic_detail/Temu_商品流量详情_20260410-205131.xlsx`

最终指标：

- 总行数：`493`
- 明细行：`493`
- 异常行：`0`
- 业务键重复数：`0`
- 共命中 `28` 个有效组合

每个 SPU 都命中以下组合：

- `按日`
  - `全部`
  - `加拿大`
  - `澳大利亚`
  - `日本`
  - `韩国`
- `按周`
  - `全部`
- `按月`
  - `全部`

周/月实际样例：

- `SPU=965450603 / 详情站点筛选=全部 / 详情时间粒度=按周 / 日期=2026-04-03-2026-04-09 / 站点=全部`
- `SPU=965450603 / 详情站点筛选=全部 / 详情时间粒度=按月 / 日期=2026-04 / 站点=全部`

## 回归命令

本轮通过：

- `node --check adapters/temu/goods-traffic-detail.js`
- `node --test tests/temu-goods-traffic-detail-source-file.test.js tests/temu-traffic-recovery.test.js`

本轮还做了多次真实任务执行与 Excel 产物校验，不是只跑单元测试。

## 当前结论

这版可以作为当前可交付版本：

- SPU 模板导入正常
- 详情页 40 条/页策略已接入
- 周/月不再误切不存在的站点控件
- 最终导出无异常行、无业务键重复
- 用户给定这份 SPU 文件已经完成真跑闭环验证

