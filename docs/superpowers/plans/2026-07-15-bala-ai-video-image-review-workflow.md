# Bala AI Video Image Review Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a workflow-style Bala AI video pipeline where operators batch-enter style codes, use `semir_video_material_prepare` to find and download candidate images, review/select those images, run independent GPT Image operations for face swap, background swap, outfit swap, or pose swap, approve generated results in one pool, and send approved images directly into software-manager image-to-video generation while keeping every atomic script usable.

**Architecture:** Keep the current adapter tasks as atomic capabilities: `semir_video_material_prepare`, `bala_ai_face_background_generate`, and `qn_img2video_batch`. Add a Bala material-selection batch before AI generation, then a Bala generated-image review batch between AI generation and video generation. The workflow UI exposes step-by-step handoffs: material search -> material selection -> AI operation selection -> generated image review -> `qn_img2video_batch` template selection, prompt input, generation, polling, and download.

**Tech Stack:** Python FastAPI backend, existing `core.data_sink` AI image job tables, existing `core.ai_image_service` GPT Image workbench helpers, Electron IPC, Vue 3 renderer, existing JS adapter runner, Node `node:test`, Python `pytest`/`unittest`.

## Global Constraints

- AI face swap, AI background swap, AI outfit swap, and AI pose swap must be independent operations with separate prompts, validation, retry, and status.
- `face_swap` model selection must use a visual model-library picker modal with thumbnail preview and age/gender filters; the workflow must not require operators to choose from a plain dropdown or type model file IDs manually.
- `semir_video_material_prepare` is the required first workflow step for batch style-code search; it must remain available as a standalone atomic script.
- Material search results must be displayed before AI generation, and operators must explicitly select which downloaded images continue into the AI step.
- GPT Image is the primary image provider; software-manager image tools and Dasen AI are optional fallback providers outside this implementation.
- Keep existing atomic scripts available; the new workflow should orchestrate them rather than replacing them.
- Image review is a required human gate before video generation.
- The first video provider is software-manager `qn_img2video_batch`; provider boundaries must allow future providers or direct APIs.
- Do not auto-publish videos in this implementation.
- Do not commit secrets, API keys, cookies, downloaded runtime media, or `.crawshrimp-dev*` directories.
- Generated video template previews may be downloaded locally so operators can choose templates visually.
- All external state-changing video work must remain behind the user action that starts `qn_img2video_batch` in `plan` or `live` mode.

---

## File Map

### Material Search And Selection

- Create `core/bala_ai_video_materials.py`: convert `semir_video_material_prepare` output rows into a material-selection batch, persist selections, serve selected image references, and build initial params for the AI operation task.
- Create `core/bala_ai_model_library.py`: read bundled model-library metadata from `adapters/bala-ai-video-assistant/assets/model-library/manifest.json`, normalize age/gender/group facets, and serve thumbnail/image file responses for the visual model picker.
- Add `tests/test_bala_ai_video_materials.py`: unit tests for material grouping, source-type classification, selected-image export, and operation-specific initial params.
- Add `tests/test_bala_ai_model_library.py`: unit tests for model-library group normalization, age/gender filtering, selected model IDs, and image path resolution.
- Modify `core/api_server.py`: add Bala material-selection API routes that create a material batch from task result rows, read/update selections, serve local image files, and export AI task handoff params.
- Modify `app/src/main.js`: add Electron IPC handlers for Bala material batch creation, reads, selection saves, and AI handoff export.
- Modify `app/src/preload.js`: expose `createBalaMaterialBatch`, `getBalaMaterialBatch`, `saveBalaMaterialSelection`, `exportBalaAiInput`, and `listBalaModelLibrary`.
- Create `app/src/renderer/components/BalaModelLibraryPickerModal.vue`: reusable visual model picker with thumbnail grid, age/gender/group filters, search by expression, multi-select, and selected-model preview.
- Create `app/src/renderer/views/BalaAiMaterialSelectionDrawer.vue`: workflow first-step drawer that displays downloaded images by款号/source type, lets operators select images, choose AI operation type, fill operation prompts/references, and enter the AI generation step.
- Modify `app/src/renderer/utils/balaAiVideoWorkflow.js`: add material-result parsing, material summary, and AI-operation handoff helpers.
- Modify `tests/bala-ai-video-workflow-ui.test.js`: renderer utility tests for material selection and AI-operation handoff params.

### New Bala Review Backend

- Create `core/bala_ai_video_review.py`: Bala review-batch model, JSON persistence, decision updates, generated-result refresh, retry row construction, approved-image export, and next-video parameter construction.
- Modify `core/api_server.py`: delegate Bala image generation to the review module, add Bala review API routes, add output file and task-instance summary handling.
- Add `tests/test_bala_ai_video_review.py`: unit tests for review-batch construction, four-operation separation, decision updates, refresh, and video manifest export.
- Add `tests/test_bala_ai_video_review_api.py`: FastAPI route tests for batch read, decisions, refresh, regenerate, and video handoff.
- Modify `tests/test_bala_ai_video_assistant_packaging.py`: update existing Bala generation tests to assert review batch fields and board URL.

### Adapter Manifest And JS Plan Script

- Modify `adapters/bala-ai-video-assistant/manifest.yaml`: add `operation_type`, outfit/pose reference inputs, workflow output fields, review options, and video handoff options to `bala_ai_face_background_generate`.
- Modify `adapters/bala-ai-video-assistant/bala-ai-face-background-generate.js`: update front-end preflight rows for `face_swap`, `background_swap`, `outfit_swap`, and `pose_swap`, validation messages, and output columns.
- Modify `tests/bala-ai-video-assistant-face-background.test.js`: cover four operation-specific validation paths and plan rows.

### Electron Bridge And Renderer Workflow

- Modify `app/src/main.js`: add Bala review IPC handlers that call new backend routes.
- Modify `app/src/preload.js`: expose `getBalaReviewBatch`, `saveBalaReviewDecisions`, `refreshBalaReviewBatch`, `regenerateBalaReviewAsset`, and `exportBalaVideoInput`.
- Create `app/src/renderer/views/BalaAiImageReviewDrawer.vue`: unified review drawer for generated images from face swap, background swap, outfit swap, and pose swap operations, retry, export, and "进入视频生成".
- Modify `app/src/renderer/views/TaskRunner.vue`: detect Bala material and AI workflow tasks, show workflow steps, open the material-selection drawer or image-review drawer, and emit an `open-task` request for AI or video handoff.
- Modify `app/src/renderer/App.vue`: handle `open-task` emitted from `TaskRunner`, switch to `bala-ai-video-assistant/qn_img2video_batch`, and pass initial params.
- Modify `app/src/renderer/utils/balaAiVideoWorkflow.js`: extend the material handoff helpers with review URL parsing, status summaries, and qn video handoff params.
- Modify `tests/bala-ai-video-workflow-ui.test.js`: extend renderer utility tests for review step status and qn handoff params.

### Existing Video Stage

- Keep `adapters/bala-ai-video-assistant/qn-img2video-batch.js` as the current video-provider implementation. The workflow handoff must use its existing template catalog, template title/description rows, local preview downloads, custom prompt, generation polling, video download, and result-row display behavior.
- Keep `tests/bala-ai-video-assistant-qn-img2video.test.js` as the regression suite for the video-provider contract. The implementation must pass this suite after the workflow handoff params are applied.

---

## Task 1: Add Bala Material Search Selection Entry

**Files:**
- Create: `core/bala_ai_video_materials.py`
- Create: `core/bala_ai_model_library.py`
- Modify: `core/api_server.py`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Create: `app/src/renderer/components/BalaModelLibraryPickerModal.vue`
- Create: `app/src/renderer/views/BalaAiMaterialSelectionDrawer.vue`
- Modify: `app/src/renderer/views/TaskRunner.vue`
- Modify: `app/src/renderer/utils/balaAiVideoWorkflow.js`
- Test: `tests/test_bala_ai_video_materials.py`
- Test: `tests/test_bala_ai_model_library.py`
- Test: `tests/test_bala_ai_video_review_api.py`
- Test: `tests/bala-ai-video-workflow-ui.test.js`

**Interfaces:**
- Consumes: rows produced by `semir_video_material_prepare`, especially `输入款号`, `素材来源`, `文件名`, `本地文件`, `下载结果`, `处理动作`, and `备注`.
- Produces:
  - `build_material_batch(rows: list[dict], artifact_dir: str, api_base_url: str) -> dict`
  - `save_material_batch(batch: dict) -> Path`
  - `load_material_batch(batch_id: str) -> dict`
  - `update_material_selection(batch: dict, selected_asset_ids: list[str]) -> dict`
  - `export_ai_input(batch: dict, operation_type: str, payload: dict) -> dict`
  - `load_model_library() -> dict`
  - `filter_model_library(library: dict, age_label: str = "", gender: str = "", group: str = "", search: str = "") -> dict`
  - `resolve_model_image_path(model_id: str) -> Path`
