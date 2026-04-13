import json
import tempfile
import unittest
from pathlib import Path

from core.js_runner import JSRunner
from core.models import JSResult


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
        page = None
        phase = None
        shared = None
        for line in expression.splitlines():
            if line.startswith("window.__CRAWSHRIMP_PAGE__ = "):
                page = int(line.split("=", 1)[1].strip().rstrip(";"))
            elif line.startswith("window.__CRAWSHRIMP_PHASE__ = "):
                phase = json.loads(line.split("=", 1)[1].strip().rstrip(";"))
            elif line.startswith("window.__CRAWSHRIMP_SHARED__ = "):
                shared = json.loads(line.split("=", 1)[1].strip().rstrip(";"))

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


class JSRunnerTests(unittest.IsolatedAsyncioTestCase):
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


if __name__ == "__main__":
    unittest.main()
