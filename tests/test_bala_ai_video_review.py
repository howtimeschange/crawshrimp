import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from core import ai_image_service
from core import bala_ai_video_review as review
from core import runtime_paths


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
    assert next(asset for asset in batch["items"][0]["assets"] if asset["kind"] == "origin")["status"] == "pending"
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
                {"id": "origin-1", "kind": "origin", "path": str(approved), "status": "pending"},
                {"id": "ai-1", "kind": "ai", "path": str(approved), "status": "pending", "operation_type": "face_swap"},
            ],
        }],
    }

    updated = review.update_review_decisions(batch, {
        "origin-1": {"status": "approved"},
        "ai-1": {"status": "approved"},
    })
    assert updated["items"][0]["assets"][0]["status"] == "approved"
    assert updated["items"][0]["assets"][1]["status"] == "approved"

    manifest = review.export_video_input_manifest(updated, str(tmp_path / "video-input"), provider="qn_img2video")
    manifest_path = Path(manifest["manifest_path"])
    assert manifest_path.is_file()
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert payload["provider"] == "qn_img2video"
    assert payload["styles"][0]["style_code"] == "208326100202"
    assert len(payload["styles"][0]["images"]) == 2
    assert {item["kind"] for item in payload["styles"][0]["images"]} == {"origin", "ai"}
    assert Path(payload["styles"][0]["images"][0]["path"]).is_file()

    params = review.build_qn_img2video_initial_params(manifest)
    assert params["execute_mode"] == "plan"
    assert params["download_template_previews"] is True
    assert params["material_images"]["paths"] == [item["path"] for item in payload["styles"][0]["images"]]


def test_origin_only_review_batch_can_be_approved_for_video(tmp_path):
    source = tmp_path / "source.jpg"
    source.write_bytes(b"\xff\xd8\xff")
    batch = {
        "batch_id": "origin-only",
        "status": "pending_approval",
        "items": [{
            "style_code": "208326102205",
            "assets": [{"id": "origin-1", "kind": "origin", "path": str(source), "status": "pending"}],
        }],
    }

    updated = review.update_review_decisions(batch, {"origin-1": {"status": "approved"}})

    assert updated["status"] == "ready_for_video"
    assert updated["items"][0]["assets"][0]["status"] == "approved"


def test_removed_ai_result_does_not_reappear_when_review_batch_refreshes(tmp_path):
    generated = tmp_path / "generated.png"
    generated.write_bytes(b"\x89PNG\r\n\x1a\n")
    batch = {
        "batch_id": "delete-ai-result",
        "status": "pending_approval",
        "items": [{
            "style_code": "208326102205",
            "assets": [
                {"id": "origin-1", "kind": "origin", "path": str(generated), "status": "pending"},
                {"id": "ai-1", "kind": "ai", "path": str(generated), "status": "pending", "job_uid": "job-1"},
            ],
        }],
    }

    updated = review.remove_review_asset(batch, "ai-1")
    refreshed = review.refresh_generated_assets(updated)

    assert [asset["id"] for asset in refreshed["items"][0]["assets"]] == ["origin-1"]
    with pytest.raises(ValueError, match="AI 结果"):
        review.remove_review_asset(refreshed, "origin-1")


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


@pytest.mark.parametrize("terminal_status", ["failed", "cancelled", "canceled", "expired"])
def test_refresh_marks_terminal_ai_image_job_as_failed(terminal_status, monkeypatch):
    monkeypatch.setattr(review.data_sink, "get_ai_image_job", lambda _job_uid: {
        "job_uid": "job-terminal",
        "status": terminal_status,
        "summary": {
            "ok": False,
            "error": f"provider task {terminal_status}",
            "runs": [{
                "run_uid": "run-terminal",
                "status": terminal_status,
                "error": f"provider task {terminal_status}",
            }],
        },
    })
    monkeypatch.setattr(review.data_sink, "list_ai_image_assets", lambda _job_uid: [])
    batch = {
        "batch_id": "bala-review-terminal",
        "status": "generating",
        "items": [{
            "style_code": "208326102205",
            "assets": [{
                "id": "ai-terminal",
                "kind": "ai",
                "job_uid": "job-terminal",
                "run_uid": "run-terminal",
                "path": "",
                "status": "generating",
                "review_note": "已异步提交重跑任务",
            }],
        }],
    }

    refreshed = review.refresh_generated_assets(batch)
    asset = refreshed["items"][0]["assets"][0]

    assert asset["status"] == "failed"
    assert terminal_status in asset["review_note"]
    assert refreshed["status"] != "generating"


def test_refresh_uses_terminal_provider_status_when_public_status_is_stale(monkeypatch):
    monkeypatch.setattr(review.data_sink, "get_ai_image_job", lambda _job_uid: {
        "job_uid": "job-provider-terminal",
        "status": "running",
        "summary": {
            "runs": [{
                "run_uid": "run-provider-terminal",
                "status": "running",
                "provider_status": "expired",
                "error": "provider task expired",
            }],
        },
    })
    monkeypatch.setattr(review.data_sink, "list_ai_image_assets", lambda _job_uid: [])
    batch = {
        "batch_id": "bala-review-provider-terminal",
        "status": "generating",
        "items": [{
            "style_code": "208326102205",
            "assets": [{
                "id": "ai-provider-terminal",
                "kind": "ai",
                "job_uid": "job-provider-terminal",
                "run_uid": "run-provider-terminal",
                "path": "",
                "status": "generating",
            }],
        }],
    }

    refreshed = review.refresh_generated_assets(batch)
    asset = refreshed["items"][0]["assets"][0]

    assert asset["status"] == "failed"
    assert asset["review_note"] == "provider task expired"
    assert refreshed["status"] != "generating"