- Produces backend routes:
  - `POST /bala-ai-video-materials/api/from-rows`
  - `GET /bala-ai-video-materials/api/{batch_id}`
  - `GET /bala-ai-video-materials/api/{batch_id}/image/{asset_id}`
  - `POST /bala-ai-video-materials/api/{batch_id}/selection`
  - `POST /bala-ai-video-materials/api/{batch_id}/export-ai-input`
  - `GET /bala-ai-video-model-library/api`
  - `GET /bala-ai-video-model-library/api/image/{model_id:path}`
- Produces Electron bridge methods:
  - `createBalaMaterialBatch(rows, sourceTask)`
  - `getBalaMaterialBatch(batchId, token)`
  - `saveBalaMaterialSelection(batchId, token, selectedAssetIds)`
  - `exportBalaAiInput(batchId, token, payload)`
  - `listBalaModelLibrary(filters)`
- Produces renderer event `open-task` with `{ adapterId: "bala-ai-video-assistant", taskId: "bala_ai_face_background_generate", params }`.

- [ ] **Step 1: Write failing material batch tests**

Create `tests/test_bala_ai_video_materials.py`:

```python
from pathlib import Path

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
```

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_materials.py -q
```

Expected: fail with `ImportError` because `core.bala_ai_video_materials` does not exist.

- [ ] **Step 2: Write failing model-library tests**

Create `tests/test_bala_ai_model_library.py`:

```python
from pathlib import Path

from core import bala_ai_model_library as library


def test_model_library_groups_by_age_and_gender():
    data = library.load_model_library()

    assert data["name"] == "巴拉AI模特内置素材库"
    assert data["groups"]["66"]["age_label"] == "新生儿"
    assert data["groups"]["66"]["gender"] == "通用"
    assert data["groups"]["73女"]["age_label"] == "婴童"
    assert data["groups"]["73女"]["gender"] == "女"
    assert data["groups"]["100男"]["age_label"] == "幼童"
    assert data["groups"]["100男"]["gender"] == "男"
    assert data["groups"]["140女"]["age_label"] == "中大童"
    assert data["groups"]["140女"]["gender"] == "女"
    assert len(data["items"]) >= 1
    assert all(item["image_url"].startswith("/bala-ai-video-model-library/api/image/") for item in data["items"])


def test_filter_model_library_by_age_gender_and_expression():
    data = library.load_model_library()

    filtered = library.filter_model_library(data, age_label="幼童", gender="女", search="标准")

    assert filtered["items"]
    assert all(item["age_label"] == "幼童" for item in filtered["items"])
    assert all(item["gender"] == "女" for item in filtered["items"])
    assert any(item["id"] == "100女/标准.jpg" for item in filtered["items"])


def test_resolve_model_image_path_rejects_path_traversal():
    resolved = library.resolve_model_image_path("100女/标准.jpg")
    assert resolved.is_file()
    assert resolved.name == "标准.jpg"

    try:
        library.resolve_model_image_path("../manifest.json")
    except ValueError as exc:
        assert "非法模特素材路径" in str(exc)
    else:
        raise AssertionError("path traversal should be rejected")
```

Run:

```bash
python3 -m pytest tests/test_bala_ai_model_library.py -q
```

Expected: fail with `ImportError` because `core.bala_ai_model_library` does not exist.

- [ ] **Step 3: Implement material batch and model-library modules**

Create `core/bala_ai_video_materials.py` with these functions:

```python
from __future__ import annotations

import hmac
import json
import re
import secrets
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from core import runtime_paths

WORKFLOW_ID = "bala_ai_video_material_selection"
VIDEO_ADAPTER_ID = "bala-ai-video-assistant"
AI_TASK_ID = "bala_ai_face_background_generate"
VALID_OPERATION_TYPES = {"face_swap", "background_swap", "outfit_swap", "pose_swap"}


def compact(value: Any) -> str:
    return str(value or "").strip()


def normalize_operation_type(value: Any) -> str:
    text = compact(value).lower()
    if text in {"background_swap", "background", "换背景"}:
        return "background_swap"
    if text in {"outfit_swap", "outfit", "换装"}:
        return "outfit_swap"
    if text in {"pose_swap", "pose", "换姿势"}:
        return "pose_swap"
    return "face_swap"


def normalize_source_type(value: Any) -> str:
    text = compact(value)
    if "模拍" in text:
        return "model"
    if "细节" in text or "平拍" in text:
        return "detail"
    return "other"


def build_material_batch(rows: list[dict], artifact_dir: str, api_base_url: str) -> dict:
    batch_id = f"bala-material-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{secrets.token_hex(3)}"
    token = secrets.token_urlsafe(18)
    items_by_style: dict[str, dict] = {}
    for index, row in enumerate(rows or [], start=1):
        local_path = compact(row.get("本地文件"))
        if not local_path or not Path(local_path).is_file():
            continue
        if compact(row.get("下载结果")) in {"已跳过", "失败", "下载失败"}:
            continue
        style_code = compact(row.get("输入款号") or row.get("款号"))
        if not style_code:
            match = re.search(r"\b(\d{12})\b", local_path)
            style_code = match.group(1) if match else "unknown"
        item = items_by_style.setdefault(style_code, {"style_code": style_code, "assets": []})
        source_type = normalize_source_type(row.get("素材来源"))
        asset_id = f"{style_code}-{source_type}-{len(item['assets']) + 1}"
        item["assets"].append({
            "id": asset_id,
            "style_code": style_code,
            "source_type": source_type,
            "filename": compact(row.get("文件名")) or Path(local_path).name,
            "path": str(Path(local_path).expanduser()),
            "selected": source_type == "model",
            "download_result": compact(row.get("下载结果")),
            "action": compact(row.get("处理动作")),
            "note": compact(row.get("备注")),
            "image_url": f"{api_base_url.rstrip('/')}/bala-ai-video-materials/api/{batch_id}/image/{asset_id}?token={token}",
        })
    batch = {
        "batch_id": batch_id,
        "token": token,
        "workflow": WORKFLOW_ID,
        "status": "pending_selection",
        "artifact_dir": str(Path(artifact_dir or runtime_paths.child_dir("bala-ai-video-materials")).expanduser()),
        "items": list(items_by_style.values()),
        "board_url": f"{api_base_url.rstrip('/')}/bala-ai-video-materials/{batch_id}?token={token}",
    }
    return batch
```

Add `save_material_batch`, `load_material_batch`, `validate_token`, `update_material_selection`, and `export_ai_input`. `export_ai_input` must return:

```json
{
  "ok": true,
  "operation_type": "outfit_swap",
  "next_task": {
    "adapter_id": "bala-ai-video-assistant",
    "task_id": "bala_ai_face_background_generate",
    "params": {
      "operation_type": "outfit_swap",
      "source_images": {"paths": ["/absolute/model.jpg"]},
      "garment_images": {"paths": ["/absolute/garment.jpg"]},
      "outfit_reference_images": {"paths": ["/absolute/outfit.jpg"]},
      "variant_reference_images": {"paths": ["/absolute/variant.jpg"]},
      "review_mode": "create_review_batch",
      "generation_mode": "submit_async"
    }
  }
}
```

For `operation_type == "face_swap"`, `export_ai_input` must use the model IDs selected in `BalaModelLibraryPickerModal`:

```json
{
  "operation_type": "face_swap",
  "source_images": {"paths": ["/absolute/model-source.jpg"]},
  "model_ref_ids": "100女/标准.jpg\n73男/微笑.jpg",
  "model_groups": []
}
```

Create `core/bala_ai_model_library.py` with:

```python
from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from urllib.parse import quote

REPO_ROOT = Path(__file__).resolve().parents[1]
MODEL_LIBRARY_ROOT = REPO_ROOT / "adapters" / "bala-ai-video-assistant" / "assets" / "model-library"
MANIFEST_PATH = MODEL_LIBRARY_ROOT / "manifest.json"


def compact(value: Any) -> str:
    return str(value or "").strip()


def _with_image_url(item: dict) -> dict:
    model_id = compact(item.get("id"))
    return {
        **item,
        "image_url": f"/bala-ai-video-model-library/api/image/{quote(model_id, safe='')}",
    }


def load_model_library() -> dict:
    payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    items = [_with_image_url(item) for item in payload.get("items") or [] if compact(item.get("id"))]
    return {
        **payload,
        "items": items,
    }


def filter_model_library(library: dict, age_label: str = "", gender: str = "", group: str = "", search: str = "") -> dict:
    age = compact(age_label)
    sex = compact(gender)
    group_id = compact(group)
    keyword = compact(search).lower()
    items = []
    for item in library.get("items") or []:
        haystack = " ".join([
            compact(item.get("id")),
            compact(item.get("group_label")),
            compact(item.get("age_label")),
            compact(item.get("gender")),
            compact(item.get("expression")),
            compact(item.get("filename")),
        ]).lower()
        if age and compact(item.get("age_label")) != age:
            continue
        if sex and compact(item.get("gender")) != sex:
            continue
        if group_id and compact(item.get("group")) != group_id:
            continue
        if keyword and keyword not in haystack:
            continue
        items.append(item)
    return {
        **library,
        "items": items,
        "count": len(items),
    }


