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

    def test_verified_narrow_style_box_does_not_expand_into_adjacent_color(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'label.png'
            Image.new('RGB', (800,800), 'white').save(source)
            target = packaging._create_tmq_asset(
                source=source, target=Path(directory)/'tmq.jpg',
                label_bbox=[100,100,900,900], style_code_bbox=[200,400,300,450],
                style_code='208127146006', style_code_bbox_verified=True)
            with Image.open(target) as image:
                xs=[x for y in range(image.height) for x in range(image.width)
                    if (lambda c:c[0]>180 and c[1]<90 and c[2]<90)(image.getpixel((x,y)))]
            self.assertTrue(xs)
            self.assertLess(max(xs)-min(xs),110)

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


def test_unfinished_background_abstains_without_shifting_slots(tmp_path):
    from PIL import Image, ImageDraw
    gray = tmp_path / 'gray.png'
    raw = tmp_path / 'raw.png'
    im = Image.new('RGB', (200, 200), (242, 242, 242))
    ImageDraw.Draw(im).rectangle((50, 60, 150, 150), fill='brown')
    im.save(gray)
    im = Image.new('RGB', (200, 200), (220, 219, 225))
    ImageDraw.Draw(im).rectangle((50, 60, 150, 150), fill='brown')
    im.save(raw)
    slots = {**{f'tmz{i}': 'gray' for i in range(1,6)},
             'tmz4': 'raw', 'wpz': ['gray']*3+['raw','gray','gray'],
             'yq': ['gray']*3, 'tms': 'gray', 'yx': 'gray', 'o': 'gray'}
    specialist._reject_unfinished_pose_sources(slots, {'gray': {'path': gray}, 'raw': {'path': raw}}, '休闲')
    assert slots['tmz4'] == '' and slots['wpz'][3] == ''
    assert slots['wpz'][4:] == ['gray', 'gray']
    assert slots['_rejected_pose_sources'][0]['filename'] == 'raw'
    assignments, warnings = packaging.build_output_assignments({'color': slots})
    assert not any(r['slot'] in ('tmz4', 'wpz4') for r in assignments)
    assert any(r['slot'] == 'wpz6' for r in assignments)
    assert any(r['slot'] == 'tmz4' for r in warnings)


def test_truncated_source_is_isolated_without_global_pillow_override(tmp_path):
    from PIL import Image, ImageFile
    good = tmp_path / 'good.jpg'
    bad = tmp_path / 'bad.jpg'
    Image.new('RGB', (100, 100), 'red').save(good)
    bad.write_bytes(good.read_bytes()[:-30])
    previous = ImageFile.LOAD_TRUNCATED_IMAGES
    failures = specialist._unreadable_sources([{'path': good}, {'path': bad}])
    assert set(failures) == {str(bad.resolve())}
    assert ImageFile.LOAD_TRUNCATED_IMAGES == previous
