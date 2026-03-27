"""
FastAPI service - complete task execution pipeline
Electron spawns this process; all GUI calls go through HTTP on localhost:18765

Bundling notes (for electron-builder / python-build-standalone):
  - All deps (fastapi, uvicorn, apscheduler, openpyxl, websockets, pyyaml) must be
    pre-installed in the bundled Python env (see app/scripts/bundle-python.sh)
  - Built-in adapters (adapters/) are shipped as extraResources alongside Python scripts
  - User-installed adapters live in ~/.crawshrimp/adapters/
"""
import asyncio
import base64
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core.config import load_config, save_config
from core import adapter_loader
from core import data_sink
from core import notifier
from core import scheduler as sched_module
from core.cdp_bridge import get_bridge, reset_bridge

logger = logging.getLogger(__name__)

# In-memory task run state for live status / logs
_run_logs: dict = {}   # job_id -> list[str]
_run_status: dict = {} # job_id -> {'status', 'run_id', 'records'}


async def _execute_task(adapter_id: str, task_id: str, params: dict = None):
    """
    Core task execution pipeline:
    1. Find / create matching Chrome tab via CDP
    2. Optional auth check + login wait
    3. Inject + execute JS script
    4. Persist results (Excel/JSON)
    5. Send notifications if configured
    6. Record run state in SQLite
    """
    from core.js_runner import JSRunner
    from core.models import OutputType

    jid = f"{adapter_id}::{task_id}"
    _run_logs[jid] = []
    _run_status[jid] = {'status': 'running', 'run_id': None, 'records': 0}

    def log(msg: str):
        logger.info(msg)
        _run_logs[jid].append(msg)

    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise ValueError(f"Adapter not found: {adapter_id}")

    task = next((t for t in m.tasks if t.id == task_id), None)
    if not task:
        raise ValueError(f"Task not found: {task_id}")

    run_id = data_sink.begin_run(adapter_id, task_id)
    _run_status[jid]['run_id'] = run_id

    try:
        log(f"[{adapter_id}/{task_id}] Starting...")

        bridge = get_bridge()
        run_params = params or {}
        mode = (run_params.get('mode') or 'current').strip().lower()

        tab = None
        if mode == 'current':
            # current 模式：优先选最贴近"当前进行中"状态的 tab
            # Shopee 不能盲目优先 /new：浏览器里若残留旧的错误创建页，会把新任务吸过去
            # 正确策略：优先营销中心主页 / 列表页；真正的 /new 由脚本按当前行 voucherType 主动导航进入
            all_tabs = [t for t in bridge.get_tabs() if t.get('type') == 'page']
            preferred_prefixes = [
                'https://seller.shopee.cn/portal/marketing/vouchers/list',
                m.entry_url,
                'https://seller.shopee.cn/portal/marketing/vouchers/new',
            ] if adapter_id == 'shopee' else [m.entry_url]

            for prefix in preferred_prefixes:
                tab = next((t for t in all_tabs if t.get('url', '').startswith(prefix)), None)
                if tab:
                    break

            if not tab:
                raise RuntimeError(f"未找到已打开的目标页面：{m.entry_url}。请选择“全新页面（重新导航）”或先手动打开并登录。")
        else:
            log(f"mode=new，尝试新建页面：{m.entry_url}")
            try:
                tab = bridge.new_tab(m.entry_url)
            except Exception as e:
                log(f"新建 tab 失败，尝试复用现有 tab: {e}")
                tab = bridge.find_tab(m.entry_url)
            if not tab:
                raise RuntimeError(f"无法打开或找到目标页面：{m.entry_url}")

        log(f"Found tab: {tab.get('url', '')[:120]}")
        runner = JSRunner(
            bridge.get_tab_ws_url(tab),
            tab_id=str(tab.get('id') or ''),
        )

        # Shopee current 模式：如果已经命中 marketing 域内页面，直接视为当前会话可用，避免误判卡在登录等待
        skip_auth_wait = (
            adapter_id == 'shopee' and
            mode == 'current' and
            str(tab.get('url', '')).startswith('https://seller.shopee.cn/portal/marketing')
        )

        # 可选登录检测：若 manifest 配置了 auth.check_script，则最多等 5 分钟
        if (not skip_auth_wait) and m.auth and m.auth.check_script:
            adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
            auth_path = adapter_dir / m.auth.check_script
            if auth_path.exists():
                log(f"运行登录检测：{m.auth.check_script}")
                auth_result = await runner.evaluate(auth_path.read_text(encoding='utf-8'))
                logged_in = False
                if auth_result.success:
                    if isinstance(auth_result.meta, dict):
                        logged_in = bool(auth_result.meta.get('logged_in'))
                    if not logged_in and auth_result.data and isinstance(auth_result.data, list):
                        logged_in = bool((auth_result.data[0] or {}).get('logged_in'))

                if not logged_in:
                    login_url = (m.auth.login_url or m.entry_url)
                    log(f"检测到未登录，跳转登录页：{login_url}")
                    await runner.evaluate(f"location.href = {login_url!r}; ({'{'} success: true, data: [], meta: {{ has_more: false }} {'}'})")
                    await asyncio.sleep(2)
                    wait_seconds = 300
                    for i in range(wait_seconds):
                        auth_result = await runner.evaluate(auth_path.read_text(encoding='utf-8'))
                        ok = False
                        if auth_result.success:
                            if isinstance(auth_result.meta, dict):
                                ok = bool(auth_result.meta.get('logged_in'))
                            if not ok and auth_result.data and isinstance(auth_result.data, list):
                                ok = bool((auth_result.data[0] or {}).get('logged_in'))
                        if ok:
                            log("用户已完成登录，继续执行任务")
                            break
                        if i in (0, 4) or (i + 1) % 15 == 0:
                            log(f"等待用户登录 Shopee… {i + 1}/{wait_seconds}s")
                        await asyncio.sleep(1)
                    else:
                        raise RuntimeError("等待登录超时（5分钟）。请完成 Shopee 登录后重试。")

                if mode == 'new':
                    # 登录完成后，重新导航回业务入口页
                    log(f"导航回业务入口：{m.entry_url}")
                    await runner.evaluate(f"location.href = {m.entry_url!r}; ({'{'} success: true, data: [], meta: {{ has_more: false }} {'}'})")
                    await asyncio.sleep(3)

        adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
        script_path = adapter_dir / task.script
        if not script_path.exists():
            raise FileNotFoundError(f"Script not found: {script_path}")

        log(f"Injecting script: {task.script}")
        data = await runner.run_script_file(script_path, params=run_params)
        log(f"Script complete. Records: {len(data)}")

        # Process outputs
        output_files = []
        for out in task.output:
            if out.type == OutputType.excel:
                fname = out.filename or "{task_id}_{date}.xlsx"
                path = data_sink.export_excel(data, adapter_id, task_id, fname)
                output_files.append(path)
                log(f"Excel exported: {path}")

            elif out.type == OutputType.json:
                fname = out.filename or "{task_id}_{date}.json"
                path = data_sink.export_json(data, adapter_id, task_id, fname)
                output_files.append(path)
                log(f"JSON exported: {path}")

            elif out.type == OutputType.notify:
                if notifier.should_notify(out.condition, data):
                    try:
                        notifier.send(
                            channel=out.channel or 'dingtalk',
                            title=f"{m.name} - {task.name}",
                            records=len(data),
                            adapter_name=m.name,
                            task_name=task.name,
                            sample_rows=data[:3] if data else None,
                        )
                        log(f"Notification sent via {out.channel}")
                    except Exception as e:
                        log(f"Notification failed: {e}")
                else:
                    log(f"Notification skipped (condition not met: {out.condition})")

        data_sink.finish_run(run_id, len(data), output_files)
        _run_status[jid] = {'status': 'done', 'run_id': run_id, 'records': len(data)}
        log(f"[{adapter_id}/{task_id}] Done. {len(data)} records.")

    except Exception as e:
        err = str(e)
        log(f"[{adapter_id}/{task_id}] ERROR: {err}")
        data_sink.fail_run(run_id, err)
        _run_status[jid] = {'status': 'error', 'run_id': run_id, 'records': 0, 'error': err}
        raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Init DB
    data_sink.init_db()

    # Install built-in adapters
    built_in = Path(__file__).parent.parent / "adapters"
    if built_in.exists():
        for d in built_in.iterdir():
            if d.is_dir() and (d / "manifest.yaml").exists():
                try:
                    adapter_loader.install_from_dir(str(d))
                except Exception as e:
                    logger.warning(f"Built-in adapter failed {d.name}: {e}")

    adapter_loader.scan_all()

    # Register scheduled tasks
    for item in adapter_loader.list_all():
        if item['enabled']:
            m = adapter_loader.get_adapter(item['id'])
            if m:
                sched_module.register_adapter(m, _execute_task)

    sched_module.start()
    logger.info("crawshrimp core started")
    yield
    sched_module.shutdown()