def resolve_model_image_path(model_id: str) -> Path:
    safe_id = compact(model_id).replace("\\", "/")
    if not safe_id or safe_id.startswith("/") or ".." in Path(safe_id).parts:
        raise ValueError("非法模特素材路径")
    path = (MODEL_LIBRARY_ROOT / safe_id).resolve()
    root = MODEL_LIBRARY_ROOT.resolve()
    if root not in path.parents:
        raise ValueError("非法模特素材路径")
    if not path.is_file():
        raise FileNotFoundError(safe_id)
    return path
```

- [ ] **Step 4: Run material and model-library model tests**

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_materials.py tests/test_bala_ai_model_library.py -q
```

Expected: pass.

- [ ] **Step 5: Add material API route tests**

Extend `tests/test_bala_ai_video_review_api.py` with:

```python
def test_bala_material_batch_api_exports_pose_swap_ai_input(tmp_path):
    image = tmp_path / "model.jpg"
    image.write_bytes(b"\xff\xd8\xff")
    client = TestClient(app)

    created = client.post("/bala-ai-video-materials/api/from-rows", json={
        "rows": [{
            "输入款号": "208326100202",
            "素材来源": "模拍图",
            "文件名": "model.jpg",
            "本地文件": str(image),
            "下载结果": "已下载",
            "处理动作": "保留模拍图",
        }],
        "source_task": {"adapter_id": "bala-ai-video-assistant", "task_id": "semir_video_material_prepare"},
    })
    assert created.status_code == 200
    batch = created.json()
    token = batch["token"]
    asset_id = batch["items"][0]["assets"][0]["id"]

    exported = client.post(
        f"/bala-ai-video-materials/api/{batch['batch_id']}/export-ai-input?token={token}",
        json={
            "operation_type": "pose_swap",
            "selected_asset_ids": [asset_id],
            "pose_prompt": "让模特自然侧身行走，保留服装版型和颜色",
            "prompt_extra": "无文字，无变形",
        },
    )
    assert exported.status_code == 200
    params = exported.json()["next_task"]["params"]
    assert params["operation_type"] == "pose_swap"
    assert params["source_images"]["paths"] == [str(image)]
    assert params["pose_prompt"] == "让模特自然侧身行走，保留服装版型和颜色"
```

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_review_api.py::test_bala_material_batch_api_exports_pose_swap_ai_input -q
```

Expected: fail because routes do not exist.

- [ ] **Step 6: Add material and model-library API routes and Electron bridge**

In `core/api_server.py`, add Pydantic request models:

```python
class BalaMaterialBatchFromRowsRequest(BaseModel):
    rows: list = []
    source_task: dict = {}


class BalaMaterialSelectionRequest(BaseModel):
    selected_asset_ids: list[str] = []


class BalaMaterialExportAiInputRequest(BaseModel):
    operation_type: str = "face_swap"
    selected_asset_ids: list[str] = []
    model_ref_ids: list[str] = []
    background_prompt: str = ""
    garment_images: dict = {}
    outfit_reference_images: dict = {}
    variant_reference_images: dict = {}
    pose_prompt: str = ""
    prompt_cards: list = []
    prompt_extra: str = ""
```

Add routes that call `core.bala_ai_video_materials` and `core.bala_ai_model_library`, then save every material mutation. Add model-library routes:

```python
@app.get("/bala-ai-video-model-library/api")
def list_bala_ai_model_library(age_label: str = "", gender: str = "", group: str = "", search: str = ""):
    data = bala_ai_model_library.load_model_library()
    return bala_ai_model_library.filter_model_library(data, age_label=age_label, gender=gender, group=group, search=search)


@app.get("/bala-ai-video-model-library/api/image/{model_id:path}")
def get_bala_ai_model_library_image(model_id: str):
    path = bala_ai_model_library.resolve_model_image_path(model_id)
    return FileResponse(path)
```

In `app/src/main.js`, add:

```js
secureHandle('create-bala-material-batch', async (_, rows, sourceTask) => {
  return apiCall('POST', '/bala-ai-video-materials/api/from-rows', { rows: rows || [], source_task: sourceTask || {} })
})

secureHandle('get-bala-material-batch', async (_, batchId, token) => {
  return apiCall('GET', `/bala-ai-video-materials/api/${encodeURIComponent(String(batchId || ''))}?token=${encodeURIComponent(String(token || ''))}`)
})

secureHandle('save-bala-material-selection', async (_, batchId, token, selectedAssetIds) => {
  return apiCall('POST', `/bala-ai-video-materials/api/${encodeURIComponent(String(batchId || ''))}/selection?token=${encodeURIComponent(String(token || ''))}`, { selected_asset_ids: selectedAssetIds || [] })
})

secureHandle('export-bala-ai-input', async (_, batchId, token, payload) => {
  return apiCall('POST', `/bala-ai-video-materials/api/${encodeURIComponent(String(batchId || ''))}/export-ai-input?token=${encodeURIComponent(String(token || ''))}`, payload || {})
})

secureHandle('list-bala-model-library', async (_, filters) => {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(filters || {})) {
    if (value) query.set(key, String(value))
  }
  const suffix = query.toString() ? `?${query.toString()}` : ''
  return apiCall('GET', `/bala-ai-video-model-library/api${suffix}`)
})
```

Expose matching methods in `app/src/preload.js`, including:

```js
listBalaModelLibrary: (filters) => ipcRenderer.invoke('list-bala-model-library', filters || {}),
```

- [ ] **Step 7: Add material selection UI utility tests**

Extend `tests/bala-ai-video-workflow-ui.test.js`:

```js
import fs from 'node:fs'

test('buildBalaAiStageRequest targets AI generation with selected material images', () => {
  const request = buildBalaAiStageRequest({
    next_task: {
      adapter_id: 'bala-ai-video-assistant',
      task_id: 'bala_ai_face_background_generate',
      params: {
        operation_type: 'pose_swap',
        source_images: { paths: ['/tmp/model.jpg'] },
        pose_prompt: '自然侧身行走',
      },
    },
  })
  assert.equal(request.adapterId, 'bala-ai-video-assistant')
  assert.equal(request.taskId, 'bala_ai_face_background_generate')
  assert.equal(request.params.operation_type, 'pose_swap')
  assert.deepEqual(request.params.source_images.paths, ['/tmp/model.jpg'])
})

test('Bala model library picker exposes visual age and gender filters', () => {
  const source = fs.readFileSync('app/src/renderer/components/BalaModelLibraryPickerModal.vue', 'utf8')

  assert.match(source, /选择 AI 模特素材/)
  assert.match(source, /新生儿/)
  assert.match(source, /婴童/)
  assert.match(source, /幼童/)
  assert.match(source, /中大童/)
  assert.match(source, /通用/)
  assert.match(source, /女/)
  assert.match(source, /男/)
  assert.match(source, /image_url/)
  assert.match(source, /selectedModelIds/)
  assert.match(source, /confirmSelection/)
})
```

Run:

```bash
node --test tests/bala-ai-video-workflow-ui.test.js
```

Expected: fail because `buildBalaAiStageRequest` does not exist.

- [ ] **Step 8: Add model-library picker, material selection drawer, and TaskRunner handoff**

Create `app/src/renderer/components/BalaModelLibraryPickerModal.vue` with these required controls:

- modal title: `选择 AI 模特素材`.
- left facet rail for age groups: `全部`, `新生儿`, `婴童`, `幼童`, `中大童`.
- gender segmented control: `全部`, `通用`, `女`, `男`.
- group filter chips: `66`, `73女`, `73男`, `100女`, `100男`, `140女`, `140男`.
- search input for expression/file name such as `标准`, `侧脸`, `微笑`.
- thumbnail grid using each item `image_url`.
- visible metadata on every tile: group label, expression, dimensions.
- multi-select state with selected count.
- confirm button that emits selected model IDs and selected model metadata.
- no text-only dropdown for primary model selection.

Create `app/src/renderer/views/BalaAiMaterialSelectionDrawer.vue` with these required controls:

- style-code grouped image grid.
- source tabs: `全部`, `模拍图`, `商品细节图`.
- selected-image count.
- operation segmented control: `AI 换脸`, `AI 换背景`, `AI 换装`, `AI 换姿势`.
- visual model-library picker button shown for `face_swap`.
- selected model thumbnail strip shown for `face_swap`.
- model picker data loaded through `window.cs.listBalaModelLibrary({ age_label, gender, group, search })`.
- selected model state named `selectedModelIds` and `selectedModelItems`.
- background prompt textarea shown for `background_swap`.
- garment image picker, outfit reference picker, and variant reference picker shown for `outfit_swap`.
- pose prompt textarea and Prompt-library picker shown for `pose_swap`.
- "进入 AI 生图" button.

In `TaskRunner.vue`, when the current task identity is `bala-ai-video-assistant/semir_video_material_prepare` and rows contain at least one downloaded local image, call:

```js
const materialBatch = await window.cs.createBalaMaterialBatch(rows, {
  adapter_id: props.adapterId,
  task_id: props.task?.task_id,
})
balaMaterialBoardUrl.value = materialBatch.board_url || ''
balaMaterialDrawerOpen.value = true
```

The drawer's `exportToAi()` method must call:

```js
const result = await window.cs.exportBalaAiInput(ref.batchId, ref.token, {
  operation_type: selectedOperation.value,
  selected_asset_ids: selectedAssetIds.value,
  model_ref_ids: selectedModelIds.value,
  background_prompt: backgroundPrompt.value,
  garment_images: { paths: garmentImagePaths.value },
  outfit_reference_images: { paths: outfitReferencePaths.value },
  variant_reference_images: { paths: variantReferencePaths.value },
  pose_prompt: posePrompt.value,
  prompt_cards: promptCards.value,
  prompt_extra: promptExtra.value,
})
emit('start-ai-stage', buildBalaAiStageRequest(result))
```

Wire `@start-ai-stage="request => emit('open-task', request)"` so the operator lands on `bala_ai_face_background_generate` with the selected source images, `model_ref_ids`, and operation-specific fields already filled.

- [ ] **Step 9: Run material API and UI tests**

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_materials.py tests/test_bala_ai_model_library.py tests/test_bala_ai_video_review_api.py -q
node --test tests/bala-ai-video-workflow-ui.test.js
```

