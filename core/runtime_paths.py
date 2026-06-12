"""Runtime data directory selection shared by the desktop backend."""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from uuid import uuid4

logger = logging.getLogger(__name__)

_runtime_data_root: Path | None = None
_runtime_data_key: str = ""


def reset_runtime_data_root_cache() -> None:
    global _runtime_data_root, _runtime_data_key
    _runtime_data_root = None
    _runtime_data_key = ""


def _candidate_data_roots() -> tuple[list[Path], bool]:
    explicit = str(os.environ.get("CRAWSHRIMP_DATA") or "").strip()
    if explicit:
        return [Path(explicit).expanduser()], True

    candidates = []
    local_app_data = str(os.environ.get("LOCALAPPDATA") or "").strip()
    if sys.platform == "win32" and local_app_data:
        candidates.append(Path(local_app_data).expanduser() / "crawshrimp")
    elif sys.platform == "darwin":
        candidates.append(Path.home() / "Library" / "Application Support" / "crawshrimp")
    candidates.append(Path.home() / ".crawshrimp")
    return candidates, False


def _selection_key() -> str:
    return "\0".join([
        str(os.environ.get("CRAWSHRIMP_DATA") or ""),
        str(os.environ.get("LOCALAPPDATA") or ""),
        str(Path.home()),
    ])


def _ensure_dir(path: Path) -> Path:
    path.mkdir(parents=True, exist_ok=True)
    probe = path / f".crawshrimp-write-test-{os.getpid()}-{uuid4().hex}"
    probe.write_text("ok", encoding="utf-8")
    probe.unlink()
    return path


def _select_root(*, child_name: str | None = None, create_child: bool = True) -> Path:
    global _runtime_data_root, _runtime_data_key
    selection_key = _selection_key()
    if _runtime_data_key != selection_key:
        _runtime_data_root = None
        _runtime_data_key = selection_key
    candidates, explicit = _candidate_data_roots()
    if _runtime_data_root is not None:
        candidates = [_runtime_data_root, *candidates]

    seen: set[str] = set()
    errors: list[str] = []
    for base in candidates:
        key = str(base)
        if key in seen:
            continue
        seen.add(key)
        try:
            _ensure_dir(base)
            if child_name and create_child:
                _ensure_dir(base / child_name)
            _runtime_data_root = base
            _runtime_data_key = selection_key
            return base
        except OSError as e:
            errors.append(f"{base}: {e}")
            logger.warning("runtime data path unavailable %s: %s", base, e)
            if explicit:
                break

    label = "CRAWSHRIMP_DATA" if explicit else "default crawshrimp data directory"
    detail = "; ".join(errors) or str(candidates[0] if candidates else "")
    raise PermissionError(f"Unable to prepare {label}: {detail}")


def data_root() -> Path:
    return _select_root()


def child_dir(child_name: str, *, create: bool = True) -> Path:
    root = _select_root(child_name=child_name, create_child=create)
    return root / child_name
