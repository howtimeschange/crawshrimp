"""Isolated, offline DINO inference worker; no training labels or network fallback."""

import argparse, json, re, subprocess, time
from pathlib import Path
import numpy as np
from PIL import Image, ImageOps
from .foreground import read_crop
from .identity import verify, sku_fields
from .util import sha


def encode(rows, bundle):
    from .inference import Backbone, normalize
    model = Backbone(bundle, 224)
    xs = []
    for row in rows:
        im, _ = read_crop(row["path"])
        z = model.encode(im)
        p = z[1:].reshape(16, 16, -1)
        blocks = np.stack([z[0]] + [p[y:y+8, x:x+8].mean((0, 1))
                                         for y in (0, 8) for x in (0, 8)])
        xs.append(normalize(blocks).flatten() / np.sqrt(5))
    return np.asarray(xs)


def score(x, h):
    return 1 / (
        1 + np.exp(-np.clip(x @ np.asarray(h["coef"]) + h["intercept"], -50, 50))
    )


def label_data(lines, style, color):
    check = verify([l["text"] for l in lines], style, color, [l["box"] for l in lines])
    if not check["passed"]:
        reason = "鞋盒OCR款色不匹配" if check["status"] == "mismatch" else "鞋盒OCR款色无法确认，待复核"
        raise ValueError(f"{style}/{color} {reason}: {check}")
    exact = [l for l in lines if l["text"].strip() == style]
    if len(exact) != 1:
        raise ValueError(f"{style}/{color} 未得到唯一完整款号文字框")

    def box(l):
        x, y, w, h = l["box"]
        return [x, 1 - y - h, x + w, 1 - y]

    sb = box(exact[0])
    bs = [box(l) for l in lines]
    pad = 0.01
    lb = [
        max(0, min(b[0] for b in bs) - pad),
        max(0, min(b[1] for b in bs) - pad),
        min(1, max(b[2] for b in bs) + pad),
        min(1, max(b[3] for b in bs) + pad),
    ]
    names = [f["name"] for f in check["color_fields"] if f["name"]]
    return {
        "check": check,
        "style_code_bbox": sb,
        "label_bbox": lb,
        "color_name": (names[0] if names else "") + color,
        "lines": lines,
    }


