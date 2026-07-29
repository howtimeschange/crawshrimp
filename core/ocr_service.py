"""Shared OCR and text-box localization helpers."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class OcrWord:
    text: str
    bbox: tuple[float, float, float, float]
    confidence: float = 0.0


def _text(value: Any) -> str:
    return str(value or "").strip()


def _digits(value: Any) -> str:
    return re.sub(r"\D+", "", _text(value))


def normalized_bbox(value: Any) -> tuple[float, float, float, float] | None:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        return None
    try:
        values = tuple(max(0.0, min(1.0, float(item))) for item in value)
    except (TypeError, ValueError):
        return None
    if values[2] <= values[0] or values[3] <= values[1]:
        return None
    return values


def _to_pixel_bbox(
    bbox: tuple[float, float, float, float],
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    return (
        bbox[0] * width,
        bbox[1] * height,
        bbox[2] * width,
        bbox[3] * height,
    )


def _from_pixel_bbox(
    bbox: tuple[float, float, float, float],
    width: int,
    height: int,
) -> tuple[float, float, float, float]:
    x1, y1, x2, y2 = bbox
    return (
        max(0.0, min(1.0, x1 / max(1, width))),
        max(0.0, min(1.0, y1 / max(1, height))),
        max(0.0, min(1.0, x2 / max(1, width))),
        max(0.0, min(1.0, y2 / max(1, height))),
    )


def _smooth(values: list[float], radius: int = 3) -> list[float]:
    if not values:
        return []
    size = radius * 2 + 1
    smoothed: list[float] = []
    running = 0.0
    padded = [0.0] * radius + [float(value) for value in values] + [0.0] * radius
    for index, value in enumerate(padded):
        running += value
        if index >= size:
            running -= padded[index - size]
        if index >= size - 1:
            smoothed.append(running / size)
    return smoothed[: len(values)]


def _merge_segments(
    segments: list[tuple[int, int]],
    max_gap: int,
) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in segments:
        if merged and start - merged[-1][1] <= max_gap:
            previous_start, _previous_end = merged.pop()
            merged.append((previous_start, end))
        else:
            merged.append((start, end))
    return merged


def _dark_text_rows(image: Any, label_px: tuple[float, float, float, float]) -> list[dict[str, float]]:
    from PIL import Image

    x1, y1, x2, y2 = label_px
    crop = image.crop((round(x1), round(y1), round(x2), round(y2))).convert("L")
    if not crop.size[0] or not crop.size[1]:
        return []
    crop.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
    width, height = crop.size
    max_x = max(1, min(width, round(width * 0.62)))
    pixels = crop.load()
    row_counts: list[float] = []
    for row_y in range(height):
        count = 0
        for row_x in range(max_x):
            if pixels[row_x, row_y] < 110:
                count += 1
        row_counts.append(float(count))

    smoothed = _smooth(row_counts, radius=3)
    if not smoothed:
        return []
    threshold = max(4.0, max(smoothed) * 0.10)
    raw_segments: list[tuple[int, int]] = []
    start: int | None = None
    for index, value in enumerate(smoothed):
        if value >= threshold and start is None:
            start = index
        if (value < threshold or index == len(smoothed) - 1) and start is not None:
            end = index if value < threshold else index + 1
            if end - start >= 3:
                raw_segments.append((start, end))
            start = None
    segments = _merge_segments(raw_segments, max_gap=max(2, round(height * 0.004)))
    min_row_height = max(8, round(height * 0.025))
    rows: list[dict[str, float]] = []
    for start_y, end_y in segments:
        row_height = end_y - start_y
        if row_height < min_row_height or start_y < height * 0.045:
            continue
        dark_xs: list[int] = []
        for row_y in range(max(0, start_y - 1), min(height, end_y + 1)):
            for row_x in range(max_x):
                if pixels[row_x, row_y] < 110:
                    dark_xs.append(row_x)
        if not dark_xs:
            continue
        rows.append({
            "x1": min(dark_xs) / width,
            "y1": start_y / height,
            "x2": max(dark_xs) / width,
            "y2": end_y / height,
            "height": row_height / height,
        })
    return rows


def _row_overlap_score(
    row: dict[str, float],
    style_rel: tuple[float, float, float, float],
) -> float:
    overlap = max(0.0, min(row["y2"], style_rel[3]) - max(row["y1"], style_rel[1]))
    if overlap > 0:
        return overlap * 10.0
    row_center = (row["y1"] + row["y2"]) / 2
    style_center = (style_rel[1] + style_rel[3]) / 2
    return -abs(row_center - style_center)


def _top_center_style_row(
    image: Any,
    label_px: tuple[float, float, float, float],
    rows: list[dict[str, float]],
) -> dict[str, float] | None:
    lx1, _ly1, lx2, _ly2 = label_px
    label_width = max(1.0, lx2 - lx1)
    candidates: list[tuple[float, dict[str, float]]] = []
    for row in rows:
        if row["y1"] > 0.12 or row["y2"] > 0.24:
            continue
        bounds = _style_x_bounds_from_row(image, label_px, row, (0.0, 0.0, 1.0, 1.0))
        if bounds is None:
            continue
        rel_x1 = (bounds[0] - lx1) / label_width
        rel_x2 = (bounds[1] - lx1) / label_width
        center = (rel_x1 + rel_x2) / 2
        width = rel_x2 - rel_x1
        if 0.35 <= center <= 0.78 and 0.18 <= width <= 0.55:
            candidates.append((1.0 - abs(center - 0.56), row))
    if not candidates:
        return None
    return max(candidates, key=lambda item: item[0])[1]


def _style_x_bounds_from_row(
    image: Any,
    label_px: tuple[float, float, float, float],
    row: dict[str, float],
    style_rel: tuple[float, float, float, float],
) -> tuple[float, float] | None:
    lx1, ly1, lx2, ly2 = label_px
    label_width = max(1.0, lx2 - lx1)
    label_height = max(1.0, ly2 - ly1)
    row_y1 = ly1 + row["y1"] * label_height
    row_y2 = ly1 + row["y2"] * label_height
    row_height = max(1.0, row_y2 - row_y1)
    pad_y = row_height * 0.18
    crop = image.crop((
        round(lx1),
        round(max(0.0, row_y1 - pad_y)),
        round(lx2),
        round(min(float(image.size[1]), row_y2 + pad_y)),
    )).convert("L")
    width, height = crop.size
    if width <= 0 or height <= 0:
        return None
    pixels = crop.load()
    column_counts: list[float] = []
    for x in range(width):
        count = 0
        for y in range(height):
            if pixels[x, y] < 110:
                count += 1
        column_counts.append(float(count))
    smoothed = _smooth(column_counts, radius=2)
    if not smoothed:
        return None
    threshold = max(1.0, max(smoothed) * 0.12)
    raw_segments: list[tuple[int, int]] = []
    start: int | None = None
    for index, value in enumerate(smoothed):
        if value >= threshold and start is None:
            start = index
        if (value < threshold or index == len(smoothed) - 1) and start is not None:
            end = index if value < threshold else index + 1
            if end - start >= 2:
                raw_segments.append((start, end))
            start = None
    character_gap = max(12, round(row_height * 0.65))
    clusters = _merge_segments(raw_segments, max_gap=character_gap)
    if not clusters:
        return None

    style_x1, _style_y1, style_x2, _style_y2 = style_rel
    min_cluster_width = max(18.0, row_height * 2.6)
    scored: list[tuple[float, int, int]] = []
    for cluster_x1, cluster_x2 in clusters:
        cluster_width = cluster_x2 - cluster_x1
        if cluster_width < min_cluster_width:
            continue
        rel_x1 = cluster_x1 / width
        rel_x2 = cluster_x2 / width
        overlap = max(0.0, min(rel_x2, style_x2) - max(rel_x1, style_x1))
        center_distance = abs(((rel_x1 + rel_x2) / 2) - ((style_x1 + style_x2) / 2))
        score = overlap * 10.0 + min(cluster_width / max(1.0, width), 0.5) - center_distance
        scored.append((score, cluster_x1, cluster_x2))
    if not scored:
        return None
    _score, cluster_x1, cluster_x2 = max(scored, key=lambda item: item[0])
    pad_x = max(3.0, row_height * 0.12)
    return (
        max(lx1, lx1 + cluster_x1 - pad_x),
        min(lx2, lx1 + cluster_x2 + pad_x),
    )


def _style_bbox_from_ocr_words(
    *,
    words: list[OcrWord],
    style_code: str,
    image_width: int,
    image_height: int,
    label_bbox: tuple[float, float, float, float] | None,
) -> tuple[float, float, float, float] | None:
    target = _digits(style_code)
    if not target:
        return None
    matches = [
        word
        for word in words
        if _digits(word.text) == target
    ]
    if not matches:
        return None
    if label_bbox is not None:
        lx1, ly1, lx2, ly2 = _to_pixel_bbox(label_bbox, image_width, image_height)
        inside = [
            word
            for word in matches
            if word.bbox[0] >= lx1
            and word.bbox[1] >= ly1
            and word.bbox[2] <= lx2
            and word.bbox[3] <= ly2
        ]
        if inside:
            matches = inside
    x1 = min(word.bbox[0] for word in matches)
    y1 = min(word.bbox[1] for word in matches)
    x2 = max(word.bbox[2] for word in matches)
    y2 = max(word.bbox[3] for word in matches)
    return _from_pixel_bbox((x1, y1, x2, y2), image_width, image_height)


def refine_style_code_bbox(
    *,
    image: Any,
    label_bbox: Any,
    style_code_bbox: Any,
    style_code: str = "",
    ocr_words: list[OcrWord] | None = None,
) -> tuple[float, float, float, float] | None:
    """Return a corrected normalized bbox for the printed style-code text.

    The multimodal model is good at finding the shoe-box label, but it can
    confuse the product-name row with the style-code row. This helper keeps the
    OCR/model hint as the anchor, then corrects the row within the detected
    label using local text-line geometry.
    """

    width, height = image.size
    label = normalized_bbox(label_bbox)
    style = normalized_bbox(style_code_bbox)
    if ocr_words:
        ocr_match = _style_bbox_from_ocr_words(
            words=ocr_words,
            style_code=style_code,
            image_width=width,
            image_height=height,
            label_bbox=label,
        )
        if ocr_match is not None:
            return ocr_match
    if label is None or style is None:
        return style

    label_px = _to_pixel_bbox(label, width, height)
    rows = _dark_text_rows(image, label_px)
    if not rows:
        return style

    lx1, ly1, lx2, ly2 = label_px
    label_width = max(1.0, lx2 - lx1)
    label_height = max(1.0, ly2 - ly1)
    style_px = _to_pixel_bbox(style, width, height)
    style_rel = (
        (style_px[0] - lx1) / label_width,
        (style_px[1] - ly1) / label_height,
        (style_px[2] - lx1) / label_width,
        (style_px[3] - ly1) / label_height,
    )
    style_rel_width = style_rel[2] - style_rel[0]
    style_rel_height = style_rel[3] - style_rel[1]
    suspicious_style_anchor = style_rel_width > 0.72 or style_rel_height > 0.16
    top_center_row = _top_center_style_row(image, label_px, rows)
    if suspicious_style_anchor and top_center_row is not None:
        row_index = rows.index(top_center_row)
        row = top_center_row
    else:
        row_index, row = max(
            enumerate(rows),
            key=lambda item: _row_overlap_score(item[1], style_rel),
        )
    if (
        row_index == 0
        and row["y1"] > 0.10
        and len(rows) > 1
        and rows[1]["y1"] - row["y2"] <= 0.05
    ):
        row = rows[1]

    x1, _y1, x2, _y2 = style_px
    row_y1 = ly1 + row["y1"] * label_height
    row_y2 = ly1 + row["y2"] * label_height
    style_height = max(1.0, row_y2 - row_y1)
    row_x_bounds = _style_x_bounds_from_row(image, label_px, row, style_rel)
    if row_x_bounds is not None:
        x1, x2 = row_x_bounds
    else:
        style_width = max(1.0, x2 - x1)
        target_digits = _digits(style_code)
        min_width = style_height * max(5.5, min(len(target_digits or "000000000000") * 0.58, 8.8))
        if style_width < min_width:
            center = (x1 + x2) / 2
            x1 = center - min_width / 2
            x2 = center + min_width / 2
    x1 = max(lx1, x1)
    x2 = min(lx2, x2)
    if x2 <= x1:
        return style
    return _from_pixel_bbox((x1, row_y1, x2, row_y2), width, height)


def _project_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _candidate_node_modules_dirs() -> list[Path]:
    candidates: list[Path] = []
    for raw in (
        os.environ.get("CRAWSHRIMP_NODE_MODULES_DIR"),
        os.environ.get("NODE_PATH"),
    ):
        if not raw:
            continue
        for part in str(raw).split(os.pathsep):
            if part:
                candidates.append(Path(part).expanduser())
    candidates.append(_project_root() / "app" / "node_modules")
    return [path for path in candidates if path.is_dir()]


def project_tesseract_status() -> dict[str, Any]:
    node_modules = next((path for path in _candidate_node_modules_dirs() if (path / "tesseract.js").is_dir()), None)
    node_executable = _node_executable()
    return {
        "available": bool(node_modules and node_executable),
        "node_executable": node_executable,
        "node_modules": str(node_modules or ""),
        "package": "tesseract.js",
    }


def _node_executable() -> str:
    bundled = _text(os.environ.get("CRAWSHRIMP_NODE_EXECUTABLE"))
    if bundled:
        return bundled
    return shutil.which("node") or "node"


def _default_tesseract_lang_path() -> str:
    explicit = _text(os.environ.get("CRAWSHRIMP_TESSERACT_LANG_PATH"))
    if explicit:
        return explicit
    bundled = _project_root() / "adapters" / "tmall-ops-assistant" / "vendor" / "tesseract" / "lang"
    return str(bundled) if bundled.is_dir() else ""


_TESSERACT_JS_SCRIPT = r"""
const path = require('path');

