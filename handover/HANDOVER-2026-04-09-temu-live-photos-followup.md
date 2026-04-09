# 交接文档：temu-live-photos 深度识别 / 行级重试

> 更新时间：2026-04-09T13:02:55+08:00 | 项目：crawshrimp
> 相关页面：`https://agentseller.temu.com/govern/compliant-live-photos`
> 背景文档：`/Users/xingyicheng/lobsterai/project/crawshrimp/handover/HANDOVER-2026-04-09-temu-live-photos-status-filter.md`

## 这次补上的重点

- 已把 Temu 弹窗里的 `深度识别` 入口从坐标点击改成元素级 `clickLike(button)`，并把入口定位阈值放宽到 `minY: 120`。
- 已把 `confirm_deep_recognition` 也改成元素级点击，避免只点坐标但不触发确认弹窗。
- 已修正 `open_row` 的行为：
  - 之前是“当前页找不到目标商品行”就直接产出 `skipped`
  - 现在改成先重试，重试后回到 `pick_row` 继续扫描
  - 目的是避免任务在第二页或行刷新时提前结束
- 已在结果收口时补了 `row_retry: 0` 清理，避免旧重试计数污染后续商品。

## 当前状态

- 代码层面：深度识别按钮点击方式已经改好，`open_row` 的短路退出也已经改成重试。
- 测试层面：**还没有完成完整回归**。
- 已知最新一次旧逻辑下的结果：
  - `run_id=277`
  - 输出：`/Users/xingyicheng/.crawshrimp/data/temu/compliant_live_photos_label/Temu_商品实拍图洗唛合规_20260409-125544.xlsx`
  - Excel 里仍然是 `跳过`
  - 原因：`当前页未找到目标商品行，可能已被其他操作更新`
  - 这个结果是补丁前的旧行为，不能当成最终结论。

## 现在最需要别的会话验证的事

1. 验证“当前页没有候选行”时，脚本会继续翻页，而不是提前停止。
2. 验证“选中了候选行，但打开时页面刷新导致行消失”时，脚本不会直接 `skipped`，而是回到 `pick_row` 继续扫。
3. 验证上传抽屉里的深度识别流程会自动点到：
   - `上传并识别`
   - `深度识别`
   - 确认弹窗里的 `确定`
4. 验证最终状态能稳定收口到：
   - `已上传标签图并申请深度识别`
   - `深度识别结果: 已提交`

## 建议测试参数

- `mode`: `new`，优先用新页面重新导航，减少旧状态干扰
- `max_products`: 留空或设为 `0`，用于整店扫描直到所有页都处理完
- `goods_statuses`: 先用默认 `['在售中']`
- 图片素材：直接用这个目录里的文件
  - `/Users/xingyicheng/Downloads/商品实拍图/服装-商品主体-标签图.jpg`
  - `/Users/xingyicheng/Downloads/商品实拍图/服装-外包装-标签图.jpg`
  - `/Users/xingyicheng/Downloads/商品实拍图/鞋品-外包装-标签图1.jpg`
  - `/Users/xingyicheng/Downloads/商品实拍图/鞋品-外包装-标签 图2.jpg`

## 这份测试里要重点看什么

- 如果某一页完全没有可处理行，任务应该自动点下一页，直到没有下一页为止。
- 如果某一行在点击前后被页面刷新掉，不应该把它当成最终结果结束掉。
- 如果进入了修改弹窗，应该能看到深度识别确认弹窗被自动触发，而不是卡在弹窗里不动。
- 如果任务最后还是只出 1 条记录，要确认原因是不是“页面真的只有 1 条有效目标”，而不是中途短路。

## 相关文件

- `/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/compliant-live-photos-label.js`
- `/Users/xingyicheng/.crawshrimp/adapters/temu/compliant-live-photos-label.js`
- `/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/temu/manifest.yaml`
- `/Users/xingyicheng/lobsterai/project/crawshrimp/app/src/renderer/views/TaskRunner.vue`

## 备注

- 当前 repo 和 `~/.crawshrimp` 下的执行副本已经同步。
- 这次先不要把之前的 `ensure_target` / `查询按钮` / `商品状态控件` 当作主阻塞点，它们已经不是这轮的主要问题了。
- 这轮真正要收口的是“整页扫描直到结束”和“深度识别自动提交”两个链路。

