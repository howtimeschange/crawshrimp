"""全局配置读写"""
import json
from pathlib import Path
from typing import Any

from core import runtime_paths

DEFAULT_CONFIG = {
    "chrome": {
        "cdp_port": 9222,
        "remote_debugging_url": "http://127.0.0.1:9222",
    },
    "adapters_dir": "adapters",
    "data_dir": "data",
    "log_dir": "logs",
    "notify": {
        "dingtalk_webhook": "",
        "dingtalk_secret": "",
        "feishu_webhook": "",
        "custom_webhook": "",
    },
    "ai": {
        "1xm": {
            "base_url": "https://api.1xm.ai/v1",
            "gpt_image_2k_key": "",
            "gpt_image_4k_key": "",
        },
    },
    "api_port": 18765,
}


def _deep_merge(base: dict, override: dict) -> dict:
    result = dict(base or {})
    for key, value in (override or {}).items():
        if isinstance(result.get(key), dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _expand_dotted_keys(cfg: dict) -> dict:
    result: dict = {}
    for key, value in (cfg or {}).items():
        key_text = str(key or "").strip()
        if not key_text:
            continue
        if "." not in key_text:
            if isinstance(value, dict) and isinstance(result.get(key_text), dict):
                result[key_text] = _deep_merge(result[key_text], value)
            else:
                result[key_text] = value
            continue
        target = result
        parts = [part for part in key_text.split(".") if part]
        for part in parts[:-1]:
            existing = target.get(part)
            if not isinstance(existing, dict):
                existing = {}
                target[part] = existing
            target = existing
        if parts:
            target[parts[-1]] = value
    return result


def _config_path() -> Path:
    return runtime_paths.data_root() / "config.json"


def load_config() -> dict:
    path = _config_path()
    if not path.exists():
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    return _deep_merge(DEFAULT_CONFIG, _expand_dotted_keys(data))


def save_config(cfg: dict) -> None:
    path = _config_path()
    with open(path, "w", encoding="utf-8") as f:
        json.dump(_expand_dotted_keys(cfg), f, ensure_ascii=False, indent=2)


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