Expected: pass.

- [ ] **Step 10: Commit**

```bash
git add core/bala_ai_video_materials.py core/bala_ai_model_library.py core/api_server.py app/src/main.js app/src/preload.js app/src/renderer/components/BalaModelLibraryPickerModal.vue app/src/renderer/views/BalaAiMaterialSelectionDrawer.vue app/src/renderer/views/TaskRunner.vue app/src/renderer/utils/balaAiVideoWorkflow.js tests/test_bala_ai_video_materials.py tests/test_bala_ai_model_library.py tests/test_bala_ai_video_review_api.py tests/bala-ai-video-workflow-ui.test.js
git commit -m "feat: add Bala material selection workflow entry"
```

## Task 2: Add Bala Review Batch Model

**Files:**
- Create: `core/bala_ai_video_review.py`
- Test: `tests/test_bala_ai_video_review.py`

**Interfaces:**
- Consumes: AI image job rows created by `core.data_sink.create_ai_image_job`, source-image paths, model-reference paths, run params.
- Produces:
  - `normalize_operation_type(value: object) -> str`
  - `build_review_batch(rows: list[dict], run_params: dict, artifact_dir: str, api_base_url: str) -> dict`
  - `save_review_batch(batch: dict) -> Path`
  - `load_review_batch(batch_id: str) -> dict`
  - `update_review_decisions(batch: dict, decisions: dict) -> dict`
  - `refresh_generated_assets(batch: dict) -> dict`
  - `export_video_input_manifest(batch: dict, output_root: str, provider: str = "qn_img2video") -> dict`
  - `build_qn_img2video_initial_params(manifest: dict) -> dict`

- [ ] **Step 1: Write failing review model tests**

Create `tests/test_bala_ai_video_review.py`:

```python
import json
from pathlib import Path

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
```

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_review.py -q
```

Expected: fail with `ImportError` or missing functions.

- [ ] **Step 2: Implement the review module**

Create `core/bala_ai_video_review.py` with:

```python
from __future__ import annotations

import json
import re
import secrets
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Mapping

from core import data_sink
from core import runtime_paths

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp"}
WORKFLOW_ID = "bala_ai_video_image_review"
STATUS_GENERATING = "generating"
STATUS_PENDING_APPROVAL = "pending_approval"
STATUS_READY_FOR_VIDEO = "ready_for_video"
VIDEO_PROVIDER_QN = "qn_img2video"


def _text(value: Any) -> str:
    return str(value or "").strip()


def normalize_operation_type(value: object) -> str:
    text = _text(value).lower()
    if text in {"face_swap", "face", "换脸", "ai_face"}:
        return "face_swap"
    if text in {"background_swap", "background", "换背景", "ai_background"}:
        return "background_swap"
    if text in {"outfit_swap", "outfit", "换装", "ai_outfit"}:
        return "outfit_swap"
    if text in {"pose_swap", "pose", "换姿势", "ai_pose"}:
        return "pose_swap"
    return "face_swap"


def _safe_id(value: str, fallback: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._~-]+", "-", _text(value)).strip("-")
    return cleaned or fallback


def _batch_dir(artifact_dir: str, batch_id: str) -> Path:
    root = Path(artifact_dir or runtime_paths.child_dir("bala-ai-video-review")).expanduser()
    path = root / _safe_id(batch_id, "bala-review")
    path.mkdir(parents=True, exist_ok=True)
    return path


def _style_code_from_row(row: Mapping[str, Any]) -> str:
    text = _text(row.get("款号") or row.get("style_code") or row.get("源图文件"))
    match = re.search(r"\b(\d{12})\b", text)
    return match.group(1) if match else text
```

Then add the functions named in the interface. `build_review_batch` must:

- create a `batch_id` like `bala-ai-video-{YYYYMMDD-HHMMSS}-{6 hex}`.
- create a random `token` using `secrets.token_urlsafe(18)`.
- group rows by `style_code`.
- create one origin asset per unique source image.
- create one AI asset per row with `job_uid`, `run_uid`, `operation_type`, `prompt`, `model_id`, `background_prompt`, `garment_paths`, `outfit_reference_paths`, `variant_reference_paths`, `pose_prompt`, and `status`.
- set `board_url` to `{api_base_url}/bala-ai-video-review/{batch_id}?token={token}`.
- set `status` to `generating` when any AI asset lacks a local path, otherwise `pending_approval`.
- store `video_provider` from params, defaulting to `qn_img2video`.

`export_video_input_manifest` must copy approved local AI images into:

```text
{output_root}/{style_code}/{original_filename}
```

and write:

```json
{
  "provider": "qn_img2video",
  "batch_id": "bala-review-test",
  "styles": [
    {
      "style_code": "208326100202",
      "images": [
        {
          "path": "/absolute/path/to/copied.png",
          "source_asset_id": "ai-1",
          "operation_type": "face_swap"
        }
      ]
    }
  ]
}
```

- [ ] **Step 3: Run review model tests**

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_review.py -q
```

Expected: pass.

- [ ] **Step 4: Commit**

```bash
git add core/bala_ai_video_review.py tests/test_bala_ai_video_review.py
git commit -m "feat: add Bala image review batch model"
```

## Task 3: Extend Bala Image Generation Into Four Operation Review Batches

**Files:**
- Modify: `core/api_server.py`
- Modify: `adapters/bala-ai-video-assistant/manifest.yaml`
- Modify: `adapters/bala-ai-video-assistant/bala-ai-face-background-generate.js`
- Modify: `tests/test_bala_ai_video_assistant_packaging.py`
- Modify: `tests/bala-ai-video-assistant-face-background.test.js`

**Interfaces:**
- Consumes: Task 2 `core.bala_ai_video_review.build_review_batch` and `save_review_batch`.
- Produces: `bala_ai_face_background_generate` rows containing `操作类型`, `服装图文件`, `搭配参考图文件`, `同款不同色参考图文件`, `姿势Prompt`, `审批批次UID`, `审批看板`, and `下一步Provider`.
- Produces: task instance summary fields `bala_review_batch_id`, `bala_review_token`, `bala_review_board_url`.

- [ ] **Step 1: Add failing JS preflight tests**

Extend `tests/bala-ai-video-assistant-face-background.test.js`:

```js
test('buildPlanRows validates four AI operation types independently', async () => {
  const helpers = await loadExports()

  const faceRows = helpers.buildPlanRows({
    operation_type: 'face_swap',
    source_images: { paths: ['/tmp/source.jpg'] },
    model_ref_ids: '100女/标准.jpg',
    background_prompt: '',
  })
  assert.equal(faceRows[0]['操作类型'], 'AI换脸')
  assert.equal(faceRows[0]['指定模特图'], '100女/标准.jpg')
  assert.equal(faceRows[0]['执行结果'], '待后端创建AI生图任务')

  const backgroundRows = helpers.buildPlanRows({
    operation_type: 'background_swap',
    source_images: { paths: ['/tmp/source.jpg'] },
    model_groups: [],
    background_prompt: '换成马尔代夫的海边',
  })
  assert.equal(backgroundRows[0]['操作类型'], 'AI换背景')
  assert.equal(backgroundRows[0]['背景Prompt'], '换成马尔代夫的海边')
  assert.equal(backgroundRows[0]['执行结果'], '待后端创建AI生图任务')

  const outfitRows = helpers.buildPlanRows({
    operation_type: 'outfit_swap',
    source_images: { paths: ['/tmp/model.jpg'] },
    garment_images: { paths: ['/tmp/garment.jpg'] },
    outfit_reference_images: { paths: ['/tmp/outfit.jpg'] },
    variant_reference_images: { paths: ['/tmp/variant.jpg'] },
    prompt_extra: '保留童装版型和颜色',
  })
  assert.equal(outfitRows[0]['操作类型'], 'AI换装')
  assert.equal(outfitRows[0]['服装图文件'], '/tmp/garment.jpg')
  assert.equal(outfitRows[0]['搭配参考图文件'], '/tmp/outfit.jpg')
  assert.equal(outfitRows[0]['同款不同色参考图文件'], '/tmp/variant.jpg')

  const poseRows = helpers.buildPlanRows({
    operation_type: 'pose_swap',
    source_images: { paths: ['/tmp/model.jpg'] },
    pose_prompt: '让模特自然侧身行走',
  })
  assert.equal(poseRows[0]['操作类型'], 'AI换姿势')
  assert.equal(poseRows[0]['姿势Prompt'], '让模特自然侧身行走')

  const invalidRows = helpers.buildPlanRows({
    operation_type: 'background_swap',
    source_images: { paths: ['/tmp/source.jpg'] },
    background_prompt: '',
  })
  assert.equal(invalidRows[0]['执行结果'], '缺少背景Prompt')
})
```

