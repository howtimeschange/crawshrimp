import pytest
from core import shenhui_shoe_sequential as q, shenhui_shoe_packaging as s


def test_rear_contract_checks_visible_heel_not_a_viewpoint_enum():
    ctx = {"category": "婴童", "ids": {"I24": "rear.jpg"}}
    response = {
        "candidate_id": "I24",
        "accepted": True,
        "checks": {
            "single_complete_shoe": True,
            "heel_back_visible": True,
            "not_vertical_side": True,
        },
        "evidence": "后跟后面及外侧同时可见",
        "side": "mixed",
    }
    assert q.validate(response, "tmz4", ["I24"], ctx) == "I24"
    response["checks"]["heel_back_visible"] = False
    with pytest.raises(s.ShoeSelectionError):
        q.validate(response, "tmz4", ["I24"], ctx)


def test_snow_rear_requires_lining_and_upper_side():
    assert set(q.contract("tmz4", "雪地")) == {
        "single_complete_shoe",
        "opening_lining_visible",
        "upper_side_visible",
    }


def test_floating_pair_never_passes_with_positive_accepted_flag():
    checks = {k: True for k in q.contract("tmz1", "运动")}
    checks["no_floating"] = False
    with pytest.raises(s.ShoeSelectionError):
        q.validate(
            dict(candidate_id="I1", accepted=True, checks=checks, evidence="悬空"),
            "tmz1",
            ["I1"],
            {"category": "运动"},
        )


def test_removed_candidate_cannot_be_selected_in_next_slot():
    checks = {k: True for k in q.contract("tmz4", "婴童")}
    with pytest.raises(s.ShoeSelectionError):
        q.validate(
            dict(candidate_id="removed", accepted=True, checks=checks, evidence="后侧"),
            "tmz4",
            ["I24"],
            {"category": "婴童"},
        )


def test_boolean_lookalikes_and_missing_evidence_do_not_pass():
    checks = {k: 1 for k in q.contract("tmz5", "婴童")}
    with pytest.raises(s.ShoeSelectionError):
        q.validate(
            dict(candidate_id="I01", accepted=True, checks=checks, evidence="单鞋"),
            "tmz5",
            ["I01"],
            {"category": "婴童"},
        )


def test_vertical_outer_cannot_fill_rear_even_with_visible_heel():
    response = dict(
        candidate_id="I20",
        accepted=True,
        checks={k: True for k in q.contract("tmz4", "婴童")},
        evidence="纵向外侧",
    )
    response["checks"]["not_vertical_side"] = False
    with pytest.raises(s.ShoeSelectionError):
        q.validate(response, "tmz4", ["I20"], {"category": "婴童"})


def test_repair_releases_wrong_rear_lock_when_vertical_slot_is_missing():
    assert q.repair_scope({"tmz3"}) == {"tmz3", "tmz4", "yq3"}
    assert q.repair_scope({"yx"}) == {"yx"}
    assert q.repair_scope({"tmz2"}) == {"tmz2", "yq1"}


def test_card_absence_requires_all_chunks_but_later_positive_wins(
    monkeypatch, tmp_path
):
    ctx = {"root": str(tmp_path), "ids": {f"I{i}": f"{i}.jpg" for i in range(33)}}
    calls = []

    def review(c, *args):
        calls.append(list(c["ids"]))
        return (
            ("yx", None, "uncertain", {})
            if len(calls) == 1
            else ("yx", "32.jpg", "", {})
        )

    monkeypatch.setattr(q.fast, "_review_card_absence", review)
    assert q.inspect_card_pool(ctx, "test")[0] == "32.jpg"
    assert sum(map(len, calls)) == 33
    monkeypatch.setattr(
        q.fast, "_review_card_absence", lambda *a: ("yx", None, "uncertain", {})
    )
    with pytest.raises(s.ShoeSelectionError):
        q.inspect_card_pool(ctx, "test")
    monkeypatch.setattr(q.fast, "_review_card_absence", lambda *a: ("yx", "", "", {}))
    assert q.inspect_card_pool(ctx, "test")[0] == ""