app = FastAPI(title="crawshrimp", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"]
)


# ─── Health ───

@app.get("/health")
def health():
    cfg = load_config()
    bridge = get_bridge()
    chrome_ok = bridge.is_available()
    return {
        "status": "ok",
        "chrome": chrome_ok,
        "adapters": len(adapter_loader.list_all()),
        "scheduled_jobs": len(sched_module.list_jobs()),
    }


# ─── Adapters ───

@app.get("/adapters")
def list_adapters():
    return adapter_loader.list_all()


class InstallRequest(BaseModel):
    path: Optional[str] = None
    zip_base64: Optional[str] = None


@app.post("/adapters/install")
def install_adapter(req: InstallRequest):
    try:
        if req.path:
            m = adapter_loader.install_from_dir(req.path)
        elif req.zip_base64:
            raw = base64.b64decode(req.zip_base64)
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
                f.write(raw)
                tmp = f.name
            try:
                m = adapter_loader.install_from_zip(tmp)
            finally:
                os.unlink(tmp)
        else:
            raise HTTPException(400, "Provide 'path' or 'zip_base64'")

        # Register scheduler jobs for newly installed adapter
        sched_module.register_adapter(m, _execute_task)
        return {"ok": True, "adapter": {"id": m.id, "name": m.name, "version": m.version}}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.delete("/adapters/{adapter_id}")
