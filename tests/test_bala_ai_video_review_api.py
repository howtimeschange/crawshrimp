from core import api_server


def test_bala_material_batch_api_exports_pose_swap_ai_input(tmp_path):
    image = tmp_path / "model.jpg"
    image.write_bytes(b"\xff\xd8\xff")

    created = api_server.create_bala_ai_video_material_batch(api_server.BalaMaterialBatchFromRowsRequest(
        rows=[{
            "输入款号": "208326100202",
            "素材来源": "模拍图",
            "文件名": "model.jpg",
            "本地文件": str(image),
            "下载结果": "已下载",
            "处理动作": "保留模拍图",
        }],
        source_task={"adapter_id": "bala-ai-video-assistant", "task_id": "semir_video_material_prepare"},
    ))
    token = created["token"]
    asset_id = created["items"][0]["assets"][0]["id"]

    exported = api_server.export_bala_ai_video_material_ai_input(
        created["batch_id"],
        api_server.BalaMaterialExportAiInputRequest(
            operation_type="pose_swap",
            selected_asset_ids=[asset_id],
            pose_prompt="让模特自然侧身行走，保留服装版型和颜色",
            prompt_extra="无文字，无变形",
        ),
        token=token,
    )
    params = exported["next_task"]["params"]
    assert params["operation_type"] == "pose_swap"
    assert params["source_images"]["paths"] == [str(image)]
    assert params["pose_prompt"] == "让模特自然侧身行走，保留服装版型和颜色"


def test_bala_model_library_api_filters_and_serves_images():
    payload = api_server.list_bala_ai_model_library(age_label="幼童", gender="女", search="标准")

    assert payload["items"]
    item = next(item for item in payload["items"] if item["id"] == "100女/标准.jpg")
    assert item["image_url"].startswith("/bala-ai-video-model-library/api/image/")

    response = api_server.get_bala_ai_model_library_image("100女/标准.jpg")
    assert str(response.path).endswith("100女/标准.jpg")