def test_default_yx_reference_is_a_real_packaged_image():
    from PIL import Image

    assert s.SHOE_YX_REFERENCE_IMAGE.parent.name == "assets"
    with Image.open(s.SHOE_YX_REFERENCE_IMAGE) as im:
        assert min(im.size) > 500


def test_standard_sources_reserved_before_other_slots(monkeypatch, tmp_path):
    from types import SimpleNamespace
    from PIL import Image

    ids = {"I01": "S-C.jpg", "I02": "gray.jpg", "I03": "rear.jpg"}
    previews = {}
    for name in ids.values():
        path = tmp_path / name
        Image.new("RGB", (20, 20), "white").save(path)
        previews[name] = str(path)
    ctx = {
        "style": "S",
        "color": "C",
        "category": "婴童",
        "root": str(tmp_path),
        "ids": ids,
        "previews": previews,
        "routes": ["test"],
        "main_refs": ["ref"] * 5,
        "slot_order": ["tmz4"],
    }
    monkeypatch.setattr(q.shoe, "_is_tms_source_filename", lambda n, *a: n == "S-C.jpg")
    monkeypatch.setattr(q.fast, "_gray_mates", lambda *a: ["I02"])

    def request(c, m, p, images, phase):
        assert '"I01"' not in p and '"I02"' not in p
        return dict(
            candidate_id="I03",
            accepted=True,
            checks={k: True for k in q.contract("tmz4", "婴童")},
            evidence="后面可见",
        ), SimpleNamespace(model_id="test")

    monkeypatch.setattr(q.fast, "_request", request)
    assert q.run(ctx)["selected"] == {"tmz4": "rear.jpg"}


def test_named_coordinates_can_be_read_without_mutating_raw_evidence():
    raw = {"evidence": "toe_center约为[0.31,0.76]，heel_center约为(0.69,0.25)"}
    got = q.normalize_landmarks(raw)
    assert got["toe_center"] == [0.31, 0.76] and got["heel_center"] == [0.69, 0.25]
    assert "toe_center" not in raw
    assert q.normalize_landmarks(
        {"evidence": raw["evidence"] + " toe_center=[0.4,0.9]"}
    ) == {"evidence": raw["evidence"] + " toe_center=[0.4,0.9]"}
    assert q.normalize_landmarks({"evidence": "上面和下面"}) == {
        "evidence": "上面和下面"
    }


@pytest.mark.parametrize("reference_changed", [False, True])
def test_repair_reuses_approved_image_only_with_unchanged_reference(
    monkeypatch, tmp_path, reference_changed
):
    selected = {slot: slot + ".jpg" for slot in q.ORDER}
    revised = {**selected, "tmz4": "rear-fixed.jpg"}
    if reference_changed:
        revised["tmz3"] = "outer-fixed.jpg"
    names = set(selected.values()) | set(revised.values())
    ctx = {
        "root": str(tmp_path),
        "ids": {f"I{i}": name for i, name in enumerate(sorted(names))},
        "routes": ["primary", "review"],
    }
    first = {
        "approved": [slot for slot in q.ORDER if slot != "tmz4"],
        "rejected": {"tmz4": "wrong rear"},
    }
    targets = []

    def audit(c, result, slots=None):
        if slots is None:
            return first
        targets.extend(slots)
        return {"approved": slots, "rejected": {}}

    monkeypatch.setattr(q, "audit", audit)
    monkeypatch.setattr(
        q,
        "run",
        lambda c: {"selected": revised, "records": [], "card_absence_verified": False},
    )
    result = q.run_verified(ctx, {"selected": selected})
    assert result["verified"]
    assert "tmz4" in targets
    assert ("yq3" in targets) == reference_changed
    assert ("yq3" in result["audits"][1]["reused_approved"]) != reference_changed


def test_sports_rear_requires_oblique_outsole_not_baby_grounded_pose():
    response = dict(
        candidate_id="rear",
        accepted=True,
        checks={k: True for k in q.contract("tmz4", "婴童")},
        evidence="平放后侧",
    )
    with pytest.raises(s.ShoeSelectionError):
        q.validate(response, "tmz4", ["rear"], {"category": "运动"})
    response["checks"] = {k: True for k in q.contract("tmz4", "运动")}
    assert q.validate(response, "tmz4", ["rear"], {"category": "运动"}) == "rear"
    response["checks"]["outsole_visible_obliquely"] = False
    with pytest.raises(s.ShoeSelectionError):
        q.validate(response, "tmz4", ["rear"], {"category": "运动"})