def uninstall_adapter(adapter_id: str):
    if not adapter_loader.get_adapter(adapter_id):
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    sched_module.unregister_adapter(adapter_id)
    adapter_loader.uninstall(adapter_id)
    return {"ok": True}


class EnableRequest(BaseModel):
    enabled: bool


@app.patch("/adapters/{adapter_id}/enable")
def enable_adapter(adapter_id: str, req: EnableRequest):
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    adapter_loader.set_enabled(adapter_id, req.enabled)
    if req.enabled:
        sched_module.register_adapter(m, _execute_task)
    else:
        sched_module.unregister_adapter(adapter_id)
    return {"ok": True, "enabled": req.enabled}


# ─── Tasks ───

@app.get("/tasks")
def list_tasks():
    result = []
    scheduled = {j['job_id']: j for j in sched_module.list_jobs()}
    for item in adapter_loader.list_all():
        m = adapter_loader.get_adapter(item['id'])
        if not m:
            continue
        for task in m.tasks:
            jid = f"{m.id}::{task.id}"
            last_run = data_sink.get_latest_run(m.id, task.id)
            result.append({
                "adapter_id": m.id,
                "adapter_name": m.name,
                "task_id": task.id,
                "task_name": task.name,
                "description": task.description,
                "params": [p.model_dump() for p in task.params],
                "trigger": task.trigger.model_dump(),
                "enabled": item['enabled'],
                "next_run": scheduled.get(jid, {}).get('next_run'),
                "last_run": last_run,
                "live": _run_status.get(jid),
            })
    return result


class RunTaskRequest(BaseModel):
    params: Optional[dict] = None


@app.post("/tasks/{adapter_id}/{task_id}/run")
async def run_task(adapter_id: str, task_id: str, req: RunTaskRequest = RunTaskRequest(), background_tasks: BackgroundTasks = None):
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    if not any(t.id == task_id for t in m.tasks):
        raise HTTPException(404, f"Task not found: {task_id}")
    background_tasks.add_task(_execute_task, adapter_id, task_id, req.params or {})
    return {"ok": True, "message": "Task started in background"}


