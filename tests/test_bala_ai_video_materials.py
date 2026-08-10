import pytest

from core import bala_ai_video_materials as materials


def test_build_material_batch_groups_downloaded_images_by_style_and_source(tmp_path):
    model = tmp_path / "208326100202" / "01_模拍原图" / "model.jpg"
    detail = tmp_path / "208326100202" / "02_商品细节图" / "detail.jpg"
    skipped = tmp_path / "208326100202" / "01_模拍原图" / "tag.jpg"
    model.parent.mkdir(parents=True)
    detail.parent.mkdir(parents=True)
    model.write_bytes(b"\xff\xd8\xff")
    detail.write_bytes(b"\xff\xd8\xff")
    skipped.write_bytes(b"\xff\xd8\xff")

    rows = [
        {
            "输入款号": "208326100202",
            "素材来源": "模拍图",
            "文件名": "model.jpg",
            "本地文件": str(model),
            "下载结果": "已下载",
            "处理动作": "保留模拍图",
            "选择文件夹": "模拍原图/208326100202-已选",
        },
        {
            "输入款号": "208326100202",
            "素材来源": "商品细节图",
            "文件名": "detail.jpg",
            "本地文件": str(detail),
            "下载结果": "已下载",
            "处理动作": "保留商品细节图",
        },
        {
            "输入款号": "208326100202",
            "素材来源": "模拍图",
            "文件名": "tag.jpg",
            "本地文件": str(skipped),
            "下载结果": "已跳过",
            "处理动作": "已过滤",
            "备注": "吊牌",
        },
    ]

    batch = materials.build_material_batch(
        rows,
        str(tmp_path / "material-batches"),
        "http://127.0.0.1:18765",
    )

    assert batch["workflow"] == "bala_ai_video_material_selection"
    assert batch["status"] == "pending_selection"
    assert batch["items"][0]["style_code"] == "208326100202"
    assert [asset["source_type"] for asset in batch["items"][0]["assets"]] == ["model", "detail"]
    assert batch["items"][0]["assets"][0]["selected"] is False
    assert batch["items"][0]["assets"][1]["selected"] is False
    assert batch["items"][0]["assets"][0]["folder"] == "模拍原图/208326100202-已选"
    assert batch["items"][0]["assets"][0]["cloud_folder"] == "模拍原图/208326100202-已选"
    assert "/thumbnail/" in batch["items"][0]["assets"][0]["thumbnail_url"]
    assert "token=" in batch["board_url"]


def test_material_thumbnail_is_compressed_cached_and_keeps_the_original(tmp_path):
    from PIL import Image

    source = tmp_path / "source.png"
    Image.new("RGB", (1600, 1200), (225, 84, 42)).save(source)
    original_bytes = source.read_bytes()
    batch = {
        "batch_id": "bala-material-thumbnail-test",
        "artifact_dir": str(tmp_path / "material-batches"),
    }

    thumbnail = materials.ensure_material_thumbnail(batch, "asset-1", source, max_edge=320)

    assert thumbnail.is_file()
    assert thumbnail.suffix == ".webp"
    assert thumbnail.stat().st_size < source.stat().st_size
    with Image.open(thumbnail) as image:
        assert image.format == "WEBP"
        assert max(image.size) <= 320
    assert source.read_bytes() == original_bytes

    cached_mtime = thumbnail.stat().st_mtime_ns
    assert materials.ensure_material_thumbnail(batch, "asset-1", source, max_edge=320) == thumbnail
    assert thumbnail.stat().st_mtime_ns == cached_mtime


def test_missing_material_batch_error_explains_stale_batch():
    with pytest.raises(FileNotFoundError) as exc_info:
        materials.load_material_batch("bala-material-missing-test")

    assert "素材批次不存在或已失效" in str(exc_info.value)
    assert "bala-material-missing-test" in str(exc_info.value)


