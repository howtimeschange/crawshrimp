import asyncio
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


def test_regenerate_endpoint_returns_the_newest_retry_asset(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path / "data"))
    runtime_paths.reset_runtime_data_root_cache()
    artifact_dir = runtime_paths.child_dir("bala-ai-video-review")
    batch = {
        "batch_id": "bala-retry-latest",
        "token": "token-retry",
        "artifact_dir": str(artifact_dir),
        "items": [{
            "style_code": "208326102205",
            "assets": [
                {"id": "ai-source", "kind": "ai", "status": "pending"},
                {"id": "retry-old", "kind": "ai", "status": "generating", "regenerated_from_asset_id": "ai-source"},
            ],
        }],
    }
    review.save_review_batch(batch)

    def fake_append(loaded, _req):
        loaded["items"][0]["assets"].append({
            "id": "retry-new",
            "kind": "ai",
            "status": "generating",
            "regenerated_from_asset_id": "ai-source",
        })
        return loaded

    monkeypatch.setattr(api_server, "_append_bala_review_regenerate_asset", fake_append)
    result = asyncio.run(api_server.regenerate_bala_ai_video_review_asset(
        "bala-retry-latest",
        api_server.BalaReviewRegenerateRequest(asset_id="ai-source", submit_async=True),
        token="token-retry",
    ))

    assert result["asset"]["id"] == "retry-new"


def test_delete_review_asset_persists_ai_removal_and_rejects_origin(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path / "data"))
    runtime_paths.reset_runtime_data_root_cache()
    artifact_dir = runtime_paths.child_dir("bala-ai-video-review")
    batch = {
        "batch_id": "bala-delete-result",
        "token": "token-delete",
        "artifact_dir": str(artifact_dir),
        "status": "pending_approval",
        "items": [{
            "style_code": "208326102205",
            "assets": [
                {"id": "origin-1", "kind": "origin", "status": "pending"},
                {"id": "ai-1", "kind": "ai", "status": "pending", "job_uid": "job-1"},
            ],
        }],
    }
    review.save_review_batch(batch)

    updated = api_server.delete_bala_ai_video_review_asset(
        "bala-delete-result",
        "ai-1",
        token="token-delete",
    )

    assert [asset["id"] for asset in updated["items"][0]["assets"]] == ["origin-1"]
    persisted = review.load_review_batch("bala-delete-result")
    assert [asset["id"] for asset in persisted["items"][0]["assets"]] == ["origin-1"]

    try:
        api_server.delete_bala_ai_video_review_asset(
            "bala-delete-result",
            "origin-1",
            token="token-delete",
        )
    except api_server.HTTPException as exc:
        assert exc.status_code == 400
        assert "AI" in str(exc.detail)
    else:
        raise AssertionError("origin asset deletion must be rejected")


def test_review_fallback_board_escapes_persisted_asset_fields(monkeypatch):
    batch = {
        "batch_id": 'batch-<script>alert("id")</script>',
        "items": [{
            "style_code": '<img src=x onerror=alert("style")>',
            "assets": [{
                "id": "ai-1",
                "kind": "ai",
                "operation_type": '<script>alert("operation")</script>',
                "status": '<b onmouseover=alert("status")>pending</b>',
                "filename": '<svg onload=alert("file")>.png',
            }],
        }],
    }
    monkeypatch.setattr(api_server, "_load_bala_review_batch_checked", lambda _batch_id, _token: batch)

    response = api_server.get_bala_ai_video_review_board("unsafe", token="token")
    html = response.body.decode("utf-8")

    assert "<script>" not in html
    assert "<img src=x" not in html
    assert "<svg onload" not in html
    assert "&lt;script&gt;" in html
    assert "&lt;img src=x" in html


def test_review_workspace_api_lists_all_batches_for_a_style(monkeypatch):
    batches = [{"batch_id": "batch-face"}, {"batch_id": "batch-pose"}]
    calls = []
    monkeypatch.setattr(review, "list_review_batches", lambda *, style_codes, limit: (
        calls.append((style_codes, limit)) or batches
    ))

    result = api_server.list_bala_ai_video_review_workspace_batches(
        style_codes="208326102205, 208326105214",
        limit=25,
    )

    assert result == {"items": batches}
    assert calls == [(["208326102205", "208326105214"], 25)]