def resolve_label(group, initial_lines, recognize, electronic=None, initial_barcodes=()):
    """Bounded retries; identity failure belongs to this color, not the batch."""
    style, color = group["style"], group["color"]
    attempts = group["label_attempts"] = []
    candidates = group.get("label_candidates") or [group["slots"]["wpz6"]]
    for index, candidate in enumerate(candidates):
        job = {"id": f"{style}-{color}", "path": candidate["path"]}
        record = {"lines": initial_lines, "barcodes": initial_barcodes} if index == 0 else recognize([job])[0]
        lines = record["lines"]
        for stage in ("full", "label_crop"):
            check = verify([l["text"] for l in lines], style, color, [l["box"] for l in lines])
            attempt = {"path": candidate["path"], "stage": stage, "check": check, "lines": lines, "barcodes": record.get("barcodes", [])}
            attempts.append(attempt)
            if check['passed'] and not any(l['text'].strip() == style for l in lines):
                merged = sku_fields([l['text'] for l in lines])
                if len(merged) == 1:
                    line = lines[merged[0]['line']]
                    x, y, w, h = line['box']
                    # Re-read only the leading style number. Never invent its
                    # bounding box by splitting the full SKU line proportionally.
                    region = [max(0, x-.003), max(0, 1-y-h-.003),
                              min(1, x+w*.54), min(1, 1-y+.003)]
                    reread = recognize([{**job, 'region': region}])[0]
                    attempt['style_region_ocr'] = reread
                    exact = [l for l in reread['lines'] if l['text'].strip() == style
                             and l.get('confidence', 0) >= .9]
                    if len(exact) == 1:
                        lines = [*lines, exact[0]]
            try:
                group["label"] = label_data(lines, style, color)
                group["slots"]["wpz6"] = candidate
                if group.get("label_candidate_scores"):
                    group["scores_uncalibrated"]["wpz6"] = group["label_candidate_scores"][index]
                group["label_status"] = "verified"
                weak = any(f["source"] == "damaged_header" or lines[f["line"]].get("confidence", 1) < .95 for f in check["color_fields"])
                if electronic and weak:
                    match = electronic.match(style, color, check, record.get("barcodes", []))
                    if match and match["status"] == "verified":
                        group["label"]["electronic_label"] = match
                        group["label"]["physical_color_name"] = group["label"]["color_name"]
                        if match["reference"]["color_name"]:
                            group["label"]["color_name"] = match["reference"]["color_name"] + color
                    elif match:
                        group["label_status"] = "unconfirmed"
                        group["label_error"] = f"{style}/{color} 电子标签事实冲突，待复核"
                return
            except ValueError as error:
                attempt["error"] = str(error)
            # Reject this source permanently. Another physical label in the
            # same folder may be valid, but must independently pass identity.
            if check["status"] == "mismatch":
                group.setdefault('rejected_label_sources', []).append({
                    'path': candidate['path'], 'check': check, 'error': attempt['error']})
                break
            if stage == "full" and lines:
                boxes = [l["box"] for l in lines]
                region = [max(0, min(b[0] for b in boxes)-.025),
                          max(0, min(1-b[1]-b[3] for b in boxes)-.025),
                          min(1, max(b[0]+b[2] for b in boxes)+.025),
                          min(1, max(1-b[1] for b in boxes)+.025)]
                record = recognize([{**job, "region": region}])[0]
                lines = record["lines"]
            else:
                break
    if electronic:
        for attempt in attempts:
            match = electronic.match(style, color, attempt["check"], attempt["barcodes"])
            if not match or match["status"] != "verified":
                continue
            lines = attempt["lines"]
            exact = [l for l in lines if l["text"].strip() == style]
            def box(l):
                x, y, w, h = l["box"]
                return [x, 1-y-h, x+w, 1-y]
            boxes = [box(l) for l in lines]
            if not boxes:
                continue
            group["label"] = {
                "check": {**attempt["check"], "passed": True, "status": "verified", "verification_source": "electronic_label_binding"},
                "physical_check": attempt["check"], "electronic_label": match,
                "style_code_bbox": box(exact[0]) if len(exact) == 1 else None,
                "label_bbox": [min(b[0] for b in boxes), min(b[1] for b in boxes), max(b[2] for b in boxes), max(b[3] for b in boxes)],
                "color_name": match["reference"]["color_name"] + color, "lines": lines}
            group["slots"]["wpz6"] = next(c for c in candidates if c["path"] == attempt["path"])
            group["label_status"] = "verified"
            return
    rejected = group.get('rejected_label_sources') or []
    group["label_status"] = "mismatch" if rejected else "unconfirmed"
    group["label_error"] = (rejected[0]['error'] if rejected else
        f"{style}/{color} 鞋盒OCR款色无法确认，局部重识别及候选图核验后仍待复核")


def is_standard_box_label(lines):
    """A readable SKU is not enough: require the Chinese box certificate fields."""
    text = ' '.join(line['text'] for line in lines)
    return all(marker in text for marker in ('产品名称', '颜色', '帮面材料')) and any(
        marker in text for marker in ('合格证', '执行标准', '产品等级'))


