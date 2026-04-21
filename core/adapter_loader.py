"""
适配包加载器
支持：本地目录安装 / zip 包安装 / 扫描 / 卸载 / 启用禁用
"""
import json
import os
import shutil
import zipfile
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

import yaml
from pydantic import ValidationError

from core.models import AdapterManifest

logger = logging.getLogger(__name__)

_adapters: Dict[str, AdapterManifest] = {}
_adapter_dirs: Dict[str, Path] = {}
_enabled: Dict[str, bool] = {}
_install_meta: Dict[str, dict[str, Any]] = {}


def _adapters_root() -> Path:
    base = os.environ.get("CRAWSHRIMP_DATA", str(Path.home() / ".crawshrimp"))
    root = Path(base) / "adapters"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _metadata_root() -> Path:
    base = os.environ.get("CRAWSHRIMP_DATA", str(Path.home() / ".crawshrimp"))
    root = Path(base) / "adapter-meta"
    root.mkdir(parents=True, exist_ok=True)
    return root


def _metadata_path(adapter_id: str) -> Path:
    return _metadata_root() / f"{adapter_id}.json"


def _normalize_install_mode(install_mode: str | None) -> str:
    normalized = str(install_mode or "copy").strip().lower() or "copy"
    if normalized not in {"copy", "link"}:
        raise ValueError(f"不支持的安装模式: {install_mode}")
    return normalized


def _safe_realpath(path: Path) -> str:
    try:
        return str(path.expanduser().resolve())
    except Exception:
        return str(path.expanduser())


