import json
from pathlib import Path

from core import ai_image_service
from core import bala_ai_video_review as review


def test_build_review_batch_keeps_four_ai_operations_separate(tmp_path):
    source = tmp_path / "208326100202" / "01_模拍原图" / "source.png"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"\x89PNG\r\n\x1a\n")
    model = tmp_path / "models" / "100女" / "标准.jpg"
    model.parent.mkdir(parents=True)
    model.write_bytes(b"\xff\xd8\xff")
    garment = tmp_path / "garment.jpg"
    outfit = tmp_path / "outfit.jpg"
    variant = tmp_path / "variant.jpg"
    for path in [garment, outfit, variant]:
        path.write_bytes(b"\xff\xd8\xff")
    rows = [
        {
            "源图序号": 1,
            "源图文件": str(source),
            "款号": "208326100202",
            "操作类型": "face_swap",
            "模特ID": "100女/标准.jpg",
            "模特图文件": str(model),
            "AI任务UID": "job-face",
            "运行UID": "run-face",
            "执行结果": "已提交",
        },
        {
            "源图序号": 1,
            "源图文件": str(source),
            "款号": "208326100202",
            "操作类型": "background_swap",
            "背景Prompt": "换成马尔代夫的海边",
            "AI任务UID": "job-bg",
            "运行UID": "run-bg",
            "执行结果": "已提交",
        },
        {
            "源图序号": 1,
            "源图文件": str(source),
            "款号": "208326100202",
            "操作类型": "outfit_swap",
            "服装图文件": str(garment),
            "搭配参考图文件": str(outfit),
            "同款不同色参考图文件": str(variant),
            "AI任务UID": "job-outfit",
            "运行UID": "run-outfit",
            "执行结果": "已提交",
        },
        {
            "源图序号": 1,
            "源图文件": str(source),
            "款号": "208326100202",
            "操作类型": "pose_swap",
            "姿势Prompt": "让模特自然侧身行走，保留服装版型和颜色",
            "AI任务UID": "job-pose",
            "运行UID": "run-pose",
            "执行结果": "已提交",
        },
    ]

    batch = review.build_review_batch(
        rows,
        {"video_provider": "qn_img2video"},
        str(tmp_path / "artifacts"),
        "http://127.0.0.1:18765",
    )

    assert batch["workflow"] == "bala_ai_video_image_review"
    assert batch["status"] == "generating"
    assert batch["video_provider"] == "qn_img2video"
    assert batch["items"][0]["style_code"] == "208326100202"
    assert [asset["operation_type"] for asset in batch["items"][0]["assets"] if asset["kind"] == "ai"] == [
        "face_swap",
        "background_swap",
        "outfit_swap",
        "pose_swap",
    ]
    assert all(asset["status"] == "generating" for asset in batch["items"][0]["assets"] if asset["kind"] == "ai")
    assert "token=" in batch["board_url"]


def test_update_decisions_and_export_video_manifest(tmp_path):
    approved = tmp_path / "approved.png"
    approved.write_bytes(b"\x89PNG\r\n\x1a\n")
    batch = {
        "batch_id": "bala-review-test",
        "token": "secret-token",
        "workflow": "bala_ai_video_image_review",
        "status": "pending_approval",
        "artifact_dir": str(tmp_path),
        "items": [{
            "style_code": "208326100202",
            "assets": [
                {"id": "origin-1", "kind": "origin", "path": str(approved), "status": "reference"},
                {"id": "ai-1", "kind": "ai", "path": str(approved), "status": "pending", "operation_type": "face_swap"},
            ],
        }],
    }

    updated = review.update_review_decisions(batch, {"ai-1": {"status": "approved"}})
    assert updated["items"][0]["assets"][1]["status"] == "approved"

    manifest = review.export_video_input_manifest(updated, str(tmp_path / "video-input"), provider="qn_img2video")
    manifest_path = Path(manifest["manifest_path"])
    assert manifest_path.is_file()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert payload["provider"] == "qn_img2video"
    assert payload["styles"][0]["style_code"] == "208326100202"
    assert len(payload["styles"][0]["images"]) == 1
    assert Path(payload["styles"][0]["images"][0]["path"]).is_file()

    params = review.build_qn_img2video_initial_params(manifest)
    assert params["execute_mode"] == "plan"
    assert params["download_template_previews"] is True
    assert params["material_images"]["paths"] == [payload["styles"][0]["images"][0]["path"]]


def test_refresh_materializes_remote_ai_result_before_marking_pending(tmp_path, monkeypatch):
    generated = tmp_path / "generated.png"
    generated.write_bytes(b"\x89PNG\r\n\x1a\n")
    remote_url = "https://img.example/generated.png"
    calls = []

    monkeypatch.setattr(review.data_sink, "get_ai_image_job", lambda _job_uid: {
        "job_uid": "job-remote",
        "status": "completed",
        "summary": {
            "ok": True,
            "image_urls": [remote_url],
            "output_files": [],
            "runs": [{"status": "completed", "image_urls": [remote_url]}],
        },
    })
    monkeypatch.setattr(review.data_sink, "list_ai_image_assets", lambda _job_uid: [])

    def fake_materialize(job_uid, url):
        calls.append((job_uid, url))
        return {"ok": True, "job_uid": job_uid, "url": url, "path": str(generated)}

    monkeypatch.setattr(ai_image_service, "materialize_remote_image", fake_materialize)
    batch = {
        "batch_id": "bala-review-remote",
        "status": "generating",
        "items": [{
            "style_code": "208326102205",
            "assets": [{
                "id": "ai-remote",
                "kind": "ai",
                "job_uid": "job-remote",
                "path": "",
                "status": "generating",
            }],
        }],
    }

    refreshed = review.refresh_generated_assets(batch)
    asset = refreshed["items"][0]["assets"][0]

    assert calls == [("job-remote", remote_url)]
    assert asset["path"] == str(generated)
    assert asset["filename"] == "generated.png"
    assert asset["status"] == "pending"
    assert refreshed["status"] == "pending_approval"
