# Crawshrimp Development Notes

抓虾当前是本地优先的电商执行与 AI 内容生产平台，不是早期只做 JS 注入和 Excel 导出的 v1 原型。开始开发前先读：

1. `SPEC.md`：当前产品架构、Crawshrimp/Harness 关系、平台与森马定制边界；
2. `PRODUCT.md`：产品用户、目标与产品原则；
3. `sdk/ADAPTER_GUIDE.md`：Adapter 配置、参数、脚本动作与开发协议；
4. `README.md`：完整功能、环境、发布与云端运行说明。

## Current Architecture

```text
Electron 43 + Vue
  ↕ loopback HTTP / token
FastAPI + SQLite + filesystem
  ├─ Adapter runtime / JS phase runner / scheduler
  ├─ Python business handlers / PDF / OCR / AI providers
  ├─ Chrome CDP / local files / enterprise cloud drives
  ├─ AI image and video workbenches
  └─ optional cloud approval machine agent

Cloudflare approval workbench
  ├─ login / RBAC / audit / prompt / batch review
  └─ capability-gated machine jobs with lease and idempotency
```

`crawshrimp-harness` 是独立发布的智能体交互线。它通过 DSH + MCP 调用 Harness 自有后端与 Adapter 副本，复用抓虾能力代码，但保留自己的会话、权限和发布架构；不要用整仓复制同步两条开发线。

## Quick Start

从仓库根目录执行；Python 3.11+、Node.js 22.12.0+。以下是 macOS/Linux shell 示例。

```bash
python3 -m venv venv
venv/bin/pip install -r core/requirements.txt
npm --prefix app ci
```

终端一：

```bash
bash dev.sh
```

终端二：

```bash
cd app
npm run dev
```

默认本地 API 是 `http://127.0.0.1:18765`，Vite 是 `http://127.0.0.1:5173`。业务 API 默认校验 `X-Crawshrimp-Token`；健康检查、文档和部分资产/审核路由免 token，准确白名单见 `core/api_server.py` 的 `_is_public_api_path()`。

两个终端应使用相同的 `CRAWSHRIMP_DATA` 和 token 配置。桌面端还支持已保存的数据目录；若其目录与独立后端不同，应显式指定同一目录。Electron 会检查并复用兼容后端，必要时自行启动后端；不要求并行运行两个核心服务。

## Adapter Development Loop

1. 判断它是简单页面任务，还是需要文件、后端、AI/OCR、PDF、云盘、审批和外部交付的复杂任务。
2. 沿用 `core/models.py` 支持的 Manifest 字段，在 `tasks` 中配置脚本、参数、触发方式与输出。额外的 v2 权限/能力声明目前不会自动形成运行时门禁。
3. 开发态用 `install_mode=link` 指向源码目录。
4. 用 dev harness 建立页面和请求证据，再写 JS phase/shared 或后端处理逻辑。
5. 先跑任务回归与相关验收测试，再安装/运行最小 live 验证。
6. 检查真实产物和目标系统读回，不只看任务状态。

Link 安装：

```bash
# 默认从与服务相同的运行目录读取；显式环境 token 优先。
CRAWSHRIMP_API_TOKEN="$(PYTHONPATH=. venv/bin/python - <<'PYTOKEN'
import os
from pathlib import Path
from core import runtime_paths
token = os.environ.get('CRAWSHRIMP_API_TOKEN', '').strip()
if not token:
    lock_dir = os.environ.get('CRAWSHRIMP_BACKEND_LOCK_DIR', '').strip()
    root = Path(lock_dir).expanduser() if lock_dir else runtime_paths.data_root()
    token = (root / 'api-token').read_text().strip()
print(token)
PYTOKEN
)"
export CRAWSHRIMP_API_TOKEN

curl -X POST http://127.0.0.1:18765/adapters/install \
  -H "X-Crawshrimp-Token: $CRAWSHRIMP_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"path": "/absolute/path/to/repo/adapters/<adapter_id>", "install_mode": "link"}'
```

Dev harness（在仓库根目录执行，替换 adapter/task 示例；CLI 会读取环境 token 或运行目录的 `api-token`）：

```bash
venv/bin/python scripts/crawshrimp_dev_harness.py snapshot --adapter temu --task goods_traffic_detail
venv/bin/python scripts/crawshrimp_dev_harness.py knowledge --adapter temu --task goods_traffic_detail --query drawer
venv/bin/python scripts/crawshrimp_dev_harness.py capture --adapter temu --task goods_traffic_detail --capture-mode passive
venv/bin/python scripts/crawshrimp_dev_harness.py eval --adapter temu --task goods_traffic_detail --file /absolute/path/to/probe.js
```

运行时真值：

- `link`：运行时 Adapter 目录是源码符号链接；
- `copy`：运行时执行安装副本，源码修改后必须重新安装；
- 设置 `CRAWSHRIMP_DATA` 后，Adapter 位于 `$CRAWSHRIMP_DATA/adapters/<adapter_id>/`。

## Task Progress Contract

- 脚本通过 `meta.shared` 传递跨 phase 状态；它本身不等于跨进程持久化检查点，恢复能力需由具体任务实现。
- `total_rows`、`current_exec_no`、`current_row_no`、`batch_no`、`total_batches` 等字段必须来自真实业务状态。
- 不为显示百分比伪造 total。
- 前端增强进度只在 `app/src/renderer/utils/taskProgress.js` 的精确白名单中启用。

## Validation

按改动面选择最小但完整的验证。Python CI 使用 pytest，单用 unittest discover 会漏掉函数式 pytest 用例。首次运行 Python 测试先安装 `tests/requirements.txt`；云端检查需先安装该子项目依赖。

```bash
# 测试依赖
venv/bin/pip install -r tests/requirements.txt

# Adapter loader
PYTHONPATH=. venv/bin/python -m pytest tests/test_adapter_loader.py -v

# Python backend
PYTHONPATH=. venv/bin/python -m pytest tests -v

# Adapter JS
node --test tests/*.test.js

# Electron / renderer
npm --prefix app test
npm --prefix app run vite:build

# Cloud approval
npm --prefix cloud/approval-workbench ci
npm --prefix cloud/approval-workbench run check

# Patch hygiene
git diff --check
```

改 Adapter 后仍需按任务风险进行运行时同步和最小 live 验证。涉及导出时检查文件存在、签名/格式、行数、范围和重复键；涉及平台写入时检查目标系统读回。

## API Discovery

运行后打开 `http://127.0.0.1:18765/docs` 查看当前接口。与 Adapter 协议直接相关的入口：

```text
GET    /adapters
POST   /adapters/install
DELETE /adapters/{adapter_id}
PATCH  /adapters/{adapter_id}/enable
GET    /tasks
POST   /tasks/{adapter_id}/{task_id}/run
GET    /tasks/{adapter_id}/{task_id}/status
GET    /tasks/{adapter_id}/{task_id}/logs
POST   /tasks/{adapter_id}/{task_id}/pause
POST   /tasks/{adapter_id}/{task_id}/resume
POST   /tasks/{adapter_id}/{task_id}/stop
```

`/run` 触发后台执行，返回成功不等于业务完成；随后查询 `/status`、`/logs` 并验收产物。`/resume` 用于当前进程中暂停的任务，不保证重启后恢复。任务实例另有 `/task-instances` 与 `/task-instances/{instance_uid}/run` 等入口，完整请求结构以 OpenAPI 为准。