Run:

```bash
node --test tests/bala-ai-video-assistant-face-background.test.js
```

Expected: fail because `operation_type` only supports the previous combined behavior.

- [ ] **Step 2: Add failing Python generation test**

Extend `tests/test_bala_ai_video_assistant_packaging.py`:

```python
def test_apply_background_swap_creates_review_batch_without_model_asset(self):
    async def wait_for_control(_status=None):
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        data_root = base / "data"
        source = base / "208326100202" / "01_模拍原图" / "source.png"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"\x89PNG\r\n\x1a\n")

        with patch.dict("os.environ", {"CRAWSHRIMP_DATA": str(data_root)}, clear=False):
            runtime_paths.reset_runtime_data_root_cache()
            data_sink.init_db()
            rows = asyncio.run(_apply_bala_ai_face_background_generate(
                {
                    "operation_type": "background_swap",
                    "source_images": {"paths": [str(source)]},
                    "background_prompt": "换成马尔代夫的海边",
                    "generation_mode": "create_only",
                    "review_mode": "create_review_batch",
                    "approval_base_url": "http://127.0.0.1:18765",
                },
                wait_for_control,
                lambda _message: None,
            ))

            assert rows[0]["操作类型"] == "AI换背景"
            assert rows[0]["模特ID"] == ""
            assert rows[0]["审批批次UID"]
            assert rows[0]["审批看板"].startswith("http://127.0.0.1:18765/bala-ai-video-review/")
            assert rows[0]["下一步Provider"] == "qn_img2video"

        runtime_paths.reset_runtime_data_root_cache()
```

Add a second Python test in the same file:

```python
def test_apply_outfit_swap_creates_review_batch_with_outfit_references(self):
    async def wait_for_control(_status=None):
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        base = Path(tmpdir)
        data_root = base / "data"
        source = base / "208326100202" / "01_模拍原图" / "source.png"
        garment = base / "refs" / "garment.png"
        outfit = base / "refs" / "outfit.png"
        variant = base / "refs" / "variant.png"
        for path in [source, garment, outfit, variant]:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"\x89PNG\r\n\x1a\n")

        with patch.dict("os.environ", {"CRAWSHRIMP_DATA": str(data_root)}, clear=False):
            runtime_paths.reset_runtime_data_root_cache()
            data_sink.init_db()
            rows = asyncio.run(_apply_bala_ai_face_background_generate(
                {
                    "operation_type": "outfit_swap",
                    "source_images": {"paths": [str(source)]},
                    "garment_images": {"paths": [str(garment)]},
                    "outfit_reference_images": {"paths": [str(outfit)]},
                    "variant_reference_images": {"paths": [str(variant)]},
                    "prompt_extra": "保留童装版型和颜色",
                    "generation_mode": "create_only",
                    "review_mode": "create_review_batch",
                    "approval_base_url": "http://127.0.0.1:18765",
                },
                wait_for_control,
                lambda _message: None,
            ))

            assert rows[0]["操作类型"] == "AI换装"
            assert rows[0]["服装图文件"] == str(garment)
            assert rows[0]["搭配参考图文件"] == str(outfit)
            assert rows[0]["同款不同色参考图文件"] == str(variant)
            assert rows[0]["审批批次UID"]

        runtime_paths.reset_runtime_data_root_cache()
```

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_assistant_packaging.py::BalaAiVideoAssistantPackagingTests::test_apply_background_swap_creates_review_batch_without_model_asset -q
```

Expected: fail until backend is updated.

- [ ] **Step 3: Update manifest params and output columns**

In `adapters/bala-ai-video-assistant/manifest.yaml`, add these params under `bala_ai_face_background_generate`:

```yaml
      - id: operation_type
        type: radio
        label: AI 处理类型
        default: face_swap
        options:
          - value: face_swap
            label: AI 换脸
          - value: background_swap
            label: AI 换背景
          - value: outfit_swap
            label: AI 换装
          - value: pose_swap
            label: AI 换姿势
        hint: 四个能力独立执行；换脸通过可视化模特素材库弹窗选择，换背景需要背景 Prompt，换装需要服装/搭配参考图，换姿势需要姿势 Prompt
      - id: model_ref_ids
        type: textarea
        label: 已选模特素材
        rows: 4
        placeholder: "由工作流弹窗回填，例如：\n100女/标准.jpg\n73男/微笑.jpg"
        hint: 工作流中不手填；由 AI 模特素材库弹窗按年龄和性别筛选后回填。直接使用原子脚本时可手动粘贴模型 ID。
      - id: garment_images
        type: file_images
        label: 换装服装图
        max: 12
        hint: AI 换装使用，可上传服装图或从上一步下载的细节/平拍图中选择
      - id: outfit_reference_images
        type: file_images
        label: 搭配参考图
        max: 12
        hint: AI 换装使用，用于表达整体搭配关系
      - id: variant_reference_images
        type: file_images
        label: 同款不同色参考图
        max: 12
        hint: AI 换装使用，从已下载的同款不同色图片中选择
      - id: pose_prompt
        type: textarea
        label: 换姿势 Prompt
        rows: 3
        placeholder: "例如：让模特自然侧身行走，保留服装版型和颜色"
      - id: prompt_cards
        type: json
        label: Prompt 卡片
        hint: 工作流抽屉从 Prompt 库选择后回填；每张卡片包含 title、prompt、count
      - id: review_mode
        type: select
        label: 结果处理
        default: create_review_batch
        options:
          - value: create_review_batch
            label: 生成后进入审核池
          - value: create_only
            label: 只创建 AI 生图任务
        hint: 工作流推荐进入审核池，审核通过后再进入视频阶段
      - id: video_provider
        type: select
        label: 下一步视频方式
        default: qn_img2video
        options:
          - value: qn_img2video
            label: 软件管家图生视频
        hint: 当前接软件管家；字段命名保持 provider 边界，便于增加其他平台或 API
```

Add output columns:

```yaml
          - 操作类型
          - 模特图文件
          - 服装图文件
          - 搭配参考图文件
          - 同款不同色参考图文件
          - 姿势Prompt
          - 审批批次UID
          - 审批看板
          - 下一步Provider
```

- [ ] **Step 4: Update JS preflight script**

In `adapters/bala-ai-video-assistant/bala-ai-face-background-generate.js`, add:

```js
  function normalizeOperationType(value) {
    const text = compact(value).toLowerCase()
    if (['background_swap', 'background', '换背景'].includes(text)) return 'background_swap'
    if (['outfit_swap', 'outfit', '换装'].includes(text)) return 'outfit_swap'
    if (['pose_swap', 'pose', '换姿势'].includes(text)) return 'pose_swap'
    return 'face_swap'
  }

  function operationLabel(value) {
    const type = normalizeOperationType(value)
    if (type === 'background_swap') return 'AI换背景'
    if (type === 'outfit_swap') return 'AI换装'
    if (type === 'pose_swap') return 'AI换姿势'
    return 'AI换脸'
  }
