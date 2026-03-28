# Shopee+ V2 优惠券自动化 — 最终交接文档 2026-03-28

## 当前结论

Shopee 优惠券自动化已经收敛为唯一正式实现：`adapters/shopee-plus-v2/`。

- 旧 `adapters/shopee/` 和 `adapters/shopee-plus/` 已从仓库移除
- 运行目录 `~/.crawshrimp/adapters/` 中的旧 Shopee adapter 也已清理
- 当前后端实际加载的 adapter 仅有：
  - `shopee-plus-v2`
  - `temu`
  - `jd`

## 最终交付状态

### 业务范围

`shopee-plus-v2` 支持以下 4 类券型的批量创建：

- 商店优惠券（`usecase=1`）
- 新买家优惠券（`usecase=3`）
- 回购买家优惠券（`usecase=4`）
- 关注礼优惠券（`usecase=999`，`/follow-prize/new`）

支持：

- `current` 模式：在当前已打开的 Shopee tab 上执行
- `new` 模式：由底座打开新页面执行
- 多门店、多券型、整表循环
- 单行失败写回结果后继续后续行

### 最终验证

已使用整表做 live 验证并跑通 8/8：

- 结果文件：
  [Shopee优惠券设置结果V2_20260328_215139.xlsx](/Users/xingyicheng/.crawshrimp/data/shopee-plus-v2/voucher_batch_create/Shopee优惠券设置结果V2_20260328_215139.xlsx)

说明：

- 期间出现过“重复时间段不允许重复建券”的失败，这是 Shopee 后台业务规则，不是脚本错误
- 清理测试券后重新执行，最终整表全成功

## 当前实现方式

### 适配器入口

- Manifest: [manifest.yaml](/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/shopee-plus-v2/manifest.yaml)
- 登录检查: [auth_check.js](/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/shopee-plus-v2/auth_check.js)
- 主脚本: [voucher-create.js](/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/shopee-plus-v2/voucher-create.js)
- 日期注入备份: [date-injection-backup.js](/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/shopee-plus-v2/date-injection-backup.js)

### 状态机粒度

保留的是**业务级 phase**，不是字段级 phase。当前主链路是：

- `main`
- `prepare_row`
- `ensure_marketing`
- `ensure_store`
- `open_usecase_form`
- `fill_usecase_form`
- `submit_form`
- `post_submit`

这套粒度已经足够支撑 SDK 的多次注入机制，同时避免字段级 phase 在重渲染和弹层交互里变脆。

### 日期处理策略

普通券 `1 / 3 / 4`：

- 放弃旧的 CDP 日历点击方案
- 改为 React 组件注入
- 开始时间、结束时间都走同一套注入逻辑

关注礼 `999`：

- 继续走页面注入方案
- 单独维护，不和普通券强行共用日期控件逻辑

这两套已验证有效的注入方式已单独备份到 [date-injection-backup.js](/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/shopee-plus-v2/date-injection-backup.js)，后续若主脚本回归异常，可直接从这里回抄。

### 券型分流策略

- 普通券 `1 / 3 / 4` 共用一套 `fillNormalVoucherUsecase`
- `999` 单独使用 `fillFollowPrizeUsecase`

不要再尝试把 4 类券做成“完全统一的字段引擎”。DOM 差异、组件实现和联动逻辑并不一致，按 `usecase` 分 handler 更稳。

### 店铺切换策略

当前实现已支持：

- 按 Excel 中的 `站点 + 店铺` 分组
- 同店连续建券
- 跨店时显式回营销中心后再切下一家店
- 切店时校验当前展示店铺、站点别名和 `cnsc_shop_id`

## 与底座相关的关键改动

### 当前 tab 绑定

为保证 `current` 模式真正运行在用户眼前的页面上，前后端新增了 `current_tab_id` 传递链路：

- [main.js](/Users/xingyicheng/lobsterai/project/crawshrimp/app/src/main.js)
- [preload.js](/Users/xingyicheng/lobsterai/project/crawshrimp/app/src/preload.js)
- [TaskRunner.vue](/Users/xingyicheng/lobsterai/project/crawshrimp/app/src/renderer/views/TaskRunner.vue)
- [api_server.py](/Users/xingyicheng/lobsterai/project/crawshrimp/core/api_server.py)

结论：

- `current` 模式不再“随便挑一个 URL 匹配的 Shopee tab”
- 而是尽量绑定当前活动页

### 登录检查

`current` 模式不再跳过登录检查。现在 `current` / `new` 都会先走 `auth_check.js`，以防半登录态或失效会话误执行。

### Phase 上限

[js_runner.py](/Users/xingyicheng/lobsterai/project/crawshrimp/core/js_runner.py) 中 `MAX_PHASES` 已放宽到 `9999`，避免多门店、多行任务因为 phase 计数过小而中断。

### 本地开发地址统一

开发环境已统一到 IPv4：

- Electron dev URL：`http://127.0.0.1:5173`
- `wait-on` 探活地址：`http://127.0.0.1:5173`
- 后端默认地址：`http://127.0.0.1:18765`
- CDP 默认地址：`127.0.0.1:9222`

这样是为了避免 `localhost` 在本机解析到 IPv6 时，Vite / Electron / wait-on 互相连不上的问题。

## 本次最重要的经验

### 1. 业务级状态机是对的，字段级状态机是错的

SDK 仍然需要 phase，但只应该服务于“业务步骤切换”。不要再把“点某个箭头、切某个下拉、填某个字段”拆成单独 phase。

### 2. 对 React / Vue 表单，优先状态注入，不要优先坐标点击

这次普通券日期、`999` 日期都证明了：如果页面是组件驱动的，注入 `onChange / modelValue / 组件实例` 通常比 CDP 点击稳定得多。

### 3. 页面重渲染后必须重新取节点

`999` 的折扣类型切换问题，本质就是切换后整块 Vue 节点重建，脚本还拿旧节点回读，导致“页面其实成功了，脚本误判失败”。

### 4. 提交成功判定不能只看跳转

Shopee 有时会停留在创建页，但页面已经出现成功卡片、`查看详情`、`返回列表页面` 等成功信号。后续如果再扩任务，这条规则仍然适用。

### 5. 业务失败和脚本失败要分开

“重复时间区间”“后台规则不允许创建”属于业务失败，不应归结为脚本超时或底座异常。

## 后续维护建议

1. 以后 Shopee 相关需求只改 [voucher-create.js](/Users/xingyicheng/lobsterai/project/crawshrimp/adapters/shopee-plus-v2/voucher-create.js)，不要恢复旧 adapter。
2. 改日期、下拉、联动字段前，先在 live 页面做 DOM 实验，确认哪种方式真正改动了组件状态，再回写正式脚本。
3. 每次改动至少做两轮验证：
   - 单券型页面级联调
   - 多门店整表回归
4. 如果未来还要扩 Shopee 券型，优先按 `usecase` 新增 handler，不要回到“大一统通用表单引擎”思路。

## 关键提交

- `4ce07a7` `Add stable shopee-plus-v2 voucher adapter`
- `830cb20` `Align app dev server with IPv4 startup`
- `60f9b26` `Remove legacy shopee adapters`

## 当前仓库状态说明

本文档更新时，Shopee 主线已经稳定落地；仓库里仍可能存在一些与本任务无关的未跟踪文件，例如：

- `handover/`
- `inspect_shopee.py`
- `memory-bank/`

这些不属于 `shopee-plus-v2` 正式交付的一部分，提交代码时无需混入。
