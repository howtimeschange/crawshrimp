"""Persistent favorites for installed script adapters."""

from datetime import datetime, timezone

from core.config import load_config, patch_config


def _normalize(raw: object) -> dict[str, str]:
    if not isinstance(raw, dict):
        return {}

    normalized: dict[str, str] = {}
    for adapter_id, value in raw.items():
        key = str(adapter_id or "").strip()
        timestamp = str(value or "").strip()
        if not key or not timestamp:
            continue
        try:
            datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
        except ValueError:
            continue
        normalized[key] = timestamp
    return normalized


def list_favorites() -> dict[str, str]:
    return _normalize(load_config().get("script_favorites"))


def favorite(adapter_id: str, now: datetime | None = None) -> dict[str, str]:
    favorites = list_favorites()
    favorites[str(adapter_id).strip()] = (now or datetime.now(timezone.utc)).isoformat()
    patch_config({"script_favorites": favorites})
    return favorites


def unfavorite(adapter_id: str) -> dict[str, str]:
    favorites = list_favorites()
    favorites.pop(str(adapter_id or "").strip(), None)
    patch_config({"script_favorites": favorites})
    return favorites
