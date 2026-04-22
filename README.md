# 🦐 抓虾 · crawshrimp

**通用网页自动化底座** — 安装适配包，点击运行，数据自动导出。

[![GitHub release](https://img.shields.io/github/v/release/howtimeschange/crawshrimp?label=latest)](https://github.com/howtimeschange/crawshrimp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 本次更新（2026-04-22 / v1.4.1）

- 桌面端版本升级到 `v1.4.1`，`desktop-latest` 会输出 `crawshrimp-v1.4.1-*` 命名的桌面安装包。
- Lazada `批量创建优惠券` 补强非 ID 已认证站点的折扣设置字段兜底；当标签和输入框不再嵌套时，仍能回退到 `Discount Setting` 区块继续识别填写。
- Lazada `Flexi Combo` 建券流程修正日期区间选择器参数，开始/结束占位符与时间值会一起传入，减少领取时间范围误填。
- Shopee `批量创建优惠券` 重构冲突券清理链路，补强“结束”菜单点击、弹窗确认、翻页扫描与批量清理流程，降低历史冲突券残留导致的建券失败。
- 新增/补强 Lazada、Shopee 回归测试，覆盖 TH 字段兜底、Flexi 时间区间选择和 Shopee 冲突券跨页清理场景。

## 上次更新（2026-04-21 / v1.4.0）

- 桌面端版本升级到 `v1.4.0`，`desktop-latest` 会输出 `crawshrimp-v1.4.0-*` 命名的桌面安装包，并改成滚动正式发布，不再标记为 Pre-release。
- Temu `后台-商品流量-列表` 补齐店铺名识别链路，会优先读取卖家账号区域并过滤导航噪音文案，导出文件命名与上下文回填更稳定。
- Shopee `批量创建优惠券` 新增 `优惠券名称 / 优惠码` 自定义列支持，优惠码会校验长度、字符集与重复值，避免脏模板直接带入执行。
- 新增/补强 Temu、Shopee、Excel 导入与 JS 执行器回归测试，覆盖店铺名回填、表头别名匹配、自定义优惠码与导入校验场景。

## 上上次更新（2026-04-21 / v1.3.0）

- 桌面端版本升级到 `v1.3.0`，滚动发布 `desktop-latest` 会输出 `crawshrimp-v1.3.0-*` 命名的桌面安装包。
- SHEIN `商品分析-商品明细` 新增页面实时探测参数能力，任务面板现在支持 `站点 / SKC / SPU / 在售状态 / 在架状态 / 上架日期 / 新品标签 / 商品层次 / 质量等级` 等筛选项。
- SHEIN `商品分析-商品明细` 导出字段已补齐曝光、点击、加车、支付、质量等指标分组；探测失败时会静默回退，执行进度条也已恢复到任务面板。
- Lazada `批量创建优惠券` 补强了跨站点恢复与 VN 站 live 提交流程，切站时会先回站点主页再进入目标工具页，减少跨站残留状态导致的误判。
- Lazada ID 站当前账号若被重定向到 `account health`，现在会提前给出明确提示并停止 live 创建，不再把异常重定向误判成正常执行。
- 新增/补强 SHEIN、Lazada 与 JS 执行器回归测试，覆盖动态筛选探测、站点恢复和重定向兜底场景。

## 是什么

crawshrimp 是一个桌面应用**底座**（Electron + Python）。它不做具体的爬虫逻辑，而是提供：

- 🔌 **插件化适配包（Adapter）** — 每个平台一个包，安装即可使用
- 🌐 **CDP 直连浏览器** — 脚本在你已登录的 Chrome 里运行，不需要重新登录
- 💉 **JS 注入执行** — 适配包只写 JS，底座负责注入、分页、超时重试和页面恢复
- 📊 **自动导出** — Excel / JSON 全自动存文件，可选定时通知
- 🖥 **Vue 3 GUI** — 平台管理、任务面板、数据预览、设置，开箱即用

### 内置适配包

| 适配包 | 平台 | 功能 |
|--------|------|------|
| `shopee-plus-v2` | Shopee 卖家后台 | 多门店多券型优惠券批量创建（商店 / 新买家 / 回购买家 / 关注礼） |
| `lazada-plus-v1` | Lazada Seller Center | 多站点优惠券/促销批量创建（Regular / Flexi Combo / 新买家 / 粉丝券） |
| `temu` | Temu 卖家后台 | 商品数据 / 活动数据 / 店铺流量 / 商品流量（列表/详情） / 对账中心 / 售后管理 / 商品评价 / 保税仓退货 / 资金限制 / 建议零售价（爬取/填写） / 抽检结果明细 / 商品品质分析 / 站点商品 / 商品实拍图洗唛合规 |
| `shein-helper` | SHEIN 全球商家中心 | 商品评价 / 商品分析-商品明细（支持继承当前筛选、维度切换与多 sheet 导出） |
| `jd` | 京东商家后台 | 全店价格导出 / 破价巡检 |

> 当前仓库内只保留一条 Shopee 适配线：`shopee-plus-v2`。旧 `shopee` / `shopee-plus` 已移除。

### 最近更新

- `v1.4.1`：Lazada 优惠券补强 TH 字段兜底和 Flexi 时间区间选择，Shopee 优惠券冲突券清理流程改成更稳的跨页结束链路。
- `v1.4.0`：Temu 商品流量导出补齐稳定店铺名识别，Shopee 优惠券批量创建支持自定义券名/优惠码，`desktop-latest` 改成滚动正式发布。
- `v1.3.0`：SHEIN `商品分析-商品明细` 新增动态筛选探测与更多指标导出，Lazada 优惠券补强 VN live 流程、跨站恢复和 ID 重定向兜底。

---

## 快速开始

### 方式一：下载桌面版（推荐）

直接前往 GitHub Releases 下载已经打包好的桌面程序：

- **滚动桌面构建**：[`desktop-latest`](https://github.com/howtimeschange/crawshrimp/releases/tag/desktop-latest)
- **所有发布列表**：[`Releases`](https://github.com/howtimeschange/crawshrimp/releases)

当前 Release 会自动包含：

- macOS 桌面包（dmg）
- Windows 安装包（exe）
- 内置 Python 运行时

当前桌面安装包命名规则：

- `crawshrimp-v版本号-mac-arm64.dmg`
- `crawshrimp-v版本号-mac-x64.dmg`
- `crawshrimp-v版本号-win-x64.exe`

也就是说，**普通用户不需要自己安装 Python / Node.js**，下载后即可使用。

使用方式：

1. 下载对应平台安装包
2. 启动 Chrome，并带上 `--remote-debugging-port=9222`
3. 打开抓虾桌面程序
4. 在任务页按需下载 Excel / CSV 模板并填写
5. 在 Chrome 中登录目标平台后运行任务

> `desktop-latest` 是自动刷新的滚动正式发布，只要 `main` 分支桌面构建成功，就会自动更新为最新可下载版本。

### 方式二：从源码启动（开发者）

#### 前置条件

- Chrome 浏览器（用 `--remote-debugging-port=9222` 启动，见下）
- Python 3.10+
- Node.js 18+

#### 1. 克隆并安装

```bash
git clone https://github.com/howtimeschange/crawshrimp
cd crawshrimp

# Python 依赖
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r core/requirements.txt

# 前端依赖
cd app && npm install && cd ..
```

#### 2. 启动带 CDP 的 Chrome

```bash
# macOS
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/chrome-crawshrimp

# Windows
chrome.exe --remote-debugging-port=9222 --user-data-dir=%TEMP%\chrome-crawshrimp

# Linux
google-chrome --remote-debugging-port=9222 --user-data-dir=/tmp/chrome-crawshrimp
```

> 提示：启动后在浏览器里正常登录目标平台，之后才能运行脚本。

#### 3. 启动抓虾

```bash
# 方式一：开发模式（推荐）
bash dev.sh                 # 后端 API
# 另开终端
cd app && npm run dev       # Vite + Electron

# 方式二：仅启动后端
PYTHONPATH=. venv/bin/python3 core/api_server.py
```

API 服务默认运行在 `http://127.0.0.1:18765`，前端开发服务器默认运行在 `http://127.0.0.1:5173`。可通过环境变量 `CRAWSHRIMP_PORT` 修改后端端口。

### 开发态 Harness

仓库现在把适配器开发入口统一到 `scripts/crawshrimp_dev_harness.py`。它直接复用现有 `probe`、`browser_session` 和 `js_runner` 原语，推荐闭环是：

1. `snapshot` 看当前页面结构和命中的知识卡片
2. `knowledge` 查历史 notes / probe 物化出来的经验
3. `capture` / `eval` 做单点 DOM、请求和运行时实验
4. `probe` 只在需要结构化 bundle 时再跑

常用命令：

```bash
# 当前页面快照 + 命中的知识卡片
./venv/bin/python scripts/crawshrimp_dev_harness.py snapshot \
  --adapter temu \
  --task goods_traffic_detail

# 直接抓当前页的请求线索
./venv/bin/python scripts/crawshrimp_dev_harness.py capture \
  --adapter temu \
  --task goods_traffic_detail \
  --capture-mode passive

# 在当前业务页执行临时 JS
./venv/bin/python scripts/crawshrimp_dev_harness.py eval \
  --adapter temu \
  --task goods_traffic_detail \
  --file /absolute/path/to/check.js \
  --allow-navigation-retry

# 搜索当前 adapter/task 的经验卡片
./venv/bin/python scripts/crawshrimp_dev_harness.py knowledge \
  --adapter temu \
  --task goods_traffic_detail \
  --query drawer

# 需要结构化 bundle 时再跑 probe
./venv/bin/python scripts/crawshrimp_dev_harness.py probe \
  --adapter temu \
  --task goods_traffic_detail \
  --goal "识别详情抽屉与导出触发链路"

# notes 更新后可手动重建知识索引
./venv/bin/python scripts/crawshrimp_dev_harness.py rebuild-knowledge
```

知识索引会落在 `~/.crawshrimp/knowledge/`，分组后的 skill 文档会写到 `~/.crawshrimp/knowledge/skills/<adapter>/<task>.md`。

`scripts/crawshrimp_dev_harness.py` 是标准开发入口。旧的 `scripts/crawshrimp_probe.py` 只保留给历史脚本和按 `probe_id` 直接查看 bundle 的兼容场景。

### 桌面构建与发布

仓库已接入 GitHub Actions 桌面构建：

- `main` 分支每次提交都会自动构建 macOS / Windows 桌面包
- 构建成功后会自动刷新 [`desktop-latest`](https://github.com/howtimeschange/crawshrimp/releases/tag/desktop-latest)
- Release 中的桌面包已内置 Python runtime，目标是“下载即可运行”

---

## 目录结构

```
crawshrimp/
├── core/                     # Python 底座
│   ├── api_server.py         # FastAPI 入口，所有 HTTP 端点
│   ├── cdp_bridge.py         # CDP 连接管理（websockets 直连）
│   ├── js_runner.py          # JS 注入执行器（分页 / 超时 / 重试）
│   ├── adapter_loader.py     # 适配包扫描 / 安装 / 校验
│   ├── scheduler.py          # 任务调度（APScheduler）
│   ├── data_sink.py          # 数据落盘（Excel / JSON / SQLite）
│   ├── notifier.py           # 通知推送（钉钉 / Feishu / Webhook）
│   ├── config.py             # 全局配置读写
│   └── models.py             # Pydantic 数据模型
├── app/                      # Electron + Vue 3 前端
│   ├── src/main.js           # Electron 主进程
│   ├── src/preload.js        # IPC bridge（window.cs.*）
│   └── src/renderer/         # Vue 3 视图
├── adapters/                 # 内置适配包
│   ├── shopee-plus-v2/       # Shopee 优惠券批量创建
│   ├── lazada-plus-v1/       # Lazada 优惠券/促销批量创建
│   ├── temu/                 # Temu 运营助手
│   ├── shein-helper/         # SHEIN 商品评价 / 商品明细导出
│   └── jd/                   # 京东价格监控
└── sdk/                      # 开发工具 & 规范
    ├── ADAPTER_GUIDE.md      # 开发文档（详细版）
    └── manifest.schema.json  # manifest.yaml JSON Schema
```

---

## 安装适配包

### 从本地目录安装

```bash
curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path": "/path/to/my-adapter"}'
```

本地开发如果希望“改完源码立即生效”，推荐直接用 `link` 安装：

```bash
curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path": "/path/to/my-adapter", "install_mode": "link"}'
```

`link` 只支持目录安装，不支持 ZIP。运行时会直接指向源码目录，适合本地开发、harness 调试和反复修改 phase/shared 逻辑。发包或模拟用户安装时，再切回默认 `copy` 或 ZIP。

### 从 ZIP 包安装

```bash
curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -d '{"path": "/path/to/adapter.zip"}'
```

也可以在 GUI 的「我的脚本」页面点击安装按钮，选择文件夹或 ZIP 文件。

---

## 写一个适配包

最小结构：

```
my-adapter/
  manifest.yaml
  my-task.js
```

**manifest.yaml（最简版）**

```yaml
id: my-adapter
name: 我的适配包
version: 1.0.0
entry_url: https://example.com

tasks:
  - id: scrape_data
    name: 抓取数据
    script: my-task.js
    trigger:
      type: manual
    output:
      - type: excel
        filename: "数据_{date}.xlsx"
```

**my-task.js（最简版）**

```js
;(async () => {
  const data = []
  document.querySelectorAll('table tr').forEach(row => {
    const cells = [...row.querySelectorAll('td')].map(td => td.textContent.trim())
    if (cells.length) data.push({ col1: cells[0], col2: cells[1] })
  })
  return { success: true, data, meta: { has_more: false } }
})()
```

详细开发文档见 → **[sdk/ADAPTER_GUIDE.md](sdk/ADAPTER_GUIDE.md)**

### `file_excel` 模板能力

`file_excel` 现在支持直接在任务页下载适配包自带模板：

- 可配置多个模板入口，比如 Excel 主模板 + 字段说明 CSV
- 运行时会自动解析模板真实路径，兼容开发环境、内置资源和 `~/.crawshrimp/adapters/`
- `.xlsx/.xls/.xlsm` 会额外注入 `file.sheets`
- 任务可通过 `execution_ui_mode: precheck_before_live` 声明“先预检再 live”的执行交互
- 可配合 `validation_only_label` / `auto_precheck_note` 自定义“仅校验”按钮文案和执行提示
- Excel 导出侧也支持通过 `sheet_key + sheets` 声明多 sheet 工作簿，并为每个 sheet 单独配置列顺序和分组表头

以 Lazada 为例，一个模板工作簿可以同时包含：

- `Vouchers` 主表
- `FlexiTiers` 阶梯表
- `Instructions` 概览页
- `填写说明` 逐列说明页

如果任务声明了：

```yaml
tasks:
  - id: voucher_batch_create
    execution_ui_mode: precheck_before_live
    validation_only_label: 仅校验 Excel
    auto_precheck_note: 执行前会自动做 Excel 预检
```

桌面端会把原本的 `execute_mode` 单选收起，改成：

- 主按钮：先跑 `plan` 预检，通过后再自动进入 `live`
- 次按钮：只跑一次预检，不执行 live

脚本侧的参数契约不变，仍建议保留 `execute_mode=plan/live` 供后端和脚本识别。

### `file_images` 多图参数

任务参数现在也支持 `file_images`：

- GUI 侧可一次选择多张 `png/jpg/jpeg`
- 脚本收到的是 `paths` 数组，适合传给上传控件
- 底座内置了浏览器侧 `File + DataTransfer` 注入流程，适合图片类批量上传任务

示例：

```yaml
- id: label_images
  type: file_images
  label: 标签图
  required: true
  hint: 可多选，脚本里会收到本地文件路径数组
```

---

## 相关项目

- [jd-price-monitor](https://github.com/howtimeschange/jd-price-monitor) — 京东价格监控（独立版，crawshrimp JD 适配包的前身）
- [temu-assistant](https://github.com/howtimeschange/temu-assistant) — Temu 运营助手（独立版，crawshrimp Temu 适配包的前身）

---

## License

MIT
