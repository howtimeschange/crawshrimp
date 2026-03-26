"""全局配置读写"""
import os
import json
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = {
    "chrome": {
        "cdp_port": 9222,
        "remote_debugging_url": "http://localhost:9222",
    },
    "adapters_dir": "adapters",
    "data_dir": "data",
    "log_dir": "logs",
    "notify": {
        "dingtalk_webhook": "",
        "feishu_webhook": "",
        "custom_webhook": "",
    },
    "api_port": 18765,
}


def _config_path() -> Path:
    base = os.environ.get("CRAWSHRIMP_DATA", str(Path.home() / ".crawshrimp"))
    p = Path(base)
    p.mkdir(parents=True, exist_ok=True)
    return p / "config.json"


def load_config() -> dict:
    path = _config_path()
    if not path.exists():
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return {**DEFAULT_CONFIG, **data}


def save_config(cfg: dict) -> None:
    path = _config_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(cfg, f, ensure_ascii=False, indent=2)


def get(key: str, default: Any = None) -> Any:
    cfg = load_config()
    keys = key.split(".")
    val = cfg
    for k in keys:
        if isinstance(val, dict):
            val = val.get(k)
        else:
            return default
    return val if val is not None else default
