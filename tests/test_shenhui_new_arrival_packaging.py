import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import yaml
from openpyxl import Workbook, load_workbook

from core.api_server import (
    _cleanup_orphaned_runtime_artifacts,
    _finalize_shenhui_new_arrival_outputs,
    _prepare_shenhui_shoe_package_rows,
)

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "adapters" / "shenhui-new-arrival" / "manifest.yaml"
SHOE_PACKAGING_PATH = ROOT / "core" / "shenhui_shoe_packaging.py"


class ShenhuiNewArrivalPackagingTests(unittest.TestCase):
    def test_shoe_packaging_core_is_separate_from_clothing_packaging(self):
        self.assertTrue(SHOE_PACKAGING_PATH.is_file())

    def test_manifest_declares_separate_shoe_upload_package_task(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        task = next(
            item
            for item in manifest["tasks"]
            if item["id"] == "prepare_shoe_upload_package"
        )

        self.assertEqual(task["name"], "【鞋品】整理深绘上新图包")
        self.assertEqual(task["script"], "prepare-shoe-upload-package.js")
        self.assertFalse(task["skip_auth"])
        params = {item["id"]: item for item in task["params"]}
        self.assertNotIn("item_codes", params)
        self.assertNotIn("folder_scan_depth", params)
        self.assertNotIn("download_concurrency", params)
        self.assertEqual(params["shoe_cloud_path"]["type"], "text")
        self.assertEqual(params["shoe_category_file"]["type"], "file_excel")
        self.assertTrue(params["shoe_category_file"].get("required"))
        self.assertEqual(params["mode"]["default"], "new")
        mode_options = {
            option["value"]: option["label"]
            for option in params["mode"]["options"]
        }
        self.assertEqual(mode_options["current"], "当前页面")
        self.assertEqual(mode_options["new"], "全新页面（推荐）")
        self.assertEqual(
            params["shoe_category_file"]["template_file"],
            "assets/鞋品品类映射模板.xlsx",
        )
        self.assertEqual(params["model_id"]["default"], "gpt-5.5")
        self.assertIn(
            "gpt-5.5",
            [option["value"] for option in params["model_id"]["options"]],
        )
        self.assertIn(
            "qwen3.7-plus",
            [option["value"] for option in params["model_id"]["options"]],
        )
        self.assertTrue(
            {
                "deepseek-v4-pro",
                "glm-5.2",
                "kimi-k2.7-code",
            }.issubset(
                {
                    option["value"]
                    for option in params["model_id"]["options"]
                }
            )
        )
        self.assertEqual(params["export_folder"]["type"], "directory")

        output_columns = task["output"][0]["columns"]
        self.assertIn("品类来源", output_columns)
        self.assertIn("规则槽位", output_columns)
        self.assertIn("规则告警", output_columns)

    def test_manifest_declares_deepdraw_upload_task_with_fail_closed_controls(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        task = next(item for item in manifest["tasks"] if item["id"] == "upload_to_deepdraw")

        self.assertEqual(task["script"], "upload-to-deepdraw.js")
        self.assertEqual(task["entry_url"], "https://www.deepdraw.biz/authorized/merchant/index")
        self.assertTrue(task["skip_auth"])
        self.assertIn(
            "https://www.deepdraw.biz/authorized/merchant/index",
            task["tab_match_prefixes"],
        )

        params = {item["id"]: item for item in task["params"]}
        self.assertEqual(params["package_zip_paths"]["type"], "file_zip")
        self.assertEqual(params["upload_mode"]["default"], "dry_run")
        self.assertNotIn("production_confirm_text", params)
        self.assertNotIn("max_upload_count", params)

    def test_manifest_declares_separate_pdf_batch_screenshot_task(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))
        self.assertEqual(
            [item["id"] for item in manifest["tasks"][:2]],
            ["pdf_batch_screenshot", "prepare_upload_package"],
        )
        task = next(item for item in manifest["tasks"] if item["id"] == "pdf_batch_screenshot")

        self.assertEqual(task["script"], "pdf-batch-screenshot.js")
        self.assertEqual(task["entry_url"], "about:blank")
        self.assertTrue(task["skip_auth"])
        params = {item["id"]: item for item in task["params"]}
        self.assertEqual(params["wash_pdf_files"]["type"], "file_pdf")
        self.assertEqual(params["tag_pdf_files"]["type"], "file_pdf")
        self.assertNotIn("pdf_files", params)
        self.assertNotIn("pdf_type", params)
        self.assertEqual(params["wash_crop_boxes"]["type"], "textarea")
        self.assertEqual(params["wash_crop_boxes"]["default"], '[{"x":0.0892,"y":0.2084,"width":0.4189,"height":0.7546}]')
        self.assertEqual(params["tag_crop_boxes"]["type"], "textarea")
        self.assertEqual(params["tag_crop_boxes"]["default"], '[{"x":0.0113,"y":0.2352,"width":0.1535,"height":0.5058}]')
        self.assertEqual(params["output_mode"]["type"], "select")
        self.assertEqual(params["output_mode"]["default"], "create_package")
        self.assertNotIn("style_color_overrides", params)

        prepare_task = next(item for item in manifest["tasks"] if item["id"] == "prepare_upload_package")
        prepare_params = {item["id"]: item for item in prepare_task["params"]}
        self.assertEqual(prepare_params["mode"]["default"], "new")
        prepare_mode_options = {
            option["value"]: option["label"]
            for option in prepare_params["mode"]["options"]
        }
        self.assertEqual(prepare_mode_options["current"], "当前页面")
        self.assertEqual(prepare_mode_options["new"], "全新页面（推荐）")
        self.assertEqual(prepare_params["image_source_type"]["type"], "radio")
        self.assertEqual(prepare_params["image_source_type"]["default"], "all")
        self.assertEqual(
            [item["value"] for item in prepare_params["image_source_type"]["options"]],
            ["all", "still", "model"],
        )
        self.assertEqual(prepare_params["wash_crop_boxes"]["type"], "textarea")
        self.assertEqual(prepare_params["tag_crop_boxes"]["type"], "textarea")
        self.assertEqual(prepare_params["auto_zip_package"]["type"], "checkbox")
        self.assertEqual(prepare_params["auto_zip_package"]["default"], [])
        self.assertEqual(prepare_params["auto_zip_package"]["options"][0]["value"], "yes")

    def test_finalize_outputs_groups_images_by_style_code_without_zip_by_default(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            model_file = runtime_dir / "runtime-model.jpg"
            yq_file = runtime_dir / "runtime-yq.jpg"
            model_file.write_bytes(b"model")
            yq_file.write_bytes(b"yq")

            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_shenhui_new_arrival_outputs(
                task_id="prepare_upload_package",
                data_rows=[
                    {
                        "输入款号": "208226103201",
                        "输入编码": "208226103201",
                        "素材来源": "模特图",
                        "文件名": "balaBR05106-72904_P.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(model_file),
                        "__shenhui_group_code": "208226103201",
                        "__shenhui_asset_role": "image",
                        "__package_filename": "balaBR05106-72904_P.jpg",
                    },
                    {
                        "输入款号": "208226103201",
                        "输入编码": "208226103201",
                        "素材来源": "静物图",
                        "文件名": "yq.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(yq_file),
                        "__shenhui_group_code": "208226103201",
                        "__shenhui_asset_role": "yq",
                        "__package_filename": "yq.jpg",
                    },
                ],
                runtime_files=[str(model_file), str(yq_file)],
                exported_files=[str(exported)],
                run_params={"package_name": "深绘测试图包"},
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            package_dir = Path(result[0])
            self.assertTrue(package_dir.is_dir())
            self.assertEqual(package_dir.name, "深绘测试图包")
            self.assertEqual(Path(result[1]), exported)
            self.assertTrue((package_dir / "208226103201" / "balaBR05106-72904_P.jpg").is_file())
            self.assertTrue((package_dir / "208226103201" / "yq.jpg").is_file())

            self.assertFalse(model_file.exists())
            self.assertFalse(yq_file.exists())
            self.assertFalse((runtime_dir / "深绘测试图包").exists())

    def test_finalize_shoe_outputs_copies_finished_style_folder_and_result_excel(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            package_dir = runtime_dir / "shoe-packages" / "204326141005"
            color_dir = package_dir / "1.白紫色调00317"
            export_dir = base / "downloads"
            color_dir.mkdir(parents=True)
            (package_dir / "tmz (1).jpg").write_bytes(b"tmz")
            (color_dir / "o.jpg").write_bytes(b"poster")
            (color_dir / "yk1.jpg").write_bytes(b"detail")
            exported = base / "深绘鞋品上新图包整理结果.xlsx"
            data_rows = [{
                "输入款号": "204326141005",
                "下载结果": "已下载",
                "本地文件": str(package_dir / "tmz (1).jpg"),
            }]
            workbook = Workbook()
            sheet = workbook.active
            sheet.append(list(data_rows[0]))
            sheet.append(list(data_rows[0].values()))
            workbook.save(exported)
            workbook.close()
            raw_download = runtime_dir / "raw.jpg"
            raw_download.write_bytes(b"raw")

            result = _finalize_shenhui_new_arrival_outputs(
                task_id="prepare_shoe_upload_package",
                data_rows=data_rows,
                runtime_files=[str(raw_download)],
                exported_files=[str(exported)],
                run_params={
                    "export_folder": str(export_dir),
                    "__shenhui_shoe_package_refs": [str(package_dir)],
                },
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            output_package = export_dir / "204326141005"
            self.assertEqual(
                {Path(path) for path in result},
                {
                    output_package,
                    export_dir / "深绘鞋品上新图包整理结果.xlsx",
                },
            )
            self.assertTrue((output_package / "tmz (1).jpg").is_file())
            self.assertTrue((output_package / "1.白紫色调00317" / "o.jpg").is_file())
            self.assertTrue((output_package / "1.白紫色调00317" / "yk1.jpg").is_file())
            self.assertFalse(raw_download.exists())
            expected_path = str(output_package / "tmz (1).jpg")
            self.assertEqual(data_rows[0]["本地文件"], expected_path)
            workbook = load_workbook(
                export_dir / "深绘鞋品上新图包整理结果.xlsx",
                read_only=True,
                data_only=True,
            )
            self.assertEqual(workbook.active["C2"].value, expected_path)
            workbook.close()

    def test_prepare_shoe_rows_registers_generated_package_before_excel_export(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            runtime_dir = Path(tmpdir) / "runtime"
            package_root = runtime_dir / "shoe-packages" / "204326141005"
            package_root.mkdir(parents=True)
            run_params = {
                "model_id": "qwen3.8-max-preview",
                "shoe_category_file": {
                    "rows": [
                        {"款号": "208326146209", "品类": "宝宝鞋"},
                        {"款号": "204325141014", "品类": "公主鞋"},
                    ]
                },
            }
            expected_rows = [{
                "输入款号": "204326141005",
                "规则槽位": "o",
                "规则告警": "",
            }]
            progress_events = []
            progress_callback = progress_events.append

            with patch(
                "core.api_server.shenhui_shoe_packaging.prepare_shoe_packages",
                return_value=(expected_rows, {"204326141005": package_root}),
            ) as prepare:
                result = _prepare_shenhui_shoe_package_rows(
                    data_rows=[{"输入款号": "204326141005"}],
                    run_params=run_params,
                    runtime_artifact_dir=str(runtime_dir),
                    log=lambda _: None,
                    progress=progress_callback,
                )

            self.assertEqual(result, expected_rows)
            self.assertEqual(
                run_params["__shenhui_shoe_package_refs"],
                [str(package_root)],
            )
            self.assertEqual(
                prepare.call_args.kwargs["model_id"],
                "qwen3.8-max-preview",
            )
            self.assertEqual(
                prepare.call_args.kwargs["shoe_categories"],
                {
                    "208326146209": "婴童",
                    "204325141014": "休闲",
                },
            )
            self.assertIs(
                prepare.call_args.kwargs["progress"],
                progress_callback,
            )

            run_params["__shoe_pose_benchmark"] = True
            with patch(
                "core.api_server.shenhui_shoe_packaging.prepare_shoe_packages",
                return_value=(expected_rows, {"204326141005": package_root}),
            ) as benchmark_prepare:
                _prepare_shenhui_shoe_package_rows(
                    data_rows=[{"输入款号": "204326141005"}],
                    run_params=run_params,
                    runtime_artifact_dir=str(runtime_dir),
                    log=lambda _: None,
                )
            self.assertIs(
                benchmark_prepare.call_args.kwargs["analyze_color_label"],
                False,
            )

    def test_finalize_outputs_creates_style_zips_when_auto_zip_enabled(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            model_file = runtime_dir / "runtime-model.jpg"
            yq_file = runtime_dir / "runtime-yq.jpg"
            model_file.write_bytes(b"model")
            yq_file.write_bytes(b"yq")

            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_shenhui_new_arrival_outputs(
                task_id="prepare_upload_package",
                data_rows=[
                    {
                        "输入款号": "208226103201",
                        "输入编码": "208226103201",
                        "素材来源": "模特图",
                        "文件名": "balaBR05106-72904_P.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(model_file),
                        "__shenhui_group_code": "208226103201",
                        "__shenhui_asset_role": "image",
                        "__package_filename": "balaBR05106-72904_P.jpg",
                    },
                    {
                        "输入款号": "208226103201",
                        "输入编码": "208226103201",
                        "素材来源": "静物图",
                        "文件名": "yq.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(yq_file),
                        "__shenhui_group_code": "208226103201",
                        "__shenhui_asset_role": "yq",
                        "__package_filename": "yq.jpg",
                    },
                ],
                runtime_files=[str(model_file), str(yq_file)],
                exported_files=[str(exported)],
                run_params={"package_name": "深绘测试图包", "auto_zip_package": ["yes"]},
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            style_zip_path = Path(result[0])
            self.assertTrue(style_zip_path.is_file())
            self.assertEqual(style_zip_path.name, "208226103201.zip")
            self.assertEqual(Path(result[1]), exported)

            with zipfile.ZipFile(style_zip_path) as archive:
                names = archive.namelist()
                self.assertIn("balaBR05106-72904_P.jpg", names)
                self.assertIn("yq.jpg", names)

            self.assertFalse(model_file.exists())
            self.assertFalse(yq_file.exists())
            self.assertFalse((runtime_dir / "深绘测试图包").exists())

    def test_finalize_outputs_removes_runtime_intermediates_after_copying_to_export_folder(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            export_dir = base / "exports"
            runtime_dir.mkdir()

            model_file = runtime_dir / "runtime-model.jpg"
            model_file.write_bytes(b"model")
            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_shenhui_new_arrival_outputs(
                task_id="prepare_upload_package",
                data_rows=[{
                    "输入款号": "208226103201",
                    "输入编码": "208226103201",
                    "素材来源": "模特图",
                    "文件名": "balaBR05106-72904_P.jpg",
                    "下载结果": "已下载",
                    "本地文件": str(model_file),
                    "__shenhui_group_code": "208226103201",
                    "__shenhui_asset_role": "image",
                    "__package_filename": "balaBR05106-72904_P.jpg",
                }],
                runtime_files=[str(model_file)],
                exported_files=[str(exported)],
                run_params={
                    "package_name": "深绘测试图包",
                    "export_folder": str(export_dir),
                    "auto_zip_package": True,
                },
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertTrue(all(Path(path).is_file() for path in result))
            self.assertEqual({Path(path).parent for path in result}, {export_dir})
            self.assertFalse(runtime_dir.exists())

    def test_finalize_outputs_writes_default_zips_next_to_excel_and_cleans_runtime(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            output_dir = base / "outputs"
            runtime_dir.mkdir()
            output_dir.mkdir()

            model_file = runtime_dir / "runtime-model.jpg"
            model_file.write_bytes(b"model")
            exported = output_dir / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_shenhui_new_arrival_outputs(
                task_id="prepare_upload_package",
                data_rows=[{
                    "输入款号": "208226103201",
                    "输入编码": "208226103201",
                    "素材来源": "模特图",
                    "文件名": "balaBR05106-72904_P.jpg",
                    "下载结果": "已下载",
                    "本地文件": str(model_file),
                    "__shenhui_group_code": "208226103201",
                    "__shenhui_asset_role": "image",
                    "__package_filename": "balaBR05106-72904_P.jpg",
                }],
                runtime_files=[str(model_file)],
                exported_files=[str(exported)],
                run_params={"package_name": "深绘测试图包"},
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            self.assertEqual(Path(result[0]).parent, output_dir)
            self.assertTrue(Path(result[0]).is_dir())
            self.assertEqual(Path(result[1]), exported)
            self.assertFalse(runtime_dir.exists())

    def test_finalize_outputs_cleans_stopped_runtime_download_artifacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            downloaded = runtime_dir / "downloaded.jpg"
            partial = runtime_dir / "downloaded-2.jpg.part"
            downloaded.write_bytes(b"downloaded")
            partial.write_bytes(b"partial")
            exported = base / "partial.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_shenhui_new_arrival_outputs(
                task_id="prepare_upload_package",
                data_rows=[],
                runtime_files=[str(downloaded)],
                exported_files=[str(exported)],
                run_params={"package_name": "深绘测试图包"},
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(result, [str(exported)])
            self.assertFalse(runtime_dir.exists())

    def test_orphaned_active_run_cleanup_removes_runtime_download_artifacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "data" / "shenhui-new-arrival" / "prepare_upload_package" / "runtime" / "123"
            runtime_dir.mkdir(parents=True)

            downloaded = runtime_dir / "downloaded.jpg"
            partial = runtime_dir / "downloaded-2.jpg.part"
            downloaded.write_bytes(b"downloaded")
            partial.write_bytes(b"partial")

            with patch("core.data_sink.artifact_dir_path", return_value=runtime_dir):
                _cleanup_orphaned_runtime_artifacts([{
                    "id": 123,
                    "adapter_id": "shenhui-new-arrival",
                    "task_id": "prepare_upload_package",
                }])

            self.assertFalse(runtime_dir.exists())

    def test_finalize_pdf_batch_screenshot_outputs_cropped_zip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            pdf_file = base / "208226103201-label.pdf"
            rendered = base / "rendered-yq.png"
            exported = base / "summary.xlsx"
            pdf_file.write_bytes(b"%PDF-fake")
            rendered.write_bytes(b"png")
            exported.write_bytes(b"excel")

            with patch(
                "core.shenhui_pdf_screenshot.convert_pdf_to_yq_images",
                return_value=[rendered],
            ), patch(
                "core.shenhui_pdf_screenshot.extract_pdf_text",
                return_value="",
            ):
                result = _finalize_shenhui_new_arrival_outputs(
                    task_id="pdf_batch_screenshot",
                    data_rows=[{
                        "PDF文件": "208226103201-label.pdf",
                        "原始路径": str(pdf_file),
                        "__pdf_path": str(pdf_file),
                    }],
                    runtime_files=[],
                    exported_files=[str(exported)],
                    run_params={"package_name": "PDF截图测试"},
                    runtime_artifact_dir=str(runtime_dir),
                    log=lambda _: None,
                )

            self.assertEqual(len(result), 2)
            zip_path = Path(result[0])
            self.assertTrue(zip_path.is_file())
            self.assertEqual(Path(result[1]), exported)

            with zipfile.ZipFile(zip_path) as archive:
                names = archive.namelist()
                self.assertTrue(any(name.endswith("PDF截图测试/208226103201/yq(1).png") for name in names))

    def test_finalize_prepare_upload_package_crops_downloaded_pdf_into_style_zip(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            model_file = runtime_dir / "runtime-model.jpg"
            pdf_file = runtime_dir / "runtime-tag.pdf"
            rendered = base / "tag.png"
            exported = base / "summary.xlsx"
            model_file.write_bytes(b"model")
            pdf_file.write_bytes(b"%PDF-fake")
            rendered.write_bytes(b"tag")
            exported.write_bytes(b"excel")

            with patch(
                "core.shenhui_pdf_screenshot.convert_pdf_to_yq_images",
                return_value=[rendered],
            ), patch(
                "core.shenhui_pdf_screenshot.extract_pdf_text",
                return_value="",
            ):
                result = _finalize_shenhui_new_arrival_outputs(
                    task_id="prepare_upload_package",
                    data_rows=[
                        {
                            "输入款号": "208226103201",
                            "输入编码": "208226103201",
                            "素材来源": "模特图",
                            "文件名": "balaBR05106-72904_P.jpg",
                            "下载结果": "已下载",
                            "本地文件": str(model_file),
                            "__shenhui_group_code": "208226103201",
                            "__shenhui_asset_role": "image",
                            "__package_filename": "balaBR05106-72904_P.jpg",
                        },
                        {
                            "输入款号": "208226103201",
                            "输入编码": "208226103201",
                            "素材来源": "静物图",
                            "文件名": "208226103201吊牌.pdf",
                            "下载结果": "已下载",
                            "本地文件": str(pdf_file),
                            "__shenhui_group_code": "208226103201",
                            "__shenhui_asset_role": "pdf_yq",
                            "__package_filename": "208226103201吊牌.pdf",
                            "__pdf_path": str(pdf_file),
                            "__pdf_type": "hang_tag",
                            "__style_code": "208226103201",
                        },
                    ],
                    runtime_files=[str(model_file), str(pdf_file)],
                    exported_files=[str(exported)],
                    run_params={
                        "package_name": "深绘测试图包",
                        "tag_crop_boxes": '[{"x":0.01,"y":0.2,"width":0.2,"height":0.5}]',
                        "auto_zip_package": True,
                    },
                    runtime_artifact_dir=str(runtime_dir),
                    log=lambda _: None,
                )

            style_zip_path = Path(result[0])
            self.assertTrue(style_zip_path.is_file())
            with zipfile.ZipFile(style_zip_path) as archive:
                names = archive.namelist()
                self.assertIn("balaBR05106-72904_P.jpg", names)
                self.assertIn("yq(1).png", names)
                self.assertNotIn("_PDF待裁图/runtime-tag.pdf", names)

    def test_finalize_prepare_upload_package_uses_short_pdf_work_dir(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            pdf_file = runtime_dir / "runtime-tag.pdf"
            rendered = base / "tag.png"
            exported = base / "summary.xlsx"
            pdf_file.write_bytes(b"%PDF-fake")
            rendered.write_bytes(b"tag")
            exported.write_bytes(b"excel")
            work_dirs = []

            def fake_convert(pdf_path, work_dir, log, *, crop_boxes=None):
                work_dirs.append(Path(work_dir))
                return [rendered]

            with patch(
                "core.shenhui_pdf_screenshot.convert_pdf_to_yq_images",
                side_effect=fake_convert,
            ), patch(
                "core.shenhui_pdf_screenshot.extract_pdf_text",
                return_value="",
            ):
                _finalize_shenhui_new_arrival_outputs(
                    task_id="prepare_upload_package",
                    data_rows=[{
                        "输入款号": "208226133212",
                        "输入编码": "208226133212",
                        "素材来源": "静物图",
                        "文件名": "208226133212__still__f2e2b3449a6c550fa3e6a9fab8c3bfcb37d1466b__208226133212吊牌.pdf",
                        "下载结果": "已下载",
                        "本地文件": str(pdf_file),
                        "__shenhui_group_code": "208226133212",
                        "__shenhui_asset_role": "pdf_yq",
                        "__package_filename": "208226133212吊牌.pdf",
                        "__pdf_path": str(pdf_file),
                        "__pdf_type": "hang_tag",
                        "__style_code": "208226133212",
                    }],
                    runtime_files=[str(pdf_file)],
                    exported_files=[str(exported)],
                    run_params={
                        "package_name": "深绘上新图包_20260609_174655",
                        "auto_zip_package": True,
                    },
                    runtime_artifact_dir=str(runtime_dir),
                    log=lambda _: None,
                )

            self.assertEqual(work_dirs, [runtime_dir / "_pdf_work" / "pdf_001"])

    def test_finalize_prepare_upload_package_preserves_pdf_when_screenshot_unavailable(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            pdf_file = runtime_dir / "runtime-tag.pdf"
            exported = base / "summary.xlsx"
            pdf_file.write_bytes(b"%PDF-fake")
            exported.write_bytes(b"excel")

            with patch(
                "core.shenhui_pdf_screenshot.convert_pdf_to_yq_images",
                return_value=[],
            ), patch(
                "core.shenhui_pdf_screenshot.extract_pdf_text",
                return_value="",
            ):
                result = _finalize_shenhui_new_arrival_outputs(
                    task_id="prepare_upload_package",
                    data_rows=[{
                        "输入款号": "208226103201",
                        "输入编码": "208226103201",
                        "素材来源": "静物图",
                        "文件名": "208226103201吊牌.pdf",
                        "下载结果": "已下载",
                        "本地文件": str(pdf_file),
                        "__shenhui_group_code": "208226103201",
                        "__shenhui_asset_role": "pdf_yq",
                        "__package_filename": "208226103201吊牌.pdf",
                        "__pdf_path": str(pdf_file),
                        "__pdf_type": "hang_tag",
                        "__style_code": "208226103201",
                    }],
                    runtime_files=[str(pdf_file)],
                    exported_files=[str(exported)],
                    run_params={"package_name": "深绘测试图包"},
                    runtime_artifact_dir=str(runtime_dir),
                    log=lambda _: None,
                )

            package_dir = Path(result[0])
            preserved_pdf = package_dir / "208226103201" / "_PDF待裁图" / "208226103201吊牌.pdf"
            self.assertTrue(preserved_pdf.is_file())
            self.assertEqual(Path(result[1]), exported)
            self.assertFalse(pdf_file.exists())


if __name__ == "__main__":
    unittest.main()
