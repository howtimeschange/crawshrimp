from pathlib import Path

from core import api_server
from core import bala_ai_video_review as review
from core import runtime_paths


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


def test_bala_review_decisions_and_export_video_input(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path / "data"))
    runtime_paths.reset_runtime_data_root_cache()
    image = tmp_path / "ai.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\n")
    artifact_dir = runtime_paths.child_dir("bala-ai-video-review")
    batch = {
        "batch_id": "bala-api-test",
        "token": "token-test",
        "workflow": "bala_ai_video_image_review",
        "status": "pending_approval",
        "artifact_dir": str(artifact_dir),
        "video_provider": "qn_img2video",
        "items": [{
            "style_code": "208326100202",
            "assets": [
                {"id": "ai-1", "kind": "ai", "path": str(image), "status": "pending", "operation_type": "face_swap"},
            ],
        }],
    }
    review.save_review_batch(batch)

    decisions = api_server.save_bala_ai_video_review_decisions(
        "bala-api-test",
        api_server.BalaReviewDecisionsRequest(decisions={"ai-1": {"status": "approved"}}),
        token="token-test",
    )
    assert decisions["status"] in {"pending_approval", "ready_for_video"}

    exported = api_server.export_bala_ai_video_review_video_input(
        "bala-api-test",
        api_server.BalaReviewExportVideoInputRequest(
            provider="qn_img2video",
            output_dir=str(tmp_path / "video"),
        ),
        token="token-test",
    )
    payload = exported
    assert payload["provider"] == "qn_img2video"
    assert Path(payload["manifest_path"]).is_file()
    assert payload["next_task"]["adapter_id"] == "bala-ai-video-assistant"
    assert payload["next_task"]["task_id"] == "qn_img2video_batch"
    assert payload["next_task"]["params"]["material_images"]["paths"]
