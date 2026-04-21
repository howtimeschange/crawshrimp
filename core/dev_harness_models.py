"""Pydantic models for crawshrimp dev harness APIs."""
from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class DevHarnessSessionRequest(BaseModel):
    adapter_id: str
    task_id: str
    mode: str = "current"
    current_tab_id: Optional[str] = None
    entry_url: Optional[str] = None


class DevHarnessSnapshotRequest(DevHarnessSessionRequest):
    include_framework: bool = False
    include_knowledge: bool = True
    knowledge_query: Optional[str] = None
    knowledge_limit: int = 5


class DevHarnessEvalRequest(DevHarnessSessionRequest):
    expression: str
    allow_navigation_retry: bool = False


class DevHarnessCaptureRequest(DevHarnessSessionRequest):
    capture_mode: str = "passive"
    clicks: list[dict] = Field(default_factory=list)
    url: Optional[str] = None
    matches: list[dict] = Field(default_factory=list)
    timeout_ms: int = 8000
    settle_ms: int = 1000
    min_matches: int = 1
    include_response_body: bool = True
