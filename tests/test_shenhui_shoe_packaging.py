import json
import threading
import time
import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch

from PIL import Image, ImageDraw

from core import shenhui_shoe_packaging


def _candidate_fact(candidate_id, *matched_slots, filename="", **overrides):
    slots = [slot for slot in matched_slots if slot]
    fact = {
        "candidate_id": candidate_id,
        "filename": filename,
        "asset_type": "shoe",
        "shoe_count": "pair",
        "pose": slots[0] if slots else "other",
        "background": "gray",
        "complete": True,
        "side": "front",
        "outsole_visible": False,
        "feature_card": False,
        "matched_slots": slots,
        "confidence": 0.96,
    }
    if any(slot == "tmz4" for slot in slots):
        fact["side"] = "rear"
    if any(slot == "tmz5" for slot in slots):
        fact["shoe_count"] = "single"
        fact["background"] = "white"
    if any(slot == "wpz5" for slot in slots):
        fact["shoe_count"] = "single"
    if any(slot == "wpz6" for slot in slots):
        fact["asset_type"] = "shoe_box"
        fact["complete"] = False
    if any(slot == "yq2" for slot in slots):
        fact["side"] = "sole"
        fact["outsole_visible"] = True
    if any(slot == "yq3" for slot in slots):
        fact["side"] = "outer"
    if any(slot == "yx" for slot in slots):
        fact["asset_type"] = "shoe_with_card"
        fact["feature_card"] = True
    fact.update(overrides)
    return fact


def _required_pose_candidate_facts(**overrides):
    ids = {
        "tmz1": "I01",
        "tmz2": "I02",
        "tmz3": "I03",
        "tmz4": "I04",
        "tmz5": "I05",
        "wpz5": "I06",
        "wpz6": "I07",
        "yq2": "I08",
        "yq3": "I09",
        "yq1": "I10",
    }
    ids.update(overrides)
    return [
        _candidate_fact(ids["tmz1"], "tmz1", filename=f"{ids['tmz1']}.jpg"),
        _candidate_fact(ids["tmz2"], "tmz2", filename=f"{ids['tmz2']}.jpg"),
        _candidate_fact(ids["tmz3"], "tmz3", filename=f"{ids['tmz3']}.jpg"),
        _candidate_fact(ids["tmz4"], "tmz4", filename=f"{ids['tmz4']}.jpg"),
        _candidate_fact(ids["tmz5"], "tmz5", filename=f"{ids['tmz5']}.jpg"),
        _candidate_fact(ids["wpz5"], "wpz5", filename=f"{ids['wpz5']}.jpg"),
        _candidate_fact(ids["wpz6"], "wpz6", filename=f"{ids['wpz6']}.jpg"),
        _candidate_fact(ids["yq2"], "yq2", filename=f"{ids['yq2']}.jpg"),
        _candidate_fact(ids["yq3"], "yq3", filename=f"{ids['yq3']}.jpg"),
        _candidate_fact(ids["yq1"], "yq1", filename=f"{ids['yq1']}.jpg"),
    ]


def _required_pose_candidate_ids(*extra_ids):
    ids = [f"I{index:02d}" for index in range(1, 11)]
    ids.extend(extra_ids)
    return {candidate_id: f"{candidate_id}.jpg" for candidate_id in ids}


