"""Probe request/response models."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel, Field


class ProbeRequest(BaseModel):
    adapter_id: str
    task_id: str
    goal: Optional[str] = None
    mode: str = "current"
    current_tab_id: Optional[str] = None
    entry_url: Optional[str] = None
    profile: Optional[str] = None
    safe_auto: Optional[bool] = None
    safe_click_labels: list[str] = Field(default_factory=list)
    safe_click_selectors: list[str] = Field(default_factory=list)
    safe_click_limit: int = 3
    capture_response_body: bool = True
    network_timeout_ms: int = 5000
    settle_ms: int = 800
    materialize_note: bool = True


class ProbeRunResponse(BaseModel):
    ok: bool
    probe_id: str
    adapter_id: str
    task_id: str
    bundle_dir: str
    manifest_path: str
    report_path: str
    summary: dict[str, Any]


class ProbeBundleResponse(BaseModel):
    ok: bool
    probe_id: str
    bundle_dir: str
    manifest: dict[str, Any]
    strategy: dict[str, Any]
    summary: dict[str, Any]
    files: list[str]


class ProbeBundleFullResponse(BaseModel):
    ok: bool
    probe_id: str
    bundle_dir: str
    bundle: dict[str, Any]
