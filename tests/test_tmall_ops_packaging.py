import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import openpyxl

from core.api_server import _finalize_tmall_ops_assistant_outputs


class TmallOpsPackagingTests(unittest.TestCase):
    def test_packaging_upload_bundles_tesseract_ocr_runtime_assets(self):
        vendor = Path("adapters/tmall-ops-assistant/vendor/tesseract")
        required_files = [
            vendor / "tesseract.min.js",
            vendor / "worker.min.js",
            vendor / "tesseract-core.wasm.js",
            vendor / "tesseract-core.wasm",
            vendor / "lang" / "eng.traineddata.gz",
            vendor / "lang" / "chi_sim.traineddata.gz",
        ]

        for path in required_files:
            self.assertTrue(path.is_file(), f"missing OCR runtime asset: {path}")
            self.assertGreater(path.stat().st_size, 1024, f"OCR runtime asset is unexpectedly small: {path}")

    def test_packaging_upload_outputs_style_grouped_zip_with_usage_folders(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            main_file = runtime_dir / "raw-main.jpg"
            detail_file = runtime_dir / "raw-detail.jpg"
            main_file.write_bytes(b"main")
            detail_file.write_bytes(b"detail")

            exported = base / "packaging-result.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_tmall_ops_assistant_outputs(
                task_id="tmall_packaging_upload",
                data_rows=[
                    {
                        "款号": "208126140007",
                        "商品ID": "693886015421",
                        "图片用途": "1:1主图",
                        "文件名": "01_1比1主图_01_208126140007_800x800_主图01.jpg",
                        "原文件名": "208126140007_800x800_主图01.jpg",
                        "云盘路径": "品牌视觉部/服饰包装组/巴拉服饰产品包装/208126140007/208126140007_800x800_主图01.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(main_file),
                        "__package_filename": "01_1比1主图_01_208126140007_800x800_主图01.jpg",
                    },
                    {
                        "款号": "208126140007",
                        "商品ID": "693886015421",
                        "图片用途": "PC详情",
                        "文件名": "06_PC详情_01_详情_001.jpg",
                        "原文件名": "详情_001.jpg",
                        "云盘路径": "品牌视觉部/服饰包装组/巴拉服饰产品包装/208126140007/详情_001.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(detail_file),
                        "__package_filename": "06_PC详情_01_详情_001.jpg",
                    },
                ],
                runtime_files=[str(main_file), str(detail_file)],
                exported_files=[str(exported)],
                run_params={
                    "package_name": "天猫包装图片包",
                },
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            zip_path = Path(result[0])
            self.assertTrue(zip_path.is_file())
            self.assertEqual(Path(result[1]), exported)
            self.assertFalse(main_file.exists())
            self.assertFalse(detail_file.exists())
            self.assertFalse(runtime_dir.exists())

            with zipfile.ZipFile(zip_path) as archive:
                names = archive.namelist()
                self.assertTrue(any(
                    name.endswith("天猫包装图片包/208126140007/01_1比1主图/01_1比1主图_01_208126140007_800x800_主图01.jpg")
                    for name in names
                ))
                self.assertTrue(any(
                    name.endswith("天猫包装图片包/208126140007/04_商详页/06_PC详情_01_详情_001.jpg")
                    for name in names
                ))

    def test_ai_image_chain_outputs_copy_tables_and_images_to_local_export_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()
            export_dir = base / "exports"

            main_file = runtime_dir / "main.jpg"
            detail_file = runtime_dir / "detail.jpg"
            ai_file = runtime_dir / "ai-1.jpg"
            main_file.write_bytes(b"main")
            detail_file.write_bytes(b"detail")
            ai_file.write_bytes(b"ai")

            excel_file = base / "巴拉-AI测图全链路执行证据.xlsx"
            json_file = base / "巴拉-AI测图全链路执行证据.json"
            excel_file.write_bytes(b"excel")
            json_file.write_text("[]", encoding="utf-8")

            result = _finalize_tmall_ops_assistant_outputs(
                task_id="tmall_ai_image_test_chain",
                data_rows=[
                    {
                        "款号": "208326100202",
                        "商品ID": "1060862679580",
                        "阶段": "森马云盘找图",
                        "主图原图文件": str(main_file),
                        "细节参考图文件": str(detail_file),
                    },
                    {
                        "款号": "208326100202",
                        "商品ID": "1060862679580",
                        "阶段": "1XM生图",
                        "本地文件": str(ai_file),
                    },
                ],
                runtime_files=[str(main_file), str(detail_file), str(ai_file)],
                exported_files=[str(excel_file), str(json_file)],
                run_params={
                    "output_dir": str(export_dir),
                    "__task_started_at": "2026-07-02T12:10:45",
                    "__task_run_id": 13,
                },
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            export_root = export_dir / "运行_20260702-121045_run13"
            item_dir = "208326100202_1060862679580"
            copied_main = export_root / "网盘素材图" / item_dir / "main.jpg"
            copied_detail = export_root / "网盘素材图" / item_dir / "detail.jpg"
            copied_ai = export_root / "AI生成图" / item_dir / "ai-1.jpg"
            copied_excel = export_root / "数据表格" / excel_file.name
            copied_json = export_root / "数据表格" / json_file.name

            self.assertTrue(copied_main.is_file())
            self.assertTrue(copied_detail.is_file())
            self.assertTrue(copied_ai.is_file())
            self.assertTrue(copied_excel.is_file())
            self.assertTrue(copied_json.is_file())
            self.assertIn(str(copied_main), result)
            self.assertIn(str(copied_detail), result)
            self.assertIn(str(copied_ai), result)
            self.assertIn(str(copied_excel), result)
            self.assertIn(str(copied_json), result)

    def test_material_test_data_export_copies_tables_to_local_export_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()
            export_dir = base / "exports"
            excel_file = base / "巴拉-AI测图数据抓取导出.xlsx"
            json_file = base / "巴拉-AI测图数据抓取导出.json"
            excel_file.write_bytes(b"excel")
            json_file.write_text("[]", encoding="utf-8")

            result = _finalize_tmall_ops_assistant_outputs(
                task_id="tmall_material_test_data_export",
                data_rows=[],
                runtime_files=[],
                exported_files=[str(excel_file), str(json_file)],
                run_params={"output_dir": str(export_dir)},
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            copied_excel = export_dir / "数据表格" / excel_file.name
            copied_json = export_dir / "数据表格" / json_file.name
            self.assertTrue(copied_excel.is_file())
            self.assertTrue(copied_json.is_file())
            self.assertEqual(result, [str(copied_excel), str(copied_json)])

    def test_compete_paid_monitor_copies_table_to_local_export_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()
            export_dir = base / "exports"
            excel_file = base / "天猫竞品付费投放数据监控_20260716-180530.xlsx"
            excel_file.write_bytes(b"excel")

            result = _finalize_tmall_ops_assistant_outputs(
                task_id="tmall_compete_paid_monitor",
                data_rows=[],
                runtime_files=[],
                exported_files=[str(excel_file)],
                run_params={"output_dir": str(export_dir)},
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            copied_excel = export_dir / "数据表格" / excel_file.name
            self.assertTrue(copied_excel.is_file())
            self.assertEqual(result, [str(copied_excel)])

    def test_material_test_data_export_syncs_to_cloud_when_enabled(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()
            export_dir = base / "exports"
            excel_file = base / "巴拉-AI测图数据抓取导出.xlsx"
            excel_file.write_bytes(b"excel")
            logs = []

            with patch("core.api_server.sync_tmall_material_test_workbook_to_cloud", create=True) as sync:
                sync.return_value = {"overview_rows": 1, "detail_rows": 2, "inserted_or_updated": 3}
                result = _finalize_tmall_ops_assistant_outputs(
                    task_id="tmall_material_test_data_export",
                    data_rows=[],
                    runtime_files=[],
                    exported_files=[str(excel_file)],
                    run_params={"output_dir": str(export_dir), "sync_to_cloud": ["enabled"]},
                    runtime_artifact_dir=str(runtime_dir),
                    log=logs.append,
                )

            copied_excel = export_dir / "数据表格" / excel_file.name
            self.assertEqual(result, [str(copied_excel)])
            sync.assert_called_once_with(copied_excel)
            self.assertTrue(any("云端测图数据看板同步完成" in message for message in logs))

    def test_sync_material_test_workbook_to_cloud_uploads_workbook_and_imports_rows(self):
        from core.api_server import sync_tmall_material_test_workbook_to_cloud

        class FakeClient:
            def __init__(self):
                self.calls = []
                self.uploads = []

            def request_json(self, method, path, body=None, *, token_type="machine"):
                self.calls.append({"method": method, "path": path, "body": dict(body or {})})
                if path == "/api/assets/presign":
                    return {"upload_url": "/upload/local-export", "object_key": "objects/local-export"}
                if path == "/api/material-test/import":
                    return {
                        "overview_rows": len(body.get("overview_rows") or []),
                        "detail_rows": len(body.get("detail_rows") or []),
                        "inserted_or_updated": len(body.get("overview_rows") or []) + len(body.get("detail_rows") or []),
                    }
                return {}

            def upload_asset(self, upload_url, path, content_type):
                self.uploads.append({"upload_url": upload_url, "path": Path(path), "content_type": content_type})
                return {"ok": True}

        with tempfile.TemporaryDirectory() as tmpdir:
            workbook_path = Path(tmpdir) / "local-export.xlsx"
            workbook = openpyxl.Workbook()
            overview = workbook.active
            overview.title = "概览"
            overview.append(["记录类型", "表格行号", "款号", "商品ID", "商品标题", "任务ID", "测试状态", "测试渠道", "测试素材数", "统计口径", "最优素材", "执行结果", "备注"])
            overview.append(["概览", 2, "208326", "1001", "标题", "T1", "完成", "搜索", 2, "ACCUMULATE_30_DAYS", "M1", "成功", ""])
            detail = workbook.create_sheet("明细")
            detail.append(["记录类型", "表格行号", "款号", "商品ID", "商品标题", "任务ID", "测试状态", "测试渠道", "测试素材数", "统计口径", "统计日期", "图片类型", "素材ID", "素材比例", "素材占比", "素材URL", "搜索曝光", "搜索点击", "搜索点击率", "详情曝光", "详情点击", "详情点击率", "详情加购", "详情支付转化", "详情支付转化率", "数据下载链接", "执行结果", "备注"])
            detail.append(["明细", 2, "208326", "1001", "标题", "T1", "完成", "搜索", 2, "ACCUMULATE_30_DAYS", "2026-07-01", "主图", "M1", "1:1", "50%", "https://img.test/1.jpg", 1000, 77, "7.70%", 500, 40, "8%", 12, 3, "2.50%", "", "成功", ""])
            detail.append(["明细", 3, "208326", "1001", "标题", "T1", "完成", "搜索", 2, "ACCUMULATE_30_DAYS", "2026-07-02", "AI图", "M2", "1:1", "50%", "https://img.test/2.jpg", 900, 90, "10%", 450, 45, "10%", 10, 4, "4%", "", "成功", ""])
            workbook.save(workbook_path)

            client = FakeClient()
            result = sync_tmall_material_test_workbook_to_cloud(workbook_path, client=client)

        self.assertEqual(result["overview_rows"], 1)
        self.assertEqual(result["detail_rows"], 2)
        self.assertEqual(client.uploads[0]["path"].name, "local-export.xlsx")
        presign = client.calls[0]
        self.assertEqual(presign["path"], "/api/assets/presign")
        self.assertEqual(presign["body"]["batch_uid"], "material-test")
        self.assertEqual(presign["body"]["kind"], "result")
        import_call = next(call for call in client.calls if call["path"] == "/api/material-test/import")
        self.assertEqual(import_call["body"]["source"]["sync_mode"], "local_manual_export")
        self.assertEqual(import_call["body"]["source"]["object_key"], "objects/local-export")

    def test_tmall_export_dir_expands_windows_style_environment_path(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()
            export_parent = base / "exports"
            excel_file = base / "巴拉-AI测图数据抓取导出.xlsx"
            excel_file.write_bytes(b"excel")

            with patch.dict("os.environ", {"CRAWSHRIMP_TEST_EXPORT_ROOT": str(export_parent)}):
                result = _finalize_tmall_ops_assistant_outputs(
                    task_id="tmall_material_test_data_export",
                    data_rows=[],
                    runtime_files=[],
                    exported_files=[str(excel_file)],
                    run_params={"output_dir": r"%CRAWSHRIMP_TEST_EXPORT_ROOT%\巴拉-AI测图数据抓取导出"},
                    runtime_artifact_dir=str(runtime_dir),
                    log=lambda _: None,
                )

            copied_excel = export_parent / "巴拉-AI测图数据抓取导出" / "数据表格" / excel_file.name
            self.assertTrue(copied_excel.is_file())
            self.assertEqual(result, [str(copied_excel)])

    def test_ai_image_chain_uses_downloads_export_dir_when_output_dir_is_blank(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()
            home_dir = base / "home"
            home_dir.mkdir()

            main_file = runtime_dir / "main.jpg"
            ai_file = runtime_dir / "ai-1.jpg"
            main_file.write_bytes(b"main")
            ai_file.write_bytes(b"ai")
            excel_file = base / "巴拉-AI测图全链路执行证据.xlsx"
            excel_file.write_bytes(b"excel")

            with patch.object(Path, "home", return_value=home_dir):
                result = _finalize_tmall_ops_assistant_outputs(
                    task_id="tmall_ai_image_test_chain",
                    data_rows=[
                        {
                            "款号": "208326100202",
                            "商品ID": "1060862679580",
                            "阶段": "森马云盘找图",
                            "主图原图文件": str(main_file),
                        },
                        {
                            "款号": "208326100202",
                            "商品ID": "1060862679580",
                            "阶段": "1XM生图",
                            "本地文件": str(ai_file),
                        },
                    ],
                    runtime_files=[str(main_file), str(ai_file)],
                    exported_files=[str(excel_file)],
                    run_params={
                        "__task_started_at": "2026-07-02T12:10:45",
                        "__task_run_id": 13,
                    },
                    runtime_artifact_dir=str(runtime_dir),
                    log=lambda _: None,
                )

            export_root = home_dir / "Downloads" / "抓虾导出" / "天猫运营助手" / "巴拉-AI测图全链路" / "运行_20260702-121045_run13"
            item_dir = "208326100202_1060862679580"
            copied_main = export_root / "网盘素材图" / item_dir / "main.jpg"
            copied_ai = export_root / "AI生成图" / item_dir / "ai-1.jpg"
            copied_excel = export_root / "数据表格" / excel_file.name

            self.assertTrue(copied_main.is_file())
            self.assertTrue(copied_ai.is_file())
            self.assertTrue(copied_excel.is_file())
            self.assertIn(str(copied_main), result)
            self.assertIn(str(copied_ai), result)
            self.assertIn(str(copied_excel), result)


if __name__ == "__main__":
    unittest.main()