```

Update `buildPlanRows` so:

- `face_swap` requires at least one `model_ref_ids` item from the visual model-library picker; `model_groups` remains a direct atomic-script fallback, not the workflow's primary UI.
- `background_swap` requires `background_prompt`.
- `background_swap` does not report missing model groups.
- `outfit_swap` requires `garment_images.paths` and at least one selected source image.
- `pose_swap` requires `pose_prompt` or one `prompt_cards[].prompt`.
- rows include `操作类型`, `服装图文件`, `搭配参考图文件`, `同款不同色参考图文件`, `姿势Prompt`, `结果处理`, and `下一步Provider`.

- [ ] **Step 5: Update backend generation behavior**

In `core/api_server.py`:

- import `core.bala_ai_video_review`.
- let `background_prompt` be required only for `background_swap`.
- let selected model references be required only for `face_swap`; prefer explicit `model_ref_ids` from the picker, and use `model_groups` only when the atomic script is run directly without picker output.
- let `garment_images.paths` be required only for `outfit_swap`.
- let `pose_prompt` or `prompt_cards[].prompt` be required only for `pose_swap`.
- add `_bala_background_prompt(source_path, background_prompt, extra)` for background-only generation.
- add `_bala_outfit_prompt(source_path, garment_paths, outfit_reference_paths, variant_reference_paths, extra)` for outfit replacement generation.
- add `_bala_pose_prompt(source_path, pose_prompt, prompt_cards, extra)` for pose-change generation.
- set row fields `操作类型`, `模特图文件`, `服装图文件`, `搭配参考图文件`, `同款不同色参考图文件`, `姿势Prompt`, `审批批次UID`, `审批看板`, and `下一步Provider`.
- when `review_mode == "create_review_batch"`, call:

```python
batch = bala_ai_video_review.build_review_batch(
    rows,
    run_params,
    runtime_artifact_dir or str(runtime_paths.child_dir("bala-ai-video-review")),
    str((run_params or {}).get("approval_base_url") or f"http://127.0.0.1:{os.environ.get('CRAWSHRIMP_PORT', '18765')}").rstrip("/"),
)
bala_ai_video_review.save_review_batch(batch)
```

The task runner currently calls `_apply_bala_ai_face_background_generate(run_params, wait_for_control, log)` without `runtime_artifact_dir`; add a fourth optional argument:

```python
async def _apply_bala_ai_face_background_generate(run_params: dict, wait_for_control, log, runtime_artifact_dir: str = "") -> list[dict]:
```

and update the call site in `core/api_server.py` where `runtime_artifact_dir` is available.

- [ ] **Step 6: Update task instance summary**

In the task-run completion path near the existing `approval_board_urls` handling, add Bala review summary extraction:

```python
def _extract_bala_review_board_urls(data_rows: list) -> dict:
    for row in data_rows or []:
        if not isinstance(row, dict):
            continue
        board_url = str(row.get("审批看板") or "").strip()
        batch_id = str(row.get("审批批次UID") or "").strip()
        if board_url and batch_id:
            return {
                "bala_review_board_url": board_url,
                "bala_review_batch_id": batch_id,
            }
    return {}
```

Merge this into task-instance summary and `output_files` for `(adapter_id, task_id) == ("bala-ai-video-assistant", "bala_ai_face_background_generate")`.

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/bala-ai-video-assistant-face-background.test.js
python3 -m pytest tests/test_bala_ai_video_assistant_packaging.py -q
```

Expected: pass.

- [ ] **Step 8: Commit**

```bash
git add core/api_server.py adapters/bala-ai-video-assistant/manifest.yaml adapters/bala-ai-video-assistant/bala-ai-face-background-generate.js tests/test_bala_ai_video_assistant_packaging.py tests/bala-ai-video-assistant-face-background.test.js
git commit -m "feat: create Bala image review batches"
```

## Task 4: Add Bala Review API And Electron Bridge

**Files:**
- Modify: `core/api_server.py`
- Modify: `app/src/main.js`
- Modify: `app/src/preload.js`
- Test: `tests/test_bala_ai_video_review_api.py`

**Interfaces:**
- Consumes: Task 2 review-batch JSON.
- Produces backend routes:
  - `GET /bala-ai-video-review/api/{batch_id}`
  - `GET /bala-ai-video-review/api/{batch_id}/image/{asset_id}`
  - `POST /bala-ai-video-review/api/{batch_id}/decisions`
  - `POST /bala-ai-video-review/api/{batch_id}/refresh`
  - `POST /bala-ai-video-review/api/{batch_id}/regenerate`
  - `POST /bala-ai-video-review/api/{batch_id}/export-video-input`
  - `GET /bala-ai-video-review/{batch_id}`
- Produces renderer bridge methods with matching names prefixed by `Bala`.

- [ ] **Step 1: Write failing API tests**

Create `tests/test_bala_ai_video_review_api.py`:

```python
import json
from pathlib import Path

from fastapi.testclient import TestClient

from core.api_server import app
from core import bala_ai_video_review as review


def test_bala_review_decisions_and_export_video_input(tmp_path, monkeypatch):
    image = tmp_path / "ai.png"
    image.write_bytes(b"\x89PNG\r\n\x1a\n")
    batch = {
        "batch_id": "bala-api-test",
        "token": "token-test",
        "workflow": "bala_ai_video_image_review",
        "status": "pending_approval",
        "artifact_dir": str(tmp_path),
        "video_provider": "qn_img2video",
        "items": [{
            "style_code": "208326100202",
            "assets": [
                {"id": "ai-1", "kind": "ai", "path": str(image), "status": "pending", "operation_type": "face_swap"},
            ],
        }],
    }
    review.save_review_batch(batch)
    client = TestClient(app)

    decisions = client.post(
        "/bala-ai-video-review/api/bala-api-test/decisions?token=token-test",
        json={"decisions": {"ai-1": {"status": "approved"}}},
    )
    assert decisions.status_code == 200
    assert decisions.json()["status"] in {"pending_approval", "ready_for_video"}

    exported = client.post(
        "/bala-ai-video-review/api/bala-api-test/export-video-input?token=token-test",
        json={"provider": "qn_img2video", "output_dir": str(tmp_path / "video")},
    )
    assert exported.status_code == 200
    payload = exported.json()
    assert payload["provider"] == "qn_img2video"
    assert Path(payload["manifest_path"]).is_file()
    assert payload["next_task"]["adapter_id"] == "bala-ai-video-assistant"
    assert payload["next_task"]["task_id"] == "qn_img2video_batch"
    assert payload["next_task"]["params"]["material_images"]["paths"]
```

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_review_api.py -q
```

Expected: fail because routes do not exist.

- [ ] **Step 2: Add request models**

In `core/api_server.py`, add:

```python
class BalaReviewDecisionsRequest(BaseModel):
    decisions: dict = {}


class BalaReviewRegenerateRequest(BaseModel):
    asset_id: str
    prompt: Optional[str] = ""
    operation_type: Optional[str] = ""
    background_prompt: Optional[str] = ""
    model_id: Optional[str] = ""
    garment_images: dict = {}
    outfit_reference_images: dict = {}
    variant_reference_images: dict = {}
    pose_prompt: Optional[str] = ""
    prompt_cards: list = []


class BalaReviewExportVideoInputRequest(BaseModel):
    provider: str = "qn_img2video"
    output_dir: str = ""
    template_id: str = ""
    template_match: str = ""
    prompt: str = ""
```

- [ ] **Step 3: Add backend routes**

Add routes after the Tmall approval routes or in the same API section:

```python
@app.get("/bala-ai-video-review/api/{batch_id}")
def get_bala_ai_video_review_batch(batch_id: str, token: str = ""):
    batch = bala_ai_video_review.load_review_batch(batch_id)
    bala_ai_video_review.validate_token(batch, token)
    return batch
```

The route implementations must:

- use `bala_ai_video_review.load_review_batch`.
- validate token with constant-time comparison.
- return image assets with `FileResponse`.
- update decisions and save batch.
- refresh generated assets by reading `data_sink.get_ai_image_job(job_uid)` summaries.
- regenerate by creating a new AI image job/run based on the rejected asset lineage, preserving `operation_type`, source image, and operation-specific references for face swap, background swap, outfit swap, and pose swap.
- export approved assets and return:

```json
{
  "ok": true,
  "provider": "qn_img2video",
  "manifest_path": "/absolute/video_input_manifest.json",
  "images": ["/absolute/approved.png"],
  "next_task": {
    "adapter_id": "bala-ai-video-assistant",
    "task_id": "qn_img2video_batch",
    "params": {
      "execute_mode": "plan",
      "material_images": {"paths": ["/absolute/approved.png"]},
      "download_template_previews": true,
      "download_videos": true
    }
  }
}
```

- [ ] **Step 4: Add Electron IPC bridge**

In `app/src/main.js`, add secure handlers:

```js
secureHandle('get-bala-review-batch', async (_, batchId, token) => {
  return apiCall('GET', `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}?token=${encodeURIComponent(String(token || ''))}`)
})

secureHandle('save-bala-review-decisions', async (_, batchId, token, decisions) => {
  return apiCall('POST', `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}/decisions?token=${encodeURIComponent(String(token || ''))}`, { decisions: decisions || {} })
})

secureHandle('refresh-bala-review-batch', async (_, batchId, token) => {
  return apiCall('POST', `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}/refresh?token=${encodeURIComponent(String(token || ''))}`, {})
})

secureHandle('regenerate-bala-review-asset', async (_, batchId, token, payload) => {
  return apiCall('POST', `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}/regenerate?token=${encodeURIComponent(String(token || ''))}`, payload || {}, { timeoutMs: 20 * 60 * 1000 })
})

secureHandle('export-bala-video-input', async (_, batchId, token, payload) => {
  return apiCall('POST', `/bala-ai-video-review/api/${encodeURIComponent(String(batchId || ''))}/export-video-input?token=${encodeURIComponent(String(token || ''))}`, payload || {}, { timeoutMs: 5 * 60 * 1000 })
})
```

In `app/src/preload.js`, expose:

```js
getBalaReviewBatch: (batchId, token) => ipcRenderer.invoke('get-bala-review-batch', batchId, token),
saveBalaReviewDecisions: (batchId, token, decisions) => ipcRenderer.invoke('save-bala-review-decisions', batchId, token, decisions),
refreshBalaReviewBatch: (batchId, token) => ipcRenderer.invoke('refresh-bala-review-batch', batchId, token),
regenerateBalaReviewAsset: (batchId, token, payload) => ipcRenderer.invoke('regenerate-bala-review-asset', batchId, token, payload),
exportBalaVideoInput: (batchId, token, payload) => ipcRenderer.invoke('export-bala-video-input', batchId, token, payload),
```

- [ ] **Step 5: Run API tests**

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_review.py tests/test_bala_ai_video_review_api.py -q
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add core/api_server.py app/src/main.js app/src/preload.js tests/test_bala_ai_video_review_api.py
git commit -m "feat: expose Bala image review API"
```