def test_list_review_batches_restores_every_batch_for_requested_style(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path / "data"))
    runtime_paths.reset_runtime_data_root_cache()
    artifact_dir = runtime_paths.child_dir("bala-ai-video-review")

    for batch_id, style_code, job_uid in [
        ("bala-ai-video-20260716-000001-a", "208326102205", "face-job"),
        ("bala-ai-video-20260716-000002-b", "208326102205", "pose-job"),
        ("bala-ai-video-20260716-000003-c", "208326999999", "other-job"),
    ]:
        review.save_review_batch({
            "batch_id": batch_id,
            "token": f"token-{job_uid}",
            "board_url": f"http://127.0.0.1/review/{batch_id}",
            "artifact_dir": str(artifact_dir),
            "items": [{
                "style_code": style_code,
                "assets": [{"id": "ai-1", "kind": "ai", "job_uid": job_uid, "status": "pending"}],
            }],
        })

    batches = review.list_review_batches(style_codes=["208326102205"], limit=10)

    assert [batch["batch_id"] for batch in batches] == [
        "bala-ai-video-20260716-000001-a",
        "bala-ai-video-20260716-000002-b",
    ]
    assert [batch["items"][0]["assets"][0]["job_uid"] for batch in batches] == ["face-job", "pose-job"]


def test_list_review_batches_scopes_matches_to_the_requested_workspace(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path / "data"))
    runtime_paths.reset_runtime_data_root_cache()
    artifact_dir = runtime_paths.child_dir("bala-ai-video-review")

    for batch_id, workspace in [
        ("workspace-a", "/tmp/ai-video/workspace-a"),
        ("workspace-b", "/tmp/ai-video/workspace-b"),
    ]:
        review.save_review_batch({
            "batch_id": batch_id,
            "token": f"token-{batch_id}",
            "artifact_dir": str(artifact_dir),
            "workspace_dir": workspace,
            "items": [{
                "style_code": "208326102205",
                "assets": [{"id": "origin", "kind": "origin", "path": f"{workspace}/208326102205/source.jpg"}],
            }],
        })

    batches = review.list_review_batches(
        style_codes=["208326102205"],
        workspace_dir="/tmp/ai-video/workspace-a",
        limit=10,
    )

    assert [batch["batch_id"] for batch in batches] == ["workspace-a"]


def test_mutate_review_batch_serializes_concurrent_asset_updates(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path / "data"))
    runtime_paths.reset_runtime_data_root_cache()
    batch = {
        "batch_id": "concurrent-review",
        "token": "token-concurrent",
        "items": [{
            "style_code": "208326102205",
            "assets": [
                {"id": "asset-a", "kind": "ai", "status": "pending"},
                {"id": "asset-b", "kind": "ai", "status": "pending"},
            ],
        }],
    }
    review.save_review_batch(batch)
    first_loaded = threading.Event()
    second_finished = threading.Event()

    def approve_first(loaded):
        first_loaded.set()
        second_finished.wait(0.2)
        return review.update_review_decisions(loaded, {"asset-a": {"status": "approved"}})

    def reject_second(loaded):
        return review.update_review_decisions(loaded, {"asset-b": {"status": "rejected"}})

    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(
            review.mutate_review_batch,
            "concurrent-review",
            "token-concurrent",
            approve_first,
        )
        assert first_loaded.wait(1)
        second = executor.submit(
            review.mutate_review_batch,
            "concurrent-review",
            "token-concurrent",
            reject_second,
        )
        second.add_done_callback(lambda _future: second_finished.set())
        first.result(timeout=2)
        second.result(timeout=2)

    persisted = review.load_review_batch("concurrent-review")
    statuses = {
        asset["id"]: asset["status"]
        for asset in persisted["items"][0]["assets"]
    }
    assert statuses == {"asset-a": "approved", "asset-b": "rejected"}


def test_save_review_batch_atomically_replaces_the_manifest(tmp_path, monkeypatch):
    monkeypatch.setenv("CRAWSHRIMP_DATA", str(tmp_path / "data"))
    runtime_paths.reset_runtime_data_root_cache()
    replacements = []
    original_replace = os.replace

    def recording_replace(source, target):
        replacements.append((Path(source), Path(target)))
        return original_replace(source, target)

    monkeypatch.setattr(os, "replace", recording_replace)
    path = review.save_review_batch({
        "batch_id": "atomic-review",
        "token": "token-atomic",
        "items": [],
    })

    assert len(replacements) == 1
    temporary, target = replacements[0]
    assert target == path
    assert temporary.parent == path.parent
    assert temporary != path
    assert not temporary.exists()
    assert review.load_review_batch("atomic-review")["token"] == "token-atomic"
