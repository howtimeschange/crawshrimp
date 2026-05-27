import asyncio
import unittest
from pathlib import Path
import tempfile
from unittest.mock import AsyncMock, patch

from core import adapter_loader, api_server


class ApiTaskLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def test_build_live_progress_exposes_shein_detail_stage_fields(self):
        progress = api_server._build_live_progress(
            {
                "phase": "collect_detail_page",
                "records": 20363,
                "shared": {
                    "total_rows": 20363,
                    "current_exec_no": 20363,
                    "list_total_rows": 20363,
                    "list_completed_rows": 20363,
                    "list_total_batches": 113,
                    "list_completed_batches": 113,
                    "detail_total_targets": 20363,
                    "detail_completed_targets": 1220,
                    "detail_current_target_index": 1221,
                    "detail_current_target": "sk25050817072795161",
                    "detail_request_count": 1221,
                    "detail_records_collected": 42,
                    "current_store": "客退详情 sk25050817072795161 1221/20363",
                },
            },
            run_control=None,
        )

        self.assertEqual(progress["current"], 20363)
        self.assertEqual(progress["total"], 20363)
        self.assertEqual(progress["list_total_rows"], 20363)
        self.assertEqual(progress["list_completed_rows"], 20363)
        self.assertEqual(progress["list_total_batches"], 113)
        self.assertEqual(progress["list_completed_batches"], 113)
        self.assertEqual(progress["detail_total_targets"], 20363)
        self.assertEqual(progress["detail_completed_targets"], 1220)
        self.assertEqual(progress["detail_current_target_index"], 1221)
        self.assertEqual(progress["detail_current_target"], "sk25050817072795161")
        self.assertEqual(progress["detail_request_count"], 1221)
        self.assertEqual(progress["detail_records_collected"], 42)

    async def test_lifespan_skips_orphan_cleanup_when_backend_port_is_unavailable(self):
        calls = []

        class FakeLock:
            acquired = True

            def close(self):
                calls.append("lock.close")

        with patch("core.api_server.data_sink.init_db", side_effect=lambda: calls.append("init_db")):
            with patch("core.api_server._acquire_backend_instance_lock", return_value=FakeLock(), create=True):
                with patch("core.api_server._is_backend_port_available", return_value=False, create=True):
                    with patch("core.api_server.data_sink.list_active_runs", side_effect=AssertionError("should not list active runs")):
                        with patch("core.api_server.data_sink.stop_orphaned_active_runs", side_effect=AssertionError("should not stop runs")):
                            with patch("core.api_server.adapter_loader.scan_all", side_effect=AssertionError("should not scan adapters")):
                                with patch("core.api_server.sched_module.start", side_effect=AssertionError("should not start scheduler")):
                                    async with api_server.lifespan(api_server.app):
                                        calls.append("yielded")

        self.assertIn("init_db", calls)
        self.assertIn("yielded", calls)
        self.assertIn("lock.close", calls)

    async def test_lifespan_skips_orphan_cleanup_when_instance_lock_is_unavailable(self):
        calls = []

        class FakeLock:
            acquired = False

            def close(self):
                calls.append("lock.close")

        with patch("core.api_server.data_sink.init_db", side_effect=lambda: calls.append("init_db")):
            with patch("core.api_server._acquire_backend_instance_lock", return_value=FakeLock(), create=True):
                with patch("core.api_server._is_backend_port_available", return_value=True, create=True):
                    with patch("core.api_server.data_sink.list_active_runs", side_effect=AssertionError("should not list active runs")):
                        with patch("core.api_server.data_sink.stop_orphaned_active_runs", side_effect=AssertionError("should not stop runs")):
                            with patch("core.api_server.adapter_loader.scan_all", side_effect=AssertionError("should not scan adapters")):
                                with patch("core.api_server.sched_module.start", side_effect=AssertionError("should not start scheduler")):
                                    async with api_server.lifespan(api_server.app):
                                        calls.append("yielded")

        self.assertIn("init_db", calls)
        self.assertIn("yielded", calls)
        self.assertIn("lock.close", calls)

    async def test_list_tasks_includes_adapter_version(self):
        class FakeTask:
            id = "voucher_batch_create"
            name = "批量创建优惠券"
            description = "desc"
            param_probe_script = None
            execution_ui_mode = None
            validation_only_label = None
            auto_precheck_note = None
            params = []
            trigger = type("Trigger", (), {"model_dump": lambda self: {"type": "manual"}})()

        class FakeAdapter:
            id = "shopee-plus-v2"
            name = "Shopee 运营助手"
            version = "2.3.4"
            tasks = [FakeTask()]

        with patch("core.api_server.adapter_loader.scan_all"):
            with patch("core.api_server.adapter_loader.list_all", return_value=[{"id": "shopee-plus-v2", "enabled": True}]):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.sched_module.list_jobs", return_value=[]):
                        with patch("core.api_server.data_sink.get_latest_run", return_value=None):
                            tasks = api_server.list_tasks()

        self.assertEqual(len(tasks), 1)
        self.assertEqual(tasks[0]["adapter_id"], "shopee-plus-v2")
        self.assertEqual(tasks[0]["adapter_version"], "2.3.4")

    async def test_run_task_background_marks_early_crash_as_error_and_clears_control(self):
        jid = "temu::tax_free_return_confirm"
        original_status = dict(api_server._run_status)
        original_logs = dict(api_server._run_logs)
        original_controls = dict(api_server._run_controls)

        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()

        try:
            api_server._run_status[jid] = {"status": "running", "run_id": None, "records": 0}
            api_server._run_logs[jid] = []
            api_server._run_controls[jid] = run_control

            with patch(
                "core.api_server._execute_task",
                new=AsyncMock(side_effect=RuntimeError("boom before begin_run")),
            ):
                await api_server._run_task_background(
                    "temu",
                    "tax_free_return_confirm",
                    {},
                    {},
                    run_control,
                )

            self.assertEqual(api_server._run_status[jid]["status"], "error")
            self.assertIsNone(api_server._run_status[jid]["run_id"])
            self.assertEqual(api_server._run_status[jid]["records"], 0)
            self.assertIn("boom before begin_run", api_server._run_status[jid]["error"])
            self.assertNotIn(jid, api_server._run_controls)
            self.assertTrue(any("FATAL" in line for line in api_server._run_logs[jid]))
        finally:
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_logs.clear()
            api_server._run_logs.update(original_logs)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)

    async def test_run_task_scans_installed_adapters_before_initial_lookup(self):
        original_status = dict(api_server._run_status)
        original_logs = dict(api_server._run_logs)
        original_controls = dict(api_server._run_controls)

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                adapter_dir = Path(tmpdir) / "adapters" / "dasen-ops-assistant"
                adapter_dir.mkdir(parents=True, exist_ok=True)
                (adapter_dir / "manifest.yaml").write_text(
                    "\n".join([
                        "id: dasen-ops-assistant",
                        "name: 大森运营助手",
                        "version: 0.1.0",
                        "entry_url: https://ai.semir.com/console/studio/showcase/create/",
                        "tasks:",
                        "  - id: batch_create_showcase",
                        "    name: 批量新建案例",
                        "    script: batch-create-showcase.js",
                        "    trigger:",
                        "      type: manual",
                    ]),
                    encoding="utf-8",
                )
                (adapter_dir / "batch-create-showcase.js").write_text(
                    "({ success: true, data: [], meta: { has_more: false } })",
                    encoding="utf-8",
                )

                adapter_loader._adapters.clear()
                adapter_loader._adapter_dirs.clear()
                adapter_loader._enabled.clear()
                adapter_loader._install_meta.clear()

                with patch.dict("os.environ", {"CRAWSHRIMP_DATA": tmpdir}, clear=False):
                    with patch("core.api_server._run_task_background", new=AsyncMock()) as background_run:
                        result = await api_server.run_task(
                            "dasen-ops-assistant",
                            "batch_create_showcase",
                            api_server.RunTaskRequest(params={}),
                        )
                        await asyncio.sleep(0)

                self.assertTrue(result["ok"])
                background_run.assert_awaited_once()
        finally:
            adapter_loader._adapters.clear()
            adapter_loader._adapter_dirs.clear()
            adapter_loader._enabled.clear()
            adapter_loader._install_meta.clear()
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_logs.clear()
            api_server._run_logs.update(original_logs)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)

    async def test_tmall_buyer_reviews_navigates_to_each_item_url_between_runs(self):
        class FakeBridge:
            def get_tabs(self):
                return []

            def new_tab(self, url):
                return {"id": "tab-1", "url": url, "webSocketDebuggerUrl": "ws://example.invalid"}

            def find_tab(self, url):
                return {"id": "tab-1", "url": url, "webSocketDebuggerUrl": "ws://example.invalid"}

            def get_tab_ws_url(self, tab):
                return "ws://example.invalid"

        class FakeRunner:
            def __init__(self, *args, **kwargs):
                self.navigations = []
                self.runtime_output_files = []

            async def evaluate(self, expression):
                return type("Result", (), {"success": True, "data": [], "meta": {"logged_in": True}, "error": None})()

            async def navigate(self, url, wait_seconds=0):
                self.navigations.append(str(url))
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def run_script_file(self, script_path, params=None, control_hook=None):
                return [{
                    "商品ID": params["item_links"].split("id=")[1].split("&")[0],
                    "执行结果": "成功",
                }]

        jid = "tmall-ops-assistant::buyer_reviews"
        original_status = dict(api_server._run_status)
        original_logs = dict(api_server._run_logs)
        original_controls = dict(api_server._run_controls)

        fake_runner = FakeRunner()
        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                adapter_dir = Path(tmpdir)
                (adapter_dir / "auth_check.js").write_text("({ success: true, data: [], meta: { logged_in: true, has_more: false } })", encoding="utf-8")
                (adapter_dir / "buyer-reviews.js").write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")

                class FakeTask:
                    id = "buyer_reviews"
                    name = "买家评价抓取"
                    description = ""
                    entry_url = "https://detail.tmall.com/item.htm"
                    tab_match_prefixes = []
                    output = []
                    script = "buyer-reviews.js"
                    skip_auth = False
                    params = [
                        type("Param", (), {"id": "item_links", "default": None})(),
                        type("Param", (), {"id": "page_size", "default": "20"})(),
                        type("Param", (), {"id": "max_pages", "default": 30})(),
                    ]

                class FakeAdapter:
                    id = "tmall-ops-assistant"
                    name = "天猫运营助手"
                    entry_url = "https://detail.tmall.com/item.htm"
                    tab_match_prefixes = []
                    tasks = [FakeTask()]
                    auth = type("Auth", (), {"check_script": "auth_check.js", "login_url": "https://login.taobao.com/member/login.jhtml"})()

                with patch("core.api_server.adapter_loader.scan_all"):
                    with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                        with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                            with patch("core.js_runner.JSRunner", return_value=fake_runner):
                                with patch("core.api_server.data_sink.begin_run", return_value=999):
                                    with patch("core.api_server.data_sink.prepare_artifact_dir", return_value="/tmp"):
                                        with patch("core.api_server.data_sink.finish_run"):
                                            with patch("core.api_server.adapter_loader.get_adapter_dir", return_value=adapter_dir):
                                                await api_server._execute_task(
                                                    "tmall-ops-assistant",
                                                    "buyer_reviews",
                                                    {
                                                        "item_links": "、".join([
                                                            "https://detail.tmall.com/item.htm?id=919643072179&skuId=5789814873879",
                                                            "https://detail.tmall.com/item.htm?id=1023254962064&skuId=6034929285662",
                                                            "https://detail.tmall.com/item.htm?id=732533512173&skuId=6038497472965",
                                                        ]),
                                                    },
                                                    {},
                                                    run_control=run_control,
                                                )

            self.assertGreaterEqual(len(fake_runner.navigations), 3)
            self.assertEqual(
                fake_runner.navigations[-3:],
                [
                    "https://detail.tmall.com/item.htm?id=919643072179&skuId=5789814873879",
                    "https://detail.tmall.com/item.htm?id=1023254962064&skuId=6034929285662",
                    "https://detail.tmall.com/item.htm?id=732533512173&skuId=6038497472965",
                ],
            )
        finally:
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_logs.clear()
            api_server._run_logs.update(original_logs)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)


if __name__ == "__main__":
    unittest.main()