async function main() {
  const imagePath = process.argv[1];
  const payload = JSON.parse(process.argv[2] || '{}');
  const nodeModulesDir = String(payload.nodeModulesDir || '').trim();
  const tesseractModule = nodeModulesDir
    ? require(path.join(nodeModulesDir, 'tesseract.js'))
    : require('tesseract.js');
  const options = { logger: () => {} };
  if (payload.corePath) options.corePath = payload.corePath;
  if (payload.langPath) options.langPath = payload.langPath;
  const worker = await tesseractModule.createWorker(payload.lang || 'eng', 1, options);
  try {
    if (payload.whitelist) {
      await worker.setParameters({ tessedit_char_whitelist: payload.whitelist });
    }
    const result = await worker.recognize(imagePath);
    const data = result.data || {};
    const words = (data.words || []).map((word) => ({
      text: String(word.text || ''),
      confidence: Number(word.confidence || 0),
      bbox: [
        Number(word.bbox?.x0 || 0),
        Number(word.bbox?.y0 || 0),
        Number(word.bbox?.x1 || 0),
        Number(word.bbox?.y1 || 0),
      ],
    }));
    process.stdout.write(JSON.stringify({
      ok: true,
      text: String(data.text || ''),
      confidence: Number(data.confidence || 0),
      words,
    }));
  } finally {
    await worker.terminate();
  }
}