@pytest.mark.parametrize("gray", [False, True])
def test_standard_without_gray_mate_is_kept_and_gray_standard_is_reviewed(
    monkeypatch, tmp_path, gray
):
    from PIL import Image, ImageDraw
    from types import SimpleNamespace

    path = tmp_path / "S-C.jpg"
    im = Image.new("RGB", (200, 200), (242, 242, 242) if gray else "white")
    ImageDraw.Draw(im).rectangle((70, 50, 130, 150), fill="brown")
    im.save(path)
    ctx = dict(
        style="S",
        color="C",
        category="婴童",
        root=str(tmp_path),
        ids={"I1": "S-C.jpg"},
        entries={"S-C.jpg": {"path": str(path)}},
        previews={"S-C.jpg": str(path)},
        routes=["primary"],
        main_refs=[str(path)] * 5,
        slot_order=["tmz5", "wpz5"],
    )
    monkeypatch.setattr(q.fast, "_gray_mates", lambda *a: [])

    def request(c, *args):
        checks = q.contract("tmz5", c["category"], c.get("gray_standard", False))
        assert ("clean_gray_background" in checks) == gray
        return dict(
            candidate_id="I1",
            accepted=True,
            checks={k: True for k in checks},
            evidence="完整单鞋纯色背景",
        ), SimpleNamespace(model_id="primary")

    monkeypatch.setattr(q.fast, "_request", request)
    result = q.run(ctx)
    assert result["selected"] == {"tmz5": "S-C.jpg", "wpz5": "S-C.jpg"}
    assert result["records"][-1]["source"] == "standard_source_fallback_no_gray_pair"


def test_same_side_gate_rejects_zipper_mismatch_despite_positive_model_flag():
    row = dict(
        candidate_id="I1",
        accepted=True,
        checks={k: True for k in q.contract("yq3", "休闲")},
        evidence="同一侧",
        side_observations=dict(
            anchor_zipper=False,
            candidate_zipper=True,
            anchor_marks="外侧图案",
            candidate_marks="内侧拉链",
        ),
    )
    with pytest.raises(s.ShoeSelectionError, match="拉链"):
        q.validate(
            row, "yq3", ["I1"], {"category": "休闲", "require_side_observations": True}
        )

    row.pop("side_observations")
    with pytest.raises(s.ShoeSelectionError, match="结构观察"):
        q.validate(
            row, "yq3", ["I1"], {"category": "休闲", "require_side_observations": True}
        )


def test_malformed_side_observation_is_selection_failure():
    row = dict(
        candidate_id="I1",
        accepted=True,
        checks={k: True for k in q.contract("yq3", "休闲")},
        evidence="可见结构",
        side_observations=["unexpected array"],
    )
    with pytest.raises(s.ShoeSelectionError, match="JSON对象"):
        q.validate(row, "yq3", ["I1"], {"category": "休闲"})


def test_empty_semantic_review_does_not_request_models():
    result = q.audit({"ids": {}}, {"selected": {}}, [])
    assert result["approved"] == []
    assert result["rejected"] == {}


def test_final_side_review_is_isolated_parallel_and_retains_actual_model(
    monkeypatch, tmp_path
):
    import threading

    barrier = threading.Barrier(2)

    def review(ctx, result, slots):
        barrier.wait(timeout=2)
        side = slots == ["yq3"]
        model = "side-fallback" if side else "main-reviewer"
        return dict(
            model=model,
            response={
                "reviews": [
                    {"slot": slot, "candidate_id": slot, "accepted": True}
                    for slot in slots
                ]
            },
            approved=slots,
            rejected={},
            errors=[],
        )

    monkeypatch.setattr(q, "_audit_selected", review)
    result = q.audit({"root": str(tmp_path)}, {}, ["tmz3", "yq3"])
    assert set(result["approved"]) == {"tmz3", "yq3"}
    assert result["review_models"] == {"tmz3": "main-reviewer", "yq3": "side-fallback"}
    assert len(result["partitions"]) == 2
