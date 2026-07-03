# 🦐 抓虾 · crawshrimp

**通用网页自动化底座** — 安装适配包，点击运行，数据自动导出。

[![GitHub release](https://img.shields.io/github/v/release/howtimeschange/crawshrimp?label=latest)](https://github.com/howtimeschange/crawshrimp/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## 本次更新（2026-07-03 / v1.4.38）

- 桌面端版本升级到 `v1.4.38`，正式发布会输出 `crawshrimp-v1.4.38-*` 命名的桌面安装包。
- 新增 PLM 运营助手「尺码表下载器」：按款号批量定位 Balabala PLM 尺寸表单，默认抓取大货阶段尺码表。
- 尺码表下载采用 API 优先实现，复用 PLM 自身 `RequestHandler` 数据链路，能区分款号、阶段、尺码表、修订版并导出完整测量字段。
- 导出结果支持宽表和长表：宽表便于人工查看，长表便于后续清洗、比对和批量处理。
- 尺码表下载器新增“导出目录”参数，可把最终 Excel 复制到用户选择的文件夹；留空时仍使用抓虾运行时默认输出目录。

## 上次更新（2026-07-03 / v1.4.37）

- 桌面端版本升级到 `v1.4.37`，正式发布会输出 `crawshrimp-v1.4.37-*` 命名的桌面安装包。
- 任务中心升级为实例化工作台：支持任务草稿、任务实例、定时计划、运行历史、产物抽屉和 AI 生图审批看板的统一管理。
- 天猫运营助手完善 AI 生图全链路与包装图上传：可沉淀审批批次、复用历史生成结果，并适配新版详情编辑器的上传/发布路径。
- 新增微盟「商品上新」、唯品会「轻供款商品报表」和 MOP 云盘素材下载能力，常用运营任务可以直接从桌面端创建、执行和导出。
- 桌面后端启动、心跳和 Electron/dev bridge 兼容性继续加固，减少后台刷新、端口占用或实例切换时的任务中断。

## 上上次更新（2026-07-01 / v1.4.36）

- 桌面端版本升级到 `v1.4.36`，正式发布会输出 `crawshrimp-v1.4.36-*` 命名的桌面安装包。
- macOS 桌面构建接入 Developer ID Application 签名和 Apple notarization，CI 会用 App Store Connect API Key 完成公证准备。
- macOS 构建开启 Hardened Runtime，并补充 Electron/Python 打包所需 entitlements，降低 Gatekeeper 拦截和运行时签名异常风险。
- GitHub Actions 增加签名、公证配置回归测试，避免后续发布脚本误删 macOS 发行凭据注入。

## 更早更新（2026-07-01 / v1.4.35）

- 桌面端版本升级到 `v1.4.35`，正式发布会输出 `crawshrimp-v1.4.35-*` 命名的桌面安装包。
- 天猫运营助手新增「天猫包装图上传」工作流：可按表格批量读取商品链接和图片包信息，把包装图写入商品 PC 详情草稿。
- 包装图上传链路加入 OCR 辅助锚点识别，并要求命中固定头图、洗唛、尺码、白底黑底、卖点信息等视觉锚点后再替换，减少旧详情页结构变化带来的误判。
- 天猫详情图替换会保留全局活动/奖项详情锚点，避免误删页面内已有活动说明或奖项模块。
- TikTok 达人视频下载兼容代理环境，视频直连下载不再强制绕开系统/网络代理。

## 更早更新（2026-06-25 / v1.4.34）

- 桌面端版本升级到 `v1.4.34`，正式发布会输出 `crawshrimp-v1.4.34-*` 命名的桌面安装包。
- 修复任务运行页参数被后台刷新清空的问题：同一个脚本任务刷新状态时会保留已填写内容，只在真正切换任务时重置表单。
- 森马云盘「森马-天猫AI生图参考素材准备」的 `SKC 编码` 多行输入框现在可以稳定粘贴多行款号，不会出现“刚粘上马上清空”。
- 前端新增任务身份判断回归测试，覆盖同一个 `adapterId::taskId` 刷新时不清空表单、切换到其他任务时才重置的行为。

## 更早更新（2026-06-24 / v1.4.33）

- 桌面端版本升级到 `v1.4.33`，正式发布会输出 `crawshrimp-v1.4.33-*` 命名的桌面安装包。
- 森马云盘新增「森马-天猫AI生图参考素材准备」任务：直接粘贴多行 SKC，按图片包抓取 `3` 全身图和 SKC 同名静物图。
- 新任务输出规则适配天猫 AI 生图参考素材：全身图按 `SKC-全身` 命名，静物图保留网盘原文件名，并打包 zip + 导出 Excel 结果。
- Temu「商品实拍图洗唛合规」新增“仅处理指定 SPU”模式，可按多行 SPU 定向查询和上传标签图。
- 森马云盘 current 模式登录后如果停在 IAM 认证页，会自动回到业务入口再注入脚本，减少登录回跳导致的云盘接口 404。

## 更早更新（2026-06-16 / v1.4.32）

- 桌面端版本升级到 `v1.4.32`，正式发布会输出 `crawshrimp-v1.4.32-*` 命名的桌面安装包。
- 深绘上新助手「整理深绘上新图包」支持识别 `款号+AI已回...` 这类模拍文件夹名，能正确递归进入文件夹收集正常模特图。
- 修复部分款号只下载到静物图的问题：此前脚本没有进入 `+AI` 状态文件夹，只拿到搜索接口直接返回的白底图，白底图又被 SOP 过滤，导致正常模特图缺失。
- 深绘图包整理回归测试补充 `+` 状态后缀文件夹匹配场景，避免后续再退回只识别空格、下划线、短横线分隔符。

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
| `amazon-ops-assistant` | Amazon 运营本地工具 | 商品 Reviews 全量抓取、商品标签 PDF 批量拆分处理 |
| `aliexpress-ops-assistant` | 速卖通跨境卖家中心 | 商品发布页第一张主图批量抠图并导出新图片地址 |
| `cross-border-research` | Renner / Zara 跨境站点 | Renner 儿童鞋服类目调研、Zara 美国/巴西上新与促销调研 |
| `dasen-ops-assistant` | 森马 AI 工作台 | 案例库批量新建、编辑模板导出、按 Excel 批量编辑已发布案例 |
| `shopee-plus-v2` | Shopee 卖家后台 | 多门店多券型优惠券批量创建（商店 / 新买家 / 回购买家 / 关注礼） |
| `lazada-plus-v1` | Lazada Seller Center | 多站点优惠券/促销批量创建（Regular / Flexi Combo / 新买家 / 粉丝券） |
| `mop-ops-assistant` | 千牛素材中心 / MOP | KOL 素材批量转短视频、搜推图文素材批量发布、商家编码 KOC 素材包匹配、云盘素材批量下载 |
| `plm-ops-assistant` | Balabala Centric PLM | 尺寸表单尺码表批量下载，支持按款号、阶段、尺码表和修订版区分并导出宽表 / 长表 |
| `temu` | Temu 卖家后台 | 商城-单款商品评价 / 商品数据 / 活动数据 / 店铺流量 / 商品流量（列表/详情） / 对账中心 / 售后管理 / 商品评价 / 保税仓退货 / 资金限制 / 建议零售价（爬取/填写） / 抽检结果明细 / 商品品质分析 / 站点商品 / 商品实拍图洗唛合规 |
| `shein-helper` | SHEIN 全球商家中心 / 公网站点 | 商品评价、商品明细、商品品质分析、公网搜索/店铺结果商品导出 |
| `jd` | 京东商家后台 | 全店价格导出 / 破价巡检 |
| `semir-cloud-drive` | 森马云盘 / 豆包 / Gemini | 款图批量下载打包、天猫搭配购素材匹配、天猫 AI 生图参考素材准备、按 Excel 批量下载素材并自动生图 |
| `shenhui-new-arrival` | 森马云盘 / 深绘 DEEPDRAW | 上新图包整理、PDF 吊牌水洗截图、深绘图片包上传 |
| `shopee-webchat-bulk-reply` | Shopee 聊聊 | 按 Excel 批量搜索买家会话，预演或批量发送消息 |
| `tiktok-ops-assistant` | TikTok Shop Seller Center / Affiliate Center | 商品管理导出、商品评分抓取、联盟达人视频列表采集、视频下载打包 |
| `tmall-ops-assistant` | 天猫商品详情页 | 按多个商品链接批量抓取买家评价、追评、图片与规格信息；天猫 AI 生图全链路审批/创建；按表格批量上传包装图并替换 PC 详情草稿 |
| `vipshop-ops-assistant` | 唯品会供应商后台 | 轻供款商品报表导出与商品字段归一化 |
| `weimob-ops-assistant` | 微盟商户后台 / 森马 MDM | 商品上新自动化、EAN/SKU 映射预演与渠道上新保存 |

> 当前仓库内只保留一条 Shopee 适配线：`shopee-plus-v2`。旧 `shopee` / `shopee-plus` 已移除。

### 最近更新

- `v1.4.38`：新增 PLM 运营助手「尺码表下载器」，按款号批量导出尺寸表单大货阶段尺码表，支持宽表 / 长表和自定义导出目录。
- `v1.4.37`：任务中心升级为实例化工作台，新增任务草稿、定时计划、产物抽屉和天猫 AI 生图审批批次；新增微盟、唯品会、MOP 运营任务。
- `v1.4.36`：macOS 桌面构建接入 Developer ID 签名和 Apple 公证，开启 Hardened Runtime 并补充 entitlements。

---

## 快速开始

### 方式一：下载桌面版（推荐）

直接前往 GitHub Releases 下载已经打包好的桌面程序：

- **滚动桌面构建**：[`desktop-latest`](https://github.com/howtimeschange/crawshrimp/releases/tag/desktop-latest)
- **所有发布列表**：[`Releases`](https://github.com/howtimeschange/crawshrimp/releases)

当前 Release 会自动包含：

- macOS 桌面包（dmg）
- Windows 安装包（exe）与 blockmap
- 内置 Python 运行时

当前桌面安装包命名规则：

- `crawshrimp-v版本号-mac-arm64.dmg`
- `crawshrimp-v版本号-mac-x64.dmg`
- `crawshrimp-v版本号-win-x64.exe`

也就是说，**普通用户不需要自己安装 Python / Node.js**，下载后即可使用。

使用方式：

1. 下载对应平台安装包
2. 安装并打开抓虾桌面程序
3. 在任务页按需下载 Excel / CSV 模板并填写
4. 在 Chrome 中登录目标平台后运行任务

> `desktop-latest` 是自动刷新的滚动桌面构建，便于人工下载测试；当前应用内自动更新已暂停。

#### macOS 安装说明

1. 下载 `.dmg` 文件后双击打开，将抓虾拖入 Applications 文件夹。
2. `v1.4.36` 起 macOS 包已接入 Developer ID 签名和 Apple 公证，正常情况下可直接打开。
3. 如果旧包或下载隔离仍提示无法验证，打开终端执行：

```bash
xattr -cr "/Applications/抓虾.app"
```

解除苹果隔离限制后即可启动。抓虾会使用独立 Chrome 配置自动启动带 `--remote-debugging-port=9222` 参数的受管 Chrome；也可以按开发者说明手动启动 Chrome 后再运行任务。

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

除 `/health` 和 API 文档页外，本地 API 默认要求 `X-Crawshrimp-Token` 请求头。`bash dev.sh` 会自动生成并打印 token；CLI harness 会优先读取 `CRAWSHRIMP_API_TOKEN` 或运行时数据目录里的 `api-token`。

运行时数据目录会先验证真实可写性，再被后端和脚本共同使用。默认策略是：Windows 优先 `%LOCALAPPDATA%\crawshrimp`，macOS 优先 `~/Library/Application Support/crawshrimp`，其他环境使用 `~/.crawshrimp`；如果默认目录不可写会 fallback 到下一个候选目录。也可以通过 `CRAWSHRIMP_DATA=/absolute/path` 显式指定，此时指定目录不可写会直接报错，避免静默写到意外位置。

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

知识索引会落在运行时数据目录的 `knowledge/`，分组后的 skill 文档会写到 `knowledge/skills/<adapter>/<task>.md`。

`scripts/crawshrimp_dev_harness.py` 是标准开发入口。旧的 `scripts/crawshrimp_probe.py` 只保留给历史脚本和按 `probe_id` 直接查看 bundle 的兼容场景。

`capture` 和 `probe` 默认不保存响应 body；确需排查响应内容时再显式追加 `--response-body`，返回内容会先做 token、cookie、密码等敏感字段脱敏。

### 桌面构建与发布

仓库已接入 GitHub Actions 桌面构建：

- `main` 分支每次提交都会自动构建 macOS / Windows 桌面包
- 构建成功后会自动刷新 [`desktop-latest`](https://github.com/howtimeschange/crawshrimp/releases/tag/desktop-latest)
- 推送 `v*` tag 会创建正式版本 Release
- Release 中的桌面包已内置 Python runtime，目标是“下载即可运行”
- macOS 构建会在 GitHub Secrets 配置齐全时执行 Developer ID 签名和 Apple notarization

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
│   ├── amazon-ops-assistant/  # Amazon 运营本地工具
│   ├── aliexpress-ops-assistant/ # 速卖通商品抠图下载
│   ├── cross-border-research/ # Renner / Zara 跨境调研
│   ├── dasen-ops-assistant/   # 森马 AI 工作台案例库工具
│   ├── shopee-plus-v2/       # Shopee 优惠券批量创建
│   ├── shopee-webchat-bulk-reply/ # Shopee 聊聊批量发信
│   ├── lazada-plus-v1/       # Lazada 优惠券/促销批量创建
│   ├── temu/                 # Temu 运营助手
│   ├── shein-helper/         # SHEIN 商品评价 / 商品明细 / 公网商品导出
│   ├── jd/                   # 京东价格监控
│   ├── semir-cloud-drive/    # 森马云盘图片工具
│   ├── shenhui-new-arrival/  # 深绘上新助手
│   ├── tiktok-ops-assistant/ # TikTok 运营助手
│   └── tmall-ops-assistant/  # 天猫运营助手
└── sdk/                      # 开发工具 & 规范
    ├── ADAPTER_GUIDE.md      # 开发文档（详细版）
    └── manifest.schema.json  # manifest.yaml JSON Schema
```

---

## 安装适配包

### 从本地目录安装

```bash
TOKEN_FILE="$(PYTHONPATH=. ./venv/bin/python - <<'PY'
from core import runtime_paths
print(runtime_paths.data_root() / "api-token")
PY
)"

curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -H "X-Crawshrimp-Token: $(cat "$TOKEN_FILE")" \
  -d '{"path": "/path/to/my-adapter"}'
```

本地开发如果希望“改完源码立即生效”，推荐直接用 `link` 安装：

```bash
curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -H "X-Crawshrimp-Token: $(cat "$TOKEN_FILE")" \
  -d '{"path": "/path/to/my-adapter", "install_mode": "link"}'
```

`link` 只支持目录安装，不支持 ZIP。运行时会直接指向源码目录，适合本地开发、harness 调试和反复修改 phase/shared 逻辑。发包或模拟用户安装时，再切回默认 `copy` 或 ZIP。

### 从 ZIP 包安装

```bash
curl -X POST http://127.0.0.1:18765/adapters/install \
  -H 'Content-Type: application/json' \
  -H "X-Crawshrimp-Token: $(cat "$TOKEN_FILE")" \
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
- 运行时会自动解析模板真实路径，兼容开发环境、内置资源和运行时数据目录下的 `adapters/`
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