def test_export_ai_input_builds_outfit_swap_params_from_selected_materials(tmp_path):
    model = tmp_path / "model.jpg"
    garment = tmp_path / "garment.jpg"
    outfit = tmp_path / "outfit.jpg"
    variant = tmp_path / "variant.jpg"
    for path in [model, garment, outfit, variant]:
        path.write_bytes(b"\xff\xd8\xff")
    batch = {
        "batch_id": "bala-material-test",
        "token": "token-test",
        "workflow": "bala_ai_video_material_selection",
        "items": [{
            "style_code": "208326100202",
            "assets": [
                {"id": "asset-model", "source_type": "model", "path": str(model), "selected": True},
                {"id": "asset-detail", "source_type": "detail", "path": str(garment), "selected": False},
            ],
        }],
    }

    result = materials.export_ai_input(batch, "outfit_swap", {
        "selected_asset_ids": ["asset-model"],
        "garment_images": {"paths": [str(garment)]},
        "outfit_reference_images": {"paths": [str(outfit)]},
        "variant_reference_images": {"paths": [str(variant)]},
        "prompt_extra": "保留童装版型和颜色，替换自然",
    })

    assert result["next_task"]["adapter_id"] == "bala-ai-video-assistant"
    assert result["next_task"]["task_id"] == "bala_ai_face_background_generate"
    params = result["next_task"]["params"]
    assert params["operation_type"] == "outfit_swap"
    assert params["source_images"]["paths"] == [str(model)]
    assert params["garment_images"]["paths"] == [str(garment)]
    assert params["outfit_reference_images"]["paths"] == [str(outfit)]
    assert params["variant_reference_images"]["paths"] == [str(variant)]
    assert params["prompt_extra"] == "保留童装版型和颜色，替换自然"


def test_export_ai_input_preserves_visual_model_picker_selection_for_face_swap(tmp_path):
    model_source = tmp_path / "model-source.jpg"
    model_source.write_bytes(b"\xff\xd8\xff")
    batch = {
        "batch_id": "bala-material-face-test",
        "token": "token-test",
        "workflow": "bala_ai_video_material_selection",
        "items": [{
            "style_code": "208326100202",
            "assets": [
                {"id": "asset-model", "source_type": "model", "path": str(model_source), "selected": True},
            ],
        }],
    }

    result = materials.export_ai_input(batch, "face_swap", {
        "selected_asset_ids": ["asset-model"],
        "model_ref_ids": ["100女/标准.jpg", "73男/微笑.jpg"],
    })

    params = result["next_task"]["params"]
    assert params["operation_type"] == "face_swap"
    assert params["source_images"]["paths"] == [str(model_source)]
    assert params["model_ref_ids"] == "100女/标准.jpg\n73男/微笑.jpg"
    assert params["model_groups"] == []


def test_export_ai_input_preserves_per_source_model_mapping_for_face_swap(tmp_path):
    boy_source = tmp_path / "boy.jpg"
    girl_source = tmp_path / "girl.jpg"
    boy_source.write_bytes(b"\xff\xd8\xff")
    girl_source.write_bytes(b"\xff\xd8\xff")
    batch = {
        "batch_id": "bala-material-face-source-model-test",
        "token": "token-test",
        "workflow": "bala_ai_video_material_selection",
        "items": [{
            "style_code": "208326121202",
            "assets": [
                {"id": "asset-boy", "source_type": "model", "path": str(boy_source), "selected": True},
                {"id": "asset-girl", "source_type": "model", "path": str(girl_source), "selected": True},
            ],
        }],
    }

    result = materials.export_ai_input(batch, "face_swap", {
        "selected_asset_ids": ["asset-boy", "asset-girl"],
        "model_ref_ids": ["100男/标准.jpg", "100女/标准.jpg"],
        "source_model_ref_ids": {
            str(boy_source): "100男/标准.jpg",
            str(girl_source): "100女/标准.jpg",
        },
    })

    params = result["next_task"]["params"]
    assert params["source_images"]["paths"] == [str(boy_source), str(girl_source)]
    assert params["model_ref_ids"] == "100男/标准.jpg\n100女/标准.jpg"
    assert params["source_model_ref_ids"] == {
        str(boy_source): "100男/标准.jpg",
        str(girl_source): "100女/标准.jpg",
    }
