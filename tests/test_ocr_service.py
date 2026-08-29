import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from core import ocr_service


class OcrServiceTests(unittest.TestCase):
    def _label_image(self):
        image = Image.new("RGB", (1000, 1000), (210, 190, 170))
        draw = ImageDraw.Draw(image)
        draw.rectangle((100, 100, 900, 900), fill=(248, 248, 246))
        return image, draw

    def test_refine_style_bbox_moves_product_name_row_to_following_style_row(self):
        image, draw = self._label_image()
        draw.rectangle((125, 220, 420, 262), fill=(10, 10, 10))
        draw.rectangle((125, 278, 470, 316), fill=(10, 10, 10))
        refined = ocr_service.refine_style_code_bbox(
            image=image,
            label_bbox=[0.1, 0.1, 0.9, 0.9],
            style_code_bbox=[0.18, 0.22, 0.42, 0.262],
            style_code="204325141014",
        )

        self.assertIsNotNone(refined)
        self.assertGreater(refined[1], 0.26)
        self.assertLess(refined[3], 0.34)

    def test_refine_style_bbox_keeps_top_band_style_code_row(self):
        image, draw = self._label_image()
        draw.rectangle((250, 142, 610, 188), fill=(10, 10, 10))
        draw.rectangle((110, 205, 890, 216), fill=(10, 10, 10))
        refined = ocr_service.refine_style_code_bbox(
            image=image,
            label_bbox=[0.1, 0.1, 0.9, 0.9],
            style_code_bbox=[0.25, 0.142, 0.61, 0.188],
            style_code="208426141211",
        )

        self.assertIsNotNone(refined)
        self.assertLess(refined[1], 0.20)
        self.assertGreater(refined[3], 0.17)

    def test_refine_style_bbox_ignores_suspicious_middle_anchor_for_top_style_row(self):
        image, draw = self._label_image()
        draw.rectangle((330, 150, 680, 195), fill=(10, 10, 10))
        draw.rectangle((100, 310, 900, 510), fill=(10, 10, 10))
        refined = ocr_service.refine_style_code_bbox(
            image=image,
            label_bbox=[0.1, 0.1, 0.9, 0.9],
            style_code_bbox=[0.1, 0.31, 0.9, 0.51],
            style_code="208426141211",
        )

        self.assertIsNotNone(refined)
        self.assertLess(refined[1], 0.22)
        self.assertLess(refined[2] - refined[0], 0.45)

    def test_tesseract_status_reports_project_level_package_name(self):
        status = ocr_service.project_tesseract_status()

        self.assertEqual(status["package"], "tesseract.js")
        self.assertIn("available", status)
        self.assertIn("node_modules", status)

    def test_extract_shoe_label_fields_preserves_full_printed_color_name(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "shoe-box.jpg"
            Image.new("RGB", (1200, 800), "white").save(image_path)
            with patch.object(
                ocr_service,
                "recognize_image_with_tesseract_js",
                return_value={
                    "text": (
                        "产 品 名 称 : 婴 童 学 步 鞋\n"
                        "颜 色 : 梦 幻 粉 60301\n"
                    ),
                    "confidence": 94,
                    "words": [],
                },
            ):
                fields = ocr_service.extract_shoe_label_fields(
                    image_path,
                    label_bbox=(0.05, 0.05, 0.95, 0.95),
                    expected_color_code="60301",
                )

        self.assertEqual(fields["color_name"], "梦幻粉60301")
        self.assertEqual(fields["product_name"], "婴童学步鞋")
        self.assertEqual(fields["source"], "local_tesseract_explicit_label_field")

    def test_extract_shoe_label_fields_preserves_observed_text_when_color_is_missing(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            image_path = Path(tmpdir) / "shoe-box.jpg"
            Image.new("RGB", (1200, 800), "white").save(image_path)
            with patch.object(
                ocr_service,
                "recognize_image_with_tesseract_js",
                return_value={
                    "text": "balabala 204426146023\n产品名称: 婴童稳步鞋",
                    "confidence": 59,
                    "words": [],
                },
            ):
                fields = ocr_service.extract_shoe_label_fields(
                    image_path,
                    label_bbox=(0.05, 0.05, 0.95, 0.95),
                    expected_color_code="00355",
                )

        self.assertEqual(fields["color_name"], "")
        self.assertEqual(fields["product_name"], "婴童稳步鞋")
        self.assertIn("204426146023", fields["observed_text"])
        self.assertEqual(fields["confidence"], 59)