## Task 5: Add Unified Bala Image Review Drawer

**Files:**
- Modify: `app/src/renderer/utils/balaAiVideoWorkflow.js`
- Create: `app/src/renderer/views/BalaAiImageReviewDrawer.vue`
- Modify: `app/src/renderer/views/TaskRunner.vue`
- Test: `tests/bala-ai-video-workflow-ui.test.js`

**Interfaces:**
- Consumes: Task 4 `window.cs.*Bala*` bridge methods.
- Produces: Vue event `start-video-stage` with `{ adapterId, taskId, params }`.
- Produces: visible workflow steps for素材找图, 素材挑选, AI 生图, 图片审核, 视频模板, 视频生成, 视频结果.

- [ ] **Step 1: Add utility tests**

Create `tests/bala-ai-video-workflow-ui.test.js`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBalaAiStageRequest,
  parseBalaReviewUrl,
  summarizeBalaReviewBatch,
  buildBalaVideoStageRequest,
} from '../app/src/renderer/utils/balaAiVideoWorkflow.js'

test('parseBalaReviewUrl reads batch id and token', () => {
  const parsed = parseBalaReviewUrl('http://127.0.0.1:18765/bala-ai-video-review/bala-1?token=abc')
  assert.equal(parsed.batchId, 'bala-1')
  assert.equal(parsed.token, 'abc')
})

test('summarizeBalaReviewBatch counts pending approved rejected assets', () => {
  const summary = summarizeBalaReviewBatch({
    items: [{
      assets: [
        { kind: 'ai', status: 'approved' },
        { kind: 'ai', status: 'rejected' },
        { kind: 'ai', status: 'pending' },
      ],
    }],
  })
  assert.deepEqual(summary, { total: 3, approved: 1, rejected: 1, pending: 1, generating: 0 })
})

test('buildBalaVideoStageRequest targets qn_img2video_batch', () => {
  const request = buildBalaVideoStageRequest({
    next_task: {
      adapter_id: 'bala-ai-video-assistant',
      task_id: 'qn_img2video_batch',
      params: {
        execute_mode: 'plan',
        material_images: { paths: ['/tmp/a.png'] },
      },
    },
  })
  assert.equal(request.adapterId, 'bala-ai-video-assistant')
  assert.equal(request.taskId, 'qn_img2video_batch')
  assert.deepEqual(request.params.material_images.paths, ['/tmp/a.png'])
})
```

Run:

```bash
node --test tests/bala-ai-video-workflow-ui.test.js
```

Expected: fail because utility file does not exist.

- [ ] **Step 2: Extend workflow utility**

Extend `app/src/renderer/utils/balaAiVideoWorkflow.js`:

```js
export function buildBalaAiStageRequest(exportResult) {
  const next = exportResult?.next_task || {}
  return {
    adapterId: String(next.adapter_id || 'bala-ai-video-assistant'),
    taskId: String(next.task_id || 'bala_ai_face_background_generate'),
    params: next.params || {},
  }
}

export function parseBalaReviewUrl(url) {
  try {
    const parsed = new URL(String(url || ''))
    const parts = parsed.pathname.split('/').filter(Boolean)
    return {
      origin: parsed.origin || 'http://127.0.0.1:18765',
      batchId: parts[parts.length - 1] || '',
      token: parsed.searchParams.get('token') || '',
    }
  } catch {
    return { origin: 'http://127.0.0.1:18765', batchId: '', token: '' }
  }
}

export function summarizeBalaReviewBatch(batch) {
  const assets = (batch?.items || []).flatMap(item => item?.assets || []).filter(asset => asset?.kind === 'ai')
  return {
    total: assets.length,
    approved: assets.filter(asset => asset.status === 'approved').length,
    rejected: assets.filter(asset => asset.status === 'rejected').length,
    pending: assets.filter(asset => !['approved', 'rejected', 'generating'].includes(String(asset.status || ''))).length,
    generating: assets.filter(asset => String(asset.status || '') === 'generating').length,
  }
}

export function buildBalaVideoStageRequest(exportResult) {
  const next = exportResult?.next_task || {}
  return {
    adapterId: String(next.adapter_id || 'bala-ai-video-assistant'),
    taskId: String(next.task_id || 'qn_img2video_batch'),
    params: next.params || {},
  }
}
```

- [ ] **Step 3: Build review drawer**

Create `app/src/renderer/views/BalaAiImageReviewDrawer.vue` with:

- props: `modelValue`, `boardUrl`.
- emits: `update:modelValue`, `batch-updated`, `start-video-stage`.
- methods:
  - `reload()`: call `window.cs.getBalaReviewBatch`.
  - `refreshResults()`: call `window.cs.refreshBalaReviewBatch`.
  - `setAssetStatus(asset, status)`: local patch.
  - `saveDecisions()`: call `window.cs.saveBalaReviewDecisions`.
  - `regenerateAsset(asset)`: call `window.cs.regenerateBalaReviewAsset`.
  - `exportToVideo()`: call `window.cs.exportBalaVideoInput`, then emit `start-video-stage`.
- layout:
  - top stepper: `素材找图`, `素材挑选`, `AI 生图`, `图片审核`, `视频模板`, `视频生成`, `视频结果`.
  - left list:款号 and status counts.
  - middle comparison: source/reference/generated image, showing outfit and pose references when the operation uses them.
  - right controls: approve, reject, prompt edit, retry, export to video.

Use neutral task-tool styling, not a marketing page.

- [ ] **Step 4: Integrate drawer into TaskRunner**

In `app/src/renderer/views/TaskRunner.vue`:

- import `BalaAiImageReviewDrawer`.
- add emit `open-task`:

```js
const emit = defineEmits(['status-change', 'instance-updated', 'open-task'])
```

- add identity helpers:

```js
function isBalaAiImageTaskIdentity(adapterId, task) {
  return adapterId === 'bala-ai-video-assistant' && task?.task_id === 'bala_ai_face_background_generate'
}
```

- add refs:

```js
const balaReviewBoardUrl = ref('')
const balaReviewDrawerOpen = ref(false)
const balaReviewBatch = ref(null)
```

- after task completion, read `审批看板` from rows and set `balaReviewBoardUrl`.
- render drawer:

```vue
<BalaAiImageReviewDrawer
  v-model="balaReviewDrawerOpen"
  :board-url="balaReviewBoardUrl"
  @batch-updated="batch => { balaReviewBatch = batch }"
  @start-video-stage="request => emit('open-task', request)"
/>
```

- add an action button near outputs for Bala image task:

```vue
<button
  v-if="isBalaAiImageTask && balaReviewBoardUrl"
  type="button"
  class="primary-btn"
  @click="balaReviewDrawerOpen = true"
>
  打开 AI 图审核池
</button>
```

- [ ] **Step 5: Run UI utility tests**

Run:

```bash
node --test tests/bala-ai-video-workflow-ui.test.js
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add app/src/renderer/utils/balaAiVideoWorkflow.js app/src/renderer/views/BalaAiImageReviewDrawer.vue app/src/renderer/views/TaskRunner.vue tests/bala-ai-video-workflow-ui.test.js
git commit -m "feat: add Bala image review drawer"
```

## Task 6: Wire Review Approval Into Software-Manager Video Generation

**Files:**
- Modify: `app/src/renderer/App.vue`
- Modify: `app/src/renderer/views/TaskRunner.vue`
- Modify: `app/src/renderer/utils/balaAiVideoWorkflow.js`
- Test: `tests/bala-ai-video-workflow-ui.test.js`

**Interfaces:**
- Consumes: Task 5 `start-video-stage` event.
- Produces: `App.vue` method `openScriptTask({ adapterId, taskId, params })`.
- Produces: `TaskRunner` initialized with params for `qn_img2video_batch`.
- Produces: workflow UX where approving images can immediately open the video stage with selected image paths already filled.
- Preserves: `qn_img2video_batch` template catalog rows with title, description, preview URL, local preview file, custom prompt, generated video download path, and result feedback rows.

- [ ] **Step 1: Extend utility test for template and prompt handoff**

Add to `tests/bala-ai-video-workflow-ui.test.js`:

```js
test('buildBalaVideoStageRequest preserves template and prompt params', () => {
  const request = buildBalaVideoStageRequest({
    next_task: {
      adapter_id: 'bala-ai-video-assistant',
      task_id: 'qn_img2video_batch',
      params: {
        execute_mode: 'plan',
        material_images: { paths: ['/tmp/a.png', '/tmp/b.png'] },
        template_id: 'tpl-1',
        template_match: '领口',
        prompt: '自然走动',
        download_template_previews: true,
      },
    },
  })
  assert.equal(request.params.template_id, 'tpl-1')
  assert.equal(request.params.template_match, '领口')
  assert.equal(request.params.prompt, '自然走动')
  assert.equal(request.params.download_template_previews, true)
})
```

- [ ] **Step 2: Add App-level task handoff**

In `app/src/renderer/App.vue`, add state:

```js
const taskRunnerInitialParams = ref({})
```

Pass it to `TaskRunner`:

```vue
<TaskRunner
  v-else-if="activeScript && activeTaskId"
  :adapter-id="activeScript.adapter_id"
  :task="activeScript.tasks.find(t => t.task_id === activeTaskId)"
  :initial-params="taskRunnerInitialParams"
  @status-change="onTaskStatusChange"
  @open-task="openScriptTask"
