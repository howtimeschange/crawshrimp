"""
FastAPI service entry point
All REST endpoints for Electron GUI
"""
import base64
import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel

from core.config import load_config, save_config
from core import adapter_loader
from core.cdp_bridge import get_bridge, reset_bridge

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # On startup: install built-in adapters then scan
    built_in = Path(__file__).parent.parent / "adapters"
    if built_in.exists():
        for d in built_in.iterdir():
            if d.is_dir() and (d / "manifest.yaml").exists():
                try:
                    adapter_loader.install_from_dir(str(d))
                except Exception as e:
                    logger.warning(f"Built-in adapter load failed {d.name}: {e}")
    adapter_loader.scan_all()
    yield


app = FastAPI(title="crawshrimp", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Health ───

@app.get("/health")
def health():
    return {"status": "ok"}


# ─── Adapters ───

@app.get("/adapters")
def list_adapters():
    return adapter_loader.list_all()


class InstallRequest(BaseModel):
    path: Optional[str] = None       # local directory path
    zip_base64: Optional[str] = None  # base64-encoded zip content


@app.post("/adapters/install")
def install_adapter(req: InstallRequest):
    try:
        if req.path:
            m = adapter_loader.install_from_dir(req.path)
        elif req.zip_base64:
            raw = base64.b64decode(req.zip_base64)
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
                f.write(raw)
                tmp_path = f.name
            try:
                m = adapter_loader.install_from_zip(tmp_path)
            finally:
                os.unlink(tmp_path)
        else:
            raise HTTPException(400, "Provide either 'path' or 'zip_base64'")
        return {"ok": True, "adapter": {"id": m.id, "name": m.name, "version": m.version}}
    except Exception as e:
        raise HTTPException(400, str(e))


@app.delete("/adapters/{adapter_id}")
def uninstall_adapter(adapter_id: str):
    if not adapter_loader.get_adapter(adapter_id):
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    adapter_loader.uninstall(adapter_id)
    return {"ok": True}


class EnableRequest(BaseModel):
    enabled: bool


@app.patch("/adapters/{adapter_id}/enable")
def enable_adapter(adapter_id: str, req: EnableRequest):
    if not adapter_loader.get_adapter(adapter_id):
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    adapter_loader.set_enabled(adapter_id, req.enabled)
    return {"ok": True, "enabled": req.enabled}


# ─── Tasks ───

@app.get("/tasks")
def list_tasks():
    result = []
    for item in adapter_loader.list_all():
        m = adapter_loader.get_adapter(item["id"])
        if m:
            for task in m.tasks:
                result.append({
                    "adapter_id": m.id,
                    "adapter_name": m.name,
                    "task_id": task.id,
                    "task_name": task.name,
                    "trigger": task.trigger.model_dump(),
                    "enabled": item["enabled"],
                })
    return result


@app.post("/tasks/{adapter_id}/{task_id}/run")
async def run_task(adapter_id: str, task_id: str):
    """Trigger a task immediately (manual run)"""
    m = adapter_loader.get_adapter(adapter_id)
    if not m:
        raise HTTPException(404, f"Adapter not found: {adapter_id}")
    task = next((t for t in m.tasks if t.id == task_id), None)
    if not task:
        raise HTTPException(404, f"Task not found: {task_id}")

    adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
    script_path = adapter_dir / task.script
    if not script_path.exists():
        raise HTTPException(500, f"Script not found: {script_path}")

    # Find matching tab
    bridge = get_bridge()
    tab = bridge.find_tab(m.entry_url)
    if not tab:
        raise HTTPException(503, f"No open Chrome tab matching: {m.entry_url}")

    from core.js_runner import JSRunner
    runner = JSRunner(bridge.get_tab_ws_url(tab))
    try:
        data = await runner.run_script_file(script_path)
        return {"ok": True, "records": len(data), "data": data[:10]}  # preview first 10
    except Exception as e:
        raise HTTPException(500, str(e))


# ─── Settings ───

@app.get("/settings")
def get_settings():
    return load_config()


@app.put("/settings")
def put_settings(cfg: dict):
    save_config(cfg)
    reset_bridge()  # CDP URL may have changed
    return {"ok": True}


@app.get("/settings/chrome-tabs")
def chrome_tabs():
    bridge = get_bridge()
    try:
        tabs = bridge.get_tabs()
        return [{"id": t.get("id"), "url": t.get("url"), "title": t.get("title")} for t in tabs if t.get("type") == "page"]
    except ConnectionError as e:
        raise HTTPException(503, str(e))


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("CRAWSHRIMP_PORT", 18765))
    logging.basicConfig(level=logging.INFO)
    uvicorn.run(app, host="127.0.0.1", port=port)
