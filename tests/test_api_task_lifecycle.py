import asyncio
import contextlib
import json
import sys
import threading
import unittest
from pathlib import Path
import tempfile
from unittest.mock import AsyncMock, patch

from core import adapter_loader, api_server
from core import data_sink
from core.models import OutputType


class AsgiResponse:
    def __init__(self, status_code: int, body: bytes):
        self.status_code = status_code
        self._body = body

    def json(self):
        return json.loads(self._body.decode("utf-8") or "{}")


class ApiTaskLifecycleTests(unittest.IsolatedAsyncioTestCase):
    async def _api_request(self, method: str, path: str, json_body: dict | None = None) -> AsgiResponse:
        body = json.dumps(json_body or {}).encode("utf-8") if json_body is not None else b""
        messages = []
        request_sent = False

        async def receive():
            nonlocal request_sent
            if not request_sent:
                request_sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}

        async def send(message):
            messages.append(message)

        await api_server.app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": method,
                "scheme": "http",
                "path": path,
                "raw_path": path.encode("utf-8"),
                "query_string": b"",
                "headers": [
                    (api_server.API_TOKEN_HEADER.encode("latin-1"), b"test-token"),
                    (b"content-type", b"application/json"),
                ],
                "client": ("127.0.0.1", 12345),
                "server": ("127.0.0.1", 18765),
            },
            receive,
            send,
        )
        status_code = next((item["status"] for item in messages if item["type"] == "http.response.start"), 500)
        response_body = b"".join(item.get("body", b"") for item in messages if item["type"] == "http.response.body")
        return AsgiResponse(status_code, response_body)

    async def test_live_progress_persists_shoe_organize_fields_between_events(self):
        run_control = {}
        progress = api_server._build_live_progress(
            {
                "kind": "shoe_organize_progress",
                "phase": "鞋品姿势识别与命名",
                "organize_total": 10,
                "organize_completed": 4,
                "organize_active": True,
                "organize_current_style": "204325141014",
                "organize_current_color": "黑色90001",
                "organize_stage": "复制命名",
            },
            run_control=run_control,
        )

        self.assertEqual(progress["organize_total"], 10)
        self.assertEqual(progress["organize_completed"], 4)
        self.assertTrue(progress["organize_active"])
        self.assertEqual(progress["organize_current_style"], "204325141014")
        self.assertEqual(progress["organize_current_color"], "黑色90001")
        self.assertEqual(progress["organize_stage"], "复制命名")

        persisted = api_server._build_live_progress(
            {"kind": "heartbeat"},
            run_control=run_control,
        )
        self.assertEqual(persisted["organize_completed"], 4)
        self.assertEqual(persisted["organize_stage"], "复制命名")

    async def test_read_local_excel_accepts_gbk_csv_headers(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "temu-wash-label-demand.csv"
            path.write_bytes(
                (
                    "款号,制造商名称,制造商地址,生产日期,批次号,洗水唛宽度mm,洗水唛长度mm,上下预留mm\n"
                    '208326105215,"Zhejiang Semir Garment Co.,Ltd.",地址,2026/7/1,PC241016,45,270,10\n'
                ).encode("gbk")
            )

            table = api_server._read_local_excel(str(path))

        self.assertNotIn("error", table)
        self.assertEqual(table["headers"][0], "款号")
        self.assertEqual(table["rows"][0]["款号"], "208326105215")
        self.assertEqual(table["rows"][0]["洗水唛长度mm"], "270")

    async def test_short_video_progress_exposes_shared_results_count(self):
        progress = api_server._build_live_progress(
            {
                "kind": "before_phase",
                "records": 0,
                "phase": "navigate_guang",
                "shared": {
                    "total_rows": 22,
                    "current_exec_no": 5,
                    "current_row_no": 6,
                    "results": [
                        {"ID": "100000001", "上传情况": "光合：成功"},
                        {"ID": "100000002", "上传情况": "光合：失败"},
                    ],
                },
            },
            run_control={},
        )

        self.assertEqual(progress["completed"], 0)
        self.assertEqual(progress["shared_results_count"], 2)

    async def test_short_video_cached_rows_adds_current_interrupted_job(self):
        rows = api_server._short_video_cached_rows_from_shared(
            {
                "invalid_rows": [{"ID": "bad-row", "上传情况": "发布失败"}],
                "results": [{"ID": "100000001", "款号": "style-1", "上传情况": "光合：成功"}],
                "jobs": [
                    {"item_id": "100000001", "style_code": "style-1"},
                    {
                        "item_id": "100000002",
                        "style_code": "style-2",
                        "guang_title": "逛逛标题",
                        "recommend_title": "搜推标题",
                        "description": "这是一段可发布的视频描述",
                        "publish_guang": True,
                        "publish_recommend": True,
                        "bind_product": True,
                    },
                ],
                "job_index": 1,
                "current_work": {
                    "guang_status": "成功",
                    "guang_content_id": "1234567890",
                    "notes": ["光合已发布"],
                },
            },
            "无法连接 Chrome CDP",
            "wait_product_readback",
        )

        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[-1]["ID"], "100000002")
        self.assertEqual(rows[-1]["上传情况"], "执行中断")
        self.assertEqual(rows[-1]["光合内容ID"], "1234567890")
        self.assertIn("无法连接 Chrome CDP", rows[-1]["备注"])
        self.assertIn("wait_product_readback", rows[-1]["备注"])

    async def test_backend_instance_lock_windows_locks_first_byte(self):
        positions = []

        class FakeMsvcrt:
            LK_NBLCK = 1
            LK_UNLCK = 2

            def locking(self, fileno, mode, size):
                handle = open_files[fileno]
                positions.append((mode, handle.tell(), size))

        open_files = {}
        original_open = Path.open

        def tracked_open(path, *args, **kwargs):
            handle = original_open(path, *args, **kwargs)
            open_files[handle.fileno()] = handle
            return handle

        with tempfile.TemporaryDirectory() as tmpdir:
            lock_path = Path(tmpdir) / "backend.lock"
            lock_path.write_text("12345", encoding="utf-8")

            with patch("core.api_server.os.name", "nt"):
                with patch.dict(sys.modules, {"msvcrt": FakeMsvcrt()}):
                    with patch.object(Path, "open", tracked_open):
                        lock = api_server.BackendInstanceLock(lock_path)
                        self.assertTrue(lock.acquire())
                        lock.close()

        self.assertEqual(positions[0], (FakeMsvcrt.LK_NBLCK, 0, 1))
        self.assertEqual(positions[-1], (FakeMsvcrt.LK_UNLCK, 0, 1))

    async def test_backend_instance_lock_windows_returns_false_when_lock_is_held(self):
        class FakeMsvcrt:
            LK_NBLCK = 1

            def locking(self, fileno, mode, size):
                raise OSError("locked")

        with tempfile.TemporaryDirectory() as tmpdir:
            lock_path = Path(tmpdir) / "backend.lock"

            with patch("core.api_server.os.name", "nt"):
                with patch.dict(sys.modules, {"msvcrt": FakeMsvcrt()}):
                    lock = api_server.BackendInstanceLock(lock_path)
                    self.assertFalse(lock.acquire())
                    self.assertIsNone(lock.handle)

    async def test_health_exposes_backend_runtime_identity(self):
        with patch("core.api_server.CDPBridge") as bridge_cls:
            bridge_cls.return_value.is_available.return_value = True
            with patch("core.api_server.adapter_loader.list_all", return_value=[{"id": "demo"}]):
                with patch("core.api_server.sched_module.list_jobs", return_value=[]):
                    with patch.dict("os.environ", {"CRAWSHRIMP_BACKEND_INSTANCE_ID": "desktop-launch-123"}, clear=False):
                        result = api_server.health()

        self.assertEqual(result["runtime"]["kind"], "source")
        self.assertEqual(result["runtime"]["backend_instance_id"], "desktop-launch-123")
        self.assertIn("backend_lock_pid", result["runtime"])
        self.assertTrue(result["runtime"]["data_dir"])
        self.assertTrue(result["runtime"]["scripts_dir"])

    async def test_runtime_task_params_include_current_api_base_url(self):
        run_params = {}

        with patch.dict("os.environ", {"CRAWSHRIMP_PORT": "18768"}, clear=False):
            api_server._inject_runtime_task_params(run_params)

        self.assertEqual(run_params["__crawshrimp_api_base_url"], "http://127.0.0.1:18768")

    async def test_one_xm_payload_preserves_ratio_value(self):
        payload = api_server._prepare_one_xm_payload({
            "最终提示词": "prompt",
            "尺寸": "960x1280",
            "比例": "3:4",
            "格式": "jpeg",
            "质量": "auto",
            "生成数量": 3,
            "__1xm_payload": {"size": "960x1280", "ratio": "3:4", "n": 3},
        })

        self.assertEqual(payload["size"], "960x1280")
        self.assertEqual(payload["ratio"], "3:4")
        self.assertEqual(payload["n"], 3)

    async def test_tmall_ai_chain_model_id_maps_to_execution_model_and_key_tier(self):
        self.assertEqual(
            api_server._tmall_ai_model_params({"model_id": "gpt-image-4k"}),
            ("gpt-image-4k", "gpt-image-2", "4k"),
        )
        self.assertEqual(
            api_server._tmall_ai_model_params({"model_id": "gpt-image-2k"}),
            ("gpt-image-2k", "gpt-image-2", "2k"),
        )
        self.assertEqual(
            api_server._tmall_ai_model_params({"model_id": "gemini-3-pro-image-preview"}),
            ("gemini-3-pro-image-preview", "gemini-3-pro-image-preview", "auto"),
        )
        self.assertEqual(
            api_server._tmall_ai_model_params({"model": "gpt-image-2", "one_xm_key_tier": "4k"}),
            ("gpt-image-4k", "gpt-image-2", "4k"),
        )

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

    async def test_build_live_progress_exposes_doudian_mixed_fund_stage_fields(self):
        progress = api_server._build_live_progress(
            {
                "phase": "collect_order_detail_batch",
                "records": 0,
                "shared": {
                    "doudian_stage": "order_details",
                    "doudian_signup_total": 4,
                    "doudian_signup_completed": 4,
                    "doudian_order_window_total": 2,
                    "doudian_order_window_completed": 2,
                    "doudian_mixed_rows": 42,
                    "list_total_rows": 3600,
                    "list_completed_rows": 3600,
                    "detail_total_targets": 208,
                    "detail_completed_targets": 100,
                    "detail_current_target": "SO-DETAIL-100",
                },
            },
            run_control=None,
        )

        self.assertEqual(progress["doudian_stage"], "order_details")
        self.assertEqual(progress["doudian_signup_total"], 4)
        self.assertEqual(progress["doudian_signup_completed"], 4)
        self.assertEqual(progress["doudian_order_window_total"], 2)
        self.assertEqual(progress["doudian_order_window_completed"], 2)
        self.assertEqual(progress["doudian_mixed_rows"], 42)
        self.assertEqual(progress["list_total_rows"], 3600)
        self.assertEqual(progress["detail_total_targets"], 208)
        self.assertEqual(progress["detail_completed_targets"], 100)
        self.assertEqual(progress["detail_current_target"], "SO-DETAIL-100")

    async def test_done_live_status_preserves_last_runtime_shared_progress(self):
        class FakeBridge:
            def get_tabs(self):
                return []

            def new_tab(self, url):
                return {
                    "id": "tab-1",
                    "type": "page",
                    "url": url,
                    "webSocketDebuggerUrl": "ws://example.invalid",
                }

            def find_tab(self, url):
                return {
                    "id": "tab-1",
                    "type": "page",
                    "url": url,
                    "webSocketDebuggerUrl": "ws://example.invalid",
                }

            def get_tab_ws_url(self, tab):
                return tab["webSocketDebuggerUrl"]

        class FakeRunner:
            def __init__(self, *args, **kwargs):
                self.runtime_output_files = []
                self.tab_id = "tab-1"
                self.tab_url = "https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise"
                self.last_runtime_shared = {}
                self.last_runtime_phase = ""

            async def run_script_file(self, script_path, params=None, control_hook=None):
                self.last_runtime_phase = "done"
                self.last_runtime_shared = {
                    "total_rows": 21,
                    "current_exec_no": 21,
                    "search_total_codes": 31,
                    "search_completed_codes": 31,
                    "download_total": 15,
                    "download_completed": 15,
                    "download_success": 15,
                    "detail_total_targets": 21,
                    "detail_completed_targets": 21,
                    "detail_current_target_index": 21,
                    "detail_current_target": "",
                    "current_store": "全部线上替换任务完成",
                }
                return [{"货号": "20842610320200422", "执行结果": "保存并提交审核成功"}]

        class FakeTask:
            id = "package_main_image_replace"
            name = "唯品包装主图替换"
            description = ""
            entry_url = "https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise"
            tab_match_prefixes = []
            output = []
            script = "vipshop-package-main-image-replace.js"
            skip_auth = True
            params = []

        class FakeAdapter:
            id = "vipshop-ops-assistant"
            name = "唯品会运营助手"
            entry_url = "https://nov-admin.vip.com/admin/index.html#/normal/normalMerchandise"
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = None

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "vipshop-package-main-image-replace.js"
            script_path.write_text("", encoding="utf-8")

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                        with patch("core.js_runner.JSRunner", FakeRunner):
                            with patch("core.api_server.data_sink.begin_run", return_value=2301):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.adapter_loader.resolve_adapter_file", return_value=script_path):
                                        with patch("core.api_server.data_sink.finish_run"):
                                            await api_server._execute_task(
                                                "vipshop-ops-assistant",
                                                "package_main_image_replace",
                                                {},
                                                {},
                                            )

        live = api_server._run_status[api_server._run_jid("vipshop-ops-assistant", "package_main_image_replace")]
        self.assertEqual(live["status"], "done")
        self.assertEqual(live["search_total_codes"], 31)
        self.assertEqual(live["search_completed_codes"], 31)
        self.assertEqual(live["detail_total_targets"], 21)
        self.assertEqual(live["detail_completed_targets"], 21)
        self.assertEqual(live["detail_current_target_index"], 21)
        self.assertEqual(live["detail_current_target"], "")

    async def test_ai_wash_label_create_exports_result_excel_on_completion(self):
        class FakeBridge:
            def get_tabs(self):
                return [{
                    "id": "tab-1",
                    "type": "page",
                    "url": "https://agentseller.temu.com/goods/label",
                    "webSocketDebuggerUrl": "ws://example.invalid",
                }]

            def get_tab_ws_url(self, tab):
                return tab["webSocketDebuggerUrl"]

        class FakeRunner:
            def __init__(self, *args, **kwargs):
                self.runtime_output_files = []
                self.tab_id = "tab-1"
                self.tab_url = "https://agentseller.temu.com/goods/label"
                self.last_runtime_shared = {}
                self.last_runtime_phase = ""

            async def evaluate(self, expression):
                return type(
                    "Result",
                    (),
                    {
                        "success": True,
                        "data": [{"shared_shop_name": "balabala Official Shop"}],
                        "meta": {"has_more": False},
                        "error": None,
                    },
                )()

            async def run_script_file(self, script_path, params=None, control_hook=None):
                self.last_runtime_phase = "done"
                self.last_runtime_shared = {
                    "progress_kind": "temu_ai_wash_label",
                    "wash_label_stage": "finalize",
                    "total_rows": 1,
                    "current_exec_no": 1,
                    "current_store": "洗唛任务完成",
                }
                return [{
                    "店铺": "balabala Official Shop",
                    "款号": "208326105215",
                    "SKU货号": "6914678311020",
                    "结果": "official_download_received",
                    "文件名": "59999054922-6914678311020.pdf",
                    "文件路径": "/Users/xingyicheng/Downloads/59999054922-6914678311020.pdf",
                }]

        class FakeParam:
            def __init__(self, id, default=None):
                self.id = id
                self.default = default

        result_columns = ["店铺", "款号", "SKU货号", "结果", "文件名", "文件路径"]

        class FakeTask:
            id = "ai_wash_label_create"
            name = "AI洗唛制作"
            description = ""
            entry_url = "https://agentseller.temu.com/goods/label"
            tab_match_prefixes = ["https://agentseller.temu.com/goods/label"]
            output = [
                type(
                    "Output",
                    (),
                    {
                        "type": OutputType.excel,
                        "filename": "ai-wash-label-create-result_{timestamp}.xlsx",
                        "columns": result_columns,
                        "column_groups": None,
                        "sheet_key": None,
                        "sheets": None,
                    },
                )(),
                type(
                    "Output",
                    (),
                    {
                        "type": OutputType.json,
                        "filename": "ai-wash-label-create-diagnostic_{timestamp}.json",
                        "columns": None,
                        "column_groups": None,
                        "sheet_key": None,
                        "sheets": None,
                    },
                )(),
            ]
            script = "wash-label-create-and-download.js"
            skip_auth = True
            params = [FakeParam("mode", "current")]

        class FakeAdapter:
            id = "temu"
            name = "Temu 运营助手"
            entry_url = "https://agentseller.temu.com"
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = None

        exported_rows = []
        exported_column_order = []

        def fake_export_excel(data_rows, *args, **kwargs):
            exported_rows.extend([dict(row) for row in data_rows])
            exported_column_order.extend(kwargs.get("column_order") or [])
            return "/tmp/ai-wash-label-create-result.xlsx"

        def fake_export_json(data_rows, *args, **kwargs):
            return "/tmp/ai-wash-label-create-diagnostic.json"

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "wash-label-create-and-download.js"
            script_path.write_text("", encoding="utf-8")

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                        with patch("core.js_runner.JSRunner", FakeRunner):
                            with patch("core.api_server.data_sink.begin_run", return_value=2401):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.adapter_loader.resolve_adapter_file", return_value=script_path):
                                        with patch("core.api_server.data_sink.export_excel", side_effect=fake_export_excel):
                                            with patch("core.api_server.data_sink.export_json", side_effect=fake_export_json):
                                                with patch("core.api_server.data_sink.finish_run") as finish_run:
                                                    await api_server._execute_task(
                                                        "temu",
                                                        "ai_wash_label_create",
                                                        {"mode": "current"},
                                                        {},
                                                    )

        self.assertEqual(len(exported_rows), 1)
        self.assertEqual(exported_rows[0]["结果"], "official_download_received")
        self.assertEqual(exported_column_order, result_columns)
        finish_run.assert_called_once_with(
            2401,
            1,
            ["/tmp/ai-wash-label-create-result.xlsx", "/tmp/ai-wash-label-create-diagnostic.json"],
        )

    def test_ai_wash_label_finalize_copies_result_tables_to_selected_output_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            export_dir = base / "Downloads"
            runtime_dir.mkdir()
            exported_excel = runtime_dir / "ai-wash-label-create-result_20260811-164733.xlsx"
            exported_json = runtime_dir / "ai-wash-label-create-diagnostic_20260811-164733.json"
            exported_excel.write_bytes(b"excel")
            exported_json.write_text("[]", encoding="utf-8")
            official_pdf = export_dir / "69788693165-6942749195590.pdf"
            export_dir.mkdir()
            official_pdf.write_bytes(b"%PDF-1.7\n")

            result = api_server._finalize_temu_ai_wash_label_outputs(
                runtime_files=[str(official_pdf)],
                exported_files=[str(exported_excel), str(exported_json)],
                run_params={"output_dir": str(export_dir)},
                log=lambda _: None,
            )

            copied_excel = export_dir / exported_excel.name
            copied_json = export_dir / exported_json.name
            self.assertEqual(result, [str(official_pdf), str(copied_excel), str(copied_json)])
            self.assertTrue(copied_excel.is_file())
            self.assertTrue(copied_json.is_file())
            self.assertTrue(exported_excel.is_file())

    async def test_bridge_call_async_times_out_external_dependency(self):
        class SlowBridge:
            async def get_tabs_async(self):
                await asyncio.sleep(0.05)
                return []

        with patch("core.api_server.get_bridge", return_value=SlowBridge()):
            with patch.dict("os.environ", {"CRAWSHRIMP_EXTERNAL_CALL_TIMEOUT_SECONDS": "0.001"}, clear=False):
                with self.assertRaisesRegex(TimeoutError, "External dependency timed out"):
                    await api_server._bridge_call_async("get_tabs_async", "get_tabs")

    async def test_tmall_ai_chain_approval_board_url_is_extracted_for_output_refs(self):
        rows = [
            {"阶段": "图片审批", "审批看板": "http://127.0.0.1:18765/tmall-ai-image-approval/batch-1?token=unit"},
            {"阶段": "生图", "审批看板": ""},
        ]

        self.assertEqual(
            api_server._extract_first_approval_board_url(rows),
            "http://127.0.0.1:18765/tmall-ai-image-approval/batch-1?token=unit",
        )

    async def test_tmall_ai_chain_approval_board_urls_prefer_cloud_and_keep_local(self):
        rows = [
            {
                "阶段": "图片审批",
                "审批看板": "https://approval.crawshrimp.com/?batch_uid=batch-1",
                "云端审批看板": "https://approval.crawshrimp.com/?batch_uid=batch-1",
                "本地审批看板": "http://127.0.0.1:18765/tmall-ai-image-approval/batch-1?token=unit",
            }
        ]

        urls = api_server._extract_tmall_approval_board_urls(rows)

        self.assertEqual(urls["approval_board_url"], "https://approval.crawshrimp.com/?batch_uid=batch-1")
        self.assertEqual(urls["cloud_board_url"], "https://approval.crawshrimp.com/?batch_uid=batch-1")
        self.assertEqual(urls["local_board_url"], "http://127.0.0.1:18765/tmall-ai-image-approval/batch-1?token=unit")

    async def test_tmall_ai_chain_generation_confirmation_skips_excel_export(self):
        rows = [
            {
                "阶段": "确认提交生图",
                "审批状态": "pending_generation_confirmation",
                "审批看板": "http://127.0.0.1:18765/tmall-ai-image-approval/batch-1?token=unit",
                "执行结果": "等待确认提交生图任务",
            }
        ]

        self.assertTrue(api_server._is_tmall_ai_generation_confirmation_result(
            "tmall-ops-assistant",
            "tmall_ai_image_test_chain",
            rows,
        ))
        self.assertFalse(api_server._is_tmall_ai_generation_confirmation_result(
            "tmall-ops-assistant",
            "tmall_ai_image_test_chain",
            [{**rows[0], "阶段": "创建结果", "审批状态": "created"}],
        ))

    async def test_execute_tmall_ai_chain_generation_confirmation_outputs_only_board_url(self):
        board_url = "http://127.0.0.1:18765/tmall-ai-image-approval/batch-1?token=unit"

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
                self.runtime_output_files = ["/tmp/intermediate.xlsx"]
                self.tab_id = "tab-1"
                self.tab_url = "https://fmp.semirapp.com/web/index#/home/file"

            async def run_script_file(self, script_path, params=None, control_hook=None):
                return []

        class FakeTask:
            id = "tmall_ai_image_test_chain"
            name = "巴拉-AI测图全链路"
            description = ""
            entry_url = "https://fmp.semirapp.com/web/index#/home/file"
            tab_match_prefixes = []
            output = [
                type(
                    "Output",
                    (),
                    {
                        "type": OutputType.excel,
                        "filename": "summary.xlsx",
                        "columns": None,
                        "column_groups": None,
                        "sheet_key": None,
                        "sheets": None,
                    },
                )()
            ]
            script = "tmall-ai-image-test-chain.js"
            skip_auth = True
            params = []

        class FakeAdapter:
            id = "tmall-ops-assistant"
            name = "天猫运营助手"
            entry_url = "https://fmp.semirapp.com/web/index#/home/file"
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = None

        async def fake_apply(*args, **kwargs):
            return [{
                "阶段": "确认提交生图",
                "审批状态": "pending_generation_confirmation",
                "审批看板": board_url,
                "执行结果": "等待确认提交生图任务",
            }]

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "tmall-ai-image-test-chain.js"
            script_path.write_text("", encoding="utf-8")

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                        with patch("core.js_runner.JSRunner", FakeRunner):
                            with patch("core.api_server.data_sink.begin_run", return_value=2101):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.adapter_loader.resolve_adapter_file", return_value=script_path):
                                        with patch("core.api_server._apply_tmall_ai_image_test_chain", side_effect=fake_apply):
                                            with patch("core.api_server.data_sink.export_excel") as export_excel:
                                                with patch("core.api_server.data_sink.finish_run") as finish_run:
                                                    await api_server._execute_task(
                                                        "tmall-ops-assistant",
                                                        "tmall_ai_image_test_chain",
                                                        {},
                                                        {},
                                                    )

        export_excel.assert_not_called()
        finish_run.assert_called_once_with(2101, 1, [board_url])

    async def test_execute_short_video_batch_upload_exports_cached_rows_on_error(self):
        class FakeBridge:
            def __init__(self):
                self.tab = {
                    "id": "tab-1",
                    "type": "page",
                    "url": "https://huodong.taobao.com/wow/z/guang/gg_publish/gg-video",
                    "webSocketDebuggerUrl": "ws://example.invalid",
                }

            def get_tabs(self):
                return []

            def new_tab(self, url):
                self.tab["url"] = str(url)
                return dict(self.tab)

            def get_tab(self, tab_id):
                return dict(self.tab)

            def find_tab(self, url):
                return dict(self.tab)

            def get_tab_ws_url(self, tab):
                return tab["webSocketDebuggerUrl"]

        class FakeRunner:
            def __init__(self, *args, **kwargs):
                self.runtime_output_files = []
                self.tab_id = kwargs.get("tab_id", "tab-1")
                self.tab_url = kwargs.get("tab_url", "")
                self.last_runtime_shared = {}
                self.last_runtime_phase = ""

            async def evaluate(self, expression):
                return type(
                    "Result",
                    (),
                    {
                        "success": True,
                        "data": [{"href": self.tab_url}],
                        "meta": {"has_more": False},
                        "error": None,
                    },
                )()

            async def navigate(self, url, wait_seconds=0):
                self.tab_url = str(url)
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def run_script_file(self, script_path, params=None, control_hook=None):
                self.last_runtime_phase = "wait_product_readback"
                self.last_runtime_shared = {
                    "total_rows": 3,
                    "current_exec_no": 2,
                    "current_row_no": 3,
                    "current_buyer_id": "100000002",
                    "invalid_rows": [{"ID": "bad-row", "上传情况": "发布失败"}],
                    "results": [{"ID": "100000001", "款号": "style-1", "上传情况": "光合：成功"}],
                    "jobs": [
                        {"item_id": "100000001", "style_code": "style-1"},
                        {
                            "item_id": "100000002",
                            "style_code": "style-2",
                            "guang_title": "逛逛标题",
                            "recommend_title": "搜推标题",
                            "description": "这是一段可发布的视频描述",
                            "publish_guang": True,
                            "publish_recommend": True,
                            "bind_product": True,
                        },
                    ],
                    "job_index": 1,
                    "current_work": {
                        "guang_status": "成功",
                        "guang_content_id": "1234567890",
                        "notes": ["光合已发布"],
                    },
                }
                if control_hook:
                    await control_hook({
                        "kind": "before_phase",
                        "phase": self.last_runtime_phase,
                        "shared": self.last_runtime_shared,
                        "records": 0,
                    })
                raise RuntimeError("无法连接 Chrome CDP (http://127.0.0.1:9222)")

        class FakeTask:
            id = "short_video_batch_upload"
            name = "短视频批量上传"
            description = ""
            entry_url = "https://huodong.taobao.com/wow/z/guang/gg_publish/gg-video"
            tab_match_prefixes = ["https://huodong.taobao.com/wow/z/guang/gg_publish/gg-video"]
            output = [
                type(
                    "Output",
                    (),
                    {
                        "type": OutputType.excel,
                        "filename": "短视频批量上传结果_{timestamp}.xlsx",
                        "columns": None,
                        "column_groups": None,
                        "sheet_key": None,
                        "sheets": None,
                    },
                )()
            ]
            script = "short-video-batch-upload.js"
            skip_auth = True
            params = []

        class FakeAdapter:
            id = "bala-ai-video-assistant"
            name = "巴拉 AI 视频助手"
            entry_url = "https://huodong.taobao.com/wow/z/guang/gg_publish/gg-video"
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = None

        exported_rows = []
        exported_path = ""

        def fake_export_excel(data_rows, *args, **kwargs):
            nonlocal exported_path
            exported_rows.extend([dict(row) for row in data_rows])
            exported_path = str(Path(tmpdir) / "short-video-result.xlsx")
            return exported_path

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "short-video-batch-upload.js"
            script_path.write_text("", encoding="utf-8")
            run_control = api_server._build_run_control()
            run_control["task"] = asyncio.current_task()

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                        with patch("core.js_runner.JSRunner", FakeRunner):
                            with patch("core.api_server.data_sink.begin_run", return_value=2201):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.adapter_loader.resolve_adapter_file", return_value=script_path):
                                        with patch("core.api_server.data_sink.export_excel", side_effect=fake_export_excel):
                                            with patch("core.api_server.data_sink.fail_run") as fail_run:
                                                with self.assertRaisesRegex(RuntimeError, "无法连接 Chrome CDP"):
                                                    await api_server._execute_task(
                                                        "bala-ai-video-assistant",
                                                        "short_video_batch_upload",
                                                        {},
                                                        {},
                                                        run_control=run_control,
                                                    )

        self.assertEqual(len(exported_rows), 3)
        self.assertEqual(exported_rows[-1]["ID"], "100000002")
        self.assertEqual(exported_rows[-1]["上传情况"], "执行中断")
        self.assertIn("无法连接 Chrome CDP", exported_rows[-1]["备注"])
        fail_run.assert_called_once()
        _, fail_kwargs = fail_run.call_args
        self.assertEqual(fail_kwargs["records_count"], 3)
        self.assertEqual(fail_kwargs["output_files"], [exported_path])

    async def test_lifespan_uses_instance_lock_as_startup_owner(self):
        calls = []

        class FakeLock:
            acquired = True

            def close(self):
                calls.append("lock.close")

        with patch("core.api_server.data_sink.init_db", side_effect=lambda: calls.append("init_db")):
            with patch("core.api_server._acquire_backend_instance_lock", return_value=FakeLock(), create=True):
                with patch("core.api_server.data_sink.list_active_runs", return_value=[]) as list_active_runs:
                    with patch("core.api_server.data_sink.stop_orphaned_active_runs", return_value=0) as stop_orphaned:
                        with patch("core.api_server.adapter_loader.iter_manifest_dirs", return_value=[]) as iter_manifest_dirs:
                            with patch("core.api_server.adapter_loader.install_from_dir") as install_from_dir:
                                with patch("core.api_server.adapter_loader.scan_all") as scan_all:
                                    with patch("core.api_server.ensure_knowledge_index"):
                                        with patch("core.api_server.adapter_loader.list_all", return_value=[]):
                                            with patch("core.api_server.sched_module.start") as scheduler_start:
                                                with patch("core.api_server.sched_module.shutdown"):
                                                    async with api_server.lifespan(api_server.app):
                                                        calls.append("yielded")

        self.assertIn("init_db", calls)
        self.assertIn("yielded", calls)
        self.assertIn("lock.close", calls)
        list_active_runs.assert_called_once_with(api_server.ACTIVE_LIVE_STATUSES)
        stop_orphaned.assert_called_once()
        iter_manifest_dirs.assert_called_once()
        install_from_dir.assert_not_called()
        scan_all.assert_called_once()
        scheduler_start.assert_called_once()

    async def test_lifespan_skips_inaccessible_builtin_adapter_entry(self):
        calls = []

        class FakeLock:
            acquired = True

            def close(self):
                calls.append("lock.close")

        with tempfile.TemporaryDirectory() as tmpdir:
            project_root = Path(tmpdir)
            bundled_core = project_root / "core"
            bundled_core.mkdir(parents=True)
            bundled_file = bundled_core / "api_server.py"
            bundled_file.write_text("", encoding="utf-8")
            adapters_root = project_root / "adapters"
            good_adapter = adapters_root / "good-adapter"
            good_adapter.mkdir(parents=True)
            (good_adapter / "manifest.yaml").write_text("id: good-adapter\n", encoding="utf-8")
            blocked_adapter = adapters_root / "blocked-adapter"
            blocked_adapter.mkdir(parents=True)

            original_is_dir = Path.is_dir

            def guarded_is_dir(path):
                if path == blocked_adapter:
                    raise PermissionError("[WinError 5] Access is denied")
                return original_is_dir(path)

            with patch.object(api_server, "__file__", str(bundled_file)):
                with patch.object(Path, "is_dir", guarded_is_dir):
                    with patch("core.api_server.data_sink.init_db", side_effect=lambda: calls.append("init_db")):
                        with patch("core.api_server._acquire_backend_instance_lock", return_value=FakeLock(), create=True):
                            with patch("core.api_server.data_sink.list_active_runs", return_value=[]):
                                with patch("core.api_server.data_sink.stop_orphaned_active_runs", return_value=0):
                                    with patch("core.api_server.adapter_loader.install_from_dir") as install_from_dir:
                                        with patch("core.api_server.adapter_loader.scan_all"):
                                            with patch("core.api_server.ensure_knowledge_index"):
                                                with patch("core.api_server.adapter_loader.list_all", return_value=[]):
                                                    with patch("core.api_server.sched_module.start"):
                                                        with patch("core.api_server.sched_module.shutdown"):
                                                            async with api_server.lifespan(api_server.app):
                                                                calls.append("yielded")

            install_from_dir.assert_called_once_with(
                str(good_adapter),
                install_mode="copy",
                preserve_existing_link=True,
            )

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
                with patch("core.api_server.data_sink.list_active_runs", side_effect=AssertionError("should not list active runs")):
                    with patch("core.api_server.data_sink.stop_orphaned_active_runs", side_effect=AssertionError("should not stop runs")):
                        with patch("core.api_server.adapter_loader.scan_all", side_effect=AssertionError("should not scan adapters")):
                            with patch("core.api_server.sched_module.start", side_effect=AssertionError("should not start scheduler")):
                                async with api_server.lifespan(api_server.app):
                                    calls.append("yielded")

        self.assertIn("init_db", calls)
        self.assertIn("yielded", calls)
        self.assertIn("lock.close", calls)

    async def test_health_uses_short_chrome_probe_timeout(self):
        seen = {}

        class FakeBridge:
            def is_available(self, timeout=None):
                seen["timeout"] = timeout
                return False

        with patch("core.api_server.CDPBridge", return_value=FakeBridge()):
            with patch("core.api_server.adapter_loader.list_all", return_value=[]):
                with patch("core.api_server.sched_module.list_jobs", return_value=[]):
                    result = api_server.health()

        self.assertEqual(result["status"], "ok")
        self.assertFalse(result["chrome"])
        self.assertIsNotNone(seen.get("timeout"))
        self.assertLessEqual(seen["timeout"], 0.5)

    async def test_health_remains_ready_when_config_is_invalid(self):
        with patch("core.api_server.load_config", side_effect=ValueError("bad config")):
            with patch("core.api_server.CDPBridge", return_value=type("FakeBridge", (), {"is_available": lambda self, timeout=None: False})()):
                with patch("core.api_server.adapter_loader.list_all", return_value=[]):
                    with patch("core.api_server.sched_module.list_jobs", return_value=[]):
                        result = api_server.health()

        self.assertEqual(result["status"], "ok")
        self.assertFalse(result["chrome"])

    async def test_health_degrades_when_adapter_or_scheduler_status_fails(self):
        with patch("core.api_server.CDPBridge", return_value=type("FakeBridge", (), {"is_available": lambda self, timeout=None: False})()):
            with patch("core.api_server.adapter_loader.list_all", side_effect=RuntimeError("adapter metadata broken")):
                with patch("core.api_server.sched_module.list_jobs", side_effect=RuntimeError("scheduler unavailable")):
                    result = api_server.health()

        self.assertEqual(result["status"], "ok")
        self.assertEqual(result["adapters"], 0)
        self.assertEqual(result["scheduled_jobs"], 0)
        self.assertIn("adapter metadata broken", result["warnings"])
        self.assertIn("scheduler unavailable", result["warnings"])

    async def test_probe_health_skips_expensive_component_checks(self):
        with patch("core.api_server.CDPBridge") as bridge_cls:
            with patch("core.api_server.adapter_loader.list_all") as list_all:
                with patch("core.api_server.sched_module.list_jobs") as list_jobs:
                    result = api_server.health(probe=True)

        self.assertEqual(result["status"], "ok")
        self.assertIn("runtime", result)
        bridge_cls.assert_not_called()
        list_all.assert_not_called()
        list_jobs.assert_not_called()

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

    async def test_list_tasks_hides_hidden_manifest_tasks(self):
        class VisibleTask:
            id = "ai_wash_label_create"
            name = "AI洗唛制作"
            description = "desc"
            hidden = False
            param_probe_script = None
            execution_ui_mode = None
            validation_only_label = None
            auto_precheck_note = None
            params = []
            trigger = type("Trigger", (), {"model_dump": lambda self: {"type": "manual"}})()

        class HiddenTask:
            id = "wash_label_create_and_download"
            name = "后台-洗水唛制作并下载官方 PDF"
            description = "desc"
            hidden = True
            param_probe_script = None
            execution_ui_mode = None
            validation_only_label = None
            auto_precheck_note = None
            params = []
            trigger = type("Trigger", (), {"model_dump": lambda self: {"type": "manual"}})()

        class FakeAdapter:
            id = "temu"
            name = "Temu 运营助手"
            version = "1.5.12"
            tasks = [HiddenTask(), VisibleTask()]

        with patch("core.api_server.adapter_loader.scan_all"):
            with patch("core.api_server.adapter_loader.list_all", return_value=[{"id": "temu", "enabled": True}]):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.sched_module.list_jobs", return_value=[]):
                        with patch("core.api_server.data_sink.get_latest_run", return_value=None):
                            tasks = api_server.list_tasks()

        self.assertEqual([item["task_id"] for item in tasks], ["ai_wash_label_create"])

    async def test_run_task_background_marks_early_crash_as_error_and_clears_control(self):
        jid = "temu::tax_free_return_confirm"
        original_status = dict(api_server._run_status)
        original_logs = dict(api_server._run_logs)
        original_controls = dict(api_server._run_controls)
        original_guard = api_server.runtime_install_guard

        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()

        try:
            api_server.runtime_install_guard = api_server.RuntimeInstallGuard()
            runtime_token = api_server.runtime_install_guard.begin_operation("task", jid, jid)
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
                    runtime_token,
                )

            self.assertEqual(api_server._run_status[jid]["status"], "error")
            self.assertIsNone(api_server._run_status[jid]["run_id"])
            self.assertEqual(api_server._run_status[jid]["records"], 0)
            self.assertIn("boom before begin_run", api_server._run_status[jid]["error"])
            self.assertNotIn(jid, api_server._run_controls)
            self.assertTrue(any("FATAL" in line for line in api_server._run_logs[jid]))
            self.assertEqual(api_server.runtime_install_guard.readiness()["blockers"], [])
        finally:
            api_server.runtime_install_guard = original_guard
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_logs.clear()
            api_server._run_logs.update(original_logs)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)

    async def test_start_task_run_releases_runtime_token_when_create_task_fails(self):
        class FakeTask:
            id = "slow_export"

        class FakeAdapter:
            id = "demo"
            tasks = [FakeTask()]

        original_status = dict(api_server._run_status)
        original_controls = dict(api_server._run_controls)
        original_guard = api_server.runtime_install_guard

        try:
            api_server._run_status.clear()
            api_server._run_controls.clear()
            api_server.runtime_install_guard = api_server.RuntimeInstallGuard()

            with patch("core.api_server.adapter_loader.scan_all", return_value=None):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.asyncio.create_task", side_effect=RuntimeError("create task failed")):
                        with self.assertRaisesRegex(RuntimeError, "create task failed"):
                            await api_server._start_task_run("demo", "slow_export", {}, {})

            self.assertEqual(api_server.runtime_install_guard.readiness()["blockers"], [])
            self.assertEqual(api_server._run_controls, {})
        finally:
            api_server.runtime_install_guard = original_guard
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)

    async def test_runtime_update_drain_blocks_immediately_after_manual_run_starts(self):
        class FakeTask:
            id = "slow_export"

        class FakeAdapter:
            id = "demo"
            tasks = [FakeTask()]

        original_status = dict(api_server._run_status)
        original_controls = dict(api_server._run_controls)
        original_guard = api_server.runtime_install_guard
        entered = asyncio.Event()
        release = asyncio.Event()

        async def wait_until_released(*args, **kwargs):
            entered.set()
            await release.wait()

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                with patch("core.runtime_paths.data_root", return_value=Path(tmpdir)):
                    data_sink.init_db()
                    api_server._run_status.clear()
                    api_server._run_controls.clear()
                    api_server.runtime_install_guard = api_server.RuntimeInstallGuard()

                    with patch("core.api_server._execute_task", new=AsyncMock(side_effect=wait_until_released)):
                        with patch("core.api_server.adapter_loader.scan_all", return_value=None):
                            with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                                started = await api_server._start_task_run("demo", "slow_export", {}, {})
                        self.assertTrue(started["ok"])
                        self.assertEqual(api_server._run_status, {})

                        with patch.dict("os.environ", {"CRAWSHRIMP_API_TOKEN": "test-token"}, clear=False):
                            blocked = await self._api_request("POST", "/runtime/update-drain")

            self.assertEqual(blocked.status_code, 409)
            self.assertEqual(blocked.json()["detail"]["code"], "runtime_busy")
            self.assertIn(("task", "demo::slow_export"), {
                (item["kind"], item["id"]) for item in blocked.json()["detail"]["blockers"]
            })
        finally:
            release.set()
            for control in list(api_server._run_controls.values()):
                task = control.get("task") if isinstance(control, dict) else None
                if task and not task.done():
                    task.cancel()
                    with contextlib.suppress(asyncio.CancelledError):
                        await task
            api_server.runtime_install_guard = original_guard
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)

    async def test_active_tasks_reports_only_live_controls_or_locked_runs(self):
        original_status = dict(api_server._run_status)
        original_controls = dict(api_server._run_controls)
        active_task = asyncio.create_task(asyncio.sleep(60))
        finished_task = asyncio.create_task(asyncio.sleep(0))
        await finished_task
        scheduled_lock = api_server._task_lock("scheduled::locked_task")

        try:
            api_server._run_status.clear()
            api_server._run_controls.clear()
            await scheduled_lock.acquire()
            api_server._run_status["demo::live_task"] = {
                "status": "running",
                "run_id": 1001,
                "records": 3,
                "phase": "collect",
                "last_seen_at": "2026-07-02T11:23:45",
                "current_row": 12,
            }
            api_server._run_controls["demo::live_task"] = {"task": active_task}
            api_server._run_status["demo::finished_task"] = {
                "status": "running",
                "run_id": 1002,
                "records": 4,
            }
            api_server._run_controls["demo::finished_task"] = {"task": finished_task}
            api_server._run_status["demo::stale_task"] = {
                "status": "running",
                "run_id": 1003,
                "records": 5,
            }
            api_server._run_status["scheduled::locked_task"] = {
                "status": "running",
                "run_id": 1004,
                "records": 6,
            }

            result = api_server.active_tasks()

            self.assertTrue(result["active"])
            self.assertEqual(
                [item["jid"] for item in result["tasks"]],
                ["demo::live_task", "scheduled::locked_task"],
            )
            self.assertEqual(result["tasks"][0]["run_id"], 1001)
            self.assertEqual(result["tasks"][0]["records"], 3)
            self.assertEqual(result["tasks"][0]["phase"], "collect")
            self.assertEqual(result["tasks"][0]["last_seen_at"], "2026-07-02T11:23:45")
            self.assertEqual(result["tasks"][0]["current_row"], 12)
        finally:
            if scheduled_lock.locked():
                scheduled_lock.release()
            active_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await active_task
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)

    async def test_runtime_install_readiness_and_drain_gate_mutations(self):
        original_status = dict(api_server._run_status)
        original_controls = dict(api_server._run_controls)
        original_health = api_server.cloud_machine_controller.last_health
        active_task = asyncio.create_task(asyncio.sleep(60))

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                with patch("core.runtime_paths.data_root", return_value=Path(tmpdir)):
                    data_sink.init_db()
                    api_server._run_status.clear()
                    api_server._run_controls.clear()
                    api_server.cloud_machine_controller.last_health = "stopped"

                    with patch.dict("os.environ", {"CRAWSHRIMP_API_TOKEN": "test-token"}, clear=False):
                        response = await self._api_request("GET", "/runtime/install-readiness")
                        self.assertEqual(response.status_code, 200)
                        self.assertTrue(response.json()["ready"])

                        api_server._run_status["demo::regular"] = {
                            "status": "running",
                            "run_id": 1001,
                            "adapter_id": "demo",
                            "task_id": "regular",
                        }
                        api_server._run_controls["demo::regular"] = {"task": active_task}
                        instance = data_sink.create_task_instance(
                            "demo",
                            "task-center",
                            "Task Center Job",
                            params={},
                        )
                        data_sink.update_task_instance(instance["instance_uid"], status="running")
                        data_sink.create_ai_image_job({
                            "job_uid": "ai-job-queued",
                            "title": "AI Queued",
                            "status": "queued",
                        })
                        data_sink.create_ai_image_job({
                            "job_uid": "ai-job-summary-running",
                            "title": "AI Summary Running",
                            "status": "draft",
                            "summary": {"runs": [{"run_uid": "run-1", "status": "running"}]},
                        })
                        api_server.cloud_machine_controller.last_health = "online_busy"

                        readiness = (await self._api_request("GET", "/runtime/install-readiness")).json()
                        blockers = readiness["blockers"]
                        blocker_keys = {(item["kind"], item["id"]) for item in blockers}

                        self.assertFalse(readiness["ready"])
                        self.assertIn(("task", "demo::regular"), blocker_keys)
                        self.assertIn(("task", f"instance::{instance['instance_uid']}"), blocker_keys)
                        self.assertIn(("ai_image", "ai-job-queued"), blocker_keys)
                        self.assertIn(("ai_image", "ai-job-summary-running"), blocker_keys)
                        self.assertIn(("cloud_job", "cloud_machine"), blocker_keys)
                        task_center = next(item for item in blockers if item["id"] == f"instance::{instance['instance_uid']}")
                        self.assertEqual(task_center["instance_uid"], instance["instance_uid"])

                        busy = await self._api_request("POST", "/runtime/update-drain")
                        self.assertEqual(busy.status_code, 409)
                        self.assertEqual(busy.json()["detail"]["code"], "runtime_busy")

                        api_server._run_status.clear()
                        api_server._run_controls.clear()
                        data_sink.update_task_instance(instance["instance_uid"], status="draft")
                        data_sink.update_ai_image_job("ai-job-queued", {"status": "completed"})
                        data_sink.update_ai_image_job("ai-job-summary-running", {"summary": {"runs": [{"run_uid": "run-1", "status": "completed"}]}})
                        api_server.cloud_machine_controller.last_health = "online_idle"

                        response = await self._api_request("POST", "/runtime/update-drain")
                        self.assertEqual(response.status_code, 200)
                        drain_response = response.json()
                        drain_token = drain_response["drain_token"]
                        self.assertTrue(drain_response["readiness"]["install_ready"])
                        self.assertTrue(drain_response["readiness"]["draining"])
                        self.assertTrue(drain_response["readiness"]["ready"])
                        self.assertEqual(drain_response["readiness"]["blockers"], [])

                        blocked = await self._api_request("POST", "/tasks/example/task/run", {"params": {}})
                        self.assertEqual(blocked.status_code, 409)
                        self.assertEqual(blocked.json()["detail"]["code"], "update_pending")

                        wrong = await self._api_request(
                            "DELETE",
                            "/runtime/update-drain",
                            {"drain_token": "wrong-token"},
                        )
                        self.assertEqual(wrong.status_code, 409)
                        still_blocked = await self._api_request("POST", "/tasks/example/task/run", {"params": {}})
                        self.assertEqual(still_blocked.status_code, 409)
                        self.assertEqual(still_blocked.json()["detail"]["code"], "update_pending")

                        released = await self._api_request(
                            "DELETE",
                            "/runtime/update-drain",
                            {"drain_token": drain_token},
                        )
                        self.assertEqual(released.status_code, 200)

                        with patch.object(adapter_loader, "scan_all", return_value=None):
                            with patch.object(adapter_loader, "get_adapter", return_value=None):
                                unblocked = await self._api_request("POST", "/tasks/example/task/run", {"params": {}})
                        self.assertNotEqual(unblocked.status_code, 409)
        finally:
            active_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await active_task
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)
            api_server.cloud_machine_controller.last_health = original_health

    async def test_runtime_install_readiness_finds_active_ai_jobs_beyond_ui_limit(self):
        original_status = dict(api_server._run_status)
        original_controls = dict(api_server._run_controls)
        original_health = api_server.cloud_machine_controller.last_health
        original_guard = api_server.runtime_install_guard

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                with patch("core.runtime_paths.data_root", return_value=Path(tmpdir)):
                    data_sink.init_db()
                    api_server._run_status.clear()
                    api_server._run_controls.clear()
                    api_server.cloud_machine_controller.last_health = "stopped"
                    api_server.runtime_install_guard = api_server.RuntimeInstallGuard()

                    data_sink.create_ai_image_job({
                        "job_uid": "old-ai-queued",
                        "title": "Old Queued",
                        "status": "queued",
                    })
                    data_sink.create_ai_image_job({
                        "job_uid": "old-ai-summary-running",
                        "title": "Old Summary Running",
                        "status": "draft",
                        "summary": {"runs": [{"run_uid": "run-1", "status": "running"}]},
                    })
                    for index in range(501):
                        data_sink.create_ai_image_job({
                            "job_uid": f"new-completed-{index}",
                            "title": f"Completed {index}",
                            "status": "completed",
                        })

                    with patch.dict("os.environ", {"CRAWSHRIMP_API_TOKEN": "test-token"}, clear=False):
                        readiness = (await self._api_request("GET", "/runtime/install-readiness")).json()
                        drain = await self._api_request("POST", "/runtime/update-drain")

                    blocker_keys = {(item["kind"], item["id"]) for item in readiness["blockers"]}
                    self.assertFalse(readiness["ready"])
                    self.assertIn(("ai_image", "old-ai-queued"), blocker_keys)
                    self.assertIn(("ai_image", "old-ai-summary-running"), blocker_keys)
                    self.assertEqual(drain.status_code, 409)
                    self.assertEqual(drain.json()["detail"]["code"], "runtime_busy")
        finally:
            api_server.runtime_install_guard = original_guard
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)
            api_server.cloud_machine_controller.last_health = original_health

    async def test_runtime_install_readiness_fails_closed_when_task_instance_collection_fails(self):
        with patch.dict("os.environ", {"CRAWSHRIMP_API_TOKEN": "test-token"}, clear=False):
            with patch.object(data_sink, "list_task_instances", side_effect=RuntimeError("task db unavailable")):
                readiness = await self._api_request("GET", "/runtime/install-readiness")
                self.assertEqual(readiness.status_code, 200)
                body = readiness.json()
                self.assertFalse(body["ready"])
                self.assertEqual(body["error"], "install_readiness_unavailable")
                self.assertIn("task_instances", body["failed_sources"])

                drain = await self._api_request("POST", "/runtime/update-drain")
                self.assertEqual(drain.status_code, 409)
                detail = drain.json()["detail"]
                self.assertEqual(detail["code"], "install_readiness_unavailable")
                self.assertIn("task_instances", detail["failed_sources"])
                self.assertNotIn("drain_token", detail)

    async def test_runtime_update_drain_fails_closed_when_ai_image_job_collection_fails(self):
        with patch.dict("os.environ", {"CRAWSHRIMP_API_TOKEN": "test-token"}, clear=False):
            with patch.object(data_sink, "list_active_ai_image_jobs", side_effect=RuntimeError("ai db unavailable")):
                drain = await self._api_request("POST", "/runtime/update-drain")
                self.assertEqual(drain.status_code, 409)
                detail = drain.json()["detail"]
                self.assertEqual(detail["code"], "install_readiness_unavailable")
                self.assertIn("ai_image_jobs", detail["failed_sources"])
                self.assertNotIn("drain_token", detail)

    async def test_execute_task_reraises_cancelled_error_after_partial_export(self):
        class FakeBridge:
            def get_tabs(self):
                return [{
                    "id": "tab-1",
                    "type": "page",
                    "url": "https://example.test/app",
                    "webSocketDebuggerUrl": "ws://example.invalid",
                }]

            def get_tab_ws_url(self, tab):
                return tab["webSocketDebuggerUrl"]

            def find_tab(self, url):
                return self.get_tabs()[0]

        class FakeRunner:
            def __init__(self, *args, **kwargs):
                self.runtime_output_files = []

            async def run_script_file(self, script_path, params=None, control_hook=None):
                raise asyncio.CancelledError()

        class FakeTask:
            id = "cancel_task"
            name = "Cancel Task"
            description = ""
            entry_url = "https://example.test/app"
            tab_match_prefixes = []
            output = []
            script = "cancel.js"
            skip_auth = True
            params = []

        class FakeAdapter:
            id = "demo"
            name = "Demo"
            entry_url = "https://example.test/app"
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = None

        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "cancel.js"
            script_path.write_text("", encoding="utf-8")

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                        with patch("core.js_runner.JSRunner", FakeRunner):
                            with patch("core.api_server.data_sink.begin_run", return_value=2001):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.adapter_loader.resolve_adapter_file", return_value=script_path):
                                        with patch("core.api_server.data_sink.stop_run") as stop_run:
                                            with self.assertRaises(asyncio.CancelledError):
                                                await api_server._execute_task(
                                                    "demo",
                                                    "cancel_task",
                                                    {},
                                                    {},
                                                    run_control=run_control,
                                                )

        stop_run.assert_called_once()

    async def test_execute_task_waits_for_cancelled_partial_finalize_before_reraising(self):
        class FakeBridge:
            def get_tabs(self):
                return [{
                    "id": "tab-1",
                    "type": "page",
                    "url": "https://example.test/app",
                    "webSocketDebuggerUrl": "ws://example.invalid",
                }]

            def get_tab_ws_url(self, tab):
                return tab["webSocketDebuggerUrl"]

            def find_tab(self, url):
                return self.get_tabs()[0]

        class FakeRunner:
            def __init__(self, *args, **kwargs):
                self.runtime_output_files = []

            async def run_script_file(self, script_path, params=None, control_hook=None):
                raise asyncio.CancelledError()

        class FakeTask:
            id = "prepare_upload_package"
            name = "Prepare Upload Package"
            description = ""
            entry_url = "https://example.test/app"
            tab_match_prefixes = []
            output = []
            script = "cancel.js"
            skip_auth = True
            params = []

        class FakeAdapter:
            id = "shenhui-new-arrival"
            name = "Shenhui"
            entry_url = "https://example.test/app"
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = None

        loop = asyncio.get_running_loop()
        finalize_started = threading.Event()
        finalize_can_finish = threading.Event()
        finalize_finished = threading.Event()
        task_ref = {}

        def fake_finalize_outputs(*args, **kwargs):
            finalize_started.set()
            loop.call_soon_threadsafe(task_ref["task"].cancel)
            self.assertTrue(finalize_can_finish.wait(timeout=2))
            finalize_finished.set()
            return ["/tmp/finalized.xlsx"]

        run_control = api_server._build_run_control()

        with tempfile.TemporaryDirectory() as tmpdir:
            script_path = Path(tmpdir) / "cancel.js"
            script_path.write_text("", encoding="utf-8")

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                        with patch("core.js_runner.JSRunner", FakeRunner):
                            with patch("core.api_server.data_sink.begin_run", return_value=2002):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.adapter_loader.resolve_adapter_file", return_value=script_path):
                                        with patch("core.api_server._finalize_shenhui_new_arrival_outputs", side_effect=fake_finalize_outputs):
                                            with patch("core.api_server.data_sink.stop_run") as stop_run:
                                                task = asyncio.create_task(
                                                    api_server._execute_task(
                                                        "shenhui-new-arrival",
                                                        "prepare_upload_package",
                                                        {},
                                                        {},
                                                        run_control=run_control,
                                                    )
                                                )
                                                task_ref["task"] = task
                                                run_control["task"] = task

                                                self.assertTrue(await asyncio.to_thread(finalize_started.wait, 2))
                                                finalize_can_finish.set()
                                                with self.assertRaises(asyncio.CancelledError):
                                                    await task

        self.assertTrue(finalize_finished.is_set())
        stop_run.assert_called_once_with(2002, 0, ["/tmp/finalized.xlsx"], "任务已停止")

    async def test_run_task_scans_installed_adapters_before_initial_lookup(self):
        original_status = dict(api_server._run_status)
        original_logs = dict(api_server._run_logs)
        original_controls = dict(api_server._run_controls)

        async def fake_background_run(*args):
            if len(args) >= 6:
                api_server.runtime_install_guard.end_operation(args[5])

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
                    with patch("core.api_server._run_task_background", new=AsyncMock(side_effect=fake_background_run)) as background_run:
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

    async def test_new_mode_waits_for_target_tab_after_transition_page(self):
        class FakeBridge:
            def __init__(self):
                self.get_tabs_calls = 0

            async def get_tabs_async(self):
                self.get_tabs_calls += 1
                if self.get_tabs_calls == 1:
                    return []
                return [
                    {
                        "id": "transition-tab",
                        "type": "page",
                        "url": "https://g.alicdn.com/platform/xdomain-storage/0.2.4/frame.html#target",
                        "webSocketDebuggerUrl": "ws://transition.invalid",
                    },
                    {
                        "id": "target-tab",
                        "type": "page",
                        "url": "https://qn.taobao.com/home.htm/material-center/material-test/common_test?testStatus=1&testChannel=common_search",
                        "webSocketDebuggerUrl": "ws://target.invalid",
                    },
                ]

            async def new_tab_async(self, url):
                return {
                    "id": "transition-tab",
                    "type": "page",
                    "url": "https://g.alicdn.com/platform/xdomain-storage/0.2.4/frame.html#target",
                    "webSocketDebuggerUrl": "ws://transition.invalid",
                }

            def get_tab_ws_url(self, tab):
                return tab.get("webSocketDebuggerUrl", "")

        selected = {}

        class FakeRunner:
            def __init__(self, ws_url, *args, **kwargs):
                selected["ws_url"] = ws_url
                selected["tab_id"] = kwargs.get("tab_id")
                selected["tab_url"] = kwargs.get("tab_url")
                selected["navigations"] = []
                self.href = "about:blank"
                self.runtime_output_files = []

            async def evaluate(self, expression):
                return type(
                    "Result",
                    (),
                    {
                        "success": True,
                        "data": [{"href": self.href}],
                        "meta": {"has_more": False},
                        "error": None,
                    },
                )()

            async def navigate(self, url, wait_seconds=0):
                self.href = str(url)
                selected["navigations"].append(str(url))
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def run_script_file(self, script_path, params=None, control_hook=None):
                return [{"执行结果": "成功"}]

        class FakeParam:
            id = "mode"
            default = "new"

        class FakeTask:
            id = "tmall_material_test_data_export"
            name = "巴拉-AI测图数据抓取导出"
            description = ""
            entry_url = "https://qn.taobao.com/home.htm/material-center/material-test/common_test?testStatus=1&testChannel=common_search"
            tab_match_prefixes = ["https://qn.taobao.com/home.htm/material-center/material-test"]
            params = [FakeParam()]
            skip_auth = True
            output = []
            script = "tmall-material-test-data-export.js"

        class FakeAdapter:
            name = "天猫运营助手"
            entry_url = ""
            tab_match_prefixes = []
            auth = None
            tasks = [FakeTask()]

        original_status = dict(api_server._run_status)
        original_logs = dict(api_server._run_logs)
        original_controls = dict(api_server._run_controls)

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                script_path = Path(tmpdir) / "tmall-material-test-data-export.js"
                script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
                with patch("core.api_server.adapter_loader.scan_all"):
                    with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                        with patch("core.api_server.adapter_loader.resolve_adapter_file", return_value=script_path):
                            with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                                with patch("core.js_runner.JSRunner", FakeRunner):
                                    with patch("core.api_server.data_sink.begin_run", return_value=77):
                                        with patch("core.api_server.data_sink.heartbeat_run"):
                                            with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                                with patch("core.api_server.data_sink.finish_run"):
                                                    await api_server._execute_task(
                                                        "tmall-ops-assistant",
                                                        "tmall_material_test_data_export",
                                                        {"mode": "new"},
                                                        {},
                                                        run_control=api_server._build_run_control(),
                                                    )

            self.assertEqual(selected["tab_id"], "target-tab")
            self.assertEqual(selected["ws_url"], "ws://target.invalid")
            self.assertIn("qn.taobao.com/home.htm/material-center/material-test", selected["tab_url"])
            self.assertEqual(
                selected["navigations"],
                ["https://qn.taobao.com/home.htm/material-center/material-test/common_test?testStatus=1&testChannel=common_search"],
            )
        finally:
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_logs.clear()
            api_server._run_logs.update(original_logs)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)

    async def test_tmall_compete_paid_monitor_new_mode_recovers_about_blank_runner(self):
        target_url = "https://dmp.taobao.com/index_new.html?spm=x#!/compete/compete-situation"

        class FakeBridge:
            async def get_tabs_async(self):
                return [{
                    "id": "target-tab",
                    "type": "page",
                    "url": target_url,
                    "webSocketDebuggerUrl": "ws://target.invalid",
                }]

            async def new_tab_async(self, url):
                return {
                    "id": "target-tab",
                    "type": "page",
                    "url": url,
                    "webSocketDebuggerUrl": "ws://target.invalid",
                }

            def get_tab_ws_url(self, tab):
                return tab.get("webSocketDebuggerUrl", "")

        class FakeRunner:
            def __init__(self, *args, **kwargs):
                self.href = "about:blank"
                self.navigations = []
                self.runtime_output_files = []

            async def evaluate(self, expression):
                return type(
                    "Result",
                    (),
                    {
                        "success": True,
                        "data": [{"href": self.href}],
                        "meta": {"has_more": False},
                        "error": None,
                    },
                )()

            async def navigate(self, url, wait_seconds=0):
                self.href = str(url)
                self.navigations.append(str(url))
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def run_script_file(self, script_path, params=None, control_hook=None):
                return [{"执行结果": "成功"}]

        class FakeTask:
            id = "tmall_compete_paid_monitor"
            name = "天猫-竞品付费投放数据监控"
            description = ""
            entry_url = target_url
            tab_match_prefixes = ["https://dmp.taobao.com/index_new.html"]
            params = [type("Param", (), {"id": "mode", "default": "new"})()]
            skip_auth = True
            output = []
            script = "tmall-compete-paid-monitor.js"

        class FakeAdapter:
            name = "天猫运营助手"
            entry_url = ""
            tab_match_prefixes = []
            auth = None
            tasks = [FakeTask()]

        fake_runner = FakeRunner()
        original_status = dict(api_server._run_status)
        original_logs = dict(api_server._run_logs)
        original_controls = dict(api_server._run_controls)

        try:
            with tempfile.TemporaryDirectory() as tmpdir:
                script_path = Path(tmpdir) / "tmall-compete-paid-monitor.js"
                script_path.write_text("({ success: true, data: [], meta: { has_more: false } })", encoding="utf-8")
                with patch("core.api_server.adapter_loader.scan_all"):
                    with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                        with patch("core.api_server.adapter_loader.resolve_adapter_file", return_value=script_path):
                            with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                                with patch("core.js_runner.JSRunner", return_value=fake_runner):
                                    with patch("core.api_server.data_sink.begin_run", return_value=78):
                                        with patch("core.api_server.data_sink.heartbeat_run"):
                                            with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                                with patch("core.api_server.data_sink.finish_run"):
                                                    await api_server._execute_task(
                                                        "tmall-ops-assistant",
                                                        "tmall_compete_paid_monitor",
                                                        {"mode": "new"},
                                                        {},
                                                        run_control=api_server._build_run_control(),
                                                    )

            self.assertEqual(fake_runner.navigations, [target_url])
        finally:
            api_server._run_status.clear()
            api_server._run_status.update(original_status)
            api_server._run_logs.clear()
            api_server._run_logs.update(original_logs)
            api_server._run_controls.clear()
            api_server._run_controls.update(original_controls)

    async def test_execute_task_runs_export_and_packaging_off_event_loop_thread(self):
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
                self.runtime_output_files = []

            async def run_script_file(self, script_path, params=None, control_hook=None):
                return [{"输入款号": "208226103201", "下载结果": "已跳过"}]

        class FakeTask:
            id = "prepare_upload_package"
            name = "整理深绘上新图包"
            description = ""
            entry_url = "https://fmp.semirapp.com/web/index#/home/file"
            tab_match_prefixes = []
            output = [
                type(
                    "Output",
                    (),
                    {
                        "type": OutputType.excel,
                        "filename": "summary.xlsx",
                        "columns": None,
                        "column_groups": None,
                        "sheet_key": None,
                        "sheets": None,
                    },
                )()
            ]
            script = "prepare-upload-package.js"
            skip_auth = True
            params = []

        class FakeAdapter:
            id = "shenhui-new-arrival"
            name = "深绘上新助手"
            entry_url = "https://fmp.semirapp.com/web/index#/home/file"
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = None

        main_thread_id = threading.get_ident()
        observed_threads = []
        finalize_statuses = []

        def fake_export_excel(*args, **kwargs):
            observed_threads.append(("export", threading.get_ident()))
            return "/tmp/summary.xlsx"

        def fake_finalize_outputs(*args, **kwargs):
            observed_threads.append(("finalize", threading.get_ident()))
            return ["/tmp/summary.xlsx"]

        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()
        jid = "shenhui-new-arrival::prepare_upload_package"

        with tempfile.TemporaryDirectory() as tmpdir:
            adapter_dir = Path(tmpdir)
            script_path = adapter_dir / "prepare-upload-package.js"
            script_path.write_text(
                "({ success: true, data: [], meta: { has_more: false } })",
                encoding="utf-8",
            )

            async def fake_run_script_file(script_path, params=None, control_hook=None):
                shared = {
                    "current_exec_no": 3,
                    "total_rows": 3,
                    "search_total_codes": 3,
                    "search_completed_codes": 3,
                    "current_buyer_id": "208226105201",
                }
                await control_hook({
                    "kind": "before_download_urls",
                    "phase": "collect_code",
                    "shared": shared,
                    "records": 0,
                    "download_item_total": 274,
                    "download_completed": 273,
                    "download_success": 273,
                    "download_failed": 0,
                })
                await control_hook({
                    "kind": "before_phase",
                    "phase": "finalize_all",
                    "shared": shared,
                    "records": 380,
                })
                finalize_statuses.append(dict(api_server._run_status.get(jid) or {}))
                return [{"输入款号": "208226103201", "下载结果": "已跳过"}]

            fake_runner = FakeRunner()
            fake_runner.run_script_file = fake_run_script_file

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=FakeBridge()):
                        with patch("core.js_runner.JSRunner", return_value=fake_runner):
                            with patch("core.api_server.data_sink.begin_run", return_value=1001):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.data_sink.finish_run"):
                                        with patch("core.api_server.adapter_loader.resolve_adapter_file", return_value=script_path):
                                            with patch("core.api_server.data_sink.export_excel", side_effect=fake_export_excel):
                                                with patch("core.api_server._finalize_shenhui_new_arrival_outputs", side_effect=fake_finalize_outputs):
                                                    await api_server._execute_task(
                                                        "shenhui-new-arrival",
                                                        "prepare_upload_package",
                                                        {},
                                                        {},
                                                        run_control=run_control,
                                                    )

        self.assertEqual([label for label, _ in observed_threads], ["export", "finalize"])
        self.assertTrue(all(thread_id != main_thread_id for _, thread_id in observed_threads))
        self.assertEqual(finalize_statuses[0]["phase"], "finalize_all")
        self.assertEqual(finalize_statuses[0]["download_completed"], 274)
        self.assertFalse(finalize_statuses[0]["download_active"])

    async def test_current_mode_returns_to_entry_after_auth_redirects_to_login_domain(self):
        target_url = "https://fmp.semirapp.com/web/index#/home/file"
        login_redirect_url = "https://iam.semirapp.com/selfcare/login"

        class FakeBridge:
            def __init__(self):
                self.current_url = target_url

            def get_tabs(self):
                return [{
                    "id": "tab-1",
                    "type": "page",
                    "url": self.current_url,
                    "webSocketDebuggerUrl": "ws://example.invalid",
                }]

            def new_tab(self, url):
                return {"id": "tab-2", "url": url, "webSocketDebuggerUrl": "ws://example.invalid"}

            def find_tab(self, url):
                return None

            def get_tab(self, tab_id):
                return {
                    "id": "tab-1",
                    "type": "page",
                    "url": self.current_url,
                    "webSocketDebuggerUrl": "ws://example.invalid",
                }

            def get_tab_ws_url(self, tab):
                return "ws://example.invalid"

        class FakeRunner:
            def __init__(self, *args, **kwargs):
                self.runtime_output_files = []
                self.navigations = []
                self.tab_url = kwargs.get("tab_url", "")
                self.tab_id = kwargs.get("tab_id", "")

            async def evaluate(self, expression):
                if "logged_in" in expression:
                    fake_bridge.current_url = login_redirect_url
                    return type("Result", (), {"success": True, "data": [], "meta": {"logged_in": True}, "error": None})()
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def navigate(self, url, wait_seconds=0):
                self.navigations.append(str(url))
                fake_bridge.current_url = str(url)
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def run_script_file(self, script_path, params=None, control_hook=None):
                return [{"执行结果": "成功"}]

        class FakeTask:
            id = "tmall_material_new_624"
            name = "森马-天猫AI生图参考素材准备"
            description = ""
            entry_url = target_url
            tab_match_prefixes = []
            output = []
            script = "tmall-material-match-buy.js"
            skip_auth = False
            params = [type("Param", (), {"id": "mode", "default": "current"})()]

        class FakeAdapter:
            id = "semir-cloud-drive"
            name = "森马云盘图片工具"
            entry_url = target_url
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = type("Auth", (), {"check_script": "auth_check.js", "login_url": target_url})()

        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()
        fake_bridge = FakeBridge()
        fake_runner = FakeRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            adapter_dir = Path(tmpdir)
            auth_path = adapter_dir / "auth_check.js"
            auth_path.write_text(
                "({ success: true, data: [], meta: { logged_in: true, has_more: false } })",
                encoding="utf-8",
            )
            script_path = adapter_dir / "tmall-material-match-buy.js"
            script_path.write_text(
                "({ success: true, data: [], meta: { has_more: false } })",
                encoding="utf-8",
            )

            def resolve_file(adapter_id, filename):
                return auth_path if filename == "auth_check.js" else script_path

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=fake_bridge):
                        with patch("core.js_runner.JSRunner", return_value=fake_runner):
                            with patch("core.api_server.data_sink.begin_run", return_value=1004):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.data_sink.finish_run"):
                                        with patch("core.api_server.adapter_loader.resolve_adapter_file", side_effect=resolve_file):
                                            await api_server._execute_task(
                                                "semir-cloud-drive",
                                                "tmall_material_new_624",
                                                {"mode": "current"},
                                                {"current_tab_id": "tab-1"},
                                                run_control=run_control,
                                            )

        self.assertEqual(fake_runner.navigations, [target_url])

    async def test_temu_new_mode_opens_agentseller_shell_before_page_context_business_navigation(self):
        class FakeBridge:
            def __init__(self):
                self.new_tab_urls = []

            def get_tabs(self):
                return []

            def new_tab(self, url):
                self.new_tab_urls.append(url)
                return {"id": "tab-1", "url": url, "webSocketDebuggerUrl": "ws://example.invalid"}

            def find_tab(self, url):
                return None

            def get_tab(self, tab_id):
                return {"id": "tab-1", "url": self.new_tab_urls[-1], "webSocketDebuggerUrl": "ws://example.invalid"}

            def get_tab_ws_url(self, tab):
                return "ws://example.invalid"

        class FakeRunner:
            def __init__(self, *args, **kwargs):
                self.runtime_output_files = []
                self.evaluations = []
                self.navigations = []
                self.tab_url = kwargs.get("tab_url", "")
                self.tab_id = kwargs.get("tab_id", "")

            async def evaluate(self, expression):
                self.evaluations.append(expression)
                if "logged_in" in expression:
                    return type("Result", (), {"success": True, "data": [], "meta": {"logged_in": True}, "error": None})()
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def navigate(self, url, wait_seconds=0):
                self.navigations.append(str(url))
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def _refresh_ws_url(self):
                return None

            async def run_script_file(self, script_path, params=None, control_hook=None):
                return [{"日期": "2026-06-02"}]

        class FakeTask:
            id = "mall_flux"
            name = "后台-店铺流量"
            description = ""
            entry_url = "https://agentseller.temu.com/main/mall-flux-analysis-full"
            tab_match_prefixes = []
            output = []
            script = "mall-flux.js"
            skip_auth = False
            params = [type("Param", (), {"id": "mode", "default": "current"})()]

        class FakeAdapter:
            id = "temu"
            name = "Temu 运营助手"
            entry_url = "https://agentseller.temu.com"
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = type("Auth", (), {"check_script": "auth_check.js", "login_url": "https://seller.temu.com/login"})()

        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()
        fake_bridge = FakeBridge()
        fake_runner = FakeRunner()

        with tempfile.TemporaryDirectory() as tmpdir:
            adapter_dir = Path(tmpdir)
            auth_path = adapter_dir / "auth_check.js"
            auth_path.write_text(
                "({ success: true, data: [], meta: { logged_in: true, has_more: false } })",
                encoding="utf-8",
            )
            script_path = adapter_dir / "mall-flux.js"
            script_path.write_text(
                "({ success: true, data: [], meta: { has_more: false } })",
                encoding="utf-8",
            )

            def resolve_file(adapter_id, filename):
                return auth_path if filename == "auth_check.js" else script_path

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=fake_bridge):
                        with patch("core.js_runner.JSRunner", return_value=fake_runner):
                            with patch("core.api_server.data_sink.begin_run", return_value=1002):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.data_sink.finish_run"):
                                        with patch("core.api_server.adapter_loader.resolve_adapter_file", side_effect=resolve_file):
                                            await api_server._execute_task(
                                                "temu",
                                                "mall_flux",
                                                {"mode": "new"},
                                                {},
                                                run_control=run_control,
                                            )

        self.assertEqual(fake_bridge.new_tab_urls, ["https://agentseller.temu.com/"])
        self.assertEqual(fake_runner.navigations, [])
        self.assertTrue(
            any("mall-flux-analysis-full" in expression and "location.href" in expression for expression in fake_runner.evaluations)
        )

    async def test_temu_new_mode_prefers_existing_agentseller_opener_over_cdp_new_tab(self):
        class FakeBridge:
            def __init__(self):
                self.new_tab_urls = []
                self.opened = False

            def get_tabs(self):
                tabs = [{
                    "id": "opener",
                    "type": "page",
                    "url": "https://agentseller.temu.com/",
                    "webSocketDebuggerUrl": "ws://opener.example.invalid",
                }]
                if self.opened:
                    tabs.append({
                        "id": "tab-1",
                        "type": "page",
                        "url": "https://agentseller.temu.com/",
                        "webSocketDebuggerUrl": "ws://new.example.invalid",
                    })
                return tabs

            def new_tab(self, url):
                self.new_tab_urls.append(url)
                return {"id": "fallback", "url": url, "webSocketDebuggerUrl": "ws://fallback.example.invalid"}

            def find_tab(self, url):
                return None

            def get_tab(self, tab_id):
                for tab in self.get_tabs():
                    if tab["id"] == tab_id:
                        return tab
                return None

            def get_tab_ws_url(self, tab):
                return tab["webSocketDebuggerUrl"]

        class FakeRunner:
            instances = []

            def __init__(self, *args, **kwargs):
                self.runtime_output_files = []
                self.evaluations = []
                self.user_gesture_evaluations = []
                self.navigations = []
                self.tab_url = kwargs.get("tab_url", "")
                self.tab_id = kwargs.get("tab_id", "")
                FakeRunner.instances.append(self)

            async def evaluate(self, expression, user_gesture=False):
                self.evaluations.append(expression)
                if "logged_in" in expression:
                    return type("Result", (), {"success": True, "data": [], "meta": {"logged_in": True}, "error": None})()
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def evaluate_user_gesture(self, expression):
                fake_bridge.opened = True
                self.user_gesture_evaluations.append(expression)
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def navigate(self, url, wait_seconds=0):
                self.navigations.append(str(url))
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def _refresh_ws_url(self):
                return None

            async def run_script_file(self, script_path, params=None, control_hook=None):
                return [{"日期": "2026-06-02"}]

        class FakeTask:
            id = "mall_flux"
            name = "后台-店铺流量"
            description = ""
            entry_url = "https://agentseller.temu.com/main/mall-flux-analysis-full"
            tab_match_prefixes = []
            output = []
            script = "mall-flux.js"
            skip_auth = False
            params = [type("Param", (), {"id": "mode", "default": "current"})()]

        class FakeAdapter:
            id = "temu"
            name = "Temu 运营助手"
            entry_url = "https://agentseller.temu.com"
            tab_match_prefixes = []
            tasks = [FakeTask()]
            auth = type("Auth", (), {"check_script": "auth_check.js", "login_url": "https://seller.temu.com/login"})()

        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()
        fake_bridge = FakeBridge()

        with tempfile.TemporaryDirectory() as tmpdir:
            adapter_dir = Path(tmpdir)
            auth_path = adapter_dir / "auth_check.js"
            auth_path.write_text(
                "({ success: true, data: [], meta: { logged_in: true, has_more: false } })",
                encoding="utf-8",
            )
            script_path = adapter_dir / "mall-flux.js"
            script_path.write_text(
                "({ success: true, data: [], meta: { has_more: false } })",
                encoding="utf-8",
            )

            def resolve_file(adapter_id, filename):
                return auth_path if filename == "auth_check.js" else script_path

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=fake_bridge):
                        with patch("core.js_runner.JSRunner", FakeRunner):
                            with patch("core.api_server.data_sink.begin_run", return_value=1003):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.data_sink.finish_run"):
                                        with patch("core.api_server.adapter_loader.resolve_adapter_file", side_effect=resolve_file):
                                            await api_server._execute_task(
                                                "temu",
                                                "mall_flux",
                                                {"mode": "new"},
                                                {},
                                                run_control=run_control,
                                            )

        self.assertEqual(fake_bridge.new_tab_urls, [])
        opener_runner = FakeRunner.instances[0]
        self.assertTrue(opener_runner.user_gesture_evaluations)
        self.assertTrue(any("window.open" in expression for expression in opener_runner.user_gesture_evaluations))

    async def test_doudian_new_mode_prefers_existing_fxg_backend_opener_over_cdp_new_tab(self):
        class FakeBridge:
            def __init__(self):
                self.new_tab_urls = []
                self.opened = False

            def get_tabs(self):
                tabs = [{
                    "id": "opener",
                    "type": "page",
                    "url": "https://fxg.jinritemai.com/ffa/merchant/child-campaign-detail?id=7631472587859837230&applyTab=applied",
                    "webSocketDebuggerUrl": "ws://opener.example.invalid",
                }]
                if self.opened:
                    tabs.append({
                        "id": "tab-1",
                        "type": "page",
                        "url": "https://fxg.jinritemai.com/ffa/merchant/campaign-square",
                        "webSocketDebuggerUrl": "ws://new.example.invalid",
                    })
                return tabs

            def new_tab(self, url):
                self.new_tab_urls.append(url)
                return {"id": "fallback", "url": url, "webSocketDebuggerUrl": "ws://fallback.example.invalid"}

            def find_tab(self, url):
                return None

            def get_tab(self, tab_id):
                for tab in self.get_tabs():
                    if tab["id"] == tab_id:
                        return tab
                return None

            def get_tab_ws_url(self, tab):
                return tab["webSocketDebuggerUrl"]

        class FakeRunner:
            instances = []

            def __init__(self, *args, **kwargs):
                self.runtime_output_files = []
                self.evaluations = []
                self.user_gesture_evaluations = []
                self.navigations = []
                self.tab_url = kwargs.get("tab_url", "")
                self.tab_id = kwargs.get("tab_id", "")
                FakeRunner.instances.append(self)

            async def evaluate(self, expression, user_gesture=False):
                self.evaluations.append(expression)
                if "logged_in" in expression:
                    return type("Result", (), {"success": True, "data": [], "meta": {"logged_in": True}, "error": None})()
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def evaluate_user_gesture(self, expression):
                fake_bridge.opened = True
                self.user_gesture_evaluations.append(expression)
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def navigate(self, url, wait_seconds=0):
                self.navigations.append(str(url))
                return type("Result", (), {"success": True, "data": [], "meta": {"has_more": False}, "error": None})()

            async def _refresh_ws_url(self):
                return None

            async def run_script_file(self, script_path, params=None, control_hook=None):
                return [{"活动ID": "7631472587859837230"}]

        class FakeTask:
            id = "mixed_fund_signup_monitor"
            name = "商城混资报名监控"
            description = ""
            entry_url = "https://fxg.jinritemai.com/ffa/merchant/campaign-square"
            tab_match_prefixes = []
            output = []
            script = "mixed-fund-signup-monitor.js"
            skip_auth = False
            params = [type("Param", (), {"id": "mode", "default": "current"})()]

        class FakeAdapter:
            id = "doudian-ops-assistant"
            name = "抖店运营助手"
            entry_url = "https://fxg.jinritemai.com/ffa/merchant/campaign-square"
            tab_match_prefixes = ["https://fxg.jinritemai.com/"]
            tasks = [FakeTask()]
            auth = type("Auth", (), {"check_script": "auth_check.js", "login_url": "https://fxg.jinritemai.com/"})()

        run_control = api_server._build_run_control()
        run_control["task"] = asyncio.current_task()
        fake_bridge = FakeBridge()

        with tempfile.TemporaryDirectory() as tmpdir:
            adapter_dir = Path(tmpdir)
            auth_path = adapter_dir / "auth_check.js"
            auth_path.write_text(
                "({ success: true, data: [], meta: { logged_in: true, has_more: false } })",
                encoding="utf-8",
            )
            script_path = adapter_dir / "mixed-fund-signup-monitor.js"
            script_path.write_text(
                "({ success: true, data: [], meta: { has_more: false } })",
                encoding="utf-8",
            )

            def resolve_file(adapter_id, filename):
                return auth_path if filename == "auth_check.js" else script_path

            with patch("core.api_server.adapter_loader.scan_all"):
                with patch("core.api_server.adapter_loader.get_adapter", return_value=FakeAdapter()):
                    with patch("core.api_server.get_bridge", return_value=fake_bridge):
                        with patch("core.js_runner.JSRunner", FakeRunner):
                            with patch("core.api_server.data_sink.begin_run", return_value=1004):
                                with patch("core.api_server.data_sink.prepare_artifact_dir", return_value=str(Path(tmpdir) / "runtime")):
                                    with patch("core.api_server.data_sink.finish_run"):
                                        with patch("core.api_server.adapter_loader.resolve_adapter_file", side_effect=resolve_file):
                                            await api_server._execute_task(
                                                "doudian-ops-assistant",
                                                "mixed_fund_signup_monitor",
                                                {"mode": "new"},
                                                {},
                                                run_control=run_control,
                                            )

        self.assertEqual(fake_bridge.new_tab_urls, [])
        opener_runner = FakeRunner.instances[0]
        self.assertTrue(opener_runner.user_gesture_evaluations)
        self.assertTrue(any("window.open" in expression for expression in opener_runner.user_gesture_evaluations))


if __name__ == "__main__":
    unittest.main()