class ShenhuiShoePackagingRuleTests(unittest.TestCase):
    def test_pose_work_items_interleave_models_within_each_batch(self):
        batches = [
            {"batch_index": index, "candidate_ids": {}}
            for index in range(1, 4)
        ]

        work_items = shenhui_shoe_packaging._interleaved_pose_work_items(
            ["model-a", "model-b"],
            batches,
            {1: set(), 2: {"model-a"}, 3: set()},
        )

        self.assertEqual(
            [
                (model_id, int(batch["batch_index"]))
                for model_id, batch in work_items
            ],
            [
                ("model-a", 1),
                ("model-b", 1),
                ("model-b", 2),
                ("model-a", 3),
                ("model-b", 3),
            ],
        )

    def test_pose_model_wave_runs_independent_models_concurrently(self):
        lock = threading.Lock()
        active = 0
        max_active = 0

        def invoke(model_id):
            nonlocal active, max_active
            with lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            with lock:
                active -= 1
            return {"model_id": model_id}

        results = shenhui_shoe_packaging._run_pose_model_wave(
            ["model-a", "model-b"],
            invoke,
            max_workers=2,
        )

        self.assertEqual(
            [result["model_id"] for result in results],
            ["model-a", "model-b"],
        )
        self.assertEqual(max_active, 2)

    def test_default_analyzer_dispatches_initial_model_quorum_concurrently(self):
        lock = threading.Lock()
        active = 0
        max_active = 0
        candidate_ids = _required_pose_candidate_ids()

        def fake_multimodal_json(**kwargs):
            nonlocal active, max_active
            with lock:
                active += 1
                max_active = max(max_active, active)
            time.sleep(0.05)
            with lock:
                active -= 1
            return (
                {
                    "color_name": "梦幻粉60301",
                    "shoe_category": "婴童",
                    "candidates": _required_pose_candidate_facts(),
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                style_code="204426146036",
                color_code="60301",
                contact_sheet="single-sheet.jpg",
                contact_sheets=["single-sheet.jpg"],
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
                reference_image="main-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids=candidate_ids,
                candidate_names=list(candidate_ids.values()),
                shoe_category="婴童",
                model_id="model-a",
                fallback_model_ids=["model-b", "model-c"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(payload["slots"]["tmz1"], "I01")
        self.assertEqual(max_active, 2)

    def test_cross_page_conflict_ignores_disagreement_inside_one_page(self):
        page_one = {
            "_model_votes": {
                "tmz5": {
                    "status": "insufficient_votes",
                    "candidates": {
                        "exact-white": ["model-a"],
                        "gray-side": ["model-b"],
                    },
                },
            },
        }
        page_two = {"_model_votes": {}}

        self.assertEqual(
            shenhui_shoe_packaging._cross_page_conflict_slots(
                [page_one, page_two]
            ),
            [],
        )

    def test_cross_page_conflict_requires_different_locked_page_winners(self):
        page_one = {
            "_model_votes": {
                "tmz5": {
                    "status": "locked",
                    "selected_family": "exact-white",
                },
            },
        }
        page_two = {
            "_model_votes": {
                "tmz5": {
                    "status": "locked",
                    "selected_family": "gray-side",
                },
            },
        }

        self.assertEqual(
            shenhui_shoe_packaging._cross_page_conflict_slots(
                [page_one, page_two]
            ),
            ["tmz5"],
        )

    def test_exact_style_color_white_contract_locks_tmz5_before_targeted(self):
        exact_filename = "204426146036-00317.jpg"
        payload = {
            "slots": {
                "tmz5": "I02",
                "wpz": ["", "", "", "", "", ""],
                "yq": ["", "", ""],
            },
            "_model_votes": {
                "tmz5": {
                    "status": "insufficient_votes",
                    "votes": 1,
                    "required_votes": 2,
                },
            },
            "_consensus_issues": [{"slot": "tmz5", "status": "insufficient_votes"}],
            "_candidate_facts_by_model": [
                {
                    "model_id": model_id,
                    "candidate_facts": [
                        _candidate_fact(
                            "I01",
                            "tmz5",
                            filename=exact_filename,
                            shoe_count="single",
                            background="white",
                        )
                    ],
                }
                for model_id in ("model-a", "model-b")
            ],
        }

        locked = shenhui_shoe_packaging._lock_verified_exact_tms_contract(
            payload,
            candidate_ids={"I01": exact_filename, "I02": "wrong-gray.jpg"},
            entries_by_name={exact_filename: {"filename": exact_filename}},
            style_code="204426146036",
            color_code="00317",
            required_votes=2,
        )

        self.assertTrue(locked)
        self.assertEqual(payload["slots"]["tmz5"], "I01")
        self.assertEqual(
            payload["_model_votes"]["tmz5"]["source"],
            "verified_exact_tms_contract",
        )
        self.assertNotIn(
            "tmz5",
            {issue.get("slot") for issue in payload["_consensus_issues"]},
        )

    def test_exact_white_contract_combines_independent_identity_with_local_pixels(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            exact_filename = "204426140143-00392.jpg"
            exact_path = Path(tmpdir) / exact_filename
            image = Image.new("RGB", (800, 800), (255, 255, 255))
            ImageDraw.Draw(image).ellipse((250, 300, 550, 500), fill=(30, 30, 30))
            image.save(exact_path)
            payload = {
                "slots": {"tmz5": "I02"},
                "_model_votes": {},
                "_consensus_issues": [
                    {"slot": "tmz5", "status": "insufficient_votes"}
                ],
            }
            evidence = [
                {
                    "model_id": "model-a",
                    "candidate_facts": [
                        _candidate_fact(
                            "I01",
                            "tmz5",
                            filename=exact_filename,
                            shoe_count="single",
                            background="white",
                        )
                    ],
                },
                {
                    "model_id": "model-b",
                    "candidate_facts": [
                        _candidate_fact(
                            "I01",
                            "other",
                            filename=exact_filename,
                            shoe_count="single",
                            background="gray",
                        )
                    ],
                },
            ]

            locked = shenhui_shoe_packaging._lock_verified_exact_tms_contract(
                payload,
                candidate_ids={"I01": exact_filename, "I02": "wrong-gray.jpg"},
                entries_by_name={
                    exact_filename: {"filename": exact_filename, "path": exact_path}
                },
                style_code="204426140143",
                color_code="00392",
                required_votes=2,
                candidate_facts_by_model=evidence,
            )

        self.assertTrue(locked)
        self.assertEqual(payload["slots"]["tmz5"], "I01")
        self.assertEqual(
            payload["_model_votes"]["tmz5"]["verification"],
            "independent_identity_local_white",
        )

    def test_global_pages_exact_white_tmz5_skips_targeted_revote(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            exact_filename = "204426146036-00317.jpg"
            candidate_ids = _required_pose_candidate_ids("I11", "I12", "I13")
            candidate_ids["I11"] = exact_filename
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (120, 100), (index * 17 % 255, 130, 170)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            targeted_slots = []

            def full_facts():
                facts = _required_pose_candidate_facts(tmz5="I11")
                for fact in facts:
                    if fact["candidate_id"] == "I11":
                        fact["filename"] = exact_filename
                return facts

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                if "本轮只裁决" in prompt:
                    target_slot = prompt.split("本轮只裁决", 1)[1].split("，", 1)[0].strip()
                    targeted_slots.append(target_slot)
                    selected = {"tmz3": "I03", "wpz5": "I06"}[target_slot]
                    facts = [
                        _candidate_fact(
                            selected,
                            target_slot,
                            filename=candidate_ids[selected],
                            shoe_count="single" if target_slot == "wpz5" else "pair",
                        )
                    ]
                else:
                    facts = full_facts()
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

        self.assertEqual(payload["slots"]["tmz5"], "I11")
        self.assertIn(
            "tmz5",
            payload.get("_exact_contract_locked_slots") or [],
            msg=json.dumps(
                {
                    "votes": payload.get("_model_votes", {}).get("tmz5"),
                    "facts": payload.get("_candidate_facts_by_model"),
                    "focused_ids": payload.get("_focused_candidate_ids"),
                },
                ensure_ascii=False,
            ),
        )
        self.assertEqual(
            payload["_model_votes"]["tmz5"]["source"],
            "verified_exact_tms_contract",
        )
        self.assertNotIn("tmz5", targeted_slots)
        self.assertCountEqual(targeted_slots, ["tmz3", "wpz5"] * 2)

    def test_excel_category_aliases_are_normalized_to_template_categories(self):
        aliases = {
            "运动鞋": "运动",
            "板鞋": "运动",
            "公主鞋": "休闲",
            "皮鞋": "休闲",
            "靴子": "休闲",
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

    def test_baby_shoe_prompt_separates_main_five_from_poster_pose(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "208326146209",
            "00316",
            {"I01": "candidate.jpg"},
            "婴童",
        )

        self.assertIn("tmz5 必须优先选择原始白底单只鞋斜向展示图", prompt)
        self.assertIn("按姿势选择灰底原图作为 fallback", prompt)
        self.assertIn("o 海报图必须选择：复用该品类 tmz1/wpz1", prompt)
        self.assertIn("必须是两只鞋完整同框", prompt)

    def test_prompt_rejects_wrong_pose_two_and_main_five_sources(self):
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
        self.assertIn("不能选择灰底图后改白底", prompt)
        self.assertIn("不能选择旧版第五姿势的两只鞋组合图", prompt)
        self.assertIn("鞋垫、单独鞋底、鞋盒或局部特写", prompt)

    def test_prompt_maps_main_pose_reference_cells_to_slots(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "208326146209",
            "00316",
            {"I01": "candidate.jpg"},
            "婴童",
            main_pose_reference_count=5,
        )

        self.assertIn("第2到第6张图是当前品类的主图位切片参考", prompt)
        self.assertIn("tmz1、tmz2、tmz3、tmz4、tmz5", prompt)
        self.assertIn("必须优先逐张对照这些参考图判断", prompt)

    def test_prompt_marks_overview_as_context_not_returnable_candidates(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "208326146209",
            "00316",
            {"I05": "batch-candidate.jpg"},
            "婴童",
            overview_sheet_count=1,
            candidate_scope=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
            main_pose_reference_count=5,
        )

        self.assertIn("第一张图是带编号的本色当前批次候选原图", prompt)
        self.assertIn("第2张图是本色全部候选全景上下文", prompt)
        self.assertIn("第3到第7张图是当前品类的主图位切片参考", prompt)
        self.assertIn("返回 JSON 只能引用“候选编号”列表中的当前批次编号", prompt)
        self.assertIn("逐张返回可校验事实 candidates", prompt)
        self.assertIn("不要直接填写完整 slots", prompt)

    def test_prompt_marks_single_sheet_as_global_selection(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "208326146209",
            "00316",
            {"I01": "candidate.jpg", "I09": "other.jpg"},
            "婴童",
            candidate_scope=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
        )

        self.assertIn("第一张图是带编号的本色全部候选原图", prompt)
        self.assertIn("全量候选大图一次性识别", prompt)
        self.assertIn("逐张返回可校验事实 candidates", prompt)
        self.assertIn("不要直接填写完整 slots", prompt)

    def test_prompt_marks_global_pages_as_candidate_fact_task(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "208326146209",
            "00316",
            {"I01": "candidate.jpg", "I13": "other.jpg"},
            "婴童",
            candidate_sheet_count=1,
            candidate_scope=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
            main_pose_reference_count=5,
        )

        self.assertIn("第一张图是带编号的本色当前页候选原图", prompt)
        self.assertNotIn("本色全部候选原图", prompt)
        self.assertIn("global_pages 分页全局识别", prompt)
        self.assertIn("第2到第6张图是当前品类的主图位切片参考", prompt)
        self.assertIn("按顺序一一对应 tmz1、tmz2、tmz3、tmz4、tmz5", prompt)
        self.assertIn("第7张图是鞋品海报姿势模板", prompt)
        self.assertIn("第8张图是 yq 三姿势参考模板", prompt)
        self.assertIn("不要直接填写完整 slots", prompt)
        self.assertIn("逐候选返回可校验事实 candidates", prompt)
        self.assertIn('"matched_slots"', prompt)

    def test_targeted_slot_prompt_limits_judgement_to_one_exact_template(self):
        prompt = shenhui_shoe_packaging._shoe_targeted_slot_prompt(
            "204426146036",
            "60301",
            {"I01": "candidate-one.jpg", "I02": "candidate-two.jpg"},
            "婴童",
            target_slot="tmz3",
            candidate_sheet_count=2,
            has_reference_image=True,
        )

        self.assertIn("本轮只裁决 tmz3", prompt)
        self.assertIn("前2张图合起来包含全部候选", prompt)
        self.assertIn("第3张图是 tmz3 的唯一精确模板", prompt)
        self.assertIn("每张候选面板顶部都有同一张 REFERENCE TEMPLATE / 不可选精确模板", prompt)
        self.assertIn('"matched_slots":["tmz3"]', prompt)
        self.assertIn("其他候选的 matched_slots 必须为空数组", prompt)
        self.assertNotIn("同时判断 tmz1..tmz5", prompt)

    def test_targeted_slot_prompt_supports_independent_yq1_template(self):
        prompt = shenhui_shoe_packaging._shoe_targeted_slot_prompt(
            "204426146036",
            "60301",
            {"I02": "tmz2-candidate.jpg", "I10": "yq1-candidate.jpg"},
            "婴童",
            target_slot="yq1",
            candidate_sheet_count=1,
            has_reference_image=True,
        )

        self.assertIn("本轮只裁决 yq1", prompt)
        self.assertIn("第2张图是 yq1 的唯一精确模板", prompt)
        self.assertIn("前鞋斜前方展示", prompt)
        self.assertIn("后鞋鞋底朝向镜头", prompt)
        self.assertIn("精确匹配等价的 tmz2 模板则允许复用", prompt)
        self.assertIn('"matched_slots":["yq1"]', prompt)

    def test_pose_strategy_aliases_are_normalized(self):
        self.assertEqual(
            shenhui_shoe_packaging.SHOE_POSE_DEFAULT_STRATEGY,
            shenhui_shoe_packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
        )
        self.assertEqual(
            shenhui_shoe_packaging.normalize_shoe_pose_strategy("global"),
            shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
        )
        self.assertEqual(
            shenhui_shoe_packaging.normalize_shoe_pose_strategy("panorama"),
            shenhui_shoe_packaging.SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
        )
        self.assertEqual(
            shenhui_shoe_packaging.normalize_shoe_pose_strategy("all-in-one"),
            shenhui_shoe_packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
        )

    def test_main_pose_template_is_cut_into_category_slot_references(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            template = root / "template.jpg"
            image = Image.new("RGB", (400, 500), (255, 255, 255))
            draw = ImageDraw.Draw(image)
            for row in range(5):
                for column in range(4):
                    color = (
                        20 + column * 50,
                        30 + row * 40,
                        220 - column * 30,
                    )
                    draw.rectangle(
                        (
                            column * 100,
                            row * 100,
                            column * 100 + 99,
                            row * 100 + 99,
                        ),
                        fill=color,
                    )
            image.save(template)

            refs = shenhui_shoe_packaging._create_main_pose_reference_cells(
                template,
                root / "cells",
            )

            self.assertEqual(
                set(refs),
                {"雪地", "运动", "婴童", "休闲"},
            )
            self.assertEqual(len(refs["婴童"]), 5)
            for paths in refs.values():
                for path in paths:
                    self.assertTrue(path.is_file())
                    with Image.open(path) as reference:
                        self.assertLessEqual(max(reference.size), 900)

    def test_yq_template_is_cut_into_three_slot_references(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            template = root / "yq-template.jpg"
            image = Image.new("RGB", (600, 240), (255, 255, 255))
            draw = ImageDraw.Draw(image)
            for column, color in enumerate(((220, 40, 40), (40, 220, 40), (40, 40, 220))):
                draw.rectangle((column * 200, 0, column * 200 + 199, 239), fill=color)
            image.save(template)

            refs = shenhui_shoe_packaging._create_yq_reference_cells(
                template,
                root / "yq-cells",
            )

            self.assertEqual(set(refs), {"yq1", "yq2", "yq3"})
            expected_dominant_channel = {"yq1": 0, "yq2": 1, "yq3": 2}
            for slot, path in refs.items():
                self.assertTrue(path.is_file(), slot)
                with Image.open(path) as reference:
                    self.assertEqual(reference.size, (200, 240))
                    pixel = reference.convert("RGB").getpixel((100, 120))
                    self.assertEqual(
                        pixel.index(max(pixel)),
                        expected_dominant_channel[slot],
                    )

    def test_targeted_slot_contact_sheets_use_large_tiles_and_keep_candidate_ids(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {}
            entries_by_name = {}
            for index in range(1, 10):
                candidate_id = f"I{index:02d}"
                filename = f"candidate-{index}.jpg"
                source = root / filename
                Image.new("RGB", (900, 700), (index * 17, 90, 160)).save(source)
                candidate_ids[candidate_id] = filename
                entries_by_name[filename] = {"filename": filename, "path": source}

            sheets, rendered = (
                shenhui_shoe_packaging._create_targeted_slot_contact_sheets(
                    "yq3",
                    candidate_ids,
                    entries_by_name,
                    root / "60301-focused-yq3.jpg",
                    round_index=1,
                )
            )

            self.assertEqual(len(sheets), 3)
            self.assertEqual(rendered, candidate_ids)
            for sheet in sheets:
                self.assertTrue(sheet.is_file())
                self.assertIn("focused-yq3-round1", sheet.name)
                with Image.open(sheet) as opened:
                    self.assertEqual(opened.width, 840)
                    self.assertGreaterEqual(opened.height, 354)

    def test_targeted_slot_contact_sheets_embed_reference_template_header(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {}
            entries_by_name = {}
            for index in range(1, 5):
                candidate_id = f"I{index:02d}"
                filename = f"candidate-{index}.jpg"
                source = root / filename
                Image.new("RGB", (900, 700), (40, index * 30, 160)).save(source)
                candidate_ids[candidate_id] = filename
                entries_by_name[filename] = {"filename": filename, "path": source}
            reference = root / "yq3-template.jpg"
            Image.new("RGB", (300, 300), (240, 20, 20)).save(reference)

            sheets, rendered = (
                shenhui_shoe_packaging._create_targeted_slot_contact_sheets(
                    "yq3",
                    candidate_ids,
                    entries_by_name,
                    root / "60301-focused-yq3.jpg",
                    round_index=1,
                    reference_image=reference,
                )
            )

            self.assertEqual(len(sheets), 1)
            self.assertEqual(rendered, candidate_ids)
            with Image.open(sheets[0]) as opened:
                self.assertEqual(opened.width, 840)
                self.assertGreaterEqual(opened.height, 1000)
                pixels = opened.convert("RGB")
                for y in (80, 200, 320):
                    red, green, blue = pixels.getpixel((420, y))
                    self.assertGreater(red, 180)
                    self.assertLess(green, 80)
                    self.assertLess(blue, 80)

    def test_wpz5_targeted_pool_excludes_occupied_and_pair_conflict_families(self):
        candidate_ids = {
            "I12": "GUDO7255.jpg",
            "I17": "GUDO7378.jpg",
            "I18": "pair-conflict.jpg",
            "I23": "shoe-box.jpg",
        }
        focused_slots = {
            "tmz2": "I17",
            "wpz": ["", "I17", "", "", "", "I23"],
            "yq": ["", "", ""],
        }
        prior_facts = [
            {
                "model_id": "model-a",
                "candidate_facts": [
                    _candidate_fact(
                        "I18",
                        filename="pair-conflict.jpg",
                        shoe_count="pair",
                    )
                ],
            },
            {
                "model_id": "model-b",
                "candidate_facts": [
                    _candidate_fact(
                        "I18",
                        filename="pair-conflict.jpg",
                        shoe_count="pair",
                    )
                ],
            },
        ]

        filtered, exclusions = (
            shenhui_shoe_packaging._targeted_slot_candidate_ids(
                "wpz5",
                candidate_ids,
                focused_slots=focused_slots,
                candidate_facts_by_model=prior_facts,
                required_votes=2,
            )
        )

        self.assertEqual(filtered, {"I12": "GUDO7255.jpg"})
        self.assertIn("I17", exclusions)
        self.assertIn("tmz2", exclusions["I17"])
        self.assertIn("I18", exclusions)
        self.assertIn("pair", exclusions["I18"])
        self.assertIn("I23", exclusions)
        self.assertIn("wpz6", exclusions["I23"])

    def test_batch_targeted_pool_keeps_all_prior_slot_nominees_only(self):
        candidate_ids = {
            "I01": "nominee-a.jpg",
            "I02": "unrelated.jpg",
            "I03": "nominee-b.jpg",
            "I04": "unvoted.jpg",
        }
        prior_facts = [
            {
                "model_id": "model-a",
                "candidate_facts": [
                    _candidate_fact("I01", "tmz1", filename="nominee-a.jpg"),
                    _candidate_fact("I02", "tmz2", filename="unrelated.jpg"),
                ],
            },
            {
                "model_id": "model-b",
                "candidate_facts": [
                    _candidate_fact("I03", "tmz1", filename="nominee-b.jpg"),
                ],
            },
        ]

        filtered, exclusions = shenhui_shoe_packaging._targeted_slot_candidate_ids(
            "tmz1",
            candidate_ids,
            focused_slots={},
            candidate_facts_by_model=prior_facts,
            required_votes=2,
            prefer_prior_slot_nominations=True,
        )

        self.assertEqual(
            filtered,
            {"I01": "nominee-a.jpg", "I03": "nominee-b.jpg"},
        )
        self.assertIn("not nominated", exclusions["I02"])
        self.assertIn("not nominated", exclusions["I04"])

    def test_wpz5_targeted_pool_geometry_accepts_complete_yk_and_rejects_bad_geometry(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            def write_candidate(
                name: str,
                *,
                background: tuple[int, int, int],
                box: tuple[int, int, int, int],
            ) -> Path:
                path = root / name
                image = Image.new("RGB", (400, 400), background)
                ImageDraw.Draw(image).rounded_rectangle(
                    box,
                    radius=18,
                    fill=(120, 70, 70),
                )
                image.save(path)
                return path

            paths = {
                "pose5-gray.jpg": write_candidate(
                    "pose5-gray.jpg",
                    background=(242, 242, 242),
                    box=(140, 80, 260, 300),
                ),
                "horizontal-gray.jpg": write_candidate(
                    "horizontal-gray.jpg",
                    background=(242, 242, 242),
                    box=(80, 140, 320, 260),
                ),
                "pose5-white.jpg": write_candidate(
                    "pose5-white.jpg",
                    background=(255, 255, 255),
                    box=(140, 80, 260, 300),
                ),
                "yk1.jpg": write_candidate(
                    "yk1.jpg",
                    background=(242, 242, 242),
                    box=(140, 80, 260, 300),
                ),
            }
            candidate_ids = {
                "I01": "pose5-gray.jpg",
                "I02": "horizontal-gray.jpg",
                "I03": "pose5-white.jpg",
                "I04": "yk1.jpg",
            }
            entries_by_name = {
                name: {"filename": name, "path": path}
                for name, path in paths.items()
            }

            filtered, excluded = (
                shenhui_shoe_packaging._targeted_slot_candidate_ids(
                    "wpz5",
                    candidate_ids,
                    focused_slots={},
                    candidate_facts_by_model=[],
                    required_votes=2,
                    entries_by_name=entries_by_name,
                    shoe_category="婴童",
                )
            )

            self.assertEqual(
                filtered,
                {
                    "I01": "pose5-gray.jpg",
                    "I04": "yk1.jpg",
                },
            )
            self.assertIn("pose5 geometry", excluded["I02"])
            self.assertIn("gray background", excluded["I03"])

    def test_wpz5_verified_gray_pose5_geometry_survives_small_batch_pair_votes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            path = root / "gray-pose5.jpg"
            image = Image.new("RGB", (400, 400), (242, 242, 242))
            ImageDraw.Draw(image).rounded_rectangle(
                (140, 80, 260, 300),
                radius=18,
                fill=(120, 70, 70),
            )
            image.save(path)
            prior_facts = [
                {
                    "model_id": model_id,
                    "candidate_facts": [
                        _candidate_fact(
                            "I01",
                            filename=path.name,
                            shoe_count="pair",
                        )
                    ],
                }
                for model_id in ("model-a", "model-b")
            ]

            filtered, exclusions = (
                shenhui_shoe_packaging._targeted_slot_candidate_ids(
                    "wpz5",
                    {"I01": path.name},
                    focused_slots={},
                    candidate_facts_by_model=prior_facts,
                    required_votes=2,
                    entries_by_name={
                        path.name: {"filename": path.name, "path": path},
                    },
                    shoe_category="婴童",
                )
            )

            self.assertEqual(filtered, {"I01": path.name})
            self.assertNotIn("I01", exclusions)

    def test_wpz5_prefers_gray_visual_pair_of_exact_tmz5_before_ai_vote(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            def write_candidate(
                name: str,
                *,
                background: tuple[int, int, int],
                box: tuple[int, int, int, int],
            ) -> Path:
                path = root / name
                image = Image.new("RGB", (400, 400), background)
                ImageDraw.Draw(image).rounded_rectangle(
                    box,
                    radius=18,
                    fill=(120, 70, 70),
                )
                image.save(path)
                return path

            paths = {
                "204426146036-60301.jpg": write_candidate(
                    "204426146036-60301.jpg",
                    background=(255, 255, 255),
                    box=(140, 80, 260, 300),
                ),
                "paired-gray.jpg": write_candidate(
                    "paired-gray.jpg",
                    background=(242, 242, 242),
                    box=(140, 80, 260, 300),
                ),
                "other-gray.jpg": write_candidate(
                    "other-gray.jpg",
                    background=(242, 242, 242),
                    box=(115, 75, 285, 315),
                ),
            }
            candidate_ids = {
                "I01": "204426146036-60301.jpg",
                "I02": "paired-gray.jpg",
                "I03": "other-gray.jpg",
            }

            filtered, exclusions = (
                shenhui_shoe_packaging._targeted_slot_candidate_ids(
                    "wpz5",
                    candidate_ids,
                    focused_slots={
                        "tmz5": "I01",
                        "wpz": ["", "", "", "", "", ""],
                        "yq": ["", "", ""],
                    },
                    candidate_facts_by_model=[],
                    required_votes=2,
                    entries_by_name={
                        name: {"filename": name, "path": path}
                        for name, path in paths.items()
                    },
                    shoe_category="婴童",
                    prefer_exact_tmz5_visual_pair=True,
                )
            )

            self.assertEqual(filtered, {"I02": "paired-gray.jpg"})
            self.assertIn("visual pair", exclusions["I03"])

    def test_yq1_targeted_pool_preserves_equivalent_tmz2_wpz2_family(self):
        candidate_ids = {
            "I02": "shared-pose2.jpg",
            "I10": "independent-yq1.jpg",
        }
        focused_slots = {
            "tmz2": "I02",
            "wpz": ["", "I02", "", "", "", ""],
            "yq": ["", "", ""],
        }

        filtered, exclusions = (
            shenhui_shoe_packaging._targeted_slot_candidate_ids(
                "yq1",
                candidate_ids,
                focused_slots=focused_slots,
                candidate_facts_by_model=[],
                required_votes=2,
            )
        )

        self.assertEqual(filtered, candidate_ids)
        self.assertNotIn("I02", exclusions)

    def test_wpz5_targeted_pool_preserves_tmz5_family_and_excludes_yq1_box(self):
        candidate_ids = {
            "I05": "pose5-white.jpg",
            "I06": "pose5-gray.jpg",
            "I07": "box.jpg",
            "I10": "yq1.jpg",
        }
        focused_slots = {
            "tmz5": "I05",
            "wpz": ["", "", "", "", "", "I07"],
            "yq": ["I10", "", ""],
        }

        filtered, exclusions = (
            shenhui_shoe_packaging._targeted_slot_candidate_ids(
                "wpz5",
                candidate_ids,
                focused_slots=focused_slots,
                candidate_facts_by_model=[],
                required_votes=2,
            )
        )

        self.assertIn("I05", filtered)
        self.assertIn("I06", filtered)
        self.assertIn("I07", exclusions)
        self.assertIn("wpz6", exclusions["I07"])
        self.assertIn("I10", exclusions)
        self.assertIn("yq1", exclusions["I10"])

    def test_wpz6_targeted_pool_excludes_locked_shoe_families(self):
        candidate_ids = {
            "I01": "tmz1.jpg",
            "I05": "tmz5.jpg",
            "I06": "wpz5.jpg",
            "I07": "box.jpg",
            "I10": "yq1.jpg",
        }
        focused_slots = {
            "tmz1": "I01",
            "tmz5": "I05",
            "wpz": ["I01", "", "", "", "I06", ""],
            "yq": ["I10", "", ""],
        }

        filtered, exclusions = (
            shenhui_shoe_packaging._targeted_slot_candidate_ids(
                "wpz6",
                candidate_ids,
                focused_slots=focused_slots,
                candidate_facts_by_model=[],
                required_votes=2,
            )
        )

        self.assertEqual(filtered, {"I07": "box.jpg"})
        for candidate_id, occupied_slot in (
            ("I01", "tmz1"),
            ("I05", "tmz5"),
            ("I06", "wpz5"),
            ("I10", "yq1"),
        ):
            self.assertIn(candidate_id, exclusions)
            self.assertIn(occupied_slot, exclusions[candidate_id])

    def test_targeted_round_finalists_keep_only_route_nominees(self):
        candidate_ids = {
            "I03": "yk3.jpg",
            "I18": "GUDO7380.jpg",
            "I22": "GUDO7384.jpg",
        }
        payloads = [
            {
                "_model_id": "model-a",
                "color_name": "梦幻粉60301",
                "shoe_category": "婴童",
                "candidates": [
                    _candidate_fact(
                        "I03",
                        "yq3",
                        filename="yk3.jpg",
                        shoe_count="single",
                        side="outer",
                    )
                ],
            },
            {
                "_model_id": "model-b",
                "color_name": "梦幻粉60301",
                "shoe_category": "婴童",
                "candidates": [
                    _candidate_fact(
                        "I18",
                        "yq3",
                        filename="GUDO7380.jpg",
                        shoe_count="single",
                        side="outer",
                    )
                ],
            },
        ]

        finalists = shenhui_shoe_packaging._targeted_round_finalist_ids(
            payloads,
            candidate_ids,
            "yq3",
            "婴童",
        )

        self.assertEqual(
            finalists,
            {"I03": "yk3.jpg", "I18": "GUDO7380.jpg"},
        )

    def test_global_pages_contact_inputs_use_twelve_stable_ids_per_page(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            entries = []
            for index in range(25):
                path = root / f"{index + 1}.jpg"
                Image.new("RGB", (60, 40), (index, index, index)).save(path)
                entries.append({"path": path, "filename": path.name})

            sheets, candidate_ids, overview = shenhui_shoe_packaging._create_pose_contact_inputs(
                entries,
                root / "contact.jpg",
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
            )

            self.assertEqual(len(sheets), 3)
            self.assertIsNone(overview)
            self.assertEqual(candidate_ids["I01"], "1.jpg")
            self.assertEqual(candidate_ids["I12"], "12.jpg")
            self.assertEqual(candidate_ids["I13"], "13.jpg")
            self.assertEqual(candidate_ids["I25"], "25.jpg")

    def test_prompt_spells_out_new_shared_main_pose_one(self):
        prompt = shenhui_shoe_packaging._shoe_selection_prompt(
            "204325141014",
            "90001",
            {"I01": "candidate.jpg"},
            "休闲",
        )

        self.assertIn("第二张图是鞋品主图姿势模板", prompt)
        self.assertIn("第三张图是鞋品海报姿势模板", prompt)
        self.assertIn("第四张图是 yq 三姿势参考模板", prompt)
        self.assertIn("tmz1/wpz1 必须匹配最新主图模板第1行", prompt)
        self.assertIn("一双鞋或双鞋 3/4 斜前方完整展示", prompt)
        self.assertIn("不能再按旧规则选择单只鞋", prompt)
        self.assertIn("非主推色不输出 o.jpg", prompt)
        self.assertIn("主推色云盘中已经命名为 yk1..ykN", prompt)
        self.assertIn("新版规则中主图5和海报图已经拆开", prompt)
        self.assertIn("休闲海报图不要选择两只鞋竖向上下分开", prompt)

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
        self.assertIn("除雪地靴/秋冬拖鞋/运动靴外", prompt)
        self.assertIn("其他品类的 tmz4/wpz4 都按主图模板第4行", prompt)
        self.assertIn("必须是完整鞋口内里图", prompt)
        self.assertIn("不能只裁到鞋面或鞋头", prompt)
        self.assertIn("雪地是唯一特殊主图4", prompt)
        self.assertIn("鞋面/鞋头局部裁切图", prompt)
        self.assertIn("会从正确的雪地第4姿势鞋口内里图裁切生成 yk1", prompt)

    def test_channel_images_are_excluded_while_tms_and_yk_sources_remain_candidates(self):
        self.assertFalse(
            shenhui_shoe_packaging._is_pose_selection_candidate(
                "208326146209-00317+Ai角度图2.png"
            )
        )
        self.assertTrue(
            shenhui_shoe_packaging._is_pose_selection_candidate(
                "208426141211-00377.jpg"
            )
        )
        self.assertTrue(
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
        features = {
            "wrong.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.30,
                bounding_coverage=0.18,
                background_luma=242.0,
                valid=True,
            ),
            "wrong 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.30,
                bounding_coverage=0.18,
                background_luma=255.0,
                valid=True,
            ),
            "correct.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.58,
                bounding_coverage=0.16,
                background_luma=242.0,
                valid=True,
            ),
            "correct 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.58,
                bounding_coverage=0.16,
                background_luma=255.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
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

        self.assertEqual(ruled["tmz5"], "correct 拷贝.jpg")
        self.assertEqual(ruled["wpz"][4], "correct.jpg")
        self.assertTrue(any("主图5白底单鞋" in item for item in corrections))

    def test_quality_rules_keep_pose_but_swap_tmz_white_and_wpz_gray(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            def draw_pair(path: Path, background: int):
                image = Image.new("RGB", (320, 240), (background,) * 3)
                draw = ImageDraw.Draw(image)
                draw.rounded_rectangle((132, 62, 192, 174), 18, fill=(90, 70, 60))
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
        self.assertTrue(any("原图白底优先" in item for item in corrections))

    def test_quality_rules_pair_tmz5_backgrounds_when_names_differ(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)

            gray = root / "gray-source.jpg"
            white = root / "white-source.jpg"
            mask = Image.new("1", (128, 128), 0)
            ImageDraw.Draw(mask).rounded_rectangle((44, 20, 84, 108), 12, fill=1)
            gray_feature = shenhui_shoe_packaging._BinaryPoseFeature(
                mask=mask.copy(),
                aspect_ratio=0.58,
                bounding_coverage=0.16,
                background_luma=242.0,
                valid=True,
            )
            white_feature = shenhui_shoe_packaging._BinaryPoseFeature(
                mask=mask.copy(),
                aspect_ratio=0.58,
                bounding_coverage=0.16,
                background_luma=255.0,
                valid=True,
            )
            Image.new("RGB", (320, 240), (242, 242, 242)).save(gray)
            Image.new("RGB", (320, 240), (255, 255, 255)).save(white)
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

            with patch.object(
                shenhui_shoe_packaging,
                "_binary_pose_feature",
                side_effect=lambda path: (
                    gray_feature
                    if Path(path).name == gray.name
                    else white_feature
                ),
            ):
                ruled, corrections = (
                    shenhui_shoe_packaging._apply_selection_quality_rules(
                        "婴童",
                        slots,
                        entries,
                    )
                )

        self.assertEqual(ruled["tmz5"], white.name)
        self.assertEqual(ruled["wpz"][4], gray.name)
        self.assertTrue(any("原图白底优先" in item for item in corrections))

    def test_quality_rules_prefers_unpaired_white_single_over_paired_two_shoes(self):
        features = {
            "single-white.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.58,
                bounding_coverage=0.16,
                background_luma=255.0,
                valid=True,
            ),
            "single-gray.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.58,
                bounding_coverage=0.16,
                background_luma=242.0,
                valid=True,
            ),
            "pair 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.78,
                bounding_coverage=0.16,
                background_luma=255.0,
                valid=True,
            ),
            "pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.78,
                bounding_coverage=0.16,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz5": "pair 拷贝.jpg",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "slot3.jpg",
                "slot4.jpg",
                "pair.jpg",
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

        self.assertEqual(ruled["tmz5"], "single-white.jpg")
        self.assertEqual(ruled["wpz"][4], "single-gray.jpg")
        self.assertTrue(any("主图5白底单鞋" in item for item in corrections))

    def test_quality_rules_keep_baby_yq1_when_it_matches_equivalent_tmz2_pose(self):
        features = {
            "pose1.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.30,
                bounding_coverage=0.16,
                background_luma=242.0,
                valid=True,
            ),
            "shared-pose2.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.36,
                bounding_coverage=0.16,
                background_luma=242.0,
                valid=True,
            ),
            "pose3.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.72,
                bounding_coverage=0.15,
                background_luma=242.0,
                valid=True,
            ),
            "pose4.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.20,
                bounding_coverage=0.12,
                background_luma=242.0,
                valid=True,
            ),
            "pose5.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.58,
                bounding_coverage=0.16,
                background_luma=255.0,
                valid=True,
            ),
            "box.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.30,
                bounding_coverage=0.40,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "pose1.jpg",
            "tmz2": "shared-pose2.jpg",
            "tmz3": "pose3.jpg",
            "tmz4": "pose4.jpg",
            "tmz5": "pose5.jpg",
            "wpz": [
                "pose1.jpg",
                "shared-pose2.jpg",
                "pose3.jpg",
                "pose4.jpg",
                "",
                "box.jpg",
            ],
            "yq": ["shared-pose2.jpg", "", ""],
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

        self.assertEqual(ruled["tmz2"], "shared-pose2.jpg")
        self.assertEqual(ruled["wpz"][1], "shared-pose2.jpg")
        self.assertEqual(ruled["yq"][0], "shared-pose2.jpg")
        self.assertFalse(any("yq1" in item and "tmz2" in item for item in corrections))

    def test_quality_rules_keeps_white_pose_five_and_repairs_duplicate_pose_three(self):
        pose5_mask = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(pose5_mask).rounded_rectangle((45, 18, 83, 112), 12, fill=1)
        pose3_mask = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(pose3_mask).polygon(
            [(58, 7), (78, 18), (74, 112), (47, 119), (45, 27)],
            fill=1,
        )
        features = {
            "pose5.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=pose5_mask.copy(),
                aspect_ratio=0.58,
                bounding_coverage=0.160,
                background_luma=242.0,
                valid=True,
            ),
            "pose5 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=pose5_mask.copy(),
                aspect_ratio=0.58,
                bounding_coverage=0.160,
                background_luma=255.0,
                valid=True,
            ),
            "pose3-gray.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=pose3_mask.copy(),
                aspect_ratio=0.66,
                bounding_coverage=0.153,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz3": "pose5 拷贝.jpg",
            "tmz5": "pose3-gray.jpg",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "pose5 拷贝.jpg",
                "slot4.jpg",
                "pose3-gray.jpg",
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

        self.assertEqual(ruled["tmz5"], "pose5 拷贝.jpg")
        self.assertEqual(ruled["wpz"][4], "pose5.jpg")
        self.assertEqual(ruled["tmz3"], "pose3-gray.jpg")
        self.assertEqual(ruled["wpz"][2], "pose3-gray.jpg")
        self.assertTrue(any("主图5白底单鞋" in item for item in corrections))
        self.assertTrue(any("主图3与其他主图姿势重复" in item for item in corrections))

    def test_quality_rules_accepts_close_pose_three_replacement_for_locked_pose_five(self):
        pose5_mask = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(pose5_mask).rounded_rectangle((50, 22, 78, 106), 10, fill=1)
        close_pose3_mask = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(close_pose3_mask).polygon(
            [(54, 12), (78, 20), (75, 100), (50, 111), (45, 31)],
            fill=1,
        )
        features = {
            "pose5.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=pose5_mask.copy(),
                aspect_ratio=0.573,
                bounding_coverage=0.088,
                background_luma=242.0,
                valid=True,
            ),
            "pose5 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=pose5_mask.copy(),
                aspect_ratio=0.573,
                bounding_coverage=0.088,
                background_luma=255.0,
                valid=True,
            ),
            "pose3-close.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=close_pose3_mask.copy(),
                aspect_ratio=0.600,
                bounding_coverage=0.095,
                background_luma=242.0,
                valid=True,
            ),
            "slot1.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=Image.new("1", (128, 128), 1),
                aspect_ratio=1.08,
                bounding_coverage=0.150,
                background_luma=242.0,
                valid=True,
            ),
            "slot2.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=Image.new("1", (128, 128), 1),
                aspect_ratio=0.78,
                bounding_coverage=0.160,
                background_luma=242.0,
                valid=True,
            ),
            "slot4.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=Image.new("1", (128, 128), 1),
                aspect_ratio=1.22,
                bounding_coverage=0.120,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz3": "pose5.jpg",
            "tmz5": "pose5 拷贝.jpg",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "pose5.jpg",
                "slot4.jpg",
                "pose5.jpg",
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

        self.assertEqual(ruled["tmz5"], "pose5 拷贝.jpg")
        self.assertEqual(ruled["wpz"][4], "pose5.jpg")
        self.assertEqual(ruled["tmz3"], "pose3-close.jpg")
        self.assertEqual(ruled["wpz"][2], "pose3-close.jpg")
        self.assertTrue(any("主图3与其他主图姿势重复" in item for item in corrections))

    def test_quality_rules_prefer_gray_source_for_standard_main_slots(self):
        mask = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(mask).rounded_rectangle((22, 38, 110, 90), 18, fill=1)
        features = {
            "pose1.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=mask.copy(),
                aspect_ratio=1.06,
                bounding_coverage=0.205,
                background_luma=242.0,
                valid=True,
                foreground_fill_ratio=0.61,
                foreground_color_bins=31,
                foreground_edge_mean=32.0,
                foreground_saturation_p80=0.10,
            ),
            "pose1 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=mask.copy(),
                aspect_ratio=1.06,
                bounding_coverage=0.205,
                background_luma=255.0,
                valid=True,
                foreground_fill_ratio=0.69,
                foreground_color_bins=34,
                foreground_edge_mean=31.0,
                foreground_saturation_p80=0.10,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "pose1 拷贝.jpg",
            "tmz5": "",
            "wpz": [
                "pose1 拷贝.jpg",
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
                    "休闲",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz1"], "pose1.jpg")
        self.assertEqual(ruled["wpz"][0], "pose1.jpg")
        self.assertTrue(any("同姿势灰底原图" in item for item in corrections))

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
        self.assertTrue(any("主图1最新" in item for item in corrections))
        self.assertTrue(any("yq3" in item for item in corrections))

    def test_quality_rules_replace_old_snow_pose_one_with_latest_pair_pose(self):
        features = {
            "old-single-oblique.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.78,
                bounding_coverage=0.178,
                background_luma=242.0,
                valid=True,
            ),
            "front-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.08,
                bounding_coverage=0.220,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "old-single-oblique.jpg",
            "tmz5": "",
            "wpz": [
                "old-single-oblique.jpg",
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

        self.assertEqual(ruled["tmz1"], "front-pair.jpg")
        self.assertEqual(ruled["wpz"][0], "front-pair.jpg")
        self.assertTrue(any("主图1最新" in item for item in corrections))

    def test_quality_rules_repair_baby_pose_one_to_template_first_row(self):
        features = {
            "old-pose-two-like-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.79,
                bounding_coverage=0.159,
                background_luma=242.0,
                valid=True,
            ),
            "template-row-one-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.09,
                bounding_coverage=0.144,
                background_luma=242.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "old-pose-two-like-pair.jpg",
            "tmz2": "old-pose-two-like-pair 拷贝.jpg",
            "tmz5": "",
            "wpz": [
                "old-pose-two-like-pair.jpg",
                "old-pose-two-like-pair 拷贝.jpg",
                "pose3.jpg",
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
                    "婴童",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz1"], "template-row-one-pair.jpg")
        self.assertEqual(ruled["wpz"][0], "template-row-one-pair.jpg")
        self.assertTrue(any("主图1最新" in item for item in corrections))

    def test_quality_rules_prefers_leisure_main_five_white_single_shoe(self):
        features = {
            "overhead.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.564,
                bounding_coverage=0.160,
                background_luma=242.0,
                valid=True,
            ),
            "overhead 拷贝.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.564,
                bounding_coverage=0.160,
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
            "tmz5": "front-oblique-pair 拷贝.jpg",
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
        self.assertTrue(any("主图5白底单鞋" in item for item in corrections))

    def test_quality_rules_rejects_old_leisure_poster_pose_for_main_five(self):
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
            "tmz5": "00044042 拷贝.jpg",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "slot3.jpg",
                "slot4.jpg",
                "2.jpg",
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

        self.assertEqual(ruled["tmz5"], "00044006 拷贝.jpg")
        self.assertEqual(ruled["wpz"][4], "00044006.jpg")
        self.assertTrue(any("主图5白底单鞋" in item for item in corrections))

    def test_quality_rules_falls_back_to_gray_pose_five_when_no_white_source(self):
        features = {
            "overhead.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.564,
                bounding_coverage=0.160,
                background_luma=242.0,
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

        self.assertEqual(ruled["tmz5"], "overhead.jpg")
        self.assertEqual(ruled["wpz"][4], "overhead.jpg")
        self.assertTrue(any("灰底原图" in item for item in corrections))

    def test_quality_rules_repair_sports_pose_four_from_flat_side_view(self):
        features = {
            "pose1-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.02,
                bounding_coverage=0.22,
                background_luma=242.0,
                valid=True,
            ),
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
                "pose1-pair.jpg",
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
        self.assertTrue(any("主图4/wpz4" in item for item in corrections))

    def test_quality_rules_reject_low_detail_insole_for_latest_main_pose_one(self):
        features = {
            "insole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.86,
                bounding_coverage=0.216,
                background_luma=242.0,
                valid=True,
                foreground_fill_ratio=0.52,
                foreground_color_bins=27,
                foreground_edge_mean=26.0,
                foreground_saturation_p80=0.08,
            ),
            "front-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.12,
                bounding_coverage=0.232,
                background_luma=242.0,
                valid=True,
                foreground_fill_ratio=0.76,
                foreground_color_bins=52,
                foreground_edge_mean=60.0,
                foreground_saturation_p80=0.17,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "insole.jpg",
            "tmz5": "",
            "wpz": [
                "insole.jpg",
                "pose2.jpg",
                "pose3.jpg",
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
                    "运动",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz1"], "front-pair.jpg")
        self.assertEqual(ruled["wpz"][0], "front-pair.jpg")
        self.assertTrue(any("主图1最新" in item for item in corrections))

    def test_quality_rules_reject_insole_for_sports_pose_four(self):
        features = {
            "pose1-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.02,
                bounding_coverage=0.22,
                background_luma=242.0,
                valid=True,
            ),
            "insole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.86,
                bounding_coverage=0.232,
                background_luma=242.0,
                valid=True,
                foreground_fill_ratio=0.38,
                foreground_color_bins=41,
                foreground_edge_mean=23.0,
                foreground_saturation_p80=0.05,
            ),
            "rear-outsole-angle.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.91,
                bounding_coverage=0.123,
                background_luma=242.0,
                valid=True,
                foreground_fill_ratio=0.68,
                foreground_color_bins=78,
                foreground_edge_mean=42.0,
                foreground_saturation_p80=0.08,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "pose1-pair.jpg",
            "tmz4": "insole.jpg",
            "wpz": [
                "pose1-pair.jpg",
                "pose2.jpg",
                "pose3.jpg",
                "insole.jpg",
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
        self.assertTrue(any("主图4/wpz4" in item for item in corrections))

    def test_quality_rules_clear_sports_pose_four_when_only_insole_is_available(self):
        features = {
            "pose1-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.02,
                bounding_coverage=0.22,
                background_luma=242.0,
                valid=True,
            ),
            "insole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.89,
                bounding_coverage=0.232,
                background_luma=242.0,
                valid=True,
                foreground_fill_ratio=0.38,
                foreground_color_bins=41,
                foreground_edge_mean=23.0,
                foreground_saturation_p80=0.05,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "pose1-pair.jpg",
            "tmz4": "insole.jpg",
            "wpz": [
                "pose1-pair.jpg",
                "pose2.jpg",
                "pose3.jpg",
                "insole.jpg",
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

        self.assertEqual(ruled["tmz4"], "")
        self.assertEqual(ruled["wpz"][3], "")
        self.assertTrue(any("已跳过" in item for item in corrections))

    def test_quality_rules_reject_tiny_accessory_for_baby_pose_four(self):
        features = {
            "pose1-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.78,
                bounding_coverage=0.18,
                background_luma=242.0,
                valid=True,
            ),
            "charm.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.15,
                bounding_coverage=0.071,
                background_luma=242.0,
                valid=True,
                foreground_fill_ratio=0.77,
                foreground_color_bins=22,
                foreground_edge_mean=56.0,
                foreground_saturation_p80=0.15,
            ),
            "rear-side-view.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.24,
                bounding_coverage=0.117,
                background_luma=242.0,
                valid=True,
                foreground_fill_ratio=0.72,
                foreground_color_bins=49,
                foreground_edge_mean=29.0,
                foreground_saturation_p80=0.31,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz1": "pose1-pair.jpg",
            "tmz4": "charm.jpg",
            "wpz": [
                "pose1-pair.jpg",
                "pose2.jpg",
                "pose3.jpg",
                "charm.jpg",
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

        self.assertEqual(ruled["tmz4"], "rear-side-view.jpg")
        self.assertEqual(ruled["wpz"][3], "rear-side-view.jpg")
        self.assertTrue(any("主图4/wpz4" in item for item in corrections))

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
        self.assertTrue(any("主图4/wpz4" in item for item in corrections))

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
        self.assertTrue(any("主图4/wpz4" in item for item in corrections))
        self.assertTrue(any("yq3" in item for item in corrections))

    def test_quality_rules_separate_baby_pose_four_from_main_five(self):
        features = {
            "white-single.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.58,
                bounding_coverage=0.14,
                background_luma=255.0,
                valid=True,
            ),
            "gray-single.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.58,
                bounding_coverage=0.14,
                background_luma=242.0,
                valid=True,
            ),
            "rear-side-view.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.22,
                bounding_coverage=0.09,
                background_luma=242.0,
                valid=True,
            ),
            "pose3-vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=0.62,
                bounding_coverage=0.08,
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
            "tmz4": "white-single.jpg",
            "tmz5": "white-single.jpg",
            "wpz": [
                "pose1.jpg",
                "pose2.jpg",
                "pose3-vertical.jpg",
                "white-single.jpg",
                "gray-single.jpg",
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

        self.assertEqual(ruled["tmz5"], "white-single.jpg")
        self.assertEqual(ruled["wpz"][4], "gray-single.jpg")
        self.assertEqual(ruled["tmz4"], "rear-side-view.jpg")
        self.assertEqual(ruled["wpz"][3], "rear-side-view.jpg")
        self.assertTrue(any("主图4/wpz4" in item for item in corrections))

    def test_quality_rules_do_not_force_yq_one_to_baby_main_pose_two(self):
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

        self.assertEqual(ruled["yq"][0], "wrong-yq1.jpg")
        self.assertEqual(ruled["yq"][1], "yk2.jpg")
        self.assertFalse(any("yq1" in item for item in corrections))
        self.assertTrue(any("yq2" in item for item in corrections))

    def test_quality_rules_use_original_yk_as_yq_outsole_fallback(self):
        features = {
            "pose2-front-and-sole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.40,
                bounding_coverage=0.11,
                background_luma=242.0,
                valid=True,
            ),
            "wrong-yq2.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.05,
                bounding_coverage=0.17,
                background_luma=242.0,
                valid=True,
            ),
            "yk4.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.98,
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
        }
        outsole_entries = {
            "pose2-front-and-sole.jpg": entries["pose2-front-and-sole.jpg"],
            "wrong-yq2.jpg": entries["wrong-yq2.jpg"],
        }
        slots = {
            "tmz3": "outer-side.jpg",
            "tmz5": "",
            "wpz": [
                "pose1.jpg",
                "pose2-front-and-sole.jpg",
                "outer-side.jpg",
                "pose4.jpg",
                "pose5.jpg",
                "box.jpg",
            ],
            "yq": [
                "pose2-front-and-sole.jpg",
                "wrong-yq2.jpg",
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

        self.assertEqual(ruled["yq"][1], "yk4.jpg")
        self.assertTrue(any("yq2 完整鞋底已纠正" in item for item in corrections))

    def test_quality_rules_fill_missing_yq_outsole_and_baby_outer_side(self):
        features = {
            "pose2-front-and-sole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.36,
                bounding_coverage=0.16,
                background_luma=242.0,
                valid=True,
            ),
            "complete-outsole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=2.00,
                bounding_coverage=0.14,
                background_luma=242.0,
                valid=True,
            ),
            "baby-outer-side.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.16,
                bounding_coverage=0.33,
                background_luma=223.0,
                valid=True,
            ),
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz2": "pose2-front-and-sole.jpg",
            "wpz": [
                "slot1.jpg",
                "pose2-front-and-sole.jpg",
                "slot3.jpg",
                "slot4.jpg",
                "slot5.jpg",
                "box.jpg",
            ],
            "yq": ["pose2-front-and-sole.jpg", "", ""],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features.get(Path(path).name),
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "婴童",
                    slots,
                    entries,
                    outsole_entries_by_name=entries,
                )
            )

        self.assertEqual(ruled["yq"][1], "complete-outsole.jpg")
        self.assertEqual(ruled["yq"][2], "baby-outer-side.jpg")
        self.assertTrue(any("yq2" in item for item in corrections))
        self.assertTrue(any("yq3" in item for item in corrections))

    def test_quality_rules_fills_missing_pose_two_without_overwriting_yq_one(self):
        features = {
            "pose2-front-and-sole.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=None,
                aspect_ratio=1.38,
                bounding_coverage=0.16,
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
        }
        entries = {
            name: {"filename": name, "path": name}
            for name in features
        }
        slots = {
            "tmz2": "",
            "wpz": [
                "pose1.jpg",
                "",
                "pose3.jpg",
                "pose4.jpg",
                "pose5.jpg",
                "box.jpg",
            ],
            "yq": ["wrong-yq1.jpg", "", ""],
            "yx": "",
        }

        with patch.object(
            shenhui_shoe_packaging,
            "_binary_pose_feature",
            side_effect=lambda path: features.get(Path(path).name),
        ):
            ruled, corrections = (
                shenhui_shoe_packaging._apply_selection_quality_rules(
                    "婴童",
                    slots,
                    entries,
                )
            )

        self.assertEqual(ruled["tmz2"], "pose2-front-and-sole.jpg")
        self.assertEqual(ruled["wpz"][1], "pose2-front-and-sole.jpg")
        self.assertEqual(ruled["yq"][0], "wrong-yq1.jpg")
        self.assertTrue(any("主图2" in item for item in corrections))
        self.assertFalse(any("yq1" in item for item in corrections))

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

    def test_quality_rules_keep_baby_side_pose_three_when_pose_five_pair_exists(self):
        side_pose3 = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(side_pose3).polygon(
            [
                (30, 28),
                (77, 13),
                (100, 34),
                (93, 87),
                (64, 117),
                (35, 95),
            ],
            fill=1,
        )
        front_pose5 = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(front_pose5).rounded_rectangle((45, 18, 83, 112), 12, fill=1)
        two_shoe_pair = Image.new("1", (128, 128), 0)
        ImageDraw.Draw(two_shoe_pair).ellipse((38, 15, 92, 64), fill=1)
        ImageDraw.Draw(two_shoe_pair).ellipse((26, 62, 102, 116), fill=1)
        features = {
            "pose3-side-gray.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=side_pose3,
                aspect_ratio=0.89,
                bounding_coverage=0.127,
                background_luma=242.0,
                valid=True,
            ),
            "two-shoe-pair.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=two_shoe_pair,
                aspect_ratio=0.78,
                bounding_coverage=0.159,
                background_luma=242.0,
                valid=True,
            ),
            "pose5-gray.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=front_pose5,
                aspect_ratio=0.57,
                bounding_coverage=0.092,
                background_luma=242.0,
                valid=True,
            ),
            "pose5-white.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=front_pose5.copy(),
                aspect_ratio=0.57,
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
            "tmz3": "pose5-gray.jpg",
            "tmz5": "pose5-white.jpg",
            "wpz": [
                "slot1.jpg",
                "slot2.jpg",
                "pose5-gray.jpg",
                "slot4.jpg",
                "pose3-side-gray.jpg",
                "box.jpg",
            ],
            "yq": ["slot2.jpg", "pose3-side-gray.jpg", ""],
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

        self.assertEqual(ruled["tmz3"], "pose3-side-gray.jpg")
        self.assertEqual(ruled["wpz"][2], "pose3-side-gray.jpg")
        self.assertEqual(ruled["yq"][1], "")
        self.assertEqual(ruled["tmz5"], "pose5-white.jpg")
        self.assertEqual(ruled["wpz"][4], "pose5-gray.jpg")
        self.assertTrue(any("yq2 不是完整鞋底" in item for item in corrections))
        self.assertFalse(
            any("主图3与其他主图姿势重复" in item for item in corrections)
        )

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
                bounding_coverage=0.104,
                background_luma=242.0,
                valid=True,
            ),
            "front-vertical.jpg": shenhui_shoe_packaging._BinaryPoseFeature(
                mask=front_vertical,
                aspect_ratio=0.56,
                bounding_coverage=0.092,
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
            "front-pair-boot.jpg": (
                shenhui_shoe_packaging._BinaryPoseFeature(
                    mask=None,
                    aspect_ratio=1.08,
                    bounding_coverage=0.220,
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

        self.assertEqual(ruled["tmz1"], "front-pair-boot.jpg")
        self.assertEqual(ruled["wpz"][0], "front-pair-boot.jpg")
        self.assertTrue(any("主图1最新" in item for item in corrections))

    def test_label_ocr_default_uses_auto_model_chain(self):
        self.assertEqual(
            shenhui_shoe_packaging.SHOE_LABEL_OCR_MODEL,
            "gpt-5.6-sol",
        )
        self.assertEqual(
            shenhui_shoe_packaging.SHOE_LABEL_OCR_DEFAULT_MODEL_CHAIN,
            (
                "gpt-5.6-sol",
                "gemini-3.5-flash",
                "qwen3.7-plus",
                "gpt-5.6-terra",
                "kimi-k2.7-code",
                "deepseek-official-v4-flash-vision-exp",
            ),
        )
        self.assertEqual(
            shenhui_shoe_packaging._shoe_label_model_ids(
                "",
                {"ai": {"llm": {"api_key": "gateway-key"}}},
            ),
            list(shenhui_shoe_packaging.SHOE_LABEL_OCR_DEFAULT_MODEL_CHAIN),
        )
        self.assertEqual(
            shenhui_shoe_packaging._shoe_label_model_ids(
                "",
                {"ai": {"llm": {"api_key": "gateway-key", "deepseek_api_key": "deepseek-key"}}},
                ["gpt-5.6-terra", "gpt-5.6-luna"],
            ),
            [
                "gpt-5.6-terra",
                "gpt-5.6-luna",
            ],
        )

    def test_auto_pose_model_uses_evaluated_default_chain(self):
        self.assertEqual(
            shenhui_shoe_packaging._shoe_pose_model_ids(
                "multi-model",
                {"ai": {"llm": {"api_key": "gateway-key"}}},
            ),
            [
                shenhui_shoe_packaging.SHOE_POSE_DEFAULT_MODEL,
                *shenhui_shoe_packaging.SHOE_POSE_DEFAULT_FALLBACK_MODELS,
            ],
        )

    def test_blank_label_model_uses_primary_model_before_fallbacks(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs["model_id"])
            return (
                {
                    "style_code": "204426140034",
                    "product_name": "儿童休闲鞋",
                    "color_name": "黑红色调00396",
                    "color_code": "00396",
                    "label_bbox": [100, 100, 900, 800],
                    "style_code_bbox": [180, 520, 520, 580],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color_label(
                style_code="204426140034",
                color_code="00396",
                label_image="data:image/jpeg;base64,/9j/2Q==",
                model_id="gpt-5.6-terra",
                label_model_id="",
                fallback_model_ids=["gpt-5.6-luna", "gpt-5.6-sol"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(calls, ["gpt-5.6-terra"])
        self.assertEqual(payload["_model_id"], "gpt-5.6-terra")

    def test_label_ocr_falls_back_when_model_returns_wrong_color_code(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs["model_id"])
            color_code = "00392" if kwargs["model_id"] == "gpt-5.6-sol" else "00396"
            return (
                {
                    "style_code": "204426140034",
                    "product_name": "儿童运动鞋",
                    "color_name": f"黑红色调{color_code}",
                    "color_code": color_code,
                    "label_bbox": [100, 100, 900, 800],
                    "style_code_bbox": [180, 520, 520, 580],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        logs = []
        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color_label(
                style_code="204426140034",
                color_code="00396",
                label_image="data:image/jpeg;base64,/9j/2Q==",
                label_model_id="gpt-5.6-sol",
                fallback_model_ids=["gemini-3.5-flash"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
                log=logs.append,
            )

        self.assertEqual(
            calls,
            [
                "gpt-5.6-sol",
                "gemini-3.5-flash",
            ],
        )
        self.assertEqual(payload["_model_id"], "gemini-3.5-flash")
        self.assertIn("色码不一致", payload["_model_attempt_warnings"])
        self.assertTrue(any("色码不一致" in item for item in logs))

    def test_label_ocr_falls_back_when_model_omits_style_bbox(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs["model_id"])
            payload = {
                "style_code": "204426140034",
                "product_name": "儿童运动鞋",
                "color_name": "黑红色调00396",
                "color_code": "00396",
                "label_bbox": [100, 100, 900, 800],
            }
            if kwargs["model_id"] == "gpt-5.6-terra":
                payload["style_code_bbox"] = [180, 520, 520, 580]
            return (
                payload,
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color_label(
                style_code="204426140034",
                color_code="00396",
                label_image="data:image/jpeg;base64,/9j/2Q==",
                label_model_id="gpt-5.6-sol",
                fallback_model_ids=["gpt-5.6-terra"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(
            calls,
            [
                "gpt-5.6-sol",
                "gpt-5.6-terra",
            ],
        )
        self.assertEqual(payload["_model_id"], "gpt-5.6-terra")
        self.assertIn("款号文字坐标", payload["_model_attempt_warnings"])

    def test_missing_label_color_falls_back_to_pose_color_with_warning(self):
        color_name, warning = shenhui_shoe_packaging._resolve_label_color_name(
            current_color_name="白红色调00316",
            color_code="00316",
            label_payload={"color_name": ""},
        )

        self.assertEqual(color_name, "白红色调00316")
        self.assertIn("已沿用姿势识别颜色名", warning)

    def test_local_label_transcription_replaces_abbreviated_model_color_name(self):
        model_payload = {
            "style_code": "204426146036",
            "product_name": "婴童学步鞋",
            "color_name": "粉色60301",
            "color_code": "60301",
            "label_bbox": [100, 100, 900, 900],
            "style_code_bbox": [300, 100, 700, 200],
            "_model_id": "gpt-5.6-sol",
        }
        with patch.object(
            shenhui_shoe_packaging.ocr_service,
            "extract_shoe_label_fields",
            return_value={
                "color_name": "梦幻粉60301",
                "product_name": "婴童学步鞋产品等级合格品",
                "confidence": 94,
                "source": "local_tesseract_explicit_label_field",
            },
        ):
            refined = shenhui_shoe_packaging._verify_label_payload_with_local_ocr(
                model_payload,
                label_source_image="shoe-box.jpg",
                style_code="204426146036",
                color_code="60301",
            )

        self.assertEqual(refined["color_name"], "梦幻粉60301")
        self.assertEqual(refined["product_name"], "婴童学步鞋")
        self.assertEqual(
            refined["_label_transcription"]["model_color_name"],
            "粉色60301",
        )
        self.assertEqual(
            refined["_label_transcription"]["source"],
            "local_tesseract_explicit_label_field",
        )

    def test_local_label_transcription_replaces_wrong_middle_row_style_bbox(self):
        model_payload = {
            "style_code": "204426140143",
            "product_name": "儿童运动鞋",
            "color_name": "黑灰色00392",
            "color_code": "00392",
            "label_bbox": [100, 100, 900, 900],
            # The vision model confused the label's shoe/size row for the
            # printed style-code row.
            "style_code_bbox": [100, 400, 900, 600],
            "_model_id": "gpt-5.6-sol",
        }
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "shoe-box.jpg"
            Image.new("RGB", (1000, 1000), (240, 240, 240)).save(source)
            with (
                patch.object(
                    shenhui_shoe_packaging.ocr_service,
                    "extract_shoe_label_fields",
                    return_value={
                        "color_name": "黑灰色00392",
                        "product_name": "儿童运动鞋",
                        "confidence": 90,
                        "source": "local_tesseract_explicit_label_field",
                    },
                ),
                patch.object(
                    shenhui_shoe_packaging.ocr_service,
                    "recognize_image_with_tesseract_js",
                    return_value={
                        "words": [
                            shenhui_shoe_packaging.ocr_service.OcrWord(
                                text="204426140143",
                                confidence=88,
                                bbox=(310, 130, 620, 180),
                            )
                        ]
                    },
                ) as recognize,
            ):
                refined = shenhui_shoe_packaging._verify_label_payload_with_local_ocr(
                    model_payload,
                    label_source_image=source,
                    style_code="204426140143",
                    color_code="00392",
                )

        recognize.assert_called_once()
        self.assertEqual(refined["style_code_bbox"], [310.0, 130.0, 620.0, 180.0])
        self.assertEqual(
            refined["_label_transcription"]["style_code_bbox_source"],
            "local_tesseract_exact_style_code",
        )

    def test_local_label_transcription_uses_ai_color_when_local_ocr_confirms_style(self):
        model_payload = {
            "style_code": "204426146023",
            "product_name": "婴童稳步鞋",
            "color_name": "咖色调00355",
            "color_code": "00355",
            "label_bbox": [420, 360, 880, 650],
            "style_code_bbox": [520, 380, 760, 440],
            "_model_id": "gpt-5.6-sol",
        }
        with patch.object(
            shenhui_shoe_packaging.ocr_service,
            "extract_shoe_label_fields",
            return_value={
                "color_name": "",
                "product_name": "婴童稳步鞋",
                "confidence": 59,
                "source": "local_tesseract_explicit_label_field",
                "observed_text": "balabala 204426146023 产品名称 婴童稳步鞋",
            },
        ):
            refined = shenhui_shoe_packaging._verify_label_payload_with_local_ocr(
                model_payload,
                label_source_image="shoe-box.jpg",
                style_code="204426146023",
                color_code="00355",
            )

        self.assertEqual(refined["color_name"], "咖色调00355")
        self.assertEqual(
            refined["_label_transcription"]["source"],
            "local_tesseract_style_identity_ai_color_fallback",
        )
        self.assertTrue(refined["_label_transcription"]["style_identity_verified"])

    def test_local_label_transcription_recovers_color_from_style_code_anchor(self):
        model_payload = {
            "style_code": "204426146023",
            "product_name": "婴童稳步鞋",
            "color_name": "黑色00355",
            "color_code": "00355",
            "label_bbox": [560, 370, 890, 740],
            "style_code_bbox": [530, 390, 660, 430],
            "_model_id": "gpt-5.6-sol",
        }
        with patch.object(
            shenhui_shoe_packaging.ocr_service,
            "extract_shoe_label_fields",
            side_effect=[
                {
                    "color_name": "",
                    "product_name": "",
                    "confidence": 74,
                    "source": "local_tesseract_explicit_label_field",
                    "observed_text": "204426146023",
                },
                {
                    "color_name": "咖色调00355",
                    "product_name": "婴童稳步鞋",
                    "confidence": 71,
                    "source": "local_tesseract_explicit_label_field",
                    "observed_text": "颜色 咖色调00355",
                },
            ],
        ) as extract:
            refined = shenhui_shoe_packaging._verify_label_payload_with_local_ocr(
                model_payload,
                label_source_image="shoe-box.jpg",
                style_code="204426146023",
                color_code="00355",
            )

        self.assertEqual(extract.call_count, 2)
        self.assertEqual(refined["color_name"], "咖色调00355")
        self.assertEqual(
            refined["_label_transcription"]["source"],
            "local_tesseract_style_anchor_recovery",
        )
        self.assertAlmostEqual(refined["label_bbox"][0], 439.0)
        self.assertAlmostEqual(refined["label_bbox"][3], 649.5)

    def test_local_label_transcription_expands_tight_label_after_anchor_misses(self):
        model_payload = {
            "style_code": "204426141127",
            "product_name": "儿童板鞋",
            "color_name": "灰色调00322",
            "color_code": "00322",
            "label_bbox": [480, 300, 750, 570],
            "style_code_bbox": [570, 320, 690, 360],
            "_model_id": "gpt-5.6-sol",
        }
        empty_result = {
            "color_name": "",
            "product_name": "儿童板鞋",
            "confidence": 85,
            "source": "local_tesseract_explicit_label_field",
            "observed_text": "204426141127 产品名称 儿童板鞋",
        }
        with patch.object(
            shenhui_shoe_packaging.ocr_service,
            "extract_shoe_label_fields",
            side_effect=[
                empty_result,
                empty_result,
                {
                    "color_name": "灰色调00322",
                    "product_name": "儿童板鞋",
                    "confidence": 70,
                    "source": "local_tesseract_explicit_label_field",
                    "observed_text": "颜色 灰色调00322",
                },
            ],
        ) as extract:
            refined = shenhui_shoe_packaging._verify_label_payload_with_local_ocr(
                model_payload,
                label_source_image="shoe-box.jpg",
                style_code="204426141127",
                color_code="00322",
            )

        self.assertEqual(extract.call_count, 3)
        self.assertEqual(refined["color_name"], "灰色调00322")
        self.assertEqual(
            refined["_label_transcription"]["source"],
            "local_tesseract_expanded_label_recovery",
        )
        self.assertAlmostEqual(refined["label_bbox"][0], 426.0)
        self.assertAlmostEqual(refined["label_bbox"][3], 624.0)

    def test_ai_label_color_fallback_requires_two_independent_model_families(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs["model_id"])
            return (
                {
                    "style_code": "204426146023",
                    "product_name": "婴童稳步鞋",
                    "color_name": "咖色调00355",
                    "color_code": "00355",
                    "label_bbox": [420, 360, 880, 650],
                    "style_code_bbox": [520, 380, 760, 440],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with (
            patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ),
            patch.object(
                shenhui_shoe_packaging.ocr_service,
                "extract_shoe_label_fields",
                return_value={
                    "color_name": "",
                    "product_name": "婴童稳步鞋",
                    "confidence": 59,
                    "source": "local_tesseract_explicit_label_field",
                    "observed_text": "balabala 204426146023",
                },
            ),
        ):
            payload = shenhui_shoe_packaging._default_analyze_color_label(
                style_code="204426146023",
                color_code="00355",
                label_image="label.jpg",
                label_source_image="shoe-box.jpg",
                label_model_id="gpt-5.6-sol",
                fallback_model_ids=["gemini-3.5-flash"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(
            calls,
            [
                "gpt-5.6-sol",
                "gpt-5.6-sol",
                "gemini-3.5-flash",
            ],
        )
        self.assertEqual(payload["_model_id"], "gpt-5.6-sol+gemini-3.5-flash")
        self.assertEqual(
            payload["_label_transcription"]["source"],
            "local_tesseract_style_identity_ai_color_consensus",
        )
        self.assertEqual(
            payload["_label_transcription"]["model_families"],
            ["google", "openai"],
        )

    def test_ai_label_color_fallback_rejects_same_family_qwen_consensus(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs["model_id"])
            return (
                {
                    "style_code": "204426140143",
                    "product_name": "儿童跑步鞋",
                    "color_name": "柔灰色调00392",
                    "color_code": "00392",
                    "label_bbox": [500, 350, 760, 650],
                    "style_code_bbox": [580, 370, 710, 420],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with (
            patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ),
            patch.object(
                shenhui_shoe_packaging.ocr_service,
                "extract_shoe_label_fields",
                return_value={
                    "color_name": "",
                    "product_name": "儿童跑步鞋",
                    "confidence": 58,
                    "source": "local_tesseract_explicit_label_field",
                    "observed_text": "balabala 204426140143",
                },
            ),
        ):
            with self.assertRaisesRegex(
                shenhui_shoe_packaging.ShoeSelectionError,
                "尚未获得两个跨模型家族同票",
            ):
                shenhui_shoe_packaging._default_analyze_color_label(
                    style_code="204426140143",
                    color_code="00392",
                    label_image="label.jpg",
                    label_source_image="shoe-box.jpg",
                    label_model_id="qwen3.7-plus",
                    fallback_model_ids=["qwen3.8-max-preview"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

        self.assertEqual(
            calls,
            [
                "qwen3.7-plus",
                "qwen3.7-plus",
                "qwen3.8-max-preview",
            ],
        )

    def test_ai_label_color_fallback_uses_focused_label_crop_before_voting(self):
        calls = []
        focused_prompts = []

        def fake_multimodal_json(**kwargs):
            focused = "裁切后的鞋盒标签" in kwargs["user_prompt"]
            calls.append((kwargs["model_id"], focused))
            if focused:
                focused_prompts.append(kwargs["user_prompt"])
            return (
                {
                    "style_code": "204426140143",
                    "product_name": "儿童运动鞋",
                    "color_name": "黑灰色00392" if focused else "黑色00392",
                    "color_code": "00392",
                    "label_bbox": [500, 350, 760, 650],
                    "style_code_bbox": [580, 370, 710, 420],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with (
            patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ),
            patch.object(
                shenhui_shoe_packaging.ocr_service,
                "extract_shoe_label_fields",
                return_value={
                    "color_name": "",
                    "product_name": "儿童运动鞋",
                    "confidence": 58,
                    "source": "local_tesseract_explicit_label_field",
                    "observed_text": "balabala 204426140143",
                },
            ) as extract,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color_label(
                style_code="204426140143",
                color_code="00392",
                label_image="label.jpg",
                label_source_image="shoe-box.jpg",
                label_model_id="gpt-5.6-sol",
                fallback_model_ids=["gemini-3.5-flash"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(payload["color_name"], "黑灰色00392")
        self.assertEqual(extract.call_count, 3)
        self.assertEqual(
            calls,
            [
                ("gpt-5.6-sol", False),
                ("gpt-5.6-sol", True),
                ("gemini-3.5-flash", True),
            ],
        )
        self.assertTrue(focused_prompts)
        self.assertTrue(all("00392" not in prompt for prompt in focused_prompts))
        self.assertEqual(
            payload["_label_transcription"]["color_name_source"],
            "focused_label_ai_consensus",
        )

    def test_ai_label_color_fallback_accepts_name_only_focused_votes(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            focused = "裁切后的鞋盒标签" in kwargs["user_prompt"]
            calls.append((kwargs["model_id"], focused))
            return (
                {
                    "style_code": "204426140143",
                    "product_name": "儿童运动鞋",
                    "color_name": "黑灰色" if focused else "黑色00392",
                    "color_code": "00392",
                    "label_bbox": [500, 350, 760, 650],
                    "style_code_bbox": [580, 370, 710, 420],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with (
            patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ),
            patch.object(
                shenhui_shoe_packaging.ocr_service,
                "extract_shoe_label_fields",
                return_value={
                    "color_name": "",
                    "product_name": "儿童运动鞋",
                    "confidence": 58,
                    "source": "local_tesseract_explicit_label_field",
                    "observed_text": "balabala 204426140143",
                },
            ),
        ):
            payload = shenhui_shoe_packaging._default_analyze_color_label(
                style_code="204426140143",
                color_code="00392",
                label_image="label.jpg",
                label_source_image="shoe-box.jpg",
                label_model_id="gpt-5.6-sol",
                fallback_model_ids=["gemini-3.5-flash"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(payload["color_name"], "黑灰色00392")
        self.assertEqual(
            payload["_label_transcription"]["color_name_source"],
            "focused_label_ai_consensus",
        )
        self.assertEqual(
            calls,
            [
                ("gpt-5.6-sol", False),
                ("gpt-5.6-sol", True),
                ("gemini-3.5-flash", True),
            ],
        )

    def test_focused_label_preview_expands_context_and_normalizes_resolution(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "box.jpg"
            target = Path(tmpdir) / "focused.jpg"
            Image.new("RGB", (2400, 1600), (210, 190, 170)).save(source)

            shenhui_shoe_packaging._create_focused_label_preview(
                source,
                target,
                [0.50, 0.30, 0.75, 0.65],
            )

            with Image.open(target) as focused:
                self.assertEqual(max(focused.size), 1800)
                self.assertGreater(min(focused.size), 900)

    def test_focused_label_color_context_keeps_native_left_lower_block(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "box.jpg"
            target = Path(tmpdir) / "color-context.jpg"
            image = Image.new("RGB", (2400, 1600), (210, 190, 170))
            ImageDraw.Draw(image).rectangle((1200, 480, 1800, 1040), fill=(255, 255, 255))
            image.save(source)

            shenhui_shoe_packaging._create_focused_label_color_context_preview(
                source,
                target,
                [500, 300, 750, 650],
            )

            with Image.open(target) as focused:
                self.assertLessEqual(max(focused.size), 1800)
                self.assertGreater(focused.width, 800)
                self.assertGreater(focused.height, 700)

    def test_ai_label_color_normalizes_joined_modifier_but_rejects_alternatives(self):
        focused_names = {
            "gpt-5.6-sol": "黑灰色/黑红色",
            "gpt-5.6-terra": "黑灰色",
            "gemini-3.5-flash": "黑红色",
            "qwen3.7-plus": "黑红色",
        }

        def fake_multimodal_json(**kwargs):
            focused = "裁切后的鞋盒标签" in kwargs["user_prompt"]
            color_name = (
                focused_names[kwargs["model_id"]]
                if focused
                else "黑色00396"
            )
            return (
                {
                    "style_code": "204426140143",
                    "product_name": "儿童运动鞋",
                    "color_name": color_name,
                    "color_code": "00396",
                    "label_bbox": [500, 350, 760, 650],
                    "style_code_bbox": [580, 370, 710, 420],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with (
            patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ),
            patch.object(
                shenhui_shoe_packaging.ocr_service,
                "extract_shoe_label_fields",
                return_value={
                    "color_name": "",
                    "product_name": "儿童运动鞋",
                    "confidence": 58,
                    "source": "local_tesseract_explicit_label_field",
                    "observed_text": "balabala 204426140143",
                },
            ),
        ):
            payload = shenhui_shoe_packaging._default_analyze_color_label(
                style_code="204426140143",
                color_code="00396",
                label_image="label.jpg",
                label_source_image="shoe-box.jpg",
                label_model_id="gpt-5.6-sol",
                fallback_model_ids=[
                    "gpt-5.6-terra",
                    "gemini-3.5-flash",
                    "qwen3.7-plus",
                ],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(payload["color_name"], "黑红色00396")
        self.assertEqual(
            payload["_model_id"],
            "gemini-3.5-flash+qwen3.7-plus",
        )

    def test_local_label_transcription_rejects_ai_color_without_local_style_identity(self):
        model_payload = {
            "style_code": "204426146023",
            "product_name": "婴童稳步鞋",
            "color_name": "咖色调00355",
            "color_code": "00355",
            "label_bbox": [420, 360, 880, 650],
            "style_code_bbox": [520, 380, 760, 440],
        }
        with patch.object(
            shenhui_shoe_packaging.ocr_service,
            "extract_shoe_label_fields",
            return_value={
                "color_name": "",
                "product_name": "",
                "confidence": 0,
                "source": "local_tesseract_explicit_label_field",
                "observed_text": "unrelated shoe label 204426146999",
            },
        ):
            with self.assertRaisesRegex(
                shenhui_shoe_packaging.llm_gateway.LlmResponseError,
                "未读到包含当前5位色号",
            ):
                shenhui_shoe_packaging._verify_label_payload_with_local_ocr(
                    model_payload,
                    label_source_image="shoe-box.jpg",
                    style_code="204426146023",
                    color_code="00355",
                )

    def test_o_follows_latest_poster_template_slot_by_category(self):
        slots = {
            "tmz1": "main-pose-1.jpg",
            "tmz2": "main-pose-2.jpg",
            "wpz": [f"pose-{index}.jpg" for index in range(1, 7)],
        }
        ruled = shenhui_shoe_packaging._apply_o_category_rule(
            "运动",
            {**slots, "o": "sports-poster.jpg"},
        )
        self.assertEqual(ruled["o"], "main-pose-2.jpg")

        for category in ("休闲", "雪地", "婴童"):
            ruled = shenhui_shoe_packaging._apply_o_category_rule(
                category,
                {**slots, "o": f"{category}-poster.jpg"},
            )
            self.assertEqual(ruled["o"], "main-pose-1.jpg")

        ruled = shenhui_shoe_packaging._apply_o_category_rule(
            "休闲",
            {"wpz": ["wpz1.jpg"]},
        )
        self.assertEqual(ruled["o"], "wpz1.jpg")

        ruled = shenhui_shoe_packaging._apply_o_category_rule("运动", {"wpz": ["only-one.jpg"]})
        self.assertEqual(ruled["o"], "")

    def test_selection_payload_preserves_empty_wpz_positions(self):
        _color_name, _category, slots = shenhui_shoe_packaging._resolve_selection_payload(
            {
                "color_name": "白紫色调00317",
                "shoe_category": "婴童",
                "slots": {
                    "wpz": ["I01", "", "I03", "", "I05", "I06"],
                    "yq": ["", "I02", ""],
                },
            },
            {
                "I01": "wpz1.jpg",
                "I02": "yq2.jpg",
                "I03": "wpz3.jpg",
                "I05": "wpz5.jpg",
                "I06": "box.jpg",
            },
        )

        self.assertEqual(
            slots["wpz"],
            ["wpz1.jpg", "", "wpz3.jpg", "", "wpz5.jpg", "box.jpg"],
        )
        self.assertEqual(slots["yq"], ["", "yq2.jpg", ""])

    def test_sync_wpz_main_slots_with_tmz_rows(self):
        ruled, corrections = shenhui_shoe_packaging._sync_wpz_main_slots({
            "tmz1": "tmz1.jpg",
            "tmz2": "tmz2.jpg",
            "tmz3": "",
            "tmz4": "tmz4.jpg",
            "wpz": ["old1.jpg", "", "wpz3.jpg", "old4.jpg", "wpz5.jpg", "box.jpg"],
        })

        self.assertEqual(
            ruled["wpz"],
            ["tmz1.jpg", "tmz2.jpg", "wpz3.jpg", "tmz4.jpg", "wpz5.jpg", "box.jpg"],
        )
        self.assertEqual(ruled["tmz3"], "wpz3.jpg")
        self.assertTrue(any("wpz2" in item for item in corrections))
        self.assertTrue(any("tmz3" in item for item in corrections))

    def test_selection_source_validation_sanitizes_missing_references(self):
        slots = {
            "_model_id": "qwen3.7-plus",
            "tms": "tms.jpg",
            "o": "o.jpg",
            **{f"tmz{index}": f"tmz{index}.jpg" for index in range(1, 6)},
            "wpz": [f"wpz{index}.jpg" for index in range(1, 7)],
            "yq": ["yq1.jpg", "missing-yq2.jpg"],
        }
        entries = {
            filename: {"filename": filename}
            for filename in [
                "tms.jpg",
                "o.jpg",
                *[f"tmz{index}.jpg" for index in range(1, 6)],
                *[f"wpz{index}.jpg" for index in range(1, 7)],
                "yq1.jpg",
            ]
        }

        sanitized, warnings = shenhui_shoe_packaging._validate_selection_sources(
            "204326141005",
            "白紫色调00317",
            slots,
            entries,
        )

        self.assertEqual(sanitized["yq"], ["yq1.jpg", ""])
        self.assertEqual(warnings[0]["slot"], "yq2")
        self.assertIn("不存在的候选图", warnings[0]["warning"])

    def test_tmz_uses_promoted_main_color_for_every_available_slot(self):
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
                ("白紫色调00317", "a2.jpg"),
                ("白紫色调00317", "a3.jpg"),
                ("白紫色调00317", "a4.jpg"),
                ("白紫色调00317", "a5.jpg"),
            ],
        )

    def test_tmz_skips_slots_missing_from_the_main_color_instead_of_crossing_colors(self):
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
                ("白紫色调00317", "a1.jpg"),
                ("白紫色调00317", "a2.jpg"),
                ("白紫色调00317", "a3.jpg"),
                ("白紫色调00317", "a5.jpg"),
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
                ("白紫色调00317", "a2.jpg"),
                ("白紫色调00317", "a3.jpg"),
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
            "tms.jpg",
        )

    def test_tms_source_filename_accepts_spaces_around_style_color_dash(self):
        self.assertTrue(
            shenhui_shoe_packaging._is_tms_source_filename(
                "204426141113 -00382.jpg",
                "204426141113",
                "00382",
            )
        )
        self.assertTrue(
            shenhui_shoe_packaging._is_tms_source_filename(
                "204426141113－10301.jpg",
                "204426141113",
                "10301",
            )
        )
        self.assertFalse(
            shenhui_shoe_packaging._is_tms_source_filename(
                "GUDO4300.jpg",
                "204426141113",
                "00382",
            )
        )

    def test_channel_assets_match_feedback_canvas_and_wpt_constraints(self):
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

            self.assertEqual(set(outputs), {"wpt30", "jdt_png"})
            with Image.open(outputs["wpt30"]) as wpt30:
                self.assertEqual(wpt30.size, (640, 360))
                self.assertEqual(wpt30.mode, "RGBA")
                self.assertLess(outputs["wpt30"].stat().st_size, 600 * 1024)
            with Image.open(outputs["jdt_png"]) as jdt_png:
                self.assertEqual(jdt_png.size, (800, 800))
                self.assertEqual(jdt_png.mode, "RGBA")
                self.assertEqual(jdt_png.getpixel((0, 0))[3], 0)
                self.assertGreater(jdt_png.getpixel((400, 400))[3], 0)

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
        self.assertIn("第4张图是鞋品海报姿势模板", prompt)
        self.assertIn("第5张图是 yq 三姿势参考模板", prompt)
        self.assertNotIn("最新主图1姿势参考", prompt)

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
                self.assertEqual(image.size, (800, 800))
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
                self.assertEqual(output.size, (800, 800))
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
            self.assertLess(max(y for _x, y in red_pixels), 330)

    def test_create_tmq_asset_prefers_exact_local_style_bbox_over_middle_row(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "box.jpg"
            image = Image.new("RGB", (1000, 1000), (210, 190, 170))
            draw = ImageDraw.Draw(image)
            draw.rectangle((100, 100, 900, 900), fill=(248, 248, 246))
            draw.rectangle((310, 130, 620, 180), fill=(20, 20, 20))
            draw.rectangle((130, 400, 870, 600), fill=(20, 20, 20))
            image.save(source)
            target = root / "tmq.jpg"

            with patch.object(
                shenhui_shoe_packaging.ocr_service,
                "locate_exact_style_code_bbox",
                return_value=(0.31, 0.13, 0.62, 0.18),
            ) as locate:
                shenhui_shoe_packaging._create_tmq_asset(
                    source=source,
                    target=target,
                    label_bbox=[100, 100, 900, 900],
                    style_code_bbox=[130, 400, 870, 600],
                    style_code="204426140143",
                    require_style_code_bbox=True,
                )

            locate.assert_called_once()
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
            self.assertLess(max(y for _x, y in red_pixels), 220)

    def test_create_tmq_asset_recovers_style_bbox_outside_expanded_label(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source = root / "box.jpg"
            Image.new("RGB", (1200, 800), (230, 226, 224)).save(source)
            target = root / "tmq.jpg"

            shenhui_shoe_packaging._create_tmq_asset(
                source=source,
                target=target,
                label_bbox=[426, 246, 804, 624],
                style_code_bbox=[900, 300, 950, 340],
                style_code="204426141127",
                require_style_code_bbox=True,
            )

            with Image.open(target) as output:
                self.assertEqual(output.size, (800, 800))
                red_pixels = [
                    (x, y)
                    for y in range(output.height)
                    for x in range(output.width)
                    if output.getpixel((x, y))[0] > 220
                    and output.getpixel((x, y))[1] < 45
                    and output.getpixel((x, y))[2] < 45
                ]
            self.assertTrue(red_pixels)

    def test_missing_output_slots_are_report_warnings(self):
        assignments, warnings = shenhui_shoe_packaging.build_output_assignments(
            {
                "白紫色调00317": {
                    "tmz1": "1.jpg",
                    "tmz2": "2.jpg",
                    "tmz3": "3.jpg",
                    "tmz4": "4.jpg",
                    "tmz5": "5.jpg",
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
        self.assertNotIn("1.白紫色调00317/tms.jpg", outputs)
        self.assertIn("1.白紫色调00317/yk1.jpg", outputs)
        self.assertIn("1.白紫色调00317/yk2.jpg", outputs)
        self.assertIn("tmz (1).jpg", outputs)
        warning_slots = {warning["slot"] for warning in warnings}
        self.assertIn("tms", warning_slots)
        self.assertIn("wpz3", warning_slots)
        self.assertIn("wpz6", warning_slots)
        self.assertIn("yq2", warning_slots)
        self.assertIn("yx", warning_slots)
        self.assertTrue(
            any("允许缺少 yx.jpg" in warning["warning"] for warning in warnings)
        )

        _assignments, missing_o_warnings = shenhui_shoe_packaging.build_output_assignments(
            {
                "白紫色调00317": {
                    "tmz1": "1.jpg",
                    "tmz2": "2.jpg",
                    "tmz3": "3.jpg",
                    "tmz4": "4.jpg",
                    "tmz5": "5.jpg",
                    "tms": "color.jpg",
                    "wpz": [f"pose-{index}.jpg" for index in range(1, 7)],
                    "yq": ["real-1.jpg", "real-2.jpg", "real-3.jpg"],
                }
            }
        )
        self.assertIn("o", {warning["slot"] for warning in missing_o_warnings})

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
        self.assertIn("1.酒红_米白00316/tms.jpg", outputs)
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
                self.assertEqual(
                    [entry["filename"] for entry in kwargs["candidate_entries"]],
                    kwargs["candidate_names"],
                )
                self.assertTrue(all(
                    Path(entry["path"]).is_file()
                    for entry in kwargs["candidate_entries"]
                ))
                self.assertGreaterEqual(len(kwargs["contact_sheets"]), 2)
                self.assertTrue(Path(kwargs["reference_image"]).is_file())
                self.assertTrue(Path(kwargs["poster_reference_image"]).is_file())
                self.assertNotIn("pose1_reference_image", kwargs)
                self.assertTrue(Path(kwargs["main_pose_reference_sheet"]).is_file())
                self.assertTrue(Path(kwargs["yq_reference_image"]).is_file())
                self.assertEqual(len(kwargs["main_pose_reference_images"]), 5)
                for path in kwargs["main_pose_reference_images"]:
                    self.assertTrue(Path(path).is_file())
                for reference_key in (
                    "reference_image",
                    "poster_reference_image",
                    "main_pose_reference_sheet",
                    "yq_reference_image",
                ):
                    with Image.open(kwargs[reference_key]) as reference:
                        self.assertLessEqual(max(reference.size), 1600)
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
                    "o": f"{color_code}-11.jpg",
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
                    "style_code": "204326141005",
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
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
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
            with Image.open(package_root / "jdt.白紫色调00317.png") as jdt:
                self.assertEqual(jdt.size, (800, 800))
                self.assertEqual(jdt.mode, "RGBA")
                self.assertEqual(jdt.getpixel((0, 0))[3], 0)
            with Image.open(package_root / "tmt.png") as tmt:
                self.assertEqual(tmt.size, (800, 800))
                self.assertEqual(tmt.mode, "RGBA")
                self.assertEqual(tmt.getpixel((0, 0))[3], 0)
            with Image.open(package_root / "wpt30.白紫色调00317.png") as wpt30:
                self.assertEqual(wpt30.size, (212, 400))
                self.assertEqual(wpt30.mode, "RGBA")
                self.assertLess(
                    (package_root / "wpt30.白紫色调00317.png").stat().st_size,
                    600 * 1024,
                )
            with Image.open(package_root / "tmq.jpg") as tmq:
                self.assertEqual(tmq.size, (800, 800))
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
            self.assertTrue(
                any(
                    event["organize_stage"] == "款色识别完成"
                    and event["organize_completed"] == 1
                    and event["organize_total"] == 2
                    and event["organize_current_style"] == "204326141005"
                    and event["organize_current_color"] == "白紫色调00317"
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
            tms_rows = [
                row
                for row in report_rows
                if row.get("规则槽位") == "tms"
                and row.get("颜色") == "白紫色调00317"
            ]
            self.assertEqual(len(tms_rows), 1)
            self.assertEqual(tms_rows[0]["原文件名"], "00317-5.jpg")
            with Image.open(package_root / "1.白紫色调00317" / "tms.jpg") as tms:
                self.assertEqual(tms.mode, "RGB")
                self.assertGreaterEqual(min(tms.getpixel((0, 0))), 245)
            self.assertEqual(len(analyzer_calls), 1)
            self.assertTrue(
                all(call["shoe_category"] == "婴童" for call in analyzer_calls)
            )
            self.assertEqual(len(label_calls), 2)
            original_poster = next(
                Path(row["本地文件"])
                for row in rows
                if row["原文件名"] == "00317-1.jpg"
            )
            with Image.open(
                package_root / "1.白紫色调00317" / "o.jpg"
            ) as poster, Image.open(
                package_root / "1.白紫色调00317" / "wpz (15).jpg"
            ) as wpz5:
                self.assertNotEqual(poster.tobytes(), wpz5.tobytes())
            self.assertEqual(
                (package_root / "1.白紫色调00317" / "o.jpg").read_bytes(),
                original_poster.read_bytes(),
            )

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

    def test_prepare_packages_rejects_unverified_tmq_when_ocr_lacks_style_bbox(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source_root = root / "source"
            output_root = root / "output"
            source_root.mkdir()
            rows = []
            names = [
                "204426146031-50301.jpg",
                *[f"50301-{index}.jpg" for index in range(1, 10)],
                "yx.jpg",
            ]
            for index, name in enumerate(names):
                path = source_root / f"{index}-{name}"
                Image.new("RGB", (120, 100), (index * 17 % 255, 120, 180)).save(path)
                rows.append({
                    "输入款号": "204426146031",
                    "颜色": "50301",
                    "原文件名": name,
                    "云盘路径": f"鞋品/204426146031/50301/36/{name}",
                    "下载结果": "已下载",
                    "本地文件": str(path),
                    "__shoe_color_code": "50301",
                    "__shoe_original_filename": name,
                })

            def fake_analyzer(**_kwargs):
                return {
                    "color_name": "浅卡其50301",
                    "shoe_category": "休闲",
                    "slots": {
                        "tmz1": "50301-1.jpg",
                        "tmz2": "50301-2.jpg",
                        "tmz3": "50301-3.jpg",
                        "tmz4": "50301-4.jpg",
                        "tmz5": "50301-5.jpg",
                        "o": "50301-2.jpg",
                        "wpz": [f"50301-{index}.jpg" for index in range(1, 7)],
                        "yq": [f"50301-{index}.jpg" for index in range(7, 10)],
                        "yx": "yx.jpg",
                    },
                }

            def fake_label_analyzer(**_kwargs):
                return {
                    "product_name": "儿童休闲鞋",
                    "color_name": "浅卡其50301",
                    "color_code": "50301",
                    "label_bbox": [100, 100, 900, 800],
                }

            with self.assertRaisesRegex(
                shenhui_shoe_packaging.ShoeSelectionError,
                "鞋盒标签 OCR",
            ):
                shenhui_shoe_packaging.prepare_shoe_packages(
                    data_rows=rows,
                    output_root=output_root,
                    model_id="qwen3.8-max-preview",
                    analyze_color=fake_analyzer,
                    analyze_color_label=fake_label_analyzer,
                    log=lambda _message: None,
                )

    def test_prepare_packages_derives_tms_from_tmz5_without_exact_source(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source_root = root / "source"
            output_root = root / "output"
            source_root.mkdir()
            rows = []
            names = [
                *[f"00382-{index}.jpg" for index in range(1, 10)],
                "yx.jpg",
            ]
            for index, name in enumerate(names):
                path = source_root / f"{index}-{name}"
                Image.new("RGB", (120, 100), (index * 19 % 255, 130, 190)).save(path)
                rows.append({
                    "输入款号": "204426141113",
                    "颜色": "00382",
                    "原文件名": name,
                    "云盘路径": f"鞋品/204426141113/00382/24/{name}",
                    "下载结果": "已下载",
                    "本地文件": str(path),
                    "__shoe_color_code": "00382",
                    "__shoe_original_filename": name,
                })

            def fake_analyzer(**kwargs):
                self.assertFalse(kwargs.get("pose_evidence_path"))
                return {
                    "color_name": "灰蓝色00382",
                    "shoe_category": "运动",
                    "slots": {
                        "tmz1": "00382-1.jpg",
                        "tmz2": "00382-2.jpg",
                        "tmz3": "00382-3.jpg",
                        "tmz4": "00382-4.jpg",
                        "tmz5": "00382-5.jpg",
                        "wpz": [f"00382-{index}.jpg" for index in range(1, 7)],
                        "yq": [f"00382-{index}.jpg" for index in range(7, 10)],
                        "yx": "yx.jpg",
                    },
                }

            report_rows, package_roots = shenhui_shoe_packaging.prepare_shoe_packages(
                data_rows=rows,
                output_root=output_root,
                model_id="gpt-5.5",
                analyze_color=fake_analyzer,
                analyze_color_label=False,
                log=lambda _message: None,
            )

            package_root = package_roots["204426141113"]
            self.assertTrue((package_root / "tmz (1).jpg").is_file())
            self.assertTrue((package_root / "1.灰蓝色00382" / "tms.jpg").exists())
            self.assertFalse(
                any(row.get("规则槽位") == "整款" for row in report_rows)
            )
            tms_warnings = [
                row for row in report_rows
                if row.get("规则槽位") == "tms"
                and row.get("处理动作") == "缺少源图已跳过"
            ]
            self.assertEqual(len(tms_warnings), 0)
            tms_rows = [
                row for row in report_rows
                if row.get("规则槽位") == "tms"
            ]
            self.assertEqual(len(tms_rows), 1)
            self.assertEqual(tms_rows[0]["原文件名"], "00382-5.jpg")

    def test_label_ocr_falls_back_to_consensus_shoe_box_candidate(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source_root = root / "source"
            output_root = root / "output"
            source_root.mkdir()
            style_code = "204426146036"
            color_code = "00317"
            exact_tms = f"{style_code}-{color_code}.jpg"
            names = [
                exact_tms,
                "pose1.jpg",
                "pose2.jpg",
                "pose3.jpg",
                "pose4.jpg",
                "wpz5.jpg",
                "true-box.jpg",
                "yq2.jpg",
                "yq3.jpg",
            ]
            rows = []
            for index, name in enumerate(names):
                path = source_root / f"{index}-{name}"
                color = (220, 25, 25) if name == exact_tms else (
                    (25, 220, 25) if name == "true-box.jpg" else (80, 100 + index, 180)
                )
                Image.new("RGB", (160, 120), color).save(path)
                rows.append({
                    "输入款号": style_code,
                    "颜色": color_code,
                    "原文件名": name,
                    "云盘路径": f"鞋品/{style_code}/{color_code}/36/{name}",
                    "下载结果": "已下载",
                    "本地文件": str(path),
                    "__shoe_color_code": color_code,
                    "__shoe_original_filename": name,
                })

            def fake_analyzer(**_kwargs):
                return {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "_model_id": "model-a+model-b+model-c",
                    "_model_votes": {
                        "wpz6": {
                            "status": "locked",
                            "selected": exact_tms,
                            "selected_family": "204426146036-00317",
                            "votes": 2,
                            "required_votes": 2,
                            "models": ["model-a", "model-b"],
                        },
                    },
                    "_model_votes_by_batch": [
                        {
                            "wpz6": {
                                "status": "locked",
                                "selected": exact_tms,
                                "selected_family": "204426146036-00317",
                                "votes": 2,
                                "required_votes": 2,
                                "models": ["model-a", "model-b"],
                            },
                        },
                        {
                            "wpz6": {
                                "status": "locked",
                                "selected": "true-box.jpg",
                                "selected_family": "true-box",
                                "votes": 3,
                                "required_votes": 2,
                                "models": ["model-a", "model-b", "model-c"],
                            },
                        },
                    ],
                    "_candidate_facts_by_model": [
                        {
                            "model_id": "model-a",
                            "candidate_facts": [
                                {
                                    "candidate_id": "I01",
                                    "filename": exact_tms,
                                    "asset_type": "shoe",
                                    "shoe_count": "single",
                                    "pose": "tmz5",
                                    "background": "white",
                                    "complete": True,
                                    "matched_slots": ["tmz5"],
                                },
                                {
                                    "candidate_id": "I07",
                                    "filename": "true-box.jpg",
                                    "asset_type": "shoe_box",
                                    "pose": "wpz6",
                                    "matched_slots": ["wpz6"],
                                },
                            ],
                        },
                        {
                            "model_id": "model-b",
                            "candidate_facts": [
                                {
                                    "candidate_id": "I07",
                                    "filename": "true-box.jpg",
                                    "asset_type": "shoe_box",
                                    "pose": "wpz6",
                                    "matched_slots": ["wpz6"],
                                },
                            ],
                        },
                    ],
                    "slots": {
                        "tmz1": "pose1.jpg",
                        "tmz2": "pose2.jpg",
                        "tmz3": "pose3.jpg",
                        "tmz4": "pose4.jpg",
                        "tmz5": exact_tms,
                        "wpz": [
                            "pose1.jpg",
                            "pose2.jpg",
                            "pose3.jpg",
                            "pose4.jpg",
                            "wpz5.jpg",
                            exact_tms,
                        ],
                        "yq": ["pose2.jpg", "yq2.jpg", "yq3.jpg"],
                        "yx": "",
                    },
                }

            label_sources = []

            def fake_label_analyzer(**kwargs):
                with Image.open(kwargs["label_image"]) as image:
                    red, green, _blue = image.convert("RGB").getpixel(
                        (image.width // 2, image.height // 2)
                    )
                source_kind = "box" if green > red else "exact-tms"
                label_sources.append(source_kind)
                if source_kind != "box":
                    raise shenhui_shoe_packaging.ShoeSelectionError("不是鞋盒标签")
                return {
                    "style_code": style_code,
                    "product_name": "婴童运动鞋",
                    "color_name": "白紫色调00317",
                    "color_code": color_code,
                    "label_bbox": [100, 100, 900, 800],
                    "style_code_bbox": [150, 520, 430, 575],
                    "_model_id": "label-model",
                }

            report_rows, package_roots = shenhui_shoe_packaging.prepare_shoe_packages(
                data_rows=rows,
                output_root=output_root,
                model_id="model-a",
                shoe_categories={style_code: "婴童"},
                analyze_color=fake_analyzer,
                analyze_color_label=fake_label_analyzer,
                log=lambda _message: None,
                preserve_analysis_artifacts=True,
            )

            self.assertEqual(label_sources, ["box"])
            wpz6_rows = [row for row in report_rows if row.get("规则槽位") == "wpz6"]
            self.assertEqual(len(wpz6_rows), 1)
            self.assertEqual(wpz6_rows[0]["原文件名"], "true-box.jpg")
            evidence_path = (
                output_root
                / "_shoe_analysis"
                / style_code
                / f"{color_code}-selection-evidence.json"
            )
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertEqual(evidence["resolved_slots"]["wpz"][5], "true-box.jpg")
            self.assertTrue((package_roots[style_code] / "tmq.jpg").is_file())

    def test_label_ocr_candidates_reject_plain_shoe_even_when_wpz6_vote_is_locked(self):
        selection = {
            "wpz": ["", "", "", "", "", "plain-shoe.jpg"],
            "_model_votes": {
                "wpz6": {
                    "status": "locked",
                    "selected": "plain-shoe.jpg",
                    "selected_family": "plain-shoe",
                    "votes": 2,
                    "required_votes": 2,
                    "models": ["model-a", "model-b"],
                },
            },
            "_candidate_facts_by_model": [
                {
                    "model_id": model_id,
                    "candidate_facts": [{
                        "filename": "plain-shoe.jpg",
                        "asset_type": "shoe",
                        "shoe_count": "single",
                        "pose": "tmz5",
                        "background": "white",
                        "complete": True,
                        "matched_slots": ["tmz5"],
                    }],
                }
                for model_id in ("model-a", "model-b")
            ],
        }

        candidates = shenhui_shoe_packaging._label_ocr_candidate_sources_for_wpz6(
            selection=selection,
            candidate_ids={},
            entries_by_name={"plain-shoe.jpg": {"filename": "plain-shoe.jpg"}},
            style_code="204426146036",
            color_code="00317",
        )

        self.assertEqual(candidates, [])

    def test_label_ocr_candidates_prefer_complete_box_view_over_tight_label_closeup(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            tight_label = root / "tight-label.jpg"
            complete_box = root / "complete-box.jpg"

            tight_image = Image.new("RGB", (400, 300), "white")
            tight_draw = ImageDraw.Draw(tight_image)
            tight_draw.rectangle((60, 45, 340, 255), fill=(70, 70, 70))
            tight_draw.line((200, 0, 200, 45), fill=(70, 70, 70), width=5)
            tight_draw.line((200, 255, 200, 299), fill=(70, 70, 70), width=5)
            tight_draw.line((0, 150, 60, 150), fill=(70, 70, 70), width=5)
            tight_draw.line((340, 150, 399, 150), fill=(70, 70, 70), width=5)
            tight_image.save(tight_label)

            complete_image = Image.new("RGB", (400, 300), "white")
            complete_draw = ImageDraw.Draw(complete_image)
            complete_draw.rectangle((100, 75, 300, 225), fill=(70, 70, 70))
            complete_image.save(complete_box)

            selection = {
                "wpz": ["", "", "", "", "", tight_label.name],
                "_model_votes_by_batch": [
                    {
                        "wpz6": {
                            "status": "locked",
                            "selected": tight_label.name,
                            "votes": 3,
                            "models": ["model-a", "model-b", "model-c"],
                        },
                    },
                    {
                        "wpz6": {
                            "status": "locked",
                            "selected": complete_box.name,
                            "votes": 2,
                            "models": ["model-a", "model-b"],
                        },
                    },
                ],
                "_candidate_facts_by_model": [
                    {
                        "model_id": model_id,
                        "candidate_facts": [
                            {
                                "filename": tight_label.name,
                                "asset_type": "shoe_box_label",
                                "pose": "wpz6",
                                "matched_slots": ["wpz6"],
                            },
                            {
                                "filename": complete_box.name,
                                "asset_type": "shoe_box",
                                "pose": "wpz6",
                                "matched_slots": ["wpz6"],
                            },
                        ],
                    }
                    for model_id in ("model-a", "model-b")
                ],
            }

            candidates = shenhui_shoe_packaging._label_ocr_candidate_sources_for_wpz6(
                selection=selection,
                candidate_ids={},
                entries_by_name={
                    tight_label.name: {
                        "filename": tight_label.name,
                        "path": tight_label,
                    },
                    complete_box.name: {
                        "filename": complete_box.name,
                        "path": complete_box,
                    },
                },
                style_code="204426146036",
                color_code="00317",
            )

            self.assertEqual(
                [candidate["filename"] for candidate in candidates],
                [complete_box.name, tight_label.name],
            )

    def test_sync_wpz_main_slots_does_not_sync_yq1_to_final_tmz2(self):
        slots = {
            "tmz1": "pose1.jpg",
            "tmz2": "final-pose2.jpg",
            "tmz3": "pose3.jpg",
            "tmz4": "pose4.jpg",
            "wpz": [
                "pose1.jpg",
                "stale-pose2.jpg",
                "pose3.jpg",
                "pose4.jpg",
                "wpz5.jpg",
                "box.jpg",
            ],
            "yq": ["stale-yq1.jpg", "yq2.jpg", "yq3.jpg"],
        }

        synced, corrections = shenhui_shoe_packaging._sync_wpz_main_slots(slots)

        self.assertEqual(synced["wpz"][1], "final-pose2.jpg")
        self.assertEqual(synced["yq"][0], "stale-yq1.jpg")
        self.assertFalse(any("yq1" in correction for correction in corrections))

    def test_consensus_quality_rule_promotes_verified_exact_tms_to_tmz5(self):
        exact_tms = "204426146036-00317.jpg"
        selection = {
            "tmz5": "wrong-gray.jpg",
            "wpz": ["", "", "", "", "wpz5.jpg", "box.jpg"],
            "yq": ["", "", ""],
            "_model_votes": {
                "tmz5": {
                    "status": "locked",
                    "selected": "wrong-gray.jpg",
                    "selected_family": "wrong-gray",
                    "votes": 2,
                    "required_votes": 2,
                    "models": ["model-c", "model-d"],
                },
            },
            "_candidate_facts_by_model": [
                {
                    "model_id": model_id,
                    "candidate_facts": [{
                        "filename": exact_tms,
                        "asset_type": "shoe",
                        "shoe_count": "single",
                        "pose": "tmz5",
                        "background": "white",
                        "complete": True,
                        "feature_card": False,
                        "matched_slots": ["tmz5"],
                    }],
                }
                for model_id in ("model-a", "model-b")
            ],
        }

        ruled, corrections = shenhui_shoe_packaging._apply_post_selection_quality_rules(
            "婴童",
            selection,
            {
                exact_tms: {"filename": exact_tms},
                "wrong-gray.jpg": {"filename": "wrong-gray.jpg"},
            },
        )

        self.assertEqual(ruled["tmz5"], exact_tms)
        self.assertEqual(
            ruled["_model_votes"]["tmz5"]["selected_family"],
            "204426146036-00317",
        )
        self.assertTrue(any("tmz5" in correction for correction in corrections))

    def test_consensus_quality_rule_normalizes_white_copy_to_gray_original(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            white_copy = root / "GUDO7228 拷贝.jpg"
            gray_original = root / "GUDO7228.jpg"
            for path, background in (
                (white_copy, (255, 255, 255)),
                (gray_original, (242, 242, 242)),
            ):
                image = Image.new("RGB", (200, 150), background)
                ImageDraw.Draw(image).ellipse((35, 45, 165, 105), fill=(25, 35, 45))
                image.save(path)

            selection = {
                "tmz1": white_copy.name,
                "wpz": [white_copy.name, "", "", "", "", ""],
                "yq": ["", "", ""],
                "_model_votes": {
                    "tmz1": {
                        "status": "locked",
                        "selected": white_copy.name,
                        "selected_family": "gudo7228",
                        "votes": 2,
                        "required_votes": 2,
                        "models": ["model-a", "model-b"],
                    },
                },
            }
            entries = {
                white_copy.name: {"filename": white_copy.name, "path": str(white_copy)},
                gray_original.name: {
                    "filename": gray_original.name,
                    "path": str(gray_original),
                },
            }

            ruled, corrections = shenhui_shoe_packaging._apply_post_selection_quality_rules(
                "婴童",
                selection,
                entries,
            )

            self.assertEqual(ruled["tmz1"], gray_original.name)
            self.assertEqual(ruled["wpz"][0], gray_original.name)
            self.assertEqual(
                ruled["_model_votes"]["tmz1"]["selected"],
                gray_original.name,
            )
            self.assertEqual(
                ruled["_model_votes"]["tmz1"]["variant_source"],
                "verified_gray_copy_variant",
            )
            self.assertEqual(
                ruled["_model_votes"]["tmz1"]["voted_variant"],
                white_copy.name,
            )
            self.assertTrue(any("灰底原图" in correction for correction in corrections))

    def test_targeted_consensus_merges_near_identical_visual_variants(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            white_copy = root / "GUDO7373 拷贝.jpg"
            gray_yk = root / "yk3.jpg"
            for path, background in (
                (white_copy, (255, 255, 255)),
                (gray_yk, (242, 242, 242)),
            ):
                image = Image.new("RGB", (240, 160), background)
                ImageDraw.Draw(image).polygon(
                    [(35, 95), (70, 65), (180, 70), (210, 100), (185, 115), (55, 115)],
                    fill=(30, 40, 50),
                )
                image.save(path)
            candidate_ids = {
                "I11": white_copy.name,
                "I23": gray_yk.name,
            }
            payloads = [
                {
                    "_model_id": model_id,
                    "candidates": [
                        _candidate_fact(
                            candidate_id,
                            "yq3",
                            filename=filename,
                            shoe_count="single",
                            side="outer",
                        ),
                    ],
                }
                for model_id, candidate_id, filename in (
                    ("model-a", "I11", white_copy.name),
                    ("model-b", "I23", gray_yk.name),
                )
            ]
            entries = {
                white_copy.name: {"filename": white_copy.name, "path": str(white_copy)},
                gray_yk.name: {"filename": gray_yk.name, "path": str(gray_yk)},
            }

            consensus = shenhui_shoe_packaging._consensus_pose_payload(
                payloads,
                candidate_ids,
                "婴童",
                required_votes=2,
                entries_by_name=entries,
            )

            vote = consensus["_model_votes"]["yq3"]
            self.assertEqual(vote["status"], "locked")
            self.assertEqual(vote["votes"], 2)
            self.assertEqual(vote["models"], ["model-a", "model-b"])
            self.assertEqual(vote["selected"], "I23")
            self.assertEqual(consensus["slots"]["yq"][2], "I23")
            self.assertEqual(
                vote["family_source"],
                "verified_visual_duplicate_cluster",
            )
            self.assertEqual(vote["voted_variants"], ["I11", "I23"])

    def test_targeted_yq3_consensus_merges_same_background_tag_variant_only(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            obstructed = root / "GUDO-card.jpg"
            clean = root / "yk3.jpg"
            background = (242, 242, 242)
            shoe_polygon = [
                (35, 95),
                (70, 65),
                (180, 70),
                (210, 100),
                (185, 115),
                (55, 115),
            ]
            for path in (obstructed, clean):
                image = Image.new("RGB", (240, 160), background)
                ImageDraw.Draw(image).polygon(shoe_polygon, fill=(35, 95, 180))
                if path == obstructed:
                    ImageDraw.Draw(image).rectangle(
                        (105, 78, 135, 108),
                        fill=(205, 205, 205),
                    )
                image.save(path)

            candidate_ids = {
                "I11": obstructed.name,
                "I23": clean.name,
            }
            entries = {
                obstructed.name: {
                    "filename": obstructed.name,
                    "path": str(obstructed),
                },
                clean.name: {"filename": clean.name, "path": str(clean)},
            }

            def payloads_for(slot):
                return [
                    {
                        "_model_id": model_id,
                        "candidates": [
                            _candidate_fact(
                                candidate_id,
                                slot,
                                filename=filename,
                                shoe_count="single",
                                side="outer",
                            ),
                        ],
                    }
                    for model_id, candidate_id, filename in (
                        ("model-a", "I11", obstructed.name),
                        ("model-b", "I23", clean.name),
                    )
                ]

            ordinary_consensus = shenhui_shoe_packaging._consensus_pose_payload(
                payloads_for("yq3"),
                candidate_ids,
                "婴童",
                required_votes=2,
                entries_by_name=entries,
            )
            self.assertEqual(
                ordinary_consensus["_model_votes"]["yq3"]["status"],
                "insufficient_votes",
            )

            targeted_consensus = shenhui_shoe_packaging._consensus_pose_payload(
                payloads_for("yq3"),
                candidate_ids,
                "婴童",
                required_votes=2,
                entries_by_name=entries,
                same_background_visual_slot="yq3",
            )
            vote = targeted_consensus["_model_votes"]["yq3"]
            self.assertEqual(vote["status"], "locked")
            self.assertEqual(vote["votes"], 2)
            self.assertEqual(vote["models"], ["model-a", "model-b"])
            self.assertEqual(vote["selected"], "I23")
            self.assertEqual(targeted_consensus["slots"]["yq"][2], "I23")
            self.assertEqual(
                vote["family_source"],
                "verified_visual_duplicate_cluster",
            )
            self.assertEqual(vote["voted_variants"], ["I11", "I23"])

            duplicate_nomination_payloads = [
                {
                    "_model_id": model_id,
                    "candidates": [
                        _candidate_fact(
                            candidate_id,
                            "yq3",
                            filename=filename,
                            shoe_count="single",
                            side="outer",
                        )
                        for candidate_id, filename in candidate_ids.items()
                    ],
                }
                for model_id in ("model-a", "model-b")
            ]
            deduplicated_consensus = (
                shenhui_shoe_packaging._consensus_pose_payload(
                    duplicate_nomination_payloads,
                    candidate_ids,
                    "婴童",
                    required_votes=2,
                    entries_by_name=entries,
                    same_background_visual_slot="yq3",
                )
            )
            deduplicated_vote = deduplicated_consensus["_model_votes"]["yq3"]
            self.assertEqual(deduplicated_vote["status"], "locked")
            self.assertEqual(deduplicated_vote["votes"], 2)
            self.assertEqual(deduplicated_vote["models"], ["model-a", "model-b"])
            self.assertEqual(deduplicated_vote["selected"], "I23")
            self.assertEqual(
                deduplicated_vote["route_variant_deduplication"],
                {
                    "model-a": ["I11", "I23"],
                    "model-b": ["I11", "I23"],
                },
            )

            non_yq3_consensus = shenhui_shoe_packaging._consensus_pose_payload(
                payloads_for("tmz3"),
                candidate_ids,
                "婴童",
                required_votes=2,
                entries_by_name=entries,
                same_background_visual_slot="yq3",
            )
            self.assertEqual(
                non_yq3_consensus["_model_votes"]["tmz3"]["status"],
                "insufficient_votes",
            )

    def test_prepare_packages_cleans_analysis_artifacts_by_default(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source_root = root / "source"
            output_root = root / "output"
            source_root.mkdir()
            rows = []
            names = [
                *[f"00382-{index}.jpg" for index in range(1, 10)],
                "yx.jpg",
            ]
            for index, name in enumerate(names):
                path = source_root / f"{index}-{name}"
                Image.new("RGB", (120, 100), (index * 19 % 255, 130, 190)).save(path)
                rows.append({
                    "输入款号": "204426141113",
                    "颜色": "00382",
                    "原文件名": name,
                    "云盘路径": f"鞋品/204426141113/00382/24/{name}",
                    "下载结果": "已下载",
                    "本地文件": str(path),
                    "__shoe_color_code": "00382",
                    "__shoe_original_filename": name,
                })

            def fake_analyzer(**_kwargs):
                return {
                    "color_name": "灰蓝色00382",
                    "shoe_category": "运动",
                    "slots": {
                        "tmz1": "00382-1.jpg",
                        "tmz2": "00382-2.jpg",
                        "tmz3": "00382-3.jpg",
                        "tmz4": "00382-4.jpg",
                        "tmz5": "00382-5.jpg",
                        "wpz": [f"00382-{index}.jpg" for index in range(1, 7)],
                        "yq": [f"00382-{index}.jpg" for index in range(7, 10)],
                        "yx": "yx.jpg",
                    },
                }

            shenhui_shoe_packaging.prepare_shoe_packages(
                data_rows=rows,
                output_root=output_root,
                model_id="gpt-5.5",
                analyze_color=fake_analyzer,
                analyze_color_label=False,
                log=lambda _message: None,
            )

            self.assertFalse((output_root / "_shoe_analysis").exists())

    def test_prepare_packages_can_preserve_analysis_artifacts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            source_root = root / "source"
            output_root = root / "output"
            source_root.mkdir()
            rows = []
            names = [
                *[f"00382-{index}.jpg" for index in range(1, 10)],
                "yx.jpg",
            ]
            for index, name in enumerate(names):
                path = source_root / f"{index}-{name}"
                Image.new("RGB", (120, 100), (index * 19 % 255, 130, 190)).save(path)
                rows.append({
                    "输入款号": "204426141113",
                    "颜色": "00382",
                    "原文件名": name,
                    "云盘路径": f"鞋品/204426141113/00382/24/{name}",
                    "下载结果": "已下载",
                    "本地文件": str(path),
                    "__shoe_color_code": "00382",
                    "__shoe_original_filename": name,
                })

            def fake_analyzer(**kwargs):
                self.assertTrue(Path(kwargs["contact_sheet"]).is_file())
                self.assertEqual(
                    Path(kwargs["pose_evidence_path"]).name,
                    "00382-pose-evidence.json",
                )
                return {
                    "color_name": "灰蓝色00382",
                    "shoe_category": "运动",
                    "_model_id": "pose-model-a",
                    "_model_votes": {
                        "tmz1": {
                            "selected": "I01",
                            "models": ["pose-model-a", "pose-model-b"],
                        }
                    },
                    "_consensus_issues": [],
                    "_candidate_facts_by_model": [
                        {
                            "model_id": "pose-model-a",
                            "facts": [
                                {
                                    "candidate_id": "I01",
                                    "filename": "00382-1.jpg",
                                    "matched_slots": ["tmz1"],
                                }
                            ],
                        }
                    ],
                    "_ruleset": "shoe-slot-rules.v2",
                    "slots": {
                        "tmz1": "00382-1.jpg",
                        "tmz2": "00382-2.jpg",
                        "tmz3": "00382-3.jpg",
                        "tmz4": "00382-4.jpg",
                        "tmz5": "00382-5.jpg",
                        "wpz": [f"00382-{index}.jpg" for index in range(1, 7)],
                        "yq": [f"00382-{index}.jpg" for index in range(7, 10)],
                        "yx": "yx.jpg",
                    },
                }

            shenhui_shoe_packaging.prepare_shoe_packages(
                data_rows=rows,
                output_root=output_root,
                model_id="gpt-5.5",
                analyze_color=fake_analyzer,
                analyze_color_label=False,
                log=lambda _message: None,
                preserve_analysis_artifacts=True,
            )

            analysis_root = output_root / "_shoe_analysis"
            self.assertTrue(analysis_root.is_dir())
            self.assertTrue(any(analysis_root.rglob("*.jpg")))
            evidence_path = (
                analysis_root
                / "204426141113"
                / "00382-selection-evidence.json"
            )
            self.assertTrue(evidence_path.is_file())
            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertEqual(evidence["style_code"], "204426141113")
            self.assertEqual(evidence["color_code"], "00382")
            self.assertEqual(evidence["color_name"], "灰蓝色00382")
            self.assertEqual(evidence["category"], "运动")
            self.assertEqual(evidence["model_category"], "运动")
            self.assertEqual(evidence["model_id"], "pose-model-a")
            self.assertEqual(evidence["ruleset"], "shoe-slot-rules.v2")
            self.assertEqual(
                evidence["resolved_slots"]["tmz1"],
                "00382-1.jpg",
            )
            self.assertEqual(
                evidence["selection_evidence"]["_model_votes"]["tmz1"]["selected"],
                "I01",
            )
            self.assertNotIn("config", evidence)
            self.assertNotIn("prompt", json.dumps(evidence, ensure_ascii=False).lower())

    def test_prepare_skip_failed_styles_continues_after_single_style_error(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_root = Path(tmpdir) / "output"
            failed_root = output_root / "204426146031"
            failed_root.mkdir(parents=True)
            analysis_marker = output_root / "_shoe_analysis" / "204326141005" / "contact.jpg"
            analysis_marker.parent.mkdir(parents=True)
            analysis_marker.write_bytes(b"artifact")
            rows = [
                {"输入款号": "204326141005", "下载结果": "已下载"},
                {"输入款号": "204426146031", "下载结果": "已下载"},
                {"输入款号": "204426146036", "下载结果": "已下载"},
            ]
            logs = []
            calls = []

            def fake_prepare(**kwargs):
                current_codes = [
                    row["输入款号"]
                    for row in kwargs["data_rows"]
                ]
                calls.append(current_codes)
                if current_codes == ["204426146031"]:
                    raise shenhui_shoe_packaging.ShoeSelectionError(
                        "204426146031 浅卡其50301 缺少 Ai角度图1，无法生成 jdt/wpt30"
                    )
                return (
                    [{"输入款号": current_codes[0], "处理动作": "已选图并按鞋品规则命名"}],
                    {current_codes[0]: output_root / current_codes[0]},
                )

            with patch.object(
                shenhui_shoe_packaging,
                "prepare_shoe_packages",
                side_effect=fake_prepare,
            ):
                report_rows, package_roots = (
                    shenhui_shoe_packaging.prepare_shoe_packages_skip_failed_styles(
                        data_rows=rows,
                        output_root=output_root,
                        log=logs.append,
                    )
                )

            self.assertEqual(
                calls,
                [
                    ["204326141005"],
                    ["204426146031"],
                    ["204426146036"],
                ],
            )
            self.assertFalse(failed_root.exists())
            self.assertFalse((output_root / "_shoe_analysis").exists())
            skipped = [
                row
                for row in report_rows
                if row["输入款号"] == "204426146031"
            ][0]
            self.assertEqual(skipped["处理动作"], "失败款跳过")
            self.assertEqual(skipped["下载结果"], "已跳过")
            self.assertIn("缺少 Ai角度图1", skipped["备注"])
            self.assertEqual(
                package_roots,
                {
                    "204326141005": output_root / "204326141005",
                    "204426146036": output_root / "204426146036",
                },
            )
            self.assertTrue(any("已跳过该款并继续其他款" in item for item in logs))

    def test_prepare_skip_failed_styles_preserves_failed_style_analysis_when_requested(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_root = Path(tmpdir) / "output"
            failed_analysis_marker = (
                output_root
                / "_shoe_analysis"
                / "204426146031"
                / "pose-evidence.json"
            )
            failed_analysis_marker.parent.mkdir(parents=True)
            failed_analysis_marker.write_text("{}", encoding="utf-8")
            rows = [
                {"输入款号": "204326141005", "下载结果": "已下载"},
                {"输入款号": "204426146031", "下载结果": "已下载"},
                {"输入款号": "204426146036", "下载结果": "已下载"},
            ]

            def fake_prepare(**kwargs):
                current_code = kwargs["data_rows"][0]["输入款号"]
                if current_code == "204426146031":
                    raise shenhui_shoe_packaging.ShoeSelectionError(
                        "204426146031 浅卡其50301 模型耗尽"
                    )
                return (
                    [{"输入款号": current_code, "处理动作": "已选图并按鞋品规则命名"}],
                    {current_code: output_root / current_code},
                )

            with patch.object(
                shenhui_shoe_packaging,
                "prepare_shoe_packages",
                side_effect=fake_prepare,
            ):
                shenhui_shoe_packaging.prepare_shoe_packages_skip_failed_styles(
                    data_rows=rows,
                    output_root=output_root,
                    log=lambda _message: None,
                    preserve_analysis_artifacts=True,
                )

            self.assertTrue(failed_analysis_marker.is_file())
            self.assertTrue((output_root / "_shoe_analysis" / "204426146031").is_dir())

    def test_skip_failed_styles_keeps_batch_progress_active_between_styles(self):
        rows = [
            {"输入款号": "204426146036", "下载结果": "已下载"},
            {"输入款号": "204426146127", "下载结果": "已下载"},
        ]
        progress_events = []

        def fake_prepare(**kwargs):
            style_code = kwargs["data_rows"][0]["输入款号"]
            kwargs["progress"]({
                "organize_total": 1,
                "organize_completed": 1,
                "organize_active": False,
                "organize_current_style": style_code,
                "organize_current_color": "",
                "organize_stage": "整理完成",
            })
            return ([{"输入款号": style_code}], {style_code: Path("/tmp") / style_code})

        with patch.object(
            shenhui_shoe_packaging,
            "prepare_shoe_packages",
            side_effect=fake_prepare,
        ):
            shenhui_shoe_packaging.prepare_shoe_packages_skip_failed_styles(
                data_rows=rows,
                output_root=Path("/tmp/shoe-output"),
                progress=progress_events.append,
            )

        self.assertTrue(progress_events[0]["organize_active"])
        self.assertIn("继续下一款", progress_events[0]["organize_stage"])
        self.assertFalse(progress_events[-1]["organize_active"])

    def test_label_ocr_can_use_benchmark_model_override(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs)
            return (
                {
                    "style_code": "204426146036",
                    "product_name": "儿童板鞋",
                    "color_name": "白紫色调00317",
                    "color_code": "00317",
                    "label_bbox": [100, 100, 900, 800],
                    "style_code_bbox": [150, 520, 430, 575],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color_label(
                style_code="204426146036",
                color_code="00317",
                label_image="data:image/jpeg;base64,/9j/2Q==",
                label_model_id="deepseek-official-v4-flash-vision-exp",
            )

        self.assertEqual(payload["color_code"], "00317")
        self.assertEqual(
            calls[0]["model_id"],
            "deepseek-official-v4-flash-vision-exp",
        )
        self.assertEqual(calls[0]["fallback_model_ids"], [])
        self.assertFalse(calls[0]["retry_same_model"])

    def test_prepare_shoe_packages_passes_progress_and_log_to_pose_analyzer(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            output_root = root / "out"
            reference_paths = []
            for name in ("main.jpg", "poster.jpg", "pose1.jpg", "yq.jpg"):
                path = root / name
                Image.new("RGB", (80, 80), (255, 255, 255)).save(path)
                reference_paths.append(path)

            filenames = [
                "tmz1.jpg",
                "tmz2.jpg",
                "tmz3.jpg",
                "tmz4.jpg",
                "tmz5.jpg",
                "o.jpg",
                "wpz6.jpg",
                "yq1.jpg",
                "yq2.jpg",
                "yq3.jpg",
                "204426146036-00317+Ai角度图1.png",
            ]
            rows = []
            for filename in filenames:
                path = root / filename
                Image.new("RGB", (90, 70), (245, 245, 245)).save(path)
                rows.append({
                    "输入款号": "204426146036",
                    "__shoe_color_code": "00317",
                    "__shoe_original_filename": filename,
                    "原文件名": filename,
                    "云盘路径": f"鞋品/204426146036/00317/{filename}",
                    "下载结果": "已下载",
                    "本地文件": str(path),
                })

            captured = {}
            logs = []
            progress_events = []

            def fake_analyzer(**kwargs):
                captured.update(kwargs)
                kwargs["log"]("模型尝试日志")
                kwargs["progress"](
                    "姿势识别 gpt-5.5 第1/3次 批次1/1",
                    style_code=kwargs["style_code"],
                    color_code=kwargs["color_code"],
                )
                return {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "slots": {
                        "tmz1": "tmz1.jpg",
                        "tmz2": "tmz2.jpg",
                        "tmz3": "tmz3.jpg",
                        "tmz4": "tmz4.jpg",
                        "tmz5": "tmz5.jpg",
                        "o": "o.jpg",
                        "wpz": [
                            "tmz1.jpg",
                            "tmz2.jpg",
                            "tmz3.jpg",
                            "tmz4.jpg",
                            "tmz5.jpg",
                            "wpz6.jpg",
                        ],
                        "yq": ["yq1.jpg", "yq2.jpg", "yq3.jpg"],
                        "yk": [],
                        "yx": "",
                    },
                }

            with patch.object(
                shenhui_shoe_packaging,
                "_apply_selection_quality_rules",
                side_effect=lambda category, slots, entries, **kwargs: (slots, []),
            ):
                report_rows, package_roots = shenhui_shoe_packaging.prepare_shoe_packages(
                    data_rows=rows,
                    output_root=output_root,
                    shoe_categories={"204426146036": "婴童"},
                    analyze_color=fake_analyzer,
                    analyze_color_label=False,
                    reference_image=reference_paths[0],
                    poster_reference_image=reference_paths[1],
                    pose1_reference_image=reference_paths[2],
                    yq_reference_image=reference_paths[3],
                    log=logs.append,
                    progress=progress_events.append,
                )

            self.assertIn("log", captured)
            self.assertIn("progress", captured)
            self.assertTrue(any("模型尝试日志" in item for item in logs))
            self.assertTrue(any(
                event.get("organize_stage", "").startswith("姿势识别 gpt-5.5")
                for event in progress_events
            ))
            self.assertIn("204426146036", package_roots)
            self.assertTrue(any(row["规则槽位"] == "tmz1" for row in report_rows))

    def test_label_ocr_timeout_fast_falls_back_without_deepseek_key(self):
        calls = []
        logs = []
        progress_events = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs["model_id"])
            if kwargs["model_id"] == "qwen3.7-plus":
                raise shenhui_shoe_packaging.llm_gateway.LlmGatewayError(
                    "文本模型接口连接失败：请求超过总时长 60 秒"
                )
            return (
                {
                    "style_code": "204426146036",
                    "product_name": "儿童板鞋",
                    "color_name": "白紫色调00317",
                    "color_code": "00317",
                    "label_bbox": [100, 100, 900, 800],
                    "style_code_bbox": [150, 520, 430, 575],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color_label(
                style_code="204426146036",
                color_code="00317",
                label_image="data:image/jpeg;base64,/9j/2Q==",
                label_model_id="qwen3.7-plus",
                fallback_model_ids=["gpt-5.6-sol"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
                log=logs.append,
                progress=lambda stage, **kwargs: progress_events.append((stage, kwargs)),
            )

        self.assertEqual(
            calls,
            [
                "qwen3.7-plus",
                "gpt-5.6-sol",
            ],
        )
        self.assertEqual(payload["_model_id"], "gpt-5.6-sol")
        self.assertIn("qwen3.7-plus", payload["_model_attempt_warnings"])
        self.assertFalse(any("耐心复测" in item for item in logs))
        self.assertTrue(any("直接切换独立 fallback" in item for item in logs))
        self.assertTrue(any("鞋盒标签 OCR gpt-5.6-sol" in item[0] for item in progress_events))

    def test_full_sheet_pose_consensus_continues_until_required_slots_lock(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs["model_id"])
            tmz4_id = "I14" if kwargs["model_id"] == "model-b" else "I04"
            return (
                {
                    "color_name": "梦幻粉60301",
                    "shoe_category": "婴童",
                    "candidates": _required_pose_candidate_facts(tmz4=tmz4_id),
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                style_code="204426146036",
                color_code="60301",
                contact_sheet="all.jpg",
                contact_sheets=["all.jpg"],
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
                reference_image="main-template.jpg",
                poster_reference_image="poster-template.jpg",
                pose1_reference_image="pose1-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids=_required_pose_candidate_ids("I14"),
                candidate_names=[],
                shoe_category="婴童",
                model_id="model-a",
                fallback_model_ids=["model-b", "model-c"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(calls, ["model-a", "model-b", "model-c"])
        self.assertEqual(payload["slots"]["tmz4"], "I04")
        self.assertEqual(payload["_model_votes"]["tmz4"]["status"], "locked")
        self.assertEqual(payload["_model_votes"]["tmz4"]["votes"], 2)

    def test_full_sheet_pose_consensus_fails_when_required_slot_never_locks(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs["model_id"])
            yq3_by_model = {
                "model-a": "I09",
                "model-b": "I19",
                "model-c": "I29",
            }
            return (
                {
                    "color_name": "梦幻粉60301",
                    "shoe_category": "婴童",
                    "candidates": _required_pose_candidate_facts(
                        yq3=yq3_by_model[kwargs["model_id"]]
                    ),
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            with self.assertRaisesRegex(
                shenhui_shoe_packaging.ShoeSelectionError,
                r"必需槽位未锁定.*yq3",
            ):
                shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="60301",
                    contact_sheet="all.jpg",
                    contact_sheets=["all.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
                    reference_image="main-template.jpg",
                    poster_reference_image="poster-template.jpg",
                    pose1_reference_image="pose1-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    candidate_ids=_required_pose_candidate_ids("I19", "I29"),
                    candidate_names=[],
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

        self.assertEqual(calls, ["model-a", "model-b", "model-c"])

    def test_pose_consensus_fails_closed_on_equal_family_tie(self):
        payloads = []
        for model_id, tmz1 in (
            ("model-a", "I01"),
            ("model-b", "I01"),
            ("model-c", "I10"),
            ("model-d", "I10"),
        ):
            payloads.append({
                "_model_id": model_id,
                "color_name": "梦幻粉60301",
                "shoe_category": "婴童",
                "candidates": _required_pose_candidate_facts(tmz1=tmz1),
            })

        result = shenhui_shoe_packaging._consensus_pose_payload(
            payloads,
            _required_pose_candidate_ids("I10"),
            "婴童",
            required_votes=2,
        )

        self.assertEqual(result["slots"]["tmz1"], "")
        self.assertEqual(result["_model_votes"]["tmz1"]["status"], "conflict_tie")
        self.assertTrue(any(
            issue.get("slot") == "tmz1"
            and issue.get("status") == "conflict_tie"
            for issue in result["_consensus_issues"]
        ))

    def test_replacing_targeted_tmz_slot_updates_wpz_without_overwriting_yq1(self):
        slots = {
            "tmz2": "I02",
            "tmz3": "I03",
            "wpz": ["I01", "I02", "I03", "I04", "I05", "I06"],
            "yq": ["I02", "I08", "I09"],
        }

        shenhui_shoe_packaging._replace_consensus_slot_value(slots, "tmz2", "I12")
        shenhui_shoe_packaging._replace_consensus_slot_value(slots, "tmz3", "I13")

        self.assertEqual(slots["tmz2"], "I12")
        self.assertEqual(slots["wpz"][1], "I12")
        self.assertEqual(slots["yq"][0], "I02")
        self.assertEqual(slots["tmz3"], "I13")
        self.assertEqual(slots["wpz"][2], "I13")

    def test_targeted_payload_discards_non_target_slot_hints(self):
        candidate_ids = {"I01": "one.jpg", "I02": "two.jpg"}
        payload = {
            "color_name": "梦幻粉60301",
            "shoe_category": "婴童",
            "candidates": [
                _candidate_fact("I01", "tmz3", filename="one.jpg", shoe_count="single"),
                _candidate_fact("I02", "tmz2", filename="two.jpg"),
            ],
        }

        restricted = shenhui_shoe_packaging._restrict_pose_payload_to_target_slot(
            payload,
            candidate_ids,
            "tmz3",
        )

        self.assertEqual(restricted["candidates"][0]["matched_slots"], ["tmz3"])
        self.assertEqual(restricted["candidates"][1]["matched_slots"], [])
        self.assertEqual(restricted["candidates"][1]["pose"], "other")

    def test_targeted_payload_promotes_unique_valid_wpz5_from_hard_facts(self):
        restricted = shenhui_shoe_packaging._restrict_pose_payload_to_target_slot(
            {
                "color_name": "梦幻粉60301",
                "shoe_category": "婴童",
                "candidates": [
                    _candidate_fact(
                        "I01",
                        filename="one.jpg",
                        shoe_count="single",
                        background="gray",
                    ),
                ],
            },
            {"I01": "one.jpg"},
            "wpz5",
        )

        self.assertEqual(restricted["candidates"][0]["matched_slots"], ["wpz5"])
        self.assertEqual(restricted["candidates"][0]["pose"], "wpz5")

    def test_targeted_payload_does_not_promote_invalid_unique_wpz5(self):
        invalid_facts = {
            "pair": _candidate_fact(
                "I01",
                filename="pair.jpg",
                shoe_count="pair",
            ),
            "shoe_box": _candidate_fact(
                "I01",
                filename="box.jpg",
                asset_type="shoe_box",
                shoe_count="single",
            ),
            "incomplete": _candidate_fact(
                "I01",
                filename="partial.jpg",
                shoe_count="single",
                complete=False,
            ),
        }

        for case, fact in invalid_facts.items():
            with self.subTest(case=case):
                restricted = shenhui_shoe_packaging._restrict_pose_payload_to_target_slot(
                    {
                        "color_name": "梦幻粉60301",
                        "shoe_category": "婴童",
                        "candidates": [fact],
                    },
                    {"I01": fact["filename"]},
                    "wpz5",
                )

                self.assertEqual(restricted["candidates"][0]["matched_slots"], [])
                self.assertEqual(restricted["candidates"][0]["pose"], "other")

    def test_global_pages_focused_consensus_resolves_cross_page_conflicts(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_ids["I07"] = "wrong-box.jpg"
            candidate_ids["I13"] = "true-box.jpg"
            candidate_entries = []
            for offset, (candidate_id, filename) in enumerate(candidate_ids.items()):
                path = root / f"{candidate_id}-{filename}"
                Image.new("RGB", (120, 100), (offset * 13 % 255, 100, 180)).save(path)
                candidate_entries.append({"filename": filename, "path": path})

            page_one_facts = _required_pose_candidate_facts(wpz6="I07")
            page_two_facts = [
                _candidate_fact("I13", "wpz6", filename="true-box.jpg"),
            ]
            calls = []
            pose_evidence_path = root / "pose-evidence.json"
            evidence_writes = []
            original_evidence_writer = shenhui_shoe_packaging._write_pose_analysis_evidence

            def recording_evidence_writer(**kwargs):
                evidence_writes.append({
                    "status": kwargs["status"],
                    "focused_consensus": json.loads(json.dumps(
                        kwargs.get("focused_consensus") or {},
                        ensure_ascii=False,
                    )),
                })
                return original_evidence_writer(**kwargs)

            def fake_multimodal_json(**kwargs):
                image_name = Path(kwargs["image_inputs"][0]).name
                calls.append((kwargs["model_id"], image_name))
                if "focused" in image_name:
                    facts = _required_pose_candidate_facts(wpz6="I13")
                elif image_name == "global-1.jpg":
                    facts = page_one_facts
                else:
                    facts = page_two_facts
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ), patch.object(
                shenhui_shoe_packaging,
                "_write_pose_analysis_evidence",
                side_effect=recording_evidence_writer,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                    pose_evidence_path=str(pose_evidence_path),
                )

            self.assertEqual(payload["slots"]["wpz"][5], "I13")
            self.assertEqual(len(calls), 11)
            base_focused_calls = [
                item for item in calls
                if Path(item[1]).stem.removeprefix("00317-focused-").isdigit()
            ]
            self.assertEqual(
                [model for model, _name in base_focused_calls],
                ["model-a", "model-b", "model-c"],
            )
            self.assertEqual(payload["_model_votes_by_batch"][0]["wpz6"]["selected"], "I07")
            self.assertEqual(payload["_model_votes_by_batch"][1]["wpz6"]["selected"], "I13")
            pose_evidence = json.loads(pose_evidence_path.read_text(encoding="utf-8"))
            self.assertEqual(
                pose_evidence["focused_consensus"]["model_votes"]["wpz6"]["selected"],
                "I13",
            )
            self.assertTrue(any(
                item["status"] == "partial"
                and item["focused_consensus"].get("routes")
                == ["model-a", "model-b", "model-c"]
                for item in evidence_writes
            ))

    def test_focused_shortlist_keeps_unvoted_candidates_when_all_families_fit(self):
        candidate_ids = {
            "I01": "nominated.jpg",
            "I02": "unvoted-but-possible.jpg",
            "I03": "unvoted-box.jpg",
        }
        payloads_by_batch = {
            1: [{
                "_model_id": "model-a",
                "color_name": "白紫色调00317",
                "shoe_category": "婴童",
                "candidates": [
                    _candidate_fact("I01", "tmz1", filename="nominated.jpg"),
                ],
            }],
        }

        finalists = shenhui_shoe_packaging._focused_candidate_ids_from_page_payloads(
            payloads_by_batch=payloads_by_batch,
            batch_inputs=[{
                "batch_index": 1,
                "candidate_ids": candidate_ids,
            }],
            candidate_ids=candidate_ids,
            shoe_category="婴童",
            style_code="204426146036",
            color_code="00317",
        )

        self.assertEqual(finalists, candidate_ids)

    def test_focused_shortlist_preserves_copy_and_original_as_separate_candidates(self):
        candidate_ids = {
            "I01": "GUDO7228 拷贝.jpg",
            "I02": "GUDO7228.jpg",
        }
        payloads_by_batch = {
            1: [{
                "_model_id": "model-a",
                "color_name": "白紫色调00317",
                "shoe_category": "婴童",
                "candidates": [
                    _candidate_fact("I01", "tmz1", filename="GUDO7228 拷贝.jpg"),
                ],
            }],
        }

        finalists = shenhui_shoe_packaging._focused_candidate_ids_from_page_payloads(
            payloads_by_batch=payloads_by_batch,
            batch_inputs=[{
                "batch_index": 1,
                "candidate_ids": candidate_ids,
            }],
            candidate_ids=candidate_ids,
            shoe_category="婴童",
            style_code="204426146036",
            color_code="00317",
        )

        self.assertEqual(finalists, candidate_ids)

    def test_focused_shortlist_fails_closed_above_total_candidate_limit(self):
        candidate_ids = {
            f"I{index:02d}": f"{index}.jpg"
            for index in range(1, shenhui_shoe_packaging.SHOE_FOCUSED_MAX_CANDIDATES + 2)
        }
        payloads_by_batch = {
            1: [{
                "_model_id": "model-a",
                "color_name": "白紫色调00317",
                "shoe_category": "婴童",
                "candidates": [
                    _candidate_fact("I01", "tmz1", filename="1.jpg"),
                ],
            }],
        }

        with self.assertRaisesRegex(
            shenhui_shoe_packaging.ShoeSelectionError,
            "候选过多.*37.*拒绝静默截断",
        ):
            shenhui_shoe_packaging._focused_candidate_ids_from_page_payloads(
                payloads_by_batch=payloads_by_batch,
                batch_inputs=[{
                    "batch_index": 1,
                    "candidate_ids": candidate_ids,
                }],
                candidate_ids=candidate_ids,
                shoe_category="婴童",
                style_code="204426146036",
                color_code="00317",
            )

    def test_global_pages_conflict_slot_requires_three_agreeing_focused_votes(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (120, 100), (index * 13 % 255, 120, 180)).save(path)
                candidate_entries.append({"filename": filename, "path": path})

            def fake_multimodal_json(**kwargs):
                image_name = Path(kwargs["image_inputs"][0]).name
                if "focused" in image_name:
                    wpz6 = "I07" if kwargs["model_id"] == "model-c" else "I13"
                    facts = _required_pose_candidate_facts(wpz6=wpz6)
                elif image_name == "global-1.jpg":
                    facts = _required_pose_candidate_facts(wpz6="I07")
                else:
                    facts = [_candidate_fact("I13", "wpz6", filename="13.jpg")]
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                with self.assertRaisesRegex(
                    shenhui_shoe_packaging.ShoeSelectionError,
                    "focused.*wpz6",
                ):
                    shenhui_shoe_packaging._default_analyze_color(
                        style_code="204426146036",
                        color_code="00317",
                        contact_sheet="global-1.jpg",
                        contact_sheets=["global-1.jpg", "global-2.jpg"],
                        pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                        reference_image="main-template.jpg",
                        main_pose_reference_sheet="main-pose-sheet.jpg",
                        poster_reference_image="poster-template.jpg",
                        yq_reference_image="yq-template.jpg",
                        candidate_ids=candidate_ids,
                        candidate_entries=candidate_entries,
                        candidate_names=list(candidate_ids.values()),
                        shoe_category="婴童",
                        model_id="model-a",
                        fallback_model_ids=["model-b", "model-c"],
                        config={"ai": {"llm": {"api_key": "gateway-key"}}},
                    )

    def test_global_pages_rechecks_only_unresolved_slot_against_exact_template(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (120, 100), (index * 23 % 255, 110, 190)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            calls = []
            pose_evidence_path = root / "pose-evidence.json"

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                calls.append((kwargs["model_id"], image_name, prompt))
                if "本轮只裁决 tmz3" in prompt:
                    facts = [
                        _candidate_fact(
                            "I03",
                            "tmz3",
                            filename="3.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif "focused" in image_name:
                    tmz3 = "I03" if kwargs["model_id"] == "model-c" else "I13"
                    facts = _required_pose_candidate_facts(tmz3=tmz3)
                elif image_name == "global-1.jpg":
                    facts = _required_pose_candidate_facts(tmz3="I03")
                else:
                    facts = [
                        _candidate_fact(
                            "I13",
                            "tmz3",
                            filename="13.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                return (
                    {
                        "color_name": "梦幻粉60301",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="60301",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c", "model-d"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                    pose_evidence_path=str(pose_evidence_path),
                )

            base_focused_calls = [
                item for item in calls
                if Path(item[1]).stem.removeprefix("60301-focused-").isdigit()
            ]
            self.assertEqual(
                [model for model, _name, _prompt in base_focused_calls],
                ["model-a", "model-b", "model-c"],
            )
            targeted_calls = [item for item in calls if "本轮只裁决 tmz3" in item[2]]
            self.assertEqual([item[0] for item in targeted_calls], ["model-a", "model-b", "model-c"])
            self.assertEqual(payload["slots"]["tmz3"], "I03")
            self.assertEqual(payload["slots"]["wpz"][2], "I03")
            self.assertEqual(
                payload["_targeted_slot_consensus"]["tmz3"]["model_votes"]["tmz3"]["votes"],
                3,
            )
            pose_evidence = json.loads(pose_evidence_path.read_text(encoding="utf-8"))
            targeted_evidence = pose_evidence["focused_consensus"]["targeted_slot_consensus"]
            self.assertEqual(targeted_evidence["tmz3"]["status"], "locked")
            self.assertEqual(targeted_evidence["tmz3"]["routes"], [
                "model-a",
                "model-b",
                "model-c",
            ])

    def test_global_pages_mandatory_tmz3_recheck_overrides_wrong_focused_consensus(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (120, 100), (index * 19 % 255, 105, 185)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            calls = []

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                model_id = kwargs["model_id"]
                calls.append((model_id, image_name, prompt))
                if "本轮只裁决 tmz3" in prompt:
                    facts = [
                        _candidate_fact(
                            "I03",
                            "tmz3",
                            filename="3.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif "本轮只裁决 wpz5" in prompt:
                    facts = [
                        _candidate_fact(
                            "I06",
                            "wpz5",
                            filename="6.jpg",
                            shoe_count="single",
                        )
                    ]
                elif "focused" in image_name:
                    facts = _required_pose_candidate_facts(tmz3="I13")
                elif image_name == "global-1.jpg":
                    facts = [
                        fact
                        for fact in _required_pose_candidate_facts()
                        if "tmz3" not in fact["matched_slots"]
                    ]
                else:
                    facts = [
                        _candidate_fact(
                            "I13",
                            "tmz3",
                            filename="13.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                return (
                    {
                        "color_name": "梦幻粉60301",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": model_id})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="60301",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            targeted_calls = [
                item for item in calls
                if "本轮只裁决 tmz3" in item[2]
            ]
            self.assertEqual(
                [item[0] for item in targeted_calls],
                ["model-a", "model-b"],
            )
            self.assertEqual(payload["slots"]["tmz3"], "I03")
            self.assertEqual(payload["slots"]["wpz"][2], "I03")
            tmz3_evidence = payload["_targeted_slot_consensus"]["tmz3"]
            self.assertEqual(tmz3_evidence["status"], "locked")
            self.assertEqual(tmz3_evidence["required_votes"], 2)

    def test_global_pages_missing_mandatory_slot_references_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = _required_pose_candidate_ids("I13")
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (120, 100), (index * 23 % 255, 110, 180)).save(path)
                candidate_entries.append({"filename": filename, "path": path})

            def fake_multimodal_json(**kwargs):
                image_name = Path(kwargs["image_inputs"][0]).name
                facts = (
                    [_candidate_fact("I13", filename="I13.jpg")]
                    if image_name == "global-2.jpg"
                    else _required_pose_candidate_facts()
                )
                return (
                    {
                        "color_name": "梦幻粉60301",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                with self.assertRaisesRegex(
                    shenhui_shoe_packaging.ShoeSelectionError,
                    "tmz3,wpz5",
                ):
                    shenhui_shoe_packaging._default_analyze_color(
                        style_code="204426146036",
                        color_code="60301",
                        contact_sheet="global-1.jpg",
                        contact_sheets=["global-1.jpg", "global-2.jpg"],
                        pose_strategy=(
                            shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES
                        ),
                        reference_image="main-template.jpg",
                        main_pose_reference_sheet="main-pose-sheet.jpg",
                        poster_reference_image="poster-template.jpg",
                        yq_reference_image="yq-template.jpg",
                        yq_reference_images={
                            f"yq{index}": f"yq{index}-template.jpg"
                            for index in range(1, 4)
                        },
                        candidate_ids=candidate_ids,
                        candidate_entries=candidate_entries,
                        candidate_names=list(candidate_ids.values()),
                        shoe_category="婴童",
                        model_id="model-a",
                        fallback_model_ids=["model-b"],
                        config={"ai": {"llm": {"api_key": "gateway-key"}}},
                    )

    def test_global_pages_rechecks_unresolved_yq1_against_its_own_template(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (120, 100), (index * 29 % 255, 115, 185)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            calls = []

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                calls.append({
                    "model_id": kwargs["model_id"],
                    "image_inputs": list(kwargs["image_inputs"]),
                    "prompt": prompt,
                })
                if "本轮只裁决 yq1" in prompt:
                    facts = [
                        _candidate_fact(
                            "I10",
                            "yq1",
                            filename="10.jpg",
                            shoe_count="pair",
                            pose="yq1 oblique front with rear outsole",
                        )
                    ]
                elif "focused" in image_name:
                    yq1_by_model = {
                        "model-a": "I10",
                        "model-b": "I11",
                        "model-c": "I12",
                    }
                    facts = _required_pose_candidate_facts(
                        yq1=yq1_by_model[kwargs["model_id"]]
                    )
                elif image_name == "global-1.jpg":
                    facts = _required_pose_candidate_facts()
                else:
                    facts = [_candidate_fact("I13", filename="13.jpg")]
                return (
                    {
                        "color_name": "梦幻粉60301",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="60301",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            targeted_calls = [
                call for call in calls
                if "本轮只裁决 yq1" in call["prompt"]
            ]
            self.assertEqual(
                [call["model_id"] for call in targeted_calls],
                ["model-a", "model-b"],
            )
            self.assertTrue(all(
                call["image_inputs"][-1] == "yq1-template.jpg"
                for call in targeted_calls
            ))
            self.assertEqual(payload["slots"]["yq"][0], "I10")
            self.assertEqual(
                payload["_targeted_slot_consensus"]["yq1"]["model_votes"]["yq1"]["votes"],
                2,
            )

    def test_global_pages_filters_occupied_family_before_targeted_wpz5_vote(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (160, 120), (index * 21 % 255, 105, 180)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            targeted_prompts = []

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                if "本轮只裁决 wpz5" in prompt:
                    targeted_prompts.append(prompt)
                    facts = [
                        _candidate_fact(
                            "I06",
                            *("wpz5",) if kwargs["model_id"] == "model-b" else (),
                            filename="6.jpg",
                            shoe_count=(
                                "pair"
                                if kwargs["model_id"] == "model-c"
                                else "single"
                            ),
                            background="gray",
                        )
                    ]
                elif "focused" in image_name:
                    facts = _required_pose_candidate_facts(
                        wpz5=("I06" if kwargs["model_id"] == "model-a" else "I13")
                    )
                else:
                    facts = _required_pose_candidate_facts()
                return (
                    {
                        "color_name": "梦幻粉60301",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="60301",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            self.assertEqual(payload["slots"]["wpz"][4], "I06")
            self.assertEqual(len(targeted_prompts), 5)
            self.assertTrue(all("I06=6.jpg" in prompt for prompt in targeted_prompts))
            self.assertTrue(all("I02=2.jpg" not in prompt for prompt in targeted_prompts))
            evidence = payload["_targeted_slot_consensus"]["wpz5"]
            self.assertEqual(evidence["required_votes"], 2)
            self.assertIn("I02", evidence["excluded_candidates"])
            self.assertEqual(len(evidence["rounds"]), 2)
            self.assertEqual(
                evidence["rounds"][1]["candidate_ids"],
                {"I06": "6.jpg"},
            )
            self.assertEqual(
                evidence["rounds"][1]["routes"],
                ["model-a", "model-b"],
            )
            self.assertTrue(all(
                "focused-wpz5-round1" in Path(path).name
                for path in evidence["rounds"][0]["contact_sheets"]
            ))

    def test_global_pages_targeted_yq3_runs_fresh_finalist_round_on_disagreement(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (160, 120), (index * 19 % 255, 115, 170)).save(path)
                candidate_entries.append({"filename": filename, "path": path})

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                if "本轮只裁决 yq3" in prompt and "yq3-round2" in image_name:
                    facts = [
                        _candidate_fact(
                            "I09",
                            "yq3",
                            filename="9.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif "本轮只裁决 yq3" in prompt:
                    selected = "I09" if kwargs["model_id"] == "model-a" else "I13"
                    facts = [
                        _candidate_fact(
                            selected,
                            "yq3",
                            filename=candidate_ids[selected],
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif "focused" in image_name:
                    facts = _required_pose_candidate_facts(
                        yq3=("I09" if kwargs["model_id"] == "model-a" else "I13")
                    )
                else:
                    facts = _required_pose_candidate_facts()
                return (
                    {
                        "color_name": "梦幻粉60301",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="60301",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            self.assertEqual(payload["slots"]["yq"][2], "I09")
            evidence = payload["_targeted_slot_consensus"]["yq3"]
            self.assertEqual(evidence["status"], "locked")
            self.assertEqual(len(evidence["rounds"]), 2)
            self.assertEqual(
                evidence["rounds"][0]["candidate_ids"],
                {
                    "I09": "9.jpg",
                    "I11": "11.jpg",
                    "I12": "12.jpg",
                    "I13": "13.jpg",
                },
            )
            self.assertEqual(
                evidence["rounds"][1]["candidate_ids"],
                {"I09": "9.jpg", "I13": "13.jpg"},
            )
            self.assertTrue(any(
                "focused-yq3-round2" in Path(path).name
                for path in evidence["contact_sheets"]
            ))

    def test_global_pages_targeted_probe_timeout_disables_model_for_later_rounds(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (160, 120), (index * 13 % 255, 125, 165)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            targeted_calls = []

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                model_id = kwargs["model_id"]
                if "本轮只裁决 yq3" in prompt:
                    targeted_calls.append((model_id, image_name))
                    if model_id == "model-a":
                        raise shenhui_shoe_packaging.llm_gateway.LlmGatewayError(
                            "请求超过总时长 90 秒"
                        )
                    selected = "I09" if "yq3-round2" in image_name else {
                        "model-b": "I09",
                        "model-c": "I13",
                        "model-d": "I09",
                    }[model_id]
                    facts = [
                        _candidate_fact(
                            selected,
                            "yq3",
                            filename=candidate_ids[selected],
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif "focused" in image_name:
                    facts = _required_pose_candidate_facts(
                        yq3={
                            "model-a": "I09",
                            "model-b": "I13",
                            "model-c": "I12",
                        }[model_id]
                    )
                else:
                    facts = _required_pose_candidate_facts()
                return (
                    {
                        "color_name": "梦幻粉60301",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": model_id})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="60301",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c", "model-d"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            self.assertEqual(payload["slots"]["yq"][2], "I09")
            model_a_calls = [call for call in targeted_calls if call[0] == "model-a"]
            self.assertEqual(len(model_a_calls), 1)
            self.assertTrue(all("yq3-round1" in image_name for _model, image_name in model_a_calls))
            self.assertFalse(any(
                model == "model-a" and "yq3-round2" in image_name
                for model, image_name in targeted_calls
            ))

    def test_global_pages_focused_probe_timeout_disables_model_before_targeted_recheck(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (160, 120), (index * 11 % 255, 125, 165)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            focused_calls = []
            targeted_calls = []

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                model_id = kwargs["model_id"]
                if "本轮只裁决 yq3" in prompt:
                    targeted_calls.append(model_id)
                    facts = [
                        _candidate_fact(
                            "I09",
                            "yq3",
                            filename="I09.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif "focused" in image_name:
                    focused_calls.append((model_id, kwargs["timeout_seconds"]))
                    if model_id == "model-a":
                        raise shenhui_shoe_packaging.llm_gateway.LlmGatewayError(
                            "请求超过总时长 90 秒"
                        )
                    facts = _required_pose_candidate_facts(
                        yq3=("I09" if model_id == "model-b" else "I13")
                    )
                else:
                    facts = _required_pose_candidate_facts()
                return (
                    {
                        "color_name": "梦幻粉60301",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": model_id})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="60301",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c", "model-d"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            self.assertEqual(payload["slots"]["yq"][2], "I09")
            self.assertIn(
                ("model-a", shenhui_shoe_packaging.SHOE_POSE_MODEL_TIMEOUT_SECONDS),
                focused_calls,
            )
            self.assertNotIn(
                ("model-a", shenhui_shoe_packaging.SHOE_POSE_TIMEOUT_PROBE_SECONDS),
                focused_calls,
            )
            self.assertCountEqual(targeted_calls, ["model-b", "model-c"])
            self.assertNotIn("model-a", targeted_calls)
            self.assertEqual(
                payload["_targeted_slot_consensus"]["yq3"]["required_votes"],
                2,
            )

    def test_global_pages_conflict_route_requirement_degrades_after_page_timeout(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (160, 120), (index * 17 % 255, 130, 170)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            pose_evidence_path = root / "pose-evidence.json"

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                model_id = kwargs["model_id"]
                if image_name in {"global-1.jpg", "global-2.jpg"} and model_id == "model-a":
                    raise shenhui_shoe_packaging.llm_gateway.LlmGatewayError(
                        "请求超过总时长 90 秒"
                    )
                if "本轮只裁决 wpz6" in prompt:
                    facts = [_candidate_fact("I13", "wpz6", filename="13.jpg")]
                elif "focused" in image_name:
                    facts = _required_pose_candidate_facts(wpz6="I13")
                elif image_name == "global-1.jpg":
                    facts = _required_pose_candidate_facts(wpz6="I07")
                else:
                    facts = [_candidate_fact("I13", "wpz6", filename="13.jpg")]
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": model_id})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                    pose_evidence_path=str(pose_evidence_path),
                )

            self.assertEqual(payload["slots"]["wpz"][5], "I13")
            focused_evidence = json.loads(pose_evidence_path.read_text(encoding="utf-8"))[
                "focused_consensus"
            ]
            self.assertEqual(focused_evidence["required_route_count"], 2)
            self.assertEqual(
                focused_evidence["required_votes_by_slot"]["wpz6"],
                2,
            )

    def test_global_pages_conflict_detection_includes_insufficient_page_candidate(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (120, 100), (index * 17 % 255, 130, 170)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            calls = []

            def fake_multimodal_json(**kwargs):
                image_name = Path(kwargs["image_inputs"][0]).name
                calls.append((kwargs["model_id"], image_name))
                if "focused" in image_name:
                    facts = _required_pose_candidate_facts(wpz6="I13")
                elif image_name == "global-1.jpg":
                    facts = _required_pose_candidate_facts(wpz6="I07")
                elif kwargs["model_id"] == "model-a":
                    facts = [_candidate_fact("I13", "wpz6", filename="13.jpg")]
                else:
                    facts = [{
                        "candidate_id": "I12",
                        "filename": "12.jpg",
                        "asset_type": "shoe_detail",
                        "shoe_count": "detail",
                        "pose": "detail",
                        "background": "gray",
                        "complete": False,
                        "side": "unknown",
                        "outsole_visible": False,
                        "feature_card": False,
                        "matched_slots": [],
                        "confidence": 0.9,
                    }]
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            self.assertEqual(payload["slots"]["wpz"][5], "I13")
            self.assertEqual(len(calls), 10)
            base_focused_calls = [
                item for item in calls
                if Path(item[1]).stem.removeprefix("00317-focused-").isdigit()
            ]
            self.assertEqual(
                [model for model, _name in base_focused_calls],
                ["model-a", "model-b"],
            )

    def test_global_pages_lets_focused_resolve_slot_missing_from_page_consensus(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (120, 100), (index * 19 % 255, 125, 175)).save(path)
                candidate_entries.append({"filename": filename, "path": path})
            calls = []

            page_one_facts = [
                fact
                for fact in _required_pose_candidate_facts()
                if "wpz5" not in fact.get("matched_slots", [])
            ]
            page_two_facts = [{
                "candidate_id": "I13",
                "filename": "13.jpg",
                "asset_type": "shoe_detail",
                "shoe_count": "detail",
                "pose": "detail",
                "background": "gray",
                "complete": False,
                "side": "unknown",
                "outsole_visible": False,
                "feature_card": False,
                "matched_slots": [],
                "confidence": 0.9,
            }]

            def fake_multimodal_json(**kwargs):
                image_name = Path(kwargs["image_inputs"][0]).name
                calls.append((kwargs["model_id"], image_name))
                if "focused" in image_name:
                    facts = _required_pose_candidate_facts()
                elif image_name == "global-1.jpg":
                    facts = page_one_facts
                else:
                    facts = page_two_facts
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            self.assertEqual(payload["slots"]["wpz"][4], "I06")
            self.assertEqual(len(calls), 10)
            base_focused_calls = [
                item for item in calls
                if Path(item[1]).stem.removeprefix("00317-focused-").isdigit()
            ]
            self.assertEqual(
                [model for model, _name in base_focused_calls],
                ["model-a", "model-b"],
            )

    def test_global_pages_requires_focused_sources_for_multiple_pages(self):
        def fake_multimodal_json(**kwargs):
            if kwargs["image_inputs"][0] == "global-1.jpg":
                facts = _required_pose_candidate_facts(wpz6="I07")
            else:
                facts = [
                    _candidate_fact("I13", "wpz6", filename="13.jpg"),
                ]
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": facts,
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        candidate_ids = {
            f"I{index:02d}": f"{index}.jpg"
            for index in range(1, 14)
        }
        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            with self.assertRaisesRegex(
                shenhui_shoe_packaging.ShoeSelectionError,
                "focused.*candidate_entries",
            ):
                shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    candidate_ids=candidate_ids,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

    def test_global_pages_fails_closed_when_focused_models_disagree(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 14)
            }
            candidate_ids["I07"] = "page-one-box.jpg"
            candidate_ids["I13"] = "page-two-box.jpg"
            candidate_entries = []
            for offset, (candidate_id, filename) in enumerate(candidate_ids.items()):
                path = root / f"{candidate_id}-{filename}"
                Image.new("RGB", (120, 100), (offset * 17 % 255, 130, 170)).save(path)
                candidate_entries.append({"filename": filename, "path": path})

            calls = []

            def fake_multimodal_json(**kwargs):
                image_name = Path(kwargs["image_inputs"][0]).name
                calls.append((kwargs["model_id"], image_name))
                if "focused" in image_name:
                    box_id = "I07" if kwargs["model_id"] == "model-a" else "I13"
                    facts = _required_pose_candidate_facts(wpz6=box_id)
                elif image_name == "global-1.jpg":
                    facts = _required_pose_candidate_facts(wpz6="I07")
                else:
                    facts = [
                        _candidate_fact("I13", "wpz6", filename="page-two-box.jpg"),
                    ]
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                with self.assertRaisesRegex(
                    shenhui_shoe_packaging.ShoeSelectionError,
                    "focused.*wpz6",
                ):
                    shenhui_shoe_packaging._default_analyze_color(
                        style_code="204426146036",
                        color_code="00317",
                        contact_sheet="global-1.jpg",
                        contact_sheets=["global-1.jpg", "global-2.jpg"],
                        pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                        reference_image="main-template.jpg",
                        main_pose_reference_sheet="main-pose-sheet.jpg",
                        poster_reference_image="poster-template.jpg",
                        yq_reference_image="yq-template.jpg",
                        candidate_ids=candidate_ids,
                        candidate_entries=candidate_entries,
                        candidate_names=list(candidate_ids.values()),
                        shoe_category="婴童",
                        model_id="model-a",
                        fallback_model_ids=["model-b"],
                        config={"ai": {"llm": {"api_key": "gateway-key"}}},
                    )

            self.assertTrue(any("focused" in name for _model, name in calls))

    def test_pose_evidence_is_written_when_consensus_fails_after_partial_success(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            evidence_path = Path(tmpdir) / "pose-evidence.json"

            def fake_multimodal_json(**kwargs):
                if kwargs["model_id"] == "model-a":
                    return (
                        {
                            "color_name": "梦幻粉60301",
                            "shoe_category": "婴童",
                            "candidates": _required_pose_candidate_facts(),
                        },
                        type("Route", (), {"model_id": "model-a"})(),
                    )
                raise shenhui_shoe_packaging.llm_gateway.LlmResponseError(
                    "synthetic structured failure"
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                with self.assertRaisesRegex(
                    shenhui_shoe_packaging.ShoeSelectionError,
                    "独立模型共识不足",
                ):
                    shenhui_shoe_packaging._default_analyze_color(
                        style_code="204426146036",
                        color_code="60301",
                        contact_sheet="all.jpg",
                        contact_sheets=["all.jpg"],
                        pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
                        reference_image="main-template.jpg",
                        poster_reference_image="poster-template.jpg",
                        pose1_reference_image="pose1-template.jpg",
                        yq_reference_image="yq-template.jpg",
                        candidate_ids=_required_pose_candidate_ids(),
                        candidate_names=[],
                        shoe_category="婴童",
                        model_id="model-a",
                        fallback_model_ids=["model-b"],
                        config={"ai": {"llm": {"api_key": "gateway-key"}}},
                        pose_evidence_path=str(evidence_path),
                    )

            evidence = json.loads(evidence_path.read_text(encoding="utf-8"))
            self.assertEqual(evidence["style_code"], "204426146036")
            self.assertEqual(evidence["color_code"], "60301")
            self.assertEqual(
                evidence["pose_strategy"],
                shenhui_shoe_packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
            )
            self.assertEqual(evidence["status"], "failed")
            self.assertEqual(evidence["candidate_ids"]["I01"], "I01.jpg")
            self.assertEqual(evidence["route_evidence"][0]["model_id"], "model-a")
            self.assertTrue(evidence["route_evidence"][0]["candidate_facts"])
            self.assertTrue(evidence["route_evidence"][0]["slot_decisions"])
            self.assertEqual(
                evidence["consensus_by_batch"][0]["model_votes"]["tmz1"]["votes"],
                1,
            )
            self.assertTrue(
                any("synthetic structured failure" in item for item in evidence["errors"])
            )
            serialized = json.dumps(evidence, ensure_ascii=False).lower()
            self.assertNotIn("gateway-key", serialized)
            self.assertNotIn("system_prompt", serialized)
            self.assertNotIn("user_prompt", serialized)

    def test_pose_timeout_uses_fresh_fallback_before_retrying_slow_model(self):
        calls = []
        logs = []

        def fake_multimodal_json(**kwargs):
            calls.append((kwargs["model_id"], kwargs["timeout_seconds"]))
            if len(calls) == 1:
                raise shenhui_shoe_packaging.llm_gateway.LlmGatewayError(
                    "文本模型接口连接失败：请求超过总时长 60 秒"
                )
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": _required_pose_candidate_facts(),
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="contact-1.jpg",
                contact_sheets=["contact-1.jpg"],
                reference_image="main-template.jpg",
                poster_reference_image="poster-template.jpg",
                pose1_reference_image="pose1-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids=_required_pose_candidate_ids(),
                candidate_names=[],
                shoe_category="",
                model_id="multi-model",
                fallback_model_ids=["gpt-5.6-sol", "gpt-5.6-terra"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
                log=logs.append,
            )

        self.assertEqual(
            calls,
            [
                ("gpt-5.6-sol", shenhui_shoe_packaging.SHOE_POSE_MODEL_TIMEOUT_SECONDS),
                ("gpt-5.6-terra", shenhui_shoe_packaging.SHOE_POSE_MODEL_TIMEOUT_SECONDS),
            ],
        )
        self.assertEqual(payload["_model_id"], "gpt-5.6-terra")
        self.assertIn("gpt-5.6-sol", payload["_model_attempt_warnings"])
        self.assertTrue(any("优先切换独立 fallback" in item for item in logs))
        self.assertFalse(any("单批耐心复测" in item for item in logs))

    def test_pose_timeout_without_fallback_fails_closed_without_patient_retry(self):
        calls = []
        logs = []

        def fake_multimodal_json(**kwargs):
            calls.append((kwargs["model_id"], kwargs["timeout_seconds"]))
            raise shenhui_shoe_packaging.llm_gateway.LlmGatewayError(
                "文本模型接口连接失败：请求超过总时长 60 秒"
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            with self.assertRaises(shenhui_shoe_packaging.ShoeSelectionError):
                shenhui_shoe_packaging._default_analyze_color(
                    consensus_required_votes=1,
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="contact-1.jpg",
                    contact_sheets=["contact-1.jpg"],
                    reference_image="main-template.jpg",
                    poster_reference_image="poster-template.jpg",
                    pose1_reference_image="pose1-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    candidate_ids=_required_pose_candidate_ids(),
                    candidate_names=[],
                    shoe_category="",
                    model_id="gpt-5.6-sol",
                    fallback_model_ids=[],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                    log=logs.append,
                )

        self.assertEqual(
            calls,
            [
                (
                    "gpt-5.6-sol",
                    shenhui_shoe_packaging.SHOE_POSE_MODEL_TIMEOUT_SECONDS,
                ),
            ],
        )
        self.assertTrue(any("快速 fail-closed" in item for item in logs))
        self.assertFalse(any("耐心复测" in item for item in logs))

    def test_batch_overview_strategy_attaches_global_context_image(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs)
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": [
                        _candidate_fact("I01", "tmz1", "wpz1"),
                    ],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="batch-1.jpg",
                contact_sheets=["batch-1.jpg"],
                overview_contact_sheet="overview.jpg",
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_BATCH_OVERVIEW,
                reference_image="main-template.jpg",
                poster_reference_image="poster-template.jpg",
                pose1_reference_image="pose1-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids={"I01": "1.jpg", "I02": "2.jpg"},
                candidate_names=["1.jpg", "2.jpg"],
                shoe_category="婴童",
                model_id="gpt-5.6-sol",
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(payload["_model_id"], "gpt-5.6-sol")
        self.assertEqual(calls[0]["image_inputs"][0:2], ["batch-1.jpg", "overview.jpg"])
        self.assertIn("全景上下文", calls[0]["user_prompt"])
        self.assertIn("只能引用“候选编号”列表中的当前批次编号", calls[0]["user_prompt"])

    def test_batch_overview_targets_only_unresolved_and_mandatory_slots(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 13)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                image = Image.new(
                    "RGB",
                    (180, 140),
                    (245, 245, 245) if index == 6 else "white",
                )
                draw = ImageDraw.Draw(image)
                bbox = (65, 20, 115, 120) if index == 6 else (35, 35, 145, 105)
                draw.rectangle(bbox, fill=(40 + index * 7, 80, 130))
                image.save(path)
                candidate_entries.append({"filename": filename, "path": path})

            calls = []

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                calls.append((kwargs["model_id"], image_name, prompt))
                if "本轮只裁决 yq2" in prompt:
                    facts = [
                        _candidate_fact(
                            "I09",
                            "yq2",
                            filename="9.jpg",
                            side="sole",
                            outsole_visible=True,
                        )
                    ]
                elif "本轮只裁决 tmz3" in prompt:
                    facts = [
                        _candidate_fact(
                            "I03",
                            "tmz3",
                            filename="3.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif "本轮只裁决 wpz5" in prompt:
                    facts = [
                        _candidate_fact(
                            "I06",
                            "wpz5",
                            filename="6.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif image_name == "batch-1.jpg":
                    facts = [
                        _candidate_fact("I01", "tmz1", filename="1.jpg"),
                        _candidate_fact("I02", "tmz2", filename="2.jpg"),
                        _candidate_fact("I03", "tmz3", filename="3.jpg"),
                        _candidate_fact("I04", "tmz4", filename="4.jpg"),
                    ]
                elif image_name == "batch-2.jpg":
                    facts = [
                        _candidate_fact(
                            "I05", "tmz5", filename="5.jpg", shoe_count="single",
                            background="white",
                        ),
                        _candidate_fact(
                            "I06", "wpz5", filename="6.jpg", shoe_count="single",
                        ),
                        _candidate_fact(
                            "I07", "wpz6", filename="7.jpg", asset_type="shoe_box",
                        ),
                        _candidate_fact("I08", "yq1", filename="8.jpg"),
                    ]
                else:
                    yq2_id = "I09" if kwargs["model_id"] == "model-a" else "I11"
                    facts = [
                        _candidate_fact(
                            yq2_id,
                            "yq2",
                            filename=f"{int(yq2_id[1:])}.jpg",
                            side="sole",
                            outsole_visible=True,
                        ),
                        _candidate_fact(
                            "I10", "yq3", filename="10.jpg", side="outer",
                        ),
                    ]
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="batch-1.jpg",
                    contact_sheets=["batch-1.jpg", "batch-2.jpg", "batch-3.jpg"],
                    overview_contact_sheet="overview.jpg",
                    pose_strategy=(
                        shenhui_shoe_packaging.SHOE_POSE_STRATEGY_BATCH_OVERVIEW
                    ),
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            targeted_calls = [call for call in calls if "本轮只裁决" in call[2]]
            targeted_slots = [
                slot
                for _model_id, _image_name, prompt in targeted_calls
                for slot in ("yq2", "yq3", "tmz3", "wpz5")
                if f"本轮只裁决 {slot}" in prompt
            ]
            self.assertCountEqual(
                targeted_slots,
                ["yq2", "yq3", "tmz3", "wpz5"] * 2,
            )
            self.assertEqual(
                {model_id for model_id, _image_name, _prompt in targeted_calls},
                {"model-a", "model-b"},
            )
            self.assertFalse(any(
                "focused finalist" in prompt
                for _model_id, _image_name, prompt in calls
            ))
            self.assertEqual(payload["slots"]["yq"][1], "I09")
            self.assertEqual(payload["slots"]["yq"][2], "I10")
            self.assertEqual(payload["slots"]["tmz3"], "I03")
            self.assertEqual(payload["slots"]["wpz"][4], "I06")
            self.assertEqual(
                payload["_targeted_slot_consensus"]["yq2"]["model_votes"]["yq2"]["votes"],
                2,
            )

    def test_batch_overview_expands_target_pool_when_initial_quorum_does_not_lock(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 13)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                image = Image.new(
                    "RGB",
                    (180, 140),
                    (245, 245, 245) if index == 6 else "white",
                )
                ImageDraw.Draw(image).rectangle(
                    (65, 20, 115, 120) if index == 6 else (35, 35, 145, 105),
                    fill=(40 + index * 7, 80, 130),
                )
                image.save(path)
                candidate_entries.append({"filename": filename, "path": path})

            calls = []

            def fake_multimodal_json(**kwargs):
                prompt = kwargs["user_prompt"]
                image_name = Path(kwargs["image_inputs"][0]).name
                model_id = kwargs["model_id"]
                calls.append((model_id, image_name, prompt))
                if "本轮只裁决 yq3" in prompt:
                    facts = (
                        [
                            _candidate_fact(
                                "I12",
                                "yq3",
                                filename="12.jpg",
                                side="outer",
                            )
                        ]
                        if "yq3-round2" in image_name
                        else (
                            [
                                _candidate_fact(
                                    "I10",
                                    "yq3",
                                    filename="10.jpg",
                                    side="outer",
                                )
                            ]
                            if model_id == "model-a"
                            else []
                        )
                    )
                elif "本轮只裁决 tmz3" in prompt:
                    facts = [
                        _candidate_fact(
                            "I03",
                            "tmz3",
                            filename="3.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif "本轮只裁决 wpz5" in prompt:
                    facts = [
                        _candidate_fact(
                            "I06",
                            "wpz5",
                            filename="6.jpg",
                            shoe_count="single",
                            side="outer",
                        )
                    ]
                elif image_name == "batch-1.jpg":
                    facts = [
                        _candidate_fact("I01", "tmz1", filename="1.jpg"),
                        _candidate_fact("I02", "tmz2", filename="2.jpg"),
                        _candidate_fact("I03", "tmz3", filename="3.jpg"),
                        _candidate_fact("I04", "tmz4", filename="4.jpg"),
                    ]
                elif image_name == "batch-2.jpg":
                    facts = [
                        _candidate_fact(
                            "I05",
                            "tmz5",
                            filename="5.jpg",
                            shoe_count="single",
                            background="white",
                        ),
                        _candidate_fact(
                            "I06",
                            "wpz5",
                            filename="6.jpg",
                            shoe_count="single",
                        ),
                        _candidate_fact(
                            "I07",
                            "wpz6",
                            filename="7.jpg",
                            asset_type="shoe_box",
                        ),
                        _candidate_fact("I08", "yq1", filename="8.jpg"),
                    ]
                else:
                    facts = [
                        _candidate_fact("I09", "yq2", filename="9.jpg"),
                    ]
                    if model_id == "model-a":
                        facts.append(
                            _candidate_fact(
                                "I10",
                                "yq3",
                                filename="10.jpg",
                                side="outer",
                            )
                        )
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": model_id})(),
                )

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="batch-1.jpg",
                    contact_sheets=["batch-1.jpg", "batch-2.jpg", "batch-3.jpg"],
                    overview_contact_sheet="overview.jpg",
                    pose_strategy=(
                        shenhui_shoe_packaging.SHOE_POSE_STRATEGY_BATCH_OVERVIEW
                    ),
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    yq_reference_images={
                        f"yq{index}": f"yq{index}-template.jpg"
                        for index in range(1, 4)
                    },
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b", "model-c", "model-d"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            yq3_calls = [call for call in calls if "本轮只裁决 yq3" in call[2]]
            self.assertEqual(
                [model_id for model_id, image_name, _prompt in yq3_calls
                 if "yq3-round1" in image_name],
                ["model-a", "model-b"],
            )
            self.assertEqual(
                {model_id for model_id, image_name, _prompt in yq3_calls
                 if "yq3-round2" in image_name},
                {"model-a", "model-b"},
            )
            evidence = payload["_targeted_slot_consensus"]["yq3"]
            self.assertEqual(payload["slots"]["yq"][2], "I12")
            self.assertEqual(evidence["status"], "locked")
            self.assertEqual(len(evidence["rounds"]), 2)
            self.assertEqual(evidence["rounds"][0]["candidate_ids"], {"I10": "10.jpg"})
            self.assertIn("I12", evidence["rounds"][1]["candidate_ids"])
            self.assertEqual(evidence["rounds"][0]["routes"], ["model-a", "model-b"])
            self.assertEqual(evidence["rounds"][0]["model_votes"]["yq3"]["votes"], 1)

    def test_single_sheet_strategy_uses_one_global_batch_with_all_candidates(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs)
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": _required_pose_candidate_facts(
                        tmz2="I07",
                        wpz6="I11",
                    ),
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        candidate_ids = {f"I{index:02d}": f"{index}.jpg" for index in range(1, 12)}
        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="all.jpg",
                contact_sheets=["all.jpg"],
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_SINGLE_SHEET,
                reference_image="main-template.jpg",
                poster_reference_image="poster-template.jpg",
                pose1_reference_image="pose1-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids=candidate_ids,
                candidate_names=list(candidate_ids.values()),
                shoe_category="婴童",
                model_id="gpt-5.6-sol",
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["image_inputs"][0], "all.jpg")
        self.assertIn("I07=7.jpg", calls[0]["user_prompt"])
        self.assertIn("全量候选大图一次性识别", calls[0]["user_prompt"])
        self.assertEqual(payload["slots"]["tmz2"], "I07")

    def test_global_pages_strategy_converts_candidate_facts_to_slots(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs)
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": [
                        {"candidate_id": "I01", "asset_type": "shoe", "complete": True, "matched_slots": ["tmz1"], "confidence": 0.96},
                        {"candidate_id": "I02", "asset_type": "shoe", "complete": True, "matched_slots": ["tmz2"], "confidence": 0.95},
                        {"candidate_id": "I03", "asset_type": "shoe", "complete": True, "matched_slots": ["tmz3"], "confidence": 0.95},
                        {"candidate_id": "I04", "asset_type": "shoe", "complete": True, "side": "rear", "matched_slots": ["tmz4"], "confidence": 0.95},
                        {"candidate_id": "I05", "asset_type": "shoe", "complete": True, "matched_slots": ["tmz5"], "confidence": 0.95},
                        {"candidate_id": "I06", "asset_type": "shoe", "shoe_count": "single", "complete": True, "matched_slots": ["wpz5"], "confidence": 0.95},
                        {"candidate_id": "I07", "asset_type": "shoe_box", "matched_slots": ["wpz6"], "confidence": 0.95},
                        {"candidate_id": "I08", "asset_type": "shoe", "complete": True, "outsole_visible": True, "matched_slots": ["yq2"], "confidence": 0.95},
                        {"candidate_id": "I09", "asset_type": "shoe", "complete": True, "side": "outer", "matched_slots": ["yq3"], "confidence": 0.95},
                        {"candidate_id": "I10", "asset_type": "shoe", "complete": True, "pose": "yq1 oblique front", "matched_slots": ["yq1"], "confidence": 0.95},
                    ],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        candidate_ids = {f"I{index:02d}": f"{index}.jpg" for index in range(1, 11)}
        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="global-1.jpg",
                contact_sheets=["global-1.jpg", "global-2.jpg"],
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                reference_image="main-template.jpg",
                main_pose_reference_sheet="main-pose-sheet.jpg",
                poster_reference_image="poster-template.jpg",
                pose1_reference_image="pose1-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids=candidate_ids,
                candidate_names=list(candidate_ids.values()),
                shoe_category="婴童",
                model_id="gpt-5.6-sol",
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(len(calls), 1)
        self.assertEqual(
            calls[0]["image_inputs"],
            ["global-1.jpg", "main-pose-sheet.jpg", "yq-template.jpg"],
        )
        self.assertNotIn("pose1-template.jpg", calls[0]["image_inputs"])
        self.assertIn("逐候选返回可校验事实 candidates", calls[0]["user_prompt"])
        self.assertEqual(payload["slots"]["tmz1"], "I01")
        self.assertEqual(payload["slots"]["tmz2"], "I02")
        self.assertEqual(payload["slots"]["wpz"], ["I01", "I02", "I03", "I04", "I06", "I07"])
        self.assertEqual(payload["slots"]["yq"], ["I10", "I08", "I09"])
        self.assertEqual(payload["_ruleset"], "shoe-slot-rules.v2")

    def test_global_pages_uses_main_pose_reference_cells_when_available(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs)
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": _required_pose_candidate_facts(),
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        candidate_ids = _required_pose_candidate_ids()
        main_pose_cells = [f"tmz{index}-cell.jpg" for index in range(1, 6)]
        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="global-1.jpg",
                contact_sheets=["global-1.jpg"],
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                reference_image="main-template.jpg",
                main_pose_reference_images=main_pose_cells,
                main_pose_reference_sheet="main-pose-sheet.jpg",
                poster_reference_image="poster-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids=candidate_ids,
                candidate_names=list(candidate_ids.values()),
                shoe_category="婴童",
                model_id="gpt-5.6-sol",
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(
            calls[0]["image_inputs"],
            [
                "global-1.jpg",
                "tmz1-cell.jpg",
                "tmz2-cell.jpg",
                "tmz3-cell.jpg",
                "tmz4-cell.jpg",
                "tmz5-cell.jpg",
                "poster-template.jpg",
                "yq-template.jpg",
            ],
        )
        self.assertIn("第2到第6张图是当前品类的主图位切片参考", calls[0]["user_prompt"])
        self.assertIn("第7张图是鞋品海报姿势模板", calls[0]["user_prompt"])
        self.assertIn("第8张图是 yq 三姿势参考模板", calls[0]["user_prompt"])

    def test_global_pages_merges_required_slots_across_pages(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            calls = []

            def page_facts(page_name):
                if page_name == "global-1.jpg":
                    return [
                        _candidate_fact("I01", "tmz1", filename="1.jpg"),
                        _candidate_fact("I02", "tmz2", filename="2.jpg"),
                        _candidate_fact("I03", "tmz3", filename="3.jpg"),
                        _candidate_fact("I04", "tmz4", filename="4.jpg"),
                        _candidate_fact("I05", "tmz5", filename="5.jpg"),
                        _candidate_fact("I10", "yq1", filename="10.jpg"),
                    ]
                return [
                    _candidate_fact("I13", "wpz5", filename="13.jpg"),
                    _candidate_fact("I14", "wpz6", filename="14.jpg"),
                    _candidate_fact("I15", "yq2", filename="15.jpg"),
                    _candidate_fact("I16", "yq3", filename="16.jpg"),
                ]

            def fake_multimodal_json(**kwargs):
                image_inputs = list(kwargs["image_inputs"])
                calls.append((kwargs["model_id"], image_inputs))
                page_name = Path(image_inputs[0]).name
                facts = (
                    [*page_facts("global-1.jpg"), *page_facts("global-2.jpg")]
                    if "focused" in page_name
                    else page_facts(page_name)
                )
                return (
                    {
                        "color_name": "白紫色调00317",
                        "shoe_category": "婴童",
                        "candidates": facts,
                    },
                    type("Route", (), {"model_id": kwargs["model_id"]})(),
                )

            candidate_ids = {
                f"I{index:02d}": f"{index}.jpg"
                for index in range(1, 17)
            }
            candidate_entries = []
            for index, filename in enumerate(candidate_ids.values(), start=1):
                path = root / filename
                Image.new("RGB", (120, 100), (index * 11 % 255, 120, 180)).save(path)
                candidate_entries.append({"filename": filename, "path": path})

            with patch.object(
                shenhui_shoe_packaging.llm_gateway,
                "generate_multimodal_json",
                side_effect=fake_multimodal_json,
            ):
                payload = shenhui_shoe_packaging._default_analyze_color(
                    style_code="204426146036",
                    color_code="00317",
                    contact_sheet="global-1.jpg",
                    contact_sheets=["global-1.jpg", "global-2.jpg"],
                    pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                    reference_image="main-template.jpg",
                    main_pose_reference_images=[
                        f"tmz{index}-template.jpg" for index in range(1, 6)
                    ],
                    main_pose_reference_sheet="main-pose-sheet.jpg",
                    poster_reference_image="poster-template.jpg",
                    yq_reference_image="yq-template.jpg",
                    candidate_ids=candidate_ids,
                    candidate_entries=candidate_entries,
                    candidate_names=list(candidate_ids.values()),
                    shoe_category="婴童",
                    model_id="model-a",
                    fallback_model_ids=["model-b"],
                    config={"ai": {"llm": {"api_key": "gateway-key"}}},
                )

            self.assertEqual(len(calls), 10)
            main_references = [
                f"tmz{index}-template.jpg" for index in range(1, 6)
            ]
            self.assertCountEqual(
                calls[:4],
                [
                    (
                        "model-a",
                        ["global-1.jpg", *main_references, "poster-template.jpg", "yq-template.jpg"],
                    ),
                    (
                        "model-a",
                        ["global-2.jpg", *main_references, "poster-template.jpg", "yq-template.jpg"],
                    ),
                    (
                        "model-b",
                        ["global-1.jpg", *main_references, "poster-template.jpg", "yq-template.jpg"],
                    ),
                    (
                        "model-b",
                        ["global-2.jpg", *main_references, "poster-template.jpg", "yq-template.jpg"],
                    ),
                ],
            )
            base_focused_calls = [
                item for item in calls
                if Path(item[1][0]).stem.removeprefix("00317-focused-").isdigit()
            ]
            self.assertEqual(
                [model for model, _inputs in base_focused_calls],
                ["model-a", "model-b"],
            )
            self.assertEqual(payload["slots"]["tmz1"], "I01")
            self.assertEqual(payload["slots"]["tmz5"], "I05")
            self.assertEqual(payload["slots"]["wpz"][4:6], ["I13", "I14"])
            self.assertEqual(payload["slots"]["yq"][0], "I10")
            self.assertEqual(payload["slots"]["yq"][1:3], ["I15", "I16"])
            self.assertEqual(len(payload["_model_votes_by_batch"]), 2)

    def test_global_pages_timeout_switches_whole_color_pages_to_fresh_fallback(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append((kwargs["model_id"], list(kwargs["image_inputs"])))
            if kwargs["model_id"] == "gpt-5.6-sol":
                raise shenhui_shoe_packaging.llm_gateway.LlmGatewayError("timeout")
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": _required_pose_candidate_facts(),
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="global-1.jpg",
                contact_sheets=["global-1.jpg", "global-2.jpg"],
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                reference_image="main-template.jpg",
                main_pose_reference_sheet="main-pose-sheet.jpg",
                poster_reference_image="poster-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids=_required_pose_candidate_ids(),
                candidate_names=[],
                shoe_category="婴童",
                model_id="multi-model",
                fallback_model_ids=["gpt-5.6-sol", "gpt-5.6-terra"],
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(
            [model_id for model_id, _images in calls],
            ["gpt-5.6-sol", "gpt-5.6-terra"],
        )
        self.assertEqual(calls[0][1], ["global-1.jpg", "main-pose-sheet.jpg", "yq-template.jpg"])
        self.assertEqual(calls[1][1], ["global-1.jpg", "main-pose-sheet.jpg", "yq-template.jpg"])
        self.assertEqual(payload["_model_id"], "gpt-5.6-terra")

    def test_global_pages_rejects_inputs_that_would_be_silently_truncated(self):
        with self.assertRaisesRegex(shenhui_shoe_packaging.ShoeSelectionError, "静默截断"):
            shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="global-1.jpg",
                contact_sheets=[f"global-{index}.jpg" for index in range(1, 10)],
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_GLOBAL_PAGES,
                reference_image="main-template.jpg",
                main_pose_reference_sheet="main-pose-sheet.jpg",
                poster_reference_image="poster-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids={"I01": "1.jpg"},
                candidate_names=["1.jpg"],
                shoe_category="婴童",
                model_id="gpt-5.6-sol",
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

    def test_auto_pose_model_starts_kimi_code_then_falls_back_after_timeout(self):
        calls = []
        logs = []
        progress_events = []

        def fake_multimodal_json(**kwargs):
            self.assertEqual(kwargs["fallback_model_ids"], [])
            self.assertFalse(kwargs["retry_same_model"])
            calls.append(kwargs["model_id"])
            if kwargs["model_id"] == "kimi-k2.7-code":
                raise shenhui_shoe_packaging.llm_gateway.LlmGatewayError(
                    "文本模型接口连接失败：请求超过总时长 60 秒"
                )
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": _required_pose_candidate_facts(),
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="contact-1.jpg",
                contact_sheets=["contact-1.jpg"],
                reference_image="main-template.jpg",
                poster_reference_image="poster-template.jpg",
                pose1_reference_image="pose1-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids=_required_pose_candidate_ids(),
                candidate_names=[],
                shoe_category="",
                model_id="multi-model",
                fallback_model_ids=["kimi-k2.7-code", "deepseek-official-v4-flash-vision-exp"],
                config={"ai": {"llm": {"api_key": "gateway-key", "deepseek_api_key": "deepseek-key"}}},
                log=logs.append,
                progress=lambda stage, **kwargs: progress_events.append((stage, kwargs)),
            )

        self.assertEqual(
            calls,
            [
                "kimi-k2.7-code",
                "deepseek-official-v4-flash-vision-exp",
            ],
        )
        self.assertEqual(
            payload["_model_id"],
            "deepseek-official-v4-flash-vision-exp",
        )
        self.assertIn("kimi-k2.7-code", payload["_model_attempt_warnings"])
        self.assertTrue(any("优先切换独立 fallback" in item for item in logs))
        self.assertFalse(any("单批耐心复测" in item for item in logs))
        self.assertTrue(any("姿势识别 deepseek-official-v4-flash-vision-exp" in item[0] for item in progress_events))

    def test_default_pose_chain_uses_gpt_then_domestic_fallback_order(self):
        self.assertEqual(
            shenhui_shoe_packaging._shoe_pose_model_ids(
                "multi-model",
                {"ai": {"llm": {"api_key": "gateway-key", "deepseek_api_key": "deepseek-key"}}},
            ),
            [
                "gpt-5.6-sol",
                "gpt-5.6-terra",
                "gpt-5.6-luna",
                "gpt-5.5",
                "deepseek-official-v4-flash-vision-exp",
                "kimi-k2.7-code",
            ],
        )

    def test_pose_model_fallback_skips_official_deepseek_when_key_is_not_configured(self):
        self.assertEqual(
            shenhui_shoe_packaging._shoe_pose_model_ids(
                "multi-model",
                {"ai": {"llm": {"api_key": "gateway-key"}}},
                ["gpt-5.6-terra", "gpt-5.6-luna"],
            ),
            ["gpt-5.6-terra", "gpt-5.6-luna"],
        )
        self.assertEqual(
            shenhui_shoe_packaging._shoe_pose_model_ids(
                "multi-model",
                {"ai": {"llm": {"api_key": "gateway-key", "deepseek_api_key": "deepseek-key"}}},
                [
                    "gpt-5.6-luna",
                    "gpt-5.6-sol",
                    "gpt-5.5",
                    "deepseek-official-v4-flash-vision-exp",
                ],
            ),
            [
                "gpt-5.6-luna",
                "gpt-5.6-sol",
                "gpt-5.5",
                "deepseek-official-v4-flash-vision-exp",
            ],
        )
        self.assertEqual(
            shenhui_shoe_packaging._shoe_pose_model_ids(
                "gpt-5.5",
                {"ai": {"llm": {"api_key": "gateway-key", "deepseek_api_key": "deepseek-key"}}},
                [
                    "gpt-5.6-luna",
                    "gpt-5.6-sol",
                    "gpt-5.5",
                    "deepseek-official-v4-flash-vision-exp",
                    "qwen3.8-max-preview",
                    "gemini-3.5-flash",
                ],
            ),
            [
                "gpt-5.5",
                "gpt-5.6-luna",
                "gpt-5.6-sol",
                "deepseek-official-v4-flash-vision-exp",
                "qwen3.8-max-preview",
            ],
        )

    def test_default_pose_model_splits_contact_sheets_into_separate_model_calls(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append((kwargs["model_id"], list(kwargs["image_inputs"])))
            batch_id = "I01" if "contact-1.jpg" in kwargs["image_inputs"] else "I05"
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": [
                        _candidate_fact(batch_id, "tmz1", "wpz1"),
                    ],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="contact-1.jpg",
                contact_sheets=["contact-1.jpg", "contact-2.jpg"],
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_BATCH,
                reference_image="main-template.jpg",
                poster_reference_image="poster-template.jpg",
                pose1_reference_image="pose1-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids={
                    f"I{index:02d}": f"{index}.jpg"
                    for index in range(1, 10)
                },
                candidate_names=[f"{index}.jpg" for index in range(1, 10)],
                shoe_category="",
                model_id="gpt-5.5",
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][1][0], "contact-1.jpg")
        self.assertEqual(calls[1][1][0], "contact-2.jpg")
        self.assertEqual(len(calls[0][1]), 4)
        self.assertNotIn("pose1-template.jpg", calls[0][1])
        self.assertEqual(payload["slots"]["tmz1"], "I01")

    def test_default_pose_model_uses_main_pose_reference_cells(self):
        calls = []

        def fake_multimodal_json(**kwargs):
            calls.append(kwargs)
            return (
                {
                    "color_name": "白紫色调00317",
                    "shoe_category": "婴童",
                    "candidates": [
                        _candidate_fact("I01", "tmz1", "wpz1"),
                    ],
                },
                type("Route", (), {"model_id": kwargs["model_id"]})(),
            )

        references = [f"baby-tmz{index}.jpg" for index in range(1, 6)]
        with patch.object(
            shenhui_shoe_packaging.llm_gateway,
            "generate_multimodal_json",
            side_effect=fake_multimodal_json,
        ):
            payload = shenhui_shoe_packaging._default_analyze_color(
                consensus_required_votes=1,
                style_code="204426146036",
                color_code="00317",
                contact_sheet="contact-1.jpg",
                contact_sheets=["contact-1.jpg"],
                pose_strategy=shenhui_shoe_packaging.SHOE_POSE_STRATEGY_BATCH,
                reference_image="main-template.jpg",
                main_pose_reference_images=references,
                poster_reference_image="poster-template.jpg",
                pose1_reference_image="pose1-template.jpg",
                yq_reference_image="yq-template.jpg",
                candidate_ids={f"I{index:02d}": f"{index}.jpg" for index in range(1, 5)},
                candidate_names=[f"{index}.jpg" for index in range(1, 5)],
                shoe_category="婴童",
                model_id="gpt-5.5",
                config={"ai": {"llm": {"api_key": "gateway-key"}}},
            )

        self.assertEqual(payload["slots"]["tmz1"], "I01")
        self.assertEqual(
            calls[0]["image_inputs"],
            [
                "contact-1.jpg",
                *references,
                "poster-template.jpg",
                "yq-template.jpg",
            ],
        )
        self.assertIn(
            "第2到第6张图是当前品类的主图位切片参考",
            calls[0]["user_prompt"],
        )

    def test_semantic_report_uses_one_valid_supporting_fact_per_voting_model(self):
        stale = _candidate_fact(
            "I01",
            filename="outer.jpg",
            pose="other",
            side="side_rear",
            matched_slots=[],
        )
        valid = _candidate_fact(
            "I01",
            "yq3",
            filename="outer.jpg",
            shoe_count="single",
        )
        selection = {
            "shoe_category": "婴童",
            "_model_votes": {
                "yq3": {
                    "status": "locked",
                    "selected": "I01",
                    "selected_family": "outer",
                    "votes": 2,
                    "required_votes": 2,
                    "models": ["model-a", "model-b"],
                }
            },
            "_candidate_facts_by_model": [
                {"model_id": "model-a", "candidate_facts": [stale]},
                {"model_id": "model-a", "candidate_facts": [valid]},
                {"model_id": "model-b", "candidate_facts": [valid]},
            ],
        }

        fields = shenhui_shoe_packaging._semantic_report_fields(
            selection,
            slot="yq3",
            source_name="outer.jpg",
        )
        evidence = json.loads(fields["语义属性"])

        self.assertEqual(
            [item["model_id"] for item in evidence["models"]],
            ["model-a", "model-b"],
        )
        self.assertTrue(
            all(item["fact"]["pose"] == "yq3" for item in evidence["models"])
        )


if __name__ == "__main__":
    unittest.main()