def ensure_standard_label(group, recognize, electronic):
    """Keep identity evidence separate from the label used in the deliverable."""
    # A whole shoe-box photo can bind identity while its small material text
    # remains unreadable. Re-read the certificate at its actual resolution;
    # do not relax the required fields or infer them from a known SKU.
    label = group.get('label', {})
    text = ' '.join(line['text'] for line in label.get('lines', []))
    if (group.get('label_status') == 'verified'
            and not is_standard_box_label(label.get('lines', []))
            and label.get('label_bbox')
            and all(marker in text for marker in ('产品名称', '颜色'))
            and any(marker in text for marker in ('合格证', '执行标准', '产品等级'))):
        record = recognize([{'id': group['style']+'-'+group['color']+'-standard',
                             'path': group['slots']['wpz6']['path'],
                             'region': label['label_bbox']}])[0]
        group.setdefault('standard_label_attempts', []).append(record)
        crop_check = verify([line['text'] for line in record['lines']], group['style'],
                            group['color'], [line['box'] for line in record['lines']])
        # Keep the already verified identity from this same physical source.
        # Crop OCR may improve tiny material text but damage another header.
        # Only supplement the material field, never SKU/color/barcode facts.
        material_lines = [line for line in record['lines']
                          if line['text'].startswith('帮面材料')
                          and line.get('confidence', 0) >= .85]
        combined = label['lines'] + material_lines
        if crop_check['status'] != 'mismatch' and is_standard_box_label(combined):
            try:
                reread = label_data(combined, group['style'], group['color'])
                group['label'] = reread
            except ValueError:
                pass
    if group.get('label_status') == 'verified' and is_standard_box_label(group['label']['lines']):
        group['label']['output_kind'] = 'standard_box_photo'
        return
    style, color = group['style'], group['color']
    group['nonstandard_label_source'] = group['slots']['wpz6']
    # Prefer another independently verified standard physical box label.
    for candidate in group.get('label_candidates', []):
        if candidate['path'] == group['slots']['wpz6']['path']:
            continue
        record = recognize([{'id': style+'-'+color, 'path': candidate['path']}])[0]
        if not is_standard_box_label(record['lines']):
            continue
        try:
            label = label_data(record['lines'], style, color)
        except ValueError:
            continue
        group['label'] = {**label, 'output_kind': 'standard_box_photo'}
        group['label_status'] = 'verified'
        group['slots']['wpz6'] = candidate
        return
    reference = electronic.references(style).get(color) if electronic else None
    if reference and reference['status'] == 'verified':
        for tile in reference.get('tiles', []):
            if tile['kind'] != 'box_label' or not is_standard_box_label(tile.get('lines', [])):
                continue
            try:
                label = label_data(tile['lines'], style, color)
            except ValueError:
                continue
            group['label'] = {**label, 'output_kind': 'electronic_box_label',
                'output_source': tile['source'], 'label_bbox': tile['region'],
                'electronic_label': {'status': 'verified', 'reference': reference}}
            group['label_status'] = 'verified'
            return
    group['label_status'] = 'unconfirmed'
    group['label_error'] = f'{style}/{color} 缺少标准鞋盒标签，同款电子盒标未核验通过；缝标和简式盒标不可用于标签成品'