/>
```

Add:

```js
function openScriptTask(request) {
  const adapterId = String(request?.adapterId || request?.adapter_id || '').trim()
  const taskId = String(request?.taskId || request?.task_id || '').trim()
  if (!adapterId || !taskId) return
  const group = scriptGroups.value.find(item => item.adapter_id === adapterId)
  if (!group) return
  activeScript.value = group
  activeTaskId.value = taskId
  taskRunnerInitialParams.value = JSON.parse(JSON.stringify(request.params || {}))
  currentView.value = 'scripts'
}
```

When users manually click a sidebar task, reset `taskRunnerInitialParams` to `{}` before setting `activeTaskId`.

- [ ] **Step 3: Ensure TaskRunner applies changed initial params**

In `TaskRunner.vue`, make the `initialParams` watcher run when the adapter id, task id, or initial params change. Add or replace the watcher with:

```js
watch(() => [props.adapterId, props.task?.task_id, props.initialParams], () => {
  values.value = buildDefaultValues(props.task?.params || [])
  applyInitialParams(props.initialParams || {})
}, { deep: true })
```

Use existing `applyInitialParams` behavior if the component already has it; do not duplicate parameter normalization.

- [ ] **Step 4: Make video handoff explicit in the drawer**

In `BalaAiImageReviewDrawer.vue`, the `exportToVideo()` method should send:

```js
const payload = {
  provider: 'qn_img2video',
  output_dir: videoOutputDir.value,
  template_id: templateId.value,
  template_match: templateMatch.value,
  prompt: videoPrompt.value,
}
const result = await window.cs.exportBalaVideoInput(ref.batchId, ref.token, payload)
emit('start-video-stage', buildBalaVideoStageRequest(result))
```

The UI must show:

- approved image count.
- template ID field.
- template keyword field.
- video prompt field.
- "进入软件管家图生视频" button.

Template preview videos are not selected in this drawer; they are downloaded and displayed by `qn_img2video_batch` in catalog/plan mode. After the drawer emits `start-video-stage`, the operator lands on the `qn_img2video_batch` task with approved images filled in, then chooses a template using the task's local preview files and title/description rows.

- [ ] **Step 5: Verify video-stage initial params match the workflow contract**

Run `qn_img2video_batch` in `catalog` mode after entering from the review drawer. Confirm the task values contain:

```json
{
  "execute_mode": "plan",
  "material_images": {"paths": ["/absolute/approved-image.png"]},
  "download_template_previews": true,
  "download_videos": true,
  "prompt": "自然走动，突出童装穿搭氛围"
}
```

Expected result rows must include template metadata and local preview fields:

```json
{
  "模板ID": "template-id",
  "模板标题": "template-title",
  "模板描述": "template-description",
  "模板预览视频": "https://example.com/template-preview.mp4",
  "模板预览本地文件": "/absolute/path/to/template-preview.mp4"
}
```

Run in `plan` or `live` mode after choosing the template. Expected generated-video rows must include:

```json
{
  "源图文件": "/absolute/approved-image.png",
  "模板ID": "template-id",
  "视频Prompt": "自然走动，突出童装穿搭氛围",
  "生成状态": "success",
  "视频本地文件": "/absolute/path/to/generated-video.mp4"
}
```

- [ ] **Step 6: Run UI tests**

Run:

```bash
node --test tests/bala-ai-video-workflow-ui.test.js
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add app/src/renderer/App.vue app/src/renderer/views/TaskRunner.vue app/src/renderer/views/BalaAiImageReviewDrawer.vue app/src/renderer/utils/balaAiVideoWorkflow.js tests/bala-ai-video-workflow-ui.test.js
git commit -m "feat: hand off Bala approved images to video task"
```

## Task 7: End-To-End Validation And Documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-07-14-bala-ai-video-automation-workflow.md`
- Test: existing Bala Python and Node tests.

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: validation notes and a stable local workflow:
  `semir_video_material_prepare` -> Bala material selection drawer -> `bala_ai_face_background_generate` -> Bala image review drawer -> `qn_img2video_batch`.

- [ ] **Step 1: Update workflow spec**

In `docs/superpowers/specs/2026-07-14-bala-ai-video-automation-workflow.md`, update the MVP 1, MVP 2, and MVP 3 sections with:

```markdown
MVP 1 now starts from `semir_video_material_prepare`: operators batch-enter style codes,
download Semir cloud-drive model/detail images, review the downloaded image grid, and select
the images that continue into AI generation.

MVP 2 now uses four independent GPT Image operations: `face_swap`, `background_swap`,
`outfit_swap`, and `pose_swap`. All four operations write into a unified Bala AI image review
batch. The review batch is the human gate: operators approve, reject, retry, and export
approved images.

MVP 3 consumes the approved-image manifest from the review batch. The first provider is
`qn_img2video_batch`, which keeps template catalog, template title/description, local
preview download, custom video prompt, generation polling, video download, and result
feedback as a separate atomic capability.
```

- [ ] **Step 2: Run Python tests**

Run:

```bash
python3 -m pytest tests/test_bala_ai_video_materials.py tests/test_bala_ai_video_review.py tests/test_bala_ai_video_review_api.py tests/test_bala_ai_video_assistant_packaging.py -q
```

Expected: all pass.

- [ ] **Step 3: Run Node tests**

Run:

```bash
node --test tests/bala-ai-video-assistant-face-background.test.js tests/bala-ai-video-assistant-qn-img2video.test.js tests/bala-ai-video-workflow-ui.test.js
```

Expected: all pass.

- [ ] **Step 4: Run syntax and whitespace checks**

Run:

```bash
node --check adapters/bala-ai-video-assistant/bala-ai-face-background-generate.js
node --check adapters/bala-ai-video-assistant/qn-img2video-batch.js
git diff --check
```

Expected: all pass.

- [ ] **Step 5: Manual workflow smoke**

Use one or two real style codes that already have Semir cloud-drive material:

1. Run `semir_video_material_prepare` with batch style-code input.
2. Confirm the material selection drawer opens and shows downloaded `模拍图` and `商品细节图` by款号.
3. Select one or more模拍图 as AI source images.
4. Choose `AI 换脸`, open `选择 AI 模特素材`, filter `幼童` + `女`, select `100女/标准.jpg`, confirm the selected model thumbnail strip is visible, then click "进入 AI 生图".
5. Confirm TaskRunner switches to `bala_ai_face_background_generate` with `operation_type=face_swap`, `source_images.paths`, and `model_ref_ids=100女/标准.jpg` populated.
6. Run the AI task with `review_mode=create_review_batch`.
7. Open the Bala image review drawer from TaskRunner.
8. Click refresh until generated assets appear or confirm placeholder status is visible.
9. Approve one image.
10. Click "进入软件管家图生视频".
11. Confirm TaskRunner switches to `qn_img2video_batch` with `material_images.paths` populated.
12. Run `plan` with `download_template_previews=true`.
13. Confirm template previews download locally and result rows include `模板标题`, `模板描述`, and `模板预览本地文件`.
14. Choose a template, enter a custom video prompt, run `plan` or `live`, and confirm generated-video rows include `视频Prompt`, `生成状态`, and `视频本地文件`.

Record the output paths in the final implementation summary.

- [ ] **Step 6: Commit**

```bash
git add docs/superpowers/specs/2026-07-14-bala-ai-video-automation-workflow.md
git commit -m "docs: document Bala image review workflow"
```

## Self-Review

- Spec coverage: The plan covers Semir cloud-drive material search, downloaded-image review/selection, independent face swap, background swap, outfit swap, and pose swap generation, unified generated-image review, retry/re-run, approved-image export, direct handoff to software-manager video generation, template preview support through `qn_img2video_batch`, and provider extensibility.
- Placeholder scan: No unresolved placeholders are present; every task names exact files, commands, expected behavior, and commit scope.
- Type consistency: The plan consistently uses `batch_id`, `token`, `board_url`, `operation_type`, `video_provider`, `next_task`, `material_images.paths`, and `qn_img2video_batch`.
- Scope check: The plan intentionally excludes automatic editing, publishing, DingTalk writeback, and effect recovery. Those remain separate workflow stages after the image-review and video-generation handoff is stable.
