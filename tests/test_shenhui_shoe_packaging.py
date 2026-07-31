import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from core import shenhui_shoe_packaging


class ShenhuiShoePackagingRuleTests(unittest.TestCase):
    def test_excel_category_aliases_are_normalized_to_template_categories(self):
        aliases = {
            "运动鞋": "运动",
            "板鞋": "运动",
            "公主鞋": "休闲",
            "皮鞋": "休闲",
            "女生凉鞋": "休闲",
            "雪地靴": "雪地",
            "秋冬拖鞋": "雪地",
            "运动靴": "雪地",
            "宝宝鞋": "婴童",
            "婴童鞋": "婴童",
        }

        for input_category, expected in aliases.items():
            self.assertEqual(
                shenhui_shoe_packaging.normalize_shoe_category(input_category),
                expected,
            )

    def test_excel_category_rows_are_parsed_and_conflicts_are_rejected(self):
        parsed = shenhui_shoe_packaging.parse_shoe_category_rows(
            [
                {"款号": 208326146209, "品类": "宝宝鞋"},
                {"款号": "204325141014", "品类": "公主鞋"},
                {"款号": "208426141211", "品类": "雪地靴"},
            ]
        )
        self.assertEqual(
            parsed,
            {
                "208326146209": "婴童",
                "204325141014": "休闲",
                "208426141211": "雪地",
            },
        )

        with self.assertRaisesRegex(
            shenhui_shoe_packaging.ShoeSelectionError,
            "不支持的鞋品品类",
        ):
            shenhui_shoe_packaging.parse_shoe_category_rows(
                [{"款号": "204326141005", "品类": "未知鞋"}]
            )

        with self.assertRaisesRegex(
            shenhui_shoe_packaging.ShoeSelectionError,
            "重复且品类冲突",
        ):
            shenhui_shoe_packaging.parse_shoe_category_rows(
                [
                    {"款号": "204326141005", "品类": "运动鞋"},
                    {"款号": "204326141005", "品类": "宝宝鞋"},
                ]
            )

    def test_excel_category_overrides_model_and_missing_mapping_warns(self):
        category, source, warning = shenhui_shoe_packaging.resolve_style_category(
            "208326146209",
            "运动",
            {"208326146209": "婴童"},
        )
        self.assertEqual((category, source, warning), ("婴童", "Excel指定", ""))

        category, source, warning = shenhui_shoe_packaging.resolve_style_category(
            "208326146209",
            "运动",
            {"204325141014": "休闲"},
        )
        self.assertEqual(category, "运动")
        self.assertEqual(source, "模型兜底")
        self.assertIn("款号未匹配", warning)

    def test_baby_shoe_prompt_requires_front_facing_pair_for_pose_five(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "208326146209",
            "00316",
            {"I01": "candidate.jpg"},
            "婴童",
        )

        self.assertIn("两只鞋左右对称并排，两个鞋头都正面朝向镜头", prompt)
        self.assertIn("不允许选择两只鞋斜向45度", prompt)

    def test_prompt_rejects_insole_and_single_shoe_for_pose_two_and_five(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "208326146209",
            "00316",
            {"I01": "candidate.jpg"},
            "婴童",
        )

        self.assertIn(
            "所有品类的 tmz2/wpz2 都必须是：前方一只完整鞋",
            prompt,
        )
        self.assertIn("后方另一只完整鞋的鞋底朝向镜头", prompt)
        self.assertIn("tmz5/wpz5 都必须完整展示两只鞋", prompt)
        self.assertIn("禁止鞋垫、单鞋、单独鞋底、局部特写", prompt)

    def test_prompt_spells_out_new_shared_main_pose_one(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "204325141014",
            "90001",
            {"I01": "candidate.jpg"},
            "休闲",
        )

        self.assertIn("第三张图是新版主图1参考姿势", prompt)
        self.assertIn("tmz1/wpz1 必须使用第三张参考图的新版主图1", prompt)
        self.assertIn("适用于所有平台", prompt)
        self.assertIn("非主推色不输出 o.jpg", prompt)
        self.assertIn("主推色云盘中已经命名为 yk1..ykN", prompt)
        self.assertIn("休闲第5姿势不要选择两只鞋竖向上下分开", prompt)

    def test_prompt_spells_out_shared_pose_three_and_snow_pose_four(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "208426141211",
            "00377",
            {"I01": "candidate.jpg"},
            "雪地",
        )

        self.assertIn("tmz3/wpz3", prompt)
        self.assertIn("单只鞋竖立或悬立", prompt)
        self.assertIn("不能选择正常平放的侧视图", prompt)
        self.assertIn("tmz4/wpz4 必须按品类区分", prompt)
        self.assertIn("运动是后侧斜悬且鞋底朝镜头", prompt)
        self.assertIn("休闲是完整后侧面", prompt)
        self.assertIn("雪地是完整鞋口内里图", prompt)
        self.assertIn("不能只裁到鞋面或鞋头", prompt)
        self.assertIn("婴童是单鞋后侧角度", prompt)
        self.assertIn("鞋面/鞋头局部裁切图", prompt)
        self.assertIn("会从正确的雪地第4姿势鞋口内里图裁切生成 yk1", prompt)

    def test_non_pose_images_are_excluded_while_yk_sources_remain_candidates(self):
        self.assertFalse(
            shenhui_shoe_packaging._is_pose_selection_candidate(
                "208326146209-00317+Ai角度图2.png"
            )
        )
        self.assertFalse(
            shenhui_shoe_packaging._is_pose_selection_candidate(
                "208426141211-00377.jpg"
            )
        )
        self.assertFalse(
            shenhui_shoe_packaging._is_pose_matching_candidate(
                "208426141211-00377.jpg"
            )
        )
        self.assertTrue(
            shenhui_shoe_packaging._is_pose_selection_candidate("yk2.jpg")
        )
        self.assertTrue(
            shenhui_shoe_packaging._is_pose_selection_candidate("GUDG5998.jpg")
        )

    def test_ai_angle_images_can_be_reintroduced_for_snow_quality_rules(self):
        base_entries = [
            {"filename": "GD009191.jpg"},
        ]
        all_entries = [
            {"filename": "GD009191.jpg"},
            {"filename": "208426141211-00377+Ai角度图1.png"},
            {"filename": "208426141211-00377.jpg"},
        ]

        filenames = [
            entry["filename"]
            for entry in shenhui_shoe_packaging._entries_with_ai_angle_images(
                base_entries,
                all_entries,
            )
        ]

        self.assertEqual(
            filenames,
            [
                "GD009191.jpg",
                "208426141211-00377+Ai角度图1.png",
            ],
        )

    def test_original_asset_targets_keep_source_folder_for_duplicate_names(self):
        entries = [
            {
                "filename": "204325141014-90001+Ai角度图1.png",
                "row": {
                    "云盘路径": "鞋品/204325141014/90001/30/204325141014-90001+Ai角度图1.png"
                },
            },
            {
                "filename": "204325141014-90001+Ai角度图1.png",
                "row": {
                    "云盘路径": "鞋品/204325141014/90001/36/204325141014-90001+Ai角度图1.png"
                },
            },
            {
                "filename": "00044152.jpg",
                "row": {"云盘路径": "鞋品/204325141014/90001/30/00044152.jpg"},
            },
        ]

        targets = shenhui_shoe_packaging._original_asset_relative_targets(entries)

        self.assertEqual(
            targets,
            [
                Path("30/204325141014-90001+Ai角度图1.png"),
                Path("36/204325141014-90001+Ai角度图1.png"),
                Path("00044152.jpg"),
            ],
        )

    def test_binary_contour_match_ranks_same_pose_ahead_of_different_pose(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            def draw_pair(path: Path, color: tuple[int, int, int], *, sole_up: bool):
                image = Image.new("RGB", (320, 220), (244, 244, 244))
                draw = ImageDraw.Draw(image)
                draw.rounded_rectangle((48, 104, 190, 165), 24, fill=color)
                if sole_up:
                    draw.rounded_rectangle((205, 42, 258, 154), 22, fill=color)
                else:
                    draw.rounded_rectangle((172, 108, 292, 164), 24, fill=color)
                image.save(path, quality=92)

            anchor = root / "anchor.jpg"
            same_pose = root / "same-pose.jpg"
            different_pose = root / "different-pose.jpg"
            draw_pair(anchor, (140, 30, 70), sole_up=True)
            draw_pair(same_pose, (40, 100, 190), sole_up=True)
            draw_pair(different_pose, (40, 100, 190), sole_up=False)

            ranked = shenhui_shoe_packaging._rank_binary_contour_matches(
                anchor,
                [
                    {"filename": different_pose.name, "path": different_pose},
                    {"filename": same_pose.name, "path": same_pose},
                ],
            )

        self.assertEqual(ranked[0][0], "same-pose.jpg")
        self.assertLess(ranked[0][1], ranked[1][1])

    def test_cross_color_matching_allows_bare_yk_sources_to_match_pose_slots(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            anchor = root / "anchor.jpg"
            target_pose = root / "target-pose.jpg"
            bare_detail = root / "1.jpg"

            for path, color in (
                (anchor, (120, 30, 80)),
                (target_pose, (30, 90, 180)),
                (bare_detail, (120, 30, 80)),
            ):
                image = Image.new("RGB", (320, 220), (244, 244, 244))
                draw = ImageDraw.Draw(image)
                draw.rounded_rectangle((48, 104, 190, 165), 24, fill=color)
                draw.rounded_rectangle((205, 42, 258, 154), 22, fill=color)
                image.save(path, quality=92)

            matched, _worst_distance = (
                shenhui_shoe_packaging._match_slots_from_anchor_color(
                    anchor_slots={
                        **{
                            f"tmz{index}": anchor.name
                            for index in range(1, 6)
                        },
                        "wpz": [],
                        "yq": [],
                        "yx": "",
                    },
                    anchor_entries=[
                        {"filename": anchor.name, "path": anchor},
                    ],
                    target_entries=[
                        {"filename": bare_detail.name, "path": bare_detail},
                        {"filename": target_pose.name, "path": target_pose},
                    ],
                )
            )

        self.assertEqual(
            [matched[f"tmz{index}"] for index in range(1, 6)],
            [bare_detail.name] * 5,
        )

    def test_yx_layout_match_prefers_same_function_tag_layout(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            def draw_boot(
                path: Path,
                color: tuple[int, int, int],
                *,
                with_function_tags: bool,
            ):
                image = Image.new("RGB", (400, 300), (246, 246, 246))
                draw = ImageDraw.Draw(image)
                draw.rounded_rectangle((105, 105, 305, 220), 30, fill=color)
                draw.rectangle((195, 65, 305, 155), fill=color)
                if with_function_tags:
                    draw.polygon(
                        ((155, 205), (185, 155), (215, 205)),
                        fill=(250, 194, 30),
                    )
                    draw.polygon(
                        ((225, 205), (255, 155), (285, 205)),
                        fill=(232, 232, 226),
                    )
                image.save(path, quality=92)

            anchor = root / "anchor-yx.jpg"
            ordinary = root / "ordinary-shoe.jpg"
            tagged = root / "tagged-shoe.jpg"
            draw_boot(anchor, (125, 95, 135), with_function_tags=True)
            draw_boot(ordinary, (170, 125, 70), with_function_tags=False)
            draw_boot(tagged, (170, 125, 70), with_function_tags=True)

            ranked = shenhui_shoe_packaging._rank_yx_layout_matches(
                anchor,
                [
                    {"filename": ordinary.name, "path": ordinary},
                    {"filename": tagged.name, "path": tagged},
                ],
            )
            matched, _worst_distance = (
                shenhui_shoe_packaging._match_slots_from_anchor_color(
                    anchor_slots={
                        **{
                            f"tmz{index}": anchor.name
                            for index in range(1, 6)
                        },
                        "wpz": [anchor.name],
                        "yq": [],
                        "yx": anchor.name,
                    },
                    anchor_entries=[
                        {"filename": anchor.name, "path": anchor},
                    ],
                    target_entries=[
                        {"filename": ordinary.name, "path": ordinary},
                        {"filename": tagged.name, "path": tagged},
                    ],
                )
            )

        self.assertEqual(ranked[0][0], "tagged-shoe.jpg")
        self.assertLess(ranked[0][1], ranked[1][1])
        self.assertEqual(matched["yx"], "tagged-shoe.jpg")

    def test_shoe_box_match_does_not_confuse_outsole_on_white_background(self):
        features = {
            "anchor.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.661,
                bounding_coverage=0.528,
                background_luma=217.0,
                valid=True,
            ),
            "box.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=2.133,
                bounding_coverage=0.702,
                background_luma=212.7,
                valid=True,
            ),
            "outsole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.387,
                bounding_coverage=0.390,
                background_luma=242.0,
                valid=True,
            ),
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ranked = shenhui_shoe_packaging._rank_shoe_box_matches(
                "anchor.jpg",
                [
                    {"filename": "outsole.jpg", "path": "outsole.jpg"},
                    {"filename": "box.jpg", "path": "box.jpg"},
                ],
            )

        self.assertEqual(ranked[0][0], "box.jpg")

    def test_pose_match_preserves_gray_or_white_background_variant(self):
        anchor_mask = Image.new("1", (128, 128), 0)
        gray_mask = anchor_mask.copy()
        ImageDraw.Draw(gray_mask).rectangle((0, 0, 7, 7), fill=1)
        anchor = shenhui_shoe_packaging._BinaryPoseFeature(
            mask=anchor_mask,
            aspect_ratio=1.2,
            bounding_coverage=0.2,
            background_luma=242.0,
            valid=True,
        )
        gray_candidate = shenhui_shoe_packaging._BinaryPoseFeature(
            mask=gray_mask,
            aspect_ratio=1.2,
            bounding_coverage=0.2,
            background_luma=242.0,
            valid=True,
        )
        white_candidate = shenhui_shoe_packaging._BinaryPoseFeature(
            mask=anchor_mask.copy(),
            aspect_ratio=1.2,
            bounding_coverage=0.2,
            background_luma=255.0,
            valid=True,
        )

        self.assertLess(
            shenhui_shoe_packaging._binary_pose_distance(anchor, gray_candidate),
            shenhui_shoe_packaging._binary_pose_distance(anchor, white_candidate),
        )

    def test_quality_rules_replace_invalid_sports_pose_five_with_valid_pair(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            def draw_pose(path: Path, background: int, *, horizontal: bool):
                image = Image.new("RGB", (320, 240), (background,) * 3)
                draw = ImageDraw.Draw(image)
                if horizontal:
                    draw.rounded_rectangle((90, 112, 160, 162), 16, fill=(70, 80, 90))
                    draw.rounded_rectangle((120, 65, 200, 120), 16, fill=(70, 80, 90))
                else:
                    draw.rounded_rectangle((104, 120, 174, 190), 18, fill=(70, 80, 90))
                    draw.rounded_rectangle((132, 34, 202, 104), 18, fill=(70, 80, 90))
                image.save(path)

            paths = {
                "wrong.jpg": root / "wrong.jpg",
                "wrong 拷贝.jpg": root / "wrong 拷贝.jpg",
                "correct.jpg": root / "correct.jpg",
                "correct 拷贝.jpg": root / "correct 拷贝.jpg",
            }
            draw_pose(paths["wrong.jpg"], 242, horizontal=False)
            draw_pose(paths["wrong 拷贝.jpg"], 255, horizontal=False)
            draw_pose(paths["correct.jpg"], 242, horizontal=True)
            draw_pose(paths["correct 拷贝.jpg"], 255, horizontal=True)
            entries = {
                name: {"filename": name, "path": path}
                for name, path in paths.items()
            }
            slots = {
                "tmz5": "wrong 拷贝.jpg",
                "wpz": [
                    "slot1.jpg",
                    "slot2.jpg",
                    "slot3.jpg",
                    "slot4.jpg",
                    "wrong.jpg",
                    "box.jpg",
                ],
                "yx": "",
            }

            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "运动",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz5"], "correct 拷贝.jpg")
        self.assertEqual(ruled["wpz"][4], "correct.jpg")
        self.assertTrue(any("运动第5姿势" in item for item in corrections))

    def test_quality_rules_keep_pose_but_swap_tmz_white_and_wpz_gray(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            def draw_pair(path: Path, background: int):
                image = Image.new("RGB", (320, 240), (background,) * 3)
                draw = ImageDraw.Draw(image)
                draw.rounded_rectangle((90, 112, 160, 162), 16, fill=(90, 70, 60))
                draw.rounded_rectangle((120, 65, 200, 120), 16, fill=(90, 70, 60))
                image.save(path)

            gray = root / "pose.jpg"
            white = root / "pose 拷贝.jpg"
            draw_pair(gray, 242)
            draw_pair(white, 255)
            entries = {
                gray.name: {"filename": gray.name, "path": gray},
                white.name: {"filename": white.name, "path": white},
            }
            slots = {
                "tmz5": gray.name,
                "wpz": [
                    "slot1.jpg",
                    "slot2.jpg",
                    "slot3.jpg",
                    "slot4.jpg",
                    white.name,
                    "box.jpg",
                ],
                "yx": "",
            }

            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "婴童",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz5"], white.name)
        self.assertEqual(ruled["wpz"][4], gray.name)
        self.assertTrue(any("白底/灰底" in item for item in corrections))

    def test_quality_rules_pair_tmz5_backgrounds_when_names_differ(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            def draw_pair(path: Path, background: int):
                image = Image.new("RGB", (320, 240), (background,) * 3)
                draw = ImageDraw.Draw(image)
                draw.rounded_rectangle((90, 112, 160, 162), 16, fill=(90, 70, 60))
                draw.rounded_rectangle((120, 65, 200, 120), 16, fill=(90, 70, 60))
                image.save(path)

            gray = root / "gray-source.jpg"
            white = root / "white-source.jpg"
            draw_pair(gray, 242)
            draw_pair(white, 255)
            entries = {
                gray.name: {"filename": gray.name, "path": gray},
                white.name: {"filename": white.name, "path": white},
            }
            slots = {
                "tmz5": gray.name,
                "wpz": [
                    "slot1.jpg",
                    "slot2.jpg",
                    "slot3.jpg",
                    "slot4.jpg",
                    white.name,
                    "box.jpg",
                ],
                "yx": "",
            }

            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "婴童",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz5"], white.name)
        self.assertEqual(ruled["wpz"][4], gray.name)
        self.assertTrue(any("白底/灰底" in item for item in corrections))

    def test_quality_rules_drop_closeup_without_function_card_from_yx(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            closeup = root / "closeup.jpg"
            image = Image.new("RGB", (320, 240), (242, 242, 242))
            ImageDraw.Draw(image).rectangle((5, 5, 315, 235), fill=(60, 90, 130))
            image.save(closeup)
            entries = {
                closeup.name: {"filename": closeup.name, "path": closeup},
            }
            slots = {
                "tmz5": "",
                "wpz": [],
                "yx": closeup.name,
            }

            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "婴童",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["yx"], "")
        self.assertTrue(any("yx" in item for item in corrections))

    def test_quality_rules_repair_sports_pose_one_and_outer_side_yq(self):
        features = {
            "pose1-wrong.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.70,
                bounding_coverage=0.26,
                background_luma=242.0,
                valid=True,
            ),
            "pose1-correct.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.77,
                bounding_coverage=0.23,
                background_luma=242.0,
                valid=True,
            ),
            "pose4-used.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.82,
                bounding_coverage=0.23,
                background_luma=242.0,
                valid=True,
            ),
            "yq3-closeup.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=2.08,
                bounding_coverage=0.72,
                background_luma=214.0,
                valid=True,
            ),
            "yq3-correct.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=2.12,
                bounding_coverage=0.26,
                background_luma=242.0,
                valid=True,
            ),
            "yx-valid.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=2.10,
                bounding_coverage=0.25,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "pose1-wrong.jpg",
            "tmz5": "",
            "wpz": [
                "pose1-wrong.jpg",
                "slot2.jpg",
                "slot3.jpg",
                "pose4-used.jpg",
                "",
                "box.jpg",
            ],
            "yq": ["slot-yq1.jpg", "slot-yq2.jpg", "yq3-closeup.jpg"],
            "yx": "yx-valid.jpg",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "运动",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz1"], "pose1-correct.jpg")
        self.assertEqual(ruled["wpz"][0], "pose1-correct.jpg")
        self.assertEqual(ruled["yq"][2], "yq3-correct.jpg")
        self.assertTrue(any("主图1新版" in item for item in corrections))
        self.assertTrue(any("yq3" in item for item in corrections))

    def test_quality_rules_replace_valid_snow_pose_one_with_closer_front_oblique_pose(self):
        features = {
            "rear-outsole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.78,
                bounding_coverage=0.178,
                background_luma=242.0,
                valid=True,
            ),
            "front-oblique.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.667,
                bounding_coverage=0.158,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "rear-outsole.jpg",
            "tmz5": "",
            "wpz": [
                "rear-outsole.jpg",
                "slot2.jpg",
                "slot3.jpg",
                "slot4.jpg",
                "",
                "box.jpg",
            ],
            "yq": [],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "雪地",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz1"], "front-oblique.jpg")
        self.assertEqual(ruled["wpz"][0], "front-oblique.jpg")
        self.assertTrue(any("主图1新版" in item for item in corrections))

    def test_quality_rules_keep_leisure_tmz_five_front_oblique_pair(self):
        features = {
            "overhead.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.564,
                bounding_coverage=0.078,
                background_luma=242.0,
                valid=True,
            ),
            "overhead 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.564,
                bounding_coverage=0.078,
                background_luma=255.0,
                valid=True,
            ),
            "front-oblique-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.441,
                bounding_coverage=0.343,
                background_luma=242.0,
                valid=True,
            ),
            "front-oblique-pair 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.441,
                bounding_coverage=0.343,
                background_luma=255.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz5": "overhead 拷贝.jpg",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "slot3.jpg",
                "slot4.jpg",
                "overhead.jpg",
                "box.jpg",
            ],
            "yq": [],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "休闲",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz5"], "front-oblique-pair 拷贝.jpg")
        self.assertEqual(ruled["wpz"][4], "front-oblique-pair.jpg")
        self.assertTrue(any("休闲第5张主图" in item for item in corrections))

    def test_quality_rules_prefers_business_leisure_pose_five_with_low_coverage(self):
        mask = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(mask).rectangle((24, 46, 104, 82), fill=1)
        features = {
            "00044006.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=mask.copy(),
                aspect_ratio=0.552,
                bounding_coverage=0.095,
                background_luma=242.0,
                valid=True,
            ),
            "00044006 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=mask.copy(),
                aspect_ratio=0.552,
                bounding_coverage=0.095,
                background_luma=255.0,
                valid=True,
            ),
            "2.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=mask.copy(),
                aspect_ratio=1.309,
                bounding_coverage=0.090,
                background_luma=242.0,
                valid=True,
            ),
            "00044042 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=mask.copy(),
                aspect_ratio=1.286,
                bounding_coverage=0.092,
                background_luma=255.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz5": "00044006 拷贝.jpg",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "slot3.jpg",
                "slot4.jpg",
                "00044006.jpg",
                "box.jpg",
            ],
            "yq": [],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "休闲",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz5"], "00044042 拷贝.jpg")
        self.assertEqual(ruled["wpz"][4], "2.jpg")
        self.assertTrue(any("休闲第5张主图" in item for item in corrections))

    def test_quality_rules_ignore_leisure_pose_five_without_white_pair(self):
        features = {
            "overhead.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.564,
                bounding_coverage=0.078,
                background_luma=242.0,
                valid=True,
            ),
            "overhead 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.564,
                bounding_coverage=0.078,
                background_luma=255.0,
                valid=True,
            ),
            "front-oblique-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.441,
                bounding_coverage=0.343,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz5": "front-oblique-pair.jpg",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "slot3.jpg",
                "slot4.jpg",
                "front-oblique-pair.jpg",
                "box.jpg",
            ],
            "yq": [],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "休闲",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz5"], "overhead 拷贝.jpg")
        self.assertEqual(ruled["wpz"][4], "overhead.jpg")
        self.assertTrue(any("白底/灰底" in item for item in corrections))

    def test_quality_rules_repair_sports_pose_four_from_flat_side_view(self):
        features = {
            "flat-side.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=2.12,
                bounding_coverage=0.26,
                background_luma=242.0,
                valid=True,
            ),
            "rear-outsole-angle.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.90,
                bounding_coverage=0.23,
                background_luma=242.0,
                valid=True,
            ),
            "pose3-vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.52,
                bounding_coverage=0.05,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz3": "pose3-vertical.jpg",
            "tmz4": "flat-side.jpg",
            "wpz": [
                "pose1.jpg",
                "pose2.jpg",
                "pose3-vertical.jpg",
                "flat-side.jpg",
            ],
            "yq": [],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "运动",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz4"], "rear-outsole-angle.jpg")
        self.assertEqual(ruled["wpz"][3], "rear-outsole-angle.jpg")
        self.assertTrue(any("运动第4姿势" in item for item in corrections))

    def test_quality_rules_repair_leisure_pose_four_to_rear_side_view(self):
        features = {
            "wrong-front-angle.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.84,
                bounding_coverage=0.21,
                background_luma=242.0,
                valid=True,
            ),
            "rear-side-view.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.55,
                bounding_coverage=0.078,
                background_luma=242.0,
                valid=True,
            ),
            "outer-side-view.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=2.11,
                bounding_coverage=0.19,
                background_luma=242.0,
                valid=True,
            ),
            "pose3-vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.57,
                bounding_coverage=0.044,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz3": "pose3-vertical.jpg",
            "tmz4": "wrong-front-angle.jpg",
            "wpz": [
                "pose1.jpg",
                "pose2.jpg",
                "pose3-vertical.jpg",
                "wrong-front-angle.jpg",
            ],
            "yq": ["pose2.jpg", "outsole.jpg", "outer-side-view.jpg"],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "休闲",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz4"], "rear-side-view.jpg")
        self.assertEqual(ruled["wpz"][3], "rear-side-view.jpg")
        self.assertEqual(ruled["yq"][2], "outer-side-view.jpg")
        self.assertTrue(any("休闲第4姿势" in item for item in corrections))

    def test_quality_rules_separate_baby_pose_four_from_shared_yq_three(self):
        features = {
            "wrong-outer-side.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.62,
                bounding_coverage=0.20,
                background_luma=242.0,
                valid=True,
            ),
            "rear-side-view.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.26,
                bounding_coverage=0.097,
                background_luma=242.0,
                valid=True,
            ),
            "pose3-vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.66,
                bounding_coverage=0.061,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz3": "pose3-vertical.jpg",
            "tmz4": "wrong-outer-side.jpg",
            "wpz": [
                "pose1.jpg",
                "pose2.jpg",
                "pose3-vertical.jpg",
                "wrong-outer-side.jpg",
            ],
            "yq": ["pose2.jpg", "outsole.jpg", "rear-side-view.jpg"],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "婴童",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz4"], "rear-side-view.jpg")
        self.assertEqual(ruled["wpz"][3], "rear-side-view.jpg")
        self.assertEqual(ruled["yq"][2], "wrong-outer-side.jpg")
        self.assertTrue(any("婴童第4姿势" in item for item in corrections))
        self.assertTrue(any("yq3" in item for item in corrections))

    def test_quality_rules_repair_fixed_yq_one_and_outsole_for_baby_shoes(self):
        features = {
            "pose2-front-and-sole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.40,
                bounding_coverage=0.11,
                background_luma=242.0,
                valid=True,
            ),
            "pose3-vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.66,
                bounding_coverage=0.06,
                background_luma=242.0,
                valid=True,
            ),
            "wrong-yq1.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.05,
                bounding_coverage=0.17,
                background_luma=242.0,
                valid=True,
            ),
            "wrong-side-copy.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.62,
                bounding_coverage=0.20,
                background_luma=255.0,
                valid=True,
            ),
            "yk2.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.97,
                bounding_coverage=0.15,
                background_luma=242.0,
                valid=True,
            ),
            "outer-side.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.26,
                bounding_coverage=0.10,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
            if name != "yk2.jpg"
        }
        outsole_entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz3": "pose3-vertical.jpg",
            "tmz5": "",
            "wpz": [
                "pose1.jpg",
                "pose2-front-and-sole.jpg",
                "pose3-vertical.jpg",
                "outer-side.jpg",
                "pose5.jpg",
                "box.jpg",
            ],
            "yq": [
                "wrong-yq1.jpg",
                "wrong-side-copy.jpg",
                "outer-side.jpg",
            ],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "婴童",
                    slots,
                    entries,
                    outsole_entries_by_name=outsole_entries,
                )
            )

        self.assertEqual(ruled["yq"][0], "pose2-front-and-sole.jpg")
        self.assertEqual(ruled["yq"][1], "yk2.jpg")
        self.assertTrue(any("yq1" in item for item in corrections))
        self.assertTrue(any("yq2" in item for item in corrections))

    def test_quality_rules_repair_baby_pose_three_from_flat_side_view(self):
        empty = Image.new("1", (128, 128), 0)
        vertical = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(vertical).polygon(
            [
                (43, 12),
                (69, 8),
                (83, 39),
                (74, 69),
                (91, 115),
                (57, 120),
                (48, 70),
            ],
            fill=1,
        )
        front = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(front).rectangle((34, 28, 94, 106), fill=1)
        features = {
            "flat-side.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=empty,
                aspect_ratio=1.62,
                bounding_coverage=0.20,
                background_luma=242.0,
                valid=True,
            ),
            "vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=vertical,
                aspect_ratio=0.66,
                bounding_coverage=0.06,
                background_luma=242.0,
                valid=True,
            ),
            "front-facing.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=front,
                aspect_ratio=0.63,
                bounding_coverage=0.06,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz3": "flat-side.jpg",
            "tmz5": "",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "flat-side.jpg",
                "slot4.jpg",
                "",
                "box.jpg",
            ],
            "yq": [],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "婴童",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz3"], "vertical.jpg")
        self.assertEqual(ruled["wpz"][2], "vertical.jpg")
        self.assertTrue(any("第3姿势" in item for item in corrections))

    def test_quality_rules_choose_side_vertical_pose_over_front_vertical_pose(self):
        side_vertical = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(side_vertical).polygon(
            [
                (43, 12),
                (69, 8),
                (83, 39),
                (74, 69),
                (91, 115),
                (57, 120),
                (48, 70),
            ],
            fill=1,
        )
        front_vertical = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(front_vertical).ellipse((42, 8, 86, 120), fill=1)
        features = {
            "side-vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=side_vertical,
                aspect_ratio=0.58,
                bounding_coverage=0.05,
                background_luma=242.0,
                valid=True,
            ),
            "front-vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=front_vertical,
                aspect_ratio=0.56,
                bounding_coverage=0.055,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }

        for category in ("运动", "婴童"):
            slots = {
                "tmz3": "front-vertical.jpg",
                "tmz5": "",
                "wpz": [
                    "slot1.jpg",
                    "slot2.jpg",
                    "front-vertical.jpg",
                    "slot4.jpg",
                    "",
                    "box.jpg",
                ],
                "yq": [],
                "yx": "",
            }
            with self.subTest(category=category), patch.object(
                shenhui_shoe_packaging,
                "_binary_pose_feature",
                side_effect=lambda path: features[Path(path).name],
            ):
                ruled, corrections = (
                    shenhui_shoe_packaging._apply_selection_quality_rules(
                        category,
                        slots,
                        entries,
                    )
                )

            self.assertEqual(ruled["tmz3"], "side-vertical.jpg")
            self.assertEqual(ruled["wpz"][2], "side-vertical.jpg")
            self.assertTrue(
                any("外侧竖立图" in item for item in corrections)
            )

    def test_quality_rules_repair_snow_pose_three_pair_and_lining_closeup(self):
        vertical = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(vertical).ellipse((44, 7, 83, 121), fill=1)
        wrong = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(wrong).rectangle((20, 38, 108, 92), fill=1)
        features = {
            "pose3-wrong.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=wrong,
                aspect_ratio=0.66,
                bounding_coverage=0.13,
                background_luma=242.0,
                valid=True,
            ),
            "pose3-gray.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=vertical,
                aspect_ratio=0.68,
                bounding_coverage=0.054,
                background_luma=242.0,
                valid=True,
            ),
            "pose3-white.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=vertical.copy(),
                aspect_ratio=0.65,
                bounding_coverage=0.065,
                background_luma=242.0,
                valid=True,
            ),
            "zipper-closeup.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=wrong,
                aspect_ratio=1.12,
                bounding_coverage=0.38,
                background_luma=242.0,
                valid=True,
            ),
            "lining-closeup.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=vertical,
                aspect_ratio=1.13,
                bounding_coverage=0.57,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz3": "pose3-wrong.jpg",
            "tmz4": "zipper-closeup.jpg",
            "tmz5": "",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "pose3-wrong.jpg",
                "zipper-closeup.jpg",
                "",
                "box.jpg",
            ],
            "yq": [],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "雪地",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz3"], "pose3-white.jpg")
        self.assertEqual(ruled["wpz"][2], "pose3-gray.jpg")
        self.assertEqual(ruled["tmz4"], "lining-closeup.jpg")
        self.assertEqual(ruled["wpz"][3], "lining-closeup.jpg")
        self.assertTrue(any("第3姿势" in item for item in corrections))
        self.assertTrue(any("鞋口内里" in item for item in corrections))

    def test_quality_rules_repair_snow_pose_one_from_prebuilt_vertical_angle(self):
        features = {
            "prebuilt-white-angle.jpg": (
                shenhui_shoe_packaging._BinaryPoseFeature(
                    mask=None,
                    aspect_ratio=0.49,
                    bounding_coverage=0.057,
                    background_luma=255.0,
                    valid=True,
                )
            ),
            "front-oblique-boot.jpg": (
                shenhui_shoe_packaging._BinaryPoseFeature(
                    mask=None,
                    aspect_ratio=0.67,
                    bounding_coverage=0.145,
                    background_luma=242.0,
                    valid=True,
                )
            ),
            "pose3-vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.53,
                bounding_coverage=0.05,
                background_luma=242.0,
                valid=True,
            ),
            "rear-outsole-angle.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.78,
                bounding_coverage=0.18,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "prebuilt-white-angle.jpg",
            "tmz3": "pose3-vertical.jpg",
            "tmz5": "",
            "wpz": [
                "prebuilt-white-angle.jpg",
                "pose2.jpg",
                "pose3-vertical.jpg",
                "pose4.jpg",
                "",
                "box.jpg",
            ],
            "yq": [],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features[Path(path).name],
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "雪地",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz1"], "front-oblique-boot.jpg")
        self.assertEqual(ruled["wpz"][0], "front-oblique-boot.jpg")
        self.assertTrue(any("主图1新版" in item for item in corrections))

    def test_label_ocr_uses_stable_qwen_model_during_pose_model_benchmarks(self):
        self.assertEqual(
            shenhui_shoe_packaging.SHOE_LABEL_OCR_MODEL,
            "qwen3.7-plus",
        )

    def test_missing_label_color_falls_back_to_pose_color_with_warning(self):
        color_name, warning = shenhui_shoe_packaging._resolve_label_color_name(
            current_color_name="白红色调00316",
            color_code="00316",
            label_payload={"color_name": ""},
        )

        self.assertEqual(color_name, "白红色调00316")
        self.assertIn("已沿用姿势识别颜色名", warning)

    def test_o_uses_wpz2_for_sports_and_wpz5_for_other_categories(self):
        slots = {"wpz": [f"pose-{index}.jpg" for index in range(1, 7)]}
        for category in ("运动", "休闲", "雪地", "婴童"):
            ruled = shenhui_shoe_packaging._apply_o_category_rule(
                category,
                dict(slots),
            )
            expected = "pose-2.jpg" if category == "运动" else "pose-5.jpg"
            self.assertEqual(ruled["o"], expected)

    def test_selection_requires_exactly_three_yq_images(self):
        slots = {
            "_model_id": "qwen3.7-plus",
            "tms": "tms.jpg",
            "o": "o.jpg",
            **{f"tmz{index}": f"tmz{index}.jpg" for index in range(1, 6)},
            "wpz": [f"wpz{index}.jpg" for index in range(1, 7)],
            "yq": ["yq1.jpg", "yq2.jpg"],
        }
        entries = {
            filename: {"filename": filename}
            for filename in [
                "tms.jpg",
                "o.jpg",
                *[f"tmz{index}.jpg" for index in range(1, 6)],
                *[f"wpz{index}.jpg" for index in range(1, 7)],
                "yq1.jpg",
                "yq2.jpg",
            ]
        }

        with self.assertRaisesRegex(
            shenhui_shoe_packaging.ShoeSelectionError,
            "yq1..3",
        ):
            shenhui_shoe_packaging._validate_selection_sources(
                "204326141005",
                "白紫色调00317",
                slots,
                entries,
            )

    def test_tmz_uses_second_color_for_multicolor_slot_two(self):
        candidates = {
            "白紫色调00317": {
                "tmz1": "a1.jpg",
                "tmz2": "a2.jpg",
                "tmz3": "a3.jpg",
                "tmz4": "a4.jpg",
                "tmz5": "a5.jpg",
            },
            "米白10301": {
                "tmz1": "b1.jpg",
                "tmz2": "b2.jpg",
                "tmz3": "b3.jpg",
                "tmz4": "b4.jpg",
                "tmz5": "b5.jpg",
            },
        }

        selected = shenhui_shoe_packaging.select_tmz_same_color_first(
            candidates,
            ["白紫色调00317", "米白10301"],
        )

        self.assertEqual(
            selected,
            [
                ("白紫色调00317", "a1.jpg"),
                ("米白10301", "b2.jpg"),
                ("白紫色调00317", "a3.jpg"),
                ("白紫色调00317", "a4.jpg"),
                ("白紫色调00317", "a5.jpg"),
            ],
        )

    def test_tmz_only_crosses_colors_for_slots_missing_from_the_best_color(self):
        candidates = {
            "白紫色调00317": {
                "tmz1": "a1.jpg",
                "tmz2": "a2.jpg",
                "tmz3": "a3.jpg",
                "tmz5": "a5.jpg",
            },
            "米白10301": {
                "tmz1": "b1.jpg",
                "tmz2": "b2.jpg",
                "tmz3": "b3.jpg",
                "tmz4": "b4.jpg",
                "tmz5": "b5.jpg",
            },
        }

        selected = shenhui_shoe_packaging.select_tmz_same_color_first(
            candidates,
            ["白紫色调00317", "米白10301"],
        )

        self.assertEqual(
            selected,
            [
                ("米白10301", "b1.jpg"),
                ("白紫色调00317", "a2.jpg"),
                ("米白10301", "b3.jpg"),
                ("米白10301", "b4.jpg"),
                ("米白10301", "b5.jpg"),
            ],
        )

        candidates["米白10301"].pop("tmz5")
        selected = shenhui_shoe_packaging.select_tmz_same_color_first(
            candidates,
            ["白紫色调00317", "米白10301"],
        )
        self.assertEqual(
            selected,
            [
                ("白紫色调00317", "a1.jpg"),
                ("米白10301", "b2.jpg"),
                ("白紫色调00317", "a3.jpg"),
                ("米白10301", "b4.jpg"),
                ("白紫色调00317", "a5.jpg"),
            ],
        )

    def test_output_names_keep_yk_without_parentheses_and_o_is_letter_o(self):
        self.assertEqual(shenhui_shoe_packaging.output_filename("yk", 1), "yk1.jpg")
        self.assertEqual(shenhui_shoe_packaging.output_filename("yk", 2), "yk2.jpg")
        self.assertEqual(shenhui_shoe_packaging.output_filename("o"), "o.jpg")
        self.assertEqual(shenhui_shoe_packaging.output_filename("wpz", 1), "wpz (1).jpg")
        self.assertEqual(shenhui_shoe_packaging.output_filename("wpz", 4), "wpz (4).jpg")
        self.assertEqual(shenhui_shoe_packaging.output_filename("wpz", 5), "wpz (15).jpg")
        self.assertEqual(shenhui_shoe_packaging.output_filename("wpz", 6), "wpz (16).jpg")
        self.assertEqual(shenhui_shoe_packaging.output_filename("tmz", 5), "tmz (5).jpg")
        self.assertEqual(
            shenhui_shoe_packaging.output_filename(
                "tms",
                source_filename="204326141005-00317.png",
            ),
            "tms.png",
        )

    def test_channel_assets_keep_original_dimensions_and_png_bytes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "204326141005-00317+Ai角度图1.png"
            image = Image.new("RGBA", (640, 360), (0, 0, 0, 0))
            ImageDraw.Draw(image).rectangle((90, 80, 560, 300), fill=(10, 100, 180, 255))
            image.save(source)

            outputs = shenhui_shoe_packaging._create_ai_channel_assets(
                source=source,
                package_root=root / "package",
                color_name="白紫色调00317",
            )

            self.assertEqual(outputs["wpt30"].read_bytes(), source.read_bytes())
            self.assertEqual(outputs["jdt_png"].read_bytes(), source.read_bytes())
            self.assertEqual(set(outputs), {"wpt30", "jdt_png"})
            with Image.open(outputs["wpt30"]) as wpt30:
                self.assertEqual(wpt30.size, (640, 360))
            with Image.open(outputs["jdt_png"]) as jdt_png:
                self.assertEqual(jdt_png.size, (640, 360))
                self.assertEqual(jdt_png.mode, "RGBA")

    def test_pose_prompt_numbers_reference_images_after_all_candidate_sheets(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "208426141211",
            "00377",
            {"I01": "one.jpg", "I13": "thirteen.jpg"},
            "雪地",
            candidate_sheet_count=2,
        )

        self.assertIn("前2张图都是带编号的本色候选原图", prompt)
        self.assertIn("第3张图是鞋品主图姿势模板", prompt)
        self.assertIn("第4张图是新版主图1参考姿势", prompt)
        self.assertIn("第5张图是 yq 三姿势参考模板", prompt)

    def test_yk_sources_remain_eligible_for_matching_pose_slots(self):
        self.assertTrue(shenhui_shoe_packaging._is_yk_source_filename("1.jpg"))
        self.assertTrue(shenhui_shoe_packaging._is_yk_source_filename("12.png"))
        self.assertTrue(shenhui_shoe_packaging._is_yk_source_filename("yk5.jpg"))
        self.assertFalse(shenhui_shoe_packaging._is_yk_source_filename("00044002.jpg"))
        self.assertTrue(shenhui_shoe_packaging._is_pose_selection_candidate("1.jpg"))
        self.assertTrue(shenhui_shoe_packaging._is_pose_selection_candidate("yk5.jpg"))
        self.assertTrue(
            shenhui_shoe_packaging._is_pose_selection_candidate("00044002.jpg")
        )

    def test_junk_shoe_assets_are_filtered(self):
        self.assertTrue(
            shenhui_shoe_packaging._is_junk_shoe_asset_filename("._tmz (1).jpg")
        )
        self.assertTrue(
            shenhui_shoe_packaging._is_junk_shoe_asset_filename(
                "tmz (1).jpg",
                "鞋品/204325141014/__MACOSX/tmz (1).jpg",
            )
        )
        self.assertFalse(
            shenhui_shoe_packaging._is_junk_shoe_asset_filename("tmz (1).jpg")
        )

    def test_snow_detail_yk_prefers_existing_unassigned_detail(self):
        feature = shenhui_shoe_packaging._BinaryPoseFeature(
            mask=None,
            aspect_ratio=1.23,
            bounding_coverage=0.38,
            background_luma=242.0,
            valid=True,
        )
        entries = {
            name: {"filename": name, "path": name, "row": {"云盘路径": name}}
            for name in ["tmz4.jpg", "detail-mouth.jpg"]
        }
        slots = {
            "tmz4": "tmz4.jpg",
            "wpz": ["one.jpg", "two.jpg", "three.jpg", "tmz4.jpg", "five.jpg", "box.jpg"],
            "yk": [],
        }

        with tempfile.TemporaryDirectory() as tmpdir, patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            return_value=feature,
        ):
            ruled, message = shenhui_shoe_packaging._ensure_snow_detail_yk(
                style_code="208426141211",
                color_code="00377",
                slots=slots,
                entries_by_name=entries,
                analysis_root=Path(tmpdir),
            )

        self.assertEqual(ruled["yk"], ["detail-mouth.jpg"])
        self.assertIn("已选择 detail-mouth.jpg 作为 yk1", message)

    def test_snow_detail_yk_crops_from_ai_angle_pose_four_when_no_separate_detail_exists(self):
        feature = shenhui_shoe_packaging._BinaryPoseFeature(
            mask=None,
            aspect_ratio=0.54,
            bounding_coverage=1.0,
            background_luma=255.0,
            valid=True,
        )
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "208426141211-00377+Ai角度图1.png"
            image = Image.new("RGB", (400, 300), (242, 242, 242))
            draw = ImageDraw.Draw(image)
            draw.rectangle((120, 40, 280, 240), fill=(120, 95, 70))
            image.save(source)
            entries = {
                source.name: {
                    "filename": source.name,
                    "path": source,
                    "row": {"云盘路径": "鞋品/208426141211/00377/tmz4.jpg"},
                }
            }
            slots = {
                "tmz4": source.name,
                "wpz": ["one.jpg", "two.jpg", "three.jpg", source.name, "five.jpg", "box.jpg"],
                "yk": [],
            }

            with patch.object(
                shenhui_shoe_packaging,
                "_binary_pose_feature",
                return_value=feature,
            ):
                ruled, message = shenhui_shoe_packaging._ensure_snow_detail_yk(
                    style_code="208426141211",
                    color_code="00377",
                    slots=slots,
                    entries_by_name=entries,
                    analysis_root=root / "_shoe_analysis",
                )

            generated = root / "_shoe_analysis" / "208426141211" / "00377-yk1-auto-crop.jpg"
            self.assertEqual(ruled["yk"], ["yk1-auto-crop.jpg"])
            self.assertTrue(generated.is_file())
            self.assertIn(f"已从 {source.name} 裁切生成 yk1", message)

    def test_snow_pose_four_rejects_toe_crop_and_side_zip_for_ai_opening(self):
        toe_crop_feature = shenhui_shoe_packaging._BinaryPoseFeature(
            mask=None,
            aspect_ratio=1.20,
            bounding_coverage=0.35,
            background_luma=242.0,
            valid=True,
        )
        side_zip_feature = shenhui_shoe_packaging._BinaryPoseFeature(
            mask=None,
            aspect_ratio=1.24,
            bounding_coverage=0.62,
            background_luma=242.0,
            valid=True,
        )
        ai_opening_feature = shenhui_shoe_packaging._BinaryPoseFeature(
            mask=None,
            aspect_ratio=0.54,
            bounding_coverage=1.0,
            background_luma=255.0,
            valid=True,
        )
        entries = {
            "GD009413.jpg": {"filename": "GD009413.jpg", "path": "GD009413.jpg"},
            "GD009380.jpg": {"filename": "GD009380.jpg", "path": "GD009380.jpg"},
            "208426141211-30701+Ai角度图1.png": {
                "filename": "208426141211-30701+Ai角度图1.png",
                "path": "208426141211-30701+Ai角度图1.png",
            },
        }
        slots = {
            "tmz4": "GD009380.jpg",
            "wpz": [
                "one.jpg",
                "two.jpg",
                "three.jpg",
                "GD009380.jpg",
                "five.jpg",
                "box.jpg",
            ],
            "yq": [],
            "yx": "",
        }

        def fake_feature(path):
            filename = Path(path).name
            if filename == "GD009413.jpg":
                return toe_crop_feature
            if filename == "GD009380.jpg":
                return side_zip_feature
            return ai_opening_feature

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=fake_feature,
        ):
            ruled, corrections = shenhui_shoe_packaging._apply_selection_quality_rules(
                "雪地",
                slots,
                entries,
            )

        self.assertEqual(ruled["tmz4"], "208426141211-30701+Ai角度图1.png")
        self.assertEqual(ruled["wpz"][3], "208426141211-30701+Ai角度图1.png")
        self.assertTrue(any("完整鞋口内里图" in item for item in corrections))

    def test_copy_as_jpeg_composites_transparent_png_on_white(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "transparent.png"
            target = root / "target.jpg"
            image = Image.new("RGBA", (12, 12), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            draw.rectangle((4, 4, 8, 8), fill=(180, 40, 30, 255))
            image.save(source)

            shenhui_shoe_packaging._copy_as_jpeg(source, target)

            with Image.open(target) as result:
                corner = result.getpixel((0, 0))
                center = result.getpixel((6, 6))

        self.assertGreaterEqual(min(corner), 245)
        self.assertGreater(center[0], 120)

    def test_copy_as_jpeg_can_composite_transparent_png_on_gray(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "transparent.png"
            target = root / "target.jpg"
            image = Image.new("RGBA", (12, 12), (0, 0, 0, 0))
            draw = ImageDraw.Draw(image)
            draw.rectangle((4, 4, 8, 8), fill=(180, 40, 30, 255))
            image.save(source)

            shenhui_shoe_packaging._copy_as_jpeg(
                source,
                target,
                background_rgb=shenhui_shoe_packaging.SHOE_GRAY_BACKGROUND_RGB,
            )

            with Image.open(target) as result:
                corner = result.getpixel((0, 0))
                center = result.getpixel((6, 6))

        self.assertLessEqual(max(abs(value - 242) for value in corner), 8)
        self.assertGreater(center[0], 120)

    def test_copy_as_jpeg_can_repaint_opaque_white_background_on_gray(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "white-background.png"
            target = root / "target.jpg"
            image = Image.new("RGB", (20, 20), (255, 255, 255))
            draw = ImageDraw.Draw(image)
            draw.rectangle((6, 6, 13, 13), fill=(180, 120, 90))
            image.save(source)

            shenhui_shoe_packaging._copy_as_jpeg(
                source,
                target,
                background_rgb=shenhui_shoe_packaging.SHOE_GRAY_BACKGROUND_RGB,
            )

            with Image.open(target) as result:
                corner = result.getpixel((0, 0))
                center = result.getpixel((10, 10))

        self.assertLessEqual(max(abs(value - 242) for value in corner), 8)
        self.assertLess(center[1], 170)

    def test_create_tmq_asset_uses_style_code_bbox_for_red_box(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "box.jpg"
            Image.new("RGB", (1000, 1000), (230, 226, 224)).save(source)
            target = root / "tmq.jpg"

            shenhui_shoe_packaging._create_tmq_asset(
                source=source,
                target=target,
                label_bbox=[100, 100, 900, 900],
                style_code_bbox=[150, 650, 420, 720],
                style_code="204326141005",
                require_style_code_bbox=True,
            )

            with Image.open(target) as image:
                red_pixels = [
                    (x, y)
                    for y in range(image.height)
                    for x in range(image.width)
                    if image.getpixel((x, y))[0] > 220
                    and image.getpixel((x, y))[1] < 40
                    and image.getpixel((x, y))[2] < 40
                ]
            self.assertTrue(red_pixels)
            self.assertGreater(min(y for _x, y in red_pixels), 240)

    def test_create_tmq_asset_corrects_label_ocr_product_name_row(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "box.jpg"
            image = Image.new("RGB", (1000, 1000), (210, 190, 170))
            draw = ImageDraw.Draw(image)
            draw.rectangle((100, 100, 900, 900), fill=(248, 248, 246))
            draw.rectangle((130, 225, 430, 265), fill=(20, 20, 20))
            draw.rectangle((130, 282, 500, 320), fill=(20, 20, 20))
            image.save(source)
            target = root / "tmq.jpg"

            shenhui_shoe_packaging._create_tmq_asset(
                source=source,
                target=target,
                label_bbox=[100, 100, 900, 900],
                style_code_bbox=[180, 225, 430, 265],
                style_code="204325141014",
                require_style_code_bbox=True,
            )

            with Image.open(target) as output:
                red_pixels = [
                    (x, y)
                    for y in range(output.height)
                    for x in range(output.width)
                    if output.getpixel((x, y))[0] > 220
                    and output.getpixel((x, y))[1] < 45
                    and output.getpixel((x, y))[2] < 45
                ]
            self.assertTrue(red_pixels)
            self.assertGreater(min(y for _x, y in red_pixels), 120)
            self.assertLess(max(y for _x, y in red_pixels), 185)

    def test_main_color_requires_o_but_missing_yx_is_only_a_report_warning(self):
        with self.assertRaisesRegex(
            shenhui_shoe_packaging.ShoeSelectionError,
            "白紫色调00317.*o.jpg",
        ):
            shenhui_shoe_packaging.build_output_assignments(
                {
                    "白紫色调00317": {
                        "tmz1": "1.jpg",
                        "tmz2": "2.jpg",
                        "tmz3": "3.jpg",
                        "tmz4": "4.jpg",
                        "tmz5": "5.jpg",
                        "tms": "color.jpg",
                    }
                }
            )

        assignments, warnings = shenhui_shoe_packaging.build_output_assignments(
            {
                "白紫色调00317": {
                    "tmz1": "1.jpg",
                    "tmz2": "2.jpg",
                    "tmz3": "3.jpg",
                    "tmz4": "4.jpg",
                    "tmz5": "5.jpg",
                    "tms": "color.jpg",
                    "o": "poster.jpg",
                    "wpz": ["1.jpg", "2.jpg"],
                    "yq": ["real-1.jpg"],
                    "yk": ["detail-1.jpg", "detail-2.jpg"],
                    "yx": "",
                }
            }
        )

        outputs = {item["output_path"] for item in assignments}
        self.assertIn("1.白紫色调00317/o.jpg", outputs)
        self.assertIn("1.白紫色调00317/yk1.jpg", outputs)
        self.assertIn("1.白紫色调00317/yk2.jpg", outputs)
        self.assertIn("tmz (1).jpg", outputs)
        self.assertEqual(
            warnings,
            [{"color": "白紫色调00317", "warning": "允许缺少 yx.jpg：未识别到功能吊牌图"}],
        )

    def test_promoted_color_is_color_with_yk_and_keeps_all_detail_yk(self):
        assignments, _warnings = shenhui_shoe_packaging.build_output_assignments(
            {
                "白紫色调00317": {
                    "tmz1": "a1.jpg",
                    "tmz2": "a2.jpg",
                    "tmz3": "a3.jpg",
                    "tmz4": "a4.jpg",
                    "tmz5": "a5.jpg",
                    "tms": "a-color.jpg",
                    "o": "a-poster.jpg",
                    "wpz": [f"a{index}.jpg" for index in range(1, 7)],
                    "yq": ["a-yq1.jpg", "a-yq2.jpg", "a-yq3.jpg"],
                    "yx": "",
                },
                "米白10301": {
                    "tmz1": "b1.jpg",
                    "tmz2": "b2.jpg",
                    "tmz3": "b3.jpg",
                    "tmz4": "b4.jpg",
                    "tmz5": "b5.jpg",
                    "tms": "b-color.jpg",
                    "o": "b-poster.jpg",
                    "wpz": [f"b{index}.jpg" for index in range(1, 7)],
                    "yq": ["b-yq1.jpg", "b-yq2.jpg", "b-yq3.jpg"],
                    "yk": [f"detail-{index}.jpg" for index in range(1, 6)],
                    "yx": "",
                },
            },
            ["白紫色调00317", "米白10301"],
        )

        outputs = {item["output_path"] for item in assignments}
        self.assertIn("1.米白10301/o.jpg", outputs)
        self.assertIn("1.米白10301/yk4.jpg", outputs)
        self.assertIn("1.米白10301/yk5.jpg", outputs)
        self.assertNotIn("2.白紫色调00317/o.jpg", outputs)
        self.assertFalse(any(path.endswith("/yk1.jpg") and path.startswith("2.") for path in outputs))

    def test_output_paths_sanitize_model_color_names(self):
        assignments, _warnings = shenhui_shoe_packaging.build_output_assignments(
            {
                "酒红/米白00316": {
                    "tmz1": "1.jpg",
                    "tmz2": "2.jpg",
                    "tmz3": "3.jpg",
                    "tmz4": "4.jpg",
                    "tmz5": "5.jpg",
                    "tms": "color.png",
                    "o": "poster.jpg",
                    "wpz": [f"pose-{index}.jpg" for index in range(1, 7)],
                    "yq": ["yq1.jpg", "yq2.jpg", "yq3.jpg"],
                    "yx": "",
                }
            }
        )

        outputs = {item["output_path"] for item in assignments}
        self.assertIn("1.酒红_米白00316/tms.png", outputs)
        self.assertFalse(any("酒红/米白" in path for path in outputs))

    def test_size_folder_filter_prefers_size_with_business_yk_labels(self):
        entries = [
            *[
                {
                    "filename": f"{index}.jpg",
                    "row": {
                        "云盘路径": f"鞋品/204325141014/90001/30/{index}.jpg"
                    },
                }
                for index in range(1, 5)
            ],
            {
                "filename": "204325141014-90001.jpg",
                "row": {"云盘路径": "鞋品/204325141014/90001/30/204325141014-90001.jpg"},
            },
            {
                "filename": "204325141014-90001.jpg",
                "row": {"云盘路径": "鞋品/204325141014/90001/36/204325141014-90001.jpg"},
            },
            {
                "filename": "00044002.jpg",
                "row": {"云盘路径": "鞋品/204325141014/90001/00044002.jpg"},
            },
        ]

        filtered, warning = shenhui_shoe_packaging._filter_single_shoe_size_entries(entries)

        self.assertTrue(all(
            "/36/" not in entry["row"]["云盘路径"]
            for entry in filtered
        ))
        self.assertEqual(
            [entry["filename"] for entry in filtered[:4]],
            ["1.jpg", "2.jpg", "3.jpg", "4.jpg"],
        )
        self.assertEqual(filtered[-1]["filename"], "00044002.jpg")
        self.assertIn("按文案标注 YK 优先选择 30 码", warning)

    def test_size_folder_filter_falls_back_to_largest_size_without_yk_labels(self):
        entries = [
            {
                "filename": "204325141014-90001.jpg",
                "row": {"云盘路径": "鞋品/204325141014/90001/30/204325141014-90001.jpg"},
            },
            {
                "filename": "204325141014-90001.jpg",
                "row": {"云盘路径": "鞋品/204325141014/90001/36/204325141014-90001.jpg"},
            },
            {
                "filename": "00044002.jpg",
                "row": {"云盘路径": "鞋品/204325141014/90001/00044002.jpg"},
            },
        ]

        filtered, warning = shenhui_shoe_packaging._filter_single_shoe_size_entries(entries)

        self.assertEqual([entry["row"]["云盘路径"].split("/")[-2] for entry in filtered[:1]], ["36"])
        self.assertEqual(filtered[-1]["filename"], "00044002.jpg")
        self.assertIn("回退仅保留 36 码", warning)

    def test_size_folder_filter_preserves_ai_angle_images_without_yk_labels(self):
        entries = [
            {
                "filename": "208426141211-00377+Ai角度图1.png",
                "row": {"云盘路径": "鞋品/208426141211/00377/23/208426141211-00377+Ai角度图1.png"},
            },
            {
                "filename": "GD009191.jpg",
                "row": {"云盘路径": "鞋品/208426141211/00377/23/GD009191.jpg"},
            },
            {
                "filename": "GD009257.jpg",
                "row": {"云盘路径": "鞋品/208426141211/00377/27/GD009257.jpg"},
            },
            {
                "filename": "208426141211-00377.jpg",
                "row": {"云盘路径": "鞋品/208426141211/00377/208426141211-00377.jpg"},
            },
        ]

        filtered, warning = shenhui_shoe_packaging._filter_single_shoe_size_entries(entries)
        filtered_names = [entry["filename"] for entry in filtered]

        self.assertIn("208426141211-00377+Ai角度图1.png", filtered_names)
        self.assertIn("GD009257.jpg", filtered_names)
        self.assertNotIn("GD009191.jpg", filtered_names)
        self.assertIn("保留 1 张跨尺码 AI 角度图", warning)

    def test_prepare_packages_builds_real_files_and_report_rows(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source_root = root / "source"
            output_root = root / "output"
            source_root.mkdir()
            rows = []
            colors = [("00317", "白紫色调00317"), ("10301", "米白10301")]

            for color_code, _color_name in colors:
                names = [
                    f"204326141005-{color_code}.jpg",
                    f"204326141005-{color_code}+Ai角度图1.png",
                    f"GD-{color_code}-raw.jpg",
                    "o.jpg",
                    "wpz (5).jpg",
                    "wpz (6).jpg",
                    *[f"{color_code}-{index}.jpg" for index in range(1, 13)],
                ]
                if color_code == "00317":
                    names.extend([
                        "1.jpg",
                        "2.jpg",
                        "3.jpg",
                        "4.jpg",
                        "yk5.jpg",
                        "yk6.jpg",
                        "yk7.jpg",
                        "yx.jpg",
                    ])
                for index, name in enumerate(names):
                    path = source_root / f"{color_code}-{index}-{name}"
                    if name.endswith(".png"):
                        Image.new("RGBA", (212, 400), (index * 7 % 255, 120, 180, 255)).save(path)
                    else:
                        Image.new("RGB", (80, 80), (index * 7 % 255, 120, 180)).save(path)
                    rows.append({
                        "输入款号": "204326141005",
                        "颜色": color_code,
                        "原文件名": name,
                        "云盘路径": f"鞋品/204326141005-已写/{color_code}/36/{name}",
                        "下载结果": "已下载",
                        "本地文件": str(path),
                        "__shoe_color_code": color_code,
                        "__shoe_original_filename": name,
                    })

            uncolored_source = source_root / "uncolored-800_800(天猫)1.jpg"
            Image.new("RGB", (120, 160), (30, 90, 180)).save(uncolored_source)
            rows.append({
                "输入款号": "204326141005",
                "颜色": "",
                "原文件名": "800_800(天猫)1.jpg",
                "云盘路径": "鞋品/204326141005-已写/800_800(天猫)1.jpg",
                "下载结果": "已下载",
                "本地文件": str(uncolored_source),
                "__shoe_color_code": "",
                "__shoe_original_filename": "800_800(天猫)1.jpg",
            })

            analyzer_calls = []
            label_calls = []
            progress_events = []

            def fake_analyzer(**kwargs):
                analyzer_calls.append(kwargs)
                self.assertTrue(Path(kwargs["contact_sheet"]).is_file())
                self.assertGreaterEqual(len(kwargs["contact_sheets"]), 2)
                self.assertTrue(Path(kwargs["reference_image"]).is_file())
                self.assertTrue(Path(kwargs["pose1_reference_image"]).is_file())
                self.assertTrue(Path(kwargs["yq_reference_image"]).is_file())
                self.assertFalse(
                    any("Ai角度图" in name for name in kwargs["candidate_names"])
                )
                for contact_sheet_path in kwargs["contact_sheets"]:
                    with Image.open(contact_sheet_path) as contact_sheet:
                        self.assertLessEqual(contact_sheet.width, 1200)
                        self.assertLessEqual(contact_sheet.height, 1020)
                color_code = kwargs["color_code"]
                color_name = "白绿色调10301" if color_code == "10301" else dict(colors)[color_code]
                slots = {
                    "tmz1": f"{color_code}-1.jpg",
                    "tmz2": f"{color_code}-2.jpg",
                    "tmz3": f"{color_code}-3.jpg",
                    "tmz4": f"{color_code}-4.jpg",
                    "tmz5": f"{color_code}-5.jpg",
                    "o": f"{color_code}-5.jpg",
                    "wpz": [f"{color_code}-{index}.jpg" for index in range(1, 7)],
                    "yq": [f"{color_code}-{index}.jpg" for index in range(7, 11)],
                    "yk": ["yk1.jpg", "yk2.jpg"],
                    "yx": "yx.jpg" if color_code == "00317" else "",
                }
                return {
                    "color_name": color_name,
                    "shoe_category": "运动",
                    "slots": slots,
                }

            def fake_label_analyzer(**kwargs):
                label_calls.append(kwargs)
                with Image.open(kwargs["label_image"]) as label_image:
                    self.assertLessEqual(max(label_image.size), 1600)
                return {
                    "product_name": "儿童板鞋",
                    "color_name": dict(colors)[kwargs["color_code"]],
                    "color_code": kwargs["color_code"],
                    "label_bbox": [100, 100, 900, 800],
                    "style_code_bbox": [150, 520, 430, 575],
                }

            report_rows, package_roots = shenhui_shoe_packaging.prepare_shoe_packages(
                data_rows=rows,
                output_root=output_root,
                model_id="qwen3.8-max-preview",
                shoe_categories={"204326141005": "婴童"},
                analyze_color=fake_analyzer,
                analyze_color_label=fake_label_analyzer,
                log=lambda _message: None,
                progress=progress_events.append,
            )

            package_root = package_roots["204326141005"]
            self.assertEqual(package_root, output_root / "204326141005")
            self.assertTrue((package_root / "tmz (1).jpg").is_file())
            self.assertTrue((package_root / "tmz (5).jpg").is_file())
            self.assertTrue((package_root / "1.白紫色调00317" / "o.jpg").is_file())
            self.assertFalse((package_root / "2.米白10301" / "o.jpg").exists())
            self.assertTrue((package_root / "1.白紫色调00317" / "yk1.jpg").is_file())
            self.assertTrue((package_root / "1.白紫色调00317" / "yk5.jpg").is_file())
            self.assertTrue((package_root / "1.白紫色调00317" / "yk7.jpg").is_file())
            self.assertFalse((package_root / "1.白紫色调00317" / "1.jpg").exists())
            self.assertTrue(
                (
                    package_root
                    / "1.白紫色调00317"
                    / "204326141005-00317+Ai角度图1.png"
                ).is_file()
            )
            self.assertTrue(
                (
                    package_root
                    / "1.白紫色调00317"
                    / "GD-00317-raw.jpg"
                ).is_file()
            )
            self.assertTrue(
                (
                    package_root
                    / "1.白紫色调00317"
                    / "00317-1.jpg"
                ).is_file()
            )
            self.assertTrue((package_root / "jdt.白紫色调00317.png").is_file())
            self.assertFalse((package_root / "jdt.白紫色调00317.jpg").exists())
            self.assertTrue((package_root / "wpt30.白紫色调00317.png").is_file())
            self.assertTrue((package_root / "tmt.png").is_file())
            self.assertTrue((package_root / "tmq.jpg").is_file())
            self.assertEqual(progress_events[0]["organize_total"], 2)
            self.assertEqual(progress_events[0]["organize_completed"], 0)
            self.assertTrue(progress_events[0]["organize_active"])
            self.assertTrue(
                any(
                    event["organize_stage"] == "识别姿势"
                    and event["organize_current_style"] == "204326141005"
                    and event["organize_current_color"] == "00317"
                    for event in progress_events
                )
            )
            self.assertEqual(progress_events[-1]["organize_completed"], 2)
            self.assertEqual(progress_events[-1]["organize_stage"], "整理完成")
            self.assertFalse(progress_events[-1]["organize_active"])
            self.assertEqual(
                (package_root / "原图" / "800_800(天猫)1.jpg").read_bytes(),
                uncolored_source.read_bytes(),
            )
            self.assertFalse((package_root / "1.白紫色调00317" / "yk (1).jpg").exists())
            self.assertFalse((package_root / "1.白紫色调00317" / "yq (4).jpg").exists())
            self.assertFalse((package_root / "2.米白10301" / "yk1.jpg").exists())
            self.assertFalse((package_root / "1.白紫色调00317" / "wpz (5).jpg").exists())
            self.assertFalse((package_root / "1.白紫色调00317" / "wpz (6).jpg").exists())
            self.assertFalse((package_root / "2.米白10301" / "wpz (5).jpg").exists())
            self.assertFalse((package_root / "2.米白10301" / "wpz (6).jpg").exists())
            original_tms = next(
                Path(row["本地文件"])
                for row in rows
                if row["原文件名"] == "204326141005-00317.jpg"
            )
            self.assertEqual(
                (package_root / "1.白紫色调00317" / "tms.jpg").read_bytes(),
                original_tms.read_bytes(),
            )
            self.assertEqual(len(analyzer_calls), 1)
            self.assertTrue(
                all(call["shoe_category"] == "婴童" for call in analyzer_calls)
            )
            self.assertEqual(len(label_calls), 2)
            with Image.open(
                package_root / "1.白紫色调00317" / "o.jpg"
            ) as poster, Image.open(
                package_root / "1.白紫色调00317" / "wpz (15).jpg"
            ) as wpz5:
                self.assertEqual(poster.tobytes(), wpz5.tobytes())

            warning_rows = [row for row in report_rows if row.get("规则告警")]
            self.assertEqual(len(warning_rows), 1)
            self.assertEqual(warning_rows[0]["颜色"], "米白10301")
            uncolored_rows = [
                row
                for row in report_rows
                if row.get("原文件名") == "800_800(天猫)1.jpg"
                and row.get("处理动作") == "保留网盘全部原始图片"
            ]
            self.assertEqual(len(uncolored_rows), 1)
            self.assertEqual(
                uncolored_rows[0]["输出文件名"],
                "原图/800_800(天猫)1.jpg",
            )
            self.assertIn("允许缺少 yx.jpg", warning_rows[0]["规则告警"])


if __name__ == "__main__":
    unittest.main()
