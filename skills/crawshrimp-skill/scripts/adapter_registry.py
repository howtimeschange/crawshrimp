#!/usr/bin/env python3
"""Adapter/task registry compatible with crawshrimp-style manifests."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import yaml

try:
    from scripts.browser_executor import BrowserAction
except ModuleNotFoundError:
    from browser_executor import BrowserAction


SLUG_PATTERN = re.compile(r"^[a-z0-9][a-z0-9_-]{0,63}$")
SCRIPT_SUFFIXES = (".js",)


def _validate_slug(value: str, label: str) -> str:
    normalized = str(value or "").strip()
    if not SLUG_PATTERN.fullmatch(normalized):
        raise ValueError(f"{label} must match {SLUG_PATTERN.pattern}")
    return normalized


def _read_manifest(path: Path) -> dict[str, Any]:
    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"manifest must be a YAML object: {path}")
    adapter_id = _validate_slug(str(payload.get("id") or ""), "adapter id")
    payload["id"] = adapter_id
    tasks = []
    for raw_task in payload.get("tasks") or []:
        if not isinstance(raw_task, dict):
            continue
        task = dict(raw_task)
        task["id"] = _validate_slug(str(task.get("id") or ""), "task id")
        if not str(task.get("script") or "").strip():
            raise ValueError(f"task {task['id']} missing script")
        tasks.append(task)
    payload["tasks"] = tasks
    return payload


def _safe_realpath(path: Path) -> str:
    try:
        return str(path.expanduser().resolve())
    except Exception:
        return str(path.expanduser())


class AdapterRegistry:
    """Load installed adapter directories without depending on crawshrimp backend state."""

    def __init__(self, root: Path | str = "adapters") -> None:
        self.root = Path(root).expanduser()
        self._adapters: dict[str, dict[str, Any]] = {}
        self._adapter_dirs: dict[str, Path] = {}
        self._enabled: dict[str, bool] = {}
        self._metadata: dict[str, dict[str, Any]] = {}

    @property
    def state_path(self) -> Path:
        return self.root / "registry_state.json"

    def _load_state(self) -> None:
        if not self.state_path.exists():
            return
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
        except Exception:
            return
        adapters = payload.get("adapters") if isinstance(payload, dict) else {}
        if not isinstance(adapters, dict):
            return
        for adapter_id, state in adapters.items():
            if not isinstance(state, dict):
                continue
            if "enabled" in state:
                self._enabled[str(adapter_id)] = bool(state.get("enabled"))
            self._metadata[str(adapter_id)] = {key: value for key, value in state.items() if key != "enabled"}

    def _save_state(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        adapters = {}
        for adapter_id in sorted(set(self._enabled) | set(self._metadata)):
            adapters[adapter_id] = {"enabled": self._enabled.get(adapter_id, True), **self._metadata.get(adapter_id, {})}
        self.state_path.write_text(
            json.dumps({"adapters": adapters, "updated_at": datetime.now(timezone.utc).isoformat()}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def scan(self) -> list[dict[str, Any]]:
        adapters: dict[str, dict[str, Any]] = {}
        adapter_dirs: dict[str, Path] = {}
        self._load_state()
        if not self.root.exists():
            self._adapters = {}
            self._adapter_dirs = {}
            return []
        for item in sorted(self.root.iterdir()):
            manifest_path = item / "manifest.yaml"
            if not item.is_dir() or not manifest_path.is_file():
                continue
            manifest = _read_manifest(manifest_path)
            adapters[manifest["id"]] = manifest
            adapter_dirs[manifest["id"]] = item.resolve()
            self._enabled.setdefault(manifest["id"], True)
            self._metadata.setdefault(manifest["id"], {})
        self._adapters = adapters
        self._adapter_dirs = adapter_dirs
        for adapter_id in list(self._enabled):
            if adapter_id not in adapters:
                self._enabled.pop(adapter_id, None)
                self._metadata.pop(adapter_id, None)
        return list(self._adapters.values())

    def list_adapters(self) -> list[dict[str, Any]]:
        if not self._adapters:
            self.scan()
        items = []
        for adapter_id, manifest in self._adapters.items():
            items.append(
                {
                    "id": adapter_id,
                    "name": manifest.get("name") or adapter_id,
                    "version": manifest.get("version") or "1.0.0",
                    "description": manifest.get("description") or "",
                    "entry_url": manifest.get("entry_url") or "",
                    "task_count": len(manifest.get("tasks") or []),
                    "enabled": self._enabled.get(adapter_id, True),
                    **self._metadata.get(adapter_id, {}),
                    "runtime_path": _safe_realpath(self._adapter_dirs.get(adapter_id, self.root / adapter_id)),
                }
            )
        return sorted(items, key=lambda item: item["id"])

    def get_adapter(self, adapter_id: str) -> dict[str, Any]:
        if not self._adapters:
            self.scan()
        adapter = self._adapters.get(adapter_id)
        if not adapter:
            raise KeyError(f"adapter not found: {adapter_id}")
        return adapter

    def get_adapter_dir(self, adapter_id: str) -> Path:
        if not self._adapter_dirs:
            self.scan()
        adapter_dir = self._adapter_dirs.get(adapter_id)
        if not adapter_dir:
            raise KeyError(f"adapter directory not found: {adapter_id}")
        return adapter_dir

    def get_task(self, adapter_id: str, task_id: str) -> dict[str, Any]:
        adapter = self.get_adapter(adapter_id)
        for task in adapter.get("tasks") or []:
            if str(task.get("id") or "") == task_id:
                return dict(task)
        raise KeyError(f"task not found: {adapter_id}/{task_id}")

    def is_enabled(self, adapter_id: str) -> bool:
        return self._enabled.get(adapter_id, True)

    def set_enabled(self, adapter_id: str, enabled: bool) -> None:
        self.get_adapter(adapter_id)
        self._enabled[adapter_id] = bool(enabled)
        self._save_state()

    def resolve_relative_file(
        self,
        adapter_id: str,
        relative_path: str,
        *,
        allowed_suffixes: tuple[str, ...] | None = SCRIPT_SUFFIXES,
        require_exists: bool = True,
    ) -> Path:
        raw_path = str(relative_path or "").strip()
        if not raw_path or "\x00" in raw_path:
            raise ValueError("adapter file path is empty or invalid")
        normalized = Path(raw_path.replace("\\", "/"))
        if normalized.is_absolute() or any(part == ".." for part in normalized.parts):
            raise ValueError(f"adapter file path must stay inside adapter directory: {raw_path}")
        base_dir = self.get_adapter_dir(adapter_id).resolve()
        candidate = (base_dir / normalized).resolve()
        try:
            candidate.relative_to(base_dir)
        except ValueError as exc:
            raise ValueError(f"adapter file path escapes adapter directory: {raw_path}") from exc
        if allowed_suffixes and candidate.suffix.lower() not in tuple(item.lower() for item in allowed_suffixes):
            raise ValueError(f"adapter file path has unsupported suffix: {raw_path}")
        if require_exists and (not candidate.exists() or not candidate.is_file()):
            raise FileNotFoundError(f"adapter file not found: {raw_path}")
        return candidate

    def resolve_task_script(self, adapter_id: str, task_id: str) -> Path:
        task = self.get_task(adapter_id, task_id)
        return self.resolve_relative_file(adapter_id, str(task.get("script") or ""))

    def resolve_auth_script(self, adapter_id: str) -> Path | None:
        adapter = self.get_adapter(adapter_id)
        auth = adapter.get("auth") if isinstance(adapter.get("auth"), dict) else {}
        check_script = str((auth or {}).get("check_script") or "").strip()
        if not check_script:
            return None
        return self.resolve_relative_file(adapter_id, check_script)

    def install_from_dir(self, source_dir: Path | str, *, mode: str = "copy") -> dict[str, Any]:
        source = Path(source_dir).expanduser().resolve()
        manifest = _read_manifest(source / "manifest.yaml")
        target = self.root / manifest["id"]
        if mode not in {"copy", "link"}:
            raise ValueError(f"unsupported install mode: {mode}")
        if target.exists() or target.is_symlink():
            if target.is_symlink():
                target.unlink()
            else:
                shutil.rmtree(target)
        self.root.mkdir(parents=True, exist_ok=True)
        if mode == "link":
            target.symlink_to(source, target_is_directory=True)
        else:
            shutil.copytree(source, target)
        self._metadata[manifest["id"]] = {
            "install_mode": mode,
            "source_path": str(source),
            "installed_version": str(manifest.get("version") or "1.0.0"),
            "installed_at": datetime.now(timezone.utc).isoformat(),
        }
        self._enabled[manifest["id"]] = True
        self._save_state()
        self.scan()
        return manifest

    def install_from_zip(self, zip_path: Path | str) -> dict[str, Any]:
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            with zipfile.ZipFile(zip_path) as zf:
                for member in zf.infolist():
                    member_path = Path(member.filename.replace("\\", "/"))
                    if member_path.is_absolute() or any(part == ".." for part in member_path.parts):
                        raise ValueError(f"zip contains unsafe path: {member.filename}")
                    zf.extract(member, root)
            candidates = [path for path in root.iterdir() if path.is_dir() and (path / "manifest.yaml").is_file()]
            source = candidates[0] if len(candidates) == 1 else root
            return self.install_from_dir(source)


def _auth_script_source(source: str) -> str:
    return (
        "window.__CRAWSHRIMP_AUTH_CHECK__ = async function() {\n"
        f"{source}\n"
        "};\n"
        "window.__CRAWSHRIMP_AUTH_CHECK__()"
    )


def _is_logged_in(value: Any) -> bool:
    if not isinstance(value, dict) or not value.get("success"):
        return False
    meta = value.get("meta") if isinstance(value.get("meta"), dict) else {}
    if bool(meta.get("logged_in")):
        return True
    data = value.get("data")
    if isinstance(data, list) and data:
        first = data[0]
        if isinstance(first, dict) and bool(first.get("logged_in")):
            return True
    return False


def run_auth_check(registry: AdapterRegistry, adapter_id: str, *, backend: Any) -> dict[str, Any]:
    script_path = registry.resolve_auth_script(adapter_id)
    if not script_path:
        return {"ok": True, "adapter_id": adapter_id, "skipped": True, "reason": "no auth check script"}
    result = backend.execute(BrowserAction(kind="eval", script=_auth_script_source(script_path.read_text(encoding="utf-8"))))
    value = result.data.get("value") if isinstance(result.data, dict) else {}
    ok = bool(result.ok and _is_logged_in(value))
    return {
        "ok": ok,
        "adapter_id": adapter_id,
        "script": str(script_path),
        "result": value,
        "error": "" if ok else result.error or (value.get("error") if isinstance(value, dict) else "") or "not logged in",
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scan crawshrimp-style adapter manifests.")
    parser.add_argument("--root", default="adapters")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("scan")
    install = sub.add_parser("install")
    install.add_argument("--source", required=True)
    install.add_argument("--mode", default="copy", choices=["copy", "link"])
    enable = sub.add_parser("enable")
    enable.add_argument("--adapter", required=True)
    disable = sub.add_parser("disable")
    disable.add_argument("--adapter", required=True)
    task = sub.add_parser("task")
    task.add_argument("--adapter", required=True)
    task.add_argument("--task", required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    registry = AdapterRegistry(args.root)
    if args.command == "scan":
        print(json.dumps(registry.list_adapters(), ensure_ascii=False, indent=2))
        return 0
    if args.command == "install":
        print(json.dumps(registry.install_from_dir(args.source, mode=args.mode), ensure_ascii=False, indent=2))
        return 0
    if args.command == "enable":
        registry.set_enabled(args.adapter, True)
        print(json.dumps({"ok": True, "adapter_id": args.adapter, "enabled": True}, ensure_ascii=False, indent=2))
        return 0
    if args.command == "disable":
        registry.set_enabled(args.adapter, False)
        print(json.dumps({"ok": True, "adapter_id": args.adapter, "enabled": False}, ensure_ascii=False, indent=2))
        return 0
    if args.command == "task":
        print(json.dumps(registry.get_task(args.adapter, args.task), ensure_ascii=False, indent=2))
        return 0
    raise RuntimeError(f"unsupported command: {args.command}")


if __name__ == "__main__":
    raise SystemExit(main())
