# 🦐 抓虾 · crawshrimp

**通用网页自动化底座** — 安装适配包，点击运行，数据自动导出。

[![GitHub release](https://img.shields.io/github/v/release/howtimeschange/crawshrimp?label=latest)](https://github.com/howtimeschange/crawshrimp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 本次更新（2026-04-21 / v1.2.1）

- 桌面端版本升级到 `v1.2.1`，滚动发布 `desktop-latest` 会输出 `crawshrimp-v1.2.1-*` 命名的桌面安装包。
- 补齐 Electron 主进程的后端启动控制：所有 IPC 在访问 FastAPI 前会先等待 `/health` ready，不再和首次冷启动抢跑。
- Windows 桌面端的后端启动等待窗口从 `10s` 提升到 `30s`，用于覆盖首次安装后 `python.exe` 冷启动、磁盘冷缓存和安全扫描带来的额外延迟。
- 后端子进程现在会把 `spawn` 失败、ready 前提前退出等真实错误直接打到主进程日志里，不再只留下 `connect ECONNREFUSED 127.0.0.1:18765` 这种表层报错。
- 新增 Node 回归测试，覆盖“并发请求只启动一次后端”“启动阶段真实错误向上抛出”两类关键场景。

## 上次大更新（2026-04-20 / v1.2.0）

- 桌面端版本升级到 `v1.2.0`，滚动发布 `desktop-latest` 会直接带出本次 SHEIN + Temu 更新说明。
- 新增 `shein-helper` 适配包，首版支持 `商品评价` 与 `商品分析-商品明细` 两条链路，默认继承当前页面筛选并全量分页导出。
- SHEIN `商品分析-商品明细` 支持 `当前列表 / 仅 SKC / 仅 SPU / SKC + SPU` 维度导出，以及 `昨天 / 近7天 / 近30天 / 自定义` 统计时间覆盖；导出按 `SKC列表 / SPU列表` 双 sheet 落盘。
- 导出文件命名上下文新增 SHEIN 识别逻辑，会稳定输出 `Shein_脚本名_时间范围_时间区间`，不再依赖页面店铺文案。
- Temu 运营助手升级到 `1.5.4`，`后台-商品流量-列表` 已补齐 API 超时重试预算、列表真实 ready 校验和恢复后重置重试次数，单页 API 拉取上限提升到 `500`。
- JS 执行器分页上限提升到 `1000` 页，并在脚本持续返回 `has_more=true` 时显式报错，避免长任务静默截断。

## 上次大更新（2026-04-16）

- Temu 运营助手升级到 `1.5.3`，补齐 `后台-保税仓退货`、`后台-资金限制`、`后台-建议零售价爬取`、`后台-建议零售价填写`、`后台-抽检结果明细`、`后台-商品品质分析` 六条新链路。
- `保税仓退货 / 建议零售价 / 商品品质分析` 等链路补强了注入优先、页面 API 读数和字段对位，导出不再只剩原始行文本或出现列错位。
- `资金限制 / 抽检结果明细 / 商品品质分析` 现在支持按业务结构拆成多 sheet 导出，适合列表 + 详情、分析 + 优化这类复合结果。
- `建议零售价爬取`、`商品品质分析`、`资金限制` 已接入统一增强进度 UI，任务页、脚本列表和总览侧边栏都会显示页级/批次进度。
- 左侧脚本树已支持独立上下滚动，脚本数量继续增长时不会把返回按钮和标题一起挤出可视区。
- 后端导出链路新增 Excel 多 sheet 配置能力，后台任务早崩也会正确回落到 `error` 状态，方便 UI 和日志判断真实失败。

## 上上次大更新（2026-04-15 / v1.1.0）

- 桌面端版本升级到 `v1.1.0`，GitHub 滚动发布会直接显示当前桌面版本号。
- 桌面安装包改成稳定 ASCII 命名，避免 GitHub Release 上出现 `-1.0.2.dmg`、`Setup.1.0.2.exe` 这类不可读产物名。
- Temu 运营助手新增 `后台-商品评价`，支持地区切换、评价时间快捷项、自定义时间范围和全量分页导出。
- Temu `商品数据 / 商品评价 / 活动数据 / 店铺流量` 等后台导出命名已统一到“店铺名 + 脚本名 + 时间范围 + 操作时间”风格。
- 商品数据自定义日历链路补强了注入优先、读回校验和失败回退，自定义日期范围更稳定。
- GitHub Release 更新说明改为读取仓库内版本化 release notes，滚动发布文案不再是纯模板。

## 更早大更新（2026-04-13）

- Temu 适配包补齐 `后台-活动数据`、`后台-店铺流量`、`后台-商品流量-列表`、`后台-商品流量-详情` 四条核心数据链路，支持多站点、多时间范围与全量分页采集。
- 新增 Temu `后台-对账中心` 导出适配包，可直接从账单中心页面抓取并导出结果。
- 商品流量详情链路支持从列表结果文件继续跑详情，导出按真实分组表头落 Excel，并补了 SPU 模板。
- 任务运行页、脚本列表和总览页的进度展示逻辑已统一，批量任务会更稳定地显示阶段、条数和恢复状态。
- JS 执行器、API 和数据落盘层同步增强了超时恢复、导出保护和多站点执行稳定性。
- 针对 Temu 新链路补充了 activity data / bill center / goods traffic recovery 等回归测试和交接文档。

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

- 桌面端升级到 `v1.2.1`，GitHub `desktop-latest` 会展示本次 Windows 启动链路修复说明并输出 `crawshrimp-v1.2.1-*` 命名的桌面安装包。
- Windows 首装/冷启动场景已补齐后端 ready 等待、启动超时放宽和真实错误透传，不再只在前端看到 `ECONNREFUSED 127.0.0.1:18765`。
- 桌面端升级到 `v1.2.0`，GitHub `desktop-latest` 会展示本次发布说明并输出 `crawshrimp-v1.2.0-*` 命名的桌面安装包。
- 新增 `shein-helper@0.1.0`，支持 `商品评价` 与 `商品分析-商品明细` 全量导出，默认继承当前页面筛选。
- SHEIN `商品分析-商品明细` 已支持 SKC / SPU 双维度导出和多 sheet Excel 列分组。
- SHEIN / Temu 导出文件名上下文已统一补强，时间范围会优先回填当前页面或自定义参数。
- Temu 适配包升级到 `1.5.4`，`后台-商品流量-列表` 已补强 API 超时重试、页面恢复后的真实列表 ready 校验和大分页抓取。
- JS 执行器分页上限提升到 `1000`，并新增超限显式报错与回归测试。
- 仓库当前内置 `lazada-plus-v1`、`shopee-plus-v2`、`jd`、`temu`、`shein-helper` 五条主要适配线。

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

> `desktop-latest` 是自动刷新的滚动预发布，只要 `main` 分支桌面构建成功，就会自动更新为最新可下载版本。

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
