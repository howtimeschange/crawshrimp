import asyncio
import base64
import json
import os
import shutil
import subprocess
import tempfile
import time
import unittest
from pathlib import Path
from unittest.mock import patch

from core.js_runner import (
    JSRunner,
    RunAbortedError,
    _care_symbols_from_wash_payload,
    _encode_request_url,
    _wash_care_calibration_prompt,
)
from core.models import JSResult


def _extract_window_assignment(expression: str, key: str):
    prefix = f"window.{key} = "
    for line in expression.splitlines():
        stripped = line.strip()
        if stripped.startswith(prefix):
            return stripped.split("=", 1)[1].strip().rstrip(";")
    return None


class SharedCarryRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        page_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PAGE__")
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        page = int(page_raw) if page_raw is not None else None
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None

        self.calls.append({
            "page": page,
            "phase": phase,
            "shared": shared,
        })

        if len(self.calls) == 1:
            return JSResult(
                success=True,
                data=[{"page": 1}],
                meta={
                    "action": "complete",
                    "has_more": True,
                    "shared": {
                        "requestedOuterSites": ["全球", "美国", "欧区"],
                        "requestedStatDateRange": {
                            "start": "2026-04-01",
                            "end": "2026-04-07",
                        },
                    },
                },
            )

        return JSResult(
            success=True,
            data=[{"page": 2}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )


class SharedResetRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        page_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PAGE__")
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        page = int(page_raw) if page_raw is not None else None
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None

        self.calls.append({
            "page": page,
            "phase": phase,
            "shared": shared,
        })

        if page == 1 and phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "next_phase",
                    "next_phase": "prepare_row",
                    "sleep_ms": 0,
                    "shared": {
                        "couponName": "KEEP-ME",
                        "couponCode": "ABCDE",
                    },
                },
            )

        if page == 1 and phase == "prepare_row":
            return JSResult(
                success=True,
                data=[{"page": 1, "phase": phase}],
                meta={
                    "action": "complete",
                    "has_more": True,
                    "shared": {},
                },
            )

        return JSResult(
            success=True,
            data=[{"page": page, "phase": phase}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )


class LongPaginationRunner(JSRunner):
    def __init__(self, total_pages: int):
        super().__init__("ws://example.invalid")
        self.total_pages = total_pages
        self.calls = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        page_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PAGE__")
        page = int(page_raw) if page_raw is not None else None

        self.calls.append(page)
        has_more = bool(page and page < self.total_pages)
        return JSResult(
            success=True,
            data=[{"page": page}],
            meta={
                "action": "complete",
                "has_more": has_more,
                "shared": {},
            },
        )


class EndlessPaginationRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        page_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PAGE__")
        page = int(page_raw) if page_raw is not None else None

        self.calls.append(page)
        return JSResult(
            success=True,
            data=[{"page": page}],
            meta={
                "action": "complete",
                "has_more": True,
                "shared": {},
            },
        )


class AbortActionRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        phase = json.loads(phase_raw) if phase_raw is not None else None
        self.calls.append(phase)

        if len(self.calls) == 1:
            return JSResult(
                success=True,
                data=[{"id": "first"}],
                meta={
                    "action": "next_phase",
                    "next_phase": "blocked",
                    "sleep_ms": 0,
                    "shared": {"step": 1},
                },
            )

        return JSResult(
            success=True,
            data=[{"id": "second"}],
            meta={
                "action": "abort",
                "reason": "Amazon 返回自动化访问限制页，已停止并保留已抓结果",
                "shared": {"step": 2},
            },
        )


class CompleteSleepRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []
        self.sleep_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        page_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PAGE__")
        page = int(page_raw) if page_raw is not None else None
        self.calls.append(page)
        return JSResult(
            success=True,
            data=[{"page": page}],
            meta={
                "action": "complete",
                "has_more": page == 1,
                "sleep_ms": 250,
                "shared": {},
            },
        )


class RuntimeActionRunner(JSRunner):
    def __init__(self, artifact_dir: str):
        super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
        self.calls = []
        self.capture_click_payloads = []
        self.capture_wheel_payloads = []
        self.download_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        page_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PAGE__")
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        page = int(page_raw) if page_raw is not None else None
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None

        self.calls.append({
            "page": page,
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "capture_click_requests",
                    "clicks": [{"x": 1, "y": 2}],
                    "matches": [{"url_contains": "/download"}],
                    "shared_key": "captured",
                    "next_phase": "after_capture",
                    "shared": shared or {},
                },
            )

        if phase == "after_capture":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "capture_wheel_requests",
                    "wheels": [{"x": 3, "y": 4, "delta_y": 640}],
                    "matches": [{"url_contains": "/page-2"}],
                    "shared_key": "wheel_captured",
                    "next_phase": "after_wheel_capture",
                    "shared": shared or {},
                },
            )

        if phase == "after_wheel_capture":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "download_urls",
                    "items": [{
                        "url": "https://example.com/demo.xlsx",
                        "filename": "demo.xlsx",
                        "label": "Demo",
                    }],
                    "shared_key": "downloads",
                    "next_phase": "after_download",
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[{"phase": phase}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def capture_click_requests(self, clicks, **kwargs):
        self.capture_click_payloads.append({
            "clicks": clicks,
            "kwargs": kwargs,
        })
        return {
            "ok": True,
            "matches": [{
                "url": "https://example.com/api/download",
                "body": '{"result":{"fileUrl":"https://example.com/demo.xlsx"}}',
            }],
        }

    async def capture_wheel_requests(self, wheels, **kwargs):
        self.capture_wheel_payloads.append({
            "wheels": wheels,
            "kwargs": kwargs,
        })
        return {
            "ok": True,
            "matches": [{
                "url": "https://example.com/api/page-2",
                "body": '{"ok":true}',
            }],
        }

    async def download_urls(self, items, strict: bool = False, **kwargs):
        self.download_payloads.append({
            "items": items,
            "strict": strict,
            "kwargs": kwargs,
        })
        path = self.artifact_dir / "demo.xlsx"
        path.write_text("ok", encoding="utf-8")
        saved_path = str(path)
        if saved_path not in self.runtime_output_files:
            self.runtime_output_files.append(saved_path)
        return {
            "ok": True,
            "items": [{
                "success": True,
                "label": "Demo",
                "filename": path.name,
                "path": saved_path,
                "url": "https://example.com/demo.xlsx",
            }],
        }


class ParamReinjectRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str, params_json: str = "") -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        has_embedded_param_payload = "REGULAR_VN_001" in expression
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        phase = json.loads(phase_raw) if phase_raw is not None else None

        self.calls.append({
            "phase": phase,
            "has_embedded_param_payload": has_embedded_param_payload,
        })

        if len(self.calls) == 1:
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "next_phase",
                    "next_phase": "ensure_site_home",
                    "sleep_ms": 0,
                    "shared": {},
                },
            )

        if not has_embedded_param_payload:
            return JSResult(success=False, error="second phase missing embedded param payload")

        return JSResult(
            success=True,
            data=[{"ok": True}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": {},
            },
        )


class MainNavigationRetryRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        phase = json.loads(phase_raw) if phase_raw is not None else None
        self.calls.append({
            "phase": phase,
            "allow_navigation_retry": allow_navigation_retry,
        })

        if phase == "main" and not allow_navigation_retry:
            return JSResult(success=False, error="{'code': -32000, 'message': 'Inspected target navigated or closed'}")

        return JSResult(
            success=True,
            data=[{"ok": True}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": {},
            },
        )


class RuntimeUrlCaptureRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []
        self.capture_url_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None

        self.calls.append({
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "capture_url_requests",
                    "url": "https://example.com/landing",
                    "matches": [{"url_contains": "/api/merchant/file/export/download"}],
                    "shared_key": "captured_url",
                    "next_phase": "after_capture_url",
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[shared or {}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def capture_url_requests(self, url, **kwargs):
        self.capture_url_payloads.append({
            "url": url,
            "kwargs": kwargs,
        })
        return {
            "ok": True,
            "requestedUrl": url,
            "matches": [{
                "url": "https://example.com/api/merchant/file/export/download",
                "body": '{"result":{"fileUrl":"https://example.com/generated.xlsx"}}',
            }],
        }


class RuntimeClickDownloadRunner(JSRunner):
    def __init__(self, artifact_dir: str):
        super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
        self.calls = []
        self.download_click_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None

        self.calls.append({
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "download_clicks",
                    "items": [{
                        "clicks": [{"x": 12, "y": 34}],
                        "filename": "clicked.xlsx",
                        "label": "Clicked",
                        "expected_url": "https://example.com/FundDetail-demo.xlsx",
                    }],
                    "shared_key": "click_downloads",
                    "next_phase": "after_click_download",
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[shared or {}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def download_clicks(self, items, strict: bool = False):
        self.download_click_payloads.append({
            "items": items,
            "strict": strict,
        })
        path = self.artifact_dir / "clicked.xlsx"
        path.write_text("ok", encoding="utf-8")
        saved_path = str(path)
        if saved_path not in self.runtime_output_files:
            self.runtime_output_files.append(saved_path)
        return {
            "ok": True,
            "items": [{
                "success": True,
                "label": "Clicked",
                "filename": path.name,
                "path": saved_path,
                "url": "https://example.com/FundDetail-demo.xlsx",
            }],
        }


class RuntimeScreenshotRunner(JSRunner):
    def __init__(self, artifact_dir: str):
        super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
        self.calls = []
        self.screenshot_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None

        self.calls.append({
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "capture_screenshot",
                    "filename": "demo-member-page.png",
                    "label": "会员页截图",
                    "shared_key": "screenshot",
                    "next_phase": "after_screenshot",
                    "scroll_rounds": 2,
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[{"filename": shared["screenshot"]["items"][0]["filename"]}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def capture_screenshot(self, **kwargs):
        self.screenshot_payloads.append(kwargs)
        path = self.artifact_dir / kwargs["filename"]
        path.write_bytes(b"png")
        saved_path = str(path)
        if saved_path not in self.runtime_output_files:
            self.runtime_output_files.append(saved_path)
        return {
            "ok": True,
            "items": [{
                "success": True,
                "label": kwargs["label"],
                "filename": path.name,
                "path": saved_path,
            }],
        }


class RuntimeWashCareRecognitionRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []
        self.recognition_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None

        self.calls.append({
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "recognize_wash_care_media",
                    "items": [{
                        "path": "/tmp/scm-label.png",
                        "label": "SCM洗唛附件",
                    }],
                    "model_id": "qwen3.8-max-preview",
                    "fallback_model_ids": ["gpt-5.6-terra"],
                    "shared_key": "wash_recognition",
                    "next_phase": "after_recognition",
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[shared or {}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def recognize_wash_care_media(self, items, *, model_id: str = "", fallback_model_ids=None):
        self.recognition_payloads.append({
            "items": items,
            "model_id": model_id,
            "fallback_model_ids": fallback_model_ids or [],
        })
        return {
            "ok": True,
            "source": "scm_wash_attachment_multimodal",
            "instructionText": "手洗，不可漂白，平摊晾干，不可熨烫，不可干洗",
            "careSymbols": {
                "washing": 13,
                "bleaching": 3,
                "drying": 8,
                "ironing": 4,
                "dryCleaning": 5,
            },
        }


class RuntimeOcrImagesRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []
        self.ocr_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None

        self.calls.append({
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "recognize_ocr_images",
                    "items": [{
                        "url": "https://img.example/detail-01.jpg",
                        "globalIndex": 0,
                        "imageIndex": 601,
                    }],
                    "lang": "chi_sim",
                    "timeout_seconds": 25,
                    "download_timeout_seconds": 20,
                    "retry_attempts": 2,
                    "shared_key": "detail_ocr",
                    "next_phase": "after_ocr",
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[shared or {}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def recognize_ocr_images(self, items, **kwargs):
        self.ocr_payloads.append({
            "items": items,
            "kwargs": kwargs,
        })
        return {
            "ok": True,
            "engine": "tesseract.js-host",
            "lang": "chi_sim",
            "scanned": 1,
            "results": [{
                "globalIndex": 0,
                "imageIndex": 601,
                "text": "想要的信息看这里",
                "confidence": 92,
            }],
        }


class RuntimeFileChooserRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []
        self.file_chooser_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None

        self.calls.append({
            "phase": phase,
            "shared": shared,
        })

        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "file_chooser_upload",
                    "items": [{
                        "label": "Gemini upload",
                        "clicks": [{"x": 12, "y": 34}, {"x": 56, "y": 78}],
                        "files": ["/tmp/demo.png"],
                    }],
                    "shared_key": "chooser_uploads",
                    "next_phase": "after_upload",
                    "shared": shared or {},
                },
            )

        return JSResult(
            success=True,
            data=[shared or {}],
            meta={
                "action": "complete",
                "has_more": False,
                "shared": shared or {},
            },
        )

    async def upload_via_file_chooser(self, items, strict: bool = False):
        self.file_chooser_payloads.append({
            "items": items,
            "strict": strict,
        })
        return {
            "ok": True,
            "items": [{
                "success": True,
                "label": "Gemini upload",
                "fileCount": 1,
                "backendNodeId": 5958,
            }],
        }


class RuntimePrepareImageFilesRunner(JSRunner):
    def __init__(self):
        super().__init__("ws://example.invalid")
        self.calls = []
        self.prepare_payloads = []

    async def _persist_run_params(self, run_token: str, params_json: str) -> None:
        return None

    async def _clear_run_params(self, run_token: str) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _reload_current_page(self) -> None:
        return None

    async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
        phase_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_PHASE__")
        shared_raw = _extract_window_assignment(expression, "__CRAWSHRIMP_SHARED__")
        phase = json.loads(phase_raw) if phase_raw is not None else None
        shared = json.loads(shared_raw) if shared_raw is not None else None
        self.calls.append({"phase": phase, "shared": shared})
        if phase == "main":
            return JSResult(
                success=True,
                data=[],
                meta={
                    "action": "prepare_image_files",
                    "items": [{"path": "/tmp/look.png"}],
                    "shared_key": "prepared",
                    "next_phase": "after_prepare",
                    "shared": shared or {},
                },
            )
        return JSResult(
            success=True,
            data=[shared or {}],
            meta={"action": "complete", "has_more": False, "shared": shared or {}},
        )

    def _prepare_safe_three_four_images(self, items):
        self.prepare_payloads.append(items)
        return {
            "ok": True,
            "items": [{
                "success": True,
                "sourcePath": "/tmp/look.png",
                "path": "/tmp/look-3x4-safe.jpg",
                "width": 750,
                "height": 1000,
                "preservesFullSubject": True,
            }],
        }


class FallbackFilenameDownloadRunner(JSRunner):
    def __init__(self, artifact_dir: str, downloads_dir: Path):
        super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
        self.downloads_dir = downloads_dir

    async def _prepare_click_download(self, download_dir: Path) -> dict:
        return {
            "configured": False,
            "method": "test",
            "downloadPath": str(download_dir),
        }

    async def _restore_click_download(self) -> None:
        return None

    async def _refresh_ws_url(self) -> None:
        return None

    async def _close_transient_download_tabs(self) -> None:
        return None

    async def _list_page_tab_ids(self) -> set[str]:
        return set()

    async def _handle_transient_download_tabs(self) -> list[dict]:
        return []

    async def _close_new_page_tabs(self, baseline_tab_ids: set[str]) -> None:
        return None

    async def cdp_mouse_click(self, x: float, y: float, delay_ms: int = 50) -> None:
        target = self.downloads_dir / "FundDetail-actual-name.xlsx"
        target.write_text("eu", encoding="utf-8")
        await asyncio.sleep(0)


class FakeCDPWebSocket:
    def __init__(self, messages):
        self.messages = [json.dumps(item) for item in messages]
        self.sent = []

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False

    async def send(self, payload):
        self.sent.append(json.loads(payload))

    async def recv(self):
        if self.messages:
            return self.messages.pop(0)
        await asyncio.sleep(3600)


class JSRunnerTests(unittest.IsolatedAsyncioTestCase):
    def test_wash_care_calibration_prompt_contains_latest_temu_symbol_mapping(self):
        prompt = _wash_care_calibration_prompt()

        self.assertIn("drying=4是悬挂晾干/line drying", prompt)
        self.assertIn("drying=8是平摊晾干/flat drying", prompt)
        self.assertIn("ironing=3是低温熨烫", prompt)
        self.assertIn("ironing=4是不可熨烫/do not iron", prompt)
        self.assertIn("8=D03 flat drying / 平摊晾干", prompt)
        self.assertIn("4=I04 do not iron / 不可熨烫", prompt)
        self.assertIn("人工校准梳理-LZH0812 高频样例", prompt)
        self.assertIn("13=W01 最高洗涤温度 40°C 手洗 / hand wash, maximum temperature 40 ℃", prompt)
        self.assertIn("10=W03 最高洗涤温度30℃ 常规程序 / maximum temperature 30 ℃, normal process", prompt)
        self.assertIn("5=D05 在阴凉处悬挂晾干 / line drying in the shade", prompt)
        self.assertIn("3=I07 熨斗底板最高温度120℃", prompt)
        self.assertIn("5=P05 不可干洗，不可专业干洗 / do not dry clean", prompt)

    def test_care_symbols_from_wash_payload_accepts_only_temu_enum_values(self):
        payload = {
            "careSymbols": {
                "washing": "13",
                "bleaching": 3,
                "drying": 8,
                "ironing": 4,
                "dryCleaning": 5,
            },
            "symbolValues": {
                "washing": 14,
                "drying": 4,
            },
        }

        self.assertEqual(_care_symbols_from_wash_payload(payload), {
            "washing": 13,
            "bleaching": 3,
            "drying": 8,
            "ironing": 4,
            "dryCleaning": 5,
        })

        self.assertEqual(_care_symbols_from_wash_payload({
            "careSymbols": {
                "washing": 999,
                "drying": "flat drying",
                "ironing": None,
            },
        }), {})

    async def test_encode_request_url_percent_encodes_non_ascii_path(self):
        encoded = _encode_request_url("https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/洗唛1776744450203_175.jpg")

        self.assertEqual(
            encoded,
            "https://scmobsprd.semirapp.com/SF_DYNA/ATTACH/%E6%B4%97%E5%94%9B1776744450203_175.jpg",
        )

    async def test_run_script_file_carries_shared_across_pages(self):
        runner = SharedCarryRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={"outer_sites": ["全球", "美国"]})

        self.assertEqual(data, [{"page": 1}, {"page": 2}])
        self.assertEqual(len(runner.calls), 2)
        self.assertEqual(runner.calls[0]["page"], 1)
        self.assertEqual(runner.calls[0]["shared"], {})
        self.assertEqual(runner.calls[1]["page"], 2)
        self.assertEqual(
            runner.calls[1]["shared"],
            {
                "requestedOuterSites": ["全球", "美国", "欧区"],
                "requestedStatDateRange": {
                    "start": "2026-04-01",
                    "end": "2026-04-07",
                },
            },
        )

    async def test_run_script_file_supports_long_pagination_sequences(self):
        runner = LongPaginationRunner(total_pages=117)

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(len(data), 117)
        self.assertEqual(data[0]["page"], 1)
        self.assertEqual(data[-1]["page"], 117)
        self.assertEqual(runner.calls[0], 1)
        self.assertEqual(runner.calls[-1], 117)

    async def test_run_script_file_raises_when_pagination_exceeds_limit(self):
        runner = EndlessPaginationRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            with patch("core.js_runner.MAX_PAGES", 3):
                with self.assertRaisesRegex(RuntimeError, "分页超过上限"):
                    await runner.run_script_file(script_path, params={})

        self.assertEqual(runner.calls, [1, 2, 3])

    async def test_run_script_file_allows_empty_shared_to_clear_page_state(self):
        runner = SharedResetRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(
            data,
            [
                {"page": 1, "phase": "prepare_row"},
                {"page": 2, "phase": "main"},
            ],
        )
        self.assertEqual(runner.calls[0]["shared"], {})
        self.assertEqual(
            runner.calls[1]["shared"],
            {
                "couponName": "KEEP-ME",
                "couponCode": "ABCDE",
            },
        )
        self.assertEqual(runner.calls[2]["shared"], {})

    async def test_run_script_file_abort_action_raises_with_partial_data(self):
        runner = AbortActionRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            with self.assertRaisesRegex(RunAbortedError, "自动化访问限制页") as captured:
                await runner.run_script_file(script_path, params={})

        self.assertEqual(captured.exception.partial_data, [{"id": "first"}, {"id": "second"}])
        self.assertEqual(runner.calls, ["main", "blocked"])
        self.assertEqual(runner.last_runtime_shared, {"step": 2})
        self.assertEqual(runner.last_runtime_phase, "blocked")

    async def test_refresh_ws_url_keeps_existing_ws_when_cdp_list_temporarily_fails(self):
        class RefreshFallbackRunner(JSRunner):
            async def _bridge_get_tab(self, tab_id):
                raise ConnectionError("读取标签页列表失败：无法连接 Chrome CDP")

            async def _bridge_get_tabs(self):
                raise AssertionError("should not be called after tab lookup transport failure")

            async def _bridge_new_tab(self, url):
                raise AssertionError("should not open a new tab after transport failure")

        runner = RefreshFallbackRunner("ws://keep-current", tab_id="tab-1", tab_url="https://example.test/app")
        await runner._refresh_ws_url()

        self.assertEqual(runner.ws_url, "ws://keep-current")
        self.assertEqual(runner.tab_id, "tab-1")

    async def test_run_script_file_complete_has_more_honors_sleep_ms_before_next_page(self):
        runner = CompleteSleepRunner()

        async def control_hook(payload):
            if payload.get("kind") == "before_sleep":
                runner.sleep_payloads.append(payload)

        async def fake_sleep(_seconds):
            return None

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            with patch("asyncio.sleep", new=fake_sleep):
                data = await runner.run_script_file(script_path, params={}, control_hook=control_hook)

        self.assertEqual(data, [{"page": 1}, {"page": 2}])
        self.assertEqual(runner.calls, [1, 2])
        self.assertEqual([item["sleep_ms"] for item in runner.sleep_payloads], [250])

    async def test_run_script_file_handles_runtime_capture_and_download_actions(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = RuntimeActionRunner(tmpdir)
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(data, [{"phase": "after_download"}])
        self.assertEqual([call["phase"] for call in runner.calls], ["main", "after_capture", "after_wheel_capture", "after_download"])
        self.assertEqual(len(runner.capture_click_payloads), 1)
        self.assertEqual(runner.capture_click_payloads[0]["clicks"], [{"x": 1, "y": 2}])
        self.assertEqual(runner.capture_click_payloads[0]["kwargs"]["include_response_body"], False)
        self.assertIn("captured", runner.calls[1]["shared"])
        self.assertTrue(runner.calls[1]["shared"]["captured"]["ok"])
        self.assertEqual(len(runner.capture_wheel_payloads), 1)
        self.assertEqual(runner.capture_wheel_payloads[0]["wheels"], [{"x": 3, "y": 4, "delta_y": 640}])
        self.assertEqual(runner.capture_wheel_payloads[0]["kwargs"]["include_response_body"], False)
        self.assertIn("wheel_captured", runner.calls[2]["shared"])
        self.assertTrue(runner.calls[2]["shared"]["wheel_captured"]["ok"])
        self.assertEqual(len(runner.download_payloads), 1)
        self.assertIn("downloads", runner.calls[3]["shared"])
        self.assertEqual(len(runner.runtime_output_files), 1)
        self.assertEqual(Path(runner.runtime_output_files[0]).name, "demo.xlsx")

    async def test_run_script_file_reinjects_params_on_followup_phases(self):
        runner = ParamReinjectRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(
                script_path,
                params={"input_file": {"rows": [{"唯一键": "REGULAR_VN_001"}]}},
            )

        self.assertEqual(data, [{"ok": True}])
        self.assertEqual([call["phase"] for call in runner.calls], ["main", "ensure_site_home"])
        self.assertTrue(runner.calls[0]["has_embedded_param_payload"])
        self.assertTrue(runner.calls[1]["has_embedded_param_payload"])

    async def test_run_script_file_retries_main_phase_navigation_errors(self):
        runner = MainNavigationRetryRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(data, [{"ok": True}])
        self.assertEqual(runner.calls[0]["phase"], "main")
        self.assertTrue(runner.calls[0]["allow_navigation_retry"])

    async def test_run_script_file_replaces_empty_script_error_with_readable_message(self):
        class EmptyErrorRunner(JSRunner):
            def __init__(self):
                super().__init__("ws://example.invalid")

            async def _persist_run_params(self, run_token: str, params_json: str) -> None:
                return None

            async def _clear_run_params(self, run_token: str) -> None:
                return None

            async def _refresh_ws_url(self) -> None:
                return None

            async def _reload_current_page(self) -> None:
                return None

            async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
                return JSResult(success=False, error="")

        runner = EmptyErrorRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: false, error: '' })", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "脚本执行失败：未返回错误详情"):
                await runner.run_script_file(script_path, params={})

    def test_build_phase_preamble_can_run_twice_in_same_node_context(self):
        if shutil.which("node") is None:
            self.skipTest("node not installed")

        runner = JSRunner("ws://example.invalid")
        params_json = json.dumps(
            {"input_file": {"rows": [{"唯一键": "REGULAR_VN_001"}]}},
            ensure_ascii=False,
        )
        preamble = runner._build_phase_preamble(1, "main", "run-token", {}, params_json)
        script = (
            "globalThis.window = {\n"
            "  sessionStorage: {\n"
            "    _store: new Map(),\n"
            "    setItem(key, value) { this._store.set(String(key), String(value)); },\n"
            "    getItem(key) { return this._store.has(String(key)) ? this._store.get(String(key)) : null; },\n"
            "  },\n"
            "  name: '',\n"
            "};\n"
            f"{preamble}"
            f"{preamble}"
            "(() => ({ success: true, data: [], meta: { has_more: false } }))();\n"
        )

        result = subprocess.run(
            ["node", "-e", script],
            capture_output=True,
            text=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)

    async def test_evaluate_surfaces_browser_exception_details(self):
        runner = JSRunner("ws://example.invalid")
        fake_ws = FakeCDPWebSocket([
            {
                "id": 1,
                "result": {
                    "result": {
                        "type": "object",
                        "subtype": "error",
                        "className": "SyntaxError",
                        "description": "SyntaxError: Unexpected token 'catch'",
                    },
                    "exceptionDetails": {
                        "text": "Uncaught",
                        "exception": {
                            "description": "SyntaxError: Unexpected token 'catch'",
                        },
                    },
                },
            },
        ])

        with patch("core.js_runner.websockets.connect", return_value=fake_ws):
            result = await runner.evaluate("broken()")

        self.assertFalse(result.success)
        self.assertEqual(result.error, "SyntaxError: Unexpected token 'catch'")

    async def test_navigate_uses_cdp_page_navigate_and_refreshes_target(self):
        runner = JSRunner("ws://example.invalid")
        fake_ws = FakeCDPWebSocket([
            {"id": 1, "result": {}},
            {"id": 2, "result": {"frameId": "frame-1"}},
        ])

        with patch("core.js_runner.websockets.connect", return_value=fake_ws):
            with patch.object(runner, "_refresh_ws_url") as refresh_ws_url:
                result = await runner.navigate("https://detail.tmall.com/item.htm?id=919643072179", wait_seconds=0)

        self.assertTrue(result.success)
        self.assertEqual(
            [item["method"] for item in fake_ws.sent],
            ["Page.enable", "Page.navigate"],
        )
        self.assertEqual(
            fake_ws.sent[1]["params"],
            {"url": "https://detail.tmall.com/item.htm?id=919643072179"},
        )
        refresh_ws_url.assert_awaited_once()

    async def test_cdp_target_eval_opens_missing_page_target(self):
        class Bridge:
            def __init__(self):
                self.opened = []

            async def get_tabs_async(self):
                return []

            async def new_tab_async(self, url):
                self.opened.append(url)
                return {
                    "id": "scm-tab",
                    "type": "page",
                    "url": url,
                    "webSocketDebuggerUrl": "ws://example.invalid/scm",
                }

            def get_tab_ws_url(self, tab):
                return tab.get("webSocketDebuggerUrl", "")

        bridge = Bridge()
        runner = JSRunner("ws://example.invalid/current")
        fake_ws = FakeCDPWebSocket([
            {
                "id": 1,
                "result": {
                    "result": {
                        "type": "object",
                        "value": {"ok": False, "reason": "scm_login_required"},
                    },
                },
            },
        ])

        with patch("core.cdp_bridge.get_bridge", return_value=bridge):
            with patch("core.js_runner.websockets.connect", return_value=fake_ws):
                result = await runner.evaluate_cdp_target(
                    "(() => ({ ok: false, reason: 'scm_login_required' }))()",
                    target_url_contains=["scm.semir.com"],
                    target_types=["page"],
                    open_url_if_missing="https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index",
                    open_wait_ms=0,
                )

        self.assertTrue(result["ok"])
        self.assertTrue(result["opened_target"])
        self.assertEqual(bridge.opened, ["https://scm.semir.com/scm-quality-mgm/index/scm-qc-wash-appr-index"])
        self.assertEqual(result["target"]["id"], "scm-tab")
        self.assertEqual(fake_ws.sent[0]["method"], "Runtime.evaluate")
        self.assertIn("scm_login_required", fake_ws.sent[0]["params"]["expression"])

    async def test_capture_screenshot_saves_png_runtime_file(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://example.invalid", artifact_dir=tmpdir)
            png_bytes = b"\x89PNG\r\n\x1a\nmember-page"
            fake_ws = FakeCDPWebSocket([
                {"id": 1, "result": {}},
                {"id": 2, "result": {}},
                {"id": 3, "result": {}},
                {
                    "id": 4,
                    "result": {
                        "result": {
                            "type": "object",
                            "value": {
                                "width": 385,
                                "height": 4960,
                                "devicePixelRatio": 2,
                                "title": "会员中心",
                                "url": "https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index",
                            },
                        },
                    },
                },
                {"id": 5, "result": {"data": base64.b64encode(png_bytes).decode("ascii")}},
            ])

            with patch("core.js_runner.websockets.connect", return_value=fake_ws):
                result = await runner.capture_screenshot(
                    filename="安踏会员页",
                    label="安踏",
                    scroll_before_capture=False,
                )

            self.assertTrue(result["ok"])
            saved = Path(result["items"][0]["path"])
            self.assertEqual(saved.name, "安踏会员页.png")
            self.assertEqual(saved.read_bytes(), png_bytes)
            self.assertEqual(runner.runtime_output_files, [str(saved)])
            self.assertEqual(
                [item["method"] for item in fake_ws.sent],
                ["Page.enable", "Runtime.enable", "Page.bringToFront", "Runtime.evaluate", "Page.captureScreenshot"],
            )
            self.assertEqual(
                fake_ws.sent[4]["params"]["clip"],
                {"x": 0, "y": 0, "width": 385, "height": 4960, "scale": 1},
            )

    async def test_capture_screenshot_can_neutralize_fixed_elements(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = JSRunner("ws://example.invalid", artifact_dir=tmpdir)
            png_bytes = b"\x89PNG\r\n\x1a\nmember-page"
            fake_ws = FakeCDPWebSocket([
                {"id": 1, "result": {}},
                {"id": 2, "result": {}},
                {"id": 3, "result": {}},
                {
                    "id": 4,
                    "result": {
                        "result": {
                            "type": "object",
                            "value": {
                                "width": 800,
                                "height": 9000,
                                "devicePixelRatio": 3,
                                "title": "会员中心",
                                "url": "https://market.m.taobao.com/app/sj/member-center-rax/pages/pages_index_index",
                                "neutralizedFixedCount": 2,
                            },
                        },
                    },
                },
                {"id": 5, "result": {"data": base64.b64encode(png_bytes).decode("ascii")}},
                {"id": 6, "result": {"result": {"type": "undefined"}}},
            ])

            with patch("core.js_runner.websockets.connect", return_value=fake_ws):
                result = await runner.capture_screenshot(
                    filename="会员页",
                    neutralize_fixed=True,
                    scroll_before_capture=False,
                )

            self.assertTrue(result["ok"])
            self.assertEqual(result["info"]["neutralizedFixedCount"], 2)
            self.assertEqual(
                [item["method"] for item in fake_ws.sent],
                [
                    "Page.enable",
                    "Runtime.enable",
                    "Page.bringToFront",
                    "Runtime.evaluate",
                    "Page.captureScreenshot",
                    "Runtime.evaluate",
                ],
            )
            self.assertIn("__crawshrimp_capture_neutralize_fixed__", fake_ws.sent[3]["params"]["expression"])
            self.assertIn("const neutralizeFixed = true", fake_ws.sent[3]["params"]["expression"])
            self.assertIn("removeAttribute('data-crawshrimp-capture-neutralized')", fake_ws.sent[5]["params"]["expression"])

    async def test_browser_session_download_uses_async_bridge_calls(self):
        class AsyncOnlyBridge:
            def __init__(self):
                self.closed = []

            def new_tab(self, url):
                raise AssertionError("sync new_tab should not run in async JSRunner path")

            def close_tab(self, tab_id):
                raise AssertionError("sync close_tab should not run in async JSRunner path")

            async def new_tab_async(self, url):
                return {
                    "id": "temp-1",
                    "webSocketDebuggerUrl": "ws://example.invalid/temp",
                }

            async def close_tab_async(self, tab_id):
                self.closed.append(tab_id)

            def get_tab_ws_url(self, tab):
                return tab.get("webSocketDebuggerUrl", "")

        bridge = AsyncOnlyBridge()
        runner = JSRunner("ws://example.invalid")

        with tempfile.TemporaryDirectory() as tmpdir:
            runner.artifact_dir = Path(tmpdir)
            fake_ws = FakeCDPWebSocket([
                {"id": 1, "result": {}},
                {"id": 2, "result": {}},
                {"id": 3, "result": {}},
            ])

            with patch("core.cdp_bridge.get_bridge", return_value=bridge):
                with patch("core.js_runner.websockets.connect", return_value=fake_ws):
                    result = await runner._download_via_browser_session(
                        "https://example.test/file.xlsx",
                        Path(tmpdir) / "file.xlsx",
                        timeout_ms=20,
                    )

        self.assertFalse(result["success"])
        self.assertEqual(bridge.closed, ["temp-1"])

    async def test_download_url_item_rejects_invalid_expected_magic(self):
        runner = JSRunner("ws://example.invalid")

        def fake_download(url, target_path, headers=None, timeout=60, no_proxy=False, progress_callback=None, deadline=None):
            target_path.parent.mkdir(parents=True, exist_ok=True)
            target_path.write_bytes(b"<!doctype html>")
            return {
                "success": True,
                "path": str(target_path),
                "finalUrl": url,
                "contentType": "text/html",
                "bytes": target_path.stat().st_size,
            }

        with tempfile.TemporaryDirectory() as tmpdir:
            runner.artifact_dir = Path(tmpdir)
            runner._download_url_sync = fake_download
            result = await runner._download_url_item({
                "url": "https://example.test/label.pdf",
                "filename": "label.pdf",
                "expected_magic": "%PDF-",
                "min_bytes": 1,
            })

        self.assertFalse(result["success"])
        self.assertEqual(result["error"], "下载文件签名不匹配")
        self.assertEqual(result["expectedMagic"], "%PDF-")
        self.assertNotIn(str(Path(tmpdir) / "label.pdf"), runner.runtime_output_files)

    async def test_check_runtime_files_validates_existing_pdf(self):
        runner = JSRunner("ws://example.invalid")

        with tempfile.TemporaryDirectory() as tmpdir:
            target_dir = Path(tmpdir) / "exports"
            target_dir.mkdir(parents=True, exist_ok=True)
            pdf = target_dir / "76096921633-9950019805299.pdf"
            pdf.write_bytes(b"%PDF-1.7\n" + b"0" * 2048)

            result = runner.check_runtime_files([{
                "filename": pdf.name,
                "target_dir": str(target_dir),
                "expected_magic": "%PDF-",
                "min_bytes": 1024,
            }])

        self.assertTrue(result["ok"])
        self.assertTrue(result["items"][0]["success"])
        self.assertTrue(result["items"][0]["signatureValidated"])
        self.assertEqual(result["items"][0]["bytes"], 2057)
        self.assertIn(str(pdf), runner.runtime_output_files)

    async def test_check_runtime_files_rejects_pdf_before_current_run(self):
        runner = JSRunner("ws://example.invalid")

        with tempfile.TemporaryDirectory() as tmpdir:
            target_dir = Path(tmpdir) / "exports"
            target_dir.mkdir(parents=True, exist_ok=True)
            pdf = target_dir / "76096921633-9950019805299.pdf"
            pdf.write_bytes(b"%PDF-1.7\n" + b"0" * 2048)
            old_time = time.time() - 120
            pdf.touch()
            os.utime(pdf, (old_time, old_time))
            result = runner.check_runtime_files([{
                "filename": pdf.name,
                "target_dir": str(target_dir),
                "expected_magic": "%PDF-",
                "min_bytes": 1024,
                "not_before_ms": int((time.time() - 30) * 1000),
            }])

        self.assertFalse(result["ok"])
        self.assertFalse(result["items"][0]["success"])
        self.assertEqual(result["items"][0]["error"], "文件早于本次任务启动时间")
        self.assertNotIn(str(pdf), runner.runtime_output_files)

    async def test_run_script_file_handles_runtime_url_capture_action(self):
        runner = RuntimeUrlCaptureRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(len(data), 1)
        self.assertEqual(len(runner.capture_url_payloads), 1)
        self.assertEqual(runner.capture_url_payloads[0]["url"], "https://example.com/landing")
        self.assertEqual(runner.capture_url_payloads[0]["kwargs"]["include_response_body"], False)
        self.assertEqual(runner.calls[1]["phase"], "after_capture_url")
        self.assertIn("captured_url", runner.calls[1]["shared"])
        self.assertEqual(
            runner.calls[1]["shared"]["captured_url"]["requestedUrl"],
            "https://example.com/landing",
        )

    async def test_capture_requests_on_ws_buffers_out_of_order_command_responses(self):
        runner = JSRunner("ws://example.invalid")
        fake_ws = FakeCDPWebSocket([
            {"id": 1, "result": {}},
            {"id": 2, "result": {}},
            {"id": 3, "result": {}},
            {
                "method": "Network.requestWillBeSent",
                "params": {
                    "requestId": "req-1",
                    "request": {
                        "url": "https://example.com/api/merchant/file/export/download",
                        "method": "POST",
                        "headers": {"content-type": "application/json"},
                    },
                },
            },
            {
                "method": "Network.responseReceived",
                "params": {
                    "requestId": "req-1",
                    "response": {
                        "status": 200,
                        "mimeType": "application/json",
                        "headers": {"content-type": "application/json"},
                        "url": "https://example.com/api/merchant/file/export/download",
                    },
                },
            },
            {
                "method": "Network.loadingFinished",
                "params": {"requestId": "req-1"},
            },
            {"id": 4, "result": {"frameId": "frame-1"}},
            {
                "id": 5,
                "result": {
                    "body": '{"result":{"fileUrl":"https://example.com/generated.xlsx"}}',
                    "base64Encoded": False,
                },
            },
        ])

        with patch("core.js_runner.websockets.connect", return_value=fake_ws):
            result = await runner._capture_requests_on_ws(
                "ws://example.invalid/capture",
                url="https://example.com/landing",
                matches=[{"url_contains": "/api/merchant/file/export/download", "method": "POST"}],
                timeout_ms=1000,
                settle_ms=0,
                min_matches=1,
                include_response_body=True,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["requestedUrl"], "https://example.com/landing")
        self.assertEqual(len(result["matches"]), 1)
        self.assertIn("generated.xlsx", result["matches"][0]["body"])
        self.assertEqual(
            [item["method"] for item in fake_ws.sent],
            [
                "Page.enable",
                "Network.enable",
                "Page.bringToFront",
                "Page.navigate",
                "Network.getResponseBody",
            ],
        )

    async def test_cdp_mouse_move_dispatches_only_mouse_moved(self):
        runner = JSRunner("ws://example.invalid")
        sent = []

        async def fake_send(method, params):
            sent.append((method, params))
            return {}

        runner._cdp_send = fake_send

        await runner.cdp_mouse_move(12, 34, 0)

        self.assertEqual(sent[0][0], "Page.bringToFront")
        self.assertEqual(sent[1][0], "Input.dispatchMouseEvent")
        self.assertEqual(sent[1][1]["type"], "mouseMoved")
        self.assertEqual(sent[1][1]["button"], "none")
        self.assertEqual(sent[1][1]["clickCount"], 0)

    async def test_capture_requests_on_ws_dispatches_wheel_events(self):
        runner = JSRunner("ws://example.invalid")
        fake_ws = FakeCDPWebSocket([
            {"id": 1, "result": {}},
            {"id": 2, "result": {}},
            {"id": 3, "result": {}},
            {
                "method": "Network.requestWillBeSent",
                "params": {
                    "requestId": "req-1",
                    "request": {
                        "url": "https://example.com/api/reviews/list?page=2",
                        "method": "GET",
                        "headers": {},
                    },
                },
            },
            {
                "method": "Network.responseReceived",
                "params": {
                    "requestId": "req-1",
                    "response": {
                        "status": 200,
                        "mimeType": "application/json",
                        "headers": {},
                        "url": "https://example.com/api/reviews/list?page=2",
                    },
                },
            },
            {
                "method": "Network.loadingFinished",
                "params": {"requestId": "req-1"},
            },
            {"id": 4, "result": {}},
            {"id": 5, "result": {}},
        ])

        with patch("core.js_runner.websockets.connect", return_value=fake_ws):
            result = await runner._capture_requests_on_ws(
                "ws://example.invalid/capture",
                wheels=[{"x": 320, "y": 420, "delta_y": 700, "delay_ms": 0}],
                matches=[{"url_contains": "/api/reviews/list"}],
                timeout_ms=1000,
                settle_ms=0,
                min_matches=1,
            )

        self.assertTrue(result["ok"])
        self.assertEqual(result["wheelTotal"], 1)
        self.assertEqual(len(result["matches"]), 1)
        self.assertEqual(
            [item["method"] for item in fake_ws.sent],
            [
                "Page.enable",
                "Network.enable",
                "Page.bringToFront",
                "Input.dispatchMouseEvent",
                "Input.dispatchMouseEvent",
            ],
        )
        self.assertEqual(fake_ws.sent[3]["params"]["type"], "mouseMoved")
        self.assertEqual(fake_ws.sent[4]["params"]["type"], "mouseWheel")
        self.assertEqual(fake_ws.sent[4]["params"]["deltaY"], 700)

    async def test_run_script_file_handles_runtime_click_download_action(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = RuntimeClickDownloadRunner(tmpdir)
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(len(data), 1)
        self.assertEqual(len(runner.download_click_payloads), 1)
        self.assertEqual(runner.download_click_payloads[0]["items"][0]["filename"], "clicked.xlsx")
        self.assertIn("click_downloads", runner.calls[1]["shared"])
        self.assertEqual(len(runner.runtime_output_files), 1)
        self.assertEqual(Path(runner.runtime_output_files[0]).name, "clicked.xlsx")

    async def test_run_script_file_handles_runtime_capture_screenshot_action(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runner = RuntimeScreenshotRunner(tmpdir)
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(data, [{"filename": "demo-member-page.png"}])
        self.assertEqual(len(runner.screenshot_payloads), 1)
        self.assertEqual(runner.screenshot_payloads[0]["filename"], "demo-member-page.png")
        self.assertEqual(runner.screenshot_payloads[0]["scroll_rounds"], 2)
        self.assertIn("screenshot", runner.calls[1]["shared"])
        self.assertEqual(len(runner.runtime_output_files), 1)
        self.assertEqual(Path(runner.runtime_output_files[0]).name, "demo-member-page.png")

    async def test_run_script_file_handles_runtime_wash_care_recognition_action(self):
        runner = RuntimeWashCareRecognitionRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(len(data), 1)
        self.assertEqual(len(runner.recognition_payloads), 1)
        self.assertEqual(runner.recognition_payloads[0]["items"][0]["path"], "/tmp/scm-label.png")
        self.assertEqual(runner.recognition_payloads[0]["model_id"], "qwen3.8-max-preview")
        self.assertEqual(runner.recognition_payloads[0]["fallback_model_ids"], ["gpt-5.6-terra"])
        self.assertIn("wash_recognition", runner.calls[1]["shared"])
        self.assertEqual(
            runner.calls[1]["shared"]["wash_recognition"]["instructionText"],
            "手洗，不可漂白，平摊晾干，不可熨烫，不可干洗",
        )
        self.assertEqual(
            runner.calls[1]["shared"]["wash_recognition"]["careSymbols"],
            {
                "washing": 13,
                "bleaching": 3,
                "drying": 8,
                "ironing": 4,
                "dryCleaning": 5,
            },
        )

    async def test_run_script_file_handles_runtime_ocr_images_action(self):
        runner = RuntimeOcrImagesRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(len(data), 1)
        self.assertEqual(len(runner.ocr_payloads), 1)
        self.assertEqual(runner.ocr_payloads[0]["items"][0]["url"], "https://img.example/detail-01.jpg")
        self.assertEqual(runner.ocr_payloads[0]["kwargs"]["lang"], "chi_sim")
        self.assertEqual(runner.ocr_payloads[0]["kwargs"]["timeout_seconds"], 25)
        self.assertEqual(runner.ocr_payloads[0]["kwargs"]["download_timeout_seconds"], 20)
        self.assertEqual(runner.ocr_payloads[0]["kwargs"]["retry_attempts"], 2)
        self.assertIn("detail_ocr", runner.calls[1]["shared"])
        self.assertEqual(runner.calls[1]["shared"]["detail_ocr"]["engine"], "tesseract.js-host")
        self.assertEqual(
            runner.calls[1]["shared"]["detail_ocr"]["results"][0]["text"],
            "想要的信息看这里",
        )

    async def test_run_script_file_handles_runtime_file_chooser_upload_action(self):
        runner = RuntimeFileChooserRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(len(data), 1)
        self.assertEqual(len(runner.file_chooser_payloads), 1)
        self.assertEqual(runner.file_chooser_payloads[0]["items"][0]["label"], "Gemini upload")
        self.assertIn("chooser_uploads", runner.calls[1]["shared"])
        self.assertEqual(
            runner.calls[1]["shared"]["chooser_uploads"]["items"][0]["backendNodeId"],
            5958,
        )

    async def test_run_script_file_handles_runtime_prepare_image_files_action(self):
        runner = RuntimePrepareImageFilesRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "noop.js"
            script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
            data = await runner.run_script_file(script_path, params={})

        self.assertEqual(len(data), 1)
        self.assertEqual(runner.prepare_payloads[0][0]["path"], "/tmp/look.png")
        self.assertIn("prepared", runner.calls[1]["shared"])
        self.assertEqual(runner.calls[1]["shared"]["prepared"]["items"][0]["width"], 750)
        self.assertTrue(runner.calls[1]["shared"]["prepared"]["items"][0]["preservesFullSubject"])

    def test_find_new_downloaded_file_detects_default_downloads_fallback(self):
        runner = JSRunner("ws://example.invalid")

        with tempfile.TemporaryDirectory() as tmpdir:
            runtime_dir = Path(tmpdir) / "runtime"
            downloads_dir = Path(tmpdir) / "Downloads"
            runtime_dir.mkdir()
            downloads_dir.mkdir()

            old_file = downloads_dir / "FundDetail-1776051005012-bc5d.xlsx"
            old_file.write_text("old", encoding="utf-8")

            pattern = runner._build_download_candidate_regex(
                "https://agentseller.temu.com/labor-tag-u/FundDetail-1776051005012-bc5d.xlsx?sign=demo"
            )
            baseline = runner._snapshot_download_state([runtime_dir, downloads_dir], pattern)
            started_at_ns = time.time_ns()

            fresh_file = downloads_dir / "FundDetail-1776051005012-bc5d (1).xlsx"
            fresh_file.write_text("new", encoding="utf-8")

            detected = runner._find_new_downloaded_file(
                [runtime_dir, downloads_dir],
                baseline,
                pattern,
                started_at_ns,
            )

            self.assertEqual(detected, fresh_file)

    async def test_download_clicks_falls_back_to_any_new_xlsx_when_filename_drifts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            home_dir = Path(tmpdir)
            downloads_dir = home_dir / "Downloads"
            downloads_dir.mkdir()
            runner = FallbackFilenameDownloadRunner(tmpdir, downloads_dir)

            with patch("pathlib.Path.home", return_value=home_dir):
                result = await runner.download_clicks([{
                    "clicks": [{"x": 12, "y": 34}],
                    "filename": "eu.xlsx",
                    "label": "欧区",
                    "expected_url": "https://example.com/FundDetail-expected-name.xlsx",
                    "timeout_ms": 1500,
                }])

            self.assertTrue(result["ok"])
            self.assertEqual(len(result["items"]), 1)
            self.assertTrue(result["items"][0]["success"])
            self.assertEqual(result["items"][0]["matchedBy"], "fallback_any_xlsx")
            self.assertTrue(Path(result["items"][0]["path"]).exists())
            self.assertEqual(Path(result["items"][0]["path"]).name, "eu.xlsx")

    async def test_download_clicks_routes_dynamic_pdf_to_controlled_directory_and_validates_signature(self):
        class ControlledPdfRunner(JSRunner):
            def __init__(self, artifact_dir: str):
                super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
                self.controlled_dir = None
                self.restored = False

            async def _prepare_click_download(self, download_dir: Path) -> dict:
                self.controlled_dir = download_dir
                return {
                    "configured": True,
                    "method": "Page.setDownloadBehavior",
                    "downloadPath": str(download_dir),
                }

            async def _restore_click_download(self) -> None:
                self.restored = True

            async def _refresh_ws_url(self) -> None:
                return None

            async def _close_transient_download_tabs(self) -> None:
                return None

            async def _list_page_tab_ids(self) -> set[str]:
                return set()

            async def _handle_transient_download_tabs(self) -> list[dict]:
                return []

            async def _close_new_page_tabs(self, baseline_tab_ids: set[str]) -> None:
                return None

            async def cdp_mouse_click(self, x: float, y: float, delay_ms: int = 50) -> None:
                assert self.controlled_dir is not None
                (self.controlled_dir / "temu-generated-name.pdf").write_bytes(b"%PDF-1.4\n%%EOF\n")

        with tempfile.TemporaryDirectory() as tmpdir:
            runner = ControlledPdfRunner(tmpdir)
            output_dir = Path(tmpdir) / "selected-output"
            result = await runner.download_clicks([{
                "clicks": [{"x": 12, "y": 34}],
                "filename": "20922511720810101110-9950019805206.pdf",
                "label": "TEMU official PDF",
                "source": "temu_official_download",
                "target_dir": str(output_dir),
                "timeout_ms": 1500,
            }])

            self.assertTrue(result["ok"])
            item = result["items"][0]
            self.assertEqual(item["matchedBy"], "fallback_any_pdf")
            self.assertTrue(item["signatureValidated"])
            self.assertEqual(item["source"], "temu_official_download")
            self.assertTrue(item["browserDownloadControl"]["configured"])
            self.assertEqual(Path(item["path"]).read_bytes()[:5], b"%PDF-")
            self.assertEqual(Path(item["path"]).parent, output_dir)
            self.assertEqual(item["targetDir"], str(output_dir))
            self.assertTrue(runner.restored)

    async def test_download_clicks_can_save_pdf_from_captured_blob_anchor(self):
        class CapturedBlobPdfRunner(JSRunner):
            def __init__(self, artifact_dir: str):
                super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
                self.controlled_dir = None
                self.clicked = False
                self.installed = False

            async def _prepare_click_download(self, download_dir: Path) -> dict:
                self.controlled_dir = download_dir
                return {
                    "configured": True,
                    "method": "Page.setDownloadBehavior",
                    "downloadPath": str(download_dir),
                }

            async def _restore_click_download(self) -> None:
                return None

            async def _refresh_ws_url(self) -> None:
                return None

            async def _close_transient_download_tabs(self) -> None:
                return None

            async def _list_page_tab_ids(self) -> set[str]:
                return set()

            async def _handle_transient_download_tabs(self) -> list[dict]:
                return []

            async def _close_new_page_tabs(self, baseline_tab_ids: set[str]) -> None:
                return None

            async def _install_blob_download_capture(self, capture_id: str, expected_filename: str = "", expected_magic: str = "") -> dict:
                self.installed = True
                return {
                    "installed": True,
                    "captureId": capture_id,
                    "expectedFilename": expected_filename,
                    "expectedMagic": expected_magic,
                }

            async def _read_blob_download_capture(self, capture_id: str, *, include_base64: bool = False) -> dict:
                if not self.clicked:
                    return {"found": False}
                payload = b"%PDF-1.4\ncaptured from blob\n%%EOF\n"
                return {
                    "found": True,
                    "capture": {
                        "id": capture_id,
                        "href": "blob:https://agentseller.temu.com/demo",
                        "download": "洗水唛标签.pdf",
                        "done": True,
                        "ok": True,
                        "bytes": len(payload),
                        "type": "application/pdf",
                        "magic": "%PDF-",
                        "base64": base64.b64encode(payload).decode("ascii") if include_base64 else "",
                    },
                }

            async def cdp_mouse_click(self, x: float, y: float, delay_ms: int = 50) -> None:
                self.clicked = True

        with tempfile.TemporaryDirectory() as tmpdir:
            runner = CapturedBlobPdfRunner(tmpdir)
            result = await runner.download_clicks([{
                "clicks": [{"x": 12, "y": 34}],
                "filename": "official.pdf",
                "label": "TEMU official PDF",
                "source": "temu_official_download",
                "expected_magic": "%PDF-",
                "capture_blob_download": True,
                "timeout_ms": 1500,
            }])

            self.assertTrue(result["ok"])
            item = result["items"][0]
            self.assertTrue(runner.installed)
            self.assertEqual(item["matchedBy"], "captured_blob_anchor")
            self.assertEqual(item["source"], "temu_official_download")
            self.assertTrue(item["signatureValidated"])
            self.assertEqual(item["blobDownloadCapture"]["capture"]["download"], "洗水唛标签.pdf")
            self.assertEqual(Path(item["path"]).name, "official.pdf")
            self.assertEqual(Path(item["path"]).read_bytes()[:5], b"%PDF-")
            self.assertEqual(runner.runtime_output_files, [item["path"]])

    async def test_download_clicks_can_save_pdf_from_page_blob_expression(self):
        class PageBlobRunner(JSRunner):
            def __init__(self, artifact_dir: str):
                super().__init__("ws://example.invalid", artifact_dir=artifact_dir)

            async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
                payload = b"%PDF-1.3\npage blob\n%%EOF\n"
                return JSResult(
                    success=True,
                    data=[{
                        "url": "blob:https://agentseller.temu.com/demo",
                        "type": "application/pdf",
                        "bytes": len(payload),
                        "magic": "%PDF-",
                        "base64": base64.b64encode(payload).decode("ascii"),
                    }],
                )

        with tempfile.TemporaryDirectory() as tmpdir:
            runner = PageBlobRunner(tmpdir)
            output_dir = Path(tmpdir) / "page-blob-output"
            result = await runner.download_clicks([{
                "clicks": [],
                "filename": "from-page-blob.pdf",
                "label": "TEMU modal pdfUrl",
                "source": "temu_official_download",
                "expected_magic": "%PDF-",
                "target_dir": str(output_dir),
                "page_blob_expression": "(() => ({success: true, data: [{}]}))()",
            }])

            self.assertTrue(result["ok"])
            item = result["items"][0]
            self.assertEqual(item["matchedBy"], "page_blob_expression")
            self.assertEqual(item["pageBlob"]["type"], "application/pdf")
            self.assertTrue(item["signatureValidated"])
            self.assertEqual(Path(item["path"]).name, "from-page-blob.pdf")
            self.assertEqual(Path(item["path"]).parent, output_dir)
            self.assertEqual(item["targetDir"], str(output_dir))
            self.assertEqual(Path(item["path"]).read_bytes()[:5], b"%PDF-")

    async def test_download_clicks_rejects_html_saved_with_pdf_extension(self):
        class InvalidPdfRunner(JSRunner):
            def __init__(self, artifact_dir: str):
                super().__init__("ws://example.invalid", artifact_dir=artifact_dir)
                self.controlled_dir = None

            async def _prepare_click_download(self, download_dir: Path) -> dict:
                self.controlled_dir = download_dir
                return {"configured": True, "method": "test", "downloadPath": str(download_dir)}

            async def _restore_click_download(self) -> None:
                return None

            async def _refresh_ws_url(self) -> None:
                return None

            async def _close_transient_download_tabs(self) -> None:
                return None

            async def _list_page_tab_ids(self) -> set[str]:
                return set()

            async def _handle_transient_download_tabs(self) -> list[dict]:
                return []

            async def _close_new_page_tabs(self, baseline_tab_ids: set[str]) -> None:
                return None

            async def cdp_mouse_click(self, x: float, y: float, delay_ms: int = 50) -> None:
                assert self.controlled_dir is not None
                (self.controlled_dir / "login.pdf").write_bytes(b"<html>login</html>")

        with tempfile.TemporaryDirectory() as tmpdir:
            runner = InvalidPdfRunner(tmpdir)
            result = await runner.download_clicks([{
                "clicks": [{"x": 12, "y": 34}],
                "filename": "official.pdf",
                "timeout_ms": 1500,
            }])

            self.assertFalse(result["ok"])
            self.assertIn("签名不匹配", result["items"][0]["error"])
            self.assertFalse((Path(tmpdir) / "official.pdf").exists())

    def test_file_inject_expression_verifies_real_input_file_count(self):
        runner = JSRunner("ws://example.invalid")

        expression = runner._build_file_inject_expression(
            [{"selector": "#upload", "cache_keys": ["file:sample"]}],
            [{
                "cache_key": "file:sample",
                "name": "sample.png",
                "mime": "image/png",
                "b64": "AA==",
            }],
        )

        self.assertIn("input.files.length !== dt.files.length", expression)
        self.assertIn("文件注入后页面只识别到", expression)

    async def test_inject_files_prefers_native_cdp_file_input_paths(self):
        runner = JSRunner("ws://example.invalid")

        with tempfile.TemporaryDirectory() as tmpdir:
            sample = Path(tmpdir) / "208426107213.mp4"
            sample.write_bytes(b"video-bytes")
            fake_ws = FakeCDPWebSocket([
                {"id": 1, "result": {}},
                {"id": 2, "result": {}},
                {"id": 3, "result": {}},
                {"id": 4, "result": {}},
                {"id": 5, "result": {"root": {"nodeId": 101}}},
                {"id": 6, "result": {"nodeId": 202}},
                {"id": 7, "result": {}},
                {
                    "id": 8,
                    "result": {
                        "result": {
                            "type": "object",
                            "value": {
                                "success": True,
                                "data": [{
                                    "selector": "input[type=file][name=file]",
                                    "count": 1,
                                    "method": "DOM.setFileInputFiles",
                                }],
                                "meta": {"has_more": False},
                            },
                        },
                    },
                },
            ])

            with patch("core.js_runner.websockets.connect", return_value=fake_ws):
                result = await runner.inject_files([{
                    "selector": "input[type=file][name=file]",
                    "files": [str(sample)],
                }])

        self.assertTrue(result.success)
        self.assertEqual(result.data[0]["method"], "DOM.setFileInputFiles")
        self.assertEqual(
            [item["method"] for item in fake_ws.sent],
            [
                "Page.enable",
                "DOM.enable",
                "Runtime.enable",
                "Page.bringToFront",
                "DOM.getDocument",
                "DOM.querySelector",
                "DOM.setFileInputFiles",
                "Runtime.evaluate",
            ],
        )
        self.assertEqual(fake_ws.sent[6]["params"]["files"], [str(sample)])
        self.assertEqual(runner._file_payload_cache, {})
        self.assertNotIn("video-bytes", json.dumps(fake_ws.sent, ensure_ascii=False))

    async def test_inject_files_falls_back_to_datatransfer_when_cdp_native_fails(self):
        class NativeFailRunner(JSRunner):
            def __init__(self):
                super().__init__("ws://example.invalid")
                self.expressions = []

            async def _inject_files_via_cdp(self, items):
                return JSResult(success=False, error="native unavailable")

            async def evaluate_with_reconnect(self, expression: str, allow_navigation_retry: bool = False) -> JSResult:
                self.expressions.append(expression)
                return JSResult(
                    success=True,
                    data=[{"selector": "#upload", "count": 1}],
                    meta={"has_more": False},
                )

        runner = NativeFailRunner()
        with tempfile.TemporaryDirectory() as tmpdir:
            sample = Path(tmpdir) / "demo.png"
            sample.write_bytes(b"png")
            result = await runner.inject_files([{
                "selector": "#upload",
                "files": [str(sample)],
            }])

        self.assertTrue(result.success)
        self.assertEqual(result.data[0]["count"], 1)
        self.assertIn(base64.b64encode(b"png").decode("ascii"), runner.expressions[0])

    async def test_upload_via_file_chooser_sets_files_after_native_chooser_event(self):
        runner = JSRunner("ws://example.invalid")

        with tempfile.TemporaryDirectory() as tmpdir:
            sample = Path(tmpdir) / "demo.png"
            sample.write_bytes(b"png")
            fake_ws = FakeCDPWebSocket([
                {"id": 1, "result": {}},
                {"id": 2, "result": {}},
                {"id": 3, "result": {}},
                {"id": 4, "result": {}},
                {"id": 5, "result": {}},
                {"id": 6, "result": {}},
                {"id": 7, "result": {}},
                {"method": "Page.fileChooserOpened", "params": {"mode": "selectMultiple", "backendNodeId": 5958}},
                {"id": 8, "result": {}},
                {"id": 9, "result": {}},
                {"id": 10, "result": {}},
            ])

            with patch("core.js_runner.websockets.connect", return_value=fake_ws):
                result = await runner.upload_via_file_chooser([{
                    "label": "Gemini upload",
                    "clicks": [{"x": 12, "y": 34}],
                    "files": [str(sample)],
                    "settle_ms": 0,
                }], strict=True)

        self.assertTrue(result["ok"])
        self.assertEqual(len(result["items"]), 1)
        self.assertTrue(result["items"][0]["success"])
        self.assertEqual(result["items"][0]["backendNodeId"], 5958)
        self.assertEqual(result["items"][0]["mode"], "selectMultiple")
        self.assertEqual(
            [item["method"] for item in fake_ws.sent],
            [
                "Page.enable",
                "DOM.enable",
                "Runtime.enable",
                "Page.bringToFront",
                "Page.setInterceptFileChooserDialog",
                "Input.dispatchMouseEvent",
                "Input.dispatchMouseEvent",
                "Input.dispatchMouseEvent",
                "DOM.setFileInputFiles",
                "Page.setInterceptFileChooserDialog",
            ],
        )


if __name__ == "__main__":
    unittest.main()