main().catch((error) => {
  process.stderr.write(String(error && error.stack || error));
  process.exit(1);
});
"""


def recognize_image_with_tesseract_js(
    image_path: Path | str,
    *,
    lang: str = "eng",
    timeout_seconds: float = 30.0,
    whitelist: str = "",
) -> dict[str, Any]:
    status = project_tesseract_status()
    if not status["available"]:
        raise RuntimeError("project tesseract.js runtime is not available")
    node_modules = Path(status["node_modules"])
    payload = {
        "nodeModulesDir": str(node_modules),
        "corePath": str(node_modules / "tesseract.js-core"),
        "langPath": _default_tesseract_lang_path(),
        "lang": lang,
        "whitelist": whitelist,
    }
    env = dict(os.environ)
    env["NODE_PATH"] = os.pathsep.join(
        part
        for part in [str(node_modules), _text(env.get("NODE_PATH"))]
        if part
    )
    if _text(os.environ.get("CRAWSHRIMP_NODE_EXECUTABLE")):
        env["ELECTRON_RUN_AS_NODE"] = "1"
    completed = subprocess.run(
        [status["node_executable"], "-e", _TESSERACT_JS_SCRIPT, str(image_path), json.dumps(payload)],
        cwd=str(_project_root()),
        env=env,
        capture_output=True,
        text=True,
        timeout=max(1.0, float(timeout_seconds)),
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError((completed.stderr or completed.stdout or "tesseract.js failed").strip())
    data = json.loads(completed.stdout or "{}")
    data["words"] = [
        OcrWord(
            text=_text(word.get("text")),
            confidence=float(word.get("confidence") or 0),
            bbox=tuple(float(item) for item in (word.get("bbox") or [0, 0, 0, 0])),
        )
        for word in data.get("words", [])
        if isinstance(word, dict)
    ]
    return data