def run(inp, bundle, out):
    start = time.perf_counter()
    rows = inp["candidates"]
    allowed = {
        "id",
        "style",
        "color",
        "category",
        "path",
        "sha256",
        "filename",
        "cloud_path",
    }
    for r in rows:
        if set(r) - allowed:
            raise ValueError("Inference input contains supervision or unknown fields")
        if sha(r["path"]) != r["sha256"]:
            raise ValueError("Source hash changed")
        if not re.fullmatch(r"\d{12}", r["style"]) or not re.fullmatch(
            r"\d{5}", r["color"]
        ):
            raise ValueError("Invalid source identity")
    metadata = json.loads((bundle / "bundle.json").read_text())
    for name, digest in metadata["files"].items():
        if sha(bundle / name) != digest:
            raise ValueError(f"Model resource integrity failure: {name}")
    x = encode(rows, bundle)
    models = json.loads((bundle / "models.json").read_text())["models"]
    yx = json.loads((bundle / "yx.json").read_text())
    results = []
    mouth = None
    for style, color in dict.fromkeys((r["style"], r["color"]) for r in rows):
        ids = [
            i for i, r in enumerate(rows) if (r["style"], r["color"]) == (style, color)
        ]
        cats = {rows[i]["category"] for i in ids}
        if len(cats) != 1:
            raise ValueError("Conflicting business category")
        cat = cats.pop()
        slots = {}
        scores = {}
        label_candidates = []
        label_candidate_scores = []
        yx_evidence = {}
        for slot in [
            "tmz1",
            "tmz2",
            "tmz3",
            "tmz4",
            "tmz5",
            "yq2",
            "yq3",
            "yx",
            "wpz6",
        ]:
            pool = ids
            if slot == "tmz5":
                pool = [
                    i
                    for i in ids
                    if re.fullmatch(
                        re.escape(style) + r"\s*[-－–—]\s*" + color,
                        Path(rows[i]["filename"]).stem,
                    )
                ]
            if not pool:
                raise ValueError(f"{style}/{color} missing standard source for {slot}")
            h = yx if slot == "yx" else models["spatial-" + cat + "-" + slot]
            prob = score(x[pool], h)
            if slot == "yx":
                threshold = float(yx.get("threshold", 0.5))
                if not 0 < threshold < 1:
                    raise ValueError("Invalid YX model threshold")
                yx_evidence = {
                    "model_version": yx.get("version", "yx-shared-v2"),
                    "model_sha256": metadata["files"]["yx.json"],
                    "threshold": threshold,
                    "decision": "selected" if prob.max() >= threshold else "pending_review",
                    "feature_card_filenames": [rows[pool[int(i)]]["filename"]
                                               for i in np.flatnonzero(prob >= threshold)],
                    "top_candidates": [{"id": rows[pool[int(i)]]["id"],
                                        "filename": rows[pool[int(i)]]["filename"],
                                        "sha256": rows[pool[int(i)]]["sha256"],
                                        "score": float(prob[int(i)])}
                                       for i in np.argsort(-prob)[:3]],
                }
            if slot == "wpz6":
                label_candidates = [dict(rows[pool[int(i)]]) for i in np.argsort(-prob)[:3]]
                label_candidate_scores = [float(prob[int(i)]) for i in np.argsort(-prob)[:3]]
            best = pool[int(prob.argmax())]
            scores[slot] = float(prob.max())
            slots[slot] = (
                None if slot == "yx" and prob.max() < threshold else dict(rows[best])
            )
        # Same-color gray counterpart ranked against the chosen standard-source embedding.
        anchor = next(i for i in ids if rows[i]["id"] == slots["tmz5"]["id"])
        gray = []
        for i in ids:
            with Image.open(rows[i]["path"]) as im:
                im = ImageOps.exif_transpose(im).convert("RGB")
                im.thumbnail((64, 64))
                a = np.asarray(im)
                edge = np.concatenate([a[0], a[-1], a[:, 0], a[:, -1]])
                bg = np.median(edge, axis=0)
            if 235 <= float(bg.mean()) < 253 and float(bg.max() - bg.min()) < 8:
                gray.append(i)
        if not gray:
            raise ValueError(f"{style}/{color} 未发现WPZ15灰底候选，拒绝填充占位图")
        sims = x[gray] @ x[anchor]
        best = gray[int(sims.argmax())]
        slots["wpz5"] = dict(rows[best])
        scores["wpz5_pair_similarity"] = float(sims.max())
        if sims.max() < 0.80:
            raise ValueError(f"{style}/{color} WPZ15同姿势配对不确定")
        if cat == "雪地":
            if mouth is None:
                from .mouth_crop import MouthCropper

                mouth = MouthCropper(bundle)
            target = out / f"{style}-{color}-snow-tmz4.jpg"
            slots["tmz4"]["crop"] = mouth.crop(slots["tmz4"]["path"], target)
            slots["tmz4"]["generated"] = str(target)
        results.append(
            {
                "style": style,
                "color": color,
                "category": cat,
                "slots": slots,
                "scores_uncalibrated": scores,
                "yx_evidence": yx_evidence,
                "label_candidates": label_candidates,
                "label_candidate_scores": label_candidate_scores,
            }
        )
    jobs = [
        {"id": f"{g['style']}-{g['color']}", "path": g["slots"]["wpz6"]["path"]}
        for g in results
    ]
    jobs_path = out / "ocr-input.json"
    jobs_path.write_text(json.dumps(jobs))
    from .ocr import recognize
    recognized = recognize(jobs)
    (out / "ocr-results.jsonl").write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in recognized), encoding="utf-8")
    ocr = {r["id"]: r for r in recognized}
    from .electronic_labels import ElectronicLabels
    electronic = ElectronicLabels(inp.get("label_sources", []), recognize)
    for g in results:
        record = ocr[f"{g['style']}-{g['color']}"]
        resolve_label(g, record["lines"], recognize, electronic, record.get("barcodes", []))
        ensure_standard_label(g, recognize, electronic)
        (out / f"{g['style']}-{g['color']}-label-attempts.json").write_text(
            json.dumps(g["label_attempts"], ensure_ascii=False, indent=2), encoding="utf-8")
    (out / "electronic-label-evidence.json").write_text(json.dumps(electronic.evidence, ensure_ascii=False, indent=2))
    (out / "selection.json").write_text(
        json.dumps(results, ensure_ascii=False, indent=2)
    )
    (out / "runtime.json").write_text(
        json.dumps(
            {
                "seconds": time.perf_counter() - start,
                "groups": len(results),
                "images": len(rows),
                "paid_model_calls": 0,
                "bundle_version": metadata["version"],
                "input_sha256": sha(out / "input.json"),
                "worker_sha256": sha(__file__),
            },
            indent=2,
        )
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    run(json.loads(Path(a.input).read_text()), Path(a.bundle), Path(a.out))


if __name__ == "__main__":
    main()