@app.get("/tasks/{adapter_id}/{task_id}/status")
def task_status(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    live = _run_status.get(jid)
    last = data_sink.get_latest_run(adapter_id, task_id)
    return {"live": live, "last_run": last}


@app.get("/tasks/{adapter_id}/{task_id}/logs")
def task_logs(adapter_id: str, task_id: str):
    jid = f"{adapter_id}::{task_id}"
    return {"logs": _run_logs.get(jid, [])}


# ─── Data ───

@app.get("/data/{adapter_id}/{task_id}")
def get_data(adapter_id: str, task_id: str, limit: int = 20):
    runs = data_sink.list_runs(adapter_id, task_id, limit=limit)
    return {"runs": runs}


@app.get("/data/{adapter_id}/{task_id}/export")
def export_data(adapter_id: str, task_id: str, format: str = "excel"):
    last = data_sink.get_latest_run(adapter_id, task_id)
    if not last or not last.get('output_files'):
        raise HTTPException(404, "No exported data found. Run the task first.")
    import json as _json
    files = _json.loads(last['output_files']) if isinstance(last['output_files'], str) else last['output_files']
    for f in files:
        if format == 'excel' and f.endswith('.xlsx'):
            return FileResponse(f, filename=Path(f).name)
        if format == 'json' and f.endswith('.json'):
            return FileResponse(f, filename=Path(f).name)
    raise HTTPException(404, f"No {format} export found")



# ─── File utilities ───

class ReadExcelRequest(BaseModel):
    path: str
    sheet: Optional[str] = None   # 不传则读第一个 sheet
    header_row: int = 1           # 第几行作为表头（1-indexed）

@app.post("/files/read-excel")
def read_excel(req: ReadExcelRequest):
    """读取本地 Excel / CSV 文件，返回 headers + rows 数组，供 JS 脚本批量处理"""
    import json as _json
    p = Path(req.path)
    if not p.exists():
        raise HTTPException(404, f"File not found: {req.path}")

    suffix = p.suffix.lower()
    try:
        if suffix in ('.xlsx', '.xls', '.xlsm'):
            import openpyxl
            wb = openpyxl.load_workbook(p, read_only=True, data_only=True)
            ws = wb[req.sheet] if req.sheet else wb.active
            rows_raw = list(ws.iter_rows(values_only=True))
            wb.close()
        elif suffix == '.csv':
            import csv
            with open(p, newline='', encoding='utf-8-sig') as f:
                reader = csv.reader(f)
                rows_raw = list(reader)
        else:
            raise HTTPException(400, f"不支持的文件格式: {suffix}，请上传 .xlsx / .xls / .csv")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"读取文件失败: {e}")

    if not rows_raw:
        return {"headers": [], "rows": [], "total": 0}

    hi = req.header_row - 1
    headers = [str(c) if c is not None else '' for c in rows_raw[hi]]
    rows = []
    for raw in rows_raw[hi + 1:]:
        row = {}
        for i, h in enumerate(headers):
            v = raw[i] if i < len(raw) else None
            row[h] = str(v) if v is not None else ''
        rows.append(row)

    return {"headers": headers, "rows": rows, "total": len(rows)}


# ─── Settings ───

@app.get("/settings")
def get_settings():
    return load_config()


@app.put("/settings")
def put_settings(cfg: dict):
    save_config(cfg)
    reset_bridge()
    return {"ok": True}


class TestNotifyRequest(BaseModel):
    channel: str  # dingtalk | feishu | webhook


@app.post("/settings/test-notify")
def test_notify(req: TestNotifyRequest):
    try:
        notifier.send(
            channel=req.channel,
            title="🦐 抓虾通知测试",
            records=0,
            adapter_name="crawshrimp",
            task_name="测试通知",
            sample_rows=[{"状态": "✅ 通知配置正常", "渠道": req.channel}],
        )
        return {"ok": True, "msg": f"{req.channel} 通知发送成功"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/settings/chrome-tabs")
def chrome_tabs():
    try:
        tabs = get_bridge().get_tabs()
        return [{'id': t.get('id'), 'url': t.get('url'), 'title': t.get('title')}
                for t in tabs if t.get('type') == 'page']
    except ConnectionError as e:
        raise HTTPException(503, str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("CRAWSHRIMP_PORT", 18765))
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
    )
    uvicorn.run(app, host="127.0.0.1", port=port)