def _read_manifest_file(manifest_path: Path) -> AdapterManifest:
    with open(manifest_path, encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return AdapterManifest(**data)


def _remove_installed_path(path: Path) -> None:
    if path.is_symlink():
        path.unlink()
        return
    if path.exists():
        shutil.rmtree(path)


def _read_install_metadata(adapter_id: str) -> dict[str, Any]:
    path = _metadata_path(adapter_id)
    if not path.exists():
        return {}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.warning("adapter 安装元数据读取失败 %s: %s", path, e)
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_install_metadata(adapter_id: str, payload: dict[str, Any]) -> None:
    path = _metadata_path(adapter_id)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    _install_meta[adapter_id] = dict(payload)


def _delete_install_metadata(adapter_id: str) -> None:
    path = _metadata_path(adapter_id)
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    _install_meta.pop(adapter_id, None)


def get_install_metadata(adapter_id: str) -> dict[str, Any]:
    cached = _install_meta.get(adapter_id)
    if cached is not None:
        return dict(cached)
    payload = _read_install_metadata(adapter_id)
    if payload:
        _install_meta[adapter_id] = dict(payload)
    return dict(payload)


def scan_all() -> List[AdapterManifest]:
    global _adapters, _adapter_dirs, _install_meta
    _adapters.clear()
    _adapter_dirs.clear()
    _install_meta.clear()
    root = _adapters_root()
    for item in root.iterdir():
        if item.is_dir() and (item / "manifest.yaml").exists():
            m = _load_manifest(item)
            if m:
                _adapters[m.id] = m
                _adapter_dirs[m.id] = item
                meta = _read_install_metadata(m.id)
                if not meta:
                    meta = {
                        "adapter_id": m.id,
                        "install_mode": "copy",
                        "runtime_path": _safe_realpath(item),
                        "source_path": _safe_realpath(item),
                    }
                else:
                    meta.setdefault("adapter_id", m.id)
                    meta.setdefault("install_mode", "copy")
                    meta.setdefault("runtime_path", _safe_realpath(item))
                    meta.setdefault("source_path", _safe_realpath(item))
                _install_meta[m.id] = meta
                if m.id not in _enabled:
                    _enabled[m.id] = True
    logger.info(f"已加载 {len(_adapters)} 个适配包")
    return list(_adapters.values())


def _load_manifest(adapter_dir: Path) -> Optional[AdapterManifest]:
    try:
        return _read_manifest_file(adapter_dir / "manifest.yaml")
    except (ValidationError, Exception) as e:
        logger.error(f"manifest 解析失败 {adapter_dir}: {e}")
        return None


def get_adapter(adapter_id: str) -> Optional[AdapterManifest]:
    return _adapters.get(adapter_id)


def get_adapter_dir(adapter_id: str) -> Optional[Path]:
    return _adapter_dirs.get(adapter_id)


def is_enabled(adapter_id: str) -> bool:
    return _enabled.get(adapter_id, False)


def set_enabled(adapter_id: str, enabled: bool) -> None:
    _enabled[adapter_id] = enabled


def install_from_dir(source_dir: str, install_mode: str = "copy", preserve_existing_link: bool = False) -> AdapterManifest:
    src = Path(source_dir).expanduser()
    if not (src / "manifest.yaml").exists():
        raise FileNotFoundError(f"缺少 manifest.yaml: {source_dir}")
    src = src.resolve()
    install_mode = _normalize_install_mode(install_mode)
    m = _read_manifest_file(src / "manifest.yaml")
    existing_meta = _read_install_metadata(m.id)
    if preserve_existing_link and existing_meta.get("install_mode") == "link":
        _adapters[m.id] = m
        current_dir = _adapters_root() / m.id
        if current_dir.exists() or current_dir.is_symlink():
            _adapter_dirs[m.id] = current_dir
        _install_meta[m.id] = existing_meta
        _enabled[m.id] = True
        logger.info("保留 link 安装的适配包: %s", m.id)
        return m
    dest = _adapters_root() / m.id
    if dest.exists() or dest.is_symlink():
        _remove_installed_path(dest)
    if install_mode == "link":
        dest.symlink_to(src, target_is_directory=True)
    else:
        shutil.copytree(src, dest)
    metadata = {
        "adapter_id": m.id,
        "install_mode": install_mode,
        "runtime_path": _safe_realpath(dest),
        "source_path": _safe_realpath(src),
    }
    _write_install_metadata(m.id, metadata)
    _adapters[m.id] = m
    _adapter_dirs[m.id] = dest
    _enabled[m.id] = True
    logger.info("适配包已安装: %s v%s (%s)", m.id, m.version, install_mode)
    return m


def install_from_zip(zip_path: str, install_mode: str = "copy") -> AdapterManifest:
    import tempfile
    install_mode = _normalize_install_mode(install_mode)
    if install_mode != "copy":
        raise ValueError("ZIP 安装暂不支持 link 模式，请改为选择适配包目录")
    with tempfile.TemporaryDirectory() as tmpdir:
        with zipfile.ZipFile(zip_path) as zf:
            zf.extractall(tmpdir)
        extracted = Path(tmpdir)
        subdirs = [d for d in extracted.iterdir() if d.is_dir()]
        if len(subdirs) == 1 and (subdirs[0] / "manifest.yaml").exists():
            source = subdirs[0]
        elif (extracted / "manifest.yaml").exists():
            source = extracted
        else:
            raise ValueError("zip 包结构不正确，未找到 manifest.yaml")
        return install_from_dir(str(source), install_mode="copy")


def uninstall(adapter_id: str) -> None:
    d = _adapter_dirs.get(adapter_id)
    if d and (d.exists() or d.is_symlink()):
        _remove_installed_path(d)
    _delete_install_metadata(adapter_id)
    for store in (_adapters, _adapter_dirs, _enabled, _install_meta):
        store.pop(adapter_id, None)
    logger.info(f"适配包已卸载: {adapter_id}")


def list_all() -> List[dict]:
    return [
        {
            "id": m.id,
            "name": m.name,
            "version": m.version,
            "author": m.author,
            "description": m.description,
            "entry_url": m.entry_url,
            "task_count": len(m.tasks),
            "enabled": _enabled.get(m.id, True),
            "install_mode": get_install_metadata(m.id).get("install_mode", "copy"),
            "source_path": get_install_metadata(m.id).get("source_path", str(_adapter_dirs.get(m.id) or "")),
            "runtime_path": get_install_metadata(m.id).get("runtime_path", str(_adapter_dirs.get(m.id) or "")),
        }
        for m in _adapters.values()
    ]
