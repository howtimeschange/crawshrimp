import tempfile
import unittest
import asyncio
from pathlib import Path
from unittest.mock import patch

import yaml

from core import data_sink, runtime_paths
from core.api_server import (
    _apply_bala_ai_face_background_generate,
    _cleanup_orphaned_runtime_artifacts,
    _finalize_bala_ai_video_assistant_outputs,
    _load_bala_model_library,
    _bala_models_for_generation,
)

ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "adapters" / "bala-ai-video-assistant" / "manifest.yaml"


class BalaAiVideoAssistantPackagingTests(unittest.TestCase):
    def test_manifest_declares_material_prepare_task(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))

        self.assertEqual(manifest["id"], "bala-ai-video-assistant")
        task = next(item for item in manifest["tasks"] if item["id"] == "semir_video_material_prepare")

        self.assertEqual(task["script"], "semir-video-material-prepare.js")
        self.assertEqual(task["skip_auth"], False)
        params = {item["id"]: item for item in task["params"]}
        self.assertEqual(params["item_codes"]["type"], "textarea")
        self.assertEqual(params["cloud_path"]["default"], "巴拉营运BU-商品//巴拉货控/02 产品上新模块/2-2 巴拉产品上新/")
        self.assertEqual(params["max_image_mb"]["default"], 20)
        self.assertNotIn("auto_zip_package", params)

    def test_manifest_declares_face_background_generation_task(self):
        manifest = yaml.safe_load(MANIFEST_PATH.read_text(encoding="utf-8"))

        task = next(item for item in manifest["tasks"] if item["id"] == "bala_ai_face_background_generate")

        self.assertEqual(task["script"], "bala-ai-face-background-generate.js")
        self.assertEqual(task["entry_url"], "about:blank")
        self.assertEqual(task["skip_auth"], True)
        params = {item["id"]: item for item in task["params"]}
        self.assertEqual(params["source_images"]["type"], "file_images")
        self.assertEqual(params["material_root"]["include_file_listing"], True)
        self.assertEqual(params["background_prompt"]["default"], "换成马尔代夫的海边")
        self.assertEqual(params["model_key_tier"]["default"], "4k")
        self.assertIn("100女", params["model_groups"]["default"])
        output_columns = task["output"][0]["columns"]
        self.assertIn("AI任务UID", output_columns)
        self.assertIn("轮询URL", output_columns)

    def test_model_library_manifest_is_packaged_and_group_selects_standard_first(self):
        manifest_path = ROOT / "adapters" / "bala-ai-video-assistant" / "assets" / "model-library" / "manifest.json"

        with patch("core.adapter_loader.resolve_adapter_file", return_value=manifest_path):
            library, errors = _load_bala_model_library()
            models, warnings = _bala_models_for_generation({"model_groups": ["100女"], "models_per_group": 1})

        self.assertFalse(errors)
        self.assertGreaterEqual(len(library), 70)
        self.assertFalse(warnings)
        self.assertEqual(len(models), 1)
        self.assertEqual(models[0]["id"], "100女/标准.jpg")
        self.assertTrue(Path(models[0]["path"]).is_file())

    def test_apply_face_background_creates_ai_image_job_with_source_and_model_assets(self):
        manifest_path = ROOT / "adapters" / "bala-ai-video-assistant" / "assets" / "model-library" / "manifest.json"

        async def wait_for_control(_status=None):
            return None

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            data_root = base / "data"
            source = base / "208326102205" / "01_模拍原图" / "model.jpg"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"fake jpg")

            with patch.dict("os.environ", {"CRAWSHRIMP_DATA": str(data_root)}, clear=False):
                runtime_paths.reset_runtime_data_root_cache()
                data_sink.init_db()
                with patch("core.adapter_loader.resolve_adapter_file", return_value=manifest_path):
                    rows = asyncio.run(_apply_bala_ai_face_background_generate(
                        {
                            "source_images": {"paths": [str(source)]},
                            "model_ref_ids": "100女/标准.jpg",
                            "background_prompt": "换成马尔代夫的海边",
                            "generation_mode": "create_only",
                            "model_key_tier": "4k",
                            "image_size": "1536x2048",
                            "quality": "high",
                        },
                        wait_for_control,
                        lambda _message: None,
                    ))

                self.assertEqual(len(rows), 1)
                row = rows[0]
                self.assertEqual(row["执行结果"], "已创建")
                self.assertEqual(row["提交状态"], "已创建，未提交")
                self.assertEqual(row["款号"], "208326102205")
                self.assertEqual(row["模特ID"], "100女/标准.jpg")
                job = data_sink.get_ai_image_job(row["AI任务UID"])
                self.assertIsNotNone(job)
                self.assertIn("马尔代夫", job["prompt"])
                self.assertEqual(job["params"]["main_image_path"], str(source.resolve(strict=False)))
                self.assertEqual(job["params"]["model_key_tier"], "4k")
                self.assertEqual(job["params"]["reference_image_paths"][0], str((manifest_path.parent / "100女" / "标准.jpg").resolve(strict=False)))
                assets = data_sink.list_ai_image_assets(row["AI任务UID"])
                self.assertEqual([asset["kind"] for asset in assets], ["main", "reference"])

            runtime_paths.reset_runtime_data_root_cache()

    def test_apply_face_background_records_async_submission_handles(self):
        manifest_path = ROOT / "adapters" / "bala-ai-video-assistant" / "assets" / "model-library" / "manifest.json"

        async def wait_for_control(_status=None):
            return None

        def fake_submit(job_uid, prompts, request_uid=""):
            return {
                "accepted": True,
                "batch_uid": "batch-1",
                "runs": [{
                    "run_uid": "run-1",
                    "task_id": "task-1",
                    "poll_url": "https://poll.example/task-1",
                    "error": "",
                }],
            }

        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            data_root = base / "data"
            source = base / "208326102205" / "01_模拍原图" / "model.jpg"
            source.parent.mkdir(parents=True)
            source.write_bytes(b"fake jpg")

            with patch.dict("os.environ", {"CRAWSHRIMP_DATA": str(data_root)}, clear=False):
                runtime_paths.reset_runtime_data_root_cache()
                data_sink.init_db()
                with patch("core.adapter_loader.resolve_adapter_file", return_value=manifest_path), \
                        patch("core.ai_image_service.submit_workbench_batch", side_effect=fake_submit):
                    rows = asyncio.run(_apply_bala_ai_face_background_generate(
                        {
                            "source_images": {"paths": [str(source)]},
                            "model_ref_ids": "100女/标准.jpg",
                            "background_prompt": "换成马尔代夫的海边",
                            "generation_mode": "submit_async",
                        },
                        wait_for_control,
                        lambda _message: None,
                    ))

                self.assertEqual(rows[0]["执行结果"], "已提交")
                self.assertEqual(rows[0]["提交状态"], "已异步提交")
                self.assertEqual(rows[0]["批次UID"], "batch-1")
                self.assertEqual(rows[0]["运行UID"], "run-1")
                self.assertEqual(rows[0]["1XM任务ID"], "task-1")
                self.assertEqual(rows[0]["轮询URL"], "https://poll.example/task-1")

            runtime_paths.reset_runtime_data_root_cache()

    def test_finalize_material_prepare_groups_images_without_zip_by_default(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            model_file = runtime_dir / "runtime-model.jpg"
            detail_file = runtime_dir / "runtime-detail.jpg"
            model_file.write_bytes(b"model")
            detail_file.write_bytes(b"detail")

            exported = base / "summary.xlsx"
            exported.write_bytes(b"excel")

            result = _finalize_bala_ai_video_assistant_outputs(
                task_id="semir_video_material_prepare",
                data_rows=[
                    {
                        "输入款号": "208326102205",
                        "输入编码": "208326102205",
                        "素材来源": "模拍图",
                        "文件名": "model.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(model_file),
                        "__bala_group_code": "208326102205",
                        "__bala_source_type": "model",
                        "__package_filename": "model.jpg",
                        "__compress_threshold_bytes": 20 * 1024 * 1024,
                    },
                    {
                        "输入款号": "208326102205",
                        "输入编码": "208326102205",
                        "素材来源": "商品细节图",
                        "文件名": "detail.jpg",
                        "下载结果": "已下载",
                        "本地文件": str(detail_file),
                        "__bala_group_code": "208326102205",
                        "__bala_source_type": "detail",
                        "__package_filename": "detail.jpg",
                        "__compress_threshold_bytes": 20 * 1024 * 1024,
                    },
                ],
                runtime_files=[str(model_file), str(detail_file)],
                exported_files=[str(exported)],
                run_params={"package_name": "巴拉视频素材测试"},
                runtime_artifact_dir=str(runtime_dir),
                log=lambda _: None,
            )

            self.assertEqual(len(result), 2)
            package_dir = Path(result[0])
            self.assertTrue(package_dir.is_dir())
            self.assertEqual(package_dir.name, "巴拉视频素材测试")
            self.assertEqual(Path(result[1]), exported)
            self.assertTrue((package_dir / "208326102205" / "01_模拍原图" / "model.jpg").is_file())
            self.assertTrue((package_dir / "208326102205" / "02_商品细节图" / "detail.jpg").is_file())
            self.assertFalse(any(path.suffix == ".zip" for path in package_dir.parent.iterdir() if path.is_file()))
            self.assertFalse(model_file.exists())
            self.assertFalse(detail_file.exists())

    def test_finalize_material_prepare_invokes_compression_for_downloaded_images(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "runtime"
            runtime_dir.mkdir()

            image_file = runtime_dir / "runtime-model.jpg"
            image_file.write_bytes(b"large-image")

            def fake_compress(path, threshold_bytes, log):
                compressed = path.with_name("model-compressed.jpg")
                compressed.write_bytes(b"small")
                path.unlink()
                return compressed, "已压缩：测试"

            rows = [
                {
                    "输入款号": "208326102205",
                    "输入编码": "208326102205",
                    "素材来源": "模拍图",
                    "文件名": "model.png",
                    "下载结果": "已下载",
                    "本地文件": str(image_file),
                    "__bala_group_code": "208326102205",
                    "__bala_source_type": "model",
                    "__package_filename": "model.png",
                    "__compress_threshold_bytes": 1,
                }
            ]

            with patch("core.api_server._compress_bala_video_image_if_needed", side_effect=fake_compress) as mocked:
                result = _finalize_bala_ai_video_assistant_outputs(
                    task_id="semir_video_material_prepare",
                    data_rows=rows,
                    runtime_files=[str(image_file)],
                    exported_files=[],
                    run_params={"package_name": "巴拉视频素材压缩测试"},
                    runtime_artifact_dir=str(runtime_dir),
                    log=lambda _: None,
                )

            mocked.assert_called_once()
            package_dir = Path(result[0])
            self.assertTrue((package_dir / "208326102205" / "01_模拍原图" / "model-compressed.jpg").is_file())
            self.assertEqual(rows[0]["本地文件"], str(package_dir / "208326102205" / "01_模拍原图" / "model-compressed.jpg"))
            self.assertEqual(rows[0]["压缩结果"], "已压缩：测试")
            self.assertEqual(rows[0]["文件名"], "model-compressed.jpg")

    def test_orphan_cleanup_includes_bala_video_runtime(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base = Path(tmpdir)
            runtime_dir = base / "data" / "bala-ai-video-assistant" / "semir_video_material_prepare" / "runtime" / "100"
            runtime_dir.mkdir(parents=True)
            stale = runtime_dir / "stale.jpg"
            stale.write_bytes(b"stale")

            def fake_artifact_dir_path(adapter_id, task_id, run_id, kind):
                self.assertEqual(adapter_id, "bala-ai-video-assistant")
                self.assertEqual(task_id, "semir_video_material_prepare")
                self.assertEqual(run_id, 100)
                self.assertEqual(kind, "runtime")
                return runtime_dir

            with patch("core.data_sink.artifact_dir_path", side_effect=fake_artifact_dir_path):
                _cleanup_orphaned_runtime_artifacts([
                    {
                        "id": 100,
                        "adapter_id": "bala-ai-video-assistant",
                        "task_id": "semir_video_material_prepare",
                    }
                ])

            self.assertFalse(stale.exists())


if __name__ == "__main__":
    unittest.main()
