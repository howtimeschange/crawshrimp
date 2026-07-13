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
_LEGACY_RUNTIME_MARKERS = (
    "adapters",
    "adapter-meta",
    "data",
    "knowledge",
    "logs",
    "crawshrimp.db",
    "config.json",
    "api-token",
    "chrome-profile",
)


def reset_runtime_data_root_cache() -> None:
    global _runtime_data_root, _runtime_data_key
    _runtime_data_root = None
    _runtime_data_key = ""


def _fallback_allowed_for_explicit_root() -> bool:
    return str(os.environ.get("CRAWSHRIMP_ALLOW_DATA_FALLBACK") or "").strip() == "1"


def _default_candidate_data_roots() -> list[Path]:
    candidates = []
    local_app_data = str(os.environ.get("LOCALAPPDATA") or "").strip()
    roaming_app_data = str(os.environ.get("APPDATA") or "").strip()
    home_root = Path.home() / ".crawshrimp"
    legacy_exists = _has_legacy_runtime_data(home_root)
    if sys.platform == "win32" and local_app_data:
        if legacy_exists:
            candidates.append(home_root)
        candidates.append(Path(local_app_data).expanduser() / "crawshrimp")
    elif sys.platform == "win32" and roaming_app_data:
        if legacy_exists:
            candidates.append(home_root)
        candidates.append(Path(roaming_app_data).expanduser() / "crawshrimp")
    elif sys.platform == "darwin":
        if legacy_exists:
            candidates.append(home_root)
        candidates.append(Path.home() / "Library" / "Application Support" / "crawshrimp")
    candidates.append(home_root)
    return candidates


def _candidate_data_roots() -> tuple[list[Path], bool]:
    explicit = str(os.environ.get("CRAWSHRIMP_DATA") or "").strip()
    if explicit:
        candidates = [Path(explicit).expanduser()]
        if _fallback_allowed_for_explicit_root():
            candidates.extend(_default_candidate_data_roots())
        return candidates, True

    candidates = _default_candidate_data_roots()
    return candidates, False


def _has_legacy_runtime_data(root: Path) -> bool:
    try:
        return any((root / marker).exists() for marker in _LEGACY_RUNTIME_MARKERS)
    except OSError as e:
        logger.warning("legacy runtime data unavailable %s: %s; using platform default", root, e)
        return False


def _selection_key() -> str:
    return "\0".join([
        str(os.environ.get("CRAWSHRIMP_DATA") or ""),
        str(os.environ.get("CRAWSHRIMP_ALLOW_DATA_FALLBACK") or ""),
        str(os.environ.get("LOCALAPPDATA") or ""),
        str(os.environ.get("APPDATA") or ""),
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
            if explicit and not _fallback_allowed_for_explicit_root():
                break

    label = "CRAWSHRIMP_DATA" if explicit else "default crawshrimp data directory"
    detail = "; ".join(errors) or str(candidates[0] if candidates else "")
    raise PermissionError(f"Unable to prepare {label}: {detail}")


def data_root() -> Path:
    return _select_root()


def child_dir(child_name: str, *, create: bool = True) -> Path:
    root = _select_root(child_name=child_name, create_child=create)
    return root / child_name
