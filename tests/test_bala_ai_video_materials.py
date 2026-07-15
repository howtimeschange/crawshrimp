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
    assert batch["items"][0]["assets"][0]["selected"] is True
    assert batch["items"][0]["assets"][1]["selected"] is False
    assert "token=" in batch["board_url"]


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
