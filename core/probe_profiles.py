"""Probe profile loading and merge helpers."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from core import adapter_loader


def _profile_dirs(adapter_id: str) -> list[Path]:
    candidates: list[Path] = []
    adapter_dir = adapter_loader.get_adapter_dir(adapter_id)
    if adapter_dir:
        candidates.append(Path(adapter_dir) / "probe")
    repo_dir = Path(__file__).resolve().parents[1] / "adapters" / adapter_id / "probe"
    candidates.append(repo_dir)

    unique: list[Path] = []
    for path in candidates:
        if path not in unique:
            unique.append(path)
    return unique


def _load_json(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, dict) else {}


def _unique_list(items: list[Any]) -> list[Any]:
    seen = []
    for item in items:
        if item not in seen:
            seen.append(item)
    return seen


def _merge_dict(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in override.items():
        if isinstance(value, list):
            existing = merged.get(key)
            merged[key] = _unique_list((existing if isinstance(existing, list) else []) + value)
        elif isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_dict(dict(merged.get(key) or {}), value)
        else:
            merged[key] = value
    return merged


def load_probe_profile(adapter_id: str, task_id: str, profile_name: str = "") -> dict[str, Any]:
    merged: dict[str, Any] = {}
    candidate_names = []
    if profile_name:
        candidate_names.append(profile_name)
    candidate_names.append(task_id)

    for profile_dir in _profile_dirs(adapter_id):
        if not profile_dir.exists():
            continue

        common_path = profile_dir / "common.json"
        if common_path.exists():
            merged = _merge_dict(merged, _load_json(common_path))

        for name in candidate_names:
            path = profile_dir / f"{name}.json"
            if path.exists():
                merged = _merge_dict(merged, _load_json(path))
                merged["_profile_name"] = name
                break
        if merged.get("_profile_name"):
            break
    return merged
