"""Strategy routing and fail-closed boundaries for local shoe recognition."""

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from core import shenhui_shoe_packaging as packaging
from core import shenhui_shoe_specialist as specialist


class SpecialistTests(unittest.TestCase):
    def test_vision_coordinates_use_exporter_contract(self):
        from core.shoe_specialist.identity import packaging_bbox

        original = [0.25, 0.3, 0.65, 0.4]
        self.assertEqual(
            packaging._normalized_bbox(packaging_bbox(original)), tuple(original)
        )
        with self.assertRaises(ValueError):
            packaging_bbox([250, 300, 650, 400])

    def test_identity_rejects_other_style_or_color(self):
        from core.shoe_specialist.identity import verify

        text = ["204426141117", "颜色 卡其50601"]
        self.assertTrue(verify(text, "204426141117", "50601")["passed"])
        self.assertFalse(verify(text, "204426141117", "90001")["passed"])
        self.assertFalse(verify(text, "204426141118", "50601")["passed"])
        self.assertFalse(
            verify(text + ["204426141118"], "204426141117", "50601")["passed"]
        )

    def test_verified_tmq_never_invokes_system_ocr(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "label.png"
            Image.new("RGB", (800, 800), "white").save(source)
            with (
                patch.object(packaging.ocr_service, "locate_exact_style_code_bbox", side_effect=AssertionError("system OCR")),
                patch.object(packaging.ocr_service, "refine_style_code_bbox", side_effect=AssertionError("system OCR")),
            ):
                target = packaging._create_tmq_asset(
                    source=source, target=Path(directory) / "tmq.jpg",
                    label_bbox=[100, 100, 900, 900], style_code_bbox=[200, 200, 600, 250],
                    style_code="204426141117", style_code_bbox_verified=True,
                )
                self.assertTrue(target.is_file())
                with self.assertRaises(packaging.ShoeSelectionError):
                    packaging._create_tmq_asset(source=source, target=target, style_code_bbox_verified=True)

    def test_strategy_routes_before_model_review(self):
        with (
            patch.object(specialist, "prepare", return_value=([], {})) as run,
            patch.object(
                packaging,
                "_prepare_shoe_packages_initial",
                side_effect=AssertionError("LLM route"),
            ),
        ):
            self.assertEqual(
                packaging.prepare_shoe_packages_skip_failed_styles(
                    pose_strategy="bala_specialist",
                    data_rows=[],
                    output_root="/tmp/no-write",
                ),
                ([], {}),
            )
            self.assertEqual(run.call_args.kwargs["pose_strategy"], "bala_specialist")

    def test_missing_resources_fail_without_fallback(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaisesRegex(
                packaging.ShoeSelectionError, "不会自动调用大模型"
            ):
                specialist.prepare(data_rows=[], output_root=d, specialist_bundle=d)

    def test_unknown_category_rejected_before_worker(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "bundle.json").write_text("{}")
            (root / "shoe-ocr").touch()
            src = root / "source.jpg"
            src.touch()
            row = {
                "输入款号": "204426141117",
                "颜色": "50601",
                "下载结果": "已下载",
                "本地文件": str(src),
                "原文件名": "source.jpg",
            }
            with patch(
                "subprocess.Popen", side_effect=AssertionError("Must not launch")
            ):
                with self.assertRaisesRegex(
                    packaging.ShoeSelectionError, "品类表明确填写"
                ):
                    specialist.prepare(
                        data_rows=[row],
                        output_root=d,
                        specialist_bundle=d,
                        specialist_python=__file__,
                    )

    def test_cross_style_source_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            (root / "bundle.json").write_text("{}")
            (root / "shoe-ocr").touch()
            src = root / "source.jpg"
            src.touch()
            row = {
                "输入款号": "204426141117",
                "颜色": "50601",
                "下载结果": "已下载",
                "本地文件": str(src),
                "原文件名": "source.jpg",
                "云盘路径": "/204426140052/50601/source.jpg",
            }
            with self.assertRaisesRegex(packaging.ShoeSelectionError, "路径身份不匹配"):
                specialist.prepare(
                    data_rows=[row],
                    output_root=d,
                    specialist_bundle=d,
                    specialist_python=__file__,
                    shoe_categories={"204426141117": "运动"},
                )


if __name__ == "__main__":
    unittest.main()
