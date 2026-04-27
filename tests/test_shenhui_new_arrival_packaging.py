import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch

import yaml

from core.api_server import _finalize_shenhui_new_arrival_outputs

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "adapters" / "shenhui-new-arrival" / "manifest.yaml"


class ShenhuiNewArrivalPackagingTests(unittest.TestCase):
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

    def test_finalize_outputs_groups_images_by_style_code(self):
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

            self.assertEqual(len(result), 3)
            style_zip_path = Path(result[0])
            zip_path = Path(result[1])
            self.assertTrue(style_zip_path.is_file())
            self.assertEqual(style_zip_path.name, "208226103201.zip")
            self.assertTrue(zip_path.is_file())
            self.assertEqual(Path(result[2]), exported)

            with zipfile.ZipFile(zip_path) as archive:
                names = archive.namelist()
                self.assertTrue(any(name.endswith("深绘测试图包/208226103201/balaBR05106-72904_P.jpg") for name in names))
                self.assertTrue(any(name.endswith("深绘测试图包/208226103201/yq.jpg") for name in names))

            with zipfile.ZipFile(style_zip_path) as archive:
                names = archive.namelist()
                self.assertIn("balaBR05106-72904_P.jpg", names)
                self.assertIn("yq.jpg", names)

            self.assertFalse(model_file.exists())
            self.assertFalse(yq_file.exists())
            self.assertFalse((runtime_dir / "深绘测试图包").exists())

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


if __name__ == "__main__":
    unittest.main()
