"""
适配包加载器
支持：本地目录安装 / zip 包安装 / 扫描 / 卸载 / 启用禁用
"""
import os
import shutil
import zipfile
import logging
from pathlib import Path
from typing import Dict, List, Optional

import yaml
from pydantic import ValidationError

from core.models import AdapterManifest

logger = logging.getLogger(__name__)

_adapters: Dict[str, AdapterManifest] = {}
_adapter_dirs: Dict[str, Path] = {}
_enabled: Dict[str, bool] = {}


def _adapters_root() -> Path:
    base = os.environ.get("CRAWSHRIMP_DATA", str(Path.home() / ".crawshrimp"))
    root = Path(base) / "adapters"
    root.mkdir(parents=True, exist_ok=True)
    return root


def scan_all() -> List[AdapterManifest]:
    global _adapters, _adapter_dirs
    _adapters.clear()
    _adapter_dirs.clear()
    root = _adapters_root()
    for item in root.iterdir():
        if item.is_dir() and (item / "manifest.yaml").exists():
            m = _load_manifest(item)
            if m:
                _adapters[m.id] = m
                _adapter_dirs[m.id] = item
                if m.id not in _enabled:
                    _enabled[m.id] = True
    logger.info(f"已加载 {len(_adapters)} 个适配包")
    return list(_adapters.values())


def _load_manifest(adapter_dir: Path) -> Optional[AdapterManifest]:
    try:
        with open(adapter_dir / "manifest.yaml", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        return AdapterManifest(**data)
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


def install_from_dir(source_dir: str) -> AdapterManifest:
    src = Path(source_dir)
    if not (src / "manifest.yaml").exists():
        raise FileNotFoundError(f"缺少 manifest.yaml: {source_dir}")
    with open(src / "manifest.yaml", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    m = AdapterManifest(**data)
    dest = _adapters_root() / m.id
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(src, dest)
    _adapters[m.id] = m
    _adapter_dirs[m.id] = dest
    _enabled[m.id] = True
    logger.info(f"适配包已安装: {m.id} v{m.version}")
    return m


def install_from_zip(zip_path: str) -> AdapterManifest:
    import tempfile
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
        return install_from_dir(str(source))


def uninstall(adapter_id: str) -> None:
    d = _adapter_dirs.get(adapter_id)
    if d and d.exists():
        shutil.rmtree(d)
    for store in (_adapters, _adapter_dirs, _enabled):
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
        }
        for m in _adapters.values()
    ]
