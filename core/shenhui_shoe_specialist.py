"""Bala local-model strategy, connected to the existing shoe package exporter."""

from __future__ import annotations
import json, os, re, subprocess, time, sys
from pathlib import Path
from core.shoe_specialist.util import sha
from core.shoe_specialist.identity import packaging_bbox

DEFAULT_BUNDLE = Path(__file__).resolve().parent / "shoe_specialist" / "assets"


def prepare(
    *,
    data_rows,
    output_root,
    shoe_categories=None,
    specialist_bundle=None,
    specialist_python=None,
    log=lambda _: None,
    progress=None,
    **kwargs,
):
    from core import shenhui_shoe_packaging as p

    bundle = Path(specialist_bundle or DEFAULT_BUNDLE).expanduser().resolve()
    python = Path(specialist_python or sys.executable)
    if not python.is_file() or not (bundle / "bundle.json").is_file():
        raise p.ShoeSelectionError(
            "应用内置的巴拉鞋品识别资源缺失，请修复或更新应用；不会自动调用大模型"
        )
    grouped = {}
    rows = []
    for r in data_rows:
        if r.get("下载结果") != "已下载":
            continue
        style = str(r.get("输入款号") or r.get("__shenhui_group_code") or "")
        color = str(r.get("__shoe_color_code") or r.get("颜色") or "")
        path = Path(r.get("本地文件") or "")
        filename = str(
            r.get("__shoe_original_filename") or r.get("原文件名") or path.name
        )
        if (
            not re.fullmatch(r"\d{12}", style)
            or not re.fullmatch(r"\d{5}", color)
            or not path.is_file()
        ):
            continue
        if p._is_junk_shoe_asset_filename(filename, str(r.get("云盘路径") or "")):
            continue
        grouped.setdefault((style, color), []).append(
            {"filename": filename, "path": path, "row": r}
        )
    if not grouped:
        raise p.ShoeSelectionError("没有可识别的已下载鞋品图片")
    for (style, color), entries in grouped.items():
        category = (shoe_categories or {}).get(style)
        if category not in {"运动", "休闲", "婴童", "雪地"}:
            raise p.ShoeSelectionError(
                f"{style} 专属模型需要品类表明确填写运动/休闲/婴童/雪地；不猜测品类"
            )
        for e in entries:
            if "ai角度" in e["filename"].lower():
                continue
            cloud = str(e["row"].get("云盘路径") or "")
            if cloud and (style not in cloud or "/" + color + "/" not in cloud):
                raise p.ShoeSelectionError(f"{style}/{color} 原图云盘路径身份不匹配")
            rows.append(
                {
                    "id": f"I{len(rows):05}",
                    "style": style,
                    "color": color,
                    "category": category,
                    "path": str(e["path"].resolve()),
                    "sha256": sha(e["path"]),
                    "filename": e["filename"],
                    "cloud_path": cloud,
                }
            )
    analysis = Path(output_root) / "_shoe_analysis" / "bala-specialist"
    analysis.mkdir(parents=True, exist_ok=True)
    # Unique run folder avoids stale inference being mistaken for a new result.
    import tempfile

    run = Path(tempfile.mkdtemp(prefix="run-", dir=analysis))
    inp = run / "input.json"
    inp.write_text(json.dumps({"candidates": rows}, ensure_ascii=False))
    log(f"巴拉鞋品专属模型识别：{len(grouped)}款色/{len(rows)}张原图，本地DINOv2＋OCR")
    env = {
        **os.environ,
        "HF_HUB_OFFLINE": "1",
        "TRANSFORMERS_OFFLINE": "1",
        "PYTHONUTF8": "1",
        "PYTHONPATH": str(Path(__file__).resolve().parents[1]),
    }
    command = [
        str(python),
        "-m",
        "core.shoe_specialist.worker",
        "--input",
        str(inp.resolve()),
        "--bundle",
        str(bundle),
        "--out",
        str(run.resolve()),
    ]
    with (run / "worker.log").open("w") as stream:
        process = subprocess.Popen(
            command,
            stdout=stream,
            stderr=subprocess.STDOUT,
            env=env,
            cwd=Path(__file__).resolve().parents[1],
        )
        started = time.monotonic()
        try:
            while process.poll() is None:
                if time.monotonic() - started > 1800:
                    raise p.ShoeSelectionError("本地鞋品识别超过30分钟，已停止")
                if progress:
                    progress(
                        {
                            "organize_total": len(grouped),
                            "organize_completed": 0,
                            "organize_active": True,
                            "organize_stage": "巴拉专属模型本地识别与OCR",
                        }
                    )
                time.sleep(1)
        finally:
            if process.poll() is None:
                process.terminate()
                process.wait(timeout=10)
    if process.returncode:
        raise p.ShoeSelectionError(
            "巴拉专属模型识别失败：" + (run / "worker.log").read_text()[-1800:]
        )
    results = json.loads((run / "selection.json").read_text())
    cache = {}
    for g in results:
        style, color = g["style"], g["color"]
        entries = grouped[style, color]
        by = {e["filename"]: e for e in entries}
        s = g["slots"]
        label = g["label"]
        if not label["check"]["passed"]:
            raise p.ShoeSelectionError(f"{style}/{color} 身份未通过")
        # Different size folders may contain the same filename. Bind the model's
        # exact path, not the last filename encountered while downloading.
        exact_entries = {str(e["path"].resolve()): e for e in entries}
        chosen_names = {}
        for selected in s.values():
            if not selected:
                continue
            key = selected["filename"]
            path = selected["path"]
            if key in chosen_names and chosen_names[key] != path:
                raise p.ShoeSelectionError(f"{style}/{color} 同名源图冲突：{key}")
            chosen_names[key] = path
            by[key] = exact_entries[path]

        def name(k):
            return s[k]["filename"] if s.get(k) else ""

        slots = {f"tmz{i}": name(f"tmz{i}") for i in range(1, 6)}
        if s["tmz4"].get("generated"):
            generated = f"{style}-{color}-lining-crop.jpg"
            by[generated] = {
                "filename": generated,
                "path": Path(s["tmz4"]["generated"]),
                "row": by[name("tmz4")]["row"],
            }
            slots["tmz4"] = generated
        slots.update(
            tms=name("tmz5"),
            wpz=[slots[f"tmz{i}"] for i in range(1, 5)] + [name("wpz5"), name("wpz6")],
            yq=[name("tmz2"), name("yq2"), name("yq3")],
            yx=name("yx"),
            yk=sorted(
                (
                    e["filename"]
                    for e in entries
                    if p._is_yk_source_filename(e["filename"])
                ),
                key=p._named_yk_sort_key,
            ),
            shoe_category=g["category"],
            shoe_category_source="用户品类表",
            _model_id="bala-shoe-dinov2-onnx-v2",
            _label_verified=True,
            _label_color_name=label["color_name"],
            label_bbox=packaging_bbox(label["label_bbox"]),
            style_code_bbox=packaging_bbox(label["style_code_bbox"]),
        )
        slots = p._apply_o_category_rule(g["category"], slots)
        # Preserve the existing exporter policy: TMZ1..4 use a gray counterpart
        # only when unchanged foreground pixels and silhouette agree.
        from core.shenhui_shoe_fast import _gray_mates

        pose_by = {k: v for k, v in by.items() if "ai角度" not in k.lower()}
        ctx = {"entries": pose_by, "ids": {k: k for k in pose_by}}
        corrections = []
        for i in range(1, 5):
            key = f"tmz{i}"
            if i == 4 and g["category"] == "雪地":
                continue
            mates = _gray_mates(ctx, slots[key])
            if mates:
                previous = slots[key]
                slots[key] = mates[0]
                slots["wpz"][i - 1] = mates[0]
                corrections.append(
                    {
                        "slot": key,
                        "before": previous,
                        "after": mates[0],
                        "rule": "same foreground pixels and silhouette, gray counterpart",
                    }
                )
        slots["yq"][0] = slots["tmz2"]
        slots = p._apply_o_category_rule(g["category"], slots)
        evidence = {
            "version": "bala-shoe-dinov2-onnx-v2",
            "category": g["category"],
            "label_verified": True,
            "scores_uncalibrated": g["scores_uncalibrated"],
            "background_corrections": corrections,
            "source_sha256": {name: sha(entry["path"]) for name, entry in by.items()},
            "independent_test": False,
            "llm_calls": 0,
        }
        slots["_specialist_evidence"] = evidence
        if not slots["yx"]:
            slots["_pending_slots"] = {
                "yx": "小模型未选中功能卡；不等同于全部源素材不存在，请查看完整原图"
            }
        # Cache only verified source decisions. Existing exporter owns all physical paths/conversions.
        cache[style, color] = {
            "slots": slots,
            "color_name": label["color_name"],
            "entries_by_name": by,
            "entries": entries,
            "category_context": {},
        }
        (run / f"{style}-{color}-resolved.json").write_text(
            json.dumps(slots, ensure_ascii=False, indent=2)
        )
    log("本地款色身份核验通过，按现有脚本生成完整图包")
    return p.prepare_shoe_packages(
        data_rows=data_rows,
        output_root=output_root,
        pose_strategy="bala_specialist",
        shoe_categories=shoe_categories,
        _prepared_colors=cache,
        _reuse_prepared=True,
        preserve_analysis_artifacts=True,
        log=log,
        progress=progress,
    )
